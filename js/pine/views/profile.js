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

  // Logout
  document.getElementById('pine-logout-btn').addEventListener('click', async () => {
    if (!confirm('ログアウトしますか？')) return;
    await PineAuth.signOut();
    location.reload();
  });
}
