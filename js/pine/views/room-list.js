// Pine Room List View
async function renderRoomList(container) {
  container.innerHTML = '<div class="pine-loading">読み込み中...</div>';

  try {
    const rooms = await RoomService.getRoomList();

    // Action buttons (always visible)
    const actions = document.createElement('div');
    actions.className = 'pine-room-actions';
    actions.innerHTML = `
      <button class="pine-btn pine-btn-primary" id="pine-new-dm-btn">+ DM</button>
      <button class="pine-btn pine-btn-primary" id="pine-invite-btn">👤 招待</button>
    `;

    if (rooms.length === 0) {
      container.innerHTML = '';
      container.appendChild(actions);
      const empty = document.createElement('div');
      empty.className = 'pine-empty';
      empty.textContent = 'チャットルームがありません。DMを始めるか、メンバーを招待しましょう。';
      container.appendChild(empty);
      attachRoomListActions(container);
      return;
    }

    const list = document.createElement('div');
    list.className = 'pine-room-list';

    for (const room of rooms) {
      const card = document.createElement('div');
      card.className = 'pine-room-card';
      card.addEventListener('click', () => {
        location.hash = `room/${room.id}`;
      });

      // Room name
      const nameEl = document.createElement('div');
      nameEl.className = 'pine-room-name';
      nameEl.textContent = room.name || 'DM';

      // Last message preview
      const previewEl = document.createElement('div');
      previewEl.className = 'pine-room-preview';
      if (room.last_message) {
        const preview = room.last_message.message_type === 'image'
          ? '📷 画像'
          : (room.last_message.content || '');
        previewEl.textContent = preview.length > 40
          ? preview.substring(0, 40) + '…'
          : preview;
      } else {
        previewEl.textContent = 'メッセージなし';
      }

      // Timestamp
      const timeEl = document.createElement('div');
      timeEl.className = 'pine-room-time';
      if (room.last_message) {
        timeEl.textContent = formatRoomTime(room.last_message.created_at);
      }

      // Unread badge
      const badgeEl = document.createElement('div');
      badgeEl.className = 'pine-room-badge';
      if (room.unread_count > 0) {
        badgeEl.textContent = room.unread_count > 99 ? '99+' : room.unread_count;
        badgeEl.style.display = 'flex';
      } else {
        badgeEl.style.display = 'none';
      }

      // Layout: left (name + preview), right (time + badge)
      const leftEl = document.createElement('div');
      leftEl.className = 'pine-room-left';
      leftEl.appendChild(nameEl);
      leftEl.appendChild(previewEl);

      const rightEl = document.createElement('div');
      rightEl.className = 'pine-room-right';
      rightEl.appendChild(timeEl);
      rightEl.appendChild(badgeEl);

      card.appendChild(leftEl);
      card.appendChild(rightEl);
      list.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(actions);
    container.appendChild(list);
    attachRoomListActions(container);
  } catch (err) {
    container.innerHTML = `<div class="pine-error">エラー: ${err.message}</div>`;
  }
}

function attachRoomListActions(container) {
  const dmBtn = container.querySelector('#pine-new-dm-btn');
  const inviteBtn = container.querySelector('#pine-invite-btn');

  if (dmBtn) {
    dmBtn.addEventListener('click', async () => {
      // 友達リストを取得して選択UIを表示
      try {
        const { data: { user } } = await pineSupabase.auth.getUser();
        const { data: friendships } = await pineSupabase
          .from('pine_friendships')
          .select('member_a, member_b')
          .or(`member_a.eq.${user.id},member_b.eq.${user.id}`);

        if (!friendships || friendships.length === 0) {
          alert('友達がいません。まず招待しましょう。');
          return;
        }

        // Get friend IDs
        const friendIds = friendships.map(f =>
          f.member_a === user.id ? f.member_b : f.member_a
        );

        // Fetch friend names
        const { data: friends } = await pineSupabase
          .from('pine_members')
          .select('id, display_name')
          .in('id', friendIds);

        if (!friends || friends.length === 0) {
          alert('友達が見つかりません');
          return;
        }

        // Simple selection dialog
        const names = friends.map((f, i) => `${i + 1}. ${f.display_name}`).join('\n');
        const choice = prompt(`DM相手を選んでください:\n${names}\n\n番号を入力:`);
        if (!choice) return;

        const idx = parseInt(choice) - 1;
        if (idx < 0 || idx >= friends.length) {
          alert('無効な選択です');
          return;
        }

        const roomId = await RoomService.getOrCreateDM(friends[idx].id);
        location.hash = `room/${roomId}`;
      } catch (err) {
        alert(`エラー: ${err.message}`);
      }
    });
  }

  if (inviteBtn) {
    inviteBtn.addEventListener('click', () => {
      location.hash = 'invite';
    });
  }
}

function formatRoomTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return '昨日';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('ja-JP', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  }
}
