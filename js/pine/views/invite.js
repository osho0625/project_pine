// Pine Invite View — generate and accept invite flows
async function renderInviteView(container) {
  const session = await PineAuth.getSession();

  if (session) {
    // Authenticated user: show generate invite form
    renderGenerateInvite(container);
  } else {
    // Unauthenticated user: check for invite code in URL hash
    const hash = location.hash;
    const codeMatch = hash.match(/invite\/([a-zA-Z0-9_-]+)/);
    if (codeMatch) {
      renderAcceptInvite(container, codeMatch[1]);
    } else {
      renderGenerateInvite(container);
    }
  }
}

function renderGenerateInvite(container) {
  container.innerHTML = `
    <div class="pine-invite-panel">
      <h2>メンバーを招待</h2>
      <form id="invite-form" class="pine-invite-form">
        <label for="invite-email">招待先メールアドレス</label>
        <input type="email" id="invite-email" placeholder="friend@example.com" required />
        <button type="submit" class="pine-btn pine-btn-primary">招待リンクを生成</button>
      </form>
      <div id="invite-result" class="pine-invite-result" style="display:none;"></div>
      <div id="invite-error" class="pine-error" style="display:none;"></div>
    </div>
  `;

  const form = container.querySelector('#invite-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#invite-email').value.trim();
    const resultEl = container.querySelector('#invite-result');
    const errorEl = container.querySelector('#invite-error');

    resultEl.style.display = 'none';
    errorEl.style.display = 'none';

    try {
      const { data, error } = await pineSupabase.functions.invoke('generate-invite', {
        body: { invited_email: email },
      });
      if (error) throw error;

      const inviteUrl = data.invite_url || data.url;
      resultEl.innerHTML = `
        <p>招待リンクが生成されました:</p>
        <input type="text" class="pine-invite-url" value="${inviteUrl}" readonly />
        <button class="pine-btn pine-btn-copy" onclick="navigator.clipboard.writeText('${inviteUrl}')">コピー</button>
      `;
      resultEl.style.display = 'block';
    } catch (err) {
      errorEl.textContent = `エラー: ${err.message || 'リンク生成に失敗しました'}`;
      errorEl.style.display = 'block';
    }
  });
}

function renderAcceptInvite(container, inviteCode) {
  container.innerHTML = `
    <div class="pine-invite-panel">
      <h2>🍍 Pine に参加</h2>
      <p>招待コードを確認しました。メールアドレスを入力してください。</p>
      <form id="accept-form" class="pine-invite-form">
        <label for="accept-email">メールアドレス</label>
        <input type="email" id="accept-email" placeholder="you@example.com" required />
        <button type="submit" class="pine-btn pine-btn-primary">参加する</button>
      </form>
      <div id="accept-otp" style="display:none;">
        <label for="otp-code">確認コード (メールに届きます)</label>
        <input type="text" id="otp-code" placeholder="123456" maxlength="6" />
        <label for="display-name">表示名</label>
        <input type="text" id="display-name" placeholder="あなたの名前" required maxlength="50" />
        <button id="verify-btn" class="pine-btn pine-btn-primary">確認</button>
      </div>
      <div id="accept-error" class="pine-error" style="display:none;"></div>
      <div id="accept-success" class="pine-success" style="display:none;"></div>
    </div>
  `;

  const form = container.querySelector('#accept-form');
  const otpSection = container.querySelector('#accept-otp');
  const errorEl = container.querySelector('#accept-error');
  const successEl = container.querySelector('#accept-success');
  let validatedEmail = '';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#accept-email').value.trim();
    errorEl.style.display = 'none';

    try {
      // Step 1: Validate invite
      const { data, error } = await pineSupabase.functions.invoke('validate-invite', {
        body: { invite_code: inviteCode, email },
      });
      if (error) throw error;

      validatedEmail = email;

      // Step 2: Trigger OTP (client-side)
      await PineAuth.signInWithOtp(email);

      // Show OTP input
      form.style.display = 'none';
      otpSection.style.display = 'block';
    } catch (err) {
      let message = err.message || '招待の確認に失敗しました';
      if (message.includes('expired')) message = 'この招待リンクは期限切れです';
      if (message.includes('used')) message = 'この招待リンクは使用済みです';
      if (message.includes('email') || message.includes('mismatch')) {
        message = 'メールアドレスが招待先と一致しません';
      }
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  });

  // OTP verify
  const verifyBtn = container.querySelector('#verify-btn');
  verifyBtn.addEventListener('click', async () => {
    const otp = container.querySelector('#otp-code').value.trim();
    const displayName = container.querySelector('#display-name').value.trim();
    errorEl.style.display = 'none';

    if (!otp || !displayName) {
      errorEl.textContent = '確認コードと表示名を入力してください';
      errorEl.style.display = 'block';
      return;
    }

    try {
      // Step 3: Verify OTP → authenticated session
      await PineAuth.verifyOtp(validatedEmail, otp);

      // Step 4: Accept invite RPC
      const { error } = await pineSupabase.rpc('accept_invite', {
        p_invite_code: inviteCode,
        p_display_name: displayName,
      });
      if (error) throw error;

      otpSection.style.display = 'none';
      successEl.textContent = '🎉 参加完了！チャットを始めましょう';
      successEl.style.display = 'block';

      // Redirect to room list after short delay
      setTimeout(() => {
        location.hash = '';
      }, 1500);
    } catch (err) {
      errorEl.textContent = `エラー: ${err.message || '参加に失敗しました'}`;
      errorEl.style.display = 'block';
    }
  });
}
