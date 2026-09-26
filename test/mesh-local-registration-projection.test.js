const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');

for (const mode of ['deferred', 'unavailable']) {
  test(`${mode} overview omits removed local registrations across restart without changing catalog or remote facts`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-registration-projection-'));
    const databasePath = path.join(directory, 'mesh.db');
    const keyVault = new EncryptedKeyVault(path.join(directory, 'keys.json'), {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    });
    const now = () => '2026-09-26T08:00:00.000Z';
    let profiles = ['removed-linked', 'removed-suppressed', 'keep-desktop'].map((id) => ({
      id, name: id, appId: 'claude', profilePathMode: 'managed', sessionRootMode: 'managed',
      identityFingerprint: id
    }));
    const options = { databasePath, keyVault, profilesProvider: () => profiles,
      sessionCountProvider: () => 5, now };
    const read = () => {
      const store = new MeshStore(databasePath);
      try {
        return { snapshot: store.readSnapshot(), events: store.database.prepare(
          'SELECT * FROM catalog_events ORDER BY event_id').all() };
      } finally { store.close(); }
    };
    try {
      const service = new MeshService(options);
      const initialized = service.initialize();
      const localId = initialized.localDeviceId;
      const removedAgentId = initialized.slots.find((slot) => slot.profileId === 'removed-linked').agentId;
      const store = new MeshStore(databasePath);
      try {
        const snapshot = store.readSnapshot();
        store.saveDevice({ ...snapshot.devices[0], deviceId: 'remote-device', isLocal: false }, now());
        const suppressed = snapshot.slots.find((slot) => slot.profileId === 'removed-suppressed');
        suppressed.assignmentState = 'suppressed';
        suppressed.agentId = null;
        suppressed.accountBindingId = null;
        snapshot.slots.push({ ...snapshot.slots.find((slot) => slot.profileId === 'removed-linked'),
          deviceId: 'remote-device' });
        store.saveCatalog({ ...snapshot, catalogRevision: snapshot.catalogRevision + 1 }, now());
      } finally { store.close(); }
      const before = read();
      profiles = profiles.filter((profile) => profile.id === 'keep-desktop');
      let keyLoads = 0;
      keyVault.load = () => { keyLoads += 1; throw new Error('mesh-keys-unavailable'); };
      for (const instance of [service, new MeshService(options)]) {
        const overview = instance.getOverview({ deferKeyAccess: mode === 'deferred' });
        assert.equal(overview.keyState, mode === 'deferred' ? 'deferred' : 'mesh-keys-unavailable');
        assert.deepEqual(overview.slots.filter((slot) => slot.deviceId === localId)
          .map((slot) => slot.profileId), ['keep-desktop']);
        assert.deepEqual(overview.slots.filter((slot) => slot.deviceId === 'remote-device')
          .map((slot) => slot.profileId), ['removed-linked']);
        assert.ok(overview.agents.some((agent) => agent.agentId === removedAgentId));
        const local = overview.devices.find((device) => device.deviceId === localId);
        assert.equal(local.slotCount, 1);
        assert.equal(local.sessionCount, 5);
        const deployment = overview.deployments.find((item) => item.deviceId === localId && item.agentId === removedAgentId);
        assert.equal(deployment.state, 'absent');
        assert.deepEqual(deployment.slotKeys, []);
        assert.equal(deployment.preferredSlotKey, null);
        const after = read();
        for (const key of ['slots', 'agents', 'accountBindings', 'blueprints', 'tombstones']) {
          assert.deepEqual(after.snapshot[key], before.snapshot[key], `${key} persisted unchanged`);
        }
        assert.deepEqual(after.events, before.events);
        assert.equal(after.snapshot.catalogRevision, before.snapshot.catalogRevision);
      }
      assert.equal(keyLoads, mode === 'deferred' ? 0 : 2);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
