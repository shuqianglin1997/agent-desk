const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { groupProfilesByIdentity } = require('../../identity-groups');
const { createLocalDevice, normalizeDevice, renameDevice } = require('../domain/device');
const {
  providerNamespace,
  normalizeCatalog,
  reconcileLocalCatalog,
  createAgentIdentity,
  updateAgentMetadata,
  assignSlot,
  mergeAgents,
  splitAccountBinding,
  removeCatalogObject
} = require('../domain/agent-catalog');
const {
  ACTIVE_JOB_STATES,
  reconcileAgentRuntimeModel,
  createProvisioningJob,
  transitionProvisioningJob: advanceProvisioningJob,
  normalizeAgentDeployment
} = require('../domain/agent-deployment');
const { meshScopedAccountKey } = require('../domain/identity-link');
const {
  buildLocalInventory,
  normalizeInventory,
  mergeCatalogInventory,
  canonicalizeInventorySessions,
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
const {
  createCatalogSnapshot: buildCatalogSnapshot,
  normalizeCatalogSnapshot,
  mergeCatalogSnapshot
} = require('../protocol/catalog');
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
      let refreshed = store.readSnapshot();
      const runtimeModel = reconcileAgentRuntimeModel(refreshed, {
        localDeviceId: refreshed.mesh.localDeviceId,
        now: this.now()
      });
      store.saveRuntimeModel(runtimeModel, this.now(), {
        localDeviceId: refreshed.mesh.localDeviceId
      });
      refreshed = store.readSnapshot();
      return this.publicOverview(refreshed, keyState);
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

  updateAgent(input = {}) {
    return this.mutateCatalog(input, 'catalog.agent-updated', (catalog) => updateAgentMetadata(catalog, input, {
      now: this.now()
    }));
  }

  createAgent(input = {}) {
    return this.mutateCatalog(input, 'catalog.agent-created', (catalog) => createAgentIdentity(catalog, input, {
      now: this.now(),
      randomUUID: this.randomUUID
    }));
  }

  assignSlot(input = {}) {
    // Reconcile first so a just-created local Profile has a stable Slot before
    // the explicit user choice replaces its provisional catalog relation.
    this.getOverview();
    return this.mutateCatalog(input, 'catalog.slot-assigned', (catalog) => assignSlot(catalog, input, {
      now: this.now(),
      randomUUID: this.randomUUID,
      reuseProvisional: input.reuseProvisional === true
    }));
  }

  mergeAgents(input = {}) {
    return this.mutateCatalog(input, 'catalog.agents-merged', (catalog) => mergeAgents(catalog, input, {
      now: this.now()
    }));
  }

  splitAccountBinding(input = {}) {
    return this.mutateCatalog(input, 'catalog.binding-split', (catalog) => splitAccountBinding(catalog, input, {
      now: this.now(),
      randomUUID: this.randomUUID
    }));
  }

  removeCatalogObject(input = {}) {
    return this.mutateCatalog(input, `catalog.${input.scope || 'slot'}-removed`, (catalog) => removeCatalogObject(catalog, input, {
      now: this.now()
    }));
  }

  ensureProvisioningJob(input = {}) {
    const overview = this.getOverview();
    if (!overview.initialized) throw new Error('mesh-not-initialized');
    const agentId = requiredText(input.agentId, 'agentId');
    const deviceId = requiredText(input.deviceId, 'deviceId');
    const requestedAppId = requiredText(input.requestedAppId, 'requestedAppId');
    const requestedClientForm = requiredText(input.requestedClientForm, 'requestedClientForm');
    if (deviceId !== overview.localDeviceId) throw new Error('provisioning-local-device-required');
    if (!overview.agents.some((agent) => agent.agentId === agentId)) throw new Error('agent-not-found');

    const store = new MeshStore(this.databasePath);
    let job;
    try {
      const snapshot = store.readSnapshot();
      const blueprint = snapshot.blueprints.find((item) => item.agentId === agentId);
      if (!blueprint) throw new Error('agent-blueprint-not-found');
      const selector = { requestedAppId, requestedClientForm };
      job = store.findActiveProvisioningJob(agentId, deviceId, selector);
      if (!job) {
        const latest = store.findLatestProvisioningJob(agentId, deviceId, selector);
        if (latest && ['error', 'unsupported'].includes(latest.state)) {
          job = advanceProvisioningJob(latest, {
            state: 'planning',
            currentStep: 'plan'
          }, { now: this.now() });
        } else {
          job = createProvisioningJob({
            agentId,
            deviceId,
            requestedAppId,
            requestedClientForm,
            blueprintRevision: blueprint.revision
          }, { now: this.now(), randomUUID: this.randomUUID });
        }
        store.saveProvisioningJob(job, this.now());
      }
    } finally {
      store.close();
    }
    this.getOverview();
    return this.getProvisioningContext({ jobId: job.jobId });
  }

  getProvisioningContext(input = {}) {
    this.getOverview();
    const jobId = requiredText(input.jobId, 'jobId');
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const job = snapshot.provisioningJobs.find((item) => item.jobId === jobId);
      if (!job) throw new Error('provisioning-job-not-found');
      if (job.deviceId !== snapshot.mesh.localDeviceId) throw new Error('provisioning-local-device-required');
      const agent = snapshot.agents.find((item) => item.agentId === job.agentId);
      if (!agent) throw new Error('agent-not-found');
      const blueprint = snapshot.blueprints.find((item) => item.agentId === job.agentId);
      if (!blueprint) throw new Error('agent-blueprint-not-found');
      const deployment = snapshot.deployments.find((item) => (
        item.agentId === job.agentId && item.deviceId === job.deviceId
      )) || null;
      return {
        job,
        agent,
        blueprint,
        deployment,
        accountBindings: snapshot.accountBindings.filter((item) => item.agentId === job.agentId)
      };
    } finally {
      store.close();
    }
  }

  listActiveProvisioningJobs() {
    const overview = this.getOverview();
    if (!overview.initialized) return [];
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) return [];
      return snapshot.provisioningJobs.filter((job) => (
        job.deviceId === snapshot.mesh.localDeviceId && ACTIVE_JOB_STATES.has(job.state)
      ));
    } finally {
      store.close();
    }
  }

  transitionProvisioningJob(input = {}) {
    const jobId = requiredText(input.jobId, 'jobId');
    const store = new MeshStore(this.databasePath);
    let next;
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const current = store.readProvisioningJob(jobId);
      if (!current) throw new Error('provisioning-job-not-found');
      if (current.deviceId !== snapshot.mesh.localDeviceId) throw new Error('provisioning-local-device-required');
      next = advanceProvisioningJob(current, input, { now: this.now() });
      store.saveProvisioningJob(next, this.now());
    } finally {
      store.close();
    }
    this.getOverview();
    return this.getProvisioningContext({ jobId: next.jobId });
  }

  verifyProvisioningIdentity(input = {}) {
    const jobId = requiredText(input.jobId, 'jobId');
    const observedFingerprint = optionalText(input.observedFingerprint, 160);
    const manualConfirmation = input.manualConfirmation === true;
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const job = store.readProvisioningJob(jobId);
      if (!job) throw new Error('provisioning-job-not-found');
      if (job.deviceId !== snapshot.mesh.localDeviceId) throw new Error('provisioning-local-device-required');
      const blueprint = snapshot.blueprints.find((item) => item.agentId === job.agentId);
      if (!blueprint) throw new Error('agent-blueprint-not-found');
      const provider = providerNamespace(job.requestedAppId);
      const order = new Map((blueprint.desiredBindingIds || []).map((bindingId, index) => [bindingId, index]));
      const candidates = snapshot.accountBindings
        .filter((binding) => binding.agentId === job.agentId && binding.providerNamespace === provider)
        .sort((left, right) => (
          (order.get(left.accountBindingId) ?? Number.MAX_SAFE_INTEGER)
          - (order.get(right.accountBindingId) ?? Number.MAX_SAFE_INTEGER)
        ));
      let observedAccountKey = null;
      if (observedFingerprint) {
        const secrets = this.keyVault.load();
        observedAccountKey = meshScopedAccountKey(secrets.identityLinkKey, provider, observedFingerprint);
        const globalMatch = snapshot.accountBindings.find((binding) => (
          binding.providerNamespace === provider
          && binding.meshScopedAccountKey === observedAccountKey
        ));
        if (globalMatch && globalMatch.agentId !== job.agentId) {
          return { status: 'mismatch', reasonCode: 'identity-belongs-to-another-agent' };
        }
        const exact = candidates.find((binding) => binding.meshScopedAccountKey === observedAccountKey);
        if (exact) {
          return {
            status: 'matched',
            mode: 'existing-binding',
            accountBindingId: exact.accountBindingId
          };
        }
        const strongCandidates = candidates.filter((binding) => binding.meshScopedAccountKey);
        if (strongCandidates.length) {
          return { status: 'mismatch', reasonCode: 'binding-identity-mismatch' };
        }
        if (candidates.length === 1) {
          return {
            status: 'matched',
            mode: 'existing-binding',
            accountBindingId: candidates[0].accountBindingId
          };
        }
        if (candidates.length > 1) {
          return { status: 'ambiguous', reasonCode: 'binding-choice-required' };
        }
        return { status: 'new-binding', mode: 'existing-agent', agentId: job.agentId };
      }

      if (!manualConfirmation) {
        return { status: 'confirmation-required', reasonCode: 'identity-confirmation-required' };
      }
      if (candidates.length === 1) {
        return {
          status: 'matched',
          mode: 'existing-binding',
          accountBindingId: candidates[0].accountBindingId
        };
      }
      if (candidates.length > 1) {
        return { status: 'ambiguous', reasonCode: 'binding-choice-required' };
      }
      return { status: 'new-binding', mode: 'existing-agent', agentId: job.agentId };
    } finally {
      store.close();
    }
  }

  finalizeProvisioning(input = {}) {
    const jobId = requiredText(input.jobId, 'jobId');
    const profileId = requiredText(input.profileId, 'profileId');
    const verdict = this.verifyProvisioningIdentity(input);
    if (!['matched', 'new-binding'].includes(verdict.status)) {
      throw new Error(verdict.reasonCode || 'provisioning-identity-unverified');
    }
    let context = this.getProvisioningContext({ jobId });
    if (context.job.stagingProfileId !== profileId) throw new Error('provisioning-profile-mismatch');
    if (context.job.state !== 'verifying') throw new Error('provisioning-job-not-verifying');

    let overview = this.getOverview();
    const currentSlot = overview.slots.find((slot) => (
      slot.deviceId === context.job.deviceId && slot.profileId === profileId
    ));
    if (!currentSlot) throw new Error('provisioning-profile-not-registered');
    if (!(currentSlot.agentId === context.job.agentId && currentSlot.assignmentState === 'linked')) {
      overview = this.assignSlot({
        mode: verdict.mode,
        reuseProvisional: true,
        deviceId: context.job.deviceId,
        profileId,
        agentId: context.job.agentId,
        accountBindingId: verdict.accountBindingId,
        displayAlias: context.agent.displayName
      });
    }

    const store = new MeshStore(this.databasePath);
    try {
      const current = store.readProvisioningJob(jobId);
      if (!current) throw new Error('provisioning-job-not-found');
      const next = advanceProvisioningJob(current, {
        state: 'ready',
        currentStep: 'complete',
        completedSteps: ['identity-verified', 'profile-registered', 'catalog-linked'],
        resultSlotKey: `${current.deviceId}:${profileId}`,
        waitingReason: null,
        lastErrorCode: null
      }, { now: this.now() });
      store.saveProvisioningJob(next, this.now());
    } finally {
      store.close();
    }
    overview = this.getOverview();
    return {
      overview,
      job: overview.provisioningJobs.find((job) => job.jobId === jobId),
      deployment: overview.deployments.find((deployment) => (
        deployment.agentId === context.job.agentId && deployment.deviceId === context.job.deviceId
      )),
      slot: overview.slots.find((slot) => slot.deviceId === context.job.deviceId && slot.profileId === profileId)
    };
  }

  markDeploymentOpened(input = {}) {
    this.getOverview();
    const agentId = requiredText(input.agentId, 'agentId');
    const deviceId = requiredText(input.deviceId, 'deviceId');
    const now = this.now();
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      if (deviceId !== snapshot.mesh.localDeviceId) throw new Error('deployment-local-device-required');
      const current = snapshot.deployments.find((deployment) => (
        deployment.agentId === agentId && deployment.deviceId === deviceId
      ));
      if (!current || current.state !== 'ready') throw new Error('deployment-not-ready');
      store.saveDeployment(normalizeAgentDeployment({
        ...current,
        preferredSlotKey: optionalText(input.slotKey, 260) || current.preferredSlotKey,
        lastOpenedAt: now,
        revision: current.revision + 1,
        updatedAt: now
      }), now);
    } finally {
      store.close();
    }
    return this.getOverview();
  }

  cancelProvisioningJob(input = {}) {
    const context = this.getProvisioningContext(input);
    if (context.job.completedSteps.includes('profile-registered')) {
      throw new Error('provisioning-commit-in-progress');
    }
    return this.transitionProvisioningJob({
      jobId: context.job.jobId,
      state: 'cancelled',
      currentStep: 'cancelled',
      waitingReason: null,
      lastErrorCode: null
    });
  }

  mutateCatalog(input, eventType, mutation) {
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
      if (!membership.ok || !membership.payload.roles.includes('catalog.manage')) {
        throw new Error('catalog-manage-required');
      }
      if (input.baseRevision !== undefined && Number(input.baseRevision) !== snapshot.catalogRevision) {
        throw new Error('catalog-revision-conflict');
      }
      const next = mutation(normalizeCatalog(snapshot));
      store.saveCatalog(next, this.now(), {
        eventType,
        sourceDeviceId: snapshot.mesh.localDeviceId
      });
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

  createCatalogSnapshot() {
    const store = new MeshStore(this.databasePath);
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      return buildCatalogSnapshot(snapshot, {
        meshId: snapshot.mesh.meshId,
        sourceDeviceId: snapshot.mesh.localDeviceId,
        now: this.now()
      });
    } finally {
      store.close();
    }
  }

  applyRemoteCatalog(input = {}) {
    const incoming = normalizeCatalogSnapshot(input.snapshot);
    const store = new MeshStore(this.databasePath);
    let result;
    try {
      const snapshot = store.readSnapshot();
      if (!snapshot) throw new Error('mesh-not-initialized');
      const sourceDeviceId = String(input.deviceId || incoming.sourceDeviceId);
      if (incoming.meshId !== snapshot.mesh.meshId) throw new Error('catalog-mesh-mismatch');
      if (incoming.sourceDeviceId !== sourceDeviceId) throw new Error('catalog-device-mismatch');
      if (sourceDeviceId === snapshot.mesh.localDeviceId) throw new Error('catalog-local-source');
      const remote = snapshot.devices.find((device) => device.deviceId === sourceDeviceId);
      if (!remote) throw new Error('device-not-found');
      if (remote.status === 'revoked' || store.isDeviceRevoked(remote.deviceId)) throw new Error('device-revoked');

      result = mergeCatalogSnapshot(snapshot, incoming);
      if (result.changed) {
        const liveAgentIds = new Set(result.catalog.agents.map((agent) => agent.agentId));
        store.saveCatalog(result.catalog, this.now(), {
          eventType: 'catalog.remote-synced',
          sourceDeviceId
        });
        store.saveRuntimeModel({
          blueprints: result.blueprints,
          deployments: snapshot.deployments.filter((deployment) => liveAgentIds.has(deployment.agentId))
        }, this.now(), {
          localDeviceId: snapshot.mesh.localDeviceId
        });
      }
    } finally {
      store.close();
    }
    return {
      changed: result?.changed === true,
      catalogRevision: result?.catalog?.catalogRevision || 0,
      overview: this.getOverview()
    };
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
      const canonicalInventory = canonicalizeInventorySessions(inventory, catalog, {
        linkKey: this.keyVault.load().identityLinkKey
      });
      const device = normalizeDevice({
        ...remote,
        status: 'online',
        inventoryRevision: canonicalInventory.revision,
        lastSeenAt: this.now()
      });
      store.applyRemoteInventory(canonicalInventory, catalog, device, this.now());
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
      const linkKey = this.keyVault.load().identityLinkKey;
      const remoteInventories = snapshot.remoteInventories.flatMap((inventory) => {
        try {
          return [canonicalizeInventorySessions(inventory, snapshot, { linkKey })];
        } catch (_error) {
          // One legacy or damaged cache must not hide healthy local/remote
          // conversations. The next authenticated snapshot can replace it.
          return [];
        }
      });
      return unifiedConversations([local, ...remoteInventories], snapshot.devices, {
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
      blueprints: [],
      deployments: [],
      provisioningJobs: [],
      keyState: this.keyVault.isAvailable() ? 'available' : 'os-key-protection-unavailable'
    };
  }

  publicOverview(snapshot, keyState) {
    const remoteInventoryByDevice = new Map((snapshot.remoteInventories || []).map((inventory) => [
      inventory.deviceId,
      inventory
    ]));
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
      const remoteInventory = remoteInventoryByDevice.get(device.deviceId) || null;
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
        inventoryGeneratedAt: remoteInventory?.generatedAt || null,
        inventoryStaleAt: remoteInventory?.staleAt || null,
        isLocal: device.isLocal,
        fingerprint: publicKeyFingerprint(device.devicePublicKey),
        endpointCount: Array.isArray(device.endpoints) ? device.endpoints.length : 0,
        signalServiceCount: Array.isArray(device.signalUrls) ? device.signalUrls.length : 0,
        agentCount: new Set(deviceSlots.map((slot) => slot.agentId).filter(Boolean)).size,
        slotCount: deviceSlots.length,
        sessionCount: deviceSlots
          .filter((slot) => slot.assignmentState === 'linked' && slot.agentId)
          .reduce((sum, slot) => sum + (Number(slot.sessionCount) || 0), 0)
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
      blueprints: (snapshot.blueprints || []).map((blueprint) => ({
        blueprintId: blueprint.blueprintId,
        agentId: blueprint.agentId,
        revision: blueprint.revision,
        preferredProvider: blueprint.preferredProvider,
        preferredAppId: blueprint.preferredAppId,
        preferredClientForm: blueprint.preferredClientForm,
        desiredBindingIds: blueprint.desiredBindingIds,
        skillRequirementCount: blueprint.skillRequirements?.length || 0,
        toolRequirementCount: blueprint.toolRequirements?.length || 0,
        projectRequirementCount: blueprint.projectRequirements?.length || 0,
        updatedAt: blueprint.updatedAt
      })),
      deployments: (snapshot.deployments || []).map((deployment) => ({
        deploymentId: deployment.deploymentId,
        agentId: deployment.agentId,
        deviceId: deployment.deviceId,
        blueprintRevision: deployment.blueprintRevision,
        state: deployment.state,
        preferredSlotKey: deployment.preferredSlotKey,
        slotKeys: deployment.slotKeys,
        adapterId: deployment.adapterId,
        adapterVersion: deployment.adapterVersion,
        lastVerifiedAt: deployment.lastVerifiedAt,
        lastOpenedAt: deployment.lastOpenedAt,
        lastErrorCode: deployment.lastErrorCode,
        resumeJobId: deployment.resumeJobId,
        revision: deployment.revision,
        updatedAt: deployment.updatedAt
      })),
      provisioningJobs: (snapshot.provisioningJobs || []).map((job) => ({
        jobId: job.jobId,
        agentId: job.agentId,
        deviceId: job.deviceId,
        requestedAppId: job.requestedAppId,
        requestedClientForm: job.requestedClientForm,
        state: job.state,
        currentStep: job.currentStep,
        waitingReason: job.waitingReason,
        lastErrorCode: job.lastErrorCode,
        updatedAt: job.updatedAt
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

function optionalText(value, limit = 128) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : null;
}

function requiredText(value, field) {
  const text = optionalText(value, 260);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

module.exports = {
  PROTOCOL_VERSION,
  MeshService,
  publicKeyFingerprint,
  defaultDeviceName
};
