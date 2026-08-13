const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildLocalInventory,
  normalizeInventory,
  mergeCatalogInventory,
  canonicalizeInventorySessions,
  unifiedConversations
} = require('../src/mesh/domain/inventory');

const LINK_KEY = Buffer.alloc(32, 9).toString('base64');
const NOW = '2026-08-10T08:00:00.000Z';

function catalog(deviceId, ids = {}) {
  const agentId = ids.agentId || 'agent-a';
  const bindingId = ids.bindingId || 'binding-a';
  const appId = ids.appId || 'codex';
  return {
    catalogRevision: 1,
    agents: [{ agentId, displayName: 'Work Agent', lifecycleState: 'active' }],
    accountBindings: [{
      accountBindingId: bindingId,
      agentId,
      providerNamespace: ids.providerNamespace || 'codex',
      meshScopedAccountKey: ids.strongKey || 'same-account-key'
    }],
    slots: [{
      deviceId,
      profileId: `${deviceId}-slot`,
      agentId,
      accountBindingId: bindingId,
      appId,
      assignmentState: 'linked'
    }],
    tombstones: ids.tombstones || []
  };
}

function session(id, extra = {}) {
  return {
    id,
    address: id,
    adapterConversationKey: extra.weak ? null : id,
    appId: 'codex',
    title: extra.title || 'One conversation',
    createdAt: NOW,
    updatedAt: extra.updatedAt || NOW,
    projectPath: extra.projectPath || '/work/project  with  spaces',
    filePath: `/sessions/${id}.jsonl`,
    source: 'Codex',
    status: '可用'
  };
}

test('强会话标识跨设备折叠为一条 ConversationIdentity，但保留两个确切副本', () => {
  const left = buildLocalInventory({
    deviceId: 'device-a',
    revision: 1,
    catalog: catalog('device-a'),
    sessionsByProfile: { 'device-a-slot': [session('thread-1')] },
    linkKey: LINK_KEY
  }, { now: NOW });
  const right = buildLocalInventory({
    deviceId: 'device-b',
    revision: 1,
    catalog: catalog('device-b'),
    sessionsByProfile: { 'device-b-slot': [session('thread-1', { updatedAt: '2026-08-10T08:01:00.000Z' })] },
    linkKey: LINK_KEY
  }, { now: NOW });

  const rows = unifiedConversations([left, right], [
    { deviceId: 'device-a', name: 'MacBook', status: 'online' },
    { deviceId: 'device-b', name: 'Studio', status: 'online' }
  ], { localDeviceId: 'device-a' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].replicas.length, 2);
  assert.equal(rows[0]._deviceId, 'device-a', '本机副本优先成为当前动作位置');
  assert.equal(rows[0].projectPath, '/work/project  with  spaces');
  assert.deepEqual(new Set(rows[0].replicas.map((item) => item.replicaId)).size, 2);
});

test('同一 AccountBinding 的 Desktop/CLI 使用 providerNamespace 折叠强会话', () => {
  const left = buildLocalInventory({
    deviceId: 'device-a', revision: 1,
    catalog: catalog('device-a', { appId: 'claude', providerNamespace: 'claude' }),
    sessionsByProfile: { 'device-a-slot': [{ ...session('thread-forms'), appId: 'claude' }] },
    linkKey: LINK_KEY
  }, { now: NOW });
  const right = buildLocalInventory({
    deviceId: 'device-b', revision: 1,
    catalog: catalog('device-b', { appId: 'claude-cli', providerNamespace: 'claude' }),
    sessionsByProfile: { 'device-b-slot': [{ ...session('thread-forms'), appId: 'claude-cli' }] },
    linkKey: LINK_KEY
  }, { now: NOW });

  assert.equal(left.sessions[0].conversationId, right.sessions[0].conversationId);
  const rows = unifiedConversations([left, right], [], { localDeviceId: 'device-a' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].replicas.length, 2);
});

test('只有弱地址的同名同 ID 会话保持设备作用域，不按标题与时间误合并', () => {
  const left = buildLocalInventory({
    deviceId: 'device-a', revision: 1, catalog: catalog('device-a'), linkKey: LINK_KEY,
    sessionsByProfile: { 'device-a-slot': [session('local-id', { weak: true, title: 'Same title' })] }
  }, { now: NOW });
  const right = buildLocalInventory({
    deviceId: 'device-b', revision: 1, catalog: catalog('device-b'), linkKey: LINK_KEY,
    sessionsByProfile: { 'device-b-slot': [session('local-id', { weak: true, title: 'Same title' })] }
  }, { now: NOW });
  assert.equal(unifiedConversations([left, right], [], { localDeviceId: 'device-a' }).length, 2);
});

test('远端库存按强账号键归入现有 Agent，并只替换来源设备自己的 Slot', () => {
  const existing = catalog('device-a');
  const remoteInventory = buildLocalInventory({
    deviceId: 'device-b',
    revision: 3,
    catalog: catalog('device-b', { agentId: 'agent-duplicate', bindingId: 'binding-duplicate' }),
    sessionsByProfile: {},
    linkKey: LINK_KEY
  }, { now: NOW });
  const merged = mergeCatalogInventory(existing, remoteInventory);
  assert.equal(merged.agents.length, 1);
  assert.equal(merged.accountBindings.length, 1);
  assert.equal(merged.slots.length, 2);
  const remoteSlot = merged.slots.find((slot) => slot.deviceId === 'device-b');
  assert.equal(remoteSlot.agentId, 'agent-a');
  assert.equal(remoteSlot.accountBindingId, 'binding-a');

  const nextRemote = { ...remoteInventory, revision: 4, catalog: { ...remoteInventory.catalog, slots: [] } };
  const removedRemoteSlot = mergeCatalogInventory(merged, nextRemote);
  assert.deepEqual(removedRemoteSlot.slots.map((slot) => slot.deviceId), ['device-a']);
});

test('远端 canonical Slot 重写会话归属，弱会话保持设备作用域且 replicaId 稳定', () => {
  const existing = catalog('device-a');
  const remoteInventory = buildLocalInventory({
    deviceId: 'device-b',
    revision: 3,
    catalog: catalog('device-b', { agentId: 'agent-duplicate', bindingId: 'binding-duplicate' }),
    sessionsByProfile: {
      'device-b-slot': [session('weak-thread', { weak: true })]
    },
    linkKey: LINK_KEY
  }, { now: NOW });
  const original = remoteInventory.sessions[0];
  const merged = mergeCatalogInventory(existing, remoteInventory);
  const canonical = canonicalizeInventorySessions(remoteInventory, merged, { linkKey: LINK_KEY });
  const replica = canonical.sessions[0];

  assert.equal(replica.agentId, 'agent-a');
  assert.equal(replica.accountBindingId, 'binding-a');
  assert.equal(replica.conversationId, original.conversationId);
  assert.equal(replica.replicaId, original.replicaId);
  assert.equal(canonical.revision, remoteInventory.revision);
  assert.equal(canonical.generatedAt, remoteInventory.generatedAt);

  const rows = unifiedConversations([canonical], [
    { deviceId: 'device-b', name: 'Studio', status: 'online' }
  ], { localDeviceId: 'device-a' });
  assert.equal(rows.filter((row) => row._agentId === 'agent-a').length, 1);
});

test('目录 tombstone 优先于离线旧库存，且库存不能夹带其他设备 Slot', () => {
  const existing = catalog('device-a', {
    tombstones: [{ objectType: 'agent', objectId: 'deleted-agent', deletedAt: NOW }]
  });
  const stale = buildLocalInventory({
    deviceId: 'device-b',
    revision: 1,
    catalog: catalog('device-b', { agentId: 'deleted-agent', bindingId: 'deleted-binding' }),
    sessionsByProfile: {},
    linkKey: LINK_KEY
  }, { now: NOW });
  const merged = mergeCatalogInventory(existing, stale);
  assert.equal(merged.agents.some((agent) => agent.agentId === 'deleted-agent'), false);
  assert.equal(merged.slots.some((slot) => slot.deviceId === 'device-b'), false);
  const canonical = canonicalizeInventorySessions(stale, merged, { linkKey: LINK_KEY });
  assert.equal(canonical.sessions.length, 0, 'tombstoned catalog objects cannot survive through cached sessions');

  assert.throws(() => normalizeInventory({
    ...stale,
    catalog: {
      ...stale.catalog,
      slots: [...stale.catalog.slots, { ...stale.catalog.slots[0], deviceId: 'device-c' }]
    }
  }), /inventory-foreign-slot/);
});
