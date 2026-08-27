// Pine App — Main initialization
(async function initPineApp() {
  const container = document.getElementById('app-container');

  // Initialize IndexedDB
  await PineOfflineStore.init();
  PineOfflineStore.recoverStuckItems();

  // Listen for auth changes (must register before checking session)
  PineAuth.onAuthChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      renderLoginScreen(container);
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      startAuthenticatedApp(container);
    }
  });

  // Check auth state
  const session = await PineAuth.getSession();

  if (!session) {
    renderLoginScreen(container);
    return;
  }

  // Authenticated — start the app
  startAuthenticatedApp(container);
})();

function renderLoginScreen(container) {
  // Hide tab bar and header actions during login
  const tabBar = document.getElementById('pine-tab-bar');
  if (tabBar) tabBar.style.display = 'none';
  const header = document.querySelector('.pine-header');
  if (header) header.style.display = 'none';

  // User list for password-only login
  const users = [
    { name: 'りょうすけ', email: 'd29.ll.tennis@gmail.com' },
    { name: 'めぐみ', email: 'toppo5526@gmail.com' },
    { name: 'はるちか', email: 'dazanyo860@bangban.uk' },
    { name: 'いろは', email: 'zinufedo947@mama3.org' },
    { name: 'かいせい', email: 'yokyanokyo@usagica.com' },
  ];

  const options = users.map(u => `<option value="${u.email}">${u.name}</option>`).join('');

  container.innerHTML = `
    <div class="pine-invite-panel">
      <h2>🍍 Pine</h2>
      <p>家族チャットアプリ</p>
      <form id="login-form" class="pine-invite-form">
        <label for="login-user">ユーザー</label>
        <select id="login-user" class="pine-select">
          ${options}
        </select>
        <label for="login-password">パスワード</label>
        <input type="password" id="login-password" placeholder="パスワード" required />
        <button type="submit" class="pine-btn pine-btn-primary">ログイン</button>
      </form>
      <div id="login-error" class="pine-error" style="display:none;"></div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-user').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';

    try {
      await PineAuth.signInWithPassword(email, password);
      // Directly start the app (don't wait for auth listener)
      startAuthenticatedApp(container);
    } catch (err) {
      errorEl.textContent = `ログインに失敗しました: ${err.message}`;
      errorEl.style.display = 'block';
    }
  });
}
      errorEl.textContent = `ログインに失敗しました: ${err.message}`;
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
    } else if (activeTab === 'chats') {
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

  // + button → invite modal
  addBtn.addEventListener('click', () => {
    const modal = document.getElementById('pine-invite-modal');
    const modalContent = document.getElementById('pine-invite-modal-content');
    modalContent.innerHTML = '<button class="pine-modal-close" id="pine-modal-close-btn">×</button>';
    renderInviteView(modalContent);
    modal.style.display = 'flex';

    // Close modal
    document.getElementById('pine-modal-close-btn').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  });

  // Settings button → profile view
  const settingsBtn = document.getElementById('pine-settings-btn');
  settingsBtn.addEventListener('click', () => {
    hideTabBar();
    document.querySelector('.pine-header').style.display = 'none';
    document.getElementById('pine-tab-bar').style.display = 'none';
    renderProfileView(container);
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
