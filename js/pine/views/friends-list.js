// Pine Friends List View
async function renderFriendsList(container) {
  container.innerHTML = '<div class="pine-loading">読み込み中...</div>';

  try {
    const { data: { user } } = await pineSupabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Fetch friendships where current user is member_a or member_b
    const { data: friendships, error: fErr } = await pineSupabase
      .from('pine_friendships')
      .select('member_a, member_b')
      .or(`member_a.eq.${user.id},member_b.eq.${user.id}`);

    if (fErr) throw fErr;

    if (!friendships || friendships.length === 0) {
      container.innerHTML = `
        <div class="pine-empty">
          友達がいません。<br>右上の + ボタンから招待しましょう。
        </div>
      `;
      return;
    }

    // Get friend IDs
    const friendIds = friendships.map(f =>
      f.member_a === user.id ? f.member_b : f.member_a
    );

    // Fetch friend member details
    const { data: friends, error: mErr } = await pineSupabase
      .from('pine_members')
      .select('id, display_name, avatar_url')
      .in('id', friendIds);

    if (mErr) throw mErr;

    if (!friends || friends.length === 0) {
      container.innerHTML = `
        <div class="pine-empty">
          友達が見つかりません。
        </div>
      `;
      return;
    }

    // Render friend list
    const list = document.createElement('div');
    list.className = 'pine-friend-list';

    // Avatar gradient color assignment based on first character
    function getAvatarColor(name) {
      const colors = ['green', 'blue', 'purple', 'orange', 'pink', 'teal', 'indigo', 'amber'];
      const charCode = (name || '?').charCodeAt(0);
      return colors[charCode % colors.length];
    }

    for (const friend of friends) {
      const card = document.createElement('div');
      card.className = 'pine-friend-card';

      // Avatar — larger (48px via CSS) with gradient background
      const avatarEl = document.createElement('div');
      avatarEl.className = 'pine-avatar';
      if (friend.avatar_url) {
        const img = document.createElement('img');
        img.src = friend.avatar_url;
        img.alt = friend.display_name;
        img.className = 'pine-avatar-img';
        avatarEl.innerHTML = '';
        avatarEl.appendChild(img);
      } else {
        const initial = (friend.display_name || '?').charAt(0).toUpperCase();
        avatarEl.textContent = initial;
        avatarEl.setAttribute('data-color', getAvatarColor(friend.display_name));
      }

      // Name
      const nameEl = document.createElement('div');
      nameEl.className = 'pine-friend-name';
      nameEl.textContent = friend.display_name || '名前なし';

      // Layout
      const infoEl = document.createElement('div');
      infoEl.className = 'pine-friend-info';
      infoEl.appendChild(nameEl);

      card.appendChild(avatarEl);
      card.appendChild(infoEl);

      // On tap: create or get DM room, then navigate
      card.addEventListener('click', async () => {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
        try {
          const roomId = await RoomService.getOrCreateDM(friend.id);
          location.hash = `room/${roomId}`;
        } catch (err) {
          alert(`エラー: ${err.message}`);
          card.style.opacity = '1';
          card.style.pointerEvents = 'auto';
        }
      });

      list.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(list);
  } catch (err) {
    container.innerHTML = `<div class="pine-error">エラー: ${err.message}</div>`;
  }
}
