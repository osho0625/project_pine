// Pine Room Service — wraps Supabase RPCs for chat room management
const RoomService = {
  async createRoom(name, memberIds) {
    const { data, error } = await pineSupabase.rpc('create_chat_room', {
      p_name: name,
      p_member_ids: memberIds,
      p_is_group: true,
    });
    if (error) throw error;
    return data;
  },

  async getOrCreateDM(memberId) {
    const { data, error } = await pineSupabase.rpc('get_or_create_dm_room', {
      p_other_member_id: memberId,
    });
    if (error) throw error;
    return data;
  },

  async leaveRoom(roomId) {
    const { data, error } = await pineSupabase.rpc('leave_chat_room', {
      p_room_id: roomId,
    });
    if (error) throw error;
    return data;
  },

  async deleteRoom(roomId) {
    const { data, error } = await pineSupabase.rpc('delete_chat_room', {
      p_room_id: roomId,
    });
    if (error) throw error;
    return data;
  },

  async transferOwnership(roomId, newOwnerId) {
    const { data, error } = await pineSupabase.rpc('transfer_room_ownership', {
      p_room_id: roomId,
      p_new_owner_id: newOwnerId,
    });
    if (error) throw error;
    return data;
  },

  async addMember(roomId, memberId) {
    const { data, error } = await pineSupabase.rpc('add_room_member', {
      p_room_id: roomId,
      p_member_id: memberId,
    });
    if (error) throw error;
    return data;
  },

  async removeMember(roomId, memberId) {
    const { data, error } = await pineSupabase.rpc('remove_room_member', {
      p_room_id: roomId,
      p_member_id: memberId,
    });
    if (error) throw error;
    return data;
  },

  async renameRoom(roomId, newName) {
    const { data, error } = await pineSupabase.rpc('rename_chat_room', {
      p_room_id: roomId,
      p_new_name: newName,
    });
    if (error) throw error;
    return data;
  },

  async getRoomList() {
    const { data: { user } } = await pineSupabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await pineSupabase
      .from('pine_chat_rooms')
      .select(`
        id,
        name,
        is_group,
        created_at,
        pine_chat_room_members!inner(member_id, left_at),
        last_message:pine_messages(
          id,
          content,
          message_type,
          created_at,
          sender_id
        )
      `)
      .eq('pine_chat_room_members.member_id', user.id)
      .is('pine_chat_room_members.left_at', null)
      .is('deleted_at', null)
      .order('created_at', { referencedTable: 'pine_messages', ascending: false })
      .limit(1, { referencedTable: 'pine_messages' });

    if (error) throw error;

    // Fetch unread counts
    const { data: readStatuses } = await pineSupabase
      .from('pine_read_status')
      .select('chat_room_id, last_read_message_id')
      .eq('member_id', user.id);

    const readMap = {};
    if (readStatuses) {
      for (const rs of readStatuses) {
        readMap[rs.chat_room_id] = rs.last_read_message_id;
      }
    }

    // Format rooms with last message preview and unread count
    const rooms = (data || []).map((room) => {
      const lastMsg = room.last_message && room.last_message.length > 0
        ? room.last_message[0]
        : null;
      return {
        id: room.id,
        name: room.name,
        is_group: room.is_group,
        created_at: room.created_at,
        last_message: lastMsg,
        last_read_message_id: readMap[room.id] || null,
        unread_count: 0, // Will be calculated client-side if needed
      };
    });

    // Sort by last message time (most recent first)
    rooms.sort((a, b) => {
      const aTime = a.last_message ? a.last_message.created_at : a.created_at;
      const bTime = b.last_message ? b.last_message.created_at : b.created_at;
      return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
    });

    return rooms;
  },
};
