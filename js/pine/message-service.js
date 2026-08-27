// Pine Message Service — send, subscribe, history, offline outbox
const MessageService = {
  _subscriptions: {},
  _seenClientIds: new Set(),

  async sendMessage(roomId, content, type = 'text', storagePath = null) {
    const clientMessageId = crypto.randomUUID();

    // If offline, queue to outbox
    if (!navigator.onLine) {
      const optimistic = {
        client_message_id: clientMessageId,
        chat_room_id: roomId,
        content,
        message_type: type,
        storage_path: storagePath,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      await PineOfflineStore.addToOutbox(optimistic);
      return optimistic;
    }

    // Online: call RPC directly
    const { data, error } = await pineSupabase.rpc('send_message', {
      p_room_id: roomId,
      p_client_message_id: clientMessageId,
      p_content: type === 'text' ? content : null,
      p_message_type: type,
      p_storage_path: storagePath,
    });

    if (error) throw error;
    this._seenClientIds.add(clientMessageId);
    return data;
  },

  subscribeMessages(roomId, callback) {
    // Unsubscribe existing subscription for this room
    if (this._subscriptions[roomId]) {
      this._subscriptions[roomId].unsubscribe();
    }

    const channel = pineSupabase
      .channel(`messages:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pine_messages',
          filter: `chat_room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new;
          // Deduplicate by client_message_id
          if (msg.client_message_id && this._seenClientIds.has(msg.client_message_id)) {
            return;
          }
          if (msg.client_message_id) {
            this._seenClientIds.add(msg.client_message_id);
          }
          callback(msg);
        }
      )
      .subscribe();

    this._subscriptions[roomId] = channel;
    return channel;
  },

  unsubscribeMessages(roomId) {
    if (this._subscriptions[roomId]) {
      this._subscriptions[roomId].unsubscribe();
      delete this._subscriptions[roomId];
    }
  },

  async loadHistory(roomId, cursor = null, limit = 50) {
    let query = pineSupabase
      .from('pine_messages')
      .select('*')
      .eq('chat_room_id', roomId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    // Cursor-based pagination: fetch messages older than cursor
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Reverse to chronological order for display
    const messages = (data || []).reverse();

    // Cache in IndexedDB
    if (messages.length > 0) {
      await PineOfflineStore.cacheMessages(roomId, messages);
    }

    // Track seen client_message_ids
    for (const msg of messages) {
      if (msg.client_message_id) {
        this._seenClientIds.add(msg.client_message_id);
      }
    }

    return messages;
  },

  async processOutbox() {
    const pending = await PineOfflineStore.getOutboxItems('pending');

    // Sort by created_at to maintain ordering
    pending.sort((a, b) => {
      if (a.created_at === b.created_at) return 0;
      return a.created_at < b.created_at ? -1 : 1;
    });

    for (const item of pending) {
      await PineOfflineStore.updateOutboxStatus(item.client_message_id, 'sending');

      try {
        const { data, error } = await pineSupabase.rpc('send_message', {
          p_room_id: item.chat_room_id,
          p_client_message_id: item.client_message_id,
          p_content: item.message_type === 'text' ? item.content : null,
          p_message_type: item.message_type,
          p_storage_path: item.storage_path || null,
        });

        if (error) {
          await PineOfflineStore.updateOutboxStatus(item.client_message_id, 'failed');
        } else {
          this._seenClientIds.add(item.client_message_id);
          await PineOfflineStore.removeFromOutbox(item.client_message_id);
        }
      } catch (err) {
        await PineOfflineStore.updateOutboxStatus(item.client_message_id, 'failed');
      }
    }
  },

  // Call on app startup and on reconnect
  init() {
    // Recover stuck outbox items
    PineOfflineStore.recoverStuckItems();

    // Process outbox when coming online
    window.addEventListener('online', () => {
      this.processOutbox();
    });

    // Process any pending items if already online
    if (navigator.onLine) {
      this.processOutbox();
    }
  },
};
