const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { groupProfilesByIdentity } = require('../../identity-groups');
const { createLocalDevice, normalizeDevice, renameDevice } = require('../domain/device');
const { normalizeCatalog, reconcileLocalCatalog } = require('../domain/agent-catalog');
const {
  buildLocalInventory,
  normalizeInventory,
  mergeCatalogInventory,
  unifiedConversations
} = require('../domain/inventory');
const {
  KNOWN_CAPABILITIES,
  defaultPairedPermissions,
  updatePermissions
} = require('../domain/capabilities');
const {
  createMembershipCertificate,
  verifyMembershipCertificate,
  verifyMembershipChain
} = require('../protocol/handshake');
const {
  createPairingInvite,
  decodeInvitation,
  createJoinRequest,
  acceptJoinRequest,
  decryptJoinResponse
} = require('../protocol/pairing');
const { createMembershipEvent, verifyMembershipEvent } = require('../protocol/membership-events');
const { createIdentityBundle, createDeviceIdentityBundle } = require('../storage/secure-keys');
const { MeshStore } = require('../storage/mesh-store');

const PROTOCOL_VERSION = '1.0';

class MeshService {
  constructor(options = {}) {
    this.databasePath = options.databasePath;
    this.keyVault = options.keyVault;
    this.profilesProvider = options.profilesProvider || (() => []);
    this.sessionCountProvider = options.sessionCountProvider || (() => 0);
    this.sessionsProvider = options.sessionsProvider || (() => []);
    this.appVersion = options.appVersion || 'unknown';
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.osVersion = options.osVersion || os.release();
    this.hostname = options.hostname || os.hostname();
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.now = options.now || (() => new Date().toISOString());
    this.endpointProvider = options.endpointProvider || (() => []);
    this.signalingProvider = options.signalingProvider || (() => []);
    this.pairingTransport = options.pairingTransport || null;
    this.onDeviceRevoked = options.onDeviceRevoked || (() => {});
    this.activeInvites = new Map();
  }

  getOverview() {
    if (!fs.existsSync(this.databasePath)) return this.uninitializedOverview();
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return this.uninitializedOverview({ storageIncomplete: true });
      for (const device of snapshot.devices) {
        const membership = verifyMembershipChain(
          device.membershipCertificate,
          device.membershipChain,
          snapshot.mesh.rootPublicKey,
          { now: this.now() }
        );
        if (membership.ok && device.devicePublicKey !== membership.payload.devicePublicKey) {
          store.saveDevice(normalizeDevice({
            ...device,
            devicePublicKey: membership.payload.devicePublicKey
          }), this.now());
          device.devicePublicKey = membership.payload.devicePublicKey;
        }
      }
      let keyState = 'available';
      let catalog = normalizeCatalog(snapshot);
      try {
        const secrets = this.keyVault.load();
        const profiles = this.currentProfiles();
        catalog = reconcileLocalCatalog(snapshot, profiles, {
          deviceId: snapshot.mesh.localDeviceId,
          linkKey: secrets.identityLinkKey,
          sessionCounts: this.sessionCounts(profiles),
          randomUUID: this.randomUUID,
          now: this.now()
        });
        store.saveCatalog(catalog, this.now());
      } catch (error) {
        keyState = error?.message || 'mesh-keys-unavailable';
      }

      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (local) {
        const nextLocal = normalizeDevice({
          ...local,
          status: 'online',
          appVersion: this.appVersion,
          osVersion: this.osVersion,
          lastSeenAt: this.now(),
          signalUrls: this.currentSignalingUrls(local.signalUrls)
        });
        if (JSON.stringify(local) !== JSON.stringify(nextLocal)) store.saveDevice(nextLocal, this.now());
      }
      const refreshed = store.readSnapshot();
      return this.publicOverview({ ...refreshed, ...catalog }, keyState);
    } finally {
      store.close();
    }
  }

  initialize(input = {}) {
    if (fs.existsSync(this.databasePath)) {
      const store = new MeshStore(this.databasePath);
      try {
        if (store.isInitialized()) return this.getOverview();
      } finally {
        store.close();
      }
      throw new Error('mesh-storage-incomplete');
    }
    if (!this.keyVault.isAvailable()) throw new Error('os-key-protection-unavailable');
    if (this.keyVault.exists()) throw new Error('mesh-key-store-without-database');

    const now = this.now();
    const meshId = this.randomUUID();
    const deviceId = this.randomUUID();
    const bundle = createIdentityBundle();
    const certificate = createMembershipCertificate({
      meshId,
      deviceId,
      devicePublicKey: bundle.devicePublicKey,
      roles: ['controller', 'device.admin', 'catalog.manage']
    }, bundle.rootPrivateKey, { now, randomUUID: this.randomUUID });
    const verified = verifyMembershipCertificate(certificate, bundle.rootPublicKey, { now });
    if (!verified.ok) throw new Error(`local-membership-${verified.reason}`);

    const localDevice = createLocalDevice({
      deviceId,
      devicePublicKey: bundle.devicePublicKey,
      membershipCertificate: certificate,
      membershipChain: [],
      name: cleanName(input.deviceName) || defaultDeviceName(this.hostname),
      platform: this.platform,
      arch: this.arch,
      osVersion: this.osVersion,
      appVersion: this.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: KNOWN_CAPABILITIES,
      permissions: KNOWN_CAPABILITIES,
      endpoints: this.currentEndpoints(),
      signalUrls: this.currentSignalingUrls()
    }, { randomUUID: this.randomUUID, now });
    const profiles = this.currentProfiles();
    const catalog = reconcileLocalCatalog({}, profiles, {
      deviceId,
      linkKey: bundle.identityLinkKey,
      sessionCounts: this.sessionCounts(profiles),
      randomUUID: this.randomUUID,
      now
    });
    const mesh = {
      meshId,
      displayName: cleanName(input.displayName) || 'Personal Agent Mesh',
      rootPublicKey: bundle.rootPublicKey,
      protocolVersion: PROTOCOL_VERSION,
      localDeviceId: deviceId,
      createdAt: now
    };

    let store = null;
    try {
      this.keyVault.create(bundle);
      store = new MeshStore(this.databasePath);
      store.initialize(mesh, localDevice, catalog);
    } catch (error) {
      try { store?.destroy(); } catch (_storeError) { /* original error wins */ }
      try { this.keyVault.remove(); } catch (_keyError) { /* original error wins */ }
      throw error;
    } finally {
      store?.close();
    }
    return this.getOverview();
  }

  createInvite() {
    this.pruneInvites();
    this.activeInvites.clear();
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) throw new Error('local-device-not-found');
      const membership = verifyMembershipChain(
        local.membershipCertificate,
        local.membershipChain,
        snapshot.mesh.rootPublicKey,
        { now: this.now() }
      );
      if (!membership.ok || !membership.payload.roles.includes('device.admin')) {
        throw new Error('device-admin-required');
      }
      const secrets = this.keyVault.load();
      const record = createPairingInvite({
        meshId: snapshot.mesh.meshId,
        rootPublicKey: snapshot.mesh.rootPublicKey,
        sourceDeviceId: local.deviceId,
        sourceDeviceName: local.name,
        sourceCertificate: local.membershipCertificate,
        sourceCertificateChain: local.membershipChain,
        endpoints: this.currentEndpoints(),
        signalUrls: this.currentSignalingUrls(local.signalUrls)
      }, { devicePrivateKey: secrets.devicePrivateKey }, {
        now: this.now(),
        randomUUID: this.randomUUID
      });
      this.activeInvites.set(record.invite.inviteId, record);
      return {
        inviteId: record.invite.inviteId,
        code: record.code,
        shortCode: record.shortCode,
        expiresAt: record.invite.expiresAt,
        sourceDeviceName: local.name,
        endpoints: record.invite.endpoints,
        signalServiceCount: record.invite.signalUrls.length
      };
    } finally {
      store.close();
    }
  }

  cancelInvite(input = {}) {
    const inviteId = String(input.inviteId || '');
    if (inviteId) this.activeInvites.delete(inviteId);
    else this.activeInvites.clear();
    return true;
  }

  claimInvite(input = {}) {
    this.pruneInvites();
    const request = input.request;
    const record = this.activeInvites.get(String(request?.inviteId || ''));
    if (!record) throw new Error('pairing-invite-not-found');
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      if (store.isDeviceRevoked(request.deviceId)) throw new Error('device-revoked');
      if (snapshot.devices.some((device) => device.deviceId === request.deviceId)) {
        throw new Error('device-already-paired');
      }
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) throw new Error('local-device-not-found');
      const secrets = this.keyVault.load();
      const joinEvent = createMembershipEvent({
        sequence: store.nextMembershipSequence(),
        meshId: snapshot.mesh.meshId,
        eventType: 'device.joined',
        subjectDeviceId: request.deviceId,
        sourceDeviceId: local.deviceId,
        permissions: defaultPairedPermissions()
      }, {
        devicePrivateKey: secrets.devicePrivateKey,
        membershipCertificate: local.membershipCertificate,
        membershipChain: local.membershipChain
      }, { now: this.now(), randomUUID: this.randomUUID });
      const accepted = acceptJoinRequest(record, request, {
        devicePrivateKey: secrets.devicePrivateKey,
        displayName: snapshot.mesh.displayName,
        protocolVersion: snapshot.mesh.protocolVersion,
        createdAt: snapshot.mesh.createdAt,
        identityLinkKey: secrets.identityLinkKey,
        identityLinkKeyVersion: secrets.identityLinkKeyVersion,
        devices: snapshot.devices,
        catalog: normalizeCatalog(snapshot),
        membershipEvents: [...snapshot.membershipEvents, joinEvent]
      }, { now: this.now(), randomUUID: this.randomUUID });
      const remote = normalizeDevice({
        deviceId: request.deviceId,
        devicePublicKey: request.devicePublicKey,
        membershipCertificate: accepted.membershipCertificate,
        membershipChain: accepted.membershipChain,
        name: request.name,
        platform: request.platform,
        arch: request.arch,
        osVersion: request.osVersion,
        appVersion: request.appVersion,
        protocolVersion: request.protocolVersion,
        status: 'online',
        capabilities: KNOWN_CAPABILITIES,
        permissions: defaultPairedPermissions(),
        pairedAt: this.now(),
        lastSeenAt: this.now(),
        inventoryRevision: 0,
        endpoints: request.endpoints,
        signalUrls: request.signalUrls,
        isLocal: false
      });
      store.savePairedDevice(remote, joinEvent, this.now());
      this.activeInvites.delete(record.invite.inviteId);
      return { response: accepted.response };
    } finally {
      store.close();
    }
  }

  async join(input = {}) {
    if (fs.existsSync(this.databasePath)) {
      const existing = new MeshStore(this.databasePath);
      try {
        if (existing.isInitialized()) throw new Error('mesh-already-initialized');
      } finally {
        existing.close();
      }
    }
    if (!this.keyVault.isAvailable()) throw new Error('os-key-protection-unavailable');
    if (this.keyVault.exists()) throw new Error('mesh-key-store-without-database');
    if (typeof this.pairingTransport !== 'function') throw new Error('pairing-transport-unavailable');

    const invite = decodeInvitation(input.code, { now: this.now() });
    const identity = createDeviceIdentityBundle();
    const deviceId = this.randomUUID();
    const joiningSignalUrls = this.currentSignalingUrls(invite.signalUrls);
    const joined = createJoinRequest(invite, {
      deviceId,
      devicePublicKey: identity.devicePublicKey,
      name: cleanName(input.deviceName) || defaultDeviceName(this.hostname),
      platform: this.platform,
      arch: this.arch,
      osVersion: this.osVersion,
      appVersion: this.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      endpoints: this.currentEndpoints(),
      signalUrls: joiningSignalUrls
    }, { now: this.now() });
    const transportResult = await this.pairingTransport(invite, joined.request, {
      devicePrivateKey: identity.devicePrivateKey
    });
    const encrypted = transportResult?.response || transportResult;
    const payload = decryptJoinResponse(invite, joined.privateState, encrypted, { now: this.now() });
    if (payload.membershipCertificate.deviceId !== deviceId) throw new Error('pairing-response-device');
    for (const event of payload.membershipEvents || []) {
      const verified = verifyMembershipEvent(event, payload.mesh.rootPublicKey, { now: this.now() });
      if (!verified.ok) throw new Error(verified.reason);
    }
    const local = createLocalDevice({
      deviceId,
      devicePublicKey: identity.devicePublicKey,
      membershipCertificate: payload.membershipCertificate,
      membershipChain: payload.membershipChain,
      name: cleanName(input.deviceName) || defaultDeviceName(this.hostname),
      platform: this.platform,
      arch: this.arch,
      osVersion: this.osVersion,
      appVersion: this.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: KNOWN_CAPABILITIES,
      permissions: KNOWN_CAPABILITIES,
      endpoints: this.currentEndpoints(),
      signalUrls: joiningSignalUrls
    }, { randomUUID: this.randomUUID, now: this.now() });
    const profiles = this.currentProfiles();
    const catalog = reconcileLocalCatalog(payload.catalog || {}, profiles, {
      deviceId,
      linkKey: payload.identityLinkKey,
      sessionCounts: this.sessionCounts(profiles),
      randomUUID: this.randomUUID,
      now: this.now()
    });
    const mesh = { ...payload.mesh, localDeviceId: deviceId };
    const remotes = (payload.devices || [])
      .filter((device) => device?.deviceId && device.deviceId !== deviceId)
      .map((device) => normalizeDevice({ ...device, isLocal: false, status: 'offline' }));

    let store = null;
    try {
      this.keyVault.createJoined({
        ...identity,
        identityLinkKey: payload.identityLinkKey,
        identityLinkKeyVersion: payload.identityLinkKeyVersion
      });
      store = new MeshStore(this.databasePath);
      store.initialize(mesh, local, catalog, {
        devices: remotes,
        membershipEvents: payload.membershipEvents
      });
    } catch (error) {
      try { store?.destroy(); } catch (_storeError) { /* original error wins */ }
      try { this.keyVault.remove(); } catch (_keyError) { /* original error wins */ }
      throw error;
    } finally {
      store?.close();
    }
    return this.getOverview();
  }

  rename(input = {}) {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      if (input.deviceId !== snapshot.mesh.localDeviceId) throw new Error('remote-device-rename-not-available');
      const device = snapshot.devices.find((item) => item.deviceId === input.deviceId);
      if (!device) throw new Error('device-not-found');
      store.saveDevice(renameDevice(device, input.name), this.now());
    } finally {
      store.close();
    }
    return this.getOverview();
  }

  updatePermissions(input = {}) {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const target = snapshot.devices.find((device) => device.deviceId === input.deviceId);
      if (!target) throw new Error('device-not-found');
      if (target.isLocal) throw new Error('local-device-permissions-fixed');
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) throw new Error('local-device-not-found');
      const permissions = updatePermissions(target.permissions, input.permissions, target.capabilities);
      const secrets = this.keyVault.load();
      const event = createMembershipEvent({
        sequence: store.nextMembershipSequence(),
        meshId: snapshot.mesh.meshId,
        eventType: 'device.permissions',
        subjectDeviceId: target.deviceId,
        sourceDeviceId: local.deviceId,
        permissions
      }, {
        devicePrivateKey: secrets.devicePrivateKey,
        membershipCertificate: local.membershipCertificate,
        membershipChain: local.membershipChain
      }, { now: this.now(), randomUUID: this.randomUUID });
      store.updateDevicePermissions(target.deviceId, permissions, event, this.now());
    } finally {
      store.close();
    }
    return this.getOverview();
  }

  revoke(input = {}) {
    const store = new MeshStore(this.databasePath);
    let targetDeviceId = null;
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const target = snapshot.devices.find((device) => device.deviceId === input.deviceId);
      if (!target) throw new Error('device-not-found');
      if (target.isLocal) throw new Error('local-device-use-reset');
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) throw new Error('local-device-not-found');
      const secrets = this.keyVault.load();
      const event = createMembershipEvent({
        sequence: store.nextMembershipSequence(),
        meshId: snapshot.mesh.meshId,
        eventType: 'device.revoked',
        subjectDeviceId: target.deviceId,
        sourceDeviceId: local.deviceId,
        permissions: [],
        reason: input.reason
      }, {
        devicePrivateKey: secrets.devicePrivateKey,
        membershipCertificate: local.membershipCertificate,
        membershipChain: local.membershipChain
      }, { now: this.now(), randomUUID: this.randomUUID });
      store.revokeDevice(target.deviceId, event, this.now(), { remove: input.remove !== false });
      targetDeviceId = target.deviceId;
    } finally {
      store.close();
    }
    if (targetDeviceId) this.onDeviceRevoked(targetDeviceId);
    return this.getOverview();
  }

  createInventorySnapshot() {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const inventory = this.buildInventory(snapshot, { advanceRevision: true });
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      store.saveDevice(normalizeDevice({
        ...local,
        inventoryRevision: inventory.revision,
        status: 'online',
        lastSeenAt: this.now()
      }), this.now());
      return inventory;
    } finally {
      store.close();
    }
  }

  applyRemoteInventory(input = {}) {
    const inventory = normalizeInventory(input.inventory);
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      if (inventory.deviceId !== String(input.deviceId || inventory.deviceId)) {
        throw new Error('inventory-device-mismatch');
      }
      if (inventory.deviceId === snapshot.mesh.localDeviceId) throw new Error('inventory-local-source');
      const remote = snapshot.devices.find((device) => device.deviceId === inventory.deviceId);
      if (!remote) throw new Error('device-not-found');
      if (remote.status === 'revoked' || store.isDeviceRevoked(remote.deviceId)) throw new Error('device-revoked');
      const catalog = mergeCatalogInventory(snapshot, inventory, {
        catalogRevision: snapshot.catalogRevision + 1
      });
      const device = normalizeDevice({
        ...remote,
        status: 'online',
        inventoryRevision: inventory.revision,
        lastSeenAt: this.now()
      });
      store.applyRemoteInventory(inventory, catalog, device, this.now());
    } finally {
      store.close();
    }
    return this.getUnifiedSessions();
  }

  getUnifiedSessions() {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return [];
      const local = this.buildInventory(snapshot, { advanceRevision: false });
      return unifiedConversations([local, ...snapshot.remoteInventories], snapshot.devices, {
        localDeviceId: snapshot.mesh.localDeviceId
      });
    } finally {
      store.close();
    }
  }

  getPeerContext(deviceId) {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      const remote = snapshot.devices.find((device) => device.deviceId === String(deviceId || ''));
      if (!local) throw new Error('local-device-not-found');
      if (!remote || remote.isLocal) throw new Error('remote-device-not-found');
      if (remote.status === 'revoked' || store.isDeviceRevoked(remote.deviceId)) throw new Error('device-revoked');
      const localMembership = verifyMembershipChain(
        local.membershipCertificate,
        local.membershipChain,
        snapshot.mesh.rootPublicKey,
        { now: this.now() }
      );
      const remoteMembership = verifyMembershipChain(
        remote.membershipCertificate,
        remote.membershipChain,
        snapshot.mesh.rootPublicKey,
        { now: this.now() }
      );
      if (!localMembership.ok) throw new Error(localMembership.reason);
      if (!remoteMembership.ok) throw new Error(remoteMembership.reason);
      return {
        mesh: snapshot.mesh,
        local: { ...local, devicePublicKey: localMembership.payload.devicePublicKey },
        remote: { ...remote, devicePublicKey: remoteMembership.payload.devicePublicKey },
        secrets: this.keyVault.load()
      };
    } finally {
      store.close();
    }
  }

  getSignalingContext() {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) throw new Error('local-device-not-found');
      const membership = verifyMembershipChain(
        local.membershipCertificate,
        local.membershipChain,
        snapshot.mesh.rootPublicKey,
        { now: this.now() }
      );
      if (!membership.ok) throw new Error(membership.reason);
      return {
        mesh: snapshot.mesh,
        local: { ...local, devicePublicKey: membership.payload.devicePublicKey },
        secrets: this.keyVault.load()
      };
    } finally {
      store.close();
    }
  }

  setRemoteConnectionState(deviceId, state, details = {}) {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return false;
      const remote = snapshot.devices.find((device) => device.deviceId === String(deviceId || ''));
      if (!remote || remote.isLocal || remote.status === 'revoked') return false;
      const status = state === 'connected' ? 'online' : (state === 'connecting' ? 'connecting' : 'offline');
      store.saveDevice(normalizeDevice({
        ...remote,
        status,
        lastSeenAt: status === 'online' ? this.now() : remote.lastSeenAt,
        endpoints: Array.isArray(details.endpoints) && details.endpoints.length ? details.endpoints : remote.endpoints
      }), this.now());
      return true;
    } finally {
      store.close();
    }
  }

  updateLocalEndpoints(endpoints = []) {
    if (!fs.existsSync(this.databasePath)) return false;
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return false;
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) return false;
      const next = normalizeDevice({
        ...local,
        endpoints: Array.isArray(endpoints) ? endpoints : [],
        status: 'online',
        lastSeenAt: this.now()
      });
      if (JSON.stringify(local.endpoints || []) === JSON.stringify(next.endpoints || [])) return false;
      store.saveDevice(next, this.now());
      return true;
    } finally {
      store.close();
    }
  }

  updateLocalSignalUrls(signalUrls = []) {
    if (!fs.existsSync(this.databasePath)) return false;
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return false;
      const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
      if (!local) return false;
      const next = normalizeDevice({
        ...local,
        signalUrls,
        status: 'online',
        lastSeenAt: this.now()
      });
      if (JSON.stringify(local.signalUrls || []) === JSON.stringify(next.signalUrls || [])) return false;
      store.saveDevice(next, this.now());
      return true;
    } finally {
      store.close();
    }
  }

  buildInventory(snapshot, options = {}) {
    const profiles = this.currentProfiles();
    const sessionsByProfile = new Map();
    for (const profile of profiles) {
      try {
        const sessions = this.sessionsProvider(profile);
        sessionsByProfile.set(String(profile.id), Array.isArray(sessions) ? sessions : []);
      } catch (_error) {
        sessionsByProfile.set(String(profile.id), []);
      }
    }
    const local = snapshot.devices.find((device) => device.deviceId === snapshot.mesh.localDeviceId);
    const currentRevision = Number(local?.inventoryRevision) || 0;
    const secrets = this.keyVault.load();
    return buildLocalInventory({
      deviceId: snapshot.mesh.localDeviceId,
      revision: options.advanceRevision ? currentRevision + 1 : currentRevision,
      catalog: normalizeCatalog(snapshot),
      sessionsByProfile,
      linkKey: secrets.identityLinkKey
    }, { now: this.now() });
  }

  reset() {
    this.activeInvites.clear();
    if (fs.existsSync(this.databasePath)) {
      const store = new MeshStore(this.databasePath);
      store.destroy();
    }
    this.keyVault.remove();
    return this.uninitializedOverview();
  }

  currentEndpoints() {
    const value = this.endpointProvider();
    return Array.isArray(value) ? value : [];
  }

  currentSignalingUrls(fallback = []) {
    const value = this.signalingProvider();
    return Array.isArray(value) && value.length ? value : (Array.isArray(fallback) ? fallback : []);
  }

  pruneInvites() {
    const now = Date.parse(this.now());
    for (const [inviteId, record] of this.activeInvites) {
      if (record.privateState?.consumed || Date.parse(record.invite?.expiresAt) <= now) {
        this.activeInvites.delete(inviteId);
      }
    }
  }

  currentProfiles() {
    const value = this.profilesProvider();
    return Array.isArray(value) ? value : [];
  }

  sessionCounts(profiles) {
    const counts = new Map();
    for (const profile of profiles) {
      try {
        counts.set(String(profile.id), Number(this.sessionCountProvider(profile)) || 0);
      } catch (_error) {
        counts.set(String(profile.id), 0);
      }
    }
    return counts;
  }

  uninitializedOverview(extra = {}) {
    const profiles = this.currentProfiles();
    const counts = this.sessionCounts(profiles);
    return {
      initialized: false,
      storageIncomplete: extra.storageIncomplete === true,
      localPreview: {
        name: defaultDeviceName(this.hostname),
        platform: this.platform,
        arch: this.arch,
        osVersion: this.osVersion,
        appVersion: this.appVersion,
        agentCount: groupProfilesByIdentity(profiles).length,
        slotCount: profiles.length,
        sessionCount: [...counts.values()].reduce((sum, value) => sum + value, 0)
      },
      devices: [],
      agents: [],
      accountBindings: [],
      slots: [],
      keyState: this.keyVault.isAvailable() ? 'available' : 'os-key-protection-unavailable'
    };
  }

  publicOverview(snapshot, keyState) {
    const slots = snapshot.slots.map((slot) => ({
      deviceId: slot.deviceId,
      profileId: slot.profileId,
      agentId: slot.agentId,
      accountBindingId: slot.accountBindingId,
      appId: slot.appId,
      clientForm: slot.clientForm,
      localLabel: slot.localLabel,
      assignmentState: slot.assignmentState,
      launchable: slot.launchable,
      sessionCount: slot.sessionCount,
      lastUpdatedAt: slot.lastUpdatedAt
    }));
    const devices = snapshot.devices.map((device) => {
      const deviceSlots = slots.filter((slot) => slot.deviceId === device.deviceId);
      return {
        deviceId: device.deviceId,
        name: device.name,
        platform: device.platform,
        arch: device.arch,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        protocolVersion: device.protocolVersion,
        status: device.status,
        capabilities: device.capabilities,
        permissions: device.permissions,
        roles: device.membershipCertificate?.roles || [],
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        inventoryRevision: device.inventoryRevision,
        isLocal: device.isLocal,
        fingerprint: publicKeyFingerprint(device.devicePublicKey),
        endpointCount: Array.isArray(device.endpoints) ? device.endpoints.length : 0,
        signalServiceCount: Array.isArray(device.signalUrls) ? device.signalUrls.length : 0,
        agentCount: new Set(deviceSlots.map((slot) => slot.agentId)).size,
        slotCount: deviceSlots.length,
        sessionCount: deviceSlots.reduce((sum, slot) => sum + (Number(slot.sessionCount) || 0), 0)
      };
    });
    return {
      initialized: true,
      keyState,
      mesh: {
        displayName: snapshot.mesh.displayName,
        protocolVersion: snapshot.mesh.protocolVersion,
        createdAt: snapshot.mesh.createdAt,
        catalogRevision: snapshot.catalogRevision,
        membershipRevision: snapshot.membershipRevision,
        revocationRevision: snapshot.revocationRevision
      },
      localDeviceId: snapshot.mesh.localDeviceId,
      devices,
      agents: snapshot.agents.map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
        catAppearance: agent.catAppearance || null,
        group: agent.group,
        note: agent.note,
        lifecycleState: agent.lifecycleState,
        updatedAt: agent.updatedAt
      })),
      accountBindings: snapshot.accountBindings.map((binding) => ({
        accountBindingId: binding.accountBindingId,
        agentId: binding.agentId,
        providerNamespace: binding.providerNamespace,
        displayAlias: binding.displayAlias,
        linkMethod: binding.linkMethod,
        verificationState: binding.verificationState
      })),
      slots
    };
  }
}

function publicKeyFingerprint(publicKey) {
  if (!publicKey) return null;
  return crypto.createHash('sha256').update(String(publicKey)).digest('hex').slice(0, 12);
}

function defaultDeviceName(hostname) {
  return cleanName(String(hostname || '').replace(/\.local$/i, '')) || 'This device';
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

module.exports = {
  PROTOCOL_VERSION,
  MeshService,
  publicKeyFingerprint,
  defaultDeviceName
};
