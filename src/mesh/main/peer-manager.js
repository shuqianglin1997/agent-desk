const crypto = require('node:crypto');
const path = require('node:path');
const { requireCapability } = require('../domain/capabilities');
const { createEnvelope, verifyEnvelope, SequenceGuard } = require('../protocol/envelope');
const { createDeviceProof, verifyDeviceProof } = require('../protocol/handshake');
const { encodeInventoryChunks, InventoryAssembler } = require('../protocol/inventory');

const PEER_TIMEOUT_MS = 30_000;
const MAX_SDP_BYTES = 256 * 1024;
const MAX_RENDERER_MESSAGE_BYTES = 512 * 1024;
const IPC_ROUTERS = new WeakMap();

class PeerManager {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow;
    this.ipcMain = options.ipcMain;
    this.peerDirectory = options.peerDirectory;
    this.meshService = options.meshService;
    this.sendSignal = options.sendSignal;
    this.iceServersProvider = options.iceServersProvider || (() => []);
    this.onState = options.onState || (() => {});
    this.onEnvelope = options.onEnvelope || (() => {});
    this.contextsByToken = new Map();
    this.connectionsById = new Map();
    this.connectionsByDevice = new Map();
    this.sequenceGuard = new SequenceGuard(4096);
    this.ipcRouter = sharedIpcRouter(this.ipcMain);
  }

  async connect(deviceId) {
    const existing = this.connectionsByDevice.get(String(deviceId));
    if (existing?.authenticated && !existing.window.isDestroyed()) return publicConnection(existing);
    if (typeof this.sendSignal !== 'function') throw new Error('peer-signal-transport-unavailable');
    const peer = this.meshService.getPeerContext(deviceId);
    requireCapability(peer.remote, 'inventory.read');
    if (
      (!Array.isArray(peer.remote.endpoints) || !peer.remote.endpoints.length) &&
      (!Array.isArray(peer.remote.signalUrls) || !peer.remote.signalUrls.length)
    ) {
      throw new Error('peer-route-unavailable');
    }
    this.meshService.setRemoteConnectionState(deviceId, 'connecting');
    const connectionId = crypto.randomUUID();
    const challenge = crypto.randomBytes(24).toString('base64url');
    const context = await this.spawnPeer({
      role: 'offerer',
      connectionId,
      peer,
      localChallenge: challenge
    });
    try {
      const localSignal = await context.signal.promise;
      const offerEnvelope = this.createSignedEnvelope(context, 'webrtc.offer', 'inventory.read', {
        description: localSignal.description,
        challenge
      });
      const signalResult = await this.sendSignal(peer.remote, offerEnvelope);
      const answerEnvelope = signalResult?.responseEnvelope || signalResult?.response || signalResult;
      context.signalingPath = cleanText(signalResult?.path, 24) || 'unknown';
      context.signalingService = cleanText(signalResult?.service, 160) || null;
      const verified = this.verifyRemoteEnvelope(context, answerEnvelope, {
        messageType: 'webrtc.answer',
        capability: 'inventory.read'
      });
      if (!verified.ok) throw new Error(verified.reason);
      const answer = verified.payload.payload || {};
      const proof = verifyDeviceProof(
        answer.proof,
        peer.remote.membershipCertificate,
        peer.mesh.rootPublicKey,
        {
          meshId: peer.mesh.meshId,
          connectionId,
          sourceDeviceId: peer.remote.deviceId,
          targetDeviceId: peer.local.deviceId,
          challenge
        },
        {
          membershipChain: peer.remote.membershipChain
        }
      );
      if (!proof.ok) throw new Error(proof.reason);
      context.remoteChallenge = requiredText(answer.challenge, 'peer-answer-challenge', 256);
      context.answerAuthenticated = true;
      context.window.webContents.send('mesh-peer:remote-description', {
        token: context.token,
        description: normalizeDescription(answer.description, 'answer')
      });
      await context.open.promise;
      const helloProof = createDeviceProof({
        meshId: peer.mesh.meshId,
        connectionId,
        sourceDeviceId: peer.local.deviceId,
        targetDeviceId: peer.remote.deviceId,
        challenge: context.remoteChallenge,
        membershipCertificate: peer.local.membershipCertificate
      }, peer.secrets.devicePrivateKey);
      await this.sendDataEnvelope(context, 'connection.hello', 'inventory.read', {
        proof: helloProof
      });
      await context.auth.promise;
      return publicConnection(context);
    } catch (error) {
      this.failContext(context, error);
      throw error;
    }
  }

  async receiveSignal(signalEnvelope) {
    const sourceDeviceId = requiredText(signalEnvelope?.sourceDeviceId, 'sourceDeviceId', 128);
    const peer = this.meshService.getPeerContext(sourceDeviceId);
    requireCapability(peer.remote, 'inventory.read');
    const preliminary = verifyEnvelope(signalEnvelope, peer.remote.devicePublicKey, {
      messageType: 'webrtc.offer',
      sourceDeviceId: peer.remote.deviceId,
      targetDeviceId: peer.local.deviceId,
      capability: 'inventory.read'
    }, { sequenceGuard: this.sequenceGuard });
    if (!preliminary.ok) throw new Error(preliminary.reason);
    const offer = preliminary.payload.payload || {};
    const connectionId = preliminary.payload.connectionId;
    if (this.connectionsById.has(connectionId)) throw new Error('peer-connection-duplicate');
    const challenge = crypto.randomBytes(24).toString('base64url');
    const context = await this.spawnPeer({
      role: 'answerer',
      connectionId,
      peer,
      remoteDescription: normalizeDescription(offer.description, 'offer'),
      localChallenge: challenge,
      remoteChallenge: requiredText(offer.challenge, 'peer-offer-challenge', 256),
      sendSequence: 0
    });
    this.meshService.setRemoteConnectionState(sourceDeviceId, 'connecting');
    try {
      const localSignal = await context.signal.promise;
      const proof = createDeviceProof({
        meshId: peer.mesh.meshId,
        connectionId,
        sourceDeviceId: peer.local.deviceId,
        targetDeviceId: peer.remote.deviceId,
        challenge: context.remoteChallenge,
        membershipCertificate: peer.local.membershipCertificate
      }, peer.secrets.devicePrivateKey);
      return this.createSignedEnvelope(context, 'webrtc.answer', 'inventory.read', {
        description: localSignal.description,
        challenge,
        proof
      });
    } catch (error) {
      this.failContext(context, error);
      throw error;
    }
  }

  async disconnect(deviceId, reason = 'user-disconnect') {
    const context = this.connectionsByDevice.get(String(deviceId));
    if (!context) return false;
    try {
      if (context.authenticated) {
        await this.sendDataEnvelope(context, 'connection.close', 'inventory.read', {
          reason: cleanText(reason, 100)
        });
      }
    } catch (_error) {
      // Local teardown still proceeds when the remote channel is already gone.
    }
    this.closeContext(context, reason);
    return true;
  }

  disconnectAll(reason = 'app-quit') {
    for (const context of [...this.connectionsById.values()]) this.closeContext(context, reason);
  }

  listConnections() {
    return [...this.connectionsById.values()].map(publicConnection);
  }

  async sendSemantic(deviceId, messageType, capability, payload) {
    const context = this.connectionsByDevice.get(String(deviceId));
    if (!context?.authenticated) throw new Error('peer-not-connected');
    return this.sendDataEnvelope(context, messageType, capability, payload);
  }

  async spawnPeer(input) {
    if (typeof this.BrowserWindow !== 'function' || !this.ipcMain || !this.peerDirectory) {
      throw new Error('peer-runtime-unavailable');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const window = new this.BrowserWindow({
      width: 420,
      height: 240,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(this.peerDirectory, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [`--mesh-peer-token=${token}`]
      }
    });
    const context = {
      token,
      window,
      role: input.role,
      connectionId: input.connectionId,
      peer: input.peer,
      remoteDescription: input.remoteDescription || null,
      iceServers: normalizeIceServers(this.iceServersProvider(input.peer.remote)),
      localChallenge: input.localChallenge,
      remoteChallenge: input.remoteChallenge || null,
      answerAuthenticated: false,
      authenticated: false,
      sendSequence: Number(input.sendSequence) || 0,
      signal: deferred(PEER_TIMEOUT_MS, 'peer-signal-timeout'),
      open: deferred(PEER_TIMEOUT_MS, 'peer-open-timeout'),
      auth: deferred(PEER_TIMEOUT_MS, 'peer-auth-timeout'),
      pendingAcks: new Map(),
      inventoryAssembler: new InventoryAssembler(),
      inventoryStarted: false,
      transport: null,
      signalingPath: null,
      signalingService: null,
      closed: false
    };
    this.contextsByToken.set(token, context);
    this.ipcRouter.contexts.set(token, { manager: this, context });
    this.connectionsById.set(context.connectionId, context);
    const replaced = this.connectionsByDevice.get(input.peer.remote.deviceId);
    if (replaced && replaced !== context) this.closeContext(replaced, 'peer-replaced');
    this.connectionsByDevice.set(input.peer.remote.deviceId, context);
    window.on('closed', () => {
      if (!context.closed) this.closeContext(context, 'peer-window-closed', { destroyWindow: false });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      this.failContext(context, new Error(`peer-renderer-${details?.reason || 'gone'}`));
    });
    await window.loadFile(path.join(this.peerDirectory, 'index.html'));
    return context;
  }

  async receiveRendererState(context, value = {}) {
    const state = String(value.state || '');
    if (state === 'connected') {
      context.transport = normalizeTransport(value);
      context.open.resolve(context.transport);
      this.emitState(context, 'connected-transport');
      return;
    }
    if (state === 'disconnected') {
      this.closeContext(context, value.errorCode || 'peer-disconnected');
      return;
    }
    if (state === 'error') {
      this.failContext(context, new Error(value.errorCode || 'peer-renderer-error'));
    }
  }

  async receiveDataEnvelope(context, envelope) {
    if (Buffer.byteLength(JSON.stringify(envelope || {})) > MAX_RENDERER_MESSAGE_BYTES) {
      throw new Error('peer-message-too-large');
    }
    const verified = this.verifyRemoteEnvelope(context, envelope);
    if (!verified.ok) throw new Error(verified.reason);
    const { messageType, capability, payload } = verified.payload;
    requireCapability(context.peer.remote, capability);

    if (messageType === 'connection.hello') {
      if (context.role !== 'answerer' || context.authenticated) throw new Error('peer-hello-unexpected');
      const proof = verifyDeviceProof(
        payload?.proof,
        context.peer.remote.membershipCertificate,
        context.peer.mesh.rootPublicKey,
        {
          meshId: context.peer.mesh.meshId,
          connectionId: context.connectionId,
          sourceDeviceId: context.peer.remote.deviceId,
          targetDeviceId: context.peer.local.deviceId,
          challenge: context.localChallenge
        },
        { membershipChain: context.peer.remote.membershipChain }
      );
      if (!proof.ok) throw new Error(proof.reason);
      await this.finishAuthenticated(context);
      await this.sendDataEnvelope(context, 'connection.ready', 'inventory.read', { accepted: true });
      this.startInventorySync(context);
      return;
    }
    if (messageType === 'connection.ready') {
      if (context.role !== 'offerer' || !context.answerAuthenticated) throw new Error('peer-ready-unexpected');
      await this.finishAuthenticated(context);
      this.startInventorySync(context);
      return;
    }
    if (messageType === 'connection.close') {
      this.closeContext(context, payload?.reason || 'remote-disconnect');
      return;
    }
    if (!context.authenticated) throw new Error('peer-not-authenticated');

    if (messageType === 'inventory.chunk') {
      const assembled = context.inventoryAssembler.accept(payload);
      await this.sendDataEnvelope(context, 'inventory.chunk.ack', 'inventory.read', {
        transferId: assembled.transferId,
        index: assembled.index
      });
      if (assembled.complete) {
        this.meshService.applyRemoteInventory({
          deviceId: context.peer.remote.deviceId,
          inventory: assembled.inventory
        });
        this.emitState(context, 'inventory-synced');
      }
      return;
    }
    if (messageType === 'inventory.chunk.ack') {
      const key = `${String(payload?.transferId || '')}:${Number(payload?.index)}`;
      context.pendingAcks.get(key)?.resolve(true);
      context.pendingAcks.delete(key);
      return;
    }
    const handled = await this.onEnvelope({ context, envelope: verified.payload });
    if (handled !== true) throw new Error('peer-message-type-unknown');
  }

  async finishAuthenticated(context) {
    if (context.authenticated) return;
    context.authenticated = true;
    context.auth.resolve(true);
    this.meshService.setRemoteConnectionState(context.peer.remote.deviceId, 'connected');
    this.emitState(context, 'authenticated');
  }

  startInventorySync(context) {
    if (context.inventoryStarted || context.closed) return;
    context.inventoryStarted = true;
    void this.sendInventory(context).catch((error) => this.failContext(context, error));
  }

  async sendInventory(context) {
    const inventory = this.meshService.createInventorySnapshot();
    const chunks = encodeInventoryChunks(inventory);
    for (const chunk of chunks) {
      const key = `${chunk.transferId}:${chunk.index}`;
      const ack = deferred(PEER_TIMEOUT_MS, 'inventory-chunk-ack-timeout');
      context.pendingAcks.set(key, ack);
      await this.sendDataEnvelope(context, 'inventory.chunk', 'inventory.read', chunk);
      await ack.promise;
    }
  }

  createSignedEnvelope(context, messageType, capability, payload) {
    context.sendSequence += 1;
    return createEnvelope({
      protocolVersion: '1.0',
      messageType,
      connectionId: context.connectionId,
      sourceDeviceId: context.peer.local.deviceId,
      targetDeviceId: context.peer.remote.deviceId,
      sequence: context.sendSequence,
      capability,
      payload
    }, context.peer.secrets.devicePrivateKey);
  }

  async sendDataEnvelope(context, messageType, capability, payload) {
    if (context.closed) throw new Error('peer-closed');
    await context.open.promise;
    const envelope = this.createSignedEnvelope(context, messageType, capability, payload);
    context.window.webContents.send('mesh-peer:send', { token: context.token, message: envelope });
    return envelope.messageId;
  }

  verifyRemoteEnvelope(context, envelope, expected = {}) {
    return verifyEnvelope(envelope, context.peer.remote.devicePublicKey, {
      connectionId: context.connectionId,
      sourceDeviceId: context.peer.remote.deviceId,
      targetDeviceId: context.peer.local.deviceId,
      ...expected
    }, { sequenceGuard: this.sequenceGuard });
  }

  emitState(context, state) {
    this.onState({ ...publicConnection(context), state });
  }

  failContext(context, error) {
    context.signal.reject(error);
    context.open.reject(error);
    context.auth.reject(error);
    for (const ack of context.pendingAcks.values()) ack.reject(error);
    this.emitState(context, 'error');
    this.closeContext(context, safeError(error));
  }

  closeContext(context, reason, options = {}) {
    if (!context || context.closed) return;
    context.closed = true;
    context.inventoryAssembler.clear();
    this.contextsByToken.delete(context.token);
    const routed = this.ipcRouter.contexts.get(context.token);
    if (routed?.context === context) this.ipcRouter.contexts.delete(context.token);
    this.connectionsById.delete(context.connectionId);
    if (this.connectionsByDevice.get(context.peer.remote.deviceId) === context) {
      this.connectionsByDevice.delete(context.peer.remote.deviceId);
    }
    this.sequenceGuard.clearConnection(context.connectionId);
    this.meshService.setRemoteConnectionState(context.peer.remote.deviceId, 'disconnected');
    if (options.destroyWindow !== false && !context.window.isDestroyed()) {
      context.window.webContents.send('mesh-peer:close', { token: context.token, reason });
      context.window.destroy();
    }
    this.onState({ ...publicConnection(context), state: 'disconnected', reason });
  }
}

function sharedIpcRouter(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('peer-ipc-unavailable');
  const existing = IPC_ROUTERS.get(ipcMain);
  if (existing) return existing;
  const router = { contexts: new Map() };
  const handle = (channel, callback) => {
    ipcMain.handle(channel, async (event, input = {}) => {
      try {
        const routed = router.contexts.get(String(input.token || ''));
        const context = routed?.context;
        if (!context || context.closed || event.sender.id !== context.window.webContents.id) {
          throw new Error('peer-ipc-source-invalid');
        }
        return await callback(routed.manager, context, input);
      } catch (error) {
        return { ok: false, reasonCode: safeError(error) };
      }
    });
  };
  handle('mesh-peer:bootstrap', async (_manager, context) => ({
    ok: true,
    role: context.role,
    remoteDescription: context.remoteDescription,
    iceServers: context.iceServers
  }));
  handle('mesh-peer:signal', async (_manager, context, input) => {
    const signal = normalizePeerSignal(input.signal, context.role);
    context.signal.resolve(signal);
    return { ok: true };
  });
  handle('mesh-peer:state', async (manager, context, input) => {
    await manager.receiveRendererState(context, input.state);
    return { ok: true };
  });
  handle('mesh-peer:message', async (manager, context, input) => {
    await manager.receiveDataEnvelope(context, input.message);
    return { ok: true };
  });
  IPC_ROUTERS.set(ipcMain, router);
  return router;
}

function normalizePeerSignal(value, role) {
  const expected = role === 'offerer' ? 'offer' : 'answer';
  if (value?.type !== expected) throw new Error('peer-signal-type');
  return { type: expected, description: normalizeDescription(value.description, expected) };
}

function normalizeDescription(value, expectedType) {
  if (!value || value.type !== expectedType) throw new Error('peer-description-type');
  const sdp = String(value.sdp || '');
  if (!sdp || Buffer.byteLength(sdp) > MAX_SDP_BYTES) throw new Error('peer-description-size');
  return { type: expectedType, sdp };
}

function normalizeIceServers(value) {
  const servers = [];
  for (const item of Array.isArray(value) ? value : []) {
    const urls = (Array.isArray(item?.urls) ? item.urls : [item?.urls])
      .map((url) => String(url || '').trim())
      .filter((url) => /^(stun|turn|turns):/i.test(url))
      .slice(0, 8);
    if (!urls.length) continue;
    servers.push({
      urls,
      username: cleanText(item.username, 256) || undefined,
      credential: cleanText(item.credential, 512) || undefined
    });
  }
  return servers.slice(0, 8);
}

function normalizeTransport(value = {}) {
  const allowCandidates = new Set(['host', 'srflx', 'prflx', 'relay']);
  const allowProtocols = new Set(['udp', 'tcp']);
  return {
    channel: 'control.reliable',
    ordered: value.ordered === true,
    candidateTypes: [...new Set((value.candidateTypes || []).map(String).filter((item) => allowCandidates.has(item)))],
    protocols: [...new Set((value.protocols || []).map(String).filter((item) => allowProtocols.has(item)))],
    selectedPairState: cleanText(value.selectedPairState, 24) || 'unknown'
  };
}

function publicConnection(context) {
  return {
    connectionId: context.connectionId,
    deviceId: context.peer.remote.deviceId,
    deviceName: context.peer.remote.name,
    role: context.role,
    authenticated: context.authenticated,
    signalingPath: context.signalingPath,
    signalingService: context.signalingService,
    networkPath: networkPath(context.transport),
    transport: context.transport
  };
}

function networkPath(transport) {
  const candidates = new Set(Array.isArray(transport?.candidateTypes) ? transport.candidateTypes : []);
  if (candidates.has('relay')) return 'relay';
  if (candidates.has('srflx') || candidates.has('prflx')) return 'direct';
  if (candidates.has('host')) return 'lan';
  return 'unknown';
}

function deferred(timeoutMs, timeoutCode) {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((res, rej) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res(value);
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(error instanceof Error ? error : new Error(String(error)));
    };
  });
  const timer = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
  promise.catch(() => {});
  return { promise, resolve, reject };
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
  return String(error?.message || error || 'peer-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'peer-failed';
}

module.exports = {
  PEER_TIMEOUT_MS,
  PeerManager,
  normalizePeerSignal,
  normalizeDescription,
  normalizeIceServers,
  normalizeTransport,
  networkPath,
  publicConnection,
  sharedIpcRouter
};
