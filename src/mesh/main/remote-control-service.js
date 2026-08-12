const crypto = require('node:crypto');
const path = require('node:path');
const { requireCapability } = require('../domain/capabilities');
const { normalizeRemoteInput, InputRateGuard } = require('../domain/remote-input');

const REMOTE_SDP_LIMIT = 256 * 1024;
const REMOTE_SESSION_LIMIT = 4;
const IPC_ROUTERS = new WeakMap();

class RemoteControlService {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow;
    this.WebContentsView = options.WebContentsView;
    this.ipcMain = options.ipcMain;
    this.desktopCapturer = options.desktopCapturer;
    this.screen = options.screen;
    this.systemPreferences = options.systemPreferences;
    this.remoteDirectory = options.remoteDirectory;
    this.mainWindowProvider = options.mainWindowProvider || (() => null);
    this.meshService = options.meshService;
    this.peerManagerProvider = options.peerManagerProvider;
    this.iceServersProvider = options.iceServersProvider || (() => []);
    this.languageProvider = options.languageProvider || (() => 'zh');
    this.inputAdapter = options.inputAdapter || null;
    this.onChange = options.onChange || (() => {});
    this.onReturnToWorkspace = options.onReturnToWorkspace || (() => {});
    this.autoAccept = options.autoAccept === true;
    this.syntheticCapture = options.syntheticCapture === true;
    this.consoleContext = null;
    this.sessions = new Map();
    this.outgoingByDevice = new Map();
    this.currentInputSessionId = null;
    this.pendingInputSessionId = null;
    this.consoleSurface = { visible: false, bounds: null };
    this.inputRateGuard = new InputRateGuard();
    this.router = sharedRemoteIpcRouter(this.ipcMain);
  }

  async openDevice(deviceId) {
    const id = requiredText(deviceId, 'remote-device-id', 128);
    const peer = this.meshService.getPeerContext(id);
    requireCapability(peer.remote, 'screen.view');
    const manager = this.peerManagerProvider();
    let connection = manager.listConnections().find((item) => item.deviceId === id && item.authenticated);
    if (!connection) connection = await manager.connect(id);
    if (!connection?.authenticated) throw new Error('remote-peer-not-authenticated');

    const existingId = this.outgoingByDevice.get(id);
    const existing = existingId && this.sessions.get(existingId);
    if (existing && !isTerminal(existing.state)) {
      await this.ensureConsole();
      this.focusConsole(existing.sessionId);
      return publicRemoteSession(existing);
    }
    if (existing && isTerminal(existing.state)) {
      await this.stopSession(existing, 'retry-after-terminal', { notify: false });
    }
    if ([...this.sessions.values()].filter((item) => item.direction === 'outgoing' && !isTerminal(item.state)).length >= REMOTE_SESSION_LIMIT) {
      throw new Error('remote-session-limit');
    }

    const session = {
      sessionId: crypto.randomUUID(),
      deviceId: peer.remote.deviceId,
      deviceName: peer.remote.name,
      direction: 'outgoing',
      state: 'connecting',
      mode: 'view',
      controlState: 'idle',
      canControl: Array.isArray(peer.remote.permissions) && peer.remote.permissions.includes('input.control'),
      quality: 'high',
      displayId: null,
      displayName: null,
      displays: [],
      transport: connection.transport || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closed: false
    };
    this.sessions.set(session.sessionId, session);
    this.outgoingByDevice.set(session.deviceId, session.sessionId);
    const consoleContext = await this.ensureConsole();
    consoleContext.webContents.send('remote-console:add-target', {
      token: consoleContext.token,
      target: consoleTarget(session, this.iceServersProvider(session.deviceId))
    });
    this.focusConsole(session.sessionId);
    this.emitChange();
    return publicRemoteSession(session);
  }

  list() {
    return [...this.sessions.values()].filter((item) => !item.closed).map(publicRemoteSession);
  }

  async disconnect(sessionId, reason = 'user-disconnect') {
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) return false;
    await this.stopSession(session, reason, { notify: true });
    return true;
  }

  async stopDevice(deviceId, reason = 'peer-disconnected') {
    const matches = [...this.sessions.values()].filter((item) => item.deviceId === String(deviceId || ''));
    await Promise.all(matches.map((item) => this.stopSession(item, reason, { notify: false })));
  }

  async stopAll(reason = 'app-quit') {
    const current = [...this.sessions.values()];
    await Promise.all(current.map((item) => this.stopSession(item, reason, { notify: false })));
    const context = this.consoleContext;
    this.consoleContext = null;
    if (context) {
      context.closed = true;
      this.router.consoleContexts.delete(context.token);
      const parent = context.parentWindow;
      if (context.view && parent && !parent.isDestroyed()) parent.contentView.removeChildView(context.view);
      if (!context.webContents.isDestroyed()) context.webContents.close({ waitForBeforeUnload: false });
    }
    this.consoleSurface = { visible: false, bounds: null };
    this.inputAdapter?.releaseAll();
  }

  async returnToWorkspace(activeSessionId = null) {
    const sessions = [...this.sessions.values()].filter((item) => item.direction === 'outgoing' && !item.closed);
    await Promise.all(sessions.map((item) => this.releaseControl(item, 'return-to-workspace', { notify: true })));
    this.setConsoleSurface({ visible: false });
    const active = sessions.find((item) => item.sessionId === String(activeSessionId || '')) || sessions[0] || null;
    const payload = {
      activeSessionId: active?.sessionId || null,
      sessions: this.list()
    };
    this.onReturnToWorkspace(payload);
    return payload;
  }

  handlePeerState(value = {}) {
    if (value.state === 'disconnected' || value.state === 'error') {
      void this.stopDevice(value.deviceId, value.reason || 'peer-disconnected');
    }
  }

  async handleEnvelope({ context, envelope } = {}) {
    const messageType = String(envelope?.messageType || '');
    if (!messageType.startsWith('remote.')) return false;
    const payload = envelope?.payload || {};
    switch (messageType) {
      case 'remote.view.offer':
        await this.receiveOffer(context, payload);
        return true;
      case 'remote.view.answer':
        this.receiveAnswer(context, payload);
        return true;
      case 'remote.view.rejected':
        this.receiveRejected(context, payload);
        return true;
      case 'remote.view.command':
        this.receiveCommand(context, payload);
        return true;
      case 'remote.view.status':
        this.receiveStatus(context, payload);
        return true;
      case 'remote.view.stop':
        await this.receiveStop(context, payload);
        return true;
      case 'remote.control.request':
        await this.receiveControlRequest(context, payload);
        return true;
      case 'remote.control.response':
        this.receiveControlResponse(context, payload);
        return true;
      case 'remote.control.release':
        await this.receiveControlRelease(context, payload);
        return true;
      default:
        throw new Error('remote-message-type-unknown');
    }
  }

  async ensureConsole() {
    if (this.consoleContext && !this.consoleContext.webContents.isDestroyed()) return this.consoleContext;
    this.assertRuntime();
    const parentWindow = this.mainWindowProvider();
    if (!parentWindow || parentWindow.isDestroyed()) throw new Error('remote-main-window-unavailable');
    const token = crypto.randomBytes(24).toString('hex');
    const view = new this.WebContentsView({
      webPreferences: {
        preload: path.join(this.remoteDirectory, 'console-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [
          `--agentdesk-remote-console=${token}`,
          '--agentdesk-remote-surface=embedded'
        ]
      }
    });
    view.setBackgroundColor('#111716');
    view.setVisible(false);
    parentWindow.contentView.addChildView(view);
    const context = {
      token,
      view,
      webContents: view.webContents,
      parentWindow,
      service: this,
      loaded: false,
      closed: false
    };
    this.consoleContext = context;
    this.router.consoleContexts.set(token, context);
    view.webContents.once('destroyed', () => {
      if (context.closed) return;
      context.closed = true;
      this.router.consoleContexts.delete(token);
      if (this.consoleContext === context) this.consoleContext = null;
      for (const session of [...this.sessions.values()].filter((item) => item.direction === 'outgoing')) {
        void this.stopSession(session, 'console-surface-destroyed', { notify: true });
      }
    });
    view.webContents.on('render-process-gone', (_event, details) => {
      for (const session of [...this.sessions.values()].filter((item) => item.direction === 'outgoing')) {
        void this.stopSession(session, `console-renderer-${details?.reason || 'gone'}`, { notify: true });
      }
    });
    await view.webContents.loadFile(path.join(this.remoteDirectory, 'console.html'));
    context.loaded = true;
    return context;
  }

  focusConsole(sessionId) {
    const context = this.consoleContext;
    if (!context || context.webContents.isDestroyed()) return;
    context.webContents.send('remote-console:activate-target', {
      token: context.token,
      sessionId
    });
  }

  setConsoleSurface(input = {}) {
    const context = this.consoleContext;
    if (!context || context.webContents.isDestroyed()) {
      this.consoleSurface = { visible: false, bounds: null };
      return this.consoleSurface;
    }
    if (input.visible !== true) {
      context.view.setVisible(false);
      this.consoleSurface = { visible: false, bounds: this.consoleSurface.bounds };
      return this.consoleSurface;
    }
    const bounds = normalizeSurfaceBounds(input.bounds, context.parentWindow);
    context.view.setBounds(bounds);
    context.view.setVisible(true);
    context.webContents.focus();
    this.consoleSurface = { visible: true, bounds };
    return this.consoleSurface;
  }

  async receiveOffer(context, payload) {
    const sessionId = requiredText(payload.sessionId, 'remote-session-id', 128);
    const deviceId = context.peer.remote.deviceId;
    if (this.sessions.has(sessionId)) throw new Error('remote-session-duplicate');
    requireCapability(context.peer.remote, 'screen.view');
    const activeIncoming = [...this.sessions.values()].filter((item) => item.direction === 'incoming' && !isTerminal(item.state));
    if (activeIncoming.length >= REMOTE_SESSION_LIMIT) {
      await this.sendSemantic(deviceId, 'remote.view.rejected', 'screen.view', {
        sessionId,
        reason: 'remote-session-limit'
      });
      return;
    }
    const displays = await this.listDisplaySources();
    if (!displays.length && !this.syntheticCapture) {
      await this.sendSemantic(deviceId, 'remote.view.rejected', 'screen.view', {
        sessionId,
        reason: 'remote-display-unavailable'
      });
      return;
    }
    const session = {
      sessionId,
      deviceId,
      deviceName: context.peer.remote.name,
      direction: 'incoming',
      state: 'waiting-consent',
      mode: 'view',
      controlState: 'idle',
      canControl: Array.isArray(context.peer.remote.permissions) && context.peer.remote.permissions.includes('input.control'),
      quality: 'high',
      displayId: null,
      displayName: null,
      displays: displays.map(publicDisplay),
      captureDisplays: displays,
      remoteDescription: normalizeRemoteDescription(payload.description, 'offer'),
      transport: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closed: false,
      hostContext: null
    };
    this.sessions.set(sessionId, session);
    await this.spawnHost(session);
    this.emitChange();
  }

  receiveAnswer(context, payload) {
    const session = this.requireSession(payload.sessionId, 'outgoing', context.peer.remote.deviceId);
    const description = normalizeRemoteDescription(payload.description, 'answer');
    session.state = 'connecting-media';
    session.displays = normalizePublicDisplays(payload.displays);
    session.displayId = cleanText(payload.displayId, 128) || null;
    session.displayName = cleanText(payload.displayName, 120) || null;
    session.updatedAt = new Date().toISOString();
    this.sendConsole('remote-console:answer', {
      sessionId: session.sessionId,
      description,
      displays: session.displays,
      displayId: session.displayId,
      displayName: session.displayName
    });
    this.emitChange();
  }

  receiveRejected(context, payload) {
    const session = this.requireSession(payload.sessionId, 'outgoing', context.peer.remote.deviceId);
    session.state = 'rejected';
    session.reason = cleanText(payload.reason, 160) || 'remote-view-rejected';
    session.updatedAt = new Date().toISOString();
    this.sendConsole('remote-console:status', publicRemoteSession(session));
    this.emitChange();
  }

  receiveCommand(context, payload) {
    const session = this.requireSession(payload.sessionId, 'incoming', context.peer.remote.deviceId);
    const command = normalizeViewCommand(payload.command);
    if (!session.hostContext || session.hostContext.window.isDestroyed()) throw new Error('remote-host-unavailable');
    session.hostContext.window.webContents.send('remote-host:command', {
      token: session.hostContext.token,
      command
    });
  }

  receiveStatus(context, payload) {
    const session = this.requireSession(payload.sessionId, 'outgoing', context.peer.remote.deviceId);
    const state = cleanText(payload.state, 80);
    if (state) session.state = state;
    if (payload.displayId != null) session.displayId = cleanText(payload.displayId, 128) || null;
    if (payload.displayName != null) session.displayName = cleanText(payload.displayName, 120) || null;
    if (payload.quality != null) session.quality = normalizeQuality(payload.quality);
    if (payload.mode === 'view' || payload.mode === 'control') session.mode = payload.mode;
    if (payload.controlState != null) session.controlState = normalizeControlState(payload.controlState);
    session.reason = cleanText(payload.reason, 160) || null;
    session.updatedAt = new Date().toISOString();
    this.sendConsole('remote-console:status', publicRemoteSession(session));
    this.emitChange();
  }

  async receiveStop(context, payload) {
    const session = this.requireSession(payload.sessionId, null, context.peer.remote.deviceId);
    await this.stopSession(session, cleanText(payload.reason, 160) || 'remote-stopped', { notify: false });
  }

  async receiveControlRequest(context, payload) {
    const session = this.requireSession(payload.sessionId, 'incoming', context.peer.remote.deviceId);
    requireCapability(context.peer.remote, 'input.control');
    if (!['viewing', 'paused', 'connecting-media'].includes(session.state)) throw new Error('remote-control-view-required');
    const occupiedSessionId = this.currentInputSessionId || this.pendingInputSessionId;
    if (occupiedSessionId && occupiedSessionId !== session.sessionId) {
      await this.sendSemantic(session.deviceId, 'remote.control.response', 'input.control', {
        sessionId: session.sessionId,
        accepted: false,
        reason: 'remote-input-busy'
      });
      return;
    }
    if (!session.hostContext || session.hostContext.window.isDestroyed()) throw new Error('remote-host-unavailable');
    this.pendingInputSessionId = session.sessionId;
    session.controlState = 'waiting-consent';
    session.updatedAt = new Date().toISOString();
    this.expandHostWindow(session.hostContext.window);
    session.hostContext.window.webContents.send('remote-host:control-request', {
      token: session.hostContext.token,
      controllerName: session.deviceName
    });
    this.emitChange();
  }

  receiveControlResponse(context, payload) {
    const session = this.requireSession(payload.sessionId, 'outgoing', context.peer.remote.deviceId);
    if (session.controlState !== 'waiting-consent' || this.pendingInputSessionId !== session.sessionId) {
      throw new Error('remote-control-response-stale');
    }
    this.pendingInputSessionId = null;
    if (payload.accepted === true) {
      if (this.currentInputSessionId && this.currentInputSessionId !== session.sessionId) {
        throw new Error('remote-input-target-conflict');
      }
      this.currentInputSessionId = session.sessionId;
      session.mode = 'control';
      session.controlState = 'granted';
    } else {
      if (this.currentInputSessionId === session.sessionId) this.currentInputSessionId = null;
      session.mode = 'view';
      session.controlState = 'denied';
      session.reason = cleanText(payload.reason, 160) || 'remote-control-rejected';
    }
    session.inputPermission = cleanText(payload.permission, 40) || null;
    session.updatedAt = new Date().toISOString();
    this.sendConsole('remote-console:status', publicRemoteSession(session));
    this.emitChange();
  }

  async receiveControlRelease(context, payload) {
    const session = this.requireSession(payload.sessionId, null, context.peer.remote.deviceId);
    await this.releaseControl(session, cleanText(payload.reason, 160) || 'remote-control-released', { notify: false });
  }

  async spawnHost(session) {
    this.assertRuntime();
    const token = crypto.randomBytes(24).toString('hex');
    const window = new this.BrowserWindow({
      width: 440,
      height: 360,
      minWidth: 360,
      minHeight: 82,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      title: 'AgentDesk Remote View',
      backgroundColor: '#efe6cd',
      webPreferences: {
        preload: path.join(this.remoteDirectory, 'host-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [`--agentdesk-remote-host=${token}`]
      }
    });
    const context = { token, window, service: this, session, closed: false };
    session.hostContext = context;
    this.router.hostContexts.set(token, context);
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive();
    });
    window.on('closed', () => {
      this.router.hostContexts.delete(token);
      if (context.closed) return;
      context.closed = true;
      void this.stopSession(session, 'host-window-closed', { notify: true, destroyHost: false });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      void this.stopSession(session, `host-renderer-${details?.reason || 'gone'}`, { notify: true });
    });
    await window.loadFile(path.join(this.remoteDirectory, 'host.html'));
    if (this.autoAccept && !window.isDestroyed()) {
      window.webContents.send('remote-host:auto-accept', { token });
    }
  }

  async listDisplaySources() {
    if (this.syntheticCapture) {
      return [{ id: 'synthetic:0', displayId: 'synthetic:0', name: 'Synthetic display', width: 1280, height: 720, scaleFactor: 1 }];
    }
    if (!this.desktopCapturer || typeof this.desktopCapturer.getSources !== 'function') {
      throw new Error('remote-desktop-capturer-unavailable');
    }
    const sources = await this.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    });
    const displays = typeof this.screen?.getAllDisplays === 'function' ? this.screen.getAllDisplays() : [];
    return sources.slice(0, 16).map((source, index) => {
      const sourceDisplayId = String(source.display_id || '');
      const display = displays.find((item) => String(item.id) === sourceDisplayId) || displays[index] || null;
      return {
        id: requiredText(source.id, 'remote-source-id', 256),
        displayId: sourceDisplayId || String(display?.id || index),
        name: cleanText(source.name, 120) || `Display ${index + 1}`,
        width: finiteDimension(display?.size?.width || display?.bounds?.width, 1920),
        height: finiteDimension(display?.size?.height || display?.bounds?.height, 1080),
        scaleFactor: finiteScale(display?.scaleFactor)
      };
    });
  }

  hostBootstrap(context) {
    const session = context.session;
    return {
      ok: true,
      lang: normalizeLanguage(this.languageProvider()),
      sessionId: session.sessionId,
      controllerName: session.deviceName,
      remoteDescription: session.remoteDescription,
      displays: session.captureDisplays.map((item) => ({ ...item })),
      iceServers: normalizeIceServers(this.iceServersProvider(session.deviceId)),
      screenPermission: screenPermission(this.systemPreferences),
      syntheticCapture: this.syntheticCapture
    };
  }

  consoleBootstrap() {
    return {
      ok: true,
      lang: normalizeLanguage(this.languageProvider()),
      surface: 'embedded',
      maxTargets: REMOTE_SESSION_LIMIT,
      targets: [...this.sessions.values()]
        .filter((item) => item.direction === 'outgoing' && !item.closed)
        .map((item) => consoleTarget(item, this.iceServersProvider(item.deviceId)))
    };
  }

  async handleConsoleOffer(context, input) {
    const session = this.requireSession(input.sessionId, 'outgoing');
    if (this.consoleContext !== context) throw new Error('remote-console-context-invalid');
    const description = normalizeRemoteDescription(input.description, 'offer');
    session.state = 'waiting-consent';
    session.updatedAt = new Date().toISOString();
    await this.sendSemantic(session.deviceId, 'remote.view.offer', 'screen.view', {
      sessionId: session.sessionId,
      description
    });
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleConsoleCommand(context, input) {
    const session = this.requireSession(input.sessionId, 'outgoing');
    if (this.consoleContext !== context) throw new Error('remote-console-context-invalid');
    const command = normalizeViewCommand(input.command);
    session.quality = command.type === 'quality' ? command.value : session.quality;
    if (command.type === 'pause') session.state = 'paused';
    if (command.type === 'resume') session.state = 'viewing';
    session.updatedAt = new Date().toISOString();
    await this.sendSemantic(session.deviceId, 'remote.view.command', 'screen.view', {
      sessionId: session.sessionId,
      command
    });
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleConsoleControlRequest(context, input) {
    const session = this.requireSession(input.sessionId, 'outgoing');
    if (this.consoleContext !== context) throw new Error('remote-console-context-invalid');
    if (!['viewing', 'paused'].includes(session.state)) throw new Error('remote-control-view-required');
    const peer = this.meshService.getPeerContext(session.deviceId);
    requireCapability(peer.remote, 'input.control');
    const previousId = this.currentInputSessionId || this.pendingInputSessionId;
    const previous = previousId && this.sessions.get(previousId);
    if (previous && previous !== session) await this.releaseControl(previous, 'input-target-switched', { notify: true });
    this.pendingInputSessionId = session.sessionId;
    session.controlState = 'waiting-consent';
    session.reason = null;
    session.updatedAt = new Date().toISOString();
    try {
      await this.sendSemantic(session.deviceId, 'remote.control.request', 'input.control', {
        sessionId: session.sessionId
      });
    } catch (error) {
      if (this.pendingInputSessionId === session.sessionId) this.pendingInputSessionId = null;
      session.controlState = 'idle';
      session.reason = safeError(error);
      session.updatedAt = new Date().toISOString();
      throw error;
    }
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleConsoleReleaseControl(context, input) {
    const session = this.requireSession(input.sessionId, 'outgoing');
    if (this.consoleContext !== context) throw new Error('remote-console-context-invalid');
    await this.releaseControl(session, 'controller-view-only', { notify: true });
    return publicRemoteSession(session);
  }

  handleConsoleState(context, input) {
    const session = this.requireSession(input.sessionId, 'outgoing');
    if (this.consoleContext !== context) throw new Error('remote-console-context-invalid');
    const state = cleanText(input.state, 80);
    if (['connecting-media', 'viewing', 'paused', 'error'].includes(state)) session.state = state;
    session.reason = cleanText(input.reason, 160) || null;
    session.updatedAt = new Date().toISOString();
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleHostAnswer(context, input) {
    const session = context.session;
    this.requireSession(session.sessionId, 'incoming', session.deviceId);
    const display = session.captureDisplays.find((item) => item.id === String(input.sourceId || ''));
    if (!display) throw new Error('remote-display-invalid');
    const description = normalizeRemoteDescription(input.description, 'answer');
    session.state = 'connecting-media';
    session.displayId = display.displayId;
    session.displayName = display.name;
    session.updatedAt = new Date().toISOString();
    await this.sendSemantic(session.deviceId, 'remote.view.answer', 'screen.view', {
      sessionId: session.sessionId,
      description,
      displays: session.captureDisplays.map(publicDisplay),
      displayId: display.displayId,
      displayName: display.name
    });
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleHostState(context, input) {
    const session = context.session;
    this.requireSession(session.sessionId, 'incoming', session.deviceId);
    const state = cleanText(input.state, 80);
    if (['waiting-consent', 'connecting-media', 'viewing', 'paused', 'error'].includes(state)) {
      session.state = state;
    }
    session.reason = cleanText(input.reason, 160) || null;
    session.quality = input.quality == null ? session.quality : normalizeQuality(input.quality);
    const source = session.captureDisplays.find((item) => item.id === String(input.sourceId || ''));
    if (source) {
      session.displayId = source.displayId;
      session.displayName = source.name;
    }
    session.updatedAt = new Date().toISOString();
    if (session.state === 'viewing' || session.state === 'paused') this.compactHostWindow(context.window);
    await this.sendSemantic(session.deviceId, 'remote.view.status', 'screen.view', {
      sessionId: session.sessionId,
      state: session.state,
      reason: session.reason,
      quality: session.quality,
      mode: session.mode,
      controlState: session.controlState,
      displayId: session.displayId,
      displayName: session.displayName
    });
    this.emitChange();
    return publicRemoteSession(session);
  }

  async handleHostStop(context, input) {
    const session = context.session;
    const reason = cleanText(input.reason, 160) || 'local-stop';
    if (reason === 'user-denied') {
      await this.sendSemantic(session.deviceId, 'remote.view.rejected', 'screen.view', {
        sessionId: session.sessionId,
        reason
      });
      await this.stopSession(session, reason, { notify: false });
      return true;
    }
    await this.stopSession(session, reason, { notify: true });
    return true;
  }

  async handleHostControlResponse(context, input) {
    const session = context.session;
    this.requireSession(session.sessionId, 'incoming', session.deviceId);
    if (session.controlState !== 'waiting-consent' || this.pendingInputSessionId !== session.sessionId) {
      throw new Error('remote-control-consent-stale');
    }
    this.pendingInputSessionId = null;
    let accepted = input.accepted === true;
    let reason = accepted ? null : 'remote-control-rejected';
    let permission = null;
    if (accepted) {
      try {
        if (this.currentInputSessionId && this.currentInputSessionId !== session.sessionId) {
          throw new Error('remote-input-busy');
        }
        const peer = this.meshService.getPeerContext(session.deviceId);
        requireCapability(peer.remote, 'input.control');
        if (!this.inputAdapter) throw new Error('input-adapter-unavailable');
        const status = this.inputAdapter.ensureReady({ prompt: true });
        permission = status.permission;
        this.currentInputSessionId = session.sessionId;
        session.mode = 'control';
        session.controlState = 'granted';
      } catch (error) {
        accepted = false;
        reason = safeError(error);
        permission = this.inputAdapter?.status()?.permission || 'unavailable';
        session.mode = 'view';
        session.controlState = 'denied';
      }
    } else {
      session.mode = 'view';
      session.controlState = 'denied';
    }
    session.inputPermission = permission;
    session.updatedAt = new Date().toISOString();
    context.window.webContents.send('remote-host:mode', {
      token: context.token,
      mode: session.mode,
      permission,
      reason
    });
    this.compactHostWindow(context.window);
    try {
      await this.sendSemantic(session.deviceId, 'remote.control.response', 'input.control', {
        sessionId: session.sessionId,
        accepted,
        reason,
        permission
      });
    } catch (error) {
      if (accepted) await this.releaseControl(session, 'control-response-failed', { notify: false });
      throw error;
    }
    this.emitChange();
    return publicRemoteSession(session);
  }

  handleHostInput(context, input) {
    const session = context.session;
    this.requireSession(session.sessionId, 'incoming', session.deviceId);
    const event = normalizeRemoteInput(input.event);
    if (session.mode !== 'control' || this.currentInputSessionId !== session.sessionId) {
      if (event.type === 'releaseAll') return false;
      throw new Error('remote-input-not-authorized');
    }
    this.inputRateGuard.accept(session.sessionId, event);
    if (event.type === 'releaseAll') {
      this.inputAdapter?.releaseAll();
      return true;
    }
    try {
      const now = Date.now();
      if (!session.inputPermissionCheckedAt || now - session.inputPermissionCheckedAt > 1_000) {
        const peer = this.meshService.getPeerContext(session.deviceId);
        requireCapability(peer.remote, 'input.control');
        session.inputPermissionCheckedAt = now;
      }
      if (!this.inputAdapter) throw new Error('input-adapter-unavailable');
      this.inputAdapter.inject(event, { displayId: session.displayId });
    } catch (error) {
      void this.releaseControl(session, safeError(error), { notify: true });
      throw error;
    }
    return true;
  }

  compactHostWindow(window) {
    if (!window || window.isDestroyed()) return;
    const [width] = window.getSize();
    window.setResizable(false);
    window.setSize(Math.max(360, Math.min(width, 440)), 88, true);
    window.showInactive();
  }

  expandHostWindow(window) {
    if (!window || window.isDestroyed()) return;
    const [width] = window.getSize();
    window.setSize(Math.max(380, Math.min(width, 440)), 236, true);
    window.show();
    window.focus();
  }

  async releaseControl(session, reason = 'remote-control-released', options = {}) {
    if (!session || session.closed) return;
    const wasControl = session.mode === 'control' || session.controlState === 'waiting-consent';
    if (this.currentInputSessionId === session.sessionId) this.currentInputSessionId = null;
    if (this.pendingInputSessionId === session.sessionId) this.pendingInputSessionId = null;
    session.mode = 'view';
    session.controlState = 'idle';
    session.inputPermissionCheckedAt = null;
    session.updatedAt = new Date().toISOString();
    this.inputRateGuard.clear(session.sessionId);
    if (session.direction === 'incoming' && wasControl) {
      this.inputAdapter?.releaseAll();
      if (session.hostContext && !session.hostContext.window.isDestroyed()) {
        session.hostContext.window.webContents.send('remote-host:mode', {
          token: session.hostContext.token,
          mode: 'view',
          reason
        });
        this.compactHostWindow(session.hostContext.window);
      }
    }
    if (options.notify !== false && wasControl) {
      try {
        await this.sendSemantic(session.deviceId, 'remote.control.release', 'input.control', {
          sessionId: session.sessionId,
          reason
        });
      } catch (_error) {
        // Releasing local state is mandatory even if the peer already disconnected.
      }
    }
    if (session.direction === 'outgoing') this.sendConsole('remote-console:status', publicRemoteSession(session));
    this.emitChange();
  }

  handlePermissionsChanged(deviceId, permissions) {
    const allowed = new Set(Array.isArray(permissions) ? permissions : []);
    for (const session of [...this.sessions.values()].filter((item) => item.deviceId === String(deviceId || ''))) {
      session.canControl = allowed.has('input.control');
      if (!allowed.has('screen.view')) {
        void this.stopSession(session, 'screen-permission-revoked', { notify: true });
      } else if (!allowed.has('input.control') && (session.mode === 'control' || session.controlState === 'waiting-consent')) {
        void this.releaseControl(session, 'input-permission-revoked', { notify: true });
      } else if (session.direction === 'outgoing') {
        this.sendConsole('remote-console:status', publicRemoteSession(session));
      }
    }
    this.emitChange();
  }

  async stopSession(session, reason, options = {}) {
    if (!session || session.closed) return;
    if (session.mode === 'control' || session.controlState === 'waiting-consent' || this.currentInputSessionId === session.sessionId) {
      await this.releaseControl(session, reason, { notify: false });
    }
    session.closed = true;
    session.state = 'disconnected';
    session.reason = cleanText(reason, 160) || 'disconnected';
    session.updatedAt = new Date().toISOString();
    if (options.notify !== false) {
      try {
        await this.sendSemantic(session.deviceId, 'remote.view.stop', 'screen.view', {
          sessionId: session.sessionId,
          reason: session.reason
        });
      } catch (_error) {
        // Teardown is local-first; a dead authenticated channel cannot block stop.
      }
    }
    if (session.direction === 'outgoing') {
      if (this.outgoingByDevice.get(session.deviceId) === session.sessionId) this.outgoingByDevice.delete(session.deviceId);
      this.sendConsole('remote-console:remove-target', {
        sessionId: session.sessionId,
        reason: session.reason
      });
    }
    if (session.hostContext) {
      const context = session.hostContext;
      context.closed = true;
      this.router.hostContexts.delete(context.token);
      if (options.destroyHost !== false && !context.window.isDestroyed()) {
        context.window.webContents.send('remote-host:close', { token: context.token, reason: session.reason });
        context.window.destroy();
      }
    }
    this.sessions.delete(session.sessionId);
    if (![...this.sessions.values()].some((item) => item.direction === 'outgoing' && !item.closed)) {
      this.setConsoleSurface({ visible: false });
    }
    this.emitChange();
  }

  requireSession(sessionId, direction, deviceId) {
    const session = this.sessions.get(requiredText(sessionId, 'remote-session-id', 128));
    if (!session || session.closed) throw new Error('remote-session-not-found');
    if (direction && session.direction !== direction) throw new Error('remote-session-direction');
    if (deviceId && session.deviceId !== String(deviceId)) throw new Error('remote-session-device');
    return session;
  }

  sendConsole(channel, payload) {
    const context = this.consoleContext;
    if (!context || context.webContents.isDestroyed()) return;
    context.webContents.send(channel, { token: context.token, ...payload });
  }

  sendSemantic(deviceId, messageType, capability, payload) {
    return this.peerManagerProvider().sendSemantic(deviceId, messageType, capability, payload);
  }

  emitChange() {
    this.onChange(this.list());
  }

  assertRuntime() {
    if (
      typeof this.BrowserWindow !== 'function' ||
      typeof this.WebContentsView !== 'function' ||
      !this.ipcMain ||
      !this.remoteDirectory ||
      typeof this.mainWindowProvider !== 'function'
    ) {
      throw new Error('remote-runtime-unavailable');
    }
  }
}

function sharedRemoteIpcRouter(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('remote-ipc-unavailable');
  const existing = IPC_ROUTERS.get(ipcMain);
  if (existing) return existing;
  const router = { consoleContexts: new Map(), hostContexts: new Map() };
  const handle = (channel, type, callback) => {
    ipcMain.handle(channel, async (event, input = {}) => {
      try {
        const contexts = type === 'console' ? router.consoleContexts : router.hostContexts;
        const context = contexts.get(String(input.token || ''));
        const webContents = contextWebContents(context);
        if (!context || context.closed || !webContents || webContents.isDestroyed() || event.sender.id !== webContents.id) {
          throw new Error('remote-ipc-source-invalid');
        }
        return await callback(context.service, context, input);
      } catch (error) {
        return { ok: false, reasonCode: safeError(error) };
      }
    });
  };
  handle('remote-console:bootstrap', 'console', (service) => service.consoleBootstrap());
  handle('remote-console:offer', 'console', async (service, context, input) => ({
    ok: true,
    session: await service.handleConsoleOffer(context, input)
  }));
  handle('remote-console:command', 'console', async (service, context, input) => ({
    ok: true,
    session: await service.handleConsoleCommand(context, input)
  }));
  handle('remote-console:request-control', 'console', async (service, context, input) => ({
    ok: true,
    session: await service.handleConsoleControlRequest(context, input)
  }));
  handle('remote-console:release-control', 'console', async (service, context, input) => ({
    ok: true,
    session: await service.handleConsoleReleaseControl(context, input)
  }));
  handle('remote-console:state', 'console', (service, context, input) => ({
    ok: true,
    session: service.handleConsoleState(context, input)
  }));
  handle('remote-console:disconnect', 'console', async (service, context, input) => {
    const session = service.requireSession(input.sessionId, 'outgoing');
    if (service.consoleContext !== context) throw new Error('remote-console-context-invalid');
    await service.stopSession(session, 'user-disconnect', { notify: true });
    return { ok: true };
  });
  handle('remote-console:return', 'console', async (service, context, input) => {
    if (service.consoleContext !== context) throw new Error('remote-console-context-invalid');
    const result = await service.returnToWorkspace(input.sessionId);
    return { ok: true, ...result };
  });
  handle('remote-host:bootstrap', 'host', (service, context) => service.hostBootstrap(context));
  handle('remote-host:answer', 'host', async (service, context, input) => ({
    ok: true,
    session: await service.handleHostAnswer(context, input)
  }));
  handle('remote-host:state', 'host', async (service, context, input) => ({
    ok: true,
    session: await service.handleHostState(context, input)
  }));
  handle('remote-host:stop', 'host', async (service, context, input) => ({
    ok: await service.handleHostStop(context, input)
  }));
  handle('remote-host:control-response', 'host', async (service, context, input) => ({
    ok: true,
    session: await service.handleHostControlResponse(context, input)
  }));
  handle('remote-host:input', 'host', (service, context, input) => ({
    ok: service.handleHostInput(context, input)
  }));
  IPC_ROUTERS.set(ipcMain, router);
  return router;
}

function contextWebContents(context) {
  return context?.webContents || context?.window?.webContents || null;
}

function normalizeSurfaceBounds(value, parentWindow) {
  if (!value || typeof value !== 'object' || !parentWindow || parentWindow.isDestroyed()) {
    throw new Error('remote-surface-bounds-invalid');
  }
  const content = parentWindow.getContentBounds();
  const x = finiteSurfaceCoordinate(value.x, 'x');
  const y = finiteSurfaceCoordinate(value.y, 'y');
  const width = finiteSurfaceCoordinate(value.width, 'width');
  const height = finiteSurfaceCoordinate(value.height, 'height');
  if (width < 320 || height < 160) throw new Error('remote-surface-bounds-too-small');
  if (x < 0 || y < 0 || x + width > content.width || y + height > content.height) {
    throw new Error('remote-surface-bounds-outside-window');
  }
  return { x, y, width, height };
}

function finiteSurfaceCoordinate(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 32768) {
    throw new Error(`remote-surface-${field}-invalid`);
  }
  return Math.round(number);
}

function normalizeRemoteDescription(value, expectedType) {
  if (!value || value.type !== expectedType) throw new Error('remote-description-type');
  const sdp = String(value.sdp || '');
  if (!sdp || Buffer.byteLength(sdp) > REMOTE_SDP_LIMIT) throw new Error('remote-description-size');
  return { type: expectedType, sdp };
}

function normalizeViewCommand(value = {}) {
  const type = String(value.type || '');
  if (type === 'pause' || type === 'resume') return { type };
  if (type === 'quality') return { type, value: normalizeQuality(value.value) };
  if (type === 'display') {
    return { type, displayId: requiredText(value.displayId, 'remote-display-id', 128) };
  }
  throw new Error('remote-command-type');
}

function normalizeQuality(value) {
  const quality = String(value || '');
  if (!['high', 'balanced', 'thumbnail'].includes(quality)) throw new Error('remote-quality-invalid');
  return quality;
}

function normalizeControlState(value) {
  const state = String(value || '');
  if (!['idle', 'waiting-consent', 'granted', 'denied'].includes(state)) throw new Error('remote-control-state');
  return state;
}

function normalizePublicDisplays(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((item, index) => ({
    displayId: cleanText(item?.displayId, 128) || String(index),
    name: cleanText(item?.name, 120) || `Display ${index + 1}`,
    width: finiteDimension(item?.width, 1920),
    height: finiteDimension(item?.height, 1080),
    scaleFactor: finiteScale(item?.scaleFactor)
  }));
}

function publicDisplay(value) {
  return {
    displayId: cleanText(value?.displayId, 128),
    name: cleanText(value?.name, 120),
    width: finiteDimension(value?.width, 1920),
    height: finiteDimension(value?.height, 1080),
    scaleFactor: finiteScale(value?.scaleFactor)
  };
}

function publicRemoteSession(session) {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    direction: session.direction,
    state: session.state,
    mode: session.mode,
    controlState: session.controlState || 'idle',
    inputPermission: session.inputPermission || null,
    canControl: session.canControl === true,
    quality: session.quality,
    displayId: session.displayId,
    displayName: session.displayName,
    displays: normalizePublicDisplays(session.displays),
    transport: session.transport || null,
    reason: session.reason || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function consoleTarget(session, iceServers) {
  return {
    ...publicRemoteSession(session),
    iceServers: normalizeIceServers(iceServers)
  };
}

function screenPermission(systemPreferences) {
  if (process.platform !== 'darwin') return 'granted';
  try {
    const status = systemPreferences?.getMediaAccessStatus?.('screen');
    return ['not-determined', 'granted', 'denied', 'restricted', 'unknown'].includes(status) ? status : 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

function normalizeIceServers(value) {
  const result = [];
  for (const item of Array.isArray(value) ? value : []) {
    const urls = (Array.isArray(item?.urls) ? item.urls : [item?.urls])
      .map((url) => String(url || '').trim())
      .filter((url) => /^(stun|turn|turns):/i.test(url))
      .slice(0, 8);
    if (!urls.length) continue;
    result.push({
      urls,
      username: cleanText(item.username, 256) || undefined,
      credential: cleanText(item.credential, 512) || undefined
    });
  }
  return result.slice(0, 8);
}

function normalizeLanguage(value) {
  return ['zh', 'en', 'ja'].includes(value) ? value : 'zh';
}

function finiteDimension(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 32768 ? Math.round(number) : fallback;
}

function finiteScale(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.5 && number <= 8 ? number : 1;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function safeError(error) {
  return String(error?.message || error || 'remote-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'remote-failed';
}

function isTerminal(state) {
  return ['rejected', 'disconnected', 'error'].includes(String(state || ''));
}

module.exports = {
  REMOTE_SDP_LIMIT,
  REMOTE_SESSION_LIMIT,
  RemoteControlService,
  normalizeRemoteDescription,
  normalizeViewCommand,
  normalizePublicDisplays,
  normalizeSurfaceBounds,
  publicRemoteSession,
  screenPermission,
  sharedRemoteIpcRouter
};
