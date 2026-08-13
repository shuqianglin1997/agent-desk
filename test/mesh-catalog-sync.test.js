const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MeshService } = require('../src/mesh/main/mesh-service');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const {
  createCatalogSnapshot,
  mergeCatalogSnapshot
} = require('../src/mesh/protocol/catalog');

const NOW = '2026-08-13T09:00:00.000Z';

test('独立目录快照传播零 Slot 员工与 Blueprint，不混入设备库存事实', () => {
  const snapshot = createCatalogSnapshot({
    catalogRevision: 4,
    agents: [{
      agentId: 'agent-global',
      displayName: 'Research Agent',
      lifecycleState: 'active',
      createdAt: NOW,
      updatedAt: NOW
    }],
    accountBindings: [],
    slots: [{ deviceId: 'device-a', profileId: 'must-not-leak' }],
    blueprints: [{
      schemaVersion: 1,
      blueprintId: 'blueprint:agent-global',
      agentId: 'agent-global',
      revision: 2,
      preferredProvider: 'codex',
      preferredAppId: 'codex',
      preferredClientForm: 'desktop',
      desiredBindingIds: [],
      portableSettings: {},
      skillRequirements: [],
      toolRequirements: [],
      projectRequirements: [],
      createdAt: NOW,
      updatedAt: NOW,
      updatedByDeviceId: 'device-a'
    }],
    tombstones: []
  }, {
    meshId: 'mesh-a',
    sourceDeviceId: 'device-a',
    now: NOW
  });

  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'slots'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'deployments'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'provisioningJobs'), false);
  const merged = mergeCatalogSnapshot({
    catalogRevision: 2,
    agents: [],
    accountBindings: [],
    slots: [{
      deviceId: 'device-b',
      profileId: 'local-slot',
      agentId: null,
      accountBindingId: null,
      assignmentState: 'pending'
    }],
    blueprints: [],
    tombstones: []
  }, snapshot);
  assert.equal(merged.changed, true);
  assert.equal(merged.catalog.agents[0].agentId, 'agent-global');
  assert.equal(merged.catalog.slots.length, 1);
  assert.equal(merged.catalog.slots[0].profileId, 'local-slot');
  assert.equal(merged.blueprints[0].preferredAppId, 'codex');
});

test('远端 tombstone 删除目录关系但只抑制本地 Slot，不删除工作目录事实', () => {
  const existing = {
    catalogRevision: 5,
    agents: [{ agentId: 'agent-a', displayName: 'A', createdAt: NOW, updatedAt: NOW }],
    accountBindings: [{
      accountBindingId: 'binding-a',
      agentId: 'agent-a',
      providerNamespace: 'codex',
      displayAlias: 'A',
      createdAt: NOW,
      updatedAt: NOW
    }],
    slots: [{
      deviceId: 'device-b',
      profileId: 'slot-b',
      agentId: 'agent-a',
      accountBindingId: 'binding-a',
      assignmentState: 'linked',
      lastUpdatedAt: NOW
    }],
    blueprints: [],
    tombstones: []
  };
  const deletion = createCatalogSnapshot({
    catalogRevision: 6,
    agents: [],
    accountBindings: [],
    slots: [],
    blueprints: [],
    tombstones: [
      { objectType: 'agent', objectId: 'agent-a', deletedAt: '2026-08-13T09:01:00.000Z' },
      { objectType: 'account-binding', objectId: 'binding-a', deletedAt: '2026-08-13T09:01:00.000Z' }
    ]
  }, {
    meshId: 'mesh-a',
    sourceDeviceId: 'device-a',
    now: '2026-08-13T09:01:00.000Z'
  });
  const merged = mergeCatalogSnapshot(existing, deletion);
  assert.equal(merged.catalog.agents.length, 0);
  assert.equal(merged.catalog.accountBindings.length, 0);
  assert.deepEqual(merged.catalog.slots[0], {
    ...existing.slots[0],
    agentId: null,
    accountBindingId: null,
    assignmentState: 'suppressed',
    lastUpdatedAt: '2026-08-13T09:01:00.000Z'
  });
});

test('并发识别出同一强账号时确定性收敛 Binding 并重定向本机 Slot', () => {
  const existing = {
    catalogRevision: 2,
    agents: [
      { agentId: 'agent-a', displayName: 'A', createdAt: NOW, updatedAt: NOW },
      { agentId: 'agent-b', displayName: 'B', createdAt: NOW, updatedAt: NOW }
    ],
    accountBindings: [{
      accountBindingId: 'binding-a',
      agentId: 'agent-a',
      providerNamespace: 'codex',
      displayAlias: 'A',
      meshScopedAccountKey: 'same-account',
      createdAt: NOW,
      updatedAt: NOW
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
  const incoming = createCatalogSnapshot({
    catalogRevision: 2,
    agents: existing.agents,
    accountBindings: [{
      accountBindingId: 'binding-b',
      agentId: 'agent-b',
      providerNamespace: 'codex',
      displayAlias: 'B',
      meshScopedAccountKey: 'same-account',
      createdAt: NOW,
      updatedAt: '2026-08-13T09:01:00.000Z'
    }],
    blueprints: [],
    tombstones: []
  }, {
    meshId: 'mesh-a',
    sourceDeviceId: 'device-b',
    now: '2026-08-13T09:01:00.000Z'
  });

  const merged = mergeCatalogSnapshot(existing, incoming);
  assert.equal(merged.catalog.accountBindings.length, 1);
  assert.equal(merged.catalog.accountBindings[0].accountBindingId, 'binding-b');
  assert.equal(merged.catalog.agents.length, 2);
  assert.deepEqual(merged.catalog.slots[0], {
    ...existing.slots[0],
    agentId: 'agent-b',
    accountBindingId: 'binding-b',
    lastUpdatedAt: '2026-08-13T09:01:00.000Z'
  });
});

test('MeshService 在已配对设备间落库零 Slot 员工，删除后旧目录不会复活', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-catalog-sync-'));
  const hostDir = path.join(directory, 'host');
  const joinDir = path.join(directory, 'join');
  fs.mkdirSync(hostDir, { recursive: true });
  fs.mkdirSync(joinDir, { recursive: true });
  let host;
  let joiner;
  try {
    host = serviceFor(hostDir, 'Host');
    joiner = serviceFor(joinDir, 'Joiner', async (_invite, request) => host.claimInvite({ request }));
    host.initialize();
    await joiner.join({ code: host.createInvite().code });
    const joinDeviceId = joiner.getOverview().localDeviceId;

    const created = host.createAgent({ displayName: 'Research Agent', group: 'Work' });
    const agent = created.agents.find((item) => item.displayName === 'Research Agent');
    assert.ok(agent);
    assert.equal(created.slots.some((slot) => slot.agentId === agent.agentId), false);

    const applied = joiner.applyRemoteCatalog({
      deviceId: host.getOverview().localDeviceId,
      snapshot: host.createCatalogSnapshot()
    });
    assert.equal(applied.changed, true);
    const joined = applied.overview;
    assert.equal(joined.agents.some((item) => item.agentId === agent.agentId), true);
    assert.equal(joined.blueprints.some((item) => item.agentId === agent.agentId), true);
    assert.equal(joined.slots.some((slot) => slot.agentId === agent.agentId), false);
    assert.equal(joined.deployments.find((item) => (
      item.agentId === agent.agentId && item.deviceId === joinDeviceId
    )).state, 'absent');

    joiner.applyRemoteInventory({
      deviceId: host.getOverview().localDeviceId,
      inventory: host.createInventorySnapshot({ includeLegacyCatalogProjection: false }),
      allowLegacyCatalogProjection: false
    });
    const afterInventory = serviceFor(joinDir, 'Joiner').getOverview();
    assert.equal(
      afterInventory.agents.some((item) => item.agentId === agent.agentId),
      true,
      'a source-device inventory cannot prune a catalog-only employee'
    );
    assert.equal(afterInventory.slots.some((slot) => slot.agentId === agent.agentId), false);

    host.removeCatalogObject({
      scope: 'agent',
      agentId: agent.agentId,
      baseRevision: host.getOverview().mesh.catalogRevision
    });
    joiner.applyRemoteCatalog({
      deviceId: host.getOverview().localDeviceId,
      snapshot: host.createCatalogSnapshot()
    });
    assert.equal(joiner.getOverview().agents.some((item) => item.agentId === agent.agentId), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function serviceFor(directory, hostname, pairingTransport = null) {
  return new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'keys.json'), fakeProtector()),
    profilesProvider: () => [],
    sessionsProvider: () => [],
    sessionCountProvider: () => 0,
    pairingTransport,
    appVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test',
    hostname,
    now: () => NOW
  });
}

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}
