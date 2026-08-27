// Pine Presence Service — manages active_room_id and last_seen_at via RPC
const PresenceService = {
  _heartbeatTimer: null,
  _currentRoomId: null,

  async enterRoom(roomId) {
    this._currentRoomId = roomId;
    const { error } = await pineSupabase.rpc('update_presence', {
      p_room_id: roomId,
    });
    if (error) throw error;
  },

  async leaveRoom() {
    this._currentRoomId = null;
    const { error } = await pineSupabase.rpc('update_presence', {
      p_room_id: null,
    });
    if (error) throw error;
  },

  startHeartbeat() {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      try {
        await pineSupabase.rpc('update_presence', {
          p_room_id: this._currentRoomId,
        });
      } catch (e) {
        // Heartbeat failures are non-critical, silently ignore
      }
    }, PINE_CONFIG.HEARTBEAT_INTERVAL);
  },

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  _handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // Entering background — report no active room
      pineSupabase.rpc('update_presence', { p_room_id: null }).catch(() => {});
    } else if (document.visibilityState === 'visible') {
      // Returning to foreground — restore active room
      if (this._currentRoomId) {
        pineSupabase.rpc('update_presence', { p_room_id: this._currentRoomId }).catch(() => {});
      }
    }
  },

  init() {
    document.addEventListener('visibilitychange', () => this._handleVisibilityChange());
    this.startHeartbeat();
  },

  destroy() {
    this.stopHeartbeat();
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
  },
};
