const fs = require('node:fs');
const path = require('node:path');
const { migrateMeshDatabase } = require('./migrations');

class MeshStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.database = new DatabaseSync(filePath);
    migrateMeshDatabase(this.database);
    this.database.exec('PRAGMA journal_mode = WAL');
  }

  isInitialized() {
    return Boolean(this.database.prepare('SELECT 1 AS ok FROM mesh_config WHERE singleton = 1').get());
  }

  initialize(mesh, localDevice, catalog, options = {}) {
    if (this.isInitialized()) throw new Error('mesh-already-initialized');
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO mesh_config (
          singleton, mesh_id, display_name, root_public_key, protocol_version,
          local_device_id, created_at, catalog_revision
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mesh.meshId,
        mesh.displayName,
        mesh.rootPublicKey,
        mesh.protocolVersion,
        mesh.localDeviceId,
        mesh.createdAt,
        catalog.catalogRevision || 0
      );
      const devices = [localDevice, ...(Array.isArray(options.devices) ? options.devices : [])];
      const seenDevices = new Set();
      for (const device of devices) {
        if (!device?.deviceId || seenDevices.has(device.deviceId)) continue;
        seenDevices.add(device.deviceId);
        this.writeDevice(device);
      }
      this.replaceCatalogRows(catalog);
      for (const event of Array.isArray(options.membershipEvents) ? options.membershipEvents : []) {
        this.writeMembershipEvent(event);
      }
      this.writeAudit('mesh.initialized', mesh.createdAt, {
        meshId: mesh.meshId,
        localDeviceId: mesh.localDeviceId,
        agentCount: catalog.agents.length,
        slotCount: catalog.slots.length,
        deviceCount: seenDevices.size
      });
    });
  }

  readSnapshot() {
    const meshRow = this.database.prepare('SELECT * FROM mesh_config WHERE singleton = 1').get();
    if (!meshRow) return null;
    return {
      mesh: {
        meshId: meshRow.mesh_id,
        displayName: meshRow.display_name,
        rootPublicKey: meshRow.root_public_key,
        protocolVersion: meshRow.protocol_version,
        localDeviceId: meshRow.local_device_id,
        createdAt: meshRow.created_at
      },
      catalogRevision: Number(meshRow.catalog_revision) || 0,
      membershipRevision: Number(meshRow.membership_revision) || 0,
      revocationRevision: Number(meshRow.revocation_revision) || 0,
      devices: this.database.prepare('SELECT payload_json FROM devices ORDER BY is_local DESC, name').all()
        .map((row) => parsePayload(row.payload_json)),
      agents: this.database.prepare('SELECT payload_json FROM agents ORDER BY display_name, agent_id').all()
        .map((row) => parsePayload(row.payload_json)),
      accountBindings: this.database.prepare('SELECT payload_json FROM account_bindings ORDER BY account_binding_id').all()
        .map((row) => parsePayload(row.payload_json)),
      slots: this.database.prepare('SELECT payload_json FROM agent_slots ORDER BY device_id, profile_id').all()
        .map((row) => parsePayload(row.payload_json)),
      tombstones: this.database.prepare('SELECT payload_json FROM catalog_tombstones ORDER BY object_type, object_id').all()
        .map((row) => parsePayload(row.payload_json)),
      membershipEvents: this.database.prepare('SELECT payload_json FROM membership_events ORDER BY sequence').all()
        .map((row) => parsePayload(row.payload_json)),
      remoteInventories: this.database.prepare('SELECT payload_json FROM remote_inventory ORDER BY device_id').all()
        .map((row) => parsePayload(row.payload_json))
    };
  }

  saveCatalog(catalog, now) {
    const current = this.database.prepare('SELECT catalog_revision FROM mesh_config WHERE singleton = 1').get();
    if (!current) throw new Error('mesh-not-initialized');
    const changed = Number(current.catalog_revision) !== Number(catalog.catalogRevision);
    if (!changed) return false;
    this.transaction(() => {
      this.replaceCatalogRows(catalog);
      this.database.prepare('UPDATE mesh_config SET catalog_revision = ? WHERE singleton = 1')
        .run(catalog.catalogRevision);
      this.writeAudit('catalog.local-synced', now, {
        revision: catalog.catalogRevision,
        agentCount: catalog.agents.length,
        slotCount: catalog.slots.length
      });
    });
    return true;
  }

  saveDevice(device, now) {
    this.transaction(() => {
      this.writeDevice(device);
      this.writeAudit('device.updated', now, { deviceId: device.deviceId, name: device.name });
    });
  }

  savePairedDevice(device, event, now) {
    this.transaction(() => {
      if (this.isDeviceRevoked(device.deviceId)) throw new Error('device-revoked');
      this.writeDevice(device);
      if (event) this.writeMembershipEvent(event);
      this.writeAudit('device.paired', now, { deviceId: device.deviceId, name: device.name });
    });
  }

  updateDevicePermissions(deviceId, permissions, event, now) {
    this.transaction(() => {
      const row = this.database.prepare('SELECT payload_json FROM devices WHERE device_id = ?').get(deviceId);
      if (!row) throw new Error('device-not-found');
      const device = parsePayload(row.payload_json);
      if (device.isLocal) throw new Error('local-device-permissions-fixed');
      if (device.status === 'revoked' || this.isDeviceRevoked(deviceId)) throw new Error('device-revoked');
      this.writeDevice({ ...device, permissions });
      this.writeMembershipEvent(event);
      this.writeAudit('device.permissions', now, { deviceId, permissions });
    });
  }

  revokeDevice(deviceId, event, now, options = {}) {
    this.transaction(() => {
      const row = this.database.prepare('SELECT payload_json FROM devices WHERE device_id = ?').get(deviceId);
      if (!row) throw new Error('device-not-found');
      const device = parsePayload(row.payload_json);
      if (device.isLocal) throw new Error('local-device-use-reset');
      this.writeMembershipEvent(event);
      this.database.prepare('DELETE FROM remote_inventory WHERE device_id = ?').run(deviceId);
      if (options.remove === true) {
        this.database.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
      } else {
        this.writeDevice({
          ...device,
          status: 'revoked',
          permissions: [],
          revokedAt: now,
          lastSeenAt: now
        });
      }
      this.writeAudit('device.revoked', now, { deviceId, removed: options.remove === true });
    });
  }

  isDeviceRevoked(deviceId) {
    return Boolean(this.database.prepare(`
      SELECT 1 AS ok FROM membership_events
      WHERE subject_device_id = ? AND event_type = 'device.revoked'
      LIMIT 1
    `).get(deviceId));
  }

  nextMembershipSequence() {
    const row = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM membership_events').get();
    return Number(row?.value || 0) + 1;
  }

  saveMembershipEvent(event, now) {
    this.transaction(() => {
      this.writeMembershipEvent(event);
      this.writeAudit('membership.event', now, {
        eventId: event.eventId,
        eventType: event.eventType,
        subjectDeviceId: event.subjectDeviceId
      });
    });
  }

  saveRemoteInventory(inventory, now) {
    if (!inventory?.deviceId) throw new TypeError('remote inventory deviceId is required');
    this.transaction(() => {
      if (this.isDeviceRevoked(inventory.deviceId)) throw new Error('device-revoked');
      const existing = this.database.prepare('SELECT revision FROM remote_inventory WHERE device_id = ?').get(inventory.deviceId);
      if (existing && Number(inventory.revision) <= Number(existing.revision)) return;
      this.writeRemoteInventory(inventory);
      this.writeAudit('inventory.remote-synced', now, {
        deviceId: inventory.deviceId,
        revision: inventory.revision
      });
    });
  }

  applyRemoteInventory(inventory, catalog, device, now) {
    return this.transaction(() => {
      if (this.isDeviceRevoked(inventory.deviceId)) throw new Error('device-revoked');
      const existing = this.database.prepare('SELECT revision FROM remote_inventory WHERE device_id = ?').get(inventory.deviceId);
      if (existing && Number(inventory.revision) <= Number(existing.revision)) return false;
      this.replaceCatalogRows(catalog);
      this.database.prepare('UPDATE mesh_config SET catalog_revision = ? WHERE singleton = 1')
        .run(catalog.catalogRevision);
      this.writeRemoteInventory(inventory);
      this.writeDevice(device);
      this.writeAudit('inventory.remote-applied', now, {
        deviceId: inventory.deviceId,
        revision: inventory.revision,
        agentCount: catalog.agents.length,
        slotCount: catalog.slots.length,
        sessionCount: inventory.sessions.length
      });
      return true;
    });
  }

  saveTransferJob(job, now) {
    if (!job?.transferId) throw new TypeError('transfer-id-required');
    this.transaction(() => {
      const previous = this.database.prepare('SELECT state FROM transfer_jobs WHERE transfer_id = ?')
        .get(job.transferId);
      this.database.prepare(`
        INSERT INTO transfer_jobs (
          transfer_id, direction, transfer_type, source_device_id, target_device_id,
          state, bytes_total, bytes_transferred, created_at, updated_at, expires_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(transfer_id) DO UPDATE SET
          state = excluded.state,
          bytes_total = excluded.bytes_total,
          bytes_transferred = excluded.bytes_transferred,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          payload_json = excluded.payload_json
      `).run(
        job.transferId,
        job.direction,
        job.type,
        job.sourceDeviceId,
        job.targetDeviceId,
        job.state,
        Number(job.bytesTotal) || 0,
        Number(job.bytesTransferred) || 0,
        job.createdAt,
        job.updatedAt,
        job.expiresAt,
        JSON.stringify(job)
      );
      if (!previous || previous.state !== job.state) {
        this.writeAudit(`transfer.${job.state}`, now, {
          transferId: job.transferId,
          direction: job.direction,
          type: job.type,
          sourceDeviceId: job.sourceDeviceId,
          targetDeviceId: job.targetDeviceId
        });
      }
    });
    return job;
  }

  readTransferJob(transferId) {
    const row = this.database.prepare('SELECT payload_json FROM transfer_jobs WHERE transfer_id = ?').get(transferId);
    return row ? parsePayload(row.payload_json) : null;
  }

  readTransferJobs(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const rows = options.targetDeviceId
      ? this.database.prepare(`
          SELECT payload_json FROM transfer_jobs
          WHERE target_device_id = ? ORDER BY updated_at DESC LIMIT ?
        `).all(options.targetDeviceId, limit)
      : this.database.prepare(`
          SELECT payload_json FROM transfer_jobs ORDER BY updated_at DESC LIMIT ?
        `).all(limit);
    return rows.map((row) => parsePayload(row.payload_json));
  }

  deleteTransferJob(transferId, now) {
    return this.transaction(() => {
      const result = this.database.prepare('DELETE FROM transfer_jobs WHERE transfer_id = ?').run(transferId);
      if (result.changes) this.writeAudit('transfer.deleted', now, { transferId });
      return Boolean(result.changes);
    });
  }

  saveProjectBinding(binding, now) {
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO project_bindings (project_id, device_id, local_root, verified_at, payload_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, device_id) DO UPDATE SET
          local_root = excluded.local_root,
          verified_at = excluded.verified_at,
          payload_json = excluded.payload_json
      `).run(
        binding.projectId,
        binding.deviceId,
        binding.localRoot,
        binding.verifiedAt,
        JSON.stringify(binding)
      );
      this.writeAudit('project.binding', now, {
        projectId: binding.projectId,
        deviceId: binding.deviceId,
        source: binding.source
      });
    });
    return binding;
  }

  readProjectBindings() {
    return this.database.prepare('SELECT payload_json FROM project_bindings ORDER BY verified_at DESC').all()
      .map((row) => parsePayload(row.payload_json));
  }

  close() {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  destroy() {
    this.close();
    for (const file of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  writeDevice(device) {
    this.database.prepare(`
      INSERT INTO devices (device_id, is_local, status, name, last_seen_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        is_local = excluded.is_local,
        status = excluded.status,
        name = excluded.name,
        last_seen_at = excluded.last_seen_at,
        payload_json = excluded.payload_json
    `).run(
      device.deviceId,
      device.isLocal ? 1 : 0,
      device.status,
      device.name,
      device.lastSeenAt,
      JSON.stringify(device)
    );
  }

  writeMembershipEvent(event) {
    if (!event?.eventId || !Number.isSafeInteger(Number(event.sequence))) {
      throw new TypeError('membership-event-invalid');
    }
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO membership_events (
        event_id, sequence, event_type, subject_device_id, source_device_id, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      Number(event.sequence),
      event.eventType,
      event.subjectDeviceId,
      event.sourceDeviceId,
      event.createdAt,
      JSON.stringify(event)
    );
    if (!result.changes) return false;
    const revoked = event.eventType === 'device.revoked';
    this.database.prepare(`
      UPDATE mesh_config SET
        membership_revision = MAX(membership_revision, ?),
        revocation_revision = CASE WHEN ? THEN MAX(revocation_revision, ?) ELSE revocation_revision END
      WHERE singleton = 1
    `).run(Number(event.sequence), revoked ? 1 : 0, Number(event.sequence));
    return true;
  }

  writeRemoteInventory(inventory) {
    this.database.prepare(`
      INSERT INTO remote_inventory (device_id, revision, generated_at, stale_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        revision = excluded.revision,
        generated_at = excluded.generated_at,
        stale_at = excluded.stale_at,
        payload_json = excluded.payload_json
    `).run(
      inventory.deviceId,
      inventory.revision,
      inventory.generatedAt,
      inventory.staleAt,
      JSON.stringify(inventory)
    );
  }

  replaceCatalogRows(catalog) {
    // The snapshot is the full signed catalog plus all currently cached Slots.
    // Replacing these normalized rows is transactional, so a crash cannot mix revisions.
    this.database.exec('DELETE FROM agent_slots; DELETE FROM account_bindings; DELETE FROM agents; DELETE FROM catalog_tombstones;');
    const insertAgent = this.database.prepare(`
      INSERT INTO agents (agent_id, lifecycle_state, display_name, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const agent of catalog.agents) {
      insertAgent.run(agent.agentId, agent.lifecycleState || 'active', agent.displayName, JSON.stringify(agent));
    }

    const insertBinding = this.database.prepare(`
      INSERT INTO account_bindings (
        account_binding_id, agent_id, provider_namespace, mesh_scoped_account_key, payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const binding of catalog.accountBindings) {
      insertBinding.run(
        binding.accountBindingId,
        binding.agentId,
        binding.providerNamespace,
        binding.meshScopedAccountKey,
        JSON.stringify(binding)
      );
    }

    const insertSlot = this.database.prepare(`
      INSERT INTO agent_slots (
        device_id, profile_id, agent_id, account_binding_id, assignment_state, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const slot of catalog.slots) {
      insertSlot.run(
        slot.deviceId,
        slot.profileId,
        slot.agentId,
        slot.accountBindingId,
        slot.assignmentState || 'linked',
        JSON.stringify(slot)
      );
    }

    const insertTombstone = this.database.prepare(`
      INSERT INTO catalog_tombstones (object_type, object_id, deleted_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const tombstone of catalog.tombstones) {
      insertTombstone.run(
        tombstone.objectType,
        tombstone.objectId,
        tombstone.deletedAt,
        JSON.stringify(tombstone)
      );
    }
  }

  writeAudit(eventType, createdAt, payload) {
    this.database.prepare(`
      INSERT INTO audit_events (event_type, created_at, payload_json) VALUES (?, ?, ?)
    `).run(eventType, createdAt, JSON.stringify(payload));
  }

  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch (_rollbackError) { /* original error wins */ }
      throw error;
    }
  }
}

function parsePayload(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    throw new Error('mesh-database-payload-invalid');
  }
}

module.exports = { MeshStore };
