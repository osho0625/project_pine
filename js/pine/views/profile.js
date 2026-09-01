// Pine Profile View — プロフィール設定 + ログアウト
async function renderProfileView(container) {
  const { data: { user } } = await pineSupabase.auth.getUser();
  if (!user) {
    container.innerHTML = '<div class="pine-error">認証が必要です</div>';
    return;
  }

  // Fetch current member profile
  const { data: member } = await pineSupabase
    .from('pine_members')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single();

  const displayName = member?.display_name || '';
  const avatarUrl = member?.avatar_url || '';

  container.innerHTML = `
    <div class="pine-profile-page">
      <div class="pine-profile-header">
        <button class="pine-back-btn" id="pine-profile-back">‹</button>
        <span>設定</span>
      </div>
      <div class="pine-profile-avatar-section">
        <div class="pine-profile-avatar" id="pine-profile-avatar">
          ${avatarUrl ? `<img src="${avatarUrl}" class="pine-avatar-img">` : (displayName.charAt(0) || '?')}
        </div>
        <label class="pine-btn pine-btn-primary pine-btn-small" for="pine-avatar-input">画像を変更</label>
        <input type="file" id="pine-avatar-input" accept="image/jpeg,image/png,image/webp" style="display:none;">
      </div>

      <div class="pine-profile-form">
        <label>表示名</label>
        <input type="text" id="pine-profile-name" value="${displayName}" maxlength="50" placeholder="名前を入力">
        <button class="pine-btn pine-btn-primary" id="pine-save-profile-btn">保存</button>
      </div>

      <div class="pine-profile-info">
        <p>📧 ${user.email || '未設定'}</p>
      </div>

      <hr>

      <div class="pine-profile-form">
        <label>パスワード変更</label>
        <input type="password" id="pine-new-password" placeholder="新しいパスワード" minlength="6">
        <button class="pine-btn pine-btn-primary" id="pine-change-password-btn">パスワード変更</button>
      </div>
      <hr>

      <div class="pine-profile-form">
        <label>プッシュ通知</label>
        <button class="pine-btn pine-btn-primary" id="pine-push-toggle-btn">通知を有効にする</button>
        <div id="pine-push-status" style="font-size:12px; color:#888; margin-top:6px;"></div>
      </div>

      <hr>

      <button class="pine-btn pine-btn-danger" id="pine-logout-btn">ログアウト</button>
    </div>
  `;

  // Avatar upload
  const avatarInput = document.getElementById('pine-avatar-input');
  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate
    if (!PINE_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      alert('JPEG, PNG, WebPのみ対応しています');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('2MB以下の画像を選択してください');
      return;
    }

    try {
      // Upload to Supabase Storage (avatars bucket or pine-chat)
      const ext = file.name.split('.').pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await pineSupabase.storage
        .from('pine-chat')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;

      // Get public URL
      const { data: urlData } = await pineSupabase.storage
        .from('pine-chat')
        .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year

      const newAvatarUrl = urlData?.signedUrl;
      if (newAvatarUrl) {
        // Update pine_members
        await pineSupabase
          .from('pine_members')
          .update({ avatar_url: newAvatarUrl })
          .eq('id', user.id);

        // Update UI
        document.getElementById('pine-profile-avatar').innerHTML =
          `<img src="${newAvatarUrl}" class="pine-avatar-img">`;
      }
    } catch (err) {
      alert(`アップロードエラー: ${err.message}`);
    }
  });

  // Save display name
  document.getElementById('pine-save-profile-btn').addEventListener('click', async () => {
    const newName = document.getElementById('pine-profile-name').value.trim();
    if (!newName || newName.length > 50) {
      alert('表示名は1〜50文字で入力してください');
      return;
    }
    try {
      await pineSupabase
        .from('pine_members')
        .update({ display_name: newName })
        .eq('id', user.id);
      alert('保存しました');
    } catch (err) {
      alert(`エラー: ${err.message}`);
    }
  });

  // Change password
  document.getElementById('pine-change-password-btn').addEventListener('click', async () => {
    const newPw = document.getElementById('pine-new-password').value;
    if (!newPw || newPw.length < 6) {
      alert('パスワードは6文字以上で入力してください');
      return;
    }
    try {
      await PineAuth.updatePassword(newPw);
      document.getElementById('pine-new-password').value = '';
      alert('パスワードを変更しました');
    } catch (err) {
      alert(`エラー: ${err.message}`);
    }
  });


  // Push notification toggle
  const pushToggleBtn = document.getElementById('pine-push-toggle-btn');
  const pushStatus = document.getElementById('pine-push-status');

  async function updatePushUI() {
    try {
      if (!('PushManager' in window)) {
        pushToggleBtn.textContent = '非対応ブラウザ';
        pushToggleBtn.disabled = true;
        pushStatus.textContent = 'このブラウザはプッシュ通知に対応していません';
        return;
      }
      const subscribed = await PushService.isSubscribed();
      if (subscribed) {
        pushToggleBtn.textContent = '通知を無効にする';
        pushToggleBtn.className = 'pine-btn pine-btn-danger';
        pushStatus.textContent = ' プッシュ通知は有効です';
      } else {
        pushToggleBtn.textContent = '通知を有効にする';
        pushToggleBtn.className = 'pine-btn pine-btn-primary';
        pushStatus.textContent = '';
      }
    } catch (e) {
      pushStatus.textContent = 'ステータス確認エラー';
    }
  }
  updatePushUI();

  pushToggleBtn.addEventListener('click', async () => {
    pushToggleBtn.disabled = true;
    try {
      const subscribed = await PushService.isSubscribed();
      if (subscribed) {
        await PushService.unsubscribe();
        pushStatus.textContent = '通知を無効にしました';
      } else {
        await PushService.subscribe();
        pushStatus.textContent = ' 通知を有効にしました';
      }
      await updatePushUI();
    } catch (err) {
      pushStatus.textContent = `エラー: ${err.message}`;
    } finally {
      pushToggleBtn.disabled = false;
    }
  });

  // Logout
  document.getElementById('pine-logout-btn').addEventListener('click', async () => {
    if (!confirm('ログアウトしますか？')) return;
    await PineAuth.signOut();
    location.reload();
  });

  // Back to main
  document.getElementById('pine-profile-back').addEventListener('click', () => {
    document.querySelector('.pine-header').style.display = '';
    document.getElementById('pine-tab-bar').style.display = '';
    location.hash = '/';
  });
}
