(function () {
  const els = {};
  let bootstrap = null;
  let peer = null;
  let stream = null;
  let videoSender = null;
  let currentSource = null;
  let currentQuality = 'high';
  let stopping = false;
  let syntheticTimer = null;
  let autoAcceptRequested = false;
  const inputChannels = new Map();
  const inputRate = new Map();
  let mode = 'view';
  let paused = false;
  let inputPermissionIntentToken = null;

  window.addEventListener('DOMContentLoaded', () => {
    for (const id of [
      'consentView', 'indicatorView', 'requestCopy', 'sourcePicker', 'sourceSelect', 'permissionNote',
      'hostError', 'denyBtn', 'allowBtn', 'liveTitle', 'liveMeta', 'stopBtn',
      'controlPrompt', 'controlRequestCopy', 'denyControlBtn', 'allowControlBtn',
      'inputPermissionPrompt', 'inputPermissionFeedback', 'requestInputPermissionBtn'
    ]) els[id] = document.getElementById(id);
    els.denyBtn.addEventListener('click', () => stop('user-denied'));
    els.allowBtn.addEventListener('click', () => allow());
    els.stopBtn.addEventListener('click', () => stop('local-stop'));
    els.denyControlBtn.addEventListener('click', () => respondControl(false));
    els.allowControlBtn.addEventListener('click', () => respondControl(true));
    els.requestInputPermissionBtn.addEventListener('click', () => requestInputPermission());
    window.remoteHost.onCommand((command) => handleCommand(command));
    window.remoteHost.onControlRequest(() => showControlPrompt());
    window.remoteHost.onMode((value) => applyMode(value));
    window.remoteHost.onClose(() => cleanup());
    window.remoteHost.onAutoAccept(() => {
      autoAcceptRequested = true;
      void allow();
    });
    initialize().catch((error) => showError(safeError(error)));
  });

  async function initialize() {
    bootstrap = await window.remoteHost.bootstrap();
    if (!bootstrap?.ok) throw new Error(bootstrap?.reasonCode || 'remote-host-bootstrap');
    window.I18N.init(bootstrap.lang);
    els.requestCopy.textContent = tr('remote.host.requestFrom', { name: bootstrap.controllerName });
    installDisplays(bootstrap.displays || []);
    els.permissionNote.textContent = permissionText(bootstrap.screenPermission);
    els.permissionNote.dataset.state = bootstrap.screenPermission;
    if (autoAcceptRequested) await allow();
  }

  async function allow() {
    if (!bootstrap || peer || stopping) return;
    els.allowBtn.disabled = true;
    els.denyBtn.disabled = true;
    hideError();
    try {
      if (!(bootstrap.displays || []).length) {
        const authorization = await window.remoteHost.authorizeView();
        if (!authorization?.ok) throw new Error(authorization?.reasonCode || 'remote-view-authorization-failed');
        bootstrap.displays = authorization.displays || [];
        installDisplays(bootstrap.displays);
        bootstrap.screenPermission = authorization.screenPermission || bootstrap.screenPermission;
        els.permissionNote.textContent = permissionText(bootstrap.screenPermission);
        els.permissionNote.dataset.state = bootstrap.screenPermission;
        if (bootstrap.displays.length > 1 && !autoAcceptRequested) {
          els.allowBtn.disabled = false;
          els.denyBtn.disabled = false;
          els.sourceSelect.focus();
          return;
        }
      }
      currentSource = sourceById(els.sourceSelect.value);
      if (!currentSource) throw new Error('remote-display-invalid');
      stream = await capture(currentSource, currentQuality);
      peer = new RTCPeerConnection({ iceServers: bootstrap.iceServers || [] });
      peer.addEventListener('datachannel', (event) => attachInputChannel(event.channel));
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('remote-capture-track-missing');
      videoSender = peer.addTrack(track, stream);
      peer.addEventListener('connectionstatechange', () => {
        if (stopping || !peer) return;
        if (peer.connectionState === 'connected') {
          showIndicator();
          void reportState('viewing');
        } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
          void reportState('error', { reason: `remote-media-${peer.connectionState}` });
          void stop(`remote-media-${peer.connectionState}`);
        }
      });
      await peer.setRemoteDescription(bootstrap.remoteDescription);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIceGathering(peer);
      const result = await window.remoteHost.answer(descriptionOf(peer.localDescription, 'answer'), currentSource.id);
      if (!result?.ok) throw new Error(result?.reasonCode || 'remote-answer-failed');
      showIndicator();
      await reportState('connecting-media');
    } catch (error) {
      cleanupMedia();
      els.allowBtn.disabled = false;
      els.denyBtn.disabled = false;
      showError(safeError(error));
      await reportState('error', { reason: safeError(error) });
    }
  }

  function installDisplays(displays) {
    els.sourceSelect.replaceChildren();
    for (const source of displays) {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = `${source.name} · ${source.width}×${source.height}`;
      els.sourceSelect.append(option);
    }
    els.sourcePicker.hidden = displays.length <= 1;
  }

  async function capture(source, quality) {
    if (bootstrap.syntheticCapture) return syntheticStream(quality);
    const preset = qualityPreset(quality);
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: preset.width,
          maxHeight: preset.height,
          maxFrameRate: preset.frameRate
        }
      }
    });
  }

  function syntheticStream(quality) {
    const preset = qualityPreset(quality);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1280, preset.width);
    canvas.height = Math.min(720, preset.height);
    const context = canvas.getContext('2d');
    let frame = 0;
    const draw = () => {
      context.fillStyle = '#16201d';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#dcb35c';
      context.fillRect((frame * 7) % canvas.width, canvas.height / 2 - 18, 96, 36);
      context.fillStyle = '#f3ead3';
      context.font = '28px sans-serif';
      context.fillText('AgentDesk secure remote view', 42, 58);
      frame += 1;
    };
    draw();
    syntheticTimer = setInterval(draw, Math.max(33, Math.floor(1000 / preset.frameRate)));
    return canvas.captureStream(preset.frameRate);
  }

  async function handleCommand(command = {}) {
    if (!peer || stopping) return;
    try {
      if (command.type === 'pause') {
        paused = true;
        for (const track of stream?.getVideoTracks() || []) track.enabled = false;
        await reportState('paused');
        return;
      }
      if (command.type === 'resume') {
        paused = false;
        for (const track of stream?.getVideoTracks() || []) track.enabled = true;
        await reportState('viewing');
        return;
      }
      if (command.type === 'quality') {
        currentQuality = command.value;
        const track = stream?.getVideoTracks()?.[0];
        const preset = qualityPreset(currentQuality);
        if (track?.applyConstraints) {
          await track.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { max: preset.frameRate, ideal: preset.frameRate }
          }).catch(() => {});
        }
        await reportState(paused ? 'paused' : 'viewing', { quality: currentQuality });
        return;
      }
      if (command.type === 'display') {
        const source = (bootstrap.displays || []).find((item) => item.displayId === command.displayId);
        if (!source) throw new Error('remote-display-invalid');
        const nextStream = await capture(source, currentQuality);
        const nextTrack = nextStream.getVideoTracks()[0];
        if (!nextTrack) throw new Error('remote-capture-track-missing');
        nextTrack.enabled = !paused;
        await videoSender.replaceTrack(nextTrack);
        const previous = stream;
        stream = nextStream;
        currentSource = source;
        for (const track of previous?.getTracks() || []) track.stop();
        updateIndicator();
        await reportState(paused ? 'paused' : 'viewing', { sourceId: source.id });
      }
    } catch (error) {
      await reportState('error', { reason: safeError(error) });
    }
  }

  function attachInputChannel(channel) {
    if (!['input.keys', 'input.motion'].includes(channel.label) || inputChannels.has(channel.label)) {
      channel.close();
      return;
    }
    inputChannels.set(channel.label, channel);
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', async (event) => {
      try {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        if (new TextEncoder().encode(text).byteLength > 16 * 1024) throw new Error('remote-input-size');
        const value = JSON.parse(text);
        rendererInputRate(channel.label, value?.type);
        const result = await window.remoteHost.input(value);
        if (!result?.ok) throw new Error(result?.reasonCode || 'remote-input-rejected');
      } catch (error) {
        await reportState('error', { reason: safeError(error) });
        if (String(error?.message || '').startsWith('remote-input-rate')) channel.close();
      }
    });
    channel.addEventListener('close', () => {
      inputChannels.delete(channel.label);
      void window.remoteHost.input({ type: 'releaseAll' });
    });
  }

  function rendererInputRate(channel, type) {
    const key = `${channel}:${String(type || '')}`;
    const now = performance.now();
    const recent = (inputRate.get(key) || []).filter((time) => now - time < 1_000);
    const limit = channel === 'input.motion' ? 260 : 190;
    if (recent.length >= limit) throw new Error(`remote-input-rate:${channel}`);
    recent.push(now);
    inputRate.set(key, recent);
  }

  function showControlPrompt() {
    inputPermissionIntentToken = null;
    els.inputPermissionPrompt.hidden = true;
    els.controlRequestCopy.textContent = tr('remote.host.controlFrom', { name: bootstrap.controllerName });
    els.controlPrompt.hidden = false;
    els.allowControlBtn.disabled = false;
    els.denyControlBtn.disabled = false;
  }

  async function respondControl(accepted) {
    els.allowControlBtn.disabled = true;
    els.denyControlBtn.disabled = true;
    const result = await window.remoteHost.respondControl(accepted);
    if (!result?.ok) {
      els.allowControlBtn.disabled = false;
      els.denyControlBtn.disabled = false;
      showError(result?.reasonCode || 'remote-control-response-failed');
      return;
    }
    els.controlPrompt.hidden = true;
  }

  function applyMode(value = {}) {
    mode = value.mode === 'control' ? 'control' : 'view';
    els.indicatorView.dataset.mode = mode;
    els.controlPrompt.hidden = true;
    if (value.permissionIntentToken) {
      inputPermissionIntentToken = value.permissionIntentToken;
      els.inputPermissionPrompt.hidden = false;
      els.inputPermissionFeedback.hidden = true;
      els.inputPermissionFeedback.textContent = '';
      els.requestInputPermissionBtn.hidden = false;
      els.requestInputPermissionBtn.disabled = false;
    } else {
      inputPermissionIntentToken = null;
      els.inputPermissionPrompt.hidden = true;
    }
    els.liveTitle.textContent = tr(mode === 'control' ? 'remote.host.controlling' : 'remote.host.viewing');
    updateIndicator();
    if (mode !== 'control') void window.remoteHost.input({ type: 'releaseAll' });
  }

  async function requestInputPermission() {
    const intentToken = inputPermissionIntentToken;
    if (!intentToken) return;
    inputPermissionIntentToken = null;
    els.requestInputPermissionBtn.disabled = true;
    const result = await window.remoteHost.requestInputPermission(intentToken);
    els.requestInputPermissionBtn.hidden = true;
    els.inputPermissionFeedback.hidden = false;
    if (!result?.ok) {
      els.inputPermissionFeedback.dataset.state = 'error';
      els.inputPermissionFeedback.textContent = tr('remote.host.inputPermissionRequestFailed', {
        code: result?.reasonCode || 'input-permission-request-failed'
      });
      return;
    }
    const ready = result.permission === 'granted';
    els.inputPermissionFeedback.dataset.state = ready ? 'granted' : 'requested';
    els.inputPermissionFeedback.textContent = tr(ready
      ? 'remote.host.inputPermissionReady'
      : 'remote.host.inputPermissionRequested');
  }

  async function reportState(state, detail = {}) {
    return window.remoteHost.reportState(state, {
      sourceId: currentSource?.id || null,
      quality: currentQuality,
      ...detail
    });
  }

  async function stop(reason) {
    if (stopping) return;
    stopping = true;
    try { await window.remoteHost.stop(reason); } catch (_error) { /* local stop still wins */ }
    cleanup();
  }

  function showIndicator() {
    els.consentView.hidden = true;
    els.indicatorView.hidden = false;
    updateIndicator();
  }

  function updateIndicator() {
    els.liveTitle.textContent = tr(mode === 'control' ? 'remote.host.controlling' : 'remote.host.viewing');
    els.liveMeta.textContent = tr('remote.host.liveMeta', {
      name: bootstrap.controllerName,
      display: currentSource?.name || '-'
    });
  }

  function showError(code) {
    els.hostError.hidden = false;
    els.hostError.textContent = tr('remote.host.error', { code });
  }

  function hideError() {
    els.hostError.hidden = true;
    els.hostError.textContent = '';
  }

  function sourceById(id) {
    return (bootstrap.displays || []).find((item) => item.id === id) || null;
  }

  function permissionText(status) {
    const key = {
      granted: 'remote.permission.granted',
      denied: 'remote.permission.denied',
      restricted: 'remote.permission.denied',
      'not-determined': 'remote.permission.prompt',
      unknown: 'remote.permission.unknown'
    }[status] || 'remote.permission.unknown';
    return tr(key);
  }

  function qualityPreset(value) {
    if (value === 'thumbnail') return { width: 640, height: 360, frameRate: 2 };
    if (value === 'balanced') return { width: 1280, height: 720, frameRate: 15 };
    return { width: 1920, height: 1080, frameRate: 30 };
  }

  function cleanupMedia() {
    clearInterval(syntheticTimer);
    syntheticTimer = null;
    for (const track of stream?.getTracks?.() || []) track.stop();
    stream = null;
    videoSender = null;
    for (const channel of inputChannels.values()) {
      try { channel.close(); } catch (_error) { /* already closed */ }
    }
    inputChannels.clear();
    void window.remoteHost.input({ type: 'releaseAll' });
    try { peer?.close(); } catch (_error) { /* already closed */ }
    peer = null;
  }

  function cleanup() {
    stopping = true;
    cleanupMedia();
  }

  function waitForIceGathering(connection) {
    if (connection.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('remote-ice-timeout')), 20_000);
      const onState = () => {
        if (connection.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        connection.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      connection.addEventListener('icegatheringstatechange', onState);
    });
  }

  function descriptionOf(value, expected) {
    const sdp = String(value?.sdp || '');
    if (value?.type !== expected || !sdp || new TextEncoder().encode(sdp).byteLength > 256 * 1024) {
      throw new Error('remote-description-invalid');
    }
    return { type: expected, sdp };
  }

  function tr(key, params) {
    return window.I18N?.t(key, params) || key;
  }

  function safeError(error) {
    return String(error?.message || error || 'remote-host-failed')
      .trim().replace(/[^a-z0-9._:-]/gi, '-').slice(0, 120) || 'remote-host-failed';
  }
})();
