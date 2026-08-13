const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');
const { normalizeCatalog } = require('../domain/agent-catalog');
const { normalizeAgentBlueprint } = require('../domain/agent-deployment');
const { certificateDigest, verifyMembershipChain } = require('./handshake');
const {
  normalizeAgent,
  normalizeBinding,
  reconcileStrongBindingConflicts,
  canonicalJson
} = require('./catalog');

const CATALOG_EVENT_SCHEMA_VERSION = 1;
const CATALOG_EVENT_SYNC_SCHEMA_VERSION = 1;
// Keep the complete signed payload comfortably below the 192 KiB final
// DataChannel envelope budget established by the physical dual-Mac run.
const MAX_CATALOG_EVENT_BYTES = 144 * 1024;
const MAX_CATALOG_EVENT_BATCH_BYTES = 160 * 1024;
const MAX_CATALOG_EVENTS = 8_000;
const MAX_EVENT_OPERATIONS = 4_096;
const MAX_CAUSAL_PARENTS = 64;
const MAX_VECTOR_DEVICES = 64;

const OBJECT_FIELDS = Object.freeze({
  agent: Object.freeze([
    'agentId',
    'displayName',
    'catAppearance',
    'group',
    'note',
    'lifecycleState',
    'createdAt',
    'updatedAt'
  ]),
  'account-binding': Object.freeze([
    'accountBindingId',
    'agentId',
    'providerNamespace',
    'displayAlias',
    'meshScopedAccountKey',
    'linkMethod',
    'verificationState',
    'createdAt',
    'updatedAt',
    'lastVerifiedAt'
  ]),
  blueprint: Object.freeze([
    'schemaVersion',
    'blueprintId',
    'agentId',
    'revision',
    'preferredProvider',
    'preferredAppId',
    'preferredClientForm',
    'desiredBindingIds',
    'portableSettings',
    'skillRequirements',
    'toolRequirements',
    'projectRequirements',
    'createdAt',
    'updatedAt',
    'updatedByDeviceId'
  ])
});

const TRANSACTION_KINDS = new Set(['bootstrap', 'ordinary', 'structural', 'compatibility']);
const EVENT_PAYLOAD_FIELDS = Object.freeze([
  'schemaVersion',
  'eventId',
  'meshId',
  'sourceDeviceId',
  'sourceSequence',
  'lamport',
  'causalParents',
  'baseRevision',
  'eventType',
  'transactionKind',
  'originDeviceId',
  'operations',
  'createdAt',
  'signerCertificateDigest'
]);
const SIGNED_EVENT_FIELDS = Object.freeze([
  ...EVENT_PAYLOAD_FIELDS,
  'signerCertificate',
  'signerCertificateChain',
  'signature'
]);

function createCatalogEvent(input = {}, signer = {}, options = {}) {
  const now = normalizeIso(input.createdAt || options.now || new Date().toISOString(), 'catalog-event-createdAt');
  const payload = normalizeEventPayload({
    schemaVersion: CATALOG_EVENT_SCHEMA_VERSION,
    eventId: input.eventId || (options.randomUUID ? options.randomUUID() : crypto.randomUUID()),
    meshId: input.meshId,
    sourceDeviceId: input.sourceDeviceId,
    sourceSequence: input.sourceSequence,
    lamport: input.lamport,
    causalParents: input.causalParents,
    baseRevision: input.baseRevision,
    eventType: input.eventType,
    transactionKind: input.transactionKind,
    originDeviceId: input.originDeviceId,
    operations: input.operations,
    createdAt: now,
    signerCertificateDigest: certificateDigest(signer.membershipCertificate)
  });
  const event = {
    ...payload,
    signerCertificate: signer.membershipCertificate,
    signerCertificateChain: Array.isArray(signer.membershipChain) ? signer.membershipChain : [],
    signature: crypto.sign(
      null,
      Buffer.from(canonicalEncode(payload)),
      signer.devicePrivateKey
    ).toString('base64')
  };
  assertEventSize(event);
  return event;
}

function verifyCatalogEvent(value, rootPublicKey, options = {}) {
  try {
    const event = normalizeCatalogEvent(value);
    const certificate = verifyMembershipChain(
      event.signerCertificate,
      event.signerCertificateChain,
      rootPublicKey,
      options
    );
    if (!certificate.ok) return certificate;
    if (
      certificate.payload.meshId !== event.meshId
      || certificate.payload.deviceId !== event.sourceDeviceId
    ) return failure('catalog-event-signer');
    if (!certificate.payload.roles.includes('catalog.manage')) {
      return failure('catalog-event-not-authorized');
    }
    if (event.signerCertificateDigest !== certificateDigest(event.signerCertificate)) {
      return failure('catalog-event-certificate');
    }
    const signature = Buffer.from(String(event.signature || ''), 'base64');
    if (!signature.length || !crypto.verify(
      null,
      Buffer.from(canonicalEncode(catalogEventPayload(event))),
      certificate.payload.devicePublicKey,
      signature
    )) return failure('catalog-event-signature');
    const now = options.now ? Date.parse(options.now) : Date.now();
    const createdAt = Date.parse(event.createdAt);
    if (!Number.isFinite(now) || !Number.isFinite(createdAt) || createdAt > now + 5 * 60_000) {
      return failure('catalog-event-time');
    }
    return { ok: true, event, signer: certificate.payload };
  } catch (_error) {
    return failure('catalog-event-invalid');
  }
}

function normalizeCatalogEvent(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('catalog-event-invalid');
  assertOnlyKeys(value, SIGNED_EVENT_FIELDS, 'catalog-event-field-unknown');
  if (!Array.isArray(value.signerCertificateChain)) throw new TypeError('catalog-event-chain-invalid');
  if (value.signerCertificateChain.length > 16) throw new TypeError('catalog-event-chain-too-large');
  const payload = normalizeEventPayload(value);
  const event = {
    ...payload,
    signerCertificate: value.signerCertificate,
    signerCertificateChain: value.signerCertificateChain,
    signature: requiredText(value.signature, 'catalog-event-signature', 512)
  };
  assertEventSize(event);
  return event;
}

function catalogEventPayload(value = {}) {
  return normalizeEventPayload(value);
}

function normalizeEventPayload(value = {}) {
  const schemaVersion = Number(value.schemaVersion);
  if (schemaVersion !== CATALOG_EVENT_SCHEMA_VERSION) throw new Error('catalog-event-version');
  if (!Array.isArray(value.causalParents)) throw new Error('catalog-event-parents-invalid');
  const causalParents = uniqueTexts(value.causalParents, MAX_CAUSAL_PARENTS, 128);
  const eventId = requiredText(value.eventId, 'catalog-event-id', 128);
  if (causalParents.includes(eventId)) throw new Error('catalog-event-self-parent');
  const transactionKind = String(value.transactionKind || 'ordinary').trim();
  if (!TRANSACTION_KINDS.has(transactionKind)) throw new Error('catalog-event-transaction-kind');
  const operations = boundedList(value.operations, MAX_EVENT_OPERATIONS, 'catalog-event-operations')
    .map(normalizeOperation)
    .sort(compareOperation);
  if (!operations.length) throw new Error('catalog-event-operations-empty');
  return {
    schemaVersion,
    eventId,
    meshId: requiredText(value.meshId, 'catalog-event-mesh', 128),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'catalog-event-source', 128),
    sourceSequence: positiveInteger(value.sourceSequence, 'catalog-event-source-sequence'),
    lamport: positiveInteger(value.lamport, 'catalog-event-lamport'),
    causalParents,
    baseRevision: nonNegativeInteger(value.baseRevision, 'catalog-event-base-revision'),
    eventType: requiredText(value.eventType, 'catalog-event-type', 120),
    transactionKind,
    originDeviceId: optionalText(value.originDeviceId, 128),
    operations,
    createdAt: normalizeIso(value.createdAt, 'catalog-event-createdAt'),
    signerCertificateDigest: requiredText(
      value.signerCertificateDigest,
      'catalog-event-certificate-digest',
      128
    )
  };
}

function normalizeOperation(value = {}) {
  const objectType = String(value.objectType || '').trim();
  if (!Object.prototype.hasOwnProperty.call(OBJECT_FIELDS, objectType)) {
    throw new Error('catalog-event-object-type');
  }
  const objectId = requiredText(value.objectId, 'catalog-event-object-id', 128);
  const action = String(value.action || '').trim();
  if (action === 'delete') {
    assertOnlyKeys(value, ['objectType', 'objectId', 'action'], 'catalog-event-operation-field-unknown');
    return { objectType, objectId, action };
  }
  if (action !== 'upsert') throw new Error('catalog-event-operation-action');
  assertOnlyKeys(
    value,
    ['objectType', 'objectId', 'action', 'changedFields', 'value'],
    'catalog-event-operation-field-unknown'
  );
  if (!value.value || typeof value.value !== 'object' || Array.isArray(value.value)) {
    throw new Error('catalog-event-object-value-invalid');
  }
  assertOnlyKeys(value.value, OBJECT_FIELDS[objectType], 'catalog-event-object-field-unknown');
  const normalizedValue = normalizeObjectValue(objectType, value.value);
  if (objectIdFor(objectType, normalizedValue) !== objectId) {
    throw new Error('catalog-event-object-id-mismatch');
  }
  const allowed = OBJECT_FIELDS[objectType];
  const changedFields = uniqueTexts(value.changedFields, allowed.length, 80);
  if (changedFields.some((field) => !allowed.includes(field))) {
    throw new Error('catalog-event-field-unknown');
  }
  if (!changedFields.length) throw new Error('catalog-event-fields-empty');
  return {
    objectType,
    objectId,
    action,
    changedFields: changedFields.sort(),
    value: normalizedValue
  };
}

function diffCatalogState(beforeValue = {}, afterValue = {}) {
  const before = normalizeCatalog(beforeValue);
  const after = normalizeCatalog(afterValue);
  const operations = [];
  diffObjectList('agent', before.agents, after.agents, operations);
  diffObjectList('account-binding', before.accountBindings, after.accountBindings, operations);
  diffObjectList(
    'blueprint',
    normalizeBlueprints(beforeValue.blueprints),
    normalizeBlueprints(afterValue.blueprints),
    operations
  );

  const beforeTombstones = new Map(before.tombstones.map((item) => [
    `${item.objectType}:${item.objectId}`,
    item.deletedAt
  ]));
  for (const tombstone of after.tombstones) {
    const key = `${tombstone.objectType}:${tombstone.objectId}`;
    if (beforeTombstones.get(key) === tombstone.deletedAt) continue;
    setDeleteOperation(operations, tombstone.objectType, tombstone.objectId);
  }
  return operations.sort(compareOperation);
}

function catalogCoverageOperations(snapshot = {}, eventsValue = []) {
  const events = normalizeEventList(eventsValue);
  const eventState = materializeCatalogEvents({
    catalogRevision: 0,
    agents: [],
    accountBindings: [],
    slots: [],
    blueprints: [],
    tombstones: []
  }, events, { catalogRevision: 0 });
  // A local repair event must never be attached to an already incomplete
  // causal graph. The missing parent will be requested from a peer first.
  if (eventState.unresolvedEventIds.length) return [];
  return diffCatalogState({
    ...eventState.catalog,
    blueprints: eventState.blueprints
  }, snapshot);
}

function splitCoverageOperations(value, maxOperations = 64) {
  const operations = boundedList(value, MAX_EVENT_OPERATIONS, 'catalog-coverage-operations')
    .map(normalizeOperation);
  const chunks = [];
  let current = [];
  for (const operation of operations) {
    const candidate = [...current, operation];
    if (
      current.length
      && (
        candidate.length > maxOperations
        || Buffer.byteLength(JSON.stringify(candidate)) > MAX_CATALOG_EVENT_BYTES / 2
      )
    ) {
      chunks.push(current);
      current = [operation];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function materializeCatalogEvents(baseValue = {}, eventsValue = {}, options = {}) {
  const base = normalizeCatalog(baseValue);
  const events = normalizeEventList(eventsValue);
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const ready = new Map();
  const visiting = new Set();
  const isReady = (event) => {
    if (ready.has(event.eventId)) return ready.get(event.eventId);
    if (visiting.has(event.eventId)) return false;
    visiting.add(event.eventId);
    const result = event.causalParents.every((parentId) => {
      const parent = eventById.get(parentId);
      return parent ? isReady(parent) : false;
    });
    visiting.delete(event.eventId);
    ready.set(event.eventId, result);
    return result;
  };
  const applicable = events.filter(isReady);
  const ancestryCache = new Map();
  const isAncestor = (ancestorId, descendantId) => {
    if (ancestorId === descendantId) return true;
    const cacheKey = `${ancestorId}:${descendantId}`;
    if (ancestryCache.has(cacheKey)) return ancestryCache.get(cacheKey);
    const descendant = eventById.get(descendantId);
    if (!descendant) return false;
    const found = descendant.causalParents.some((parentId) => (
      parentId === ancestorId || isAncestor(ancestorId, parentId)
    ));
    ancestryCache.set(cacheKey, found);
    return found;
  };

  const rejectedStructural = new Set();
  const structural = applicable.filter((event) => event.transactionKind === 'structural');
  const touches = new Map(structural.map((event) => [event.eventId, new Set(event.operations.map(operationKey))]));
  for (let leftIndex = 0; leftIndex < structural.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < structural.length; rightIndex += 1) {
      const left = structural[leftIndex];
      const right = structural[rightIndex];
      if (isAncestor(left.eventId, right.eventId) || isAncestor(right.eventId, left.eventId)) continue;
      if (!setsIntersect(touches.get(left.eventId), touches.get(right.eventId))) continue;
      const leftDeletes = left.operations.some((operation) => operation.action === 'delete');
      const rightDeletes = right.operations.some((operation) => operation.action === 'delete');
      if (leftDeletes !== rightDeletes) {
        rejectedStructural.add(leftDeletes ? right.eventId : left.eventId);
      } else {
        rejectedStructural.add(compareEventClock(left, right) < 0 ? left.eventId : right.eventId);
      }
    }
  }
  const accepted = applicable.filter((event) => !rejectedStructural.has(event.eventId));
  const objectStates = new Map();
  for (const event of accepted) {
    for (const operation of event.operations) {
      const key = operationKey(operation);
      if (!objectStates.has(key)) objectStates.set(key, {
        objectType: operation.objectType,
        objectId: operation.objectId,
        deletes: [],
        fields: new Map()
      });
      const state = objectStates.get(key);
      if (operation.action === 'delete') {
        state.deletes.push({ event });
        continue;
      }
      for (const field of operation.changedFields) {
        if (!state.fields.has(field)) state.fields.set(field, []);
        state.fields.get(field).push({
          event,
          value: cloneJson(operation.value[field])
        });
      }
    }
  }

  const conflicts = [];
  for (const eventId of rejectedStructural) {
    conflicts.push({ type: 'structural-concurrent', eventId });
  }
  const existing = {
    agent: new Map(base.agents.map((item) => [item.agentId, item])),
    'account-binding': new Map(base.accountBindings.map((item) => [item.accountBindingId, item])),
    blueprint: new Map(normalizeBlueprints(baseValue.blueprints).map((item) => [item.agentId, item]))
  };
  const material = { agent: [], 'account-binding': [], blueprint: [] };
  const baseDeleted = new Map(base.tombstones.map((item) => [
    `${item.objectType}:${item.objectId}`,
    { ...item }
  ]));
  const derivedTombstones = new Map(baseDeleted);

  for (const objectType of Object.keys(OBJECT_FIELDS)) {
    const keys = new Set([
      ...existing[objectType].keys(),
      ...[...objectStates.values()]
        .filter((state) => state.objectType === objectType)
        .map((state) => state.objectId)
    ]);
    for (const objectId of keys) {
      const state = objectStates.get(`${objectType}:${objectId}`);
      const inheritedDelete = baseDeleted.get(`${objectType}:${objectId}`);
      if (state?.deletes.length || inheritedDelete) {
        if (objectType !== 'blueprint') {
          const winner = state?.deletes.sort((left, right) => compareEventClock(right.event, left.event))[0];
          derivedTombstones.set(`${objectType}:${objectId}`, winner ? {
            objectType,
            objectId,
            deletedAt: winner.event.createdAt,
            eventId: winner.event.eventId,
            sourceDeviceId: winner.event.sourceDeviceId,
            lamport: winner.event.lamport
          } : inheritedDelete);
        }
        continue;
      }
      if (!state) {
        const legacy = existing[objectType].get(objectId);
        if (legacy) material[objectType].push({ ...legacy });
        continue;
      }
      const draft = idSeed(objectType, objectId);
      for (const [field, candidates] of state.fields) {
        const ordered = [...candidates].sort((left, right) => compareEventClock(right.event, left.event));
        const winner = ordered[0];
        draft[field] = cloneJson(winner.value);
        for (const loser of ordered.slice(1)) {
          if (canonicalJson(loser.value) === canonicalJson(winner.value)) continue;
          if (
            isAncestor(loser.event.eventId, winner.event.eventId)
            || isAncestor(winner.event.eventId, loser.event.eventId)
          ) continue;
          conflicts.push({
            type: 'field-concurrent',
            objectType,
            objectId,
            field,
            winnerEventId: winner.event.eventId,
            loserEventId: loser.event.eventId,
            winnerSourceDeviceId: winner.event.sourceDeviceId,
            loserSourceDeviceId: loser.event.sourceDeviceId
          });
          break;
        }
      }
      if (objectType === 'agent' || objectType === 'account-binding') {
        const latestObjectEvent = [...state.fields.values()]
          .flat()
          .map((candidate) => candidate.event)
          .sort((left, right) => compareEventClock(right, left))[0];
        if (latestObjectEvent) draft.updatedAt = latestObjectEvent.createdAt;
      }
      try {
        material[objectType].push(normalizeObjectValue(objectType, draft));
      } catch (_error) {
        const legacy = existing[objectType].get(objectId);
        if (legacy) material[objectType].push({ ...legacy });
        conflicts.push({ type: 'object-incomplete', objectType, objectId });
      }
    }
  }

  const tombstones = [...derivedTombstones.values()]
    .filter(Boolean)
    .sort((left, right) => `${left.objectType}:${left.objectId}`.localeCompare(`${right.objectType}:${right.objectId}`));
  const deletedAgents = new Set(tombstones.filter((item) => item.objectType === 'agent').map((item) => item.objectId));
  const deletedBindings = new Set(tombstones
    .filter((item) => item.objectType === 'account-binding')
    .map((item) => item.objectId));
  const agents = material.agent.filter((agent) => !deletedAgents.has(agent.agentId));
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const reconciledBindings = reconcileStrongBindingConflicts(material['account-binding'].filter((binding) => (
    !deletedBindings.has(binding.accountBindingId)
    && !deletedAgents.has(binding.agentId)
    && agentIds.has(binding.agentId)
  )));
  const accountBindings = reconciledBindings.accountBindings;
  const bindingsById = new Map(accountBindings.map((binding) => [binding.accountBindingId, binding]));
  const slots = base.slots.map((slot) => {
    const remappedBindingId = reconciledBindings.bindingRemap.get(slot.accountBindingId) || slot.accountBindingId;
    const binding = bindingsById.get(remappedBindingId);
    if (
      (slot.agentId && deletedAgents.has(slot.agentId))
      || (slot.accountBindingId && deletedBindings.has(slot.accountBindingId))
    ) return suppressSlot(slot, latestDeleteTime(slot, tombstones));
    if (!binding) return { ...slot };
    if (slot.agentId === binding.agentId && slot.accountBindingId === binding.accountBindingId) return { ...slot };
    return {
      ...slot,
      agentId: binding.agentId,
      accountBindingId: binding.accountBindingId,
      lastUpdatedAt: options.now || new Date().toISOString()
    };
  });
  const blueprints = material.blueprint.filter((blueprint) => agentIds.has(blueprint.agentId));
  const catalog = normalizeCatalog({
    agents,
    accountBindings,
    slots,
    tombstones,
    catalogRevision: nonNegativeInteger(
      options.catalogRevision === undefined ? base.catalogRevision : options.catalogRevision,
      'catalog-revision'
    )
  });
  const changed = catalogMaterialSignature(baseValue) !== catalogMaterialSignature({
    ...catalog,
    blueprints
  });
  return {
    changed,
    catalog,
    blueprints,
    conflicts: conflicts.slice(0, 256),
    acceptedEventIds: accepted.map((event) => event.eventId),
    unresolvedEventIds: events.filter((event) => !ready.get(event.eventId)).map((event) => event.eventId),
    rejectedEventIds: [...rejectedStructural]
  };
}

function catalogEventVector(eventsValue = []) {
  const grouped = new Map();
  for (const event of normalizeEventList(eventsValue)) {
    if (!grouped.has(event.sourceDeviceId)) grouped.set(event.sourceDeviceId, new Set());
    grouped.get(event.sourceDeviceId).add(event.sourceSequence);
  }
  const vector = {};
  for (const [deviceId, sequences] of grouped) {
    let contiguous = 0;
    while (sequences.has(contiguous + 1)) contiguous += 1;
    if (contiguous) vector[deviceId] = contiguous;
  }
  return normalizeCatalogVector(vector);
}

function normalizeCatalogVector(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_VECTOR_DEVICES) throw new Error('catalog-vector-too-large');
  const normalized = {};
  for (const [deviceIdValue, sequenceValue] of entries) {
    const deviceId = requiredText(deviceIdValue, 'catalog-vector-device', 128);
    const sequence = nonNegativeInteger(sequenceValue, 'catalog-vector-sequence');
    if (sequence > 0) normalized[deviceId] = sequence;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function catalogEventHeads(eventsValue = []) {
  const events = normalizeEventList(eventsValue);
  const referenced = new Set(events.flatMap((event) => event.causalParents));
  return events.map((event) => event.eventId).filter((eventId) => !referenced.has(eventId)).sort();
}

function catalogEventsAfterVector(eventsValue = [], vectorValue = {}) {
  const vector = normalizeCatalogVector(vectorValue);
  return normalizeEventList(eventsValue).filter((event) => (
    event.sourceSequence > Number(vector[event.sourceDeviceId] || 0)
  ));
}

function nextCatalogEventClock(eventsValue = [], sourceDeviceId) {
  const events = normalizeEventList(eventsValue);
  const local = events.filter((event) => event.sourceDeviceId === sourceDeviceId);
  return {
    sourceSequence: Math.max(0, ...local.map((event) => event.sourceSequence)) + 1,
    lamport: Math.max(0, ...events.map((event) => event.lamport)) + 1,
    causalParents: catalogEventHeads(events)
  };
}

function createCatalogEventBatches(input = {}) {
  const events = normalizeEventList(input.events);
  const base = {
    schemaVersion: CATALOG_EVENT_SYNC_SCHEMA_VERSION,
    syncId: requiredText(input.syncId, 'catalog-sync-id', 128),
    meshId: requiredText(input.meshId, 'catalog-sync-mesh', 128),
    sourceDeviceId: requiredText(input.sourceDeviceId, 'catalog-sync-source', 128)
  };
  const groups = [];
  let current = [];
  for (const event of events) {
    const candidate = [...current, event];
    const probe = { ...base, batchIndex: groups.length, events: candidate };
    if (current.length && Buffer.byteLength(JSON.stringify(probe)) > MAX_CATALOG_EVENT_BATCH_BYTES) {
      groups.push(current);
      current = [event];
    } else {
      current = candidate;
    }
    const singleProbe = { ...base, batchIndex: groups.length, events: current };
    if (Buffer.byteLength(JSON.stringify(singleProbe)) > MAX_CATALOG_EVENT_BATCH_BYTES) {
      throw new Error('catalog-event-batch-too-large');
    }
  }
  if (current.length) groups.push(current);
  return groups.map((group, batchIndex) => ({ ...base, batchIndex, events: group }));
}

function normalizeCatalogEventBatch(value = {}) {
  assertOnlyKeys(
    value,
    ['schemaVersion', 'syncId', 'meshId', 'sourceDeviceId', 'batchIndex', 'events'],
    'catalog-sync-field-unknown'
  );
  const batch = {
    schemaVersion: Number(value.schemaVersion),
    syncId: requiredText(value.syncId, 'catalog-sync-id', 128),
    meshId: requiredText(value.meshId, 'catalog-sync-mesh', 128),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'catalog-sync-source', 128),
    batchIndex: nonNegativeInteger(value.batchIndex, 'catalog-sync-batch-index'),
    events: normalizeEventList(value.events)
  };
  if (batch.schemaVersion !== CATALOG_EVENT_SYNC_SCHEMA_VERSION) throw new Error('catalog-sync-version');
  if (Buffer.byteLength(JSON.stringify(batch)) > MAX_CATALOG_EVENT_BATCH_BYTES) {
    throw new Error('catalog-event-batch-too-large');
  }
  return batch;
}

function normalizeCatalogSyncMarker(value = {}) {
  assertOnlyKeys(
    value,
    ['schemaVersion', 'syncId', 'meshId', 'sourceDeviceId', 'batchCount', 'vector'],
    'catalog-sync-field-unknown'
  );
  if (Number(value.schemaVersion) !== CATALOG_EVENT_SYNC_SCHEMA_VERSION) throw new Error('catalog-sync-version');
  const batchCount = nonNegativeInteger(value.batchCount, 'catalog-sync-batch-count');
  if (batchCount > MAX_CATALOG_EVENTS) throw new Error('catalog-sync-batch-count-too-large');
  return {
    schemaVersion: CATALOG_EVENT_SYNC_SCHEMA_VERSION,
    syncId: requiredText(value.syncId, 'catalog-sync-id', 128),
    meshId: requiredText(value.meshId, 'catalog-sync-mesh', 128),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'catalog-sync-source', 128),
    batchCount,
    vector: normalizeCatalogVector(value.vector)
  };
}

function normalizeCatalogEventList(value = []) {
  return normalizeEventList(value);
}

function compareEventClock(left, right) {
  if (left.lamport !== right.lamport) return left.lamport - right.lamport;
  const source = left.sourceDeviceId.localeCompare(right.sourceDeviceId);
  if (source) return source;
  return left.eventId.localeCompare(right.eventId);
}

function diffObjectList(objectType, beforeList, afterList, operations) {
  const before = new Map(beforeList.map((item) => [objectIdFor(objectType, item), item]));
  const after = new Map(afterList.map((item) => [objectIdFor(objectType, item), item]));
  for (const [objectId, previous] of before) {
    if (!after.has(objectId)) setDeleteOperation(operations, objectType, objectId);
    else {
      const next = after.get(objectId);
      const changedFields = OBJECT_FIELDS[objectType].filter((field) => (
        (objectType === 'blueprint' || field !== 'updatedAt')
        &&
        canonicalJson(previous[field]) !== canonicalJson(next[field])
      ));
      if (changedFields.length) operations.push({
        objectType,
        objectId,
        action: 'upsert',
        changedFields,
        value: next
      });
    }
  }
  for (const [objectId, next] of after) {
    if (!before.has(objectId)) operations.push(fullUpsert(objectType, next));
  }
}

function setDeleteOperation(operations, objectType, objectId) {
  const key = `${objectType}:${objectId}`;
  const index = operations.findIndex((item) => operationKey(item) === key);
  const deletion = { objectType, objectId, action: 'delete' };
  if (index >= 0) operations[index] = deletion;
  else operations.push(deletion);
}

function fullUpsert(objectType, value) {
  const normalized = normalizeObjectValue(objectType, value);
  return {
    objectType,
    objectId: objectIdFor(objectType, normalized),
    action: 'upsert',
    changedFields: [...OBJECT_FIELDS[objectType]],
    value: normalized
  };
}

function normalizeObjectValue(objectType, value) {
  if (objectType === 'agent') return normalizeAgent(value);
  if (objectType === 'account-binding') return normalizeBinding(value);
  if (objectType === 'blueprint') return normalizeAgentBlueprint(value);
  throw new Error('catalog-event-object-type');
}

function objectIdFor(objectType, value) {
  if (objectType === 'agent') return String(value?.agentId || '');
  if (objectType === 'account-binding') return String(value?.accountBindingId || '');
  if (objectType === 'blueprint') return String(value?.agentId || '');
  return '';
}

function idSeed(objectType, objectId) {
  if (objectType === 'agent') return { agentId: objectId };
  if (objectType === 'account-binding') return { accountBindingId: objectId };
  return { agentId: objectId };
}

function operationKey(value) {
  return `${value.objectType}:${value.objectId}`;
}

function compareOperation(left, right) {
  const key = operationKey(left).localeCompare(operationKey(right));
  if (key) return key;
  return String(left.action).localeCompare(String(right.action));
}

function normalizeBlueprints(value) {
  return (Array.isArray(value) ? value : [])
    .filter(Boolean)
    .map(normalizeAgentBlueprint)
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
}

function normalizeEventList(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_CATALOG_EVENTS) throw new Error('catalog-events-too-large');
  return list.map(normalizeCatalogEvent).sort((left, right) => {
    const clock = compareEventClock(left, right);
    return clock || left.eventId.localeCompare(right.eventId);
  });
}

function catalogMaterialSignature(value = {}) {
  const catalog = normalizeCatalog(value);
  return canonicalJson({
    agents: catalog.agents,
    accountBindings: catalog.accountBindings,
    slots: catalog.slots,
    tombstones: catalog.tombstones,
    blueprints: normalizeBlueprints(value.blueprints)
  });
}

function suppressSlot(slot, deletedAt) {
  return {
    ...slot,
    agentId: null,
    accountBindingId: null,
    assignmentState: 'suppressed',
    lastUpdatedAt: deletedAt || slot.lastUpdatedAt
  };
}

function latestDeleteTime(slot, tombstones) {
  const candidates = tombstones
    .filter((item) => (
      (item.objectType === 'agent' && item.objectId === slot.agentId)
      || (item.objectType === 'account-binding' && item.objectId === slot.accountBindingId)
    ))
    .map((item) => item.deletedAt)
    .filter(Boolean)
    .sort();
  return candidates.at(-1) || slot.lastUpdatedAt;
}

function setsIntersect(left, right) {
  for (const value of left || []) if (right?.has(value)) return true;
  return false;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function uniqueTexts(value, limit, textLimit) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > limit) throw new Error('catalog-event-list-too-large');
  return [...new Set(list.map((item) => requiredText(item, 'catalog-event-list-item', textLimit)))].sort();
}

function boundedList(value, limit, field) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw new Error(`${field}-too-large`);
  return value.filter(Boolean).map((item) => ({ ...item }));
}

function assertOnlyKeys(value, allowedFields, errorCode) {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new Error(errorCode);
  }
}

function assertEventSize(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_CATALOG_EVENT_BYTES) {
    throw new Error('catalog-event-too-large');
  }
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  if (text.length > limit) throw new TypeError(`${field} is too long`);
  return text;
}

function optionalText(value, limit) {
  const text = String(value || '').trim();
  if (text.length > limit) throw new TypeError('catalog-event-text is too long');
  return text || null;
}

function normalizeIso(value, field) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} must be positive`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  CATALOG_EVENT_SCHEMA_VERSION,
  CATALOG_EVENT_SYNC_SCHEMA_VERSION,
  MAX_CATALOG_EVENT_BYTES,
  MAX_CATALOG_EVENT_BATCH_BYTES,
  MAX_CATALOG_EVENTS,
  OBJECT_FIELDS,
  createCatalogEvent,
  verifyCatalogEvent,
  normalizeCatalogEvent,
  normalizeCatalogEventList,
  catalogEventPayload,
  diffCatalogState,
  catalogCoverageOperations,
  splitCoverageOperations,
  materializeCatalogEvents,
  catalogEventVector,
  normalizeCatalogVector,
  catalogEventHeads,
  catalogEventsAfterVector,
  nextCatalogEventClock,
  createCatalogEventBatches,
  normalizeCatalogEventBatch,
  normalizeCatalogSyncMarker,
  compareEventClock
};
