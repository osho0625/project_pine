// Pine Service Worker
const CACHE_NAME = 'pine-v1';
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const STATIC_ASSETS = [
  `${BASE_PATH}/pages/pine.html`,
  `${BASE_PATH}/css/pine.css`,
  `${BASE_PATH}/js/pine/config.js`,
  `${BASE_PATH}/js/pine/supabase-client.js`,
  `${BASE_PATH}/js/pine/router.js`,
  `${BASE_PATH}/js/pine/auth-service.js`,
  `${BASE_PATH}/js/pine/offline-store.js`,
  `${BASE_PATH}/js/pine/room-service.js`,
  `${BASE_PATH}/js/pine/message-service.js`,
  `${BASE_PATH}/js/pine/call-service.js`,
  `${BASE_PATH}/js/pine/push-service.js`,
  `${BASE_PATH}/js/pine/presence-service.js`,
  `${BASE_PATH}/js/pine/unread-service.js`,
  `${BASE_PATH}/js/pine/storage-service.js`,
  `${BASE_PATH}/js/pine/views/room-list.js`,
  `${BASE_PATH}/js/pine/views/chat-room.js`,
  `${BASE_PATH}/js/pine/views/call-screen.js`,
  `${BASE_PATH}/js/pine/views/invite.js`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/images/pine-icon-192.png`,
  `${BASE_PATH}/images/pine-icon-512.png`,
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for static, passthrough for API (NO API CACHING)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API requests (Supabase, Edge Functions, external services)
  if (
    url.hostname !== self.location.hostname ||
    url.pathname.includes('/rest/') ||
    url.pathname.includes('/auth/') ||
    url.pathname.includes('/functions/') ||
    url.pathname.includes('/realtime/') ||
    url.pathname.includes('/storage/')
  ) {
    return; // Let the browser handle it normally (passthrough)
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful same-origin responses
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Push: show notification and update badge
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  event.waitUntil(
    (async () => {
      // Update badge with feature detection
      if ('setAppBadge' in navigator) {
        await navigator.setAppBadge(payload.unread_count || 0).catch(() => {});
      }

      // Show notification
      await self.registration.showNotification(payload.title || 'Pine 🍍', {
        body: payload.body || '',
        icon: `${BASE_PATH}/images/pine-icon-192.png`,
        badge: `${BASE_PATH}/images/pine-icon-192.png`,
        data: { room_id: payload.room_id },
        tag: `pine-room-${payload.room_id}`,
      });
    })()
  );
});

// NotificationClick: focus existing window or open new
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const roomId = event.notification.data && event.notification.data.room_id;
  const targetUrl = `${BASE_PATH}/pages/pine.html#room/${roomId}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing Pine window if open
      for (const client of windowClients) {
        if (client.url.includes('/pages/pine.html') && 'focus' in client) {
          client.postMessage({ type: 'navigate', room_id: roomId });
          return client.focus();
        }
      }
      // No existing window — open new
      return clients.openWindow(targetUrl);
    })
  );
});
