// Pine Call Screen UI — incoming call, active call, status display
function renderCallScreen(container, sessionId, role) {
  // role: 'caller' | 'callee'
  let currentState = role === 'caller' ? 'calling' : 'incoming';
  let isMuted = false;
  let isCameraOff = false;

  container.innerHTML = `
    <div class="pine-call-screen">
      <div class="pine-call-status"></div>
      <div class="pine-call-videos">
        <video class="pine-call-remote-video" autoplay playsinline></video>
        <video class="pine-call-local-video" autoplay playsinline muted></video>
      </div>
      <div class="pine-call-controls" style="display:none;">
        <button class="pine-call-mute-btn" aria-label="マイクミュート">🎤</button>
        <button class="pine-call-camera-btn" aria-label="カメラ切替">📷</button>
        <button class="pine-call-end-btn" aria-label="通話終了">📞</button>
      </div>
      <div class="pine-call-incoming-controls" style="display:none;">
        <button class="pine-call-accept-btn" aria-label="応答">✓ 応答</button>
        <button class="pine-call-reject-btn" aria-label="拒否">✕ 拒否</button>
      </div>
    </div>
  `;

  const statusEl = container.querySelector('.pine-call-status');
  const remoteVideo = container.querySelector('.pine-call-remote-video');
  const localVideo = container.querySelector('.pine-call-local-video');
  const controlsEl = container.querySelector('.pine-call-controls');
  const incomingControlsEl = container.querySelector('.pine-call-incoming-controls');
  const muteBtn = container.querySelector('.pine-call-mute-btn');
  const cameraBtn = container.querySelector('.pine-call-camera-btn');
  const endBtn = container.querySelector('.pine-call-end-btn');
  const acceptBtn = container.querySelector('.pine-call-accept-btn');
  const rejectBtn = container.querySelector('.pine-call-reject-btn');

  function updateUI(state) {
    currentState = state;

    switch (state) {
      case 'calling':
        statusEl.textContent = '発信中...';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'none';
        break;
      case 'incoming':
        statusEl.textContent = '着信中...';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'flex';
        break;
      case 'connecting':
        statusEl.textContent = '接続中...';
        controlsEl.style.display = 'flex';
        incomingControlsEl.style.display = 'none';
        break;
      case 'connected':
        statusEl.textContent = '通話中';
        controlsEl.style.display = 'flex';
        incomingControlsEl.style.display = 'none';
        break;
      case 'ended':
        statusEl.textContent = '通話終了';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'none';
        setTimeout(() => cleanup(), 2000);
        break;
      case 'failed':
        statusEl.textContent = '接続に失敗しました';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'none';
        setTimeout(() => cleanup(), 3000);
        break;
      case 'busy':
        statusEl.textContent = '相手は通話中です';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'none';
        setTimeout(() => cleanup(), 3000);
        break;
      case 'timeout':
        statusEl.textContent = '応答がありません';
        controlsEl.style.display = 'none';
        incomingControlsEl.style.display = 'none';
        setTimeout(() => cleanup(), 3000);
        break;
      default:
        statusEl.textContent = '';
    }
  }

  // Listen to call state changes
  CallService.onStateChange((state) => {
    updateUI(state);
  });

  // Remote stream attachment
  CallService.onRemoteStream((stream) => {
    remoteVideo.srcObject = stream;
  });

  // Attach local video when available
  function attachLocalVideo() {
    const localStream = CallService.getLocalStream();
    if (localStream) {
      localVideo.srcObject = localStream;
    }
  }

  // Mute button
  muteBtn.addEventListener('click', () => {
    isMuted = CallService.toggleMute();
    muteBtn.textContent = isMuted ? '🔇' : '🎤';
    muteBtn.setAttribute('aria-label', isMuted ? 'ミュート解除' : 'マイクミュート');
  });

  // Camera button
  cameraBtn.addEventListener('click', () => {
    isCameraOff = CallService.toggleCamera();
    cameraBtn.textContent = isCameraOff ? '🚫' : '📷';
    cameraBtn.setAttribute('aria-label', isCameraOff ? 'カメラオン' : 'カメラオフ');
  });

  // End call button
  endBtn.addEventListener('click', () => {
    if (currentState === 'calling') {
      CallService.cancelCall();
    } else {
      CallService.endCall();
    }
  });

  // Accept incoming call
  acceptBtn.addEventListener('click', async () => {
    incomingControlsEl.style.display = 'none';
    statusEl.textContent = '接続中...';
    try {
      await CallService.handleIncomingCall(sessionId);
      attachLocalVideo();
    } catch (err) {
      statusEl.textContent = 'エラーが発生しました';
      setTimeout(() => cleanup(), 3000);
    }
  });

  // Reject incoming call
  rejectBtn.addEventListener('click', () => {
    CallService.rejectCall(sessionId);
    cleanup();
  });

  // Start caller flow
  if (role === 'caller') {
    updateUI('calling');
    // Local video is attached after 'ready' signal triggers media acquisition
    // Poll for local stream availability
    const localCheckInterval = setInterval(() => {
      const stream = CallService.getLocalStream();
      if (stream) {
        localVideo.srcObject = stream;
        clearInterval(localCheckInterval);
      }
    }, 500);
  } else {
    updateUI('incoming');
  }

  // Cleanup function — removes call screen from container
  function cleanup() {
    container.innerHTML = '';
  }

  return cleanup;
}
