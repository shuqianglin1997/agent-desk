const crypto = require('node:crypto');
const { requireCapability } = require('../domain/capabilities');
const { provisioningAdapterDescriptor } = require('./provisioning-adapters');

const AGENT_ACTION_TIMEOUT_MS = 2 * 60_000;
const MAX_PENDING_ACTIONS = 32;
const TERMINAL_PREPARATION_STATES = new Set(['ready', 'error', 'unsupported', 'cancelled']);
const PREPARATION_STATES = new Set([
  'waiting-consent',
  'planning',
  'preparing',
  'waiting-install',
  'waiting-login',
  'verifying',
  'ready',
  'error',
  'unsupported',
  'cancelled'
]);

class AgentActionService {
  constructor(options = {}) {
    if (!options.meshService) throw new TypeError('meshService is required');
    if (typeof options.peerManagerProvider !== 'function') throw new TypeError('peerManagerProvider is required');
    if (typeof options.provisioningServiceProvider !== 'function') {
      throw new TypeError('provisioningServiceProvider is required');
    }
    this.meshService = options.meshService;
    this.peerManagerProvider = options.peerManagerProvider;
    this.provisioningServiceProvider = options.provisioningServiceProvider;
    this.confirmPreparation = options.confirmPreparation || (async () => false);
    this.onChange = options.onChange || (() => {});
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.timeoutMs = positiveInteger(options.timeoutMs, AGENT_ACTION_TIMEOUT_MS);
    this.pending = new Map();
    this.outgoingPreparations = new Map();
    this.incomingPreparations = new Map();
    this.incomingConsentKeys = new Set();
    this.incomingConsents = new Map();
    this.confirmationQueue = Promise.resolve();
  }

  async launchRemote(input = {}) {
    const target = normalizeLaunchTarget(input);
    this.requireRemoteTarget(target, 'profile.launch');
    const manager = this.peerManagerProvider();
    await manager.connect(target.deviceId);
    this.requireRemoteTarget(target, 'profile.launch');

    const requestId = this.randomUUID();
    const pending = this.createPending({
      kind: 'launch',
      requestId,
      deviceId: target.deviceId,
      agentId: target.agentId,
      profileId: target.profileId
    });
    try {
      await manager.sendSemantic(target.deviceId, 'profile.launch', 'profile.launch', {
        phase: 'request',
        requestId,
        agentId: target.agentId,
        profileId: target.profileId
      });
      return await pending.promise;
    } finally {
      this.deletePending(requestId);
    }
  }

  async prepareRemote(input = {}) {
    const target = normalizePreparationTarget(input);
    this.requireRemoteTarget(target, 'agent.prepare');
    const manager = this.peerManagerProvider();
    await manager.connect(target.deviceId);
    this.requireRemoteTarget(target, 'agent.prepare');

    const requestId = this.randomUUID();
    const metadata = {
      kind: 'prepare',
      requestId,
      deviceId: target.deviceId,
      agentId: target.agentId,
      requestedAppId: target.requestedAppId,
      requestedClientForm: target.requestedClientForm
    };
    for (const [previousRequestId, previous] of this.outgoingPreparations) {
      if (preparationKey(previous) === preparationKey(metadata)) {
        this.outgoingPreparations.delete(previousRequestId);
      }
    }
    if (this.outgoingPreparations.size >= MAX_PENDING_ACTIONS) {
      throw new Error('agent-action-queue-full');
    }
    const pending = this.createPending(metadata);
    this.outgoingPreparations.set(requestId, metadata);
    try {
      await manager.sendSemantic(target.deviceId, 'agent.prepare', 'agent.prepare', {
        phase: 'request',
        requestId,
        agentId: target.agentId,
        requestedAppId: target.requestedAppId,
        requestedClientForm: target.requestedClientForm
      });
      return await pending.promise;
    } catch (error) {
      if (!pending.isSettled()) this.outgoingPreparations.delete(requestId);
      throw error;
    } finally {
      this.deletePending(requestId);
    }
  }

  async handleEnvelope({ context, envelope }) {
    if (envelope.messageType === 'profile.launch') {
      const phase = String(envelope.payload?.phase || '');
      if (phase === 'request') return this.receiveLaunchRequest(context, envelope.payload);
      if (phase === 'result') return this.receiveLaunchResult(context, envelope.payload);
      throw new Error('profile-launch-phase');
    }
    if (envelope.messageType === 'agent.prepare') {
      return this.receivePreparationRequest(context, envelope.payload);
    }
    if (envelope.messageType === 'agent.prepare.status') {
      return this.receivePreparationStatus(context, envelope.payload);
    }
    return false;
  }

  async receiveLaunchRequest(context, payload) {
    const request = normalizeLaunchRequest(payload);
    requireCapability(context.peer.remote, 'profile.launch');
    let response;
    try {
      const overview = this.meshService.getOverview();
      const slot = resolveLocalSlot(overview, request);
      const result = await this.provisioningServiceProvider().openReadySlot(slot, overview);
      response = {
        phase: 'result',
        requestId: request.requestId,
        agentId: request.agentId,
        profileId: request.profileId,
        ok: result?.ok === true,
        launched: result?.launched === true,
        state: result?.state || 'ready',
        reasonCode: result?.ok === true ? null : safeError(result?.reasonCode || 'client-launch-failed')
      };
    } catch (error) {
      response = {
        phase: 'result',
        requestId: request.requestId,
        agentId: request.agentId,
        profileId: request.profileId,
        ok: false,
        launched: false,
        state: 'error',
        reasonCode: safeError(error)
      };
    }
    await this.peerManagerProvider().sendSemantic(
      context.peer.remote.deviceId,
      'profile.launch',
      'profile.launch',
      response
    );
    return true;
  }

  receiveLaunchResult(context, payload) {
    const result = normalizeLaunchResult(payload);
    const pending = this.pending.get(result.requestId);
    if (!pending || pending.kind !== 'launch') return true;
    if (
      pending.deviceId !== context.peer.remote.deviceId
      || pending.agentId !== result.agentId
      || pending.profileId !== result.profileId
    ) {
      throw new Error('profile-launch-result-mismatch');
    }
    pending.resolve(result);
    return true;
  }

  async receivePreparationRequest(context, payload) {
    const request = normalizePreparationRequest(payload);
    requireCapability(context.peer.remote, 'agent.prepare');
    const overview = this.meshService.getOverview();
    const localDeviceId = overview.localDeviceId;
    const agent = overview.agents.find((item) => item.agentId === request.agentId);
    if (!agent || !localDeviceId) {
      await this.sendPreparationStatusForContext(context, {
        ...request,
        state: 'error',
        ok: false,
        launched: false,
        settled: true,
        reasonCode: agent ? 'local-device-not-found' : 'agent-not-found'
      });
      return true;
    }

    const consentKey = `${context.peer.remote.deviceId}:${request.agentId}`;
    if (this.incomingConsentKeys.has(consentKey) || this.incomingConsentKeys.size >= MAX_PENDING_ACTIONS) {
      await this.sendPreparationStatusForContext(context, {
        ...request,
        state: 'error',
        ok: false,
        launched: false,
        settled: true,
        reasonCode: 'preparation-consent-busy'
      });
      return true;
    }

    await this.sendPreparationStatusForContext(context, {
      ...request,
      state: 'waiting-consent',
      ok: true,
      launched: false,
      settled: false,
      reasonCode: null
    });
    this.incomingConsentKeys.add(consentKey);
    const consentId = `${context.peer.remote.deviceId}:${request.requestId}`;
    const consent = {
      consentId,
      consentKey,
      requestId: request.requestId,
      sourceDeviceId: context.peer.remote.deviceId,
      connectionId: context.connectionId || null,
      generation: Number(context.generation) || 0,
      context,
      cancelled: false,
      cancelReason: null
    };
    this.incomingConsents.set(consentId, consent);
    try {
      const accepted = await this.confirmPreparationSerial({
        request,
        sourceDevice: context.peer.remote,
        agent
      }, consent);
      if (accepted !== true) {
        await this.sendPreparationStatusForContext(context, {
          ...request,
          state: 'cancelled',
          ok: false,
          launched: false,
          settled: true,
          reasonCode: 'target-declined'
        });
        return true;
      }

      const current = this.requireIncomingPreparationAuthorization(consent, request);

      const result = await this.provisioningServiceProvider().ensureReady({
        agentId: request.agentId,
        deviceId: current.localDeviceId,
        requestedAppId: request.requestedAppId,
        requestedClientForm: request.requestedClientForm,
        interactive: true,
        manualConfirmation: false
      });
      const status = statusFromProvisioning(request, result, true);
      if (status.job && !TERMINAL_PREPARATION_STATES.has(status.state)) {
        if (this.incomingPreparations.size >= MAX_PENDING_ACTIONS) {
          throw new Error('agent-action-queue-full');
        }
        this.incomingPreparations.set(status.job.jobId, {
          request,
          sourceDeviceId: context.peer.remote.deviceId,
          context
        });
      }
      await this.syncReadyState(status.state);
      await this.sendPreparationStatusForContext(context, status);
      return true;
    } catch (error) {
      await this.trySendPreparationStatusForContext(context, {
        ...request,
        state: 'error',
        ok: false,
        launched: false,
        settled: true,
        reasonCode: safeError(error)
      });
      return true;
    } finally {
      this.incomingConsentKeys.delete(consentKey);
      this.incomingConsents.delete(consentId);
    }
  }

  receivePreparationStatus(context, payload) {
    const status = normalizePreparationStatus(payload);
    const metadata = this.outgoingPreparations.get(status.requestId);
    if (!metadata) return true;
    if (
      metadata.deviceId !== context.peer.remote.deviceId
      || metadata.agentId !== status.agentId
      || metadata.requestedAppId !== status.requestedAppId
      || metadata.requestedClientForm !== status.requestedClientForm
    ) {
      throw new Error('agent-prepare-status-mismatch');
    }
    this.changed({ ...status, deviceId: metadata.deviceId });
    const pending = this.pending.get(status.requestId);
    if (status.settled && pending?.kind === 'prepare') pending.resolve(status);
    if (TERMINAL_PREPARATION_STATES.has(status.state)) {
      this.outgoingPreparations.delete(status.requestId);
    }
    return true;
  }

  handleProvisioningChanged(value = {}) {
    const jobId = optionalText(value?.job?.jobId, 128);
    const tracked = jobId ? this.incomingPreparations.get(jobId) : null;
    if (!tracked) return false;
    const status = statusFromProvisioning(tracked.request, value, true);
    if (TERMINAL_PREPARATION_STATES.has(status.state)) this.incomingPreparations.delete(jobId);
    void this.syncReadyState(status.state)
      .then(() => this.sendPreparationStatusForContext(tracked.context, status))
      .catch(() => false);
    return true;
  }

  handlePeerState(value = {}) {
    if (!['disconnected', 'error'].includes(value.state)) return false;
    const error = new Error(safeError(value.reason || `peer-${value.state}`));
    for (const [requestId, pending] of this.pending) {
      if (pending.deviceId !== value.deviceId) continue;
      pending.reject(error);
      this.deletePending(requestId);
    }
    this.cancelIncomingConsents(value.deviceId, value.reason || `peer-${value.state}`);
    for (const [jobId, tracked] of this.incomingPreparations) {
      if (tracked.sourceDeviceId === String(value.deviceId || '')) {
        this.incomingPreparations.delete(jobId);
      }
    }
    return true;
  }

  handlePermissionsChanged(deviceId, permissions = []) {
    if (Array.isArray(permissions) && permissions.includes('agent.prepare')) return false;
    return this.cancelIncomingConsents(deviceId, 'capability-revoked:agent.prepare');
  }

  stop(reason = 'agent-action-service-stopped') {
    const error = new Error(safeError(reason));
    for (const [requestId, pending] of this.pending) {
      pending.reject(error);
      this.deletePending(requestId);
    }
    this.outgoingPreparations.clear();
    this.incomingPreparations.clear();
    for (const consent of this.incomingConsents.values()) {
      consent.cancelled = true;
      consent.cancelReason = safeError(reason);
    }
    this.incomingConsents.clear();
    this.incomingConsentKeys.clear();
  }

  requireRemoteTarget(target, capability) {
    const overview = this.meshService.getOverview();
    if (!overview.initialized) throw new Error('mesh-not-initialized');
    if (!overview.agents.some((agent) => agent.agentId === target.agentId)) throw new Error('agent-not-found');
    const device = overview.devices.find((item) => item.deviceId === target.deviceId);
    if (!device || device.isLocal || device.deviceId === overview.localDeviceId) {
      throw new Error('remote-device-not-found');
    }
    if (!Array.isArray(device.capabilities) || !device.capabilities.includes(capability)) {
      throw new Error(`capability-unsupported:${capability}`);
    }
    requireCapability(device, capability);
    if (capability === 'profile.launch') resolveRemoteSlot(overview, target);
    return { overview, device };
  }

  async sendPreparationStatus(deviceId, value) {
    const status = normalizePreparationStatus({ ...value, phase: 'status' });
    await this.peerManagerProvider().sendSemantic(
      deviceId,
      'agent.prepare.status',
      'agent.prepare',
      status
    );
    return status;
  }

  async sendPreparationStatusForContext(context, value) {
    const manager = this.peerManagerProvider();
    if (typeof manager.isCurrentConnection === 'function' && !manager.isCurrentConnection(context)) {
      throw new Error('agent-prepare-connection-changed');
    }
    return this.sendPreparationStatus(context.peer.remote.deviceId, value);
  }

  async trySendPreparationStatusForContext(context, value) {
    try {
      return await this.sendPreparationStatusForContext(context, value);
    } catch (_error) {
      return null;
    }
  }

  requireIncomingPreparationAuthorization(consent, request) {
    if (
      !consent
      || consent.cancelled
      || !this.incomingConsents.has(consent.consentId)
      || consent.context.closed === true
      || (Number(consent.context.generation) || 0) !== consent.generation
    ) {
      throw new Error(consent?.cancelReason || 'agent-prepare-consent-cancelled');
    }
    const manager = this.peerManagerProvider();
    if (typeof manager.isCurrentConnection === 'function' && !manager.isCurrentConnection(consent.context)) {
      throw new Error('agent-prepare-connection-changed');
    }
    const overview = this.meshService.getOverview();
    const sourceDevice = overview.devices.find((item) => item.deviceId === consent.sourceDeviceId);
    if (!sourceDevice || sourceDevice.isLocal || sourceDevice.status === 'revoked') {
      throw new Error('remote-device-not-found');
    }
    requireCapability(sourceDevice, 'agent.prepare');
    const agent = overview.agents.find((item) => item.agentId === request.agentId);
    if (!agent) throw new Error('agent-not-found');
    if (!overview.localDeviceId) throw new Error('local-device-not-found');
    return { overview, sourceDevice, agent, localDeviceId: overview.localDeviceId };
  }

  cancelIncomingConsents(deviceId, reason) {
    const target = String(deviceId || '');
    let cancelled = false;
    for (const [consentId, consent] of this.incomingConsents) {
      if (consent.sourceDeviceId !== target) continue;
      consent.cancelled = true;
      consent.cancelReason = safeError(reason || 'agent-prepare-consent-cancelled');
      this.incomingConsents.delete(consentId);
      this.incomingConsentKeys.delete(consent.consentKey);
      cancelled = true;
    }
    return cancelled;
  }

  confirmPreparationSerial(value, consent = null) {
    const operation = this.confirmationQueue
      .catch(() => false)
      .then(() => {
        if (consent) this.requireIncomingPreparationAuthorization(consent, value.request);
        return this.confirmPreparation(value);
      });
    this.confirmationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async syncReadyState(state) {
    if (state !== 'ready') return;
    const manager = this.peerManagerProvider();
    await Promise.allSettled([
      manager.broadcastCatalog(),
      manager.broadcastInventory()
    ]);
  }

  createPending(metadata) {
    if (this.pending.size >= MAX_PENDING_ACTIONS) throw new Error('agent-action-queue-full');
    const pending = deferred(this.timeoutMs, 'agent-action-timeout', this.setTimeout, this.clearTimeout);
    const record = {
      ...metadata,
      promise: pending.promise,
      resolve: pending.resolve,
      reject: pending.reject,
      cancel: pending.cancel,
      isSettled: () => pending.settled
    };
    this.pending.set(metadata.requestId, record);
    return record;
  }

  deletePending(requestId) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    pending.cancel();
    this.pending.delete(requestId);
  }

  changed(value) {
    try { this.onChange(value); } catch (_error) { /* Renderer notification is best effort. */ }
  }
}

function resolveRemoteSlot(overview, input) {
  const slot = overview.slots.find((item) => (
    item.deviceId === input.deviceId
    && item.profileId === input.profileId
    && item.agentId === input.agentId
    && item.assignmentState === 'linked'
    && item.launchable !== false
  ));
  if (!slot) throw new Error('agent-slot-not-found');
  return slot;
}

function resolveLocalSlot(overview, input) {
  if (!overview.initialized || !overview.localDeviceId) throw new Error('mesh-not-initialized');
  const slot = resolveRemoteSlot(overview, {
    ...input,
    deviceId: overview.localDeviceId
  });
  const deployment = (overview.deployments || []).find((item) => (
    item.agentId === input.agentId
    && item.deviceId === overview.localDeviceId
    && item.state === 'ready'
    && (item.slotKeys || []).includes(`${overview.localDeviceId}:${input.profileId}`)
  ));
  if (!deployment) throw new Error('agent-deployment-not-ready');
  return slot;
}

function preparationKey(value) {
  return [
    value.deviceId,
    value.agentId,
    value.requestedAppId,
    value.requestedClientForm
  ].join(':');
}

function normalizeLaunchTarget(value = {}) {
  assertAllowedKeys(value, ['agentId', 'deviceId', 'profileId'], 'profile-launch-target');
  return {
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    deviceId: requiredIdentifier(value.deviceId, 'deviceId'),
    profileId: requiredIdentifier(value.profileId, 'profileId')
  };
}

function normalizeLaunchRequest(value = {}) {
  assertAllowedKeys(value, ['phase', 'requestId', 'agentId', 'profileId'], 'profile-launch-request');
  if (value.phase !== 'request') throw new Error('profile-launch-phase');
  return {
    phase: 'request',
    requestId: requiredIdentifier(value.requestId, 'requestId'),
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    profileId: requiredIdentifier(value.profileId, 'profileId')
  };
}

function normalizeLaunchResult(value = {}) {
  assertAllowedKeys(value, [
    'phase', 'requestId', 'agentId', 'profileId', 'ok', 'launched', 'state', 'reasonCode'
  ], 'profile-launch-result');
  if (value.phase !== 'result') throw new Error('profile-launch-phase');
  return {
    phase: 'result',
    requestId: requiredIdentifier(value.requestId, 'requestId'),
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    profileId: requiredIdentifier(value.profileId, 'profileId'),
    ok: value.ok === true,
    launched: value.launched === true,
    state: ['ready', 'error'].includes(value.state) ? value.state : 'error',
    reasonCode: optionalText(value.reasonCode, 160)
  };
}

function normalizePreparationTarget(value = {}) {
  assertAllowedKeys(
    value,
    ['agentId', 'deviceId', 'requestedAppId', 'requestedClientForm'],
    'agent-prepare-target'
  );
  const target = {
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    deviceId: requiredIdentifier(value.deviceId, 'deviceId'),
    requestedAppId: requiredIdentifier(value.requestedAppId, 'requestedAppId', 80),
    requestedClientForm: requiredIdentifier(value.requestedClientForm || 'desktop', 'requestedClientForm', 80)
  };
  if (!provisioningAdapterDescriptor(target.requestedAppId, target.requestedClientForm)) {
    throw new Error('adapter-unsupported');
  }
  return target;
}

function normalizePreparationRequest(value = {}) {
  assertAllowedKeys(value, [
    'phase', 'requestId', 'agentId', 'requestedAppId', 'requestedClientForm'
  ], 'agent-prepare-request');
  if (value.phase !== 'request') throw new Error('agent-prepare-phase');
  const request = {
    phase: 'request',
    requestId: requiredIdentifier(value.requestId, 'requestId'),
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    requestedAppId: requiredIdentifier(value.requestedAppId, 'requestedAppId', 80),
    requestedClientForm: requiredIdentifier(value.requestedClientForm || 'desktop', 'requestedClientForm', 80)
  };
  if (!provisioningAdapterDescriptor(request.requestedAppId, request.requestedClientForm)) {
    throw new Error('adapter-unsupported');
  }
  return request;
}

function normalizePreparationStatus(value = {}) {
  assertAllowedKeys(value, [
    'phase', 'requestId', 'agentId', 'requestedAppId', 'requestedClientForm',
    'state', 'ok', 'launched', 'settled', 'reasonCode', 'job', 'slot'
  ], 'agent-prepare-status');
  if (value.phase !== 'status') throw new Error('agent-prepare-status-phase');
  const state = String(value.state || 'error');
  if (!PREPARATION_STATES.has(state)) throw new Error('agent-prepare-status-state');
  return {
    phase: 'status',
    requestId: requiredIdentifier(value.requestId, 'requestId'),
    agentId: requiredIdentifier(value.agentId, 'agentId'),
    requestedAppId: requiredIdentifier(value.requestedAppId, 'requestedAppId', 80),
    requestedClientForm: requiredIdentifier(value.requestedClientForm, 'requestedClientForm', 80),
    state,
    ok: value.ok === true,
    launched: value.launched === true,
    settled: value.settled === true,
    reasonCode: optionalText(value.reasonCode, 160),
    job: normalizePublicJob(value.job),
    slot: normalizePublicSlot(value.slot)
  };
}

function statusFromProvisioning(request, result = {}, settled) {
  const state = result.state || result.job?.state || 'error';
  return normalizePreparationStatus({
    phase: 'status',
    requestId: request.requestId,
    agentId: request.agentId,
    requestedAppId: request.requestedAppId,
    requestedClientForm: request.requestedClientForm,
    state,
    ok: result.ok === true || (
      result.ok !== false && !['error', 'unsupported', 'cancelled'].includes(state)
    ),
    launched: result.launched === true,
    settled: settled === true,
    reasonCode: result.reasonCode || result.reason || result.job?.lastErrorCode || null,
    job: publicJob(result.job),
    slot: publicSlot(result.slot)
  });
}

function publicJob(value) {
  if (!value) return null;
  return {
    jobId: value.jobId,
    agentId: value.agentId,
    deviceId: value.deviceId,
    requestedAppId: value.requestedAppId,
    requestedClientForm: value.requestedClientForm,
    state: value.state,
    currentStep: value.currentStep,
    completedSteps: Array.isArray(value.completedSteps) ? [...value.completedSteps] : [],
    waitingReason: value.waitingReason,
    lastErrorCode: value.lastErrorCode,
    retryCount: value.retryCount,
    updatedAt: value.updatedAt
  };
}

function normalizePublicJob(value) {
  if (!value) return null;
  assertAllowedKeys(value, [
    'jobId', 'agentId', 'deviceId', 'requestedAppId', 'requestedClientForm',
    'state', 'currentStep', 'completedSteps', 'waitingReason', 'lastErrorCode',
    'retryCount', 'updatedAt'
  ], 'agent-prepare-job');
  return {
    jobId: requiredIdentifier(value.jobId, 'jobId'),
    state: PREPARATION_STATES.has(value.state) ? value.state : 'error',
    currentStep: optionalText(value.currentStep, 80),
    waitingReason: optionalText(value.waitingReason, 160),
    lastErrorCode: optionalText(value.lastErrorCode, 160),
    updatedAt: optionalIso(value.updatedAt)
  };
}

function normalizePublicSlot(value) {
  if (!value) return null;
  assertAllowedKeys(value, ['profileId', 'appId', 'clientForm'], 'agent-prepare-slot');
  return {
    profileId: requiredIdentifier(value.profileId, 'profileId'),
    appId: requiredIdentifier(value.appId, 'appId', 80),
    clientForm: requiredIdentifier(value.clientForm || 'desktop', 'clientForm', 80)
  };
}

function publicSlot(value) {
  if (!value) return null;
  return {
    profileId: value.profileId,
    appId: value.appId,
    clientForm: value.clientForm || 'desktop'
  };
}

function assertAllowedKeys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${code}-invalid`);
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) throw new Error(`${code}-unknown-field`);
}

function requiredIdentifier(value, field, limit = 128) {
  const text = String(value || '').trim();
  if (!text || text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${field} is invalid`);
  }
  return text;
}

function optionalText(value, limit) {
  const text = String(value || '').trim().replace(/[^a-z0-9._:@-]/gi, '-').slice(0, limit);
  return text || null;
}

function optionalIso(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function safeError(error) {
  return optionalText(error?.message || error || 'agent-action-failed', 160) || 'agent-action-failed';
}

function deferred(timeoutMs, code, setTimer, clearTimer) {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = setTimer(() => reject(new Error(code)), timeoutMs);
  timer?.unref?.();
  const resolve = (value) => {
    if (settled) return;
    settled = true;
    clearTimer(timer);
    resolvePromise(value);
  };
  const reject = (error) => {
    if (settled) return;
    settled = true;
    clearTimer(timer);
    rejectPromise(error instanceof Error ? error : new Error(String(error)));
  };
  promise.catch(() => {});
  return {
    promise,
    resolve,
    reject,
    cancel: () => clearTimer(timer),
    get settled() { return settled; }
  };
}

module.exports = {
  AGENT_ACTION_TIMEOUT_MS,
  AgentActionService,
  normalizeLaunchRequest,
  normalizeLaunchResult,
  normalizePreparationRequest,
  normalizePreparationStatus,
  statusFromProvisioning
};
