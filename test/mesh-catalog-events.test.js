const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { createIdentityBundle } = require('../src/mesh/storage/secure-keys');
const { createMembershipCertificate } = require('../src/mesh/protocol/handshake');
const {
  MAX_CATALOG_EVENT_BATCH_BYTES,
  createCatalogEvent,
  verifyCatalogEvent,
  diffCatalogState,
  catalogCoverageOperations,
  materializeCatalogEvents,
  catalogEventVector,
  catalogEventsAfterVector,
  nextCatalogEventClock,
  createCatalogEventBatches,
  normalizeCatalogEventBatch
} = require('../src/mesh/protocol/catalog-events');

const NOW = '2026-08-13T15:00:00.000Z';
const SAFE_DATA_CHANNEL_ENVELOPE_BYTES = 192 * 1024;

function meshIdentity() {
  const root = createIdentityBundle();
  const deviceB = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const certificateA = createMembershipCertificate({
    meshId: 'mesh-events',
    deviceId: 'device-a',
    devicePublicKey: root.devicePublicKey,
    roles: ['controller', 'catalog.manage']
  }, root.rootPrivateKey, { now: NOW, randomUUID: () => 'certificate-a' });
  const certificateB = createMembershipCertificate({
    meshId: 'mesh-events',
    deviceId: 'device-b',
    devicePublicKey: deviceB.publicKey,
    roles: ['controller', 'catalog.manage']
  }, root.rootPrivateKey, { now: NOW, randomUUID: () => 'certificate-b' });
  return {
    rootPublicKey: root.rootPublicKey,
    a: {
      devicePrivateKey: root.devicePrivateKey,
      membershipCertificate: certificateA,
      membershipChain: []
    },
    b: {
      devicePrivateKey: deviceB.privateKey,
      membershipCertificate: certificateB,
      membershipChain: []
    }
  };
}

function baseCatalog() {
  return {
    catalogRevision: 1,
    agents: [{
      agentId: 'agent-a',
      displayName: 'Agent A',
      catAppearance: null,
      group: 'Original',
      note: '',
      lifecycleState: 'active',
      createdAt: NOW,
      updatedAt: NOW
    }],
    accountBindings: [{
      accountBindingId: 'binding-a',
      agentId: 'agent-a',
      providerNamespace: 'codex',
      displayAlias: 'Agent A',
      meshScopedAccountKey: null,
      linkMethod: 'manual',
      verificationState: 'confirmed',
      createdAt: NOW,
      updatedAt: NOW,
      lastVerifiedAt: null
    }],
    slots: [{
      deviceId: 'device-a',
      profileId: 'profile-a',
      agentId: 'agent-a',
      accountBindingId: 'binding-a',
      assignmentState: 'linked',
      lastUpdatedAt: NOW
    }],
    blueprints: [],
    tombstones: []
  };
}

function signedEvent(input, signer) {
  return createCatalogEvent({
    meshId: 'mesh-events',
    baseRevision: 1,
    eventType: 'catalog.test',
    transactionKind: 'ordinary',
    createdAt: NOW,
    ...input
  }, signer, { now: NOW, randomUUID: () => input.eventId });
}

test('签名目录事件可验证，向量只确认每台来源设备的连续序列', () => {
  const identity = meshIdentity();
  const bootstrap = signedEvent({
    eventId: 'event-a-1',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(baseCatalog(), [])
  }, identity.a);
  const verified = verifyCatalogEvent(bootstrap, identity.rootPublicKey, { now: NOW });
  assert.equal(verified.ok, true);

  const gap = signedEvent({
    eventId: 'event-a-3',
    sourceDeviceId: 'device-a',
    sourceSequence: 3,
    lamport: 3,
    causalParents: ['event-a-1'],
    operations: [{
      objectType: 'agent',
      objectId: 'agent-a',
      action: 'upsert',
      changedFields: ['note'],
      value: { ...baseCatalog().agents[0], note: 'gap' }
    }]
  }, identity.a);
  assert.deepEqual(catalogEventVector([bootstrap, gap]), { 'device-a': 1 });
  assert.deepEqual(catalogEventsAfterVector([bootstrap, gap], { 'device-a': 1 }).map((event) => event.eventId), [
    'event-a-3'
  ]);
  assert.deepEqual(nextCatalogEventClock([bootstrap, gap], 'device-a'), {
    sourceSequence: 4,
    lamport: 4,
    causalParents: ['event-a-3']
  });
});

test('双端并发修改不同字段自动合并，同字段冲突稳定收敛并保留审计事实', () => {
  const identity = meshIdentity();
  const base = baseCatalog();
  const bootstrap = signedEvent({
    eventId: 'bootstrap-a',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(base, [])
  }, identity.a);
  const rename = signedEvent({
    eventId: 'rename-a',
    sourceDeviceId: 'device-a',
    sourceSequence: 2,
    lamport: 2,
    causalParents: ['bootstrap-a'],
    operations: diffCatalogState(base, {
      ...base,
      agents: [{ ...base.agents[0], displayName: 'Renamed A' }]
    })
  }, identity.a);
  const regroup = signedEvent({
    eventId: 'group-b',
    sourceDeviceId: 'device-b',
    sourceSequence: 1,
    lamport: 2,
    causalParents: ['bootstrap-a'],
    operations: diffCatalogState(base, {
      ...base,
      agents: [{ ...base.agents[0], group: 'Remote group' }]
    })
  }, identity.b);
  const merged = materializeCatalogEvents(base, [bootstrap, rename, regroup], {
    catalogRevision: 2,
    now: NOW
  });
  assert.equal(merged.catalog.agents[0].displayName, 'Renamed A');
  assert.equal(merged.catalog.agents[0].group, 'Remote group');
  assert.equal(merged.conflicts.length, 0);

  const concurrentRename = signedEvent({
    eventId: 'rename-b',
    sourceDeviceId: 'device-b',
    sourceSequence: 2,
    lamport: 2,
    causalParents: ['bootstrap-a'],
    operations: diffCatalogState(base, {
      ...base,
      agents: [{ ...base.agents[0], displayName: 'Renamed B' }]
    })
  }, identity.b);
  const conflict = materializeCatalogEvents(base, [bootstrap, rename, regroup, concurrentRename], {
    catalogRevision: 3,
    now: NOW
  });
  assert.equal(conflict.catalog.agents[0].displayName, 'Renamed B');
  assert.equal(conflict.catalog.agents[0].group, 'Remote group');
  assert.equal(conflict.conflicts.some((item) => (
    item.type === 'field-concurrent'
    && item.objectId === 'agent-a'
    && item.field === 'displayName'
  )), true);
});

test('Agent 删除事件永久压过旧端和并发端的活动对象，Slot 只转为 suppressed', () => {
  const identity = meshIdentity();
  const base = baseCatalog();
  const bootstrap = signedEvent({
    eventId: 'bootstrap-delete',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(base, [])
  }, identity.a);
  const staleEdit = signedEvent({
    eventId: 'stale-remote-edit',
    sourceDeviceId: 'device-b',
    sourceSequence: 1,
    lamport: 2,
    causalParents: ['bootstrap-delete'],
    operations: diffCatalogState(base, {
      ...base,
      agents: [{ ...base.agents[0], displayName: 'Stale remote name' }]
    })
  }, identity.b);
  const deletion = signedEvent({
    eventId: 'delete-a',
    sourceDeviceId: 'device-a',
    sourceSequence: 2,
    lamport: 3,
    causalParents: ['stale-remote-edit'],
    transactionKind: 'structural',
    operations: [
      { objectType: 'account-binding', objectId: 'binding-a', action: 'delete' },
      { objectType: 'agent', objectId: 'agent-a', action: 'delete' }
    ]
  }, identity.a);
  const materialized = materializeCatalogEvents(base, [bootstrap, staleEdit, deletion], {
    catalogRevision: 4,
    now: NOW
  });
  assert.deepEqual(materialized.catalog.agents, []);
  assert.deepEqual(materialized.catalog.accountBindings, []);
  assert.equal(materialized.catalog.tombstones.some((item) => (
    item.objectType === 'agent' && item.objectId === 'agent-a'
  )), true);
  assert.equal(materialized.catalog.slots[0].assignmentState, 'suppressed');
  assert.equal(materialized.catalog.slots[0].agentId, null);
});

test('并发的拆分事务即使逻辑时钟更高也不能越过同一对象的删除事务', () => {
  const identity = meshIdentity();
  const base = baseCatalog();
  const bootstrap = signedEvent({
    eventId: 'bootstrap-structural',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(base, [])
  }, identity.a);
  const deletion = signedEvent({
    eventId: 'delete-structural',
    sourceDeviceId: 'device-a',
    sourceSequence: 2,
    lamport: 2,
    causalParents: ['bootstrap-structural'],
    transactionKind: 'structural',
    operations: [
      { objectType: 'account-binding', objectId: 'binding-a', action: 'delete' },
      { objectType: 'agent', objectId: 'agent-a', action: 'delete' }
    ]
  }, identity.a);
  const split = signedEvent({
    eventId: 'split-structural',
    sourceDeviceId: 'device-b',
    sourceSequence: 1,
    lamport: 9,
    causalParents: ['bootstrap-structural'],
    transactionKind: 'structural',
    operations: [
      {
        objectType: 'agent',
        objectId: 'agent-new',
        action: 'upsert',
        changedFields: ['agentId', 'displayName', 'catAppearance', 'group', 'note', 'lifecycleState', 'createdAt', 'updatedAt'],
        value: { ...base.agents[0], agentId: 'agent-new', displayName: 'Split agent' }
      },
      {
        objectType: 'account-binding',
        objectId: 'binding-a',
        action: 'upsert',
        changedFields: ['agentId'],
        value: { ...base.accountBindings[0], agentId: 'agent-new' }
      }
    ]
  }, identity.b);
  const result = materializeCatalogEvents(base, [bootstrap, deletion, split], {
    catalogRevision: 2,
    now: NOW
  });
  assert.deepEqual(result.catalog.agents, []);
  assert.deepEqual(result.catalog.accountBindings, []);
  assert.equal(result.rejectedEventIds.includes('split-structural'), true);
});

test('目录事件按有界批次传输并保持每个事件的原始设备签名', () => {
  const identity = meshIdentity();
  const event = signedEvent({
    eventId: 'batch-event',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(baseCatalog(), [])
  }, identity.a);
  const batches = createCatalogEventBatches({
    syncId: 'sync-a',
    meshId: 'mesh-events',
    sourceDeviceId: 'device-b',
    events: [event]
  });
  assert.ok(MAX_CATALOG_EVENT_BATCH_BYTES < SAFE_DATA_CHANNEL_ENVELOPE_BYTES);
  assert.equal(batches.length, 1);
  const normalized = normalizeCatalogEventBatch(batches[0]);
  assert.equal(normalized.sourceDeviceId, 'device-b');
  assert.equal(normalized.events[0].sourceDeviceId, 'device-a');
  assert.equal(verifyCatalogEvent(normalized.events[0], identity.rootPublicKey, { now: NOW }).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(normalized)) <= MAX_CATALOG_EVENT_BATCH_BYTES);
});

test('目录事件严格拒绝顶层、操作、对象与 changedFields 中的未知字段', () => {
  const identity = meshIdentity();
  assert.throws(() => signedEvent({
    eventId: 'unknown-field',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    operations: [{
      objectType: 'agent',
      objectId: 'agent-a',
      action: 'upsert',
      changedFields: ['displayName', 'futureField'],
      value: baseCatalog().agents[0]
    }]
  }, identity.a), /catalog-event-field-unknown/);

  const valid = signedEvent({
    eventId: 'valid-for-strictness',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    operations: catalogCoverageOperations(baseCatalog(), [])
  }, identity.a);
  assert.equal(verifyCatalogEvent({ ...valid, futureEnvelopeField: true }, identity.rootPublicKey, {
    now: NOW
  }).reason, 'catalog-event-invalid');
  assert.throws(() => signedEvent({
    eventId: 'unknown-operation-field',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    operations: [{
      objectType: 'agent',
      objectId: 'agent-a',
      action: 'upsert',
      changedFields: ['displayName'],
      value: baseCatalog().agents[0],
      futureOperationField: true
    }]
  }, identity.a), /catalog-event-operation-field-unknown/);
  assert.throws(() => signedEvent({
    eventId: 'unknown-object-field',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    operations: [{
      objectType: 'agent',
      objectId: 'agent-a',
      action: 'upsert',
      changedFields: ['displayName'],
      value: { ...baseCatalog().agents[0], futureObjectField: true }
    }]
  }, identity.a), /catalog-event-object-field-unknown/);
});

test('目录覆盖会记录已存在 Blueprint 的后续变化，而不是只看对象是否出现过', () => {
  const identity = meshIdentity();
  const original = {
    ...baseCatalog(),
    blueprints: [{
      schemaVersion: 1,
      blueprintId: 'blueprint:agent-a',
      agentId: 'agent-a',
      revision: 1,
      preferredProvider: 'codex',
      preferredAppId: 'codex',
      preferredClientForm: 'desktop',
      desiredBindingIds: ['binding-a'],
      portableSettings: {},
      skillRequirements: [],
      toolRequirements: [],
      projectRequirements: [],
      createdAt: NOW,
      updatedAt: NOW,
      updatedByDeviceId: 'device-a'
    }]
  };
  const bootstrap = signedEvent({
    eventId: 'blueprint-bootstrap',
    sourceDeviceId: 'device-a',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    transactionKind: 'bootstrap',
    operations: catalogCoverageOperations(original, [])
  }, identity.a);
  const changed = {
    ...original,
    blueprints: [{
      ...original.blueprints[0],
      revision: 2,
      desiredBindingIds: ['binding-a', 'binding-b'],
      updatedAt: '2026-08-13T15:01:00.000Z'
    }]
  };
  const coverage = catalogCoverageOperations(changed, [bootstrap]);
  const blueprintUpdate = coverage.find((item) => item.objectType === 'blueprint');
  assert.ok(blueprintUpdate);
  assert.deepEqual(blueprintUpdate.changedFields, ['revision', 'desiredBindingIds', 'updatedAt']);
});
