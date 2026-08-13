const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { MeshService } = require('../src/mesh/main/mesh-service');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MESH_SCHEMA_VERSION } = require('../src/mesh/storage/migrations');

const NOW = '2026-08-13T08:00:00.000Z';

function profile(id, identityFingerprint) {
  return {
    id,
    appId: id.endsWith('-cli') ? 'claude-cli' : 'claude',
    name: id,
    identityFingerprint,
    profilePathMode: 'managed',
    sessionRootMode: 'managed'
  };
}

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => {
      const encoded = buffer.toString().replace(/^protected:/, '');
      return Buffer.from(encoded, 'base64').toString();
    }
  };
}

function createHarness(profiles) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-catalog-persistence-'));
  const databasePath = path.join(directory, 'mesh.db');
  const keyPath = path.join(directory, 'mesh-keys.json');
  const makeService = () => new MeshService({
    databasePath,
    keyVault: new EncryptedKeyVault(keyPath, fakeProtector()),
    profilesProvider: () => profiles,
    sessionCountProvider: () => 0,
    appVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os',
    hostname: 'Catalog-Test.local',
    now: () => NOW
  });
  return { directory, databasePath, keyPath, makeService };
}

test('schema v3 安全迁移保留 Slot 数据、可空关系与外键约束', () => {
  const profiles = [profile('slot-a', 'account-a')];
  const harness = createHarness(profiles);

  try {
    const initialized = harness.makeService().initialize();
    const before = new MeshStore(harness.databasePath);
    const expectedRows = before.database.prepare(`
      SELECT device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      FROM agent_slots ORDER BY device_id, profile_id
    `).all();
    before.close();

    // Recreate the exact pre-v4 Slot constraint while leaving the rest of the
    // initialized v3 schema/data intact, then let MeshStore run the real upgrade.
    const legacy = new DatabaseSync(harness.databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE agent_slots_v3 (
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
        account_binding_id TEXT NOT NULL REFERENCES account_bindings(account_binding_id) ON DELETE CASCADE,
        assignment_state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (device_id, profile_id)
      );
      INSERT INTO agent_slots_v3 (
        device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      )
      SELECT device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      FROM agent_slots;
      DROP TABLE agent_slots;
      ALTER TABLE agent_slots_v3 RENAME TO agent_slots;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    legacy.close();

    const migrated = new MeshStore(harness.databasePath);
    assert.equal(
      Number(migrated.database.prepare('PRAGMA user_version').get().user_version),
      MESH_SCHEMA_VERSION
    );
    const columns = migrated.database.prepare('PRAGMA table_info(agent_slots)').all();
    assert.equal(columns.find((column) => column.name === 'agent_id').notnull, 0);
    assert.equal(columns.find((column) => column.name === 'account_binding_id').notnull, 0);
    assert.deepEqual(migrated.database.prepare(`
      SELECT device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      FROM agent_slots ORDER BY device_id, profile_id
    `).all(), expectedRows);
    assert.deepEqual(migrated.database.prepare('PRAGMA foreign_key_check').all(), []);

    const foreignKeys = migrated.database.prepare('PRAGMA foreign_key_list(agent_slots)').all();
    assert.equal(foreignKeys.find((item) => item.from === 'device_id').on_delete, 'CASCADE');
    assert.equal(foreignKeys.find((item) => item.from === 'agent_id').on_delete, 'CASCADE');
    assert.equal(foreignKeys.find((item) => item.from === 'account_binding_id').on_delete, 'CASCADE');
    assert.throws(() => migrated.database.prepare(`
      INSERT INTO agent_slots (
        device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      ) VALUES (?, 'invalid-fk', 'missing-agent', NULL, 'suppressed', '{}')
    `).run(initialized.localDeviceId), /FOREIGN KEY/);

    const beforeFailedSave = migrated.readSnapshot();
    const invalidCatalog = {
      ...beforeFailedSave,
      catalogRevision: beforeFailedSave.catalogRevision + 1,
      slots: beforeFailedSave.slots.map((slot) => ({ ...slot, agentId: 'missing-agent' }))
    };
    assert.throws(() => migrated.saveCatalog(invalidCatalog, NOW), /FOREIGN KEY/);
    const afterFailedSave = migrated.readSnapshot();
    assert.equal(afterFailedSave.catalogRevision, beforeFailedSave.catalogRevision);
    assert.deepEqual(afterFailedSave.agents, beforeFailedSave.agents);
    assert.deepEqual(afterFailedSave.accountBindings, beforeFailedSave.accountBindings);
    assert.deepEqual(afterFailedSave.slots, beforeFailedSave.slots);
    migrated.close();
  } finally {
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('MeshService 三种删除持久化、关闭重开后仍可删到零', () => {
  const profiles = [
    profile('work-desktop', 'account-work'),
    profile('work-cli', 'account-work'),
    profile('binding-only', 'account-binding'),
    profile('agent-only', 'account-agent'),
    profile('last-agent', 'account-last')
  ];
  const harness = createHarness(profiles);

  try {
    let service = harness.makeService();
    const initial = service.initialize();
    assert.equal(initial.agents.length, 4);
    assert.equal(initial.accountBindings.length, 4);
    assert.equal(initial.slots.length, 5);

    const slotRemoved = service.removeCatalogObject({
      scope: 'slot',
      deviceId: initial.localDeviceId,
      profileId: 'work-desktop',
      baseRevision: initial.mesh.catalogRevision
    });
    const suppressedSlot = slotRemoved.slots.find((slot) => slot.profileId === 'work-desktop');
    assert.equal(suppressedSlot.assignmentState, 'suppressed');
    assert.equal(suppressedSlot.agentId, null);
    assert.equal(suppressedSlot.accountBindingId, null);
    assert.equal(slotRemoved.slots.find((slot) => slot.profileId === 'work-cli').assignmentState, 'linked');

    service = harness.makeService();
    let reopened = service.getOverview();
    assert.deepEqual(
      reopened.slots.find((slot) => slot.profileId === 'work-desktop'),
      suppressedSlot
    );

    const bindingSlot = reopened.slots.find((slot) => slot.profileId === 'binding-only');
    const removedBindingId = bindingSlot.accountBindingId;
    const removedBindingAgentId = bindingSlot.agentId;
    const bindingRemoved = service.removeCatalogObject({
      scope: 'account-binding',
      accountBindingId: removedBindingId,
      baseRevision: reopened.mesh.catalogRevision
    });
    assert.equal(bindingRemoved.accountBindings.some((item) => item.accountBindingId === removedBindingId), false);
    assert.equal(bindingRemoved.agents.some((item) => item.agentId === removedBindingAgentId), false);
    assert.deepEqual(
      bindingRemoved.slots.find((slot) => slot.profileId === 'binding-only'),
      {
        ...bindingSlot,
        agentId: null,
        accountBindingId: null,
        assignmentState: 'suppressed',
        lastUpdatedAt: NOW
      }
    );

    service = harness.makeService();
    reopened = service.getOverview();
    const agentSlot = reopened.slots.find((slot) => slot.profileId === 'agent-only');
    const removedAgentId = agentSlot.agentId;
    const removedAgentBindingId = agentSlot.accountBindingId;
    const agentRemoved = service.removeCatalogObject({
      scope: 'agent',
      agentId: removedAgentId,
      baseRevision: reopened.mesh.catalogRevision
    });
    assert.equal(agentRemoved.agents.some((item) => item.agentId === removedAgentId), false);
    assert.equal(agentRemoved.accountBindings.some((item) => item.accountBindingId === removedAgentBindingId), false);
    assert.equal(agentRemoved.slots.find((slot) => slot.profileId === 'agent-only').assignmentState, 'suppressed');

    service = harness.makeService();
    reopened = service.getOverview();
    for (const agentId of reopened.agents.map((agent) => agent.agentId)) {
      reopened = service.removeCatalogObject({
        scope: 'agent',
        agentId,
        baseRevision: reopened.mesh.catalogRevision
      });
    }

    service = harness.makeService();
    const empty = service.getOverview();
    assert.equal(empty.agents.length, 0);
    assert.equal(empty.accountBindings.length, 0);
    assert.equal(empty.slots.length, profiles.length);
    assert.ok(empty.slots.every((slot) => (
      slot.assignmentState === 'suppressed'
      && slot.agentId === null
      && slot.accountBindingId === null
    )));

    const store = new MeshStore(harness.databasePath);
    const snapshot = store.readSnapshot();
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.accountBindings.length, 0);
    assert.equal(snapshot.slots.length, profiles.length);
    assert.equal(snapshot.tombstones.filter((item) => item.objectType === 'agent').length, initial.agents.length);
    assert.equal(snapshot.tombstones.filter((item) => item.objectType === 'account-binding').length, initial.accountBindings.length);
    assert.deepEqual(store.database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(store.database.prepare(`
      SELECT agent_id, account_binding_id FROM agent_slots
    `).all().every((row) => row.agent_id === null && row.account_binding_id === null));
    store.close();
  } finally {
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});
