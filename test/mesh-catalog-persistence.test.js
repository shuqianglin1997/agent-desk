const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { MeshService } = require('../src/mesh/main/mesh-service');
const { MeshStore, preserveMigrationBackup } = require('../src/mesh/storage/mesh-store');
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

test('schema v3 安全迁移到 v6，保留 Slot 数据并建立员工运行模型与目录事件表', () => {
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
      DROP TABLE catalog_events;
      DROP TABLE provisioning_jobs;
      DROP TABLE agent_deployments;
      DROP TABLE agent_blueprints;
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
    const backupPath = `${harness.databasePath}.pre-v${MESH_SCHEMA_VERSION}.bak`;
    assert.equal(fs.existsSync(backupPath), true);
    const backup = new DatabaseSync(backupPath);
    assert.equal(Number(backup.prepare('PRAGMA user_version').get().user_version), 3);
    backup.close();
    const columns = migrated.database.prepare('PRAGMA table_info(agent_slots)').all();
    assert.equal(columns.find((column) => column.name === 'agent_id').notnull, 0);
    assert.equal(columns.find((column) => column.name === 'account_binding_id').notnull, 0);
    assert.deepEqual(migrated.database.prepare(`
      SELECT device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      FROM agent_slots ORDER BY device_id, profile_id
    `).all(), expectedRows);
    assert.deepEqual(migrated.database.prepare('PRAGMA foreign_key_check').all(), []);
    for (const table of ['agent_blueprints', 'agent_deployments', 'provisioning_jobs', 'catalog_events']) {
      assert.equal(Boolean(migrated.database.prepare(`
        SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?
      `).get(table)), true, `${table} must exist after v6 migration`);
    }
    const eventColumns = migrated.database.prepare('PRAGMA table_info(catalog_events)').all();
    assert.equal(eventColumns.some((column) => column.name === 'source_sequence'), true);
    assert.equal(eventColumns.some((column) => column.name === 'lamport'), true);
    assert.equal(eventColumns.some((column) => column.name === 'revision'), false);
    assert.deepEqual(migrated.database.prepare('PRAGMA foreign_key_list(catalog_events)').all(), []);

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

test('v4 WAL 中已提交数据会进入 pre-v6 一致备份，Node 22 与 Electron 均可迁移', () => {
  const harness = createHarness([profile('wal-slot', 'wal-account')]);
  let legacy = null;
  try {
    harness.makeService().initialize();
    legacy = new DatabaseSync(harness.databasePath);
    legacy.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      DROP TABLE catalog_events;
      DROP TABLE provisioning_jobs;
      DROP TABLE agent_deployments;
      DROP TABLE agent_blueprints;
      PRAGMA user_version = 4;
    `);
    legacy.prepare(`
      INSERT INTO audit_events (event_type, created_at, payload_json) VALUES (?, ?, ?)
    `).run('migration.wal-marker', NOW, JSON.stringify({ committed: true }));
    const walPath = `${harness.databasePath}-wal`;
    assert.equal(fs.existsSync(walPath), true);
    assert.ok(fs.statSync(walPath).size > 0);

    const migrated = new MeshStore(harness.databasePath);
    const backupPath = `${harness.databasePath}.pre-v${MESH_SCHEMA_VERSION}.bak`;
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    assert.equal(Number(backup.prepare('PRAGMA user_version').get().user_version), 4);
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(backup.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(backup.prepare(`
      SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'migration.wal-marker'
    `).get().count, 1);
    backup.close();

    assert.equal(Number(migrated.database.prepare('PRAGMA user_version').get().user_version), MESH_SCHEMA_VERSION);
    assert.equal(migrated.database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(migrated.database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(migrated.database.prepare(`
      SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'migration.wal-marker'
    `).get().count, 1);
    migrated.close();
  } finally {
    try { legacy?.close(); } catch (_error) { /* best effort */ }
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('迁移备份失败会清理临时文件且不伪造最终回滚点', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-backup-failure-'));
  const databasePath = path.join(directory, 'mesh.db');
  fs.writeFileSync(databasePath, 'source-remains');
  try {
    const database = {
      prepare(sql) {
        if (sql === 'PRAGMA user_version') {
          return { get: () => ({ user_version: 4 }) };
        }
        assert.equal(sql, 'VACUUM INTO ?');
        return {
          run(destination) {
            fs.writeFileSync(destination, 'partial');
            throw new Error('injected-vacuum-failure');
          }
        };
      }
    };
    assert.throws(
      () => preserveMigrationBackup(database, databasePath, MESH_SCHEMA_VERSION),
      /injected-vacuum-failure/
    );
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'source-remains');
    assert.equal(fs.existsSync(`${databasePath}.pre-v${MESH_SCHEMA_VERSION}.bak`), false);
    assert.deepEqual(fs.readdirSync(directory), ['mesh.db']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('重复读取员工运行模型不产生写入或重复审计', () => {
  const harness = createHarness([profile('stable-slot', 'stable-account')]);
  try {
    const service = harness.makeService();
    service.initialize();
    const before = new MeshStore(harness.databasePath);
    const auditCount = before.database.prepare(`
      SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'agent-runtime.reconciled'
    `).get().count;
    const snapshot = before.readSnapshot();
    before.close();

    service.getOverview();

    const after = new MeshStore(harness.databasePath);
    assert.equal(after.database.prepare(`
      SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'agent-runtime.reconciled'
    `).get().count, auditCount);
    assert.deepEqual(after.readSnapshot().blueprints, snapshot.blueprints);
    assert.deepEqual(after.readSnapshot().deployments, snapshot.deployments);
    after.close();
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
    assert.equal(initial.blueprints.length, 4);
    assert.equal(initial.deployments.length, 4);
    assert.ok(initial.deployments.every((item) => item.state === 'ready'));

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
    assert.equal(bindingRemoved.agents.some((item) => item.agentId === removedBindingAgentId), true);
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
