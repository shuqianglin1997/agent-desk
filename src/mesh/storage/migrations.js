const MESH_SCHEMA_VERSION = 6;

function migrateMeshDatabase(database) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  const current = Number(database.prepare('PRAGMA user_version').get().user_version || 0);
  if (current > MESH_SCHEMA_VERSION) throw new Error('mesh-database-newer-than-app');
  if (current < 1) migrateToVersion1(database);
  if (current < 2) migrateToVersion2(database);
  if (current < 3) migrateToVersion3(database);
  if (current < 4) migrateToVersion4(database);
  if (current < 5) migrateToVersion5(database);
  if (current < 6) migrateToVersion6(database);
}

function migrateToVersion6(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    DROP INDEX IF EXISTS catalog_events_revision_source;
    DROP TABLE catalog_events;

    CREATE TABLE catalog_events (
      event_id TEXT PRIMARY KEY,
      source_device_id TEXT NOT NULL,
      source_sequence INTEGER NOT NULL,
      lamport INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX catalog_events_source_sequence
      ON catalog_events(source_device_id, source_sequence);

    CREATE INDEX catalog_events_lamport
      ON catalog_events(lamport, source_device_id, source_sequence);

    PRAGMA user_version = 6;
    COMMIT;
  `);
}

function migrateToVersion5(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    CREATE TABLE agent_blueprints (
      agent_id TEXT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      preferred_provider TEXT,
      preferred_app_id TEXT,
      preferred_client_form TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE agent_deployments (
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      blueprint_revision INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (agent_id, device_id)
    );

    CREATE INDEX agent_deployments_device_state
      ON agent_deployments(device_id, state, updated_at DESC);

    CREATE TABLE provisioning_jobs (
      job_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      client_form TEXT,
      state TEXT NOT NULL,
      current_step TEXT NOT NULL,
      active_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX provisioning_jobs_agent_device
      ON provisioning_jobs(agent_id, device_id, updated_at DESC);

    CREATE TABLE catalog_events (
      event_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      source_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX catalog_events_revision_source
      ON catalog_events(revision, source_device_id, event_id);

    PRAGMA user_version = 5;
    COMMIT;
  `);
}

function migrateToVersion4(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    CREATE TABLE agent_slots_v4 (
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL,
      agent_id TEXT REFERENCES agents(agent_id) ON DELETE CASCADE,
      account_binding_id TEXT REFERENCES account_bindings(account_binding_id) ON DELETE CASCADE,
      assignment_state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (device_id, profile_id)
    );

    INSERT INTO agent_slots_v4 (
      device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
    )
    SELECT device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
    FROM agent_slots;

    DROP TABLE agent_slots;
    ALTER TABLE agent_slots_v4 RENAME TO agent_slots;

    PRAGMA user_version = 4;
    COMMIT;
  `);
}

function migrateToVersion3(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    CREATE TABLE project_bindings (
      project_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      local_root TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (project_id, device_id)
    );

    CREATE TABLE transfer_jobs (
      transfer_id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      transfer_type TEXT NOT NULL,
      source_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      state TEXT NOT NULL,
      bytes_total INTEGER NOT NULL DEFAULT 0,
      bytes_transferred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX transfer_jobs_state_target
      ON transfer_jobs(direction, state, target_device_id, updated_at);

    CREATE TABLE transfer_chunks (
      transfer_id TEXT NOT NULL REFERENCES transfer_jobs(transfer_id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (transfer_id, chunk_index)
    );

    PRAGMA user_version = 3;
    COMMIT;
  `);
}

function migrateToVersion2(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    ALTER TABLE mesh_config ADD COLUMN membership_revision INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mesh_config ADD COLUMN revocation_revision INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE membership_events (
      event_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      subject_device_id TEXT NOT NULL,
      source_device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX membership_events_subject ON membership_events(subject_device_id, sequence DESC);

    CREATE TABLE remote_inventory (
      device_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      stale_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE connection_history (
      connection_id TEXT PRIMARY KEY,
      peer_device_id TEXT NOT NULL,
      state TEXT NOT NULL,
      network_path TEXT,
      connected_at TEXT,
      disconnected_at TEXT,
      payload_json TEXT NOT NULL
    );

    PRAGMA user_version = 2;
    COMMIT;
  `);
}

function migrateToVersion1(database) {
  database.exec(`
    BEGIN IMMEDIATE;

    CREATE TABLE mesh_config (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      mesh_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      root_public_key TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      local_device_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      catalog_revision INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE devices (
      device_id TEXT PRIMARY KEY,
      is_local INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      last_seen_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX one_local_device ON devices(is_local) WHERE is_local = 1;

    CREATE TABLE agents (
      agent_id TEXT PRIMARY KEY,
      lifecycle_state TEXT NOT NULL,
      display_name TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE account_bindings (
      account_binding_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      provider_namespace TEXT NOT NULL,
      mesh_scoped_account_key TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX account_binding_strong_key
      ON account_bindings(provider_namespace, mesh_scoped_account_key)
      WHERE mesh_scoped_account_key IS NOT NULL;

    CREATE TABLE agent_slots (
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      account_binding_id TEXT NOT NULL REFERENCES account_bindings(account_binding_id) ON DELETE CASCADE,
      assignment_state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (device_id, profile_id)
    );

    CREATE TABLE catalog_tombstones (
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (object_type, object_id)
    );

    CREATE TABLE audit_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    PRAGMA user_version = 1;
    COMMIT;
  `);
}

module.exports = {
  MESH_SCHEMA_VERSION,
  migrateMeshDatabase
};
