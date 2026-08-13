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

  // AgentIdentity and AccountBinding are durable catalog objects. A missing
  // local Profile only removes this device's runtime location; it must never
  // infer that the employee or platform login was deleted.

  const next = normalizeCatalog({ agents, accountBindings, slots, tombstones });
  const changed = catalogSignature(previous) !== catalogSignature(next);
  return {
    ...next,
    catalogRevision: changed
      ? Math.max(1, previous.catalogRevision + 1)
      : previous.catalogRevision
  };
}

function updateAgentMetadata(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  const agentId = requiredText(input.agentId, 'agentId');
  const index = previous.agents.findIndex((agent) => agent.agentId === agentId);
  if (index < 0) throw new Error('agent-not-found');
  const now = options.now || new Date().toISOString();
  const agents = previous.agents.map((agent, agentIndex) => {
    if (agentIndex !== index) return agent;
    const next = { ...agent };
    if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
      next.displayName = cleanText(input.displayName, agent.displayName || 'Agent', 80);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'group')) next.group = cleanText(input.group, '', 80);
    if (Object.prototype.hasOwnProperty.call(input, 'note')) next.note = cleanText(input.note, '', 1000);
    if (input.catAppearance && typeof input.catAppearance === 'object' && !Array.isArray(input.catAppearance)) {
      next.catAppearance = { ...input.catAppearance };
    }
    next.updatedAt = now;
    return next;
  });
  return finalizeMutation(previous, { ...previous, agents });
}

function createAgentIdentity(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  if (typeof options.randomUUID !== 'function') throw new TypeError('randomUUID is required');
  const now = options.now || new Date().toISOString();
  const agentId = options.randomUUID();
  const agent = {
    agentId,
    displayName: cleanText(input.displayName, 'Agent', 80),
    catAppearance: input.catAppearance && typeof input.catAppearance === 'object'
      ? { ...input.catAppearance }
      : null,
    group: cleanText(input.group, '', 80),
    note: cleanText(input.note, '', 1000),
    lifecycleState: 'active',
    createdAt: now,
    updatedAt: now
  };
  return finalizeMutation(previous, {
    ...previous,
    agents: [...previous.agents, agent]
  });
}

function assignSlot(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  const deviceId = requiredText(input.deviceId, 'deviceId');
  const profileId = requiredText(input.profileId, 'profileId');
  const mode = String(input.mode || '').trim();
  if (!['existing-binding', 'existing-agent', 'new-agent'].includes(mode)) {
    throw new Error('slot-assignment-mode-invalid');
  }
  const now = options.now || new Date().toISOString();
  const randomUUID = options.randomUUID;
  const reuseProvisional = options.reuseProvisional === true;
  const slotIndex = previous.slots.findIndex((slot) => (
    slot.deviceId === deviceId && slot.profileId === profileId
  ));
  if (slotIndex < 0) throw new Error('slot-not-found');

  let agents = previous.agents.map((item) => ({ ...item }));
  let accountBindings = previous.accountBindings.map((item) => ({ ...item }));
  const slots = previous.slots.map((item) => ({ ...item }));
  let tombstones = previous.tombstones.map((item) => ({ ...item }));
  const slot = slots[slotIndex];
  const oldAgentId = slot.agentId;
  const oldBindingId = slot.accountBindingId;
  const oldAgent = oldAgentId ? agents.find((item) => item.agentId === oldAgentId) : null;
  const oldBinding = oldBindingId
    ? accountBindings.find((item) => item.accountBindingId === oldBindingId)
    : null;
  const provider = providerNamespace(slot.appId);
  const observedAccountKey = slot.observedAccountKey || null;
  const reusableProvisional = reuseProvisional
    && oldAgent
    && oldBinding
    && oldBinding.agentId === oldAgent.agentId
    && oldBinding.providerNamespace === provider
    && slots.filter((item) => item.agentId === oldAgentId).length === 1
    && accountBindings.filter((item) => item.agentId === oldAgentId).length === 1
    && slots.filter((item) => item.accountBindingId === oldBindingId).length === 1;
  const bindingWithObservedKey = observedAccountKey
    ? accountBindings.find((item) => (
      item.providerNamespace === provider
      && item.meshScopedAccountKey === observedAccountKey
    ))
    : null;
  let agent;
  let binding;

  if (mode === 'existing-binding') {
    binding = accountBindings.find((item) => item.accountBindingId === requiredText(input.accountBindingId, 'accountBindingId'));
    if (!binding) throw new Error('account-binding-not-found');
    agent = agents.find((item) => item.agentId === binding.agentId);
    if (!agent) throw new Error('agent-not-found');
    if (binding.providerNamespace !== provider) throw new Error('binding-provider-mismatch');
    if (observedAccountKey && binding.meshScopedAccountKey && binding.meshScopedAccountKey !== observedAccountKey) {
      throw new Error('binding-identity-mismatch');
    }
    if (observedAccountKey && !binding.meshScopedAccountKey) {
      if (bindingWithObservedKey && bindingWithObservedKey.accountBindingId !== binding.accountBindingId) {
        throw new Error('account-binding-conflict');
      }
      binding.meshScopedAccountKey = observedAccountKey;
      binding.linkMethod = 'automatic';
      binding.verificationState = 'verified';
      binding.lastVerifiedAt = now;
    }
  } else if (mode === 'existing-agent') {
    agent = agents.find((item) => item.agentId === requiredText(input.agentId, 'agentId'));
    if (!agent) throw new Error('agent-not-found');
    if (bindingWithObservedKey) {
      if (bindingWithObservedKey.agentId === agent.agentId) {
        binding = bindingWithObservedKey;
      } else if (reusableProvisional && bindingWithObservedKey.accountBindingId === oldBindingId) {
        binding = bindingWithObservedKey;
        binding.agentId = agent.agentId;
      } else {
        throw new Error('account-binding-conflict');
      }
    } else if (
      reusableProvisional
      && (!oldBinding.meshScopedAccountKey || oldBinding.meshScopedAccountKey === observedAccountKey)
    ) {
      binding = oldBinding;
      binding.agentId = agent.agentId;
      if (observedAccountKey && !binding.meshScopedAccountKey) {
        binding.meshScopedAccountKey = observedAccountKey;
        binding.linkMethod = 'automatic';
        binding.verificationState = 'verified';
        binding.lastVerifiedAt = now;
      }
    } else {
      binding = createBinding({
        randomUUID,
        agentId: agent.agentId,
        provider,
        slot,
        observedAccountKey,
        displayAlias: input.displayAlias,
        now
      });
      accountBindings.push(binding);
    }
  } else {
    if (bindingWithObservedKey && !(reusableProvisional && bindingWithObservedKey.accountBindingId === oldBindingId)) {
      throw new Error('account-binding-conflict');
    }
    if (reusableProvisional) {
      agent = oldAgent;
      binding = oldBinding;
    } else {
      if (typeof randomUUID !== 'function') throw new TypeError('randomUUID is required');
      agent = {
        agentId: randomUUID(),
        displayName: cleanText(input.displayName, slot.localLabel || 'Agent', 80),
        catAppearance: input.catAppearance && typeof input.catAppearance === 'object' ? { ...input.catAppearance } : null,
        group: cleanText(input.group, '', 80),
        note: cleanText(input.note, '', 1000),
        lifecycleState: 'active',
        createdAt: now,
        updatedAt: now
      };
      agents.push(agent);
      binding = createBinding({
        randomUUID,
        agentId: agent.agentId,
        provider,
        slot,
        observedAccountKey,
        displayAlias: input.displayAlias,
        now
      });
      accountBindings.push(binding);
    }
    if (reusableProvisional) {
      agent.displayName = cleanText(input.displayName, agent.displayName || slot.localLabel || 'Agent', 80);
      if (Object.prototype.hasOwnProperty.call(input, 'group')) agent.group = cleanText(input.group, '', 80);
      if (Object.prototype.hasOwnProperty.call(input, 'note')) agent.note = cleanText(input.note, '', 1000);
      agent.updatedAt = now;
      binding.displayAlias = cleanText(input.displayAlias, binding.displayAlias || slot.localLabel || slot.appId || 'Account', 80);
    }
  }

  slots[slotIndex] = {
    ...slot,
    agentId: agent.agentId,
    accountBindingId: binding.accountBindingId,
    assignmentState: 'linked',
    lastUpdatedAt: now
  };

  if (reuseProvisional && agent.agentId !== oldAgentId) {
    const oldBindingStillUsed = slots.some((item) => item.accountBindingId === oldBindingId);
    if (!oldBindingStillUsed) accountBindings = accountBindings.filter((item) => item.accountBindingId !== oldBindingId);
    const oldAgentStillUsed = slots.some((item) => item.agentId === oldAgentId)
      || accountBindings.some((item) => item.agentId === oldAgentId);
    if (!oldAgentStillUsed) agents = agents.filter((item) => item.agentId !== oldAgentId);
  }

  return finalizeMutation(previous, { ...previous, agents, accountBindings, slots, tombstones });
}

function createBinding({ randomUUID, agentId, provider, slot, observedAccountKey, displayAlias, now }) {
  if (typeof randomUUID !== 'function') throw new TypeError('randomUUID is required');
  return {
    accountBindingId: randomUUID(),
    agentId,
    providerNamespace: provider,
    displayAlias: cleanText(displayAlias, slot.localLabel || slot.appId || 'Account', 80),
    meshScopedAccountKey: observedAccountKey,
    linkMethod: observedAccountKey ? 'automatic' : 'manual',
    verificationState: observedAccountKey ? 'verified' : 'confirmed',
    createdAt: now,
    lastVerifiedAt: observedAccountKey ? now : null
  };
}

function mergeAgents(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  const sourceAgentId = requiredText(input.sourceAgentId, 'sourceAgentId');
  const targetAgentId = requiredText(input.targetAgentId, 'targetAgentId');
  if (sourceAgentId === targetAgentId) throw new Error('agent-merge-same');
  if (!previous.agents.some((agent) => agent.agentId === sourceAgentId)) throw new Error('agent-not-found');
  if (!previous.agents.some((agent) => agent.agentId === targetAgentId)) throw new Error('agent-not-found');
  const now = options.now || new Date().toISOString();
  const agents = previous.agents
    .filter((agent) => agent.agentId !== sourceAgentId)
    .map((agent) => agent.agentId === targetAgentId ? { ...agent, updatedAt: now } : { ...agent });
  let tombstones = previous.tombstones.map((item) => ({ ...item }));
  const accountBindings = previous.accountBindings
    .filter((binding) => binding.agentId !== sourceAgentId)
    .map((binding) => ({ ...binding }));
  const targetStrongBindings = new Map(accountBindings
    .filter((binding) => binding.agentId === targetAgentId && binding.meshScopedAccountKey)
    .map((binding) => [bindingStrongKey(binding), binding]));
  const bindingRemap = new Map();
  for (const sourceBinding of previous.accountBindings.filter((binding) => binding.agentId === sourceAgentId)) {
    const strongKey = bindingStrongKey(sourceBinding);
    const duplicate = strongKey ? targetStrongBindings.get(strongKey) : null;
    if (duplicate) {
      bindingRemap.set(sourceBinding.accountBindingId, duplicate.accountBindingId);
      tombstones = addTombstone(tombstones, 'account-binding', sourceBinding.accountBindingId, now);
      continue;
    }
    const moved = { ...sourceBinding, agentId: targetAgentId };
    accountBindings.push(moved);
    if (strongKey) targetStrongBindings.set(strongKey, moved);
  }
  const slots = previous.slots.map((slot) => (
    slot.agentId === sourceAgentId || bindingRemap.has(slot.accountBindingId)
      ? {
          ...slot,
          agentId: targetAgentId,
          accountBindingId: bindingRemap.get(slot.accountBindingId) || slot.accountBindingId,
          lastUpdatedAt: now
        }
      : { ...slot }
  ));
  tombstones = addTombstone(tombstones, 'agent', sourceAgentId, now);
  return finalizeMutation(previous, { ...previous, agents, accountBindings, slots, tombstones });
}

function bindingStrongKey(binding) {
  return binding?.meshScopedAccountKey
    ? `${binding.providerNamespace}:${binding.meshScopedAccountKey}`
    : null;
}

function splitAccountBinding(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  const accountBindingId = requiredText(input.accountBindingId, 'accountBindingId');
  const binding = previous.accountBindings.find((item) => item.accountBindingId === accountBindingId);
  if (!binding) throw new Error('account-binding-not-found');
  if (typeof options.randomUUID !== 'function') throw new TypeError('randomUUID is required');
  const now = options.now || new Date().toISOString();
  const agentId = options.randomUUID();
  const agent = {
    agentId,
    displayName: cleanText(input.displayName, binding.displayAlias || 'Agent', 80),
    catAppearance: input.catAppearance && typeof input.catAppearance === 'object' ? { ...input.catAppearance } : null,
    group: cleanText(input.group, '', 80),
    note: cleanText(input.note, '', 1000),
    lifecycleState: 'active',
    createdAt: now,
    updatedAt: now
  };
  const agents = [...previous.agents.map((item) => ({ ...item })), agent];
  const accountBindings = previous.accountBindings.map((item) => (
    item.accountBindingId === accountBindingId ? { ...item, agentId } : { ...item }
  ));
  const slots = previous.slots.map((slot) => (
    slot.accountBindingId === accountBindingId ? { ...slot, agentId, lastUpdatedAt: now } : { ...slot }
  ));
  return finalizeMutation(previous, {
    ...previous,
    agents,
    accountBindings,
    slots,
    tombstones: previous.tombstones.map((item) => ({ ...item }))
  });
}

function removeCatalogObject(existing = {}, input = {}, options = {}) {
  const previous = normalizeCatalog(existing);
  const scope = String(input.scope || '').trim();
  if (!['slot', 'account-binding', 'agent'].includes(scope)) throw new Error('catalog-remove-scope-invalid');
  const now = options.now || new Date().toISOString();
  let agents = previous.agents.map((item) => ({ ...item }));
  let accountBindings = previous.accountBindings.map((item) => ({ ...item }));
  let slots = previous.slots.map((item) => ({ ...item }));
  let tombstones = previous.tombstones.map((item) => ({ ...item }));
  if (scope === 'slot') {
    const deviceId = requiredText(input.deviceId, 'deviceId');
    const profileId = requiredText(input.profileId, 'profileId');
    const index = slots.findIndex((slot) => slot.deviceId === deviceId && slot.profileId === profileId);
    if (index < 0) throw new Error('slot-not-found');
    slots[index] = suppressSlot(slots[index], now);
  } else if (scope === 'account-binding') {
    const accountBindingId = requiredText(input.accountBindingId, 'accountBindingId');
    const binding = accountBindings.find((item) => item.accountBindingId === accountBindingId);
    if (!binding) throw new Error('account-binding-not-found');
    slots = slots.map((slot) => slot.accountBindingId === accountBindingId ? suppressSlot(slot, now) : slot);
    accountBindings = accountBindings.filter((item) => item.accountBindingId !== accountBindingId);
    tombstones = addTombstone(tombstones, 'account-binding', accountBindingId, now);
  } else {
    const agentId = requiredText(input.agentId, 'agentId');
    if (!agents.some((agent) => agent.agentId === agentId)) throw new Error('agent-not-found');
    const removedBindingIds = [];
    for (const binding of accountBindings) {
      if (binding.agentId === agentId) removedBindingIds.push(binding.accountBindingId);
    }
    slots = slots.map((slot) => slot.agentId === agentId ? suppressSlot(slot, now) : slot);
    accountBindings = accountBindings.filter((binding) => binding.agentId !== agentId);
    agents = agents.filter((agent) => agent.agentId !== agentId);
    for (const bindingId of removedBindingIds) {
      tombstones = addTombstone(tombstones, 'account-binding', bindingId, now);
    }
    tombstones = addTombstone(tombstones, 'agent', agentId, now);
  }
  return finalizeMutation(previous, { ...previous, agents, accountBindings, slots, tombstones });
}

function suppressSlot(slot, now) {
  return {
    ...slot,
    agentId: null,
    accountBindingId: null,
    assignmentState: 'suppressed',
    lastUpdatedAt: now
  };
}

function addTombstone(value, objectType, objectId, deletedAt) {
  if (!objectId) return value;
  const filtered = value.filter((item) => !(item.objectType === objectType && item.objectId === objectId));
  return [...filtered, { objectType, objectId, deletedAt }];
}

function finalizeMutation(previous, draft) {
  const next = normalizeCatalog({ ...draft, catalogRevision: previous.catalogRevision });
  const before = JSON.stringify({
    agents: previous.agents,
    accountBindings: previous.accountBindings,
    slots: previous.slots,
    tombstones: previous.tombstones
  });
  const after = JSON.stringify({
    agents: next.agents,
    accountBindings: next.accountBindings,
    slots: next.slots,
    tombstones: next.tombstones
  });
  next.catalogRevision = before === after ? previous.catalogRevision : previous.catalogRevision + 1;
  return next;
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

function cleanText(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

module.exports = {
  providerNamespace,
  clientForm,
  normalizeCatalog,
  reconcileLocalCatalog,
  createAgentIdentity,
  updateAgentMetadata,
  assignSlot,
  mergeAgents,
  splitAccountBinding,
  removeCatalogObject
};
