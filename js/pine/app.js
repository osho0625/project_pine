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
        <button type="submit" class="pine-btn pine-btn-primary">ログインリンクを送信</button>
      </form>
      <div id="otp-section" style="display:none;">
        <p style="color: var(--pine-green-dark); font-weight: 600;">✉️ メールをチェックしてください</p>
        <p style="font-size: 13px; color: #666;">ログインリンクを送信しました。メール内のリンクをクリックするとログインできます。</p>
      </div>
      <div id="login-error" class="pine-error" style="display:none;"></div>
      <div id="login-success" class="pine-success" style="display:none;"></div>
      <hr style="margin: 20px 0;">
      <p style="font-size: 13px; color: #888;">招待リンクをお持ちの方は、リンクから直接参加できます。</p>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';

    try {
      await PineAuth.signInWithOtp(email);
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

  const tabBar = document.getElementById('pine-tab-bar');
  const addBtn = document.getElementById('pine-add-btn');
  let activeTab = 'friends';

  // Tab bar helper
  function showTabBar() {
    tabBar.classList.remove('pine-hide-tabs');
    document.body.classList.remove('pine-hide-tabs');
  }

  function hideTabBar() {
    tabBar.classList.add('pine-hide-tabs');
    document.body.classList.add('pine-hide-tabs');
  }

  function setActiveTab(tab) {
    activeTab = tab;
    const tabs = tabBar.querySelectorAll('.pine-tab');
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
  }

  function renderActiveTab() {
    showTabBar();
    if (activeTab === 'friends') {
      renderFriendsList(container);
    } else {
      renderRoomList(container);
    }
  }

  // Tab click handlers
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.pine-tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    if (tabName === activeTab) return;
    setActiveTab(tabName);
    location.hash = '';
    renderActiveTab();
  });

  // + button → invite
  addBtn.addEventListener('click', () => {
    location.hash = 'invite';
  });

  // Setup router
  const router = new PineRouter();

  router.on('/', () => {
    renderActiveTab();
  });

  router.on('room/:id', (params) => {
    hideTabBar();
    renderChatRoom(container, params.id);
    PresenceService.enterRoom(params.id);
  });

  router.on('call/:id', (params) => {
    hideTabBar();
    renderCallScreen(container, params.id, 'caller');
  });

  router.on('invite', () => {
    hideTabBar();
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
