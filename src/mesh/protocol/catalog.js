const { normalizeCatalog } = require('../domain/agent-catalog');
const { normalizeAgentBlueprint } = require('../domain/agent-deployment');

const CATALOG_SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_CATALOG_SNAPSHOT_BYTES = 384 * 1024;
const MAX_AGENTS = 2_000;
const MAX_ACCOUNT_BINDINGS = 4_000;
const MAX_TOMBSTONES = 8_000;

function createCatalogSnapshot(value = {}, options = {}) {
  const catalog = normalizeCatalog(value);
  const agentIds = new Set(catalog.agents.map((agent) => agent.agentId));
  const snapshot = {
    schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    meshId: requiredText(options.meshId || value.mesh?.meshId, 'meshId', 128),
    sourceDeviceId: requiredText(options.sourceDeviceId || value.mesh?.localDeviceId, 'sourceDeviceId', 128),
    revision: nonNegativeInteger(catalog.catalogRevision, 'catalogRevision'),
    generatedAt: normalizeIso(options.now || new Date().toISOString(), 'generatedAt'),
    agents: boundedList(catalog.agents, MAX_AGENTS, 'catalog-agents').map(normalizeAgent),
    accountBindings: boundedList(catalog.accountBindings, MAX_ACCOUNT_BINDINGS, 'catalog-bindings')
      .map(normalizeBinding),
    blueprints: boundedList(value.blueprints, MAX_AGENTS, 'catalog-blueprints')
      .map(normalizeAgentBlueprint)
      .filter((blueprint) => agentIds.has(blueprint.agentId)),
    tombstones: boundedList(catalog.tombstones, MAX_TOMBSTONES, 'catalog-tombstones')
      .map(normalizeTombstone)
  };
  assertSnapshotSize(snapshot);
  return snapshot;
}

function normalizeCatalogSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('catalog-snapshot-invalid');
  if (value.schemaVersion !== CATALOG_SNAPSHOT_SCHEMA_VERSION) throw new Error('catalog-snapshot-version');
  const catalog = normalizeCatalog({
    catalogRevision: nonNegativeInteger(value.revision, 'catalogRevision'),
    agents: boundedList(value.agents, MAX_AGENTS, 'catalog-agents').map(normalizeAgent),
    accountBindings: boundedList(value.accountBindings, MAX_ACCOUNT_BINDINGS, 'catalog-bindings')
      .map(normalizeBinding),
    slots: [],
    tombstones: boundedList(value.tombstones, MAX_TOMBSTONES, 'catalog-tombstones')
      .map(normalizeTombstone)
  });
  const agentIds = new Set(catalog.agents.map((agent) => agent.agentId));
  const snapshot = {
    schemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    meshId: requiredText(value.meshId, 'meshId', 128),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'sourceDeviceId', 128),
    revision: catalog.catalogRevision,
    generatedAt: normalizeIso(value.generatedAt, 'generatedAt'),
    agents: catalog.agents,
    accountBindings: catalog.accountBindings,
    blueprints: boundedList(value.blueprints, MAX_AGENTS, 'catalog-blueprints')
      .map(normalizeAgentBlueprint)
      .filter((blueprint) => agentIds.has(blueprint.agentId)),
    tombstones: catalog.tombstones
  };
  assertSnapshotSize(snapshot);
  return snapshot;
}

function mergeCatalogSnapshot(existingValue = {}, snapshotValue = {}) {
  const existing = normalizeCatalog(existingValue);
  const incoming = normalizeCatalogSnapshot(snapshotValue);
  const tombstones = mergeEntities(
    existing.tombstones,
    incoming.tombstones,
    (item) => `${item.objectType}:${item.objectId}`,
    (item) => item.deletedAt
  );
  const deletedAgents = new Set(tombstones
    .filter((item) => item.objectType === 'agent')
    .map((item) => item.objectId));
  const deletedBindings = new Set(tombstones
    .filter((item) => item.objectType === 'account-binding')
    .map((item) => item.objectId));

  const agents = mergeEntities(
    existing.agents,
    incoming.agents,
    (item) => item.agentId,
    (item) => item.updatedAt || item.createdAt
  ).filter((agent) => !deletedAgents.has(agent.agentId));
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const mergedBindings = mergeEntities(
    existing.accountBindings,
    incoming.accountBindings,
    (item) => item.accountBindingId,
    (item) => item.updatedAt || item.lastVerifiedAt || item.createdAt
  ).filter((binding) => (
    !deletedBindings.has(binding.accountBindingId)
    && !deletedAgents.has(binding.agentId)
    && agentIds.has(binding.agentId)
  ));
  const {
    accountBindings,
    bindingRemap
  } = reconcileStrongBindingConflicts(mergedBindings);
  const bindingsById = new Map(accountBindings.map((binding) => [binding.accountBindingId, binding]));
  const deletionTimes = new Map(tombstones.map((item) => [
    `${item.objectType}:${item.objectId}`,
    item.deletedAt
  ]));
  const slots = existing.slots.map((slot) => {
    const remappedBindingId = bindingRemap.get(slot.accountBindingId) || slot.accountBindingId;
    const binding = bindingsById.get(remappedBindingId);
    const agentDeleted = slot.agentId && deletedAgents.has(slot.agentId);
    const bindingDeleted = slot.accountBindingId && deletedBindings.has(slot.accountBindingId);
    if (agentDeleted || bindingDeleted) {
      return {
        ...slot,
        agentId: null,
        accountBindingId: null,
        assignmentState: 'suppressed',
        lastUpdatedAt: latestIso([
          slot.lastUpdatedAt,
          deletionTimes.get(`agent:${slot.agentId}`),
          deletionTimes.get(`account-binding:${slot.accountBindingId}`)
        ])
      };
    }
    if (!binding || !agentIds.has(binding.agentId)) return { ...slot };
    return binding.agentId === slot.agentId && remappedBindingId === slot.accountBindingId
      ? { ...slot }
      : {
          ...slot,
          agentId: binding.agentId,
          accountBindingId: binding.accountBindingId,
          lastUpdatedAt: incoming.generatedAt
        };
  });

  const blueprints = mergeEntities(
    Array.isArray(existingValue.blueprints) ? existingValue.blueprints.map(normalizeAgentBlueprint) : [],
    incoming.blueprints,
    (item) => item.agentId,
    (item) => `${String(item.revision).padStart(12, '0')}:${item.updatedAt || item.createdAt || ''}`
  ).filter((blueprint) => agentIds.has(blueprint.agentId));

  const material = { agents, accountBindings, slots, tombstones };
  const beforeCatalog = JSON.stringify({
    agents: existing.agents,
    accountBindings: existing.accountBindings,
    slots: existing.slots,
    tombstones: existing.tombstones
  });
  const afterCatalog = JSON.stringify(material);
  const beforeBlueprints = canonicalList(
    Array.isArray(existingValue.blueprints) ? existingValue.blueprints.map(normalizeAgentBlueprint) : [],
    (item) => item.agentId
  );
  const catalogChanged = beforeCatalog !== afterCatalog;
  const blueprintChanged = JSON.stringify(beforeBlueprints) !== JSON.stringify(blueprints);

  return {
    changed: catalogChanged || blueprintChanged,
    catalog: normalizeCatalog({
      ...material,
      catalogRevision: catalogChanged
        ? Math.max(existing.catalogRevision, incoming.revision) + 1
        : existing.catalogRevision
    }),
    blueprints
  };
}

function reconcileStrongBindingConflicts(value) {
  const bindingRemap = new Map();
  const bindingsByStrongKey = new Map();
  const unkeyed = [];
  for (const binding of value) {
    if (!binding.meshScopedAccountKey) {
      unkeyed.push(binding);
      continue;
    }
    const strongKey = `${binding.providerNamespace}:${binding.meshScopedAccountKey}`;
    const previous = bindingsByStrongKey.get(strongKey);
    if (!previous) {
      bindingsByStrongKey.set(strongKey, binding);
      continue;
    }
    const winner = compareEntity(
      binding,
      previous,
      (item) => item.updatedAt || item.lastVerifiedAt || item.createdAt
    ) > 0 ? binding : previous;
    const loser = winner === binding ? previous : binding;
    bindingsByStrongKey.set(strongKey, winner);
    bindingRemap.set(loser.accountBindingId, winner.accountBindingId);
    const inheritedTarget = bindingRemap.get(winner.accountBindingId);
    if (inheritedTarget) {
      bindingRemap.set(loser.accountBindingId, inheritedTarget);
    }
  }
  for (const [source, initialTarget] of bindingRemap) {
    let target = initialTarget;
    const visited = new Set([source]);
    while (bindingRemap.has(target) && !visited.has(target)) {
      visited.add(target);
      target = bindingRemap.get(target);
    }
    bindingRemap.set(source, target);
  }
  return {
    accountBindings: canonicalList([
      ...unkeyed,
      ...bindingsByStrongKey.values()
    ], (item) => item.accountBindingId),
    bindingRemap
  };
}

function mergeEntities(leftValue, rightValue, keyFor, versionFor) {
  const merged = new Map();
  for (const candidate of [...(leftValue || []), ...(rightValue || [])]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = { ...candidate };
    const key = String(keyFor(item) || '');
    if (!key) continue;
    const previous = merged.get(key);
    if (!previous || compareEntity(item, previous, versionFor) > 0) merged.set(key, item);
  }
  return canonicalList([...merged.values()], keyFor);
}

function compareEntity(left, right, versionFor) {
  const leftVersion = String(versionFor(left) || '');
  const rightVersion = String(versionFor(right) || '');
  if (leftVersion !== rightVersion) return leftVersion.localeCompare(rightVersion);
  return canonicalJson(left).localeCompare(canonicalJson(right));
}

function canonicalList(value, keyFor) {
  return [...value].sort((left, right) => String(keyFor(left) || '').localeCompare(String(keyFor(right) || '')));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function latestIso(values) {
  const valid = values
    .map((value) => ({ value, time: Date.parse(value || '') }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => right.time - left.time);
  return valid[0]?.value || new Date(0).toISOString();
}

function normalizeAgent(value = {}) {
  return {
    agentId: requiredText(value.agentId, 'agentId', 128),
    displayName: cleanText(value.displayName, 'Agent', 80),
    catAppearance: shallowRecord(value.catAppearance, 24, 160),
    group: cleanText(value.group, '', 80),
    note: cleanText(value.note, '', 1000),
    lifecycleState: ['active', 'paused', 'deleting', 'deleted'].includes(value.lifecycleState)
      ? value.lifecycleState
      : 'active',
    createdAt: normalizeIso(value.createdAt || value.updatedAt, 'agent-createdAt'),
    updatedAt: normalizeIso(value.updatedAt || value.createdAt, 'agent-updatedAt')
  };
}

function normalizeBinding(value = {}) {
  return {
    accountBindingId: requiredText(value.accountBindingId, 'accountBindingId', 128),
    agentId: requiredText(value.agentId, 'binding-agentId', 128),
    providerNamespace: requiredText(value.providerNamespace, 'providerNamespace', 80),
    displayAlias: cleanText(value.displayAlias, value.providerNamespace || 'Account', 80),
    meshScopedAccountKey: optionalText(value.meshScopedAccountKey, 256),
    linkMethod: ['automatic', 'manual', 'imported'].includes(value.linkMethod)
      ? value.linkMethod
      : 'imported',
    verificationState: ['verified', 'confirmed', 'unverified', 'identity-changed'].includes(value.verificationState)
      ? value.verificationState
      : 'unverified',
    createdAt: normalizeIso(value.createdAt || value.updatedAt, 'binding-createdAt'),
    updatedAt: normalizeOptionalIso(value.updatedAt || value.lastVerifiedAt || value.createdAt),
    lastVerifiedAt: normalizeOptionalIso(value.lastVerifiedAt)
  };
}

function normalizeTombstone(value = {}) {
  const objectType = String(value.objectType || '');
  if (!['agent', 'account-binding'].includes(objectType)) throw new Error('catalog-tombstone-type');
  return {
    objectType,
    objectId: requiredText(value.objectId, 'tombstone-objectId', 128),
    deletedAt: normalizeIso(value.deletedAt, 'tombstone-deletedAt')
  };
}

function shallowRecord(value, maxKeys, maxText) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).slice(0, maxKeys).flatMap(([key, item]) => {
    const safeKey = String(key || '').trim().slice(0, 80);
    if (!safeKey || !['string', 'number', 'boolean'].includes(typeof item)) return [];
    return [[safeKey, typeof item === 'string' ? item.slice(0, maxText) : item]];
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function boundedList(value, limit, field) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw new Error(`${field}-too-large`);
  return value.filter(Boolean).map((item) => ({ ...item }));
}

function assertSnapshotSize(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_CATALOG_SNAPSHOT_BYTES) {
    throw new Error('catalog-snapshot-too-large');
  }
}

function normalizeIso(value, field) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

function normalizeOptionalIso(value) {
  if (!value) return null;
  return normalizeIso(value, 'timestamp');
}

function optionalText(value, limit) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : null;
}

function cleanText(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

module.exports = {
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  MAX_CATALOG_SNAPSHOT_BYTES,
  createCatalogSnapshot,
  normalizeCatalogSnapshot,
  mergeCatalogSnapshot,
  normalizeAgent,
  normalizeBinding,
  normalizeTombstone,
  reconcileStrongBindingConflicts,
  canonicalJson
};
