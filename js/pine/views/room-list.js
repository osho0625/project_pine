// Pine Room List View (Chats tab)
async function renderRoomList(container) {
  container.innerHTML = '<div class="pine-loading">読み込み中...</div>';

  try {
    const { data: { user } } = await pineSupabase.auth.getUser();
    const rooms = await RoomService.getRoomList();

    // Filter: only show rooms that have at least one message
    const roomsWithMessages = rooms.filter(room => room.last_message !== null);

    if (roomsWithMessages.length === 0) {
      container.innerHTML = `
        <div class="pine-empty">
          チャット履歴がありません。<br>友達タブからDMを始めましょう。
        </div>
      `;
      return;
    }

    // For DM rooms, fetch the other member's name
    const dmRoomIds = roomsWithMessages.filter(r => !r.is_group).map(r => r.id);
    let dmMemberNames = {};

    if (dmRoomIds.length > 0) {
      // Get other members in DM rooms (avoid nested select issues with RLS)
      const { data: members } = await pineSupabase
        .from('pine_chat_room_members')
        .select('chat_room_id, member_id')
        .in('chat_room_id', dmRoomIds)
        .neq('member_id', user.id)
        .is('left_at', null);

      if (members && members.length > 0) {
        const memberIds = [...new Set(members.map(m => m.member_id))];
        const { data: memberProfiles } = await pineSupabase
          .from('pine_members')
          .select('id, display_name, avatar_url')
          .in('id', memberIds);

        const profileMap = {};
        if (memberProfiles) {
          for (const p of memberProfiles) {
            profileMap[p.id] = p;
          }
        }

        for (const m of members) {
          const profile = profileMap[m.member_id];
          dmMemberNames[m.chat_room_id] = {
            name: profile?.display_name || 'DM',
            avatar_url: profile?.avatar_url || null,
          };
        }
      }
    }

    const list = document.createElement('div');
    list.className = 'pine-room-list';

    for (const room of roomsWithMessages) {
      const card = document.createElement('div');
      card.className = 'pine-room-card';
      card.addEventListener('click', () => {
        location.hash = `room/${room.id}`;
      });

      // Room name: use other member's name for DMs
      const nameEl = document.createElement('div');
      nameEl.className = 'pine-room-name';
      const dmInfo = dmMemberNames[room.id];
      nameEl.textContent = room.is_group
        ? (room.name || 'グループ')
        : (dmInfo?.name || 'DM');

      // Avatar
      const avatarEl = document.createElement('div');
      avatarEl.className = 'pine-avatar';
      if (!room.is_group && dmInfo?.avatar_url) {
        avatarEl.innerHTML = `<img src="${dmInfo.avatar_url}" class="pine-avatar-img">`;
      } else {
        const initial = room.is_group
          ? (room.name || 'G').charAt(0)
          : (dmInfo?.name || '?').charAt(0);
        avatarEl.textContent = initial;
      }

      // Last message preview
      const previewEl = document.createElement('div');
      previewEl.className = 'pine-room-preview';
      const preview = room.last_message.message_type === 'image'
        ? '📷 画像'
        : (room.last_message.content || '');
      previewEl.textContent = preview.length > 40
        ? preview.substring(0, 40) + '…'
        : preview;

      // Timestamp
      const timeEl = document.createElement('div');
      timeEl.className = 'pine-room-time';
      timeEl.textContent = formatRoomTime(room.last_message.created_at);

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

      card.appendChild(avatarEl);
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
