const ALLOWED_INPUT_KEYS = new Set([
  'displayName',
  'requestedAppId',
  'requestedClientForm',
  'migrationProfileIds',
  'baseRevision'
]);

function clean(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeFirstAgentInput(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('first-agent-input-invalid');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) throw new Error('first-agent-input-field-forbidden');
  }
  const displayName = clean(input.displayName, 80);
  const requestedAppId = clean(input.requestedAppId, 80);
  const requestedClientForm = clean(input.requestedClientForm, 40) || 'desktop';
  if (!displayName) throw new Error('first-agent-name-required');
  if (!options.isKnownApp?.(requestedAppId)) throw new Error('first-agent-app-invalid');
  if (!['desktop', 'cli'].includes(requestedClientForm)) {
    throw new Error('first-agent-client-form-invalid');
  }
  const migrationProfileIds = [...new Set(
    (Array.isArray(input.migrationProfileIds) ? input.migrationProfileIds : [])
      .slice(0, 256)
      .map((value) => clean(value, 128))
      .filter(Boolean)
  )];
  let baseRevision;
  if (input.baseRevision !== undefined && input.baseRevision !== null && input.baseRevision !== '') {
    baseRevision = Number(input.baseRevision);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new Error('catalog-revision-invalid');
    }
  }
  return {
    displayName,
    requestedAppId,
    requestedClientForm,
    migrationProfileIds,
    baseRevision
  };
}

function chooseExistingAgent(overview, profileIds, displayName) {
  const selected = new Set(profileIds);
  const selectedSlot = (overview.slots || []).find((slot) => selected.has(slot.profileId) && slot.agentId);
  if (selectedSlot) {
    return (overview.agents || []).find((agent) => agent.agentId === selectedSlot.agentId) || null;
  }
  const exact = (overview.agents || []).find((agent) => agent.displayName === displayName);
  if (exact) return exact;
  return (overview.agents || []).length === 1 ? overview.agents[0] : null;
}

function initializeFirstAgent(input, dependencies = {}) {
  const normalized = normalizeFirstAgentInput(input, { isKnownApp: dependencies.isKnownApp });
  const profiles = dependencies.listProfiles?.() || [];
  const knownProfileIds = new Set(profiles.map((profile) => String(profile?.id || '')));
  for (const profileId of normalized.migrationProfileIds) {
    if (!knownProfileIds.has(profileId)) throw new Error('migration-profile-not-found');
  }

  const service = dependencies.meshService;
  if (!service) throw new Error('mesh-service-required');
  let overview = service.getOverview();
  let initializedHere = false;
  try {
    if (!overview.initialized) {
      dependencies.setNetworkEnrollmentEnabled?.(false);
      overview = service.initialize({
        deviceName: dependencies.deviceName,
        displayName: 'Personal Agent Mesh',
        migrationProfileIds: normalized.migrationProfileIds
      });
      initializedHere = true;
    }

    let agent = chooseExistingAgent(
      overview,
      normalized.migrationProfileIds,
      normalized.displayName
    );
    if (!agent) {
      const previousIds = new Set((overview.agents || []).map((item) => item.agentId));
      overview = service.createAgent({
        displayName: normalized.displayName,
        baseRevision: normalized.baseRevision ?? overview.mesh?.catalogRevision
      });
      agent = (overview.agents || []).find((item) => !previousIds.has(item.agentId)) || null;
    } else if (agent.displayName !== normalized.displayName && initializedHere) {
      overview = service.updateAgent({
        agentId: agent.agentId,
        displayName: normalized.displayName,
        baseRevision: overview.mesh?.catalogRevision
      });
      agent = (overview.agents || []).find((item) => item.agentId === agent.agentId) || agent;
    }
    if (!agent) throw new Error('first-agent-result-missing');

    const selectedSlots = (overview.slots || []).filter((slot) => (
      normalized.migrationProfileIds.includes(slot.profileId)
    ));
    return {
      overview,
      agent,
      deviceId: overview.localDeviceId,
      migration: {
        requestedProfileIds: normalized.migrationProfileIds,
        mappedProfileIds: selectedSlots.map((slot) => slot.profileId),
        mappedAgentIds: [...new Set(selectedSlots.map((slot) => slot.agentId).filter(Boolean))]
      },
      requestedAppId: normalized.requestedAppId,
      requestedClientForm: normalized.requestedClientForm
    };
  } catch (error) {
    // Initialization creates only AgentDesk's Mesh database and protected key
    // bundle. If the same synchronous transaction cannot produce a first
    // Agent, remove those new artifacts; profiles and third-party data remain.
    if (initializedHere) {
      try { service.reset(); } catch (_rollbackError) { /* original error wins */ }
    }
    throw error;
  }
}

module.exports = {
  ALLOWED_INPUT_KEYS,
  normalizeFirstAgentInput,
  chooseExistingAgent,
  initializeFirstAgent
};
