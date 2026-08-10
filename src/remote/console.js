(function () {
  const sessions = new Map();
  let activeSessionId = null;
  let layoutMode = 'single';
  let layoutPinned = false;
  let statsTimer = null;
  let resizeFrame = null;

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    installRemoteListeners();
    bootstrap().catch((error) => setPathError(safeError(error)));
  });

  function bindElements() {
    for (const id of [
      'targetTabs', 'emptyState', 'videoStack', 'stageBadge', 'stageDeviceName',
      'controlDeck', 'activeDeviceName', 'activeState', 'displaySelect',
      'qualitySelect', 'pauseBtn', 'controlBtn', 'disconnectBtn', 'fullscreenBtn', 'pathDot', 'pathLabel',
      'layoutBtn', 'networkMetrics', 'streamCount', 'streamBudget', 'modeLabel', 'inputCapture'
    ]) els[id] = document.getElementById(id);
  }

  function bindEvents() {
    els.displaySelect.addEventListener('change', () => {
      const session = activeSession();
      if (!session || !els.displaySelect.value) return;
      void sendCommand(session, { type: 'display', displayId: els.displaySelect.value });
    });
    els.qualitySelect.addEventListener('change', () => {
      const session = activeSession();
      if (!session) return;
      session.preferredQuality = els.qualitySelect.value;
      queueQuality(session, session.preferredQuality);
      render();
    });
    els.pauseBtn.addEventListener('click', () => {
      const session = activeSession();
      if (!session) return;
      void sendCommand(session, { type: session.state === 'paused' ? 'resume' : 'pause' });
    });
    els.controlBtn.addEventListener('click', () => {
      const session = activeSession();
      if (!session) return;
      if (session.mode === 'control') void releaseControl(session);
      else void requestControl(session);
    });
    els.disconnectBtn.addEventListener('click', () => {
      const session = activeSession();
      if (session) void window.remoteConsole.disconnect(session.sessionId);
    });
    els.fullscreenBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (_error) {
        // Native fullscreen may be unavailable on some managed desktops.
      }
    });
    els.layoutBtn.addEventListener('click', () => {
      layoutPinned = true;
      layoutMode = layoutMode === 'grid' ? 'single' : 'grid';
      render();
    });
    els.videoStack.addEventListener('pointerdown', handlePointer);
    els.videoStack.addEventListener('pointerup', handlePointer);
    els.videoStack.addEventListener('pointermove', handlePointer);
    els.videoStack.addEventListener('pointercancel', releaseAllInput);
    els.videoStack.addEventListener('lostpointercapture', releaseAllInput);
    els.videoStack.addEventListener('contextmenu', (event) => {
      if (activeSession()?.mode === 'control') event.preventDefault();
    });
    els.videoStack.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('keyup', handleKey, true);
    window.addEventListener('blur', releaseAllInput);
    window.addEventListener('resize', () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        render();
      });
    });
    window.addEventListener('beforeunload', () => {
      clearInterval(statsTimer);
      releaseAllInput();
    });
    els.inputCapture.addEventListener('compositionend', (event) => {
      const session = activeSession();
      if (session?.mode === 'control' && event.data) sendInput(session, { type: 'text', text: event.data }, 'keys');
      els.inputCapture.value = '';
    });
  }

  function installRemoteListeners() {
    window.remoteConsole.onAddTarget(({ target }) => addTarget(target));
    window.remoteConsole.onActivateTarget(({ sessionId }) => setActive(sessionId));
    window.remoteConsole.onAnswer((value) => applyAnswer(value));
    window.remoteConsole.onStatus((value) => updateStatus(value));
    window.remoteConsole.onRemoveTarget(({ sessionId }) => removeTarget(sessionId));
  }

  async function bootstrap() {
    const result = await window.remoteConsole.bootstrap();
    if (!result?.ok) throw new Error(result?.reasonCode || 'remote-console-bootstrap');
    window.I18N.init(result.lang);
    for (const target of result.targets || []) addTarget(target);
    statsTimer = setInterval(() => { void sampleMediaStats(); }, 2_000);
    void sampleMediaStats();
    render();
  }

  function addTarget(target) {
    if (!target?.sessionId || sessions.has(target.sessionId)) {
      if (target?.sessionId) updateStatus(target);
      return;
    }
    const session = {
      ...target,
      state: target.state || 'connecting',
      quality: target.quality || 'high',
      preferredQuality: target.quality === 'thumbnail' ? 'high' : (target.quality || 'high'),
      displays: Array.isArray(target.displays) ? target.displays : [],
      peer: null,
      keyChannel: null,
      motionChannel: null,
      inputChannelsReady: false,
      video: createVideo(target.sessionId),
      stream: null,
      mediaStats: null,
      statsCursor: null,
      desiredQuality: null,
      qualityTask: null,
      offerStarted: false,
      closed: false
    };
    sessions.set(session.sessionId, session);
    if (!activeSessionId) activeSessionId = session.sessionId;
    if (!layoutPinned && sessions.size > 1) layoutMode = 'grid';
    render();
    void startPeer(session);
  }

  function createVideo(sessionId) {
    const panel = document.createElement('section');
    panel.className = 'video-panel';
    panel.dataset.sessionId = sessionId;
    panel.hidden = true;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    const overlay = document.createElement('div');
    overlay.className = 'video-waiting';
    const pulse = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = tr('remote.state.waitingConsent');
    overlay.append(pulse, text);
    const tileHead = document.createElement('button');
    tileHead.type = 'button';
    tileHead.className = 'video-tile-head';
    const tileCopy = document.createElement('span');
    const tileName = document.createElement('strong');
    const tileState = document.createElement('small');
    tileCopy.append(tileName, tileState);
    const tileMetrics = document.createElement('span');
    tileMetrics.className = 'video-tile-metrics';
    tileHead.append(tileCopy, tileMetrics);
    tileHead.addEventListener('click', (event) => {
      event.stopPropagation();
      setActive(sessionId);
    });
    panel.addEventListener('click', () => {
      if (layoutMode === 'grid' && activeSessionId !== sessionId) setActive(sessionId);
    });
    panel.addEventListener('dblclick', () => {
      if (sessions.get(sessionId)?.mode === 'control') return;
      setActive(sessionId);
      layoutPinned = true;
      layoutMode = 'single';
      render();
    });
    panel.append(video, overlay, tileHead);
    els.videoStack.append(panel);
    return { panel, video, overlay, overlayText: text, tileHead, tileName, tileState, tileMetrics };
  }

  async function startPeer(session) {
    if (session.offerStarted || session.closed) return;
    session.offerStarted = true;
    try {
      if (typeof RTCPeerConnection !== 'function') throw new Error('remote-webrtc-unavailable');
      const peer = new RTCPeerConnection({ iceServers: session.iceServers || [] });
      session.peer = peer;
      session.keyChannel = peer.createDataChannel('input.keys', { ordered: true });
      session.motionChannel = peer.createDataChannel('input.motion', { ordered: false, maxRetransmits: 0 });
      for (const channel of [session.keyChannel, session.motionChannel]) {
        channel.addEventListener('open', () => updateInputChannelState(session));
        channel.addEventListener('close', () => updateInputChannelState(session));
        channel.addEventListener('error', () => {
          if (session.mode === 'control') {
            session.reason = `remote-${channel.label}-error`;
            render();
          }
        });
      }
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addEventListener('track', (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        session.stream = stream;
        session.video.video.srcObject = stream;
        void session.video.video.play().catch(() => {});
      });
      peer.addEventListener('connectionstatechange', () => {
        if (session.closed) return;
        if (peer.connectionState === 'connected') {
          session.state = 'viewing';
          session.reason = null;
          void window.remoteConsole.reportState(session.sessionId, 'viewing');
          reconcileStreamBudget();
          render();
        } else if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
          session.state = 'error';
          session.reason = `remote-media-${peer.connectionState}`;
          session.inputChannelsReady = false;
          void window.remoteConsole.reportState(session.sessionId, 'error', session.reason);
          render();
        }
      });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGathering(peer);
      const result = await window.remoteConsole.reportOffer(session.sessionId, descriptionOf(peer.localDescription, 'offer'));
      if (!result?.ok) throw new Error(result?.reasonCode || 'remote-offer-failed');
      session.state = result.session?.state || 'waiting-consent';
      render();
    } catch (error) {
      session.state = 'error';
      session.reason = safeError(error);
      void window.remoteConsole.reportState(session.sessionId, 'error', session.reason);
      render();
    }
  }

  async function applyAnswer(value) {
    const session = sessions.get(String(value.sessionId || ''));
    if (!session?.peer || session.closed) return;
    try {
      session.displays = Array.isArray(value.displays) ? value.displays : [];
      session.displayId = value.displayId || null;
      session.displayName = value.displayName || null;
      await session.peer.setRemoteDescription(value.description);
      session.state = 'connecting-media';
      render();
    } catch (error) {
      session.state = 'error';
      session.reason = safeError(error);
      void window.remoteConsole.reportState(session.sessionId, 'error', session.reason);
      render();
    }
  }

  function updateStatus(value) {
    const session = sessions.get(String(value.sessionId || ''));
    if (!session || session.closed) return;
    for (const key of [
      'state', 'mode', 'controlState', 'inputPermission', 'canControl',
      'quality', 'displayId', 'displayName', 'reason', 'transport'
    ]) {
      if (value[key] !== undefined) session[key] = value[key];
    }
    if (Array.isArray(value.displays)) session.displays = value.displays;
    if (session.mode === 'control' && session.inputChannelsReady !== true) {
      void releaseControl(session);
      return;
    }
    render();
    reconcileStreamBudget();
    if (session.sessionId === activeSessionId && session.mode === 'control') {
      els.inputCapture.focus({ preventScroll: true });
    }
  }

  function removeTarget(sessionId) {
    const session = sessions.get(String(sessionId || ''));
    if (!session) return;
    session.closed = true;
    session.desiredQuality = null;
    session.inputChannelsReady = false;
    try { session.peer?.close(); } catch (_error) { /* already closed */ }
    for (const track of session.stream?.getTracks?.() || []) track.stop();
    session.video.panel.remove();
    sessions.delete(session.sessionId);
    if (activeSessionId === session.sessionId) activeSessionId = sessions.keys().next().value || null;
    if (!layoutPinned && sessions.size <= 1) layoutMode = 'single';
    reconcileStreamBudget();
    render();
  }

  function setActive(sessionId) {
    if (!sessions.has(String(sessionId || ''))) return;
    const previous = activeSession();
    activeSessionId = String(sessionId);
    const next = activeSession();
    if (previous && previous !== next
      && (previous.mode === 'control' || previous.controlState === 'waiting-consent')) {
      void releaseControl(previous);
    }
    reconcileStreamBudget();
    render();
  }

  async function sendCommand(session, command, options = {}) {
    try {
      const result = await window.remoteConsole.command(session.sessionId, command);
      if (!result?.ok) throw new Error(result?.reasonCode || 'remote-command-failed');
      if (command.type === 'pause') session.state = 'paused';
      if (command.type === 'resume') session.state = 'viewing';
      if (command.type === 'quality') session.quality = command.value;
      if (command.type === 'display') session.displayId = command.displayId;
      if (command.type === 'resume') reconcileStreamBudget();
      if (!options.quiet) render();
      return true;
    } catch (error) {
      session.reason = safeError(error);
      if (!options.quiet) render();
      return false;
    }
  }

  async function requestControl(session) {
    if (session.controlState === 'waiting-consent') return;
    try {
      if (session.inputChannelsReady !== true) throw new Error('remote-input-channels-not-ready');
      session.controlState = 'waiting-consent';
      session.reason = null;
      render();
      const result = await window.remoteConsole.requestControl(session.sessionId);
      if (!result?.ok) throw new Error(result?.reasonCode || 'remote-control-request-failed');
      Object.assign(session, result.session || {});
      render();
    } catch (error) {
      session.controlState = 'denied';
      session.reason = safeError(error);
      render();
    }
  }

  async function releaseControl(session) {
    sendInput(session, { type: 'releaseAll' }, 'keys');
    session.mode = 'view';
    session.controlState = 'idle';
    render();
    try {
      const result = await window.remoteConsole.releaseControl(session.sessionId);
      if (!result?.ok) throw new Error(result?.reasonCode || 'remote-control-release-failed');
      Object.assign(session, result.session || {});
    } catch (error) {
      session.reason = safeError(error);
      session.mode = 'view';
      session.controlState = 'idle';
    }
    render();
  }

  function updateInputChannelState(session) {
    const wasReady = session.inputChannelsReady === true;
    session.inputChannelsReady = session.keyChannel?.readyState === 'open'
      && session.motionChannel?.readyState === 'open';
    if (wasReady && !session.inputChannelsReady && session.mode === 'control' && !session.closed) {
      void releaseControl(session);
    }
    render();
  }

  let pendingMotion = null;
  let motionFrame = null;

  function handlePointer(event) {
    if (event.target.closest?.('.video-tile-head')) return;
    const session = activeSession();
    if (!session || session.mode !== 'control') return;
    const point = normalizedVideoPoint(event, session.video.video);
    if (!point) return;
    event.preventDefault();
    if (event.type === 'pointerdown') {
      els.inputCapture.focus({ preventScroll: true });
      try { event.target.setPointerCapture(event.pointerId); } catch (_error) { /* optional */ }
      sendInput(session, { type: 'pointer', action: 'down', button: pointerButton(event.button), ...point }, 'keys');
      return;
    }
    if (event.type === 'pointerup') {
      sendInput(session, { type: 'pointer', action: 'up', button: pointerButton(event.button), ...point }, 'keys');
      return;
    }
    pendingMotion = { session, event: { type: 'pointer', action: 'move', ...point } };
    if (motionFrame) return;
    motionFrame = requestAnimationFrame(() => {
      motionFrame = null;
      if (pendingMotion) sendInput(pendingMotion.session, pendingMotion.event, 'motion');
      pendingMotion = null;
    });
  }

  function handleWheel(event) {
    if (event.target.closest?.('.video-tile-head')) return;
    const session = activeSession();
    if (!session || session.mode !== 'control') return;
    if (!normalizedVideoPoint(event, session.video.video)) return;
    event.preventDefault();
    sendInput(session, {
      type: 'scroll',
      deltaX: Math.max(-4096, Math.min(4096, Math.round(event.deltaX))),
      deltaY: Math.max(-4096, Math.min(4096, Math.round(event.deltaY)))
    }, 'motion');
  }

  function handleKey(event) {
    const session = activeSession();
    if (!session || session.mode !== 'control') return;
    if (isConsoleControl(event.target) && event.target !== els.inputCapture) return;
    if (!event.code || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    sendInput(session, {
      type: 'key',
      action: event.type === 'keydown' ? 'down' : 'up',
      code: event.code,
      key: String(event.key || '').slice(0, 64),
      modifiers: activeModifiers(event),
      repeat: event.repeat === true
    }, 'keys');
  }

  function releaseAllInput() {
    const session = activeSession();
    if (session?.mode === 'control') sendInput(session, { type: 'releaseAll' }, 'keys');
  }

  function sendInput(session, event, kind) {
    const channel = kind === 'motion' ? session.motionChannel : session.keyChannel;
    if (!channel || channel.readyState !== 'open') return false;
    try {
      const text = JSON.stringify(event);
      if (new TextEncoder().encode(text).byteLength > 16 * 1024) throw new Error('remote-input-size');
      const limit = kind === 'motion' ? 256 * 1024 : 1024 * 1024;
      if (channel.bufferedAmount > limit) return false;
      channel.send(text);
      return true;
    } catch (error) {
      session.reason = safeError(error);
      render();
      return false;
    }
  }

  function normalizedVideoPoint(event, video) {
    const rect = video.getBoundingClientRect();
    const sourceWidth = video.videoWidth || rect.width;
    const sourceHeight = video.videoHeight || rect.height;
    if (!rect.width || !rect.height || !sourceWidth || !sourceHeight) return null;
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    if (event.clientX < left || event.clientX > left + width || event.clientY < top || event.clientY > top + height) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - left) / width)),
      y: Math.max(0, Math.min(1, (event.clientY - top) / height))
    };
  }

  function pointerButton(value) {
    if (value === 1) return 'middle';
    if (value === 2) return 'right';
    return 'left';
  }

  function activeModifiers(event) {
    return [
      event.altKey && 'Alt',
      event.ctrlKey && 'Control',
      event.metaKey && 'Meta',
      event.shiftKey && 'Shift'
    ].filter(Boolean);
  }

  function isConsoleControl(target) {
    return target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target instanceof HTMLInputElement;
  }

  function reconcileStreamBudget() {
    const planner = window.RemoteStreamBudget?.planStreamBudget;
    if (typeof planner !== 'function') return;
    const plan = planner([...sessions.values()], activeSessionId);
    for (const item of plan) {
      const session = sessions.get(item.sessionId);
      if (!session) continue;
      session.budgetTier = item.tier;
      if (item.canApply) queueQuality(session, item.desiredQuality);
    }
  }

  function queueQuality(session, quality) {
    if (!session || session.closed || !['high', 'balanced', 'thumbnail'].includes(quality)) return;
    session.desiredQuality = quality;
    if (session.qualityTask || session.quality === quality) return;
    session.qualityTask = (async () => {
      while (!session.closed && session.desiredQuality && session.quality !== session.desiredQuality) {
        const desired = session.desiredQuality;
        const applied = await sendCommand(session, { type: 'quality', value: desired }, { quiet: true });
        if (!applied) break;
      }
    })().finally(() => {
      session.qualityTask = null;
    });
  }

  async function sampleMediaStats() {
    const derive = window.RemoteStreamBudget?.deriveMediaSample;
    if (typeof derive !== 'function') return;
    await Promise.all([...sessions.values()].map(async (session) => {
      if (session.closed || typeof session.peer?.getStats !== 'function') return;
      if (!['connected', 'completed'].includes(session.peer.connectionState)) return;
      try {
        const report = await session.peer.getStats();
        const values = [];
        report.forEach((value) => values.push(value));
        const sample = derive(values, session.statsCursor || {}, Date.now());
        session.statsCursor = sample.cursor;
        session.mediaStats = {
          bitrateKbps: sample.bitrateKbps,
          latencyMs: sample.latencyMs,
          fps: sample.fps,
          lossPercent: sample.lossPercent,
          path: sample.path,
          candidateTypes: sample.candidateTypes,
          protocols: sample.protocols
        };
      } catch (_error) {
        // Media remains usable when aggregate getStats is temporarily unavailable.
      }
    }));
    render();
  }

  function metricsText(session, compact = false) {
    const metrics = session?.mediaStats;
    if (!metrics) return tr('remote.metrics.waiting');
    const parts = [];
    if (Number.isFinite(metrics.latencyMs)) parts.push(`${metrics.latencyMs} ms`);
    if (Number.isFinite(metrics.bitrateKbps)) parts.push(formatBitrate(metrics.bitrateKbps));
    if (Number.isFinite(metrics.fps)) parts.push(`${Math.round(metrics.fps)} fps`);
    if (!compact && Number.isFinite(metrics.lossPercent) && metrics.lossPercent > 0) {
      parts.push(`${metrics.lossPercent}% loss`);
    }
    return parts.length ? parts.join(' · ') : tr('remote.metrics.waiting');
  }

  function formatBitrate(kbps) {
    if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(kbps >= 10_000 ? 0 : 1)} Mb/s`;
    return `${Math.round(kbps)} kb/s`;
  }

  function qualityLabel(value) {
    const quality = ['high', 'balanced', 'thumbnail'].includes(value) ? value : 'high';
    return tr(`remote.quality.${quality}`);
  }

  function render() {
    const active = activeSession();
    els.videoStack.dataset.layout = layoutMode;
    els.videoStack.dataset.count = String(sessions.size);
    els.layoutBtn.setAttribute('aria-pressed', String(layoutMode === 'grid'));
    els.layoutBtn.textContent = layoutMode === 'grid' ? '▣' : '▦';
    els.layoutBtn.title = tr(layoutMode === 'grid' ? 'remote.layout.single' : 'remote.layout.grid');
    els.layoutBtn.disabled = sessions.size < 2;
    els.targetTabs.replaceChildren();
    for (const session of sessions.values()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'target-tab';
      tab.dataset.active = String(session.sessionId === activeSessionId);
      tab.dataset.state = session.state;
      const dot = document.createElement('i');
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = session.deviceName;
      const state = document.createElement('small');
      state.textContent = session.mode === 'control'
        ? tr('remote.control.current')
        : stateText(session);
      copy.append(name, state);
      tab.append(dot, copy);
      tab.addEventListener('click', () => setActive(session.sessionId));
      els.targetTabs.append(tab);
      const isActive = session.sessionId === activeSessionId;
      session.video.panel.hidden = layoutMode === 'single' && !isActive;
      session.video.panel.dataset.active = String(isActive);
      session.video.panel.dataset.mode = session.mode || 'view';
      session.video.overlay.hidden = session.state === 'viewing' || session.state === 'paused';
      session.video.overlayText.textContent = session.reason
        ? tr('remote.state.errorWithCode', { code: session.reason })
        : stateText(session);
      session.video.video.classList.toggle('paused', session.state === 'paused');
      session.video.tileName.textContent = session.deviceName;
      session.video.tileState.textContent = session.mode === 'control'
        ? tr('remote.control.current')
        : `${stateText(session)} · ${qualityLabel(session.quality)}`;
      session.video.tileMetrics.textContent = metricsText(session, true);
      session.video.tileHead.setAttribute('aria-label', tr('remote.tile.activate', { name: session.deviceName }));
    }
    const hasTargets = sessions.size > 0;
    els.emptyState.hidden = hasTargets;
    els.controlDeck.hidden = !active;
    els.stageBadge.hidden = !active || layoutMode === 'grid';
    renderStreamBudget(active);
    if (!active) {
      els.networkMetrics.textContent = tr('remote.metrics.waiting');
      els.pathLabel.textContent = tr('remote.path.authenticated');
      els.pathDot.dataset.state = 'ok';
      return;
    }
    els.stageDeviceName.textContent = active.deviceName;
    els.activeDeviceName.textContent = active.deviceName;
    els.activeState.textContent = stateText(active);
    els.activeState.dataset.state = active.state;
    els.pauseBtn.textContent = tr(active.state === 'paused' ? 'remote.resume' : 'remote.pause');
    els.pauseBtn.disabled = !['viewing', 'paused'].includes(active.state);
    const canRequestControl = ['viewing', 'paused'].includes(active.state)
      && active.controlState !== 'waiting-consent'
      && active.canControl === true
      && active.inputChannelsReady === true;
    els.controlBtn.disabled = active.mode === 'control' ? false : !canRequestControl;
    els.controlBtn.title = active.mode === 'control'
      ? tr('remote.control.release')
      : (active.canControl !== true
        ? tr('remote.control.permissionRequired')
        : (active.inputChannelsReady === true ? tr('remote.control.hint') : tr('remote.control.channelsWaiting')));
    els.controlBtn.dataset.active = String(active.mode === 'control');
    els.controlBtn.textContent = tr(active.mode === 'control'
      ? 'remote.control.release'
      : (active.controlState === 'waiting-consent' ? 'remote.control.waiting' : 'remote.control.request'));
    els.modeLabel.textContent = tr(active.mode === 'control' ? 'remote.control.current' : 'remote.viewOnly');
    els.modeLabel.parentElement.dataset.mode = active.mode || 'view';
    els.modeLabel.parentElement.title = tr('remote.control.emergency');
    els.qualitySelect.value = active.preferredQuality || 'high';
    els.qualitySelect.disabled = !['viewing', 'paused', 'connecting-media'].includes(active.state);
    els.networkMetrics.textContent = metricsText(active);
    renderDisplays(active);
    renderPath(active);
  }

  function renderStreamBudget(active) {
    const maximum = Number(window.RemoteStreamBudget?.REMOTE_STREAM_LIMIT) || 4;
    els.streamCount.textContent = `${sessions.size}/${maximum}`;
    if (!active) {
      els.streamBudget.textContent = tr('remote.streams.none');
      return;
    }
    els.streamBudget.textContent = tr('remote.streams.budget', {
      active: qualityLabel(active.preferredQuality),
      background: Math.max(0, sessions.size - 1)
    });
  }

  function renderDisplays(session) {
    els.displaySelect.replaceChildren();
    const displays = Array.isArray(session.displays) ? session.displays : [];
    if (!displays.length) {
      const option = document.createElement('option');
      option.textContent = session.displayName || tr('remote.display.waiting');
      option.value = session.displayId || '';
      els.displaySelect.append(option);
      els.displaySelect.disabled = true;
      return;
    }
    for (const display of displays) {
      const option = document.createElement('option');
      option.value = display.displayId;
      const fullLabel = `${display.name} · ${display.width}×${display.height}`;
      option.textContent = window.innerWidth < 900 ? display.name : fullLabel;
      option.title = fullLabel;
      els.displaySelect.append(option);
    }
    if (displays.some((item) => item.displayId === session.displayId)) els.displaySelect.value = session.displayId;
    els.displaySelect.disabled = !['viewing', 'paused', 'connecting-media'].includes(session.state);
  }

  function renderPath(session) {
    const mediaPath = session.mediaStats?.path;
    const candidateTypes = session.transport?.candidateTypes || [];
    const path = mediaPath === 'relay' || candidateTypes.includes('relay')
      ? tr('remote.path.relay')
      : (mediaPath === 'direct' || candidateTypes.length ? tr('remote.path.direct') : tr('remote.path.authenticated'));
    els.pathLabel.textContent = path;
    els.pathDot.dataset.state = session.state === 'error' ? 'error' : 'ok';
  }

  function activeSession() {
    return activeSessionId ? sessions.get(activeSessionId) || null : null;
  }

  function stateText(session) {
    const key = {
      connecting: 'remote.state.connecting',
      'waiting-consent': 'remote.state.waitingConsent',
      'connecting-media': 'remote.state.connectingMedia',
      viewing: 'remote.state.viewing',
      paused: 'remote.state.paused',
      rejected: 'remote.state.rejected',
      error: 'remote.state.error',
      disconnected: 'remote.state.disconnected'
    }[session.state] || 'remote.state.connecting';
    return tr(key);
  }

  function setPathError(code) {
    els.pathLabel.textContent = tr('remote.state.errorWithCode', { code });
    els.pathDot.dataset.state = 'error';
  }

  function waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('remote-ice-timeout')), 20_000);
      const onState = () => {
        if (peer.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      peer.addEventListener('icegatheringstatechange', onState);
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
    return String(error?.message || error || 'remote-failed')
      .trim().replace(/[^a-z0-9._:-]/gi, '-').slice(0, 120) || 'remote-failed';
  }
})();
