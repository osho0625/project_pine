// Pine Chat Room — LINE-style message view with realtime updates
async function renderChatRoom(container, roomId) {
  const { data: { user } } = await pineSupabase.auth.getUser();
  if (!user) {
    container.innerHTML = '<div class="pine-error">認証が必要です</div>';
    return;
  }

  // Track displayed message IDs to prevent duplicates
  const displayedIds = new Set();

  container.innerHTML = `
    <div class="pine-chat-wrapper">
      <div class="pine-chat-header">
        <button class="pine-back-btn" aria-label="戻る">‹</button>
        <span class="pine-chat-title">チャット</span>
        <button class="pine-call-header-btn" id="pine-start-call-btn" aria-label="通話">📞</button>
      </div>
      <div class="pine-chat-messages" id="pine-messages"></div>
      <form class="pine-chat-input" id="pine-chat-form">
        <input type="text" id="pine-msg-input" placeholder="メッセージを入力..."
          maxlength="${PINE_CONFIG.MAX_MESSAGE_LENGTH}" autocomplete="off">
        <button type="submit" aria-label="送信">▶</button>
      </form>
    </div>
  `;

  const messagesEl = document.getElementById('pine-messages');
  const form = document.getElementById('pine-chat-form');
  const input = document.getElementById('pine-msg-input');
  const backBtn = container.querySelector('.pine-back-btn');
  const titleEl = container.querySelector('.pine-chat-title');

  // Fetch room info for title
  try {
    const { data: roomData } = await pineSupabase
      .from('pine_chat_rooms')
      .select('name, is_group')
      .eq('id', roomId)
      .single();

    if (roomData && !roomData.is_group) {
      // DM: show other member's name
      const { data: otherMember } = await pineSupabase
        .from('pine_chat_room_members')
        .select('pine_members(display_name)')
        .eq('chat_room_id', roomId)
        .neq('member_id', user.id)
        .is('left_at', null)
        .single();
      titleEl.textContent = otherMember?.pine_members?.display_name || 'チャット';
    } else if (roomData) {
      titleEl.textContent = roomData.name || 'グループ';
    }
  } catch (e) { /* ignore */ }

  // Hide main header and tab bar
  document.querySelector('.pine-header').style.display = 'none';
  document.getElementById('pine-tab-bar').style.display = 'none';

  // Back navigation
  backBtn.addEventListener('click', () => {
    MessageService.unsubscribeMessages(roomId);
    document.querySelector('.pine-header').style.display = '';
    document.getElementById('pine-tab-bar').style.display = '';
    location.hash = '/';
  });

  // Scroll to bottom helper
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Render a single message bubble (LINE style)
  function renderMessage(msg) {
    // Skip if already displayed
    const msgKey = msg.id || msg.client_message_id;
    if (displayedIds.has(msgKey)) return null;
    displayedIds.add(msgKey);

    const isOwn = msg.sender_id === user.id;

    const wrapper = document.createElement('div');
    wrapper.className = `pine-msg ${isOwn ? 'pine-msg-self' : 'pine-msg-other'}`;

    // Avatar (other only)
    if (!isOwn) {
      const avatar = document.createElement('div');
      avatar.className = 'pine-avatar pine-msg-avatar';
      avatar.textContent = (msg.sender_display_name || '?').charAt(0);
      wrapper.appendChild(avatar);
    }

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'pine-msg-bubble-wrap';

    // Sender name (other only, for group)
    if (!isOwn && msg.sender_display_name) {
      const nameEl = document.createElement('div');
      nameEl.className = 'pine-msg-sender';
      nameEl.textContent = msg.sender_display_name;
      bubbleWrap.appendChild(nameEl);
    }

    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'pine-msg-bubble';

    if (msg.message_type === 'image' && msg.storage_path) {
      const img = document.createElement('img');
      img.className = 'pine-msg-image';
      img.alt = '画像';
      StorageService.getSignedUrl(msg.storage_path).then(url => { img.src = url; }).catch(() => {});
      bubble.appendChild(img);
    } else {
      bubble.textContent = msg.content || '';
    }
    bubbleWrap.appendChild(bubble);

    // Time
    const timeEl = document.createElement('div');
    timeEl.className = 'pine-msg-time';
    if (msg.created_at) {
      const d = new Date(msg.created_at);
      timeEl.textContent = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }

    // Layout: time position differs for own vs other
    if (isOwn) {
      wrapper.appendChild(timeEl);
      wrapper.appendChild(bubbleWrap);
    } else {
      bubbleWrap.appendChild(timeEl);
      wrapper.appendChild(bubbleWrap);
    }

    return wrapper;
  }

  // Append message to view
  function appendMessage(msg) {
    const el = renderMessage(msg);
    if (el) {
      messagesEl.appendChild(el);
      scrollToBottom();
    }
  }

  // Load history
  let messages = [];
  try {
    messages = await MessageService.loadHistory(roomId);
  } catch (err) {
    messages = await PineOfflineStore.getCachedMessages(roomId);
  }

  // Render initial messages
  messagesEl.innerHTML = '';
  for (const msg of messages) {
    const el = renderMessage(msg);
    if (el) messagesEl.appendChild(el);
  }
  scrollToBottom();

  // Subscribe to realtime — new messages appear instantly
  MessageService.subscribeMessages(roomId, (msg) => {
    appendMessage(msg);
    PineOfflineStore.cacheMessages(roomId, [msg]);
  });

  // Send message
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    // Optimistically show own message immediately
    const clientMessageId = crypto.randomUUID();
    const optimistic = {
      id: clientMessageId,
      client_message_id: clientMessageId,
      chat_room_id: roomId,
      sender_id: user.id,
      content: text,
      message_type: 'text',
      created_at: new Date().toISOString(),
      sender_display_name: 'あなた',
    };
    appendMessage(optimistic);

    try {
      await pineSupabase.rpc('send_message', {
        p_room_id: roomId,
        p_client_message_id: clientMessageId,
        p_content: text,
        p_message_type: 'text',
        p_storage_path: null,
      });
    } catch (err) {
      // On error, show retry option
      console.error('Send failed:', err);
    }
  });

  // Start call button
  const callBtn = document.getElementById('pine-start-call-btn');
  callBtn.addEventListener('click', async () => {
    try {
      const result = await CallService.startCall(roomId);
      if (result.status === 'busy') {
        alert('相手は通話中です');
      } else if (result.status === 'ok') {
        // Navigate to call screen
        container.innerHTML = '';
        renderCallScreen(container, result.sessionId, 'caller');
      }
    } catch (err) {
      alert('通話を開始できませんでした: ' + err.message);
    }
  });

  // Focus input
  input.focus();
}
