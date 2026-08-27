// Pine Call Service — WebRTC 1-on-1 call lifecycle management
const CallService = {
  _pc: null,
  _channel: null,
  _sessionId: null,
  _localStream: null,
  _remoteStream: null,
  _iceCandidateBuffer: [],
  _remoteDescriptionSet: false,
  _timeoutTimer: null,
  _state: 'idle', // idle, calling, connecting, connected, ended, failed
  _onStateChange: null,
  _onRemoteStream: null,
  _onIncomingCall: null,
  _incomingCallSubscription: null,

  // ===== 11.1.1 WebRTC base setup =====

  async _fetchTurnCredentials() {
    const { data: { session } } = await pineSupabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const resp = await fetch(
      `${PINE_CONFIG.SUPABASE_URL}/functions/v1/turn-credentials`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!resp.ok) throw new Error('Failed to fetch TURN credentials');
    return resp.json();
  },

  async _createPeerConnection(turnCredentials) {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    };

    // Add TURN servers from credentials
    if (turnCredentials && turnCredentials.urls) {
      config.iceServers.push({
        urls: turnCredentials.urls,
        username: turnCredentials.username,
        credential: turnCredentials.credential,
      });
    }

    const pc = new RTCPeerConnection(config);

    // ICE candidate handling (11.1.3)
    pc.onicecandidate = (event) => {
      if (event.candidate && this._channel) {
        this._channel.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: event.candidate },
        });
      }
    };

    // Connection state change (mark_call_connected / fail_call)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this._onConnected();
      } else if (pc.connectionState === 'failed') {
        this._onIceFailure();
      }
    };

    // Remote stream handling
    pc.ontrack = (event) => {
      if (!this._remoteStream) {
        this._remoteStream = new MediaStream();
      }
      this._remoteStream.addTrack(event.track);
      if (this._onRemoteStream) {
        this._onRemoteStream(this._remoteStream);
      }
    };

    this._pc = pc;
    return pc;
  },

  async _getLocalMedia() {
    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
    } catch (err) {
      // Fallback to audio-only if video not available
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }
    // Add tracks to peer connection
    if (this._pc && this._localStream) {
      for (const track of this._localStream.getTracks()) {
        this._pc.addTrack(track, this._localStream);
      }
    }
    return this._localStream;
  },

  // ===== 11.1.2 Signaling via Realtime Broadcast =====

  _subscribeChannel(sessionId) {
    this._channel = pineSupabase.channel(`call:${sessionId}`, {
      config: { private: true, broadcast: { self: false } },
    });

    this._channel.on('broadcast', { event: 'ready' }, () => {
      this._onReadyReceived();
    });

    this._channel.on('broadcast', { event: 'offer' }, (msg) => {
      this._onOfferReceived(msg.payload);
    });

    this._channel.on('broadcast', { event: 'answer' }, (msg) => {
      this._onAnswerReceived(msg.payload);
    });

    this._channel.on('broadcast', { event: 'ice-candidate' }, (msg) => {
      this._onIceCandidateReceived(msg.payload);
    });

    this._channel.on('broadcast', { event: 'call-ended' }, () => {
      this._onRemoteEnded();
    });

    this._channel.subscribe();
  },

  async _onReadyReceived() {
    // Caller: callee is ready, now create and send offer
    if (this._state !== 'calling') return;
    this._setState('connecting');

    await this._getLocalMedia();

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);

    this._channel.send({
      type: 'broadcast',
      event: 'offer',
      payload: { sdp: offer },
    });
  },

  async _onOfferReceived(payload) {
    // Callee: receive offer, create answer
    if (!this._pc) return;

    await this._pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    this._remoteDescriptionSet = true;
    this._flushIceCandidateBuffer();

    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);

    this._channel.send({
      type: 'broadcast',
      event: 'answer',
      payload: { sdp: answer },
    });
  },

  async _onAnswerReceived(payload) {
    // Caller: receive answer
    if (!this._pc) return;

    await this._pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    this._remoteDescriptionSet = true;
    this._flushIceCandidateBuffer();
  },

  // ===== 11.1.3 ICE candidate handling =====

  _onIceCandidateReceived(payload) {
    if (!this._pc) return;

    if (!this._remoteDescriptionSet) {
      // Buffer candidates until setRemoteDescription completes
      this._iceCandidateBuffer.push(payload.candidate);
    } else {
      this._pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    }
  },

  _flushIceCandidateBuffer() {
    for (const candidate of this._iceCandidateBuffer) {
      this._pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
    this._iceCandidateBuffer = [];
  },

  // ===== 11.1.4 Call lifecycle management =====

  async startCall(roomId) {
    this._reset();

    // RPC start_call
    const { data, error } = await pineSupabase.rpc('start_call', { p_room_id: roomId });
    if (error) throw error;

    if (data.status === 'busy') {
      this._setState('busy');
      return { status: 'busy' };
    }

    this._sessionId = data.session_id;
    this._setState('calling');

    // Fetch TURN credentials and create peer connection
    const turnCreds = await this._fetchTurnCredentials();
    await this._createPeerConnection(turnCreds);

    // Subscribe to broadcast channel, wait for callee 'ready' signal
    this._subscribeChannel(this._sessionId);

    // Start 30s timeout
    this._startTimeout();

    return { status: 'ok', sessionId: this._sessionId };
  },

  async handleIncomingCall(sessionId) {
    this._reset();
    this._sessionId = sessionId;

    // Fetch TURN credentials and create peer connection
    const turnCreds = await this._fetchTurnCredentials();
    await this._createPeerConnection(turnCreds);

    // Get local media before sending ready
    await this._getLocalMedia();

    // Subscribe to broadcast channel
    this._subscribeChannel(sessionId);

    // Accept call via RPC
    const { error } = await pineSupabase.rpc('accept_call', { p_session_id: sessionId });
    if (error) throw error;

    this._setState('connecting');

    // Send 'ready' signal so caller knows to create offer
    this._channel.send({
      type: 'broadcast',
      event: 'ready',
      payload: {},
    });
  },

  async rejectCall(sessionId) {
    const { error } = await pineSupabase.rpc('reject_call', { p_session_id: sessionId });
    if (error) throw error;
    this._setState('ended');
    this._cleanup();
  },

  async cancelCall() {
    if (!this._sessionId) return;
    const { error } = await pineSupabase.rpc('cancel_call', { p_session_id: this._sessionId });
    if (error) console.warn('cancel_call error:', error);
    this._broadcastEnded();
    this._setState('ended');
    this._cleanup();
  },

  async endCall() {
    if (!this._sessionId) return;
    const { error } = await pineSupabase.rpc('end_call', { p_session_id: this._sessionId });
    if (error) console.warn('end_call error:', error);
    this._broadcastEnded();
    this._setState('ended');
    this._cleanup();
  },

  async _failCall() {
    if (!this._sessionId) return;
    const { error } = await pineSupabase.rpc('fail_call', { p_session_id: this._sessionId });
    if (error) console.warn('fail_call error:', error);
    this._broadcastEnded();
    this._setState('failed');
    this._cleanup();
  },

  async _onConnected() {
    if (this._state === 'connected') return; // idempotent
    this._clearTimeout();
    this._setState('connected');

    // mark_call_connected RPC
    if (this._sessionId) {
      await pineSupabase.rpc('mark_call_connected', { p_session_id: this._sessionId }).catch(() => {});
    }
  },

  _onIceFailure() {
    this._failCall();
  },

  _onRemoteEnded() {
    this._setState('ended');
    this._cleanup();
  },

  _broadcastEnded() {
    if (this._channel) {
      this._channel.send({
        type: 'broadcast',
        event: 'call-ended',
        payload: {},
      });
    }
  },

  // ===== 11.1.5 Timeout and error handling =====

  _startTimeout() {
    this._clearTimeout();
    this._timeoutTimer = setTimeout(() => {
      if (this._state === 'calling') {
        this.cancelCall();
        this._setState('timeout');
      }
    }, 30000);
  },

  _clearTimeout() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  },

  // beforeunload handler
  _beforeUnloadHandler: null,

  _setupBeforeUnload() {
    this._beforeUnloadHandler = () => {
      if (this._sessionId && ['connecting', 'connected'].includes(this._state)) {
        // Best-effort end_call (may not complete)
        navigator.sendBeacon && pineSupabase.rpc('end_call', { p_session_id: this._sessionId });
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);
  },

  _removeBeforeUnload() {
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
  },

  // ===== 11.1.6 Media controls =====

  toggleMute() {
    if (!this._localStream) return false;
    const audioTrack = this._localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true = muted
    }
    return false;
  },

  toggleCamera() {
    if (!this._localStream) return false;
    const videoTrack = this._localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // true = camera off
    }
    return false;
  },

  getLocalStream() {
    return this._localStream;
  },

  getRemoteStream() {
    return this._remoteStream;
  },

  // ===== State management =====

  _setState(state) {
    this._state = state;
    if (this._onStateChange) {
      this._onStateChange(state);
    }
  },

  getState() {
    return this._state;
  },

  getSessionId() {
    return this._sessionId;
  },

  onStateChange(callback) {
    this._onStateChange = callback;
  },

  onRemoteStream(callback) {
    this._onRemoteStream = callback;
  },

  // ===== Incoming call detection =====

  onIncomingCall(callback) {
    this._onIncomingCall = callback;
  },

  subscribeIncomingCalls() {
    // Unsubscribe existing before re-subscribing
    this.unsubscribeIncomingCalls();

    // Listen for call_sessions INSERT where I am the callee
    this._incomingCallSubscription = pineSupabase
      .channel('incoming-calls-' + Date.now())
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pine_call_sessions',
        },
        async (payload) => {
          const session = payload.new;
          const { data: { user } } = await pineSupabase.auth.getUser();
          if (user && session.callee_id === user.id && session.status === 'calling') {
            if (this._onIncomingCall) {
              this._onIncomingCall(session);
            }
          }
        }
      )
      .subscribe();
  },

  unsubscribeIncomingCalls() {
    if (this._incomingCallSubscription) {
      this._incomingCallSubscription.unsubscribe();
      this._incomingCallSubscription = null;
    }
  },

  // ===== Cleanup / Reset =====

  _cleanup() {
    this._clearTimeout();
    this._removeBeforeUnload();

    if (this._localStream) {
      for (const track of this._localStream.getTracks()) {
        track.stop();
      }
      this._localStream = null;
    }

    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }

    if (this._channel) {
      this._channel.unsubscribe();
      this._channel = null;
    }

    this._remoteStream = null;
    this._iceCandidateBuffer = [];
    this._remoteDescriptionSet = false;
  },

  _reset() {
    this._cleanup();
    this._sessionId = null;
    this._state = 'idle';
  },

  init() {
    this._setupBeforeUnload();
    this.subscribeIncomingCalls();
  },
};
