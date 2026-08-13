const crypto = require('node:crypto');
const { canonicalEncode } = require('./identity-link');
const {
  normalizeCatalog,
  providerNamespace: providerNamespaceForApp
} = require('./agent-catalog');

const INVENTORY_SCHEMA_VERSION = 1;
const MAX_INVENTORY_SESSIONS = 20_000;
const MAX_INVENTORY_BYTES = 16 * 1024 * 1024;

function buildLocalInventory(input = {}, options = {}) {
  const now = normalizeIso(options.now || new Date().toISOString(), 'generatedAt');
  const staleAfterMs = clampNumber(options.staleAfterMs, 30_000, 24 * 60 * 60_000, 5 * 60_000);
  const deviceId = requiredText(input.deviceId, 'deviceId', 128);
  const revision = nonNegativeInteger(input.revision, 'revision');
  const catalog = normalizeCatalog(input.catalog || {});
  const localSlots = catalog.slots.filter((slot) => slot.deviceId === deviceId);
  const localAgentIds = new Set(localSlots.map((slot) => slot.agentId).filter(Boolean));
  const localBindingIds = new Set(localSlots.map((slot) => slot.accountBindingId).filter(Boolean));
  const localBindingsById = new Map(catalog.accountBindings
    .filter((binding) => localBindingIds.has(binding.accountBindingId))
    .map((binding) => [binding.accountBindingId, binding]));
  const sessionsByProfile = input.sessionsByProfile instanceof Map
    ? input.sessionsByProfile
    : new Map(Object.entries(input.sessionsByProfile || {}));
  const replicas = [];
  const includeLegacyCatalogProjection = options.includeLegacyCatalogProjection !== false;

  for (const slot of localSlots) {
    const records = sessionsByProfile.get(String(slot.profileId));
    for (const record of Array.isArray(records) ? records : []) {
      if (replicas.length >= MAX_INVENTORY_SESSIONS) break;
      const replica = sessionReplica(record, slot, {
        deviceId,
        linkKey: input.linkKey,
        providerNamespace: localBindingsById.get(slot.accountBindingId)?.providerNamespace
      });
      if (replica) replicas.push(replica);
    }
  }

  const inventory = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    deviceId,
    revision,
    generatedAt: now,
    staleAt: new Date(Date.parse(now) + staleAfterMs).toISOString(),
    catalog: {
      catalogRevision: catalog.catalogRevision,
      agents: includeLegacyCatalogProjection
        ? catalog.agents.filter((agent) => localAgentIds.has(agent.agentId))
        : [],
      accountBindings: includeLegacyCatalogProjection
        ? catalog.accountBindings.filter((binding) => localBindingIds.has(binding.accountBindingId))
        : [],
      slots: localSlots,
      tombstones: includeLegacyCatalogProjection ? catalog.tombstones : []
    },
    sessions: replicas
  };
  assertInventorySize(inventory);
  return inventory;
}

function normalizeInventory(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('inventory-invalid');
  if (value.schemaVersion !== INVENTORY_SCHEMA_VERSION) throw new Error('inventory-version');
  const deviceId = requiredText(value.deviceId, 'deviceId', 128);
  const generatedAt = normalizeIso(value.generatedAt, 'generatedAt');
  const staleAt = normalizeIso(value.staleAt, 'staleAt');
  if (Date.parse(staleAt) <= Date.parse(generatedAt)) throw new Error('inventory-stale-time');
  const sessions = (Array.isArray(value.sessions) ? value.sessions : [])
    .slice(0, MAX_INVENTORY_SESSIONS)
    .map((item) => normalizeReplica(item, deviceId));
  const normalized = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    deviceId,
    revision: nonNegativeInteger(value.revision, 'revision'),
    generatedAt,
    staleAt,
    catalog: normalizeCatalog(value.catalog || {}),
    sessions
  };
  if (normalized.catalog.slots.some((slot) => slot.deviceId !== deviceId)) {
    throw new Error('inventory-foreign-slot');
  }
  if (sessions.some((session) => session.deviceId !== deviceId)) throw new Error('inventory-foreign-session');
  assertInventorySize(normalized);
  return normalized;
}

function mergeCatalogInventory(existingValue, inventoryValue, options = {}) {
  const existing = normalizeCatalog(existingValue || {});
  const inventory = normalizeInventory(inventoryValue);
  const deviceId = inventory.deviceId;
  const allowLegacyCatalogProjection = options.allowLegacyCatalogProjection === true;
  // Inventory is authorized by inventory.read and therefore never owns global
  // tombstones or existing Agent/Binding relationships. Older peers may supply
  // an additive compatibility projection, but only when catalog.manage is also
  // currently authorized by the receiver.
  const tombstones = existing.tombstones.map((item) => ({ ...item }));
  const deletedAgents = new Set(tombstones
    .filter((item) => item.objectType === 'agent')
    .map((item) => item.objectId));
  const deletedBindings = new Set(tombstones
    .filter((item) => item.objectType === 'account-binding')
    .map((item) => item.objectId));
  const agents = existing.agents.map((agent) => ({ ...agent }));
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const bindings = existing.accountBindings.map((binding) => ({ ...binding }));
  const bindingsById = new Map(bindings.map((binding) => [binding.accountBindingId, binding]));
  const bindingsByStrongKey = new Map(bindings.filter((binding) => binding.meshScopedAccountKey).map((binding) => [
    `${binding.providerNamespace}:${binding.meshScopedAccountKey}`,
    binding
  ]));
  const bindingRemap = new Map();
  const incomingAgentsById = new Map(inventory.catalog.agents.map((agent) => [agent.agentId, agent]));
  const incomingBindingsById = new Map(inventory.catalog.accountBindings.map((binding) => [
    binding.accountBindingId,
    binding
  ]));
  const referencedBindingIds = new Set(inventory.catalog.slots
    .map((slot) => slot.accountBindingId)
    .filter(Boolean));

  for (const bindingId of referencedBindingIds) {
    const incoming = incomingBindingsById.get(bindingId);
    const existingById = bindingsById.get(bindingId);
    const strongKey = incoming?.meshScopedAccountKey
      ? `${incoming.providerNamespace}:${incoming.meshScopedAccountKey}`
      : null;
    const existingStrong = strongKey ? bindingsByStrongKey.get(strongKey) : null;
    const target = existingById || existingStrong;
    if (target && !deletedBindings.has(target.accountBindingId) && !deletedAgents.has(target.agentId)) {
      bindingRemap.set(bindingId, target);
      continue;
    }
    if (!allowLegacyCatalogProjection || !incoming) continue;
    if (deletedBindings.has(incoming.accountBindingId) || deletedAgents.has(incoming.agentId)) continue;
    const incomingAgent = incomingAgentsById.get(incoming.agentId);
    if (!agentIds.has(incoming.agentId)) {
      if (!incomingAgent) continue;
      agents.push({ ...incomingAgent });
      agentIds.add(incoming.agentId);
    }
    const copy = { ...incoming };
    bindings.push(copy);
    bindingsById.set(copy.accountBindingId, copy);
    if (strongKey) bindingsByStrongKey.set(strongKey, copy);
    bindingRemap.set(copy.accountBindingId, copy);
  }

  const keptSlots = existing.slots.filter((slot) => slot.deviceId !== deviceId);
  const incomingSlots = inventory.catalog.slots.map((slot) => {
    const incomingBinding = incomingBindingsById.get(slot.accountBindingId);
    const observedStrongKey = slot.observedAccountKey
      ? `${providerNamespaceForApp(slot.appId)}:${slot.observedAccountKey}`
      : null;
    const mapped = bindingRemap.get(slot.accountBindingId)
      || bindingsById.get(slot.accountBindingId)
      || (observedStrongKey ? bindingsByStrongKey.get(observedStrongKey) : null)
      || (incomingBinding?.meshScopedAccountKey
        ? bindingsByStrongKey.get(`${incomingBinding.providerNamespace}:${incomingBinding.meshScopedAccountKey}`)
        : null);
    if (
      mapped
      && agentIds.has(mapped.agentId)
      && !deletedAgents.has(mapped.agentId)
      && !deletedBindings.has(mapped.accountBindingId)
    ) {
      return {
        ...slot,
        deviceId,
        accountBindingId: mapped.accountBindingId,
        agentId: mapped.agentId
      };
    }
    return {
      ...slot,
      deviceId,
      agentId: null,
      accountBindingId: null,
      assignmentState: (
        slot.assignmentState === 'suppressed'
        || deletedAgents.has(slot.agentId)
        || deletedBindings.has(slot.accountBindingId)
      ) ? 'suppressed' : 'pending'
    };
  });

  const material = normalizeCatalog({
    catalogRevision: existing.catalogRevision,
    agents,
    accountBindings: bindings,
    slots: [...keptSlots, ...incomingSlots],
    tombstones
  });
  const changed = catalogMaterialSignature(existing) !== catalogMaterialSignature(material);
  material.catalogRevision = changed
    ? Math.max(existing.catalogRevision + 1, Number(options.catalogRevision) || 0)
    : existing.catalogRevision;
  return material;
}

function canonicalizeInventorySessions(inventoryValue, catalogValue, options = {}) {
  const inventory = normalizeInventory(inventoryValue);
  const catalog = normalizeCatalog(catalogValue || {});
  const agentIds = new Set(catalog.agents.map((agent) => agent.agentId));
  const bindingsById = new Map(catalog.accountBindings.map((binding) => [
    binding.accountBindingId,
    binding
  ]));
  const slotsByProfile = new Map(catalog.slots
    .flatMap((slot) => {
      const binding = bindingsById.get(slot.accountBindingId);
      if (
        slot.deviceId !== inventory.deviceId
        || slot.assignmentState !== 'linked'
        || !slot.agentId
        || !agentIds.has(slot.agentId)
        || !binding
        || binding.agentId !== slot.agentId
      ) return [];
      return [[String(slot.profileId), { slot, binding }]];
    }));

  const sessions = inventory.sessions.flatMap((replica) => {
    const canonical = slotsByProfile.get(String(replica.profileId));
    // Catalog tombstones and suppressed/unassigned Slots remain authoritative:
    // an older source inventory cannot keep their sessions visible.
    if (!canonical) return [];
    const { slot, binding } = canonical;

    const adapterConversationKey = replica.stableProviderThreadId
      || replica.adapterConversationKey;
    const identityInput = replica.stableProviderThreadId
      ? {
          kind: 'provider',
          provider: binding.providerNamespace || providerNamespaceForApp(slot.appId || replica.appId),
          accountBindingId: slot.accountBindingId,
          adapterConversationKey
        }
      : {
          kind: 'device',
          deviceId: inventory.deviceId,
          profileId: slot.profileId,
          adapterConversationKey
        };

    return [normalizeReplica({
      ...replica,
      conversationId: stableHmac(options.linkKey, identityInput),
      agentId: slot.agentId,
      accountBindingId: slot.accountBindingId
    }, inventory.deviceId)];
  });

  // Only the receiver's canonical directory projection changes. Revision,
  // freshness, source metadata and replica identity remain source-owned.
  return normalizeInventory({ ...inventory, sessions });
}

function unifiedConversations(inventories, devices = [], options = {}) {
  const localDeviceId = String(options.localDeviceId || '');
  const deviceById = new Map((Array.isArray(devices) ? devices : []).map((device) => [device.deviceId, device]));
  const groups = new Map();
  for (const raw of Array.isArray(inventories) ? inventories : []) {
    let inventory;
    try { inventory = normalizeInventory(raw); } catch (_error) { continue; }
    const device = deviceById.get(inventory.deviceId) || {};
    const stale = Date.parse(inventory.staleAt) <= Date.now() || device.status === 'offline';
    for (const replica of inventory.sessions) {
      const enriched = {
        ...replica,
        deviceName: cleanText(device.name, inventory.deviceId, 80),
        deviceStatus: device.status || 'offline',
        inventoryGeneratedAt: inventory.generatedAt,
        stale
      };
      if (!groups.has(replica.conversationId)) groups.set(replica.conversationId, []);
      groups.get(replica.conversationId).push(enriched);
    }
  }

  return [...groups.entries()].map(([conversationId, replicas]) => {
    replicas.sort((a, b) => compareReplicaPreference(a, b, localDeviceId));
    const current = replicas[0];
    return {
      id: current.adapterConversationKey || conversationId,
      address: current.adapterConversationKey || conversationId,
      conversationId,
      appId: current.appId,
      title: current.title,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      projectPath: current.projectPathHint,
      filePath: current.sourceFileHint,
      source: current.source,
      status: current.status,
      model: current.model,
      _agentId: current.agentId,
      _accountBindingId: current.accountBindingId,
      _profileId: current.profileId,
      _deviceId: current.deviceId,
      _deviceName: current.deviceName,
      _replicaId: current.replicaId,
      _remote: current.deviceId !== localDeviceId,
      _stale: current.stale,
      replicas
    };
  }).sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
}

function sessionReplica(record, slot, context) {
  if (!record || typeof record !== 'object') return null;
  if (slot.assignmentState !== 'linked' || !slot.agentId || !slot.accountBindingId) return null;
  const stableProviderThreadId = cleanText(
    record.stableProviderThreadId || record.adapterConversationKey,
    '',
    512
  );
  const adapterConversationKey = cleanText(
    stableProviderThreadId || record.address || record.id,
    '',
    512
  );
  if (!adapterConversationKey) return null;
  const strong = Boolean(stableProviderThreadId);
  const identityInput = strong
    ? {
        kind: 'provider',
        provider: context.providerNamespace || providerNamespaceForApp(slot.appId || record.appId),
        accountBindingId: slot.accountBindingId,
        adapterConversationKey
      }
    : {
        kind: 'device',
        deviceId: context.deviceId,
        profileId: slot.profileId,
        adapterConversationKey
      };
  const conversationId = stableHmac(context.linkKey, identityInput);
  const replicaId = stableHmac(context.linkKey, {
    kind: 'replica',
    deviceId: context.deviceId,
    profileId: slot.profileId,
    adapterConversationKey
  });
  return normalizeReplica({
    replicaId,
    conversationId,
    deviceId: context.deviceId,
    profileId: slot.profileId,
    agentId: slot.agentId,
    accountBindingId: slot.accountBindingId,
    appId: record.appId || slot.appId,
    adapterConversationKey,
    stableProviderThreadId: strong ? stableProviderThreadId : null,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    projectPathHint: record.projectPath,
    sourceFileHint: record.filePath,
    source: record.source,
    status: record.status,
    model: record.model,
    portability: 'pointer-only'
  }, context.deviceId);
}

function normalizeReplica(value, expectedDeviceId) {
  const deviceId = requiredText(value.deviceId, 'replica.deviceId', 128);
  if (expectedDeviceId && deviceId !== expectedDeviceId) throw new Error('replica-device-mismatch');
  return {
    replicaId: requiredText(value.replicaId, 'replicaId', 128),
    conversationId: requiredText(value.conversationId, 'conversationId', 128),
    deviceId,
    profileId: requiredText(value.profileId, 'profileId', 128),
    agentId: requiredText(value.agentId, 'agentId', 128),
    accountBindingId: requiredText(value.accountBindingId, 'accountBindingId', 128),
    appId: cleanText(value.appId, 'unknown', 80),
    adapterConversationKey: cleanText(value.adapterConversationKey, '', 512),
    stableProviderThreadId: cleanText(value.stableProviderThreadId, '', 512) || null,
    title: cleanText(value.title, 'Untitled session', 500),
    createdAt: optionalIso(value.createdAt),
    updatedAt: optionalIso(value.updatedAt),
    projectPathHint: cleanPath(value.projectPathHint) || null,
    sourceFileHint: cleanPath(value.sourceFileHint) || null,
    source: cleanText(value.source, '', 120) || null,
    status: cleanText(value.status, '', 80) || null,
    model: cleanText(value.model, '', 120) || null,
    portability: value.portability === 'bundle-import' ? 'bundle-import' : 'pointer-only'
  };
}

function compareReplicaPreference(left, right, localDeviceId) {
  const local = Number(right.deviceId === localDeviceId) - Number(left.deviceId === localDeviceId);
  if (local) return local;
  const online = Number(right.deviceStatus === 'online') - Number(left.deviceStatus === 'online');
  if (online) return online;
  const fresh = Number(left.stale) - Number(right.stale);
  if (fresh) return fresh;
  return Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0);
}

function stableHmac(key, value) {
  const secret = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ''), 'base64');
  if (secret.length < 16) throw new TypeError('inventory link key is required');
  return crypto.createHmac('sha256', secret).update(canonicalEncode(value)).digest('base64url');
}

function mergeByKey(primary, incoming, keyOf) {
  const map = new Map();
  for (const item of Array.isArray(primary) ? primary : []) map.set(keyOf(item), { ...item });
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, { ...item });
  }
  return [...map.values()];
}

function catalogMaterialSignature(value) {
  return JSON.stringify({
    agents: value.agents,
    accountBindings: value.accountBindings,
    slots: value.slots,
    tombstones: value.tombstones
  });
}

function assertInventorySize(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_INVENTORY_BYTES) throw new Error('inventory-too-large');
}

function requiredText(value, field, limit = 512) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function cleanText(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

function cleanPath(value) {
  return String(value || '').trim().slice(0, 4096);
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

function optionalIso(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

module.exports = {
  INVENTORY_SCHEMA_VERSION,
  MAX_INVENTORY_SESSIONS,
  buildLocalInventory,
  normalizeInventory,
  mergeCatalogInventory,
  canonicalizeInventorySessions,
  unifiedConversations,
  sessionReplica
};
