const crypto = require('node:crypto');
const path = require('node:path');
const { KNOWN_CAPABILITIES, requireCapability } = require('../domain/capabilities');
const { createEnvelope, verifyEnvelope, SequenceGuard } = require('../protocol/envelope');
const { createDeviceProof, verifyDeviceProof } = require('../protocol/handshake');
const { encodeInventoryChunks, InventoryAssembler } = require('../protocol/inventory');
const {
  createCatalogEventBatches,
  normalizeCatalogEventBatch,
  normalizeCatalogSyncMarker,
  normalizeCatalogVector
} = require('../protocol/catalog-events');
const {
  PROTOCOL_FEATURES,
  KNOWN_PROTOCOL_FEATURES,
  normalizeProtocolFeatures,
  negotiateProtocolFeatures
} = require('../protocol/features');

const PEER_TIMEOUT_MS = 30_000;
// Full snapshots are the current recovery baseline. Keep them comfortably inside
// inventory's five-minute stale window until revision deltas replace this timer.
const INVENTORY_RESYNC_INTERVAL_MS = 4 * 60_000;
const INVENTORY_REFRESH_MIN_INTERVAL_MS = 10_000;
const MAX_PENDING_INVENTORY_REFRESH_REQUESTS = 4;
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
    this.protocolFeatures = normalizeProtocolFeatures(
      options.protocolFeatures === undefined ? KNOWN_PROTOCOL_FEATURES : options.protocolFeatures
    );
    this.contextsByToken = new Map();
    this.connectionsById = new Map();
    this.connectionsByDevice = new Map();
    this.sequenceGuard = new SequenceGuard(4096);
    this.ipcRouter = sharedIpcRouter(this.ipcMain);
  }

  async connect(deviceId) {
    const existing = this.connectionsByDevice.get(String(deviceId));
    if (existing?.authenticated && !existing.window.isDestroyed()) {
      await this.requestRemoteInventory(existing);
      return publicConnection(existing);
    }
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
        proof: helloProof,
        supportedCapabilities: KNOWN_CAPABILITIES,
        protocolFeatures: this.protocolFeatures,
        runtimeMetadata: this.meshService.getLocalRuntimeMetadata(),
        catalogVector: this.meshService.getCatalogEventVector()
      });
      await context.auth.promise;
      await context.firstCatalog.promise;
      await context.firstInventory.promise;
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

  handlePermissionsChanged(deviceId, permissions = []) {
    const context = this.connectionsByDevice.get(String(deviceId));
    if (!context || context.closed) return false;
    const hadCatalog = context.peer.remote.permissions?.includes('catalog.manage') === true;
    context.peer.remote = {
      ...context.peer.remote,
      permissions: Array.isArray(permissions) ? [...permissions] : []
    };
    try {
      requireCapability(context.peer.remote, 'inventory.read');
      const hasCatalog = context.peer.remote.permissions?.includes('catalog.manage') === true;
      if (
        hadCatalog
        && !hasCatalog
        && (
          this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)
          || this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)
        )
      ) {
        context.firstCatalog.resolve({ skipped: true, reason: 'catalog-capability-revoked' });
        void this.sendCatalogUnavailable(context, 'catalog-capability-revoked').catch(() => false);
      }
      return true;
    } catch (_error) {
      this.closeContext(context, 'capability-revoked:inventory.read');
      return false;
    }
  }

  disconnectAll(reason = 'app-quit') {
    for (const context of [...this.connectionsById.values()]) this.closeContext(context, reason);
  }

  listConnections() {
    return [...this.connectionsById.values()].map(publicConnection);
  }

  isCurrentConnection(context) {
    return Boolean(
      context
      && !context.closed
      && context.authenticated
      && !context.window.isDestroyed()
      && this.connectionsById.get(context.connectionId) === context
      && this.connectionsByDevice.get(context.peer.remote.deviceId) === context
    );
  }

  async broadcastInventory() {
    const contexts = [...this.connectionsById.values()]
      .filter((context) => context.authenticated && !context.closed && !context.window.isDestroyed());
    const results = await Promise.allSettled(contexts.map((context) => (
      this.queueInventorySend(context, { requireFresh: true })
    )));
    results.forEach((result, index) => {
      if (result.status === 'rejected') this.failContext(contexts[index], result.reason);
    });
    return results.filter((result) => result.status === 'fulfilled').length;
  }

  async broadcastCatalog() {
    const contexts = [...this.connectionsById.values()]
      .filter((context) => (
        context.authenticated
        && !context.closed
        && !context.window.isDestroyed()
        && (
          this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)
          || this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)
        )
        && context.peer.remote.permissions?.includes('catalog.manage')
      ));
    const results = await Promise.allSettled(contexts.map((context) => this.queueCatalogSend(context)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') this.failContext(contexts[index], result.reason);
    });
    return results.filter((result) => result.status === 'fulfilled').length;
  }

  async refreshInventory(deviceId) {
    const context = this.connectionsByDevice.get(String(deviceId));
    if (!context?.authenticated || context.window.isDestroyed()) return this.connect(deviceId);
    await this.requestRemoteInventory(context);
    return publicConnection(context);
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
      firstCatalog: deferred(PEER_TIMEOUT_MS, 'catalog-initial-timeout'),
      firstInventory: deferred(PEER_TIMEOUT_MS, 'inventory-initial-timeout'),
      remoteProtocolFeatures: [],
      negotiatedProtocolFeatures: [],
      remoteCatalogVector: {},
      incomingCatalogSyncs: new Map(),
      pendingAcks: new Map(),
      pendingInventoryRefreshes: new Map(),
      inventoryAssembler: new InventoryAssembler(),
      lastReceivedInventoryRevision: Number(input.peer.remote.inventoryRevision) || 0,
      inventoryStarted: false,
      catalogStarted: false,
      catalogSendPromise: null,
      catalogSendFollowup: false,
      initialSyncPromise: null,
      generation: 0,
      inventorySendPromise: null,
      inventorySendFollowupPromise: null,
      remoteInventoryRefreshPromise: null,
      incomingInventoryRefreshPromise: null,
      incomingInventoryRefreshWaiters: 0,
      activeIncomingInventoryRefreshIds: new Set(),
      inventoryRefreshDelay: null,
      lastInventorySnapshotStartedAt: 0,
      inventoryResyncTimer: null,
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
    if (messageType.startsWith('inventory.') && capability !== 'inventory.read') {
      throw new Error('peer-capability-mismatch');
    }
    if (messageType.startsWith('catalog.') && capability !== 'catalog.manage') {
      throw new Error('peer-capability-mismatch');
    }
    assertSemanticCapability(messageType, capability);
    try {
      this.requireCurrentCapability(context, capability);
    } catch (error) {
      if (messageType.startsWith('catalog.') && String(error?.message || '').startsWith('capability-denied:')) {
        context.firstCatalog.resolve({ skipped: true, reason: 'catalog-capability-denied' });
        return;
      }
      throw error;
    }

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
      this.updateRemoteCapabilities(context, payload?.supportedCapabilities);
      this.updateRemoteProtocolFeatures(context, payload?.protocolFeatures);
      this.updateRemoteRuntimeMetadata(context, payload?.runtimeMetadata);
      this.updateRemoteCatalogVector(context, payload?.catalogVector);
      await this.finishAuthenticated(context);
      await this.sendDataEnvelope(context, 'connection.ready', 'inventory.read', {
        accepted: true,
        supportedCapabilities: KNOWN_CAPABILITIES,
        protocolFeatures: this.protocolFeatures,
        runtimeMetadata: this.meshService.getLocalRuntimeMetadata(),
        catalogVector: this.meshService.getCatalogEventVector()
      });
      this.startInitialSync(context);
      return;
    }
    if (messageType === 'connection.ready') {
      if (context.role !== 'offerer' || !context.answerAuthenticated) throw new Error('peer-ready-unexpected');
      this.updateRemoteCapabilities(context, payload?.supportedCapabilities);
      this.updateRemoteProtocolFeatures(context, payload?.protocolFeatures);
      this.updateRemoteRuntimeMetadata(context, payload?.runtimeMetadata);
      this.updateRemoteCatalogVector(context, payload?.catalogVector);
      await this.finishAuthenticated(context);
      this.startInitialSync(context);
      return;
    }
    if (messageType === 'connection.close') {
      this.closeContext(context, payload?.reason || 'remote-disconnect');
      return;
    }
    if (!context.authenticated) throw new Error('peer-not-authenticated');

    if (messageType === 'connection.catalog-unavailable') {
      if (
        !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)
        && !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)
      ) {
        throw new Error('peer-feature-not-negotiated');
      }
      if (payload?.status !== 'unavailable') throw new Error('catalog-sync-status-invalid');
      context.firstCatalog.resolve({
        skipped: true,
        reason: cleanText(payload?.reason, 80) || 'catalog-unavailable'
      });
      this.emitState(context, 'catalog-unavailable');
      return;
    }

    if (messageType === 'catalog.events.batch') {
      if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)) {
        throw new Error('peer-feature-not-negotiated');
      }
      const batch = normalizeCatalogEventBatch(payload);
      if (batch.meshId !== context.peer.mesh.meshId) throw new Error('catalog-sync-mesh-mismatch');
      if (batch.sourceDeviceId !== context.peer.remote.deviceId) throw new Error('catalog-sync-source-mismatch');
      let incomingSync = context.incomingCatalogSyncs.get(batch.syncId);
      if (!incomingSync) {
        incomingSync = { batches: new Set(), inserted: 0, changed: false, unresolvedEventIds: [] };
        context.incomingCatalogSyncs.set(batch.syncId, incomingSync);
      }
      if (incomingSync.batches.has(batch.batchIndex)) throw new Error('catalog-sync-batch-duplicate');
      const applied = this.meshService.applyRemoteCatalogEvents({
        deviceId: context.peer.remote.deviceId,
        events: batch.events
      });
      incomingSync.batches.add(batch.batchIndex);
      incomingSync.inserted += Number(applied.inserted || 0);
      incomingSync.changed = incomingSync.changed || applied.changed === true;
      incomingSync.unresolvedEventIds = applied.unresolvedEventIds || [];
      this.emitState(context, 'catalog-events-received');
      return;
    }

    if (messageType === 'catalog.events.complete') {
      if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)) {
        throw new Error('peer-feature-not-negotiated');
      }
      const marker = normalizeCatalogSyncMarker(payload);
      if (marker.meshId !== context.peer.mesh.meshId) throw new Error('catalog-sync-mesh-mismatch');
      if (marker.sourceDeviceId !== context.peer.remote.deviceId) throw new Error('catalog-sync-source-mismatch');
      const incomingSync = context.incomingCatalogSyncs.get(marker.syncId) || {
        batches: new Set(),
        inserted: 0,
        changed: false,
        unresolvedEventIds: []
      };
      if (incomingSync.batches.size !== marker.batchCount) throw new Error('catalog-sync-batch-missing');
      for (let index = 0; index < marker.batchCount; index += 1) {
        if (!incomingSync.batches.has(index)) throw new Error('catalog-sync-batch-missing');
      }
      if (incomingSync.unresolvedEventIds.length) throw new Error('catalog-sync-causal-gap');
      const localVector = this.meshService.getCatalogEventVector();
      for (const [deviceId, sequence] of Object.entries(marker.vector)) {
        if (Number(localVector[deviceId] || 0) < sequence) throw new Error('catalog-sync-vector-gap');
      }
      this.updateRemoteCatalogVector(context, marker.vector);
      context.incomingCatalogSyncs.delete(marker.syncId);
      context.firstCatalog.resolve({
        revision: Math.max(0, ...Object.values(localVector)),
        changed: incomingSync.changed,
        inserted: incomingSync.inserted
      });
      await this.sendDataEnvelope(context, 'catalog.events.ack', 'catalog.manage', {
        schemaVersion: marker.schemaVersion,
        syncId: marker.syncId,
        meshId: context.peer.mesh.meshId,
        sourceDeviceId: context.peer.local.deviceId,
        batchCount: marker.batchCount,
        vector: localVector
      });
      this.emitState(context, 'catalog-synced');
      if (incomingSync.inserted > 0) {
        void this.broadcastCatalog().catch(() => false);
      }
      return;
    }

    if (messageType === 'catalog.events.ack') {
      if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)) {
        throw new Error('peer-feature-not-negotiated');
      }
      const marker = normalizeCatalogSyncMarker(payload);
      if (marker.meshId !== context.peer.mesh.meshId) throw new Error('catalog-sync-mesh-mismatch');
      if (marker.sourceDeviceId !== context.peer.remote.deviceId) throw new Error('catalog-sync-source-mismatch');
      this.updateRemoteCatalogVector(context, marker.vector);
      return;
    }

    if (messageType === 'catalog.snapshot') {
      if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)) {
        throw new Error('peer-feature-not-negotiated');
      }
      const applied = this.meshService.applyRemoteCatalog({
        deviceId: context.peer.remote.deviceId,
        snapshot: payload
      });
      context.firstCatalog.resolve({
        revision: applied.catalogRevision,
        changed: applied.changed
      });
      this.emitState(context, 'catalog-synced');
      return;
    }

    if (messageType === 'inventory.chunk') {
      const assembled = context.inventoryAssembler.accept(payload);
      if (assembled.complete) {
        if (assembled.inventory.revision <= context.lastReceivedInventoryRevision) {
          throw new Error('inventory-revision-stale');
        }
        this.meshService.applyRemoteInventory({
          deviceId: context.peer.remote.deviceId,
          inventory: assembled.inventory,
          allowLegacyCatalogProjection: (
            !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.INVENTORY_DEVICE_FACTS_V1)
            && this.hasCurrentCapability(context, 'catalog.manage')
          )
        });
        context.lastReceivedInventoryRevision = Math.max(
          context.lastReceivedInventoryRevision,
          assembled.inventory.revision
        );
      }
      // The final ACK is deliberately sent only after the SQLite transaction
      // commits, so refresh.complete can never report an unapplied snapshot.
      await this.sendDataEnvelope(context, 'inventory.chunk.ack', 'inventory.read', {
        transferId: assembled.transferId,
        index: assembled.index
      });
      if (assembled.complete) {
        context.firstInventory.resolve({ revision: assembled.inventory.revision });
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
    if (messageType === 'inventory.refresh.request') {
      const requestId = requiredText(payload?.requestId, 'inventory-refresh-request', 128);
      await this.handleInventoryRefreshRequest(context, requestId);
      return;
    }
    if (messageType === 'inventory.refresh.complete') {
      const requestId = requiredText(payload?.requestId, 'inventory-refresh-request', 128);
      const pending = context.pendingInventoryRefreshes.get(requestId);
      if (!pending) return;
      const revision = nonNegativeInteger(payload?.revision, 'inventory-refresh-revision');
      if (
        revision <= pending.baselineRevision
        || context.lastReceivedInventoryRevision < revision
      ) {
        pending.waiter.reject(new Error('inventory-refresh-not-applied'));
        context.pendingInventoryRefreshes.delete(requestId);
        return;
      }
      pending.waiter.resolve({
        requestId,
        revision
      });
      context.pendingInventoryRefreshes.delete(requestId);
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

  updateRemoteCapabilities(context, capabilities) {
    if (!Array.isArray(capabilities)) return false;
    this.meshService.updateRemoteCapabilities(context.peer.remote.deviceId, capabilities);
    const refreshed = this.meshService.getPeerContext(context.peer.remote.deviceId);
    context.peer.remote = {
      ...context.peer.remote,
      capabilities: [...refreshed.remote.capabilities]
    };
    return true;
  }

  updateRemoteProtocolFeatures(context, features) {
    context.remoteProtocolFeatures = normalizeProtocolFeatures(features);
    context.negotiatedProtocolFeatures = negotiateProtocolFeatures(
      this.protocolFeatures,
      context.remoteProtocolFeatures
    );
    return context.negotiatedProtocolFeatures;
  }

  updateRemoteRuntimeMetadata(context, value) {
    const metadata = normalizeRuntimeMetadata(value);
    if (!metadata) return false;
    this.meshService.updateRemoteRuntimeMetadata(context.peer.remote.deviceId, metadata);
    context.peer.remote = { ...context.peer.remote, ...metadata };
    return true;
  }

  updateRemoteCatalogVector(context, value) {
    try {
      context.remoteCatalogVector = normalizeCatalogVector(value);
      return true;
    } catch (_error) {
      context.remoteCatalogVector = {};
      return false;
    }
  }

  supportsProtocolFeature(context, feature) {
    return Array.isArray(context?.negotiatedProtocolFeatures)
      && context.negotiatedProtocolFeatures.includes(feature);
  }

  startInventorySync(context) {
    if (context.inventoryStarted || context.closed) return;
    context.inventoryStarted = true;
    context.inventoryResyncTimer = setInterval(() => {
      if (context.closed || !context.authenticated) return;
      void this.queueInventorySend(context, { requireFresh: true })
        .catch((error) => this.failContext(context, error));
    }, INVENTORY_RESYNC_INTERVAL_MS);
    context.inventoryResyncTimer.unref?.();
    void this.queueInventorySend(context).catch((error) => this.failContext(context, error));
  }

  startInitialSync(context) {
    if (context.initialSyncPromise || context.closed) return context.initialSyncPromise;
    const operation = this.startCatalogSync(context)
      .then(() => this.startInventorySync(context));
    context.initialSyncPromise = operation;
    operation.catch((error) => this.failContext(context, error));
    return operation;
  }

  async startCatalogSync(context) {
    if (context.catalogStarted || context.closed) return;
    context.catalogStarted = true;
    if (
      !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)
      && !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)
    ) {
      context.firstCatalog.resolve({ skipped: true, reason: 'catalog-feature-unavailable' });
      this.emitState(context, 'catalog-unavailable');
      return;
    }
    try {
      this.requireCurrentCapability(context, 'catalog.manage');
    } catch (error) {
      if (String(error?.message || '').startsWith('capability-denied:')) {
        context.firstCatalog.resolve({ skipped: true, reason: 'catalog-capability-denied' });
        await this.sendCatalogUnavailable(context, 'catalog-capability-denied');
        this.emitState(context, 'catalog-unavailable');
        return;
      }
      throw error;
    }
    await this.queueCatalogSend(context);
  }

  queueCatalogSend(context) {
    this.assertContextActive(context, context?.generation);
    if (context.catalogSendPromise) {
      context.catalogSendFollowup = true;
      return context.catalogSendPromise;
    }
    const generation = context.generation;
    const operation = Promise.resolve().then(async () => {
      do {
        context.catalogSendFollowup = false;
        this.assertContextActive(context, generation);
        if (this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)) {
          await this.sendCatalogEvents(context, generation);
        } else {
          await this.sendCatalogSnapshot(context);
        }
      } while (context.catalogSendFollowup && !context.closed);
    });
    context.catalogSendPromise = operation;
    const clear = () => {
      if (context.catalogSendPromise === operation) context.catalogSendPromise = null;
    };
    operation.then(clear, clear);
    return operation;
  }

  async sendCatalogEvents(context, generation = context?.generation) {
    if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)) {
      throw new Error('peer-feature-not-negotiated');
    }
    this.assertContextActive(context, generation);
    const sync = this.meshService.createCatalogEventSync(context.remoteCatalogVector || {});
    const syncId = crypto.randomUUID();
    const batches = createCatalogEventBatches({
      syncId,
      meshId: sync.meshId,
      sourceDeviceId: sync.sourceDeviceId,
      events: sync.events
    });
    for (const batch of batches) {
      this.assertContextActive(context, generation);
      await this.sendDataEnvelope(context, 'catalog.events.batch', 'catalog.manage', batch);
    }
    this.assertContextActive(context, generation);
    await this.sendDataEnvelope(context, 'catalog.events.complete', 'catalog.manage', {
      schemaVersion: 1,
      syncId,
      meshId: sync.meshId,
      sourceDeviceId: sync.sourceDeviceId,
      batchCount: batches.length,
      vector: sync.vector
    });
    return sync.vector;
  }

  sendCatalogSnapshot(context) {
    if (!this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)) {
      throw new Error('peer-feature-not-negotiated');
    }
    const snapshot = this.meshService.createCatalogSnapshot();
    return this.sendDataEnvelope(context, 'catalog.snapshot', 'catalog.manage', snapshot);
  }

  sendCatalogUnavailable(context, reason) {
    if (
      !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_EVENTS_V1)
      && !this.supportsProtocolFeature(context, PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1)
    ) {
      return Promise.resolve(false);
    }
    return this.sendDataEnvelope(context, 'connection.catalog-unavailable', 'inventory.read', {
      status: 'unavailable',
      reason: cleanText(reason, 80) || 'catalog-unavailable'
    });
  }

  queueInventorySend(context, options = {}) {
    this.assertContextActive(context, context?.generation);
    if (context.inventorySendPromise) {
      if (options.requireFresh !== true) return context.inventorySendPromise;
      if (context.inventorySendFollowupPromise) return context.inventorySendFollowupPromise;
      const generation = context.generation;
      const followup = context.inventorySendPromise.then(() => {
        this.assertContextActive(context, generation);
        return this.queueInventorySend(context);
      });
      context.inventorySendFollowupPromise = followup;
      const clearFollowup = () => {
        if (context.inventorySendFollowupPromise === followup) {
          context.inventorySendFollowupPromise = null;
        }
      };
      followup.then(clearFollowup, clearFollowup);
      return followup;
    }
    const generation = context.generation;
    const operation = Promise.resolve().then(() => {
      this.assertContextActive(context, generation);
      return this.sendInventory(context, generation);
    });
    context.inventorySendPromise = operation;
    const clear = () => {
      if (context.inventorySendPromise === operation) context.inventorySendPromise = null;
    };
    operation.then(clear, clear);
    return operation;
  }

  async sendInventory(context, generation = context?.generation) {
    this.assertContextActive(context, generation);
    this.requireCurrentCapability(context, 'inventory.read');
    context.lastInventorySnapshotStartedAt = Date.now();
    const inventory = this.meshService.createInventorySnapshot({
      includeLegacyCatalogProjection: !this.supportsProtocolFeature(
        context,
        PROTOCOL_FEATURES.INVENTORY_DEVICE_FACTS_V1
      )
    });
    this.assertContextActive(context, generation);
    const chunks = encodeInventoryChunks(inventory);
    for (const chunk of chunks) {
      this.assertContextActive(context, generation);
      const key = `${chunk.transferId}:${chunk.index}`;
      const ack = deferred(PEER_TIMEOUT_MS, 'inventory-chunk-ack-timeout');
      context.pendingAcks.set(key, ack);
      try {
        await this.sendDataEnvelope(context, 'inventory.chunk', 'inventory.read', chunk);
        await ack.promise;
        this.assertContextActive(context, generation);
      } finally {
        if (context.pendingAcks.get(key) === ack) {
          ack.reject(new Error('inventory-chunk-send-aborted'));
          context.pendingAcks.delete(key);
        }
      }
    }
    return inventory.revision;
  }

  async handleInventoryRefreshRequest(context, requestId) {
    if (context.incomingInventoryRefreshWaiters >= MAX_PENDING_INVENTORY_REFRESH_REQUESTS) {
      throw new Error('inventory-refresh-rate-limited');
    }
    if (context.activeIncomingInventoryRefreshIds.has(requestId)) {
      throw new Error('inventory-refresh-request-duplicate');
    }
    context.incomingInventoryRefreshWaiters += 1;
    context.activeIncomingInventoryRefreshIds.add(requestId);
    try {
      const revision = await this.queueIncomingInventoryRefresh(context);
      this.assertContextActive(context, context.generation);
      await this.sendDataEnvelope(context, 'inventory.refresh.complete', 'inventory.read', {
        requestId,
        revision
      });
    } finally {
      context.activeIncomingInventoryRefreshIds.delete(requestId);
      context.incomingInventoryRefreshWaiters = Math.max(0, context.incomingInventoryRefreshWaiters - 1);
    }
  }

  queueIncomingInventoryRefresh(context) {
    this.assertContextActive(context, context?.generation);
    if (context.incomingInventoryRefreshPromise) return context.incomingInventoryRefreshPromise;
    const generation = context.generation;
    const operation = (async () => {
      // A refresh must advance beyond any snapshot that was already in flight
      // when the request arrived. Reusing that snapshot can race its final ACK
      // and report the requester's existing revision as fresh.
      const alreadyQueued = context.inventorySendFollowupPromise || context.inventorySendPromise;
      if (alreadyQueued) await alreadyQueued;
      this.assertContextActive(context, generation);
      const elapsed = Date.now() - context.lastInventorySnapshotStartedAt;
      const delayMs = Math.max(0, INVENTORY_REFRESH_MIN_INTERVAL_MS - elapsed);
      if (context.lastInventorySnapshotStartedAt > 0 && delayMs > 0) {
        await this.waitForInventoryRefreshWindow(context, generation, delayMs);
      }
      this.assertContextActive(context, generation);
      return this.queueInventorySend(context, { requireFresh: true });
    })();
    context.incomingInventoryRefreshPromise = operation;
    const clear = () => {
      if (context.incomingInventoryRefreshPromise === operation) {
        context.incomingInventoryRefreshPromise = null;
      }
    };
    operation.then(clear, clear);
    return operation;
  }

  waitForInventoryRefreshWindow(context, generation, delayMs) {
    if (delayMs <= 0) return Promise.resolve();
    let settled = false;
    let timer = null;
    let resolveWait;
    let rejectWait;
    const promise = new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (context.inventoryRefreshDelay?.promise === promise) context.inventoryRefreshDelay = null;
      resolveWait();
    }, delayMs);
    context.inventoryRefreshDelay = {
      promise,
      cancel: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectWait(error);
      }
    };
    promise.catch(() => {});
    if (context.closed || context.generation !== generation) {
      context.inventoryRefreshDelay?.cancel(new Error('peer-closed'));
    }
    return promise.finally(() => {
      if (context.inventoryRefreshDelay?.promise === promise) context.inventoryRefreshDelay = null;
    });
  }

  requestRemoteInventory(context) {
    if (!context?.authenticated || context.closed) throw new Error('peer-not-connected');
    this.requireCurrentCapability(context, 'inventory.read');
    if (context.remoteInventoryRefreshPromise) return context.remoteInventoryRefreshPromise;
    const operation = this.performRemoteInventoryRefresh(context);
    context.remoteInventoryRefreshPromise = operation;
    const clear = () => {
      if (context.remoteInventoryRefreshPromise === operation) {
        context.remoteInventoryRefreshPromise = null;
      }
    };
    operation.then(clear, clear);
    return operation;
  }

  async performRemoteInventoryRefresh(context) {
    const requestId = crypto.randomUUID();
    const pending = {
      baselineRevision: context.lastReceivedInventoryRevision,
      waiter: deferred(PEER_TIMEOUT_MS, 'inventory-refresh-timeout')
    };
    context.pendingInventoryRefreshes.set(requestId, pending);
    try {
      await this.sendDataEnvelope(context, 'inventory.refresh.request', 'inventory.read', { requestId });
      return await pending.waiter.promise;
    } catch (error) {
      pending.waiter.reject(error);
      throw error;
    } finally {
      context.pendingInventoryRefreshes.delete(requestId);
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
    if (messageType.startsWith('inventory.') && capability !== 'inventory.read') {
      throw new Error('peer-capability-mismatch');
    }
    if (messageType.startsWith('catalog.') && capability !== 'catalog.manage') {
      throw new Error('peer-capability-mismatch');
    }
    assertSemanticCapability(messageType, capability);
    this.requireCurrentCapability(context, capability);
    await context.open.promise;
    this.assertContextActive(context, context.generation);
    const envelope = this.createSignedEnvelope(context, messageType, capability, payload);
    context.window.webContents.send('mesh-peer:send', { token: context.token, message: envelope });
    return envelope.messageId;
  }

  requireCurrentCapability(context, capability) {
    if (!context || context.closed) throw new Error('peer-closed');
    // Permission edits synchronously refresh this snapshot through
    // handlePermissionsChanged. Inventory and the independent global catalog
    // additionally re-read SQLite for every message. Avoid opening SQLite for
    // high-frequency input.motion/input.keys traffic.
    if (!['inventory.read', 'catalog.manage'].includes(capability)) {
      requireCapability(context.peer.remote, capability);
      return context.peer.remote;
    }
    const current = this.meshService.getPeerContext(context.peer.remote.deviceId);
    if (
      current.mesh.meshId !== context.peer.mesh.meshId
      || current.local.deviceId !== context.peer.local.deviceId
      || current.remote.deviceId !== context.peer.remote.deviceId
    ) {
      throw new Error('peer-context-changed');
    }
    requireCapability(current.remote, capability);
    context.peer.remote = {
      ...context.peer.remote,
      ...current.remote,
      devicePublicKey: context.peer.remote.devicePublicKey
    };
    return current.remote;
  }

  hasCurrentCapability(context, capability) {
    try {
      this.requireCurrentCapability(context, capability);
      return true;
    } catch (_error) {
      return false;
    }
  }

  assertContextActive(context, generation) {
    if (
      !context
      || context.closed
      || context.generation !== generation
      || context.window.isDestroyed()
    ) {
      throw new Error('peer-closed');
    }
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
    context.firstCatalog?.reject(error);
    context.firstInventory?.reject(error);
    for (const ack of context.pendingAcks.values()) ack.reject(error);
    for (const pending of context.pendingInventoryRefreshes?.values() || []) pending.waiter.reject(error);
    this.emitState(context, 'error');
    this.closeContext(context, safeError(error));
  }

  closeContext(context, reason, options = {}) {
    if (!context || context.closed) return;
    context.closed = true;
    context.generation += 1;
    clearInterval(context.inventoryResyncTimer);
    context.inventoryResyncTimer = null;
    context.inventoryAssembler.clear();
    const closeError = new Error(cleanText(reason, 160) || 'peer-closed');
    context.signal?.reject(closeError);
    context.open?.reject(closeError);
    context.auth?.reject(closeError);
    context.firstCatalog?.reject(closeError);
    context.firstInventory?.reject(closeError);
    context.inventoryRefreshDelay?.cancel(closeError);
    context.inventoryRefreshDelay = null;
    for (const ack of context.pendingAcks.values()) ack.reject(closeError);
    context.pendingAcks.clear();
    for (const pending of context.pendingInventoryRefreshes?.values() || []) pending.waiter.reject(closeError);
    context.pendingInventoryRefreshes?.clear();
    context.activeIncomingInventoryRefreshIds?.clear();
    context.incomingCatalogSyncs?.clear();
    context.catalogSendFollowup = false;
    context.incomingInventoryRefreshWaiters = 0;
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
    protocolFeatures: Array.isArray(context.negotiatedProtocolFeatures)
      ? [...context.negotiatedProtocolFeatures]
      : [],
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

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function safeError(error) {
  return String(error?.message || error || 'peer-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'peer-failed';
}

function assertSemanticCapability(messageType, capability) {
  if (messageType === 'profile.launch' && capability !== 'profile.launch') {
    throw new Error('peer-capability-mismatch');
  }
  if (['agent.prepare', 'agent.prepare.status'].includes(messageType) && capability !== 'agent.prepare') {
    throw new Error('peer-capability-mismatch');
  }
}

function normalizeRuntimeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = {
    appVersion: cleanText(value.appVersion, 40),
    protocolVersion: cleanText(value.protocolVersion, 20),
    platform: cleanText(value.platform, 40),
    arch: cleanText(value.arch, 40),
    osVersion: cleanText(value.osVersion, 120)
  };
  if (Object.values(metadata).some((item) => !item)) return null;
  return metadata;
}

module.exports = {
  PEER_TIMEOUT_MS,
  INVENTORY_RESYNC_INTERVAL_MS,
  INVENTORY_REFRESH_MIN_INTERVAL_MS,
  MAX_PENDING_INVENTORY_REFRESH_REQUESTS,
  PROTOCOL_FEATURES,
  KNOWN_PROTOCOL_FEATURES,
  PeerManager,
  normalizePeerSignal,
  normalizeDescription,
  normalizeIceServers,
  normalizeTransport,
  normalizeRuntimeMetadata,
  networkPath,
  publicConnection,
  sharedIpcRouter
};
