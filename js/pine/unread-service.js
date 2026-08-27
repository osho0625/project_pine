// Pine Unread Service — manages per-room unread counts and PWA badge
const UnreadService = {
  async getUnreadCounts() {
    const { data: { user } } = await pineSupabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Fetch user's read statuses
    const { data: readStatuses, error: rsErr } = await pineSupabase
      .from('pine_read_status')
      .select('chat_room_id, last_read_at, last_read_message_id')
      .eq('member_id', user.id);

    if (rsErr) throw rsErr;

    // Fetch user's memberships to get joined_at per room
    const { data: memberships, error: memErr } = await pineSupabase
      .from('pine_chat_room_members')
      .select('chat_room_id, joined_at')
      .eq('member_id', user.id)
      .is('left_at', null);

    if (memErr) throw memErr;

    const readMap = {};
    for (const rs of readStatuses || []) {
      readMap[rs.chat_room_id] = rs;
    }

    const counts = {};
    for (const mem of memberships || []) {
      const roomId = mem.chat_room_id;
      const readStatus = readMap[roomId];

      // Build query: messages in room, not from self, created after joined_at
      let query = pineSupabase
        .from('pine_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_room_id', roomId)
        .neq('sender_id', user.id)
        .gte('created_at', mem.joined_at);

      // If read status exists, only count messages after last_read_at
      if (readStatus && readStatus.last_read_at) {
        query = query.gt('created_at', readStatus.last_read_at);
      }

      const { count, error: cErr } = await query;
      if (cErr) {
        counts[roomId] = 0;
        continue;
      }
      counts[roomId] = count || 0;
    }

    return counts;
  },

  async markAsRead(roomId, messageId) {
    const { data: { user } } = await pineSupabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await pineSupabase
      .from('pine_read_status')
      .upsert({
        member_id: user.id,
        chat_room_id: roomId,
        last_read_message_id: messageId,
        last_read_at: new Date().toISOString(),
      }, { onConflict: 'member_id,chat_room_id' });

    if (error) throw error;
  },

  clearBadge() {
    if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(() => {});
    }
  },

  updateBadge(count) {
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        navigator.setAppBadge(count).catch(() => {});
      } else {
        this.clearBadge();
      }
    }
  },
};
