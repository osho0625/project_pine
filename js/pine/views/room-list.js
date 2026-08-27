// Pine Room List View
async function renderRoomList(container) {
  container.innerHTML = '<div class="pine-loading">読み込み中...</div>';

  try {
    const rooms = await RoomService.getRoomList();

    if (rooms.length === 0) {
      container.innerHTML = '<div class="pine-empty">チャットルームがありません</div>';
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
    container.appendChild(list);
  } catch (err) {
    container.innerHTML = `<div class="pine-error">エラー: ${err.message}</div>`;
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
