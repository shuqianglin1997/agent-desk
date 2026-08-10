const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { MeshService } = require('../src/mesh/main/mesh-service');

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
    joiner.applyRemoteInventory({ deviceId: hostDeviceId, inventory: host.createInventorySnapshot() });
    host.applyRemoteInventory({ deviceId: joinDeviceId, inventory: joiner.createInventorySnapshot() });

    const hostOverview = host.getOverview();
    assert.equal(hostOverview.agents.length, 1);
    assert.equal(hostOverview.accountBindings.length, 1);
    assert.equal(hostOverview.slots.length, 2);
    const rows = host.getUnifiedSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].replicas.length, 2);
    assert.equal(rows[0]._deviceId, hostDeviceId);
    assert.equal(rows[0]._remote, false);

    const store = new MeshStore(path.join(hostDir, 'mesh.db'));
    const snapshot = store.readSnapshot();
    store.close();
    assert.equal(snapshot.remoteInventories.length, 1);
    assert.equal(snapshot.remoteInventories[0].deviceId, joinDeviceId);
    assert.equal(snapshot.remoteInventories[0].sessions.length, 1);
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
