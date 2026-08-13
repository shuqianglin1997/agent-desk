const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { buildLocalInventory } = require('../src/mesh/domain/inventory');

const NOW = '2026-08-10T08:00:00.000Z';

test('两端库存互换后目录按 Agent 去重，会话按强身份折叠且保留来源副本', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-inventory-service-'));
  const hostDir = path.join(directory, 'host');
  const joinDir = path.join(directory, 'join');
  fs.mkdirSync(hostDir, { recursive: true });
  fs.mkdirSync(joinDir, { recursive: true });
  const profile = (id) => ({
    id,
    appId: 'codex',
    name: 'Work Agent',
    identityFingerprint: 'same-account',
    profilePathMode: 'managed',
    sessionRootMode: 'managed'
  });
  const session = (filePath, updatedAt) => ({
    id: 'shared-thread',
    address: 'shared-thread',
    adapterConversationKey: 'shared-thread',
    appId: 'codex',
    title: 'Stable conversation',
    createdAt: NOW,
    updatedAt,
    projectPath: '/project',
    filePath,
    source: 'Codex',
    status: '可用'
  });
  let host;
  let joiner;
  try {
    host = new MeshService({
      databasePath: path.join(hostDir, 'mesh.db'),
      keyVault: new EncryptedKeyVault(path.join(hostDir, 'keys.json'), fakeProtector()),
      profilesProvider: () => [profile('host-slot')],
      sessionsProvider: () => [session('/host/thread.jsonl', '2026-08-10T08:01:00.000Z')],
      appVersion: '0.9.1', platform: 'darwin', arch: 'arm64', osVersion: 'test', hostname: 'Host', now: () => NOW
    });
    joiner = new MeshService({
      databasePath: path.join(joinDir, 'mesh.db'),
      keyVault: new EncryptedKeyVault(path.join(joinDir, 'keys.json'), fakeProtector()),
      profilesProvider: () => [profile('join-slot')],
      sessionsProvider: () => [session('/join/thread.jsonl', '2026-08-10T08:02:00.000Z')],
      appVersion: '0.9.1', platform: 'win32', arch: 'x64', osVersion: 'test', hostname: 'Joiner', now: () => NOW,
      pairingTransport: async (_invite, request) => host.claimInvite({ request })
    });
    host.initialize();
    await joiner.join({ code: host.createInvite().code });

    const hostDeviceId = host.getOverview().localDeviceId;
    const joinDeviceId = joiner.getOverview().localDeviceId;
    joiner.applyRemoteInventory({
      deviceId: hostDeviceId,
      inventory: host.createInventorySnapshot(),
      allowLegacyCatalogProjection: true
    });

    // Simulate an older/divergent endpoint catalog that uses its own IDs for
    // the same strong account. The receiver must project both sessions onto
    // its canonical Agent/Binding before persistence and unification.
    const joinSnapshot = joiner.createInventorySnapshot();
    const sourceAgent = joinSnapshot.catalog.agents[0];
    const sourceBinding = joinSnapshot.catalog.accountBindings[0];
    const sourceSlot = joinSnapshot.catalog.slots[0];
    const divergentAgentId = 'join-source-agent';
    const divergentBindingId = 'join-source-binding';
    const divergentCatalog = {
      ...joinSnapshot.catalog,
      agents: [{ ...sourceAgent, agentId: divergentAgentId }],
      accountBindings: [{
        ...sourceBinding,
        accountBindingId: divergentBindingId,
        agentId: divergentAgentId
      }],
      slots: [{
        ...sourceSlot,
        agentId: divergentAgentId,
        accountBindingId: divergentBindingId
      }]
    };
    const divergentInventory = buildLocalInventory({
      deviceId: joinDeviceId,
      revision: joinSnapshot.revision,
      catalog: divergentCatalog,
      sessionsByProfile: {
        'join-slot': [
          session('/join/thread.jsonl', '2026-08-10T08:02:00.000Z'),
          {
            ...session('/join/new-thread.jsonl', '2026-08-10T08:03:00.000Z'),
            id: 'remote-only-thread',
            address: 'remote-only-thread',
            adapterConversationKey: 'remote-only-thread',
            title: 'Remote only conversation'
          }
        ]
      },
      linkKey: joiner.keyVault.load().identityLinkKey
    }, { now: NOW });
    host.applyRemoteInventory({
      deviceId: joinDeviceId,
      inventory: divergentInventory,
      allowLegacyCatalogProjection: true
    });

    const hostOverview = host.getOverview();
    assert.equal(hostOverview.agents.length, 1);
    assert.equal(hostOverview.accountBindings.length, 1);
    assert.equal(hostOverview.slots.length, 2);
    const remoteOverview = hostOverview.devices.find((device) => device.deviceId === joinDeviceId);
    assert.equal(remoteOverview.inventoryGeneratedAt, divergentInventory.generatedAt);
    assert.equal(remoteOverview.inventoryStaleAt, divergentInventory.staleAt);
    const rows = host.getUnifiedSessions();
    assert.equal(rows.length, 2);
    const shared = rows.find((row) => row.id === 'shared-thread');
    const remoteOnly = rows.find((row) => row.id === 'remote-only-thread');
    assert.equal(shared.replicas.length, 2);
    assert.equal(shared._deviceId, hostDeviceId);
    assert.equal(shared._remote, false);
    assert.equal(remoteOnly.replicas.length, 1);
    assert.equal(remoteOnly._deviceId, joinDeviceId);
    assert.equal(
      rows.filter((row) => row._agentId === hostOverview.agents[0].agentId).length,
      2,
      'canonical current-Agent scope must retain remote-only conversations'
    );

    const store = new MeshStore(path.join(hostDir, 'mesh.db'));
    const snapshot = store.readSnapshot();
    store.close();
    assert.equal(snapshot.remoteInventories.length, 1);
    assert.equal(snapshot.remoteInventories[0].deviceId, joinDeviceId);
    assert.equal(snapshot.remoteInventories[0].revision, divergentInventory.revision);
    assert.equal(snapshot.remoteInventories[0].sessions.length, 2);
    assert.ok(snapshot.remoteInventories[0].sessions.every((replica) => (
      replica.agentId === hostOverview.agents[0].agentId
      && replica.accountBindingId === hostOverview.accountBindings[0].accountBindingId
    )));
    assert.ok(snapshot.remoteInventories[0].sessions.every((replica) => (
      replica.replicaId === divergentInventory.sessions.find((source) => (
        source.adapterConversationKey === replica.adapterConversationKey
      )).replicaId
    )));

    // Existing installations may already contain a pre-fix source-ID cache.
    // Read-time projection repairs it without waiting for the remote peer to
    // become reachable and publish another revision.
    const legacyStore = new MeshStore(path.join(hostDir, 'mesh.db'));
    legacyStore.database.prepare('UPDATE remote_inventory SET payload_json = ? WHERE device_id = ?')
      .run(JSON.stringify(divergentInventory), joinDeviceId);
    legacyStore.close();
    const repairedRows = host.getUnifiedSessions();
    assert.equal(repairedRows.length, 2);
    assert.ok(repairedRows.every((row) => row._agentId === hostOverview.agents[0].agentId));
    assert.equal(repairedRows.find((row) => row.id === 'shared-thread').replicas.length, 2);

    // Per-inventory isolation remains intact: one damaged legacy cache is
    // skipped instead of taking down healthy local conversations.
    const damagedStore = new MeshStore(path.join(hostDir, 'mesh.db'));
    damagedStore.database.prepare('UPDATE remote_inventory SET payload_json = ? WHERE device_id = ?')
      .run(JSON.stringify({ ...divergentInventory, schemaVersion: 999 }), joinDeviceId);
    damagedStore.close();
    const healthyRows = host.getUnifiedSessions();
    assert.equal(healthyRows.length, 1);
    assert.equal(healthyRows[0].id, 'shared-thread');
    assert.equal(healthyRows[0].replicas.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}
