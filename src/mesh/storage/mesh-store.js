const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MESH_SCHEMA_VERSION, migrateMeshDatabase } = require('./migrations');
const {
  normalizeAgentBlueprint,
  normalizeAgentDeployment,
  normalizeProvisioningJob,
  activeJobKey,
  deploymentKey
} = require('../domain/agent-deployment');
const { normalizeCatalogEventList } = require('../protocol/catalog-events');

class MeshStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.database = new DatabaseSync(filePath);
    try {
      const currentVersion = Number(this.database.prepare('PRAGMA user_version').get().user_version || 0);
      if (currentVersion > 0 && currentVersion < MESH_SCHEMA_VERSION) {
        preserveMigrationBackup(this.database, filePath, MESH_SCHEMA_VERSION);
      }
      migrateMeshDatabase(this.database);
    } catch (error) {
      try { this.database.close(); } catch (_closeError) { /* original error wins */ }
      throw error;
    }
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
      blueprints: this.database.prepare('SELECT payload_json FROM agent_blueprints ORDER BY agent_id').all()
        .map((row) => parsePayload(row.payload_json)),
      deployments: this.database.prepare('SELECT payload_json FROM agent_deployments ORDER BY device_id, agent_id').all()
        .map((row) => parsePayload(row.payload_json)),
      provisioningJobs: this.database.prepare('SELECT payload_json FROM provisioning_jobs ORDER BY updated_at DESC').all()
        .map((row) => parsePayload(row.payload_json)),
      catalogEvents: this.database.prepare(
        'SELECT payload_json FROM catalog_events ORDER BY lamport, source_device_id, source_sequence'
      ).all()
        .map((row) => parsePayload(row.payload_json)),
      tombstones: this.database.prepare('SELECT payload_json FROM catalog_tombstones ORDER BY object_type, object_id').all()
        .map((row) => parsePayload(row.payload_json)),
      membershipEvents: this.database.prepare('SELECT payload_json FROM membership_events ORDER BY sequence').all()
        .map((row) => parsePayload(row.payload_json)),
      remoteInventories: this.database.prepare('SELECT payload_json FROM remote_inventory ORDER BY device_id').all()
        .map((row) => parsePayload(row.payload_json))
    };
  }

  saveCatalog(catalog, now, options = {}) {
    const current = this.database.prepare('SELECT catalog_revision FROM mesh_config WHERE singleton = 1').get();
    if (!current) throw new Error('mesh-not-initialized');
    const changed = Number(current.catalog_revision) !== Number(catalog.catalogRevision);
    if (!changed) return false;
    this.transaction(() => {
      this.replaceCatalogRows(catalog);
      this.database.prepare('UPDATE mesh_config SET catalog_revision = ? WHERE singleton = 1')
        .run(catalog.catalogRevision);
      this.writeAudit(options.eventType || 'catalog.local-synced', now, {
        revision: catalog.catalogRevision,
        agentCount: catalog.agents.length,
        slotCount: catalog.slots.length,
        sourceDeviceId: options.sourceDeviceId || null
      });
    });
    return true;
  }

  saveCatalogEvents(eventsValue, now, options = {}) {
    const events = normalizeCatalogEventList(eventsValue);
    if (!events.length) return 0;
    let inserted = 0;
    this.transaction(() => {
      for (const event of events) inserted += this.writeCatalogEvent(event);
      if (inserted) {
        this.writeAudit(options.eventType || 'catalog.events-recorded', now, {
          inserted,
          sourceDeviceId: options.sourceDeviceId || null
        });
      }
    });
    return inserted;
  }

  saveCatalogEventState(input = {}, now, options = {}) {
    const events = normalizeCatalogEventList(input.events);
    const blueprints = (Array.isArray(input.blueprints) ? input.blueprints : [])
      .map(normalizeAgentBlueprint);
    const conflicts = Array.isArray(input.conflicts) ? input.conflicts.slice(0, 256) : [];
    const catalog = input.catalog;
    if (!catalog || !Number.isSafeInteger(Number(catalog.catalogRevision))) {
      throw new TypeError('catalog-event-state-invalid');
    }
    let inserted = 0;
    this.transaction(() => {
      for (const event of events) inserted += this.writeCatalogEvent(event);
      this.replaceCatalogRows(catalog);
      this.database.prepare('UPDATE mesh_config SET catalog_revision = ? WHERE singleton = 1')
        .run(catalog.catalogRevision);
      const liveBlueprintIds = new Set(blueprints.map((item) => item.agentId));
      for (const blueprint of blueprints) this.writeBlueprint(blueprint);
      for (const row of this.database.prepare('SELECT agent_id FROM agent_blueprints').all()) {
        if (!liveBlueprintIds.has(row.agent_id)) {
          this.database.prepare('DELETE FROM agent_blueprints WHERE agent_id = ?').run(row.agent_id);
        }
      }
      this.writeAudit(options.eventType || 'catalog.events-applied', now, {
        inserted,
        knownEvents: events.length,
        revision: catalog.catalogRevision,
        agentCount: catalog.agents.length,
        bindingCount: catalog.accountBindings.length,
        conflictCount: conflicts.length,
        sourceDeviceId: options.sourceDeviceId || null
      });
      for (const conflict of conflicts) {
        const payload = JSON.stringify(conflict);
        const recorded = this.database.prepare(`
          SELECT 1 AS ok FROM audit_events
          WHERE event_type = 'catalog.conflict-observed' AND payload_json = ?
          LIMIT 1
        `).get(payload);
        if (!recorded) this.writeAudit('catalog.conflict-observed', now, conflict);
      }
    });
    return inserted;
  }

  saveDevice(device, now) {
    this.transaction(() => {
      this.writeDevice(device);
      this.writeAudit('device.updated', now, { deviceId: device.deviceId, name: device.name });
    });
  }

  saveRuntimeModel(model = {}, now, options = {}) {
    const blueprints = (Array.isArray(model.blueprints) ? model.blueprints : []).map(normalizeAgentBlueprint);
    const deployments = (Array.isArray(model.deployments) ? model.deployments : []).map(normalizeAgentDeployment);
    const currentBlueprintRows = this.database.prepare(
      'SELECT agent_id, payload_json FROM agent_blueprints'
    ).all();
    const currentDeploymentRows = this.database.prepare(
      'SELECT agent_id, device_id, payload_json FROM agent_deployments'
    ).all();
    const currentBlueprints = new Map(currentBlueprintRows.map((row) => [row.agent_id, row.payload_json]));
    const currentDeployments = new Map(currentDeploymentRows.map((row) => [
      deploymentKey(row.agent_id, row.device_id),
      row.payload_json
    ]));
    const changedBlueprints = blueprints.filter((blueprint) => (
      !payloadMatches(currentBlueprints.get(blueprint.agentId), blueprint)
    ));
    const changedDeployments = deployments.filter((deployment) => (
      !payloadMatches(currentDeployments.get(deploymentKey(deployment.agentId, deployment.deviceId)), deployment)
    ));
    const liveAgentIds = new Set(blueprints.map((item) => item.agentId));
    const deletedBlueprintIds = currentBlueprintRows
      .map((row) => row.agent_id)
      .filter((agentId) => !liveAgentIds.has(agentId));
    const localDeviceId = String(options.localDeviceId || '');
    const localKeys = new Set(deployments
      .filter((item) => item.deviceId === localDeviceId)
      .map((item) => deploymentKey(item.agentId, item.deviceId)));
    const deletedLocalDeployments = localDeviceId
      ? currentDeploymentRows.filter((row) => (
        row.device_id === localDeviceId
        && !localKeys.has(deploymentKey(row.agent_id, row.device_id))
      ))
      : [];
    const changed = Boolean(
      changedBlueprints.length
      || changedDeployments.length
      || deletedBlueprintIds.length
      || deletedLocalDeployments.length
    );
    if (!changed) return { blueprints, deployments, changed: false };

    this.transaction(() => {
      for (const blueprint of changedBlueprints) this.writeBlueprint(blueprint);
      for (const deployment of changedDeployments) this.writeDeployment(deployment);
      for (const agentId of deletedBlueprintIds) {
        this.database.prepare('DELETE FROM agent_blueprints WHERE agent_id = ?').run(agentId);
      }
      for (const deployment of deletedLocalDeployments) {
        this.database.prepare(`
          DELETE FROM agent_deployments WHERE agent_id = ? AND device_id = ?
        `).run(deployment.agent_id, deployment.device_id);
      }
      this.writeAudit('agent-runtime.reconciled', now, {
        blueprintCount: blueprints.length,
        deploymentCount: deployments.length,
        localDeviceId: localDeviceId || null
      });
    });
    return { blueprints, deployments, changed: true };
  }

  saveBlueprint(value, now) {
    const blueprint = normalizeAgentBlueprint(value);
    this.transaction(() => {
      this.writeBlueprint(blueprint);
      this.writeAudit('agent-blueprint.updated', now, {
        agentId: blueprint.agentId,
        revision: blueprint.revision
      });
    });
    return blueprint;
  }

  saveDeployment(value, now) {
    const deployment = normalizeAgentDeployment(value);
    this.transaction(() => {
      this.writeDeployment(deployment);
      this.writeAudit(`agent-deployment.${deployment.state}`, now, {
        agentId: deployment.agentId,
        deviceId: deployment.deviceId,
        revision: deployment.revision
      });
    });
    return deployment;
  }

  saveProvisioningJob(value, now) {
    const job = normalizeProvisioningJob(value);
    const activeKey = activeJobKey(job);
    const current = this.database.prepare(
      'SELECT payload_json FROM provisioning_jobs WHERE job_id = ?'
    ).get(job.jobId);
    if (payloadMatches(current?.payload_json, job)) return job;
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO provisioning_jobs (
          job_id, agent_id, device_id, client_form, state, current_step,
          active_key, created_at, updated_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          state = excluded.state,
          current_step = excluded.current_step,
          active_key = excluded.active_key,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(
        job.jobId,
        job.agentId,
        job.deviceId,
        job.requestedClientForm,
        job.state,
        job.currentStep,
        activeKey,
        job.createdAt,
        job.updatedAt,
        JSON.stringify(job)
      );
      this.writeAudit(`provisioning.${job.state}`, now, {
        jobId: job.jobId,
        agentId: job.agentId,
        deviceId: job.deviceId,
        currentStep: job.currentStep
      });
    });
    return job;
  }

  readProvisioningJob(jobId) {
    const row = this.database.prepare('SELECT payload_json FROM provisioning_jobs WHERE job_id = ?').get(jobId);
    return row ? parsePayload(row.payload_json) : null;
  }

  findActiveProvisioningJob(agentId, deviceId, selector = null) {
    const request = selector && typeof selector === 'object'
      ? selector
      : { requestedClientForm: selector };
    const suffix = String(request.requestedClientForm || request.requestedAppId || 'default');
    const key = `${String(agentId)}:${String(deviceId)}:${suffix}`;
    const row = this.database.prepare('SELECT payload_json FROM provisioning_jobs WHERE active_key = ?').get(key);
    return row ? parsePayload(row.payload_json) : null;
  }

  findLatestProvisioningJob(agentId, deviceId, selector = null) {
    const request = selector && typeof selector === 'object'
      ? selector
      : { requestedClientForm: selector };
    const rows = this.database.prepare(`
      SELECT payload_json FROM provisioning_jobs
      WHERE agent_id = ? AND device_id = ?
      ORDER BY updated_at DESC, created_at DESC, job_id DESC
    `).all(String(agentId), String(deviceId));
    const clientForm = String(request.requestedClientForm || '');
    const appId = String(request.requestedAppId || '');
    for (const row of rows) {
      const job = parsePayload(row.payload_json);
      if (clientForm && job.requestedClientForm !== clientForm) continue;
      if (appId && job.requestedAppId !== appId) continue;
      return job;
    }
    return null;
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

  deviceRevokedAt(deviceId) {
    const row = this.database.prepare(`
      SELECT created_at FROM membership_events
      WHERE subject_device_id = ? AND event_type = 'device.revoked'
      ORDER BY sequence ASC
      LIMIT 1
    `).get(deviceId);
    return row?.created_at || null;
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

  writeCatalogEvent(event) {
    const existing = this.database.prepare(
      'SELECT source_device_id, source_sequence, payload_json FROM catalog_events WHERE event_id = ?'
    ).get(event.eventId);
    const serialized = JSON.stringify(event);
    if (existing) {
      if (existing.payload_json !== serialized) throw new Error('catalog-event-id-collision');
      return 0;
    }
    const sequenceOwner = this.database.prepare(`
      SELECT event_id FROM catalog_events
      WHERE source_device_id = ? AND source_sequence = ?
    `).get(event.sourceDeviceId, event.sourceSequence);
    if (sequenceOwner && sequenceOwner.event_id !== event.eventId) {
      throw new Error('catalog-event-sequence-conflict');
    }
    const result = this.database.prepare(`
      INSERT INTO catalog_events (
        event_id, source_device_id, source_sequence, lamport, event_type, created_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.sourceDeviceId,
      event.sourceSequence,
      event.lamport,
      event.eventType,
      event.createdAt,
      serialized
    );
    return Number(result.changes || 0);
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

  writeBlueprint(value) {
    const blueprint = normalizeAgentBlueprint(value);
    this.database.prepare(`
      INSERT INTO agent_blueprints (
        agent_id, revision, preferred_provider, preferred_app_id,
        preferred_client_form, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        revision = excluded.revision,
        preferred_provider = excluded.preferred_provider,
        preferred_app_id = excluded.preferred_app_id,
        preferred_client_form = excluded.preferred_client_form,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      blueprint.agentId,
      blueprint.revision,
      blueprint.preferredProvider,
      blueprint.preferredAppId,
      blueprint.preferredClientForm,
      blueprint.updatedAt,
      JSON.stringify(blueprint)
    );
  }

  writeDeployment(value) {
    const deployment = normalizeAgentDeployment(value);
    this.database.prepare(`
      INSERT INTO agent_deployments (
        agent_id, device_id, state, blueprint_revision, revision, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, device_id) DO UPDATE SET
        state = excluded.state,
        blueprint_revision = excluded.blueprint_revision,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      deployment.agentId,
      deployment.deviceId,
      deployment.state,
      deployment.blueprintRevision,
      deployment.revision,
      deployment.updatedAt,
      JSON.stringify(deployment)
    );
  }

  replaceCatalogRows(catalog) {
    // Keep durable per-Agent blueprint/deployment rows intact while catalog
    // metadata is reconciled. Only an explicit missing Agent in the canonical
    // catalog may cascade-delete its runtime model.
    const insertAgent = this.database.prepare(`
      INSERT INTO agents (agent_id, lifecycle_state, display_name, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        lifecycle_state = excluded.lifecycle_state,
        display_name = excluded.display_name,
        payload_json = excluded.payload_json
    `);
    for (const agent of catalog.agents) {
      insertAgent.run(agent.agentId, agent.lifecycleState || 'active', agent.displayName, JSON.stringify(agent));
    }

    const insertBinding = this.database.prepare(`
      INSERT INTO account_bindings (
        account_binding_id, agent_id, provider_namespace, mesh_scoped_account_key, payload_json
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_binding_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        provider_namespace = excluded.provider_namespace,
        mesh_scoped_account_key = excluded.mesh_scoped_account_key,
        payload_json = excluded.payload_json
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

    this.database.exec('DELETE FROM agent_slots;');
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

    const liveBindingIds = new Set(catalog.accountBindings.map((item) => item.accountBindingId));
    for (const row of this.database.prepare('SELECT account_binding_id FROM account_bindings').all()) {
      if (!liveBindingIds.has(row.account_binding_id)) {
        this.database.prepare('DELETE FROM account_bindings WHERE account_binding_id = ?').run(row.account_binding_id);
      }
    }
    const liveAgentIds = new Set(catalog.agents.map((item) => item.agentId));
    for (const row of this.database.prepare('SELECT agent_id FROM agents').all()) {
      if (!liveAgentIds.has(row.agent_id)) {
        this.database.prepare('DELETE FROM agents WHERE agent_id = ?').run(row.agent_id);
      }
    }

    this.database.exec('DELETE FROM catalog_tombstones;');
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

function payloadMatches(serialized, value) {
  if (!serialized) return false;
  try {
    return JSON.stringify(JSON.parse(serialized)) === JSON.stringify(value);
  } catch (_error) {
    return false;
  }
}

function preserveMigrationBackup(database, filePath, targetVersion) {
  const backupFile = `${filePath}.pre-v${targetVersion}.bak`;
  const sourceVersion = Number(database.prepare('PRAGMA user_version').get().user_version || 0);
  if (fs.existsSync(backupFile)) {
    validateMigrationBackup(backupFile, sourceVersion, targetVersion, database.constructor);
    return backupFile;
  }
  const temporaryFile = `${backupFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor = null;
  try {
    // VACUUM INTO is synchronous in node:sqlite, includes committed WAL pages,
    // and is available in both the Node 22 test runtime and Electron's Node 24.
    // The destination must not exist, so use an unguessable same-directory name
    // and publish it only after the durable snapshot is complete.
    database.prepare('VACUUM INTO ?').run(temporaryFile);
    fs.chmodSync(temporaryFile, 0o600);
    descriptor = fs.openSync(temporaryFile, 'r+');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    validateMigrationBackup(temporaryFile, sourceVersion, targetVersion, database.constructor);
    // A hard link gives us an atomic, no-overwrite install in the same
    // directory. Removing the temporary name leaves the validated inode at the
    // exact recovery path without ever exposing a partial backup.
    fs.linkSync(temporaryFile, backupFile);
    fs.unlinkSync(temporaryFile);
    fsyncDirectory(path.dirname(backupFile));
    return backupFile;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_closeError) { /* original error wins */ }
    }
    try { fs.unlinkSync(temporaryFile); } catch (_unlinkError) { /* best effort */ }
    throw error;
  }
}

function validateMigrationBackup(filePath, sourceVersion, targetVersion, DatabaseClass) {
  let backup = null;
  try {
    backup = new DatabaseClass(filePath, { readOnly: true });
    const backupVersion = Number(backup.prepare('PRAGMA user_version').get().user_version || 0);
    if (backupVersion !== sourceVersion || backupVersion <= 0 || backupVersion >= targetVersion) {
      throw new Error('mesh-migration-backup-version');
    }
    const integrity = backup.prepare('PRAGMA integrity_check').get();
    if (String(integrity?.integrity_check || '').toLowerCase() !== 'ok') {
      throw new Error('mesh-migration-backup-integrity');
    }
    if (backup.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('mesh-migration-backup-foreign-key');
    }
  } catch (error) {
    if (String(error?.message || '').startsWith('mesh-migration-backup-')) throw error;
    throw new Error('mesh-migration-backup-invalid', { cause: error });
  } finally {
    try { backup?.close(); } catch (_error) { /* original validation result wins */ }
  }
}

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (_error) {
    // Some Windows filesystems do not allow opening a directory descriptor.
    // The backup file itself was already fsynced above.
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_error) { /* best effort */ }
    }
  }
}

module.exports = { MeshStore, preserveMigrationBackup };
