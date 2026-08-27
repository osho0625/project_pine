// Pine App — Main initialization
(async function initPineApp() {
  const container = document.getElementById('app-container');

  // Initialize IndexedDB
  await PineOfflineStore.init();
  PineOfflineStore.recoverStuckItems();

  // Check auth state
  const session = await PineAuth.getSession();

  if (!session) {
    renderLoginScreen(container);
    return;
  }

  // Authenticated — start the app
  startAuthenticatedApp(container);

  // Listen for auth changes
  PineAuth.onAuthChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      renderLoginScreen(container);
    } else if (event === 'SIGNED_IN') {
      startAuthenticatedApp(container);
    }
  });
})();

function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="pine-invite-panel">
      <h2>🍍 Pine</h2>
      <p>家族チャットアプリ</p>
      <form id="login-form" class="pine-invite-form">
        <label for="login-email">メールアドレス</label>
        <input type="email" id="login-email" placeholder="you@example.com" required />
        <button type="submit" class="pine-btn pine-btn-primary">ログイン (OTP)</button>
      </form>
      <div id="otp-section" style="display:none;">
        <label for="otp-input">確認コード (メールに届きます)</label>
        <input type="text" id="otp-input" placeholder="123456" maxlength="6" />
        <button id="otp-verify-btn" class="pine-btn pine-btn-primary">確認</button>
      </div>
      <div id="login-error" class="pine-error" style="display:none;"></div>
      <div id="login-success" class="pine-success" style="display:none;"></div>
      <hr style="margin: 20px 0;">
      <p style="font-size: 13px; color: #888;">招待リンクをお持ちの方は、リンクから直接参加できます。</p>
    </div>
  `;

  let loginEmail = '';

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';

    try {
      await PineAuth.signInWithOtp(email);
      loginEmail = email;
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('otp-section').style.display = 'block';
    } catch (err) {
      errorEl.textContent = `エラー: ${err.message}`;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('otp-verify-btn').addEventListener('click', async () => {
    const otp = document.getElementById('otp-input').value.trim();
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';

    if (!otp) return;

    try {
      await PineAuth.verifyOtp(loginEmail, otp);
      document.getElementById('login-success').textContent = 'ログイン成功！';
      document.getElementById('login-success').style.display = 'block';
      // Auth state change listener will handle the rest
    } catch (err) {
      errorEl.textContent = `エラー: ${err.message}`;
      errorEl.style.display = 'block';
    }
  });
}

function startAuthenticatedApp(container) {
  // Initialize services
  MessageService.init();
  PresenceService.init();
  CallService.init();

  // Setup router
  const router = new PineRouter();

  router.on('/', () => {
    renderRoomList(container);
  });

  router.on('room/:id', (params) => {
    renderChatRoom(container, params.id);
    PresenceService.enterRoom(params.id);
  });

  router.on('call/:id', (params) => {
    renderCallScreen(container, params.id, 'caller');
  });

  router.on('invite', () => {
    renderInviteView(container);
  });

  // Handle invite code in URL
  const hash = location.hash;
  if (hash.includes('invite?code=')) {
    const code = hash.split('code=')[1];
    if (code) {
      renderInviteView(container);
      return;
    }
  }

  router.start();

  // Handle incoming calls
  CallService.onIncomingCall((session) => {
    if (confirm(`📞 ${session.caller_id.substring(0, 8)} から着信中...応答しますか？`)) {
      location.hash = `call/${session.id}`;
      renderCallScreen(container, session.id, 'callee');
    }
  });

  // Listen for navigation messages from Service Worker
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'navigate' && event.data.room_id) {
      location.hash = `room/${event.data.room_id}`;
    }
  });
}
