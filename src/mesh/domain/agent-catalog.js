const { groupProfilesByIdentity } = require('../../identity-groups');
const { meshScopedAccountKey } = require('./identity-link');

function providerNamespace(appId) {
  const value = String(appId || '').trim().toLowerCase();
  if (value === 'claude' || value === 'claude-cli') return 'claude';
  if (value === 'kimi' || value === 'kimi-work') return 'kimi';
  return value || 'unknown';
}

function clientForm(appId) {
  const value = String(appId || '').trim().toLowerCase();
  if (value.endsWith('-cli')) return 'cli';
  if (value === 'kimi-work') return 'desktop-work';
  return 'desktop';
}

function reconcileLocalCatalog(existing = {}, profiles = [], options = {}) {
  const randomUUID = options.randomUUID;
  if (typeof randomUUID !== 'function') throw new TypeError('randomUUID is required');
  const now = options.now || new Date().toISOString();
  const deviceId = requiredText(options.deviceId, 'deviceId');
  const linkKey = options.linkKey;
  const sessionCounts = options.sessionCounts instanceof Map
    ? options.sessionCounts
    : new Map(Object.entries(options.sessionCounts || {}));
  const currentProfiles = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile && profile.id !== undefined)
    .map((profile) => ({ ...profile, id: String(profile.id) }));
  const currentIds = new Set(currentProfiles.map((profile) => profile.id));
  const previous = normalizeCatalog(existing);

  let agents = previous.agents.map((item) => ({ ...item }));
  let accountBindings = previous.accountBindings.map((item) => ({ ...item }));
  let slots = previous.slots
    .filter((slot) => slot.deviceId !== deviceId || currentIds.has(slot.profileId))
    .map((item) => ({ ...item }));
  const tombstones = previous.tombstones.map((item) => ({ ...item }));

  const profilesById = new Map(currentProfiles.map((profile) => [profile.id, profile]));
  const bindingById = () => new Map(accountBindings.map((item) => [item.accountBindingId, item]));
  const bindingsByScopedKey = () => new Map(
    accountBindings.filter((item) => item.meshScopedAccountKey)
      .map((item) => [`${item.providerNamespace}:${item.meshScopedAccountKey}`, item])
  );

  // Existing Slot ids remain the stable action target. A login change never
  // silently moves its history: the Slot is marked identity-changed instead.
  let currentBindings = bindingById();
  let scopedBindings = bindingsByScopedKey();
  slots = slots.map((slot) => {
    if (slot.deviceId !== deviceId) return slot;
    const profile = profilesById.get(slot.profileId);
    if (!profile) return slot;
    const provider = providerNamespace(profile.appId);
    const observed = scopedKeyForProfile(profile, linkKey, provider);
    const binding = currentBindings.get(slot.accountBindingId);
    let assignmentState = slot.assignmentState || 'linked';

    if (binding?.meshScopedAccountKey && observed && binding.meshScopedAccountKey !== observed) {
      assignmentState = 'identity-changed';
    } else if (binding && !binding.meshScopedAccountKey && observed) {
      const collision = scopedBindings.get(`${provider}:${observed}`);
      if (collision && collision.accountBindingId !== binding.accountBindingId) {
        assignmentState = 'identity-changed';
      } else {
        binding.meshScopedAccountKey = observed;
        binding.verificationState = 'verified';
        binding.linkMethod = 'automatic';
        binding.lastVerifiedAt = now;
        scopedBindings.set(`${provider}:${observed}`, binding);
      }
    }

    const next = {
      ...slot,
      appId: String(profile.appId || 'unknown'),
      clientForm: clientForm(profile.appId),
      localLabel: String(profile.name || profile.id),
      identityHint: manualHint(profile),
      assignmentState,
      launchable: profile.launchable !== false,
      profilePathMode: profile.profilePathMode || 'unknown',
      sessionRootMode: profile.sessionRootMode || 'unknown',
      sessionCount: finiteCount(sessionCounts.get(profile.id)),
      observedAccountKey: observed,
      observedAccountKeyVersion: observed ? 1 : null
    };
    return withUpdatedAt(slot, next, now);
  });

  const existingLocalProfileIds = new Set(
    slots.filter((slot) => slot.deviceId === deviceId).map((slot) => slot.profileId)
  );
  const newProfiles = currentProfiles.filter((profile) => !existingLocalProfileIds.has(profile.id));

  for (const group of groupProfilesByIdentity(newProfiles)) {
    currentBindings = bindingById();
    scopedBindings = bindingsByScopedKey();
    const candidateAgentIds = new Set();
    for (const profile of group.members) {
      const provider = providerNamespace(profile.appId);
      const scoped = scopedKeyForProfile(profile, linkKey, provider);
      const strongMatch = scoped ? scopedBindings.get(`${provider}:${scoped}`) : null;
      if (strongMatch) candidateAgentIds.add(strongMatch.agentId);
      const hint = manualHint(profile);
      if (hint) {
        for (const slot of slots) {
          if (slot.deviceId !== deviceId || slot.identityHint !== hint) continue;
          const binding = currentBindings.get(slot.accountBindingId);
          if (binding?.providerNamespace === provider) candidateAgentIds.add(slot.agentId);
        }
      }
    }

    const agentId = candidateAgentIds.size === 1 ? [...candidateAgentIds][0] : randomUUID();
    if (!agents.some((agent) => agent.agentId === agentId)) {
      agents.push({
        agentId,
        displayName: String(group.primary.name || 'Agent'),
        catAppearance: group.primary.cat || null,
        group: String(group.primary.group || ''),
        note: String(group.primary.note || ''),
        lifecycleState: 'active',
        createdAt: now,
        updatedAt: now
      });
    }

    const bindingGroups = new Map();
    for (const profile of group.members) {
      const provider = providerNamespace(profile.appId);
      const scoped = scopedKeyForProfile(profile, linkKey, provider);
      const hint = manualHint(profile);
      const key = scoped
        ? `strong:${provider}:${scoped}`
        : (hint ? `manual:${provider}:${hint}` : `profile:${profile.id}`);
      if (!bindingGroups.has(key)) bindingGroups.set(key, []);
      bindingGroups.get(key).push({ profile, provider, scoped, hint });
    }

    for (const members of bindingGroups.values()) {
      const first = members[0];
      let binding = first.scoped
        ? scopedBindings.get(`${first.provider}:${first.scoped}`)
        : null;
      if (binding && binding.agentId !== agentId) binding = null;
      if (!binding && first.hint) {
        binding = accountBindings.find((candidate) => (
          candidate.agentId === agentId
          && candidate.providerNamespace === first.provider
          && slots.some((slot) => (
            slot.accountBindingId === candidate.accountBindingId
            && slot.deviceId === deviceId
            && slot.identityHint === first.hint
          ))
        )) || null;
      }
      if (!binding) {
        binding = {
          accountBindingId: randomUUID(),
          agentId,
          providerNamespace: first.provider,
          displayAlias: String(first.profile.name || first.provider),
          meshScopedAccountKey: first.scoped,
          linkMethod: first.scoped ? 'automatic' : (first.hint ? 'manual' : 'imported'),
          verificationState: first.scoped ? 'verified' : (first.hint ? 'confirmed' : 'unverified'),
          createdAt: now,
          lastVerifiedAt: first.scoped ? now : null
        };
        accountBindings.push(binding);
        if (first.scoped) scopedBindings.set(`${first.provider}:${first.scoped}`, binding);
      }

      for (const { profile, scoped, hint } of members) {
        slots.push({
          deviceId,
          profileId: profile.id,
          agentId,
          accountBindingId: binding.accountBindingId,
          appId: String(profile.appId || 'unknown'),
          clientForm: clientForm(profile.appId),
          localLabel: String(profile.name || profile.id),
          identityHint: hint,
          assignmentState: 'linked',
          launchable: profile.launchable !== false,
          profilePathMode: profile.profilePathMode || 'unknown',
          sessionRootMode: profile.sessionRootMode || 'unknown',
          sessionCount: finiteCount(sessionCounts.get(profile.id)),
          observedAccountKey: scoped,
          observedAccountKeyVersion: scoped ? 1 : null,
          lastUpdatedAt: now
        });
      }
    }
  }

  // Removing the final local running position removes its empty binding and
  // Agent. Nothing is protected by provider type, and an empty catalog is valid.
  const liveBindingIds = new Set(slots.map((slot) => slot.accountBindingId).filter(Boolean));
  accountBindings = accountBindings.filter((binding) => liveBindingIds.has(binding.accountBindingId));
  const liveAgentIds = new Set([
    ...slots.map((slot) => slot.agentId),
    ...accountBindings.map((binding) => binding.agentId)
  ].filter(Boolean));
  const removedAgents = agents.filter((agent) => !liveAgentIds.has(agent.agentId));
  agents = agents.filter((agent) => liveAgentIds.has(agent.agentId));
  for (const agent of removedAgents) {
    if (!tombstones.some((item) => item.objectType === 'agent' && item.objectId === agent.agentId)) {
      tombstones.push({ objectType: 'agent', objectId: agent.agentId, deletedAt: now });
    }
  }

  const next = normalizeCatalog({ agents, accountBindings, slots, tombstones });
  const changed = catalogSignature(previous) !== catalogSignature(next);
  return {
    ...next,
    catalogRevision: changed
      ? Math.max(1, previous.catalogRevision + 1)
      : previous.catalogRevision
  };
}

function normalizeCatalog(value = {}) {
  return {
    catalogRevision: finiteCount(value.catalogRevision),
    agents: stableList(value.agents, 'agentId'),
    accountBindings: stableList(value.accountBindings, 'accountBindingId'),
    slots: (Array.isArray(value.slots) ? value.slots : [])
      .filter(Boolean)
      .map((item) => ({ ...item, deviceId: String(item.deviceId || ''), profileId: String(item.profileId || '') }))
      .sort((a, b) => `${a.deviceId}:${a.profileId}`.localeCompare(`${b.deviceId}:${b.profileId}`)),
    tombstones: (Array.isArray(value.tombstones) ? value.tombstones : [])
      .filter(Boolean)
      .map((item) => ({ ...item }))
      .sort((a, b) => `${a.objectType}:${a.objectId}`.localeCompare(`${b.objectType}:${b.objectId}`))
  };
}

function stableList(value, key) {
  return (Array.isArray(value) ? value : [])
    .filter(Boolean)
    .map((item) => ({ ...item }))
    .sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')));
}

function catalogSignature(value) {
  return JSON.stringify({
    agents: value.agents,
    accountBindings: value.accountBindings,
    slots: value.slots,
    tombstones: value.tombstones
  });
}

function scopedKeyForProfile(profile, linkKey, provider) {
  if (!profile.identityFingerprint) return null;
  return meshScopedAccountKey(linkKey, provider, profile.identityFingerprint);
}

function manualHint(profile) {
  const value = typeof profile.identityKey === 'string' ? profile.identityKey.trim() : '';
  return value ? value.toLocaleLowerCase() : null;
}

function withUpdatedAt(previous, next, now) {
  const comparablePrevious = { ...previous };
  const comparableNext = { ...next };
  delete comparablePrevious.lastUpdatedAt;
  delete comparableNext.lastUpdatedAt;
  return JSON.stringify(comparablePrevious) === JSON.stringify(comparableNext)
    ? previous
    : { ...next, lastUpdatedAt: now };
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

module.exports = {
  providerNamespace,
  clientForm,
  normalizeCatalog,
  reconcileLocalCatalog
};
