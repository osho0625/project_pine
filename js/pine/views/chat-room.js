// Pine Chat Room Message View
async function renderChatRoom(container, roomId) {
  const { data: { user } } = await pineSupabase.auth.getUser();
  if (!user) {
    container.innerHTML = '<div class="pine-error">認証が必要です</div>';
    return;
  }

  container.innerHTML = `
    <div class="pine-chat-container">
      <div class="pine-chat-header">
        <button class="pine-back-btn" aria-label="戻る">←</button>
        <span class="pine-chat-title"></span>
        <span class="pine-offline-indicator" style="display:none;">オフライン</span>
      </div>
      <div class="pine-messages-area" role="log" aria-live="polite"></div>
      <div class="pine-chat-input-area">
        <input type="text" class="pine-message-input" placeholder="メッセージを入力..."
          maxlength="${PINE_CONFIG.MAX_MESSAGE_LENGTH}" aria-label="メッセージ入力">
        <button class="pine-send-btn" aria-label="送信">送信</button>
      </div>
    </div>
  `;

  const messagesArea = container.querySelector('.pine-messages-area');
  const input = container.querySelector('.pine-message-input');
  const sendBtn = container.querySelector('.pine-send-btn');
  const backBtn = container.querySelector('.pine-back-btn');
  const offlineIndicator = container.querySelector('.pine-offline-indicator');

  // Back navigation
  backBtn.addEventListener('click', () => { location.hash = '/'; });

  // Offline indicator
  function updateOnlineStatus() {
    offlineIndicator.style.display = navigator.onLine ? 'none' : 'inline';
  }
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // Load messages (try network first, fallback to cache)
  let messages = [];
  try {
    if (navigator.onLine) {
      messages = await MessageService.loadHistory(roomId);
    } else {
      messages = await PineOfflineStore.getCachedMessages(roomId);
    }
  } catch (err) {
    // Fallback to cache on error
    messages = await PineOfflineStore.getCachedMessages(roomId);
  }

  // Render messages
  function renderMessage(msg) {
    const isOwn = msg.sender_id === user.id;
    const bubble = document.createElement('div');
    bubble.className = `pine-message-bubble ${isOwn ? 'pine-msg-own' : 'pine-msg-other'}`;
    bubble.dataset.messageId = msg.id || msg.client_message_id;

    // Sender name (for others)
    if (!isOwn) {
      const senderEl = document.createElement('div');
      senderEl.className = 'pine-msg-sender';
      senderEl.textContent = msg.sender_display_name || msg.sender_id.substring(0, 8);
      bubble.appendChild(senderEl);
    }

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'pine-msg-content';

    if (msg.message_type === 'image' && msg.storage_path) {
      const img = document.createElement('img');
      img.className = 'pine-msg-image';
      img.alt = '送信された画像';
      img.loading = 'lazy';
      // Load signed URL async
      StorageService.getSignedUrl(msg.storage_path).then((url) => {
        if (url) img.src = url;
      }).catch(() => {
        img.alt = '画像を読み込めませんでした';
      });
      contentEl.appendChild(img);
    } else {
      contentEl.textContent = msg.content || '';
    }
    bubble.appendChild(contentEl);

    // Timestamp
    const timeEl = document.createElement('div');
    timeEl.className = 'pine-msg-time';
    if (msg.created_at) {
      const d = new Date(msg.created_at);
      timeEl.textContent = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    bubble.appendChild(timeEl);

    return bubble;
  }

  // Initial render
  messagesArea.innerHTML = '';
  for (const msg of messages) {
    messagesArea.appendChild(renderMessage(msg));
  }
  messagesArea.scrollTop = messagesArea.scrollHeight;

  // Subscribe to realtime messages
  MessageService.subscribeMessages(roomId, (msg) => {
    messagesArea.appendChild(renderMessage(msg));
    messagesArea.scrollTop = messagesArea.scrollHeight;
    // Cache new message
    PineOfflineStore.cacheMessages(roomId, [msg]);
  });

  // Send message
  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    if (text.length > PINE_CONFIG.MAX_MESSAGE_LENGTH) return;

    input.value = '';
    try {
      const result = await MessageService.sendMessage(roomId, text, 'text');
      // If offline (optimistic), show immediately
      if (result && result.status === 'pending') {
        messagesArea.appendChild(renderMessage({
          ...result,
          sender_id: user.id,
        }));
        messagesArea.scrollTop = messagesArea.scrollHeight;
      }
    } catch (err) {
      // Show error inline
      input.value = text;
    }
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Cleanup on navigation away
  return function cleanup() {
    MessageService.unsubscribeMessages(roomId);
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
  };
}
