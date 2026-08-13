const BLUEPRINT_SCHEMA_VERSION = 1;

const DEPLOYMENT_STATES = Object.freeze([
  'absent',
  'planning',
  'preparing',
  'waiting-install',
  'waiting-login',
  'verifying',
  'ready',
  'error',
  'unsupported',
  'retired'
]);

const JOB_STATES = Object.freeze([
  'planning',
  'preparing',
  'waiting-install',
  'waiting-login',
  'verifying',
  'ready',
  'error',
  'cancelled'
]);

const ACTIVE_JOB_STATES = Object.freeze(new Set([
  'planning',
  'preparing',
  'waiting-install',
  'waiting-login',
  'verifying'
]));

function reconcileAgentRuntimeModel(snapshot = {}, options = {}) {
  const now = normalizeIso(options.now) || new Date().toISOString();
  const localDeviceId = requiredText(options.localDeviceId || snapshot.mesh?.localDeviceId, 'localDeviceId');
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const bindings = Array.isArray(snapshot.accountBindings) ? snapshot.accountBindings : [];
  const slots = Array.isArray(snapshot.slots) ? snapshot.slots : [];
  const existingBlueprints = new Map((Array.isArray(snapshot.blueprints) ? snapshot.blueprints : [])
    .map((item) => [String(item?.agentId || ''), item]));
  const existingDeployments = new Map((Array.isArray(snapshot.deployments) ? snapshot.deployments : [])
    .map((item) => [deploymentKey(item?.agentId, item?.deviceId), item]));
  const activeJobs = new Map((Array.isArray(snapshot.provisioningJobs) ? snapshot.provisioningJobs : [])
    .filter((job) => ACTIVE_JOB_STATES.has(job?.state))
    .map((job) => [deploymentKey(job.agentId, job.deviceId), job]));

  const blueprints = agents.map((agent) => reconcileBlueprint(
    existingBlueprints.get(String(agent.agentId)),
    agent,
    bindings,
    slots,
    { localDeviceId, now }
  ));

  const deployments = (Array.isArray(snapshot.deployments) ? snapshot.deployments : [])
    .filter((deployment) => agents.some((agent) => agent.agentId === deployment.agentId))
    .map(normalizeAgentDeployment)
    .filter((deployment) => deployment.deviceId !== localDeviceId);

  for (const agent of agents) {
    const key = deploymentKey(agent.agentId, localDeviceId);
    const previous = existingDeployments.get(key);
    const activeJob = activeJobs.get(key);
    deployments.push(deriveLocalDeployment(agent, slots, blueprints, {
      localDeviceId,
      previous,
      activeJob,
      now
    }));
  }

  return {
    blueprints: stableBy(blueprints, (item) => item.agentId),
    deployments: stableBy(deployments, (item) => deploymentKey(item.agentId, item.deviceId))
  };
}

function reconcileBlueprint(existing, agent, bindings, slots, options = {}) {
  if (!existing) return normalizeAgentBlueprint(deriveBlueprint(agent, bindings, slots, options));
  const previous = normalizeAgentBlueprint(existing);
  const bindingIds = bindings
    .filter((binding) => binding.agentId === agent.agentId)
    .map((binding) => binding.accountBindingId);
  const liveBindingIds = new Set(bindingIds);
  const desiredBindingIds = previous.desiredBindingIds.filter((bindingId) => liveBindingIds.has(bindingId));
  const alreadyDesired = new Set(desiredBindingIds);
  for (const bindingId of bindingIds) {
    if (!alreadyDesired.has(bindingId)) desiredBindingIds.push(bindingId);
  }
  if (JSON.stringify(desiredBindingIds) === JSON.stringify(previous.desiredBindingIds)) return previous;
  return normalizeAgentBlueprint({
    ...previous,
    desiredBindingIds,
    revision: previous.revision + 1,
    updatedAt: options.now,
    updatedByDeviceId: options.localDeviceId
  });
}

function deriveBlueprint(agent, bindings, slots, options = {}) {
  const agentBindings = bindings.filter((binding) => binding.agentId === agent.agentId);
  const bindingIds = new Set(agentBindings.map((binding) => binding.accountBindingId));
  const agentSlots = slots.filter((slot) => (
    slot.agentId === agent.agentId
    && slot.assignmentState === 'linked'
    && bindingIds.has(slot.accountBindingId)
  ));
  const preferred = agentSlots.find((slot) => slot.deviceId === options.localDeviceId)
    || agentSlots[0]
    || null;
  const preferredBinding = preferred
    ? agentBindings.find((binding) => binding.accountBindingId === preferred.accountBindingId)
    : agentBindings[0] || null;
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    blueprintId: `blueprint:${agent.agentId}`,
    agentId: agent.agentId,
    revision: 1,
    preferredProvider: preferredBinding?.providerNamespace || null,
    preferredAppId: preferred?.appId || null,
    preferredClientForm: preferred?.clientForm || null,
    desiredBindingIds: agentBindings.map((binding) => binding.accountBindingId),
    portableSettings: {},
    skillRequirements: [],
    toolRequirements: [],
    projectRequirements: [],
    createdAt: agent.createdAt || options.now,
    updatedAt: options.now,
    updatedByDeviceId: options.localDeviceId
  };
}

function deriveLocalDeployment(agent, slots, blueprints, options = {}) {
  const localSlots = slots.filter((slot) => (
    slot.agentId === agent.agentId
    && slot.deviceId === options.localDeviceId
    && slot.assignmentState !== 'suppressed'
  ));
  const linkedSlots = localSlots.filter((slot) => slot.assignmentState === 'linked');
  const launchableSlots = linkedSlots.filter((slot) => slot.launchable !== false);
  const identityChanged = localSlots.find((slot) => slot.assignmentState === 'identity-changed');
  const blueprint = blueprints.find((item) => item.agentId === agent.agentId);
  let state = launchableSlots.length ? 'ready' : (linkedSlots.length ? 'waiting-install' : 'absent');
  let lastErrorCode = linkedSlots.length && !launchableSlots.length ? 'client-unavailable' : null;
  if (identityChanged && !linkedSlots.length) {
    state = 'error';
    lastErrorCode = 'identity-changed';
  }
  if (options.activeJob) {
    state = options.activeJob.state;
    lastErrorCode = options.activeJob.lastErrorCode || null;
  }
  const previous = options.previous || {};
  const preferredSlot = launchableSlots.find((slot) => (
    `${slot.deviceId}:${slot.profileId}` === previous.preferredSlotKey
  )) || launchableSlots[0] || linkedSlots[0] || null;
  const material = {
    deploymentId: previous.deploymentId || `deployment:${agent.agentId}:${options.localDeviceId}`,
    agentId: agent.agentId,
    deviceId: options.localDeviceId,
    blueprintRevision: blueprint?.revision || 0,
    state,
    preferredSlotKey: preferredSlot ? `${preferredSlot.deviceId}:${preferredSlot.profileId}` : null,
    slotKeys: linkedSlots.map((slot) => `${slot.deviceId}:${slot.profileId}`).sort(),
    adapterId: preferredSlot?.appId || blueprint?.preferredAppId || null,
    adapterVersion: previous.adapterVersion || null,
    lastVerifiedAt: state === 'ready'
      ? (previous.lastVerifiedAt || options.now)
      : previous.lastVerifiedAt || null,
    lastOpenedAt: previous.lastOpenedAt || null,
    lastErrorCode,
    resumeJobId: options.activeJob?.jobId || null,
    revision: Math.max(1, Number(previous.revision) || 0),
    updatedAt: options.now
  };
  if (!deploymentMaterialChanged(previous, material)) return normalizeAgentDeployment(previous);
  material.revision = Math.max(1, (Number(previous.revision) || 0) + 1);
  return normalizeAgentDeployment(material);
}

function normalizeAgentBlueprint(value = {}) {
  const agentId = requiredText(value.agentId, 'agentId');
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    blueprintId: cleanText(value.blueprintId, `blueprint:${agentId}`, 180),
    agentId,
    revision: positiveInteger(value.revision, 1),
    preferredProvider: optionalText(value.preferredProvider, 80),
    preferredAppId: optionalText(value.preferredAppId, 80),
    preferredClientForm: optionalText(value.preferredClientForm, 80),
    desiredBindingIds: stringList(value.desiredBindingIds, 64, 128),
    portableSettings: plainRecord(value.portableSettings),
    skillRequirements: objectList(value.skillRequirements, 128),
    toolRequirements: objectList(value.toolRequirements, 128),
    projectRequirements: objectList(value.projectRequirements, 128),
    createdAt: normalizeIso(value.createdAt) || new Date(0).toISOString(),
    updatedAt: normalizeIso(value.updatedAt) || new Date(0).toISOString(),
    updatedByDeviceId: optionalText(value.updatedByDeviceId, 128)
  };
}

function normalizeAgentDeployment(value = {}) {
  const agentId = requiredText(value.agentId, 'agentId');
  const deviceId = requiredText(value.deviceId, 'deviceId');
  const state = DEPLOYMENT_STATES.includes(value.state) ? value.state : 'absent';
  return {
    deploymentId: cleanText(value.deploymentId, `deployment:${agentId}:${deviceId}`, 260),
    agentId,
    deviceId,
    blueprintRevision: nonNegativeInteger(value.blueprintRevision),
    state,
    preferredSlotKey: optionalText(value.preferredSlotKey, 260),
    slotKeys: stringList(value.slotKeys, 64, 260),
    adapterId: optionalText(value.adapterId, 80),
    adapterVersion: optionalText(value.adapterVersion, 80),
    lastVerifiedAt: normalizeIso(value.lastVerifiedAt),
    lastOpenedAt: normalizeIso(value.lastOpenedAt),
    lastErrorCode: optionalText(value.lastErrorCode, 160),
    resumeJobId: optionalText(value.resumeJobId, 128),
    revision: positiveInteger(value.revision, 1),
    updatedAt: normalizeIso(value.updatedAt) || new Date(0).toISOString()
  };
}

function normalizeProvisioningJob(value = {}) {
  const jobId = requiredText(value.jobId, 'jobId');
  const state = JOB_STATES.includes(value.state) ? value.state : 'planning';
  return {
    jobId,
    agentId: requiredText(value.agentId, 'agentId'),
    deviceId: requiredText(value.deviceId, 'deviceId'),
    requestedAppId: optionalText(value.requestedAppId, 80),
    requestedClientForm: optionalText(value.requestedClientForm, 80),
    blueprintRevision: nonNegativeInteger(value.blueprintRevision),
    state,
    currentStep: optionalText(value.currentStep, 80) || 'plan',
    completedSteps: stringList(value.completedSteps, 32, 80),
    stagingProfileId: optionalText(value.stagingProfileId, 128),
    resultSlotKey: optionalText(value.resultSlotKey, 260),
    waitingReason: optionalText(value.waitingReason, 160),
    lastErrorCode: optionalText(value.lastErrorCode, 160),
    retryCount: nonNegativeInteger(value.retryCount),
    createdAt: normalizeIso(value.createdAt) || new Date(0).toISOString(),
    updatedAt: normalizeIso(value.updatedAt) || new Date(0).toISOString(),
    completedAt: normalizeIso(value.completedAt),
    cancelledAt: normalizeIso(value.cancelledAt)
  };
}

function activeJobKey(job) {
  const normalized = normalizeProvisioningJob(job);
  if (!ACTIVE_JOB_STATES.has(normalized.state)) return null;
  return [
    normalized.agentId,
    normalized.deviceId,
    normalized.requestedClientForm || normalized.requestedAppId || 'default'
  ].join(':');
}

function deploymentKey(agentId, deviceId) {
  return `${String(agentId || '')}:${String(deviceId || '')}`;
}

function deploymentMaterialChanged(previous = {}, next = {}) {
  const keys = [
    'blueprintRevision', 'state', 'preferredSlotKey', 'adapterId', 'adapterVersion',
    'lastVerifiedAt', 'lastOpenedAt', 'lastErrorCode', 'resumeJobId'
  ];
  if (keys.some((key) => (previous[key] || null) !== (next[key] || null))) return true;
  return JSON.stringify(previous.slotKeys || []) !== JSON.stringify(next.slotKeys || []);
}

function stableBy(items, keyFor) {
  return [...items].sort((left, right) => keyFor(left).localeCompare(keyFor(right)));
}

function objectList(value, limit) {
  return (Array.isArray(value) ? value : []).slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    return [{ ...item }];
  });
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function stringList(value, maxItems, maxLength) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function normalizeIso(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function optionalText(value, limit) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : null;
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function cleanText(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

module.exports = {
  BLUEPRINT_SCHEMA_VERSION,
  DEPLOYMENT_STATES,
  JOB_STATES,
  ACTIVE_JOB_STATES,
  reconcileAgentRuntimeModel,
  reconcileBlueprint,
  deriveBlueprint,
  normalizeAgentBlueprint,
  normalizeAgentDeployment,
  normalizeProvisioningJob,
  activeJobKey,
  deploymentKey
};
