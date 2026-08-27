// Pine IndexedDB Offline Store
const PineOfflineStore = {
  db: null,
  DB_NAME: 'pine_db',
  DB_VERSION: 1,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // pine_messages_cache store
        if (!db.objectStoreNames.contains('pine_messages_cache')) {
          const msgStore = db.createObjectStore('pine_messages_cache', { keyPath: 'id' });
          msgStore.createIndex('room_created', ['chat_room_id', 'created_at', 'id']);
          msgStore.createIndex('room_id', 'chat_room_id');
        }

        // pine_outbox store
        if (!db.objectStoreNames.contains('pine_outbox')) {
          const outStore = db.createObjectStore('pine_outbox', { keyPath: 'client_message_id' });
          outStore.createIndex('status', 'status');
          outStore.createIndex('room_id', 'chat_room_id');
        }
      };
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  },

  // Message cache methods
  async cacheMessages(roomId, messages) {
    const tx = this.db.transaction('pine_messages_cache', 'readwrite');
    const store = tx.objectStore('pine_messages_cache');
    for (const msg of messages) {
      store.put(msg);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getCachedMessages(roomId) {
    const tx = this.db.transaction('pine_messages_cache', 'readonly');
    const store = tx.objectStore('pine_messages_cache');
    const index = store.index('room_id');
    const request = index.getAll(roomId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const msgs = request.result || [];
        msgs.sort((a, b) => {
          if (a.created_at === b.created_at) return a.id < b.id ? -1 : 1;
          return a.created_at < b.created_at ? -1 : 1;
        });
        resolve(msgs);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Outbox methods
  async addToOutbox(msg) {
    const tx = this.db.transaction('pine_outbox', 'readwrite');
    const store = tx.objectStore('pine_outbox');
    store.put({ ...msg, updated_at: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getOutboxItems(status) {
    const tx = this.db.transaction('pine_outbox', 'readonly');
    const store = tx.objectStore('pine_outbox');
    const index = store.index('status');
    const request = status ? index.getAll(status) : store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async updateOutboxStatus(clientMessageId, status) {
    const tx = this.db.transaction('pine_outbox', 'readwrite');
    const store = tx.objectStore('pine_outbox');
    const request = store.get(clientMessageId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const item = request.result;
        if (item) {
          item.status = status;
          item.updated_at = new Date().toISOString();
          store.put(item);
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async removeFromOutbox(clientMessageId) {
    const tx = this.db.transaction('pine_outbox', 'readwrite');
    const store = tx.objectStore('pine_outbox');
    store.delete(clientMessageId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  // Stuck recovery: revert items stuck in 'sending' for >5 minutes to 'pending'
  async recoverStuckItems() {
    const items = await this.getOutboxItems('sending');
    const fiveMinAgo = Date.now() - PINE_CONFIG.OUTBOX_STUCK_TIMEOUT;
    for (const item of items) {
      const updatedAt = new Date(item.updated_at).getTime();
      if (updatedAt < fiveMinAgo) {
        await this.updateOutboxStatus(item.client_message_id, 'pending');
      }
    }
  },
};
