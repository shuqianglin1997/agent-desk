const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonStore, writeJsonStore } = require('../../json-store');
const { requireCapability } = require('../domain/capabilities');
const {
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  MAX_FILE_TRANSFER_BYTES,
  createFileManifest,
  fileChunkType,
  normalizeFileManifest,
  normalizeResumeOffsets,
  safeFileName,
  uniqueTargetNames
} = require('../domain/file-transfer');
const { createProjectBinding, resolveProjectPointer } = require('../domain/project-mapping');
const {
  createSessionPointer,
  normalizeSessionPointers,
  MAX_SESSION_POINTERS
} = require('../domain/session-pointer');
const { normalizeTransferJob, publicTransferJob } = require('../domain/transfer-job');
const {
  TASK_PACKAGE_TRANSFER_FEATURE,
  createTaskPackageTransferManifest,
  normalizeTaskPackageTransferManifest,
  sealTaskPackageUnlockCode,
  openTaskPackageUnlockCode,
  safeTaskPackageName
} = require('../domain/task-package-transfer');
const { decryptSecurePayload, encryptSecurePayload } = require('../protocol/secure-payload');
const { MeshStore } = require('../storage/mesh-store');

const POINTER_MESSAGE_LIMIT = 400 * 1024;
const FILE_ACK_TIMEOUT_MS = 30_000;
const FILE_DISK_MARGIN_BYTES = 64 * 1024 * 1024;
const TASK_PACKAGE_ENVELOPE_TTL_MS = 24 * 60 * 60_000;
const TASK_PACKAGE_SECRET_TTL_MS = TASK_PACKAGE_ENVELOPE_TTL_MS;

class TransferService {
  constructor(options = {}) {
    this.databasePath = options.databasePath;
    this.meshService = options.meshService;
    this.peerManagerProvider = options.peerManagerProvider;
    this.taskPackageServiceProvider = options.taskPackageServiceProvider || (() => null);
    this.spoolRoot = options.spoolRoot || path.join(path.dirname(this.databasePath), 'mesh-transfer-spool');
    this.now = options.now || (() => new Date().toISOString());
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.onChange = options.onChange || (() => {});
    this.stopped = false;
    this.inFlight = new Set();
    this.activeFileSends = new Map();
    this.pendingChunkAcks = new Map();
    this.progressNotificationAt = new Map();
    this.outgoingTaskSecrets = new Map();
    this.pendingTaskEnvelopes = new Map();
    this.incomingTaskSecrets = new Map();
    this.taskMaterialTimers = new Map();
    this.taskPackageSecretTtlMs = positiveDuration(
      options.taskPackageSecretTtlMs,
      TASK_PACKAGE_SECRET_TTL_MS,
      'task-package-secret-ttl'
    );
    this.taskPackageEnvelopeTtlMs = positiveDuration(
      options.taskPackageEnvelopeTtlMs,
      TASK_PACKAGE_ENVELOPE_TTL_MS,
      'task-package-envelope-ttl'
    );
    this.reconcileTaskPackagesAfterRestart();
  }

  reconcileTaskPackagesAfterRestart() {
    if (!this.databasePath || !fs.existsSync(this.databasePath)) return false;
    let changed = false;
    for (const job of this.listRaw().filter((item) => item.type === 'task-package')) {
      if (job.direction === 'outgoing') {
        this.removeOutgoingSpool(job.transferId);
        if (!['completed', 'cancelled', 'expired'].includes(job.state)) {
          const failed = this.update(job, {
            state: 'failed',
            lastError: 'task-package-secret-unavailable'
          }, { notify: false });
          this.recordTaskPackageTransferHistory(failed, 'failed');
          changed = true;
        }
        continue;
      }
      this.removeIncomingTaskSpool(job);
      if (job.state === 'completed' && this.hasImportedTaskPackage(job.transferId)) continue;
      if (!['cancelled', 'expired'].includes(job.state)
        && (job.state !== 'failed' || job.lastError !== 'task-package-secret-unavailable')) {
        this.update(job, {
          state: 'failed',
          lastError: 'task-package-secret-unavailable'
        }, { notify: false });
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  hasImportedTaskPackage(transferId) {
    try {
      return this.taskPackageServiceProvider?.()?.hasConsumedTransferId?.(transferId) === true;
    } catch (_error) {
      return false;
    }
  }

  setTaskMaterial(kind, transferId, value, expiresAt) {
    this.clearTaskMaterial(kind, transferId);
    const map = this.taskMaterialMap(kind);
    const stored = kind === 'envelope' ? value : {
      ...value,
      unlockCode: Buffer.from(String(value?.unlockCode || ''), 'utf8')
    };
    map.set(transferId, stored);
    const maximum = kind === 'envelope'
      ? this.taskPackageEnvelopeTtlMs
      : this.taskPackageSecretTtlMs;
    const remaining = Date.parse(expiresAt) - Date.parse(this.now());
    const delay = Math.max(1, Math.min(maximum, Number.isFinite(remaining) ? remaining : maximum));
    const key = `${kind}:${transferId}`;
    const timer = setTimeout(() => this.expireTaskMaterial(kind, transferId), delay);
    timer.unref?.();
    this.taskMaterialTimers.set(key, timer);
    return stored;
  }

  taskMaterialMap(kind) {
    if (kind === 'outgoing') return this.outgoingTaskSecrets;
    if (kind === 'incoming') return this.incomingTaskSecrets;
    if (kind === 'envelope') return this.pendingTaskEnvelopes;
    throw new Error('task-package-material-kind');
  }

  clearTaskMaterial(kind, transferId) {
    const key = `${kind}:${transferId}`;
    const timer = this.taskMaterialTimers.get(key);
    if (timer) clearTimeout(timer);
    this.taskMaterialTimers.delete(key);
    const map = this.taskMaterialMap(kind);
    const value = map.get(transferId);
    if (Buffer.isBuffer(value?.unlockCode)) value.unlockCode.fill(0);
    map.delete(transferId);
  }

  clearAllTaskMaterial(transferId) {
    this.clearTaskMaterial('outgoing', transferId);
    this.clearTaskMaterial('incoming', transferId);
    this.clearTaskMaterial('envelope', transferId);
  }

  expireTaskMaterial(kind, transferId) {
    this.clearTaskMaterial(kind, transferId);
    const job = this.read(transferId);
    if (!job || job.type !== 'task-package') return false;
    if (['cancelled', 'expired'].includes(job.state)) return true;
    if (kind === 'outgoing' && job.direction === 'outgoing' && job.state !== 'completed') {
      const expired = this.update(job, {
        state: 'expired',
        lastError: 'task-package-secret-expired'
      });
      this.rejectTransferAcks(transferId, new Error('task-package-secret-expired'));
      this.cleanupOutgoingSpoolWhenIdle(transferId);
      this.recordTaskPackageTransferHistory(expired, 'expired');
      void this.sendChunkSemantic(job, 'cancel', {
        transferId,
        reasonCode: 'task-package-secret-expired'
      }).catch(() => false);
    }
    if (kind === 'incoming' && job.direction === 'incoming' && !this.hasImportedTaskPackage(transferId)) {
      this.clearTaskMaterial('envelope', transferId);
      this.removeIncomingTaskSpool(job);
      this.update(job, {
        state: 'expired',
        lastError: 'task-package-secret-expired'
      });
    }
    if (kind === 'envelope' && job.direction === 'incoming' && !this.hasImportedTaskPackage(transferId)) {
      this.clearTaskMaterial('incoming', transferId);
      this.removeIncomingTaskSpool(job);
      const expired = this.update(job, {
        state: 'expired',
        lastError: 'task-package-secret-expired'
      });
      void this.sendChunkSemantic(expired, 'cancel', {
        transferId,
        reasonCode: 'task-package-secret-expired'
      }).catch(() => false);
    }
    return true;
  }

  taskUnlockCode(secret) {
    if (!secret) throw new Error('task-package-secret-unavailable');
    return Buffer.isBuffer(secret.unlockCode)
      ? secret.unlockCode.toString('utf8')
      : String(secret.unlockCode || '');
  }

  requireTaskPackageContext(context) {
    requireTaskPackageFeature(context);
    const remoteDeviceId = requiredText(context?.peer?.remote?.deviceId, 'sourceDeviceId', 128);
    const current = this.meshService.getPeerContext(remoteDeviceId);
    if (current.mesh.meshId !== context.peer.mesh.meshId
      || current.local.deviceId !== context.peer.local.deviceId
      || current.remote.deviceId !== remoteDeviceId) {
      throw new Error('task-package-peer-context-changed');
    }
    requireCapability(current.remote, 'task.package.receive');
    context.peer.remote = { ...context.peer.remote, ...current.remote };
    return current;
  }

  async createSessionPointerTransfer(input = {}) {
    const targetDeviceId = requiredText(input.targetDeviceId, 'targetDeviceId', 128);
    const peer = this.meshService.getPeerContext(targetDeviceId);
    requireCapability(peer.remote, 'session.pointer.receive');
    const selections = normalizeSelections(input.selections);
    const rows = this.meshService.getUnifiedSessions();
    const transferId = this.randomUUID();
    const pointers = selections.map((selection) => {
      const row = rows.find((item) => item.conversationId === selection.conversationId);
      const replica = row?.replicas?.find((item) => item.replicaId === selection.replicaId);
      if (!replica) throw new Error('session-replica-not-found');
      if (replica.deviceId === targetDeviceId) throw new Error('session-pointer-target-is-source');
      return createSessionPointer({ transferId, replica }, {
        now: this.now(),
        linkKey: peer.secrets.identityLinkKey
      });
    });
    const metadata = secureContext(peer, transferId, 'session-pointer');
    const encryptedPayload = encryptSecurePayload({ pointers }, metadata);
    const bytesTotal = Buffer.byteLength(JSON.stringify(encryptedPayload));
    if (bytesTotal > POINTER_MESSAGE_LIMIT) throw new Error('session-pointer-payload-too-large');
    const createdAt = this.now();
    const job = normalizeTransferJob({
      transferId,
      direction: 'outgoing',
      type: 'session-pointer',
      sourceDeviceId: peer.local.deviceId,
      targetDeviceId,
      state: 'queued',
      itemCount: pointers.length,
      bytesTotal,
      bytesTransferred: 0,
      retryCount: 0,
      createdAt,
      updatedAt: createdAt,
      expiresAt: pointers[0].expiresAt,
      encryptedPayload,
      targetName: peer.remote.name
    });
    this.save(job);
    await this.dispatch(job.transferId);
    return this.publicJob(this.read(job.transferId));
  }

  async createFileTransfer(input = {}) {
    const targetDeviceId = requiredText(input.targetDeviceId, 'targetDeviceId', 128);
    const peer = this.meshService.getPeerContext(targetDeviceId);
    requireCapability(peer.remote, 'file.receive');
    const transferId = this.randomUUID();
    const createdAt = this.now();
    const files = await this.spoolSelectedFiles(transferId, input.filePaths);
    let job;
    try {
      const manifest = createFileManifest({ transferId, files }, { now: createdAt });
      const encryptedPayload = encryptSecurePayload(
        { manifest },
        secureContext(peer, transferId, 'file-manifest')
      );
      job = normalizeTransferJob({
        transferId,
        direction: 'outgoing',
        type: 'file',
        sourceDeviceId: peer.local.deviceId,
        targetDeviceId,
        state: 'queued',
        itemCount: manifest.files.length,
        bytesTotal: manifest.bytesTotal,
        bytesTransferred: 0,
        retryCount: 0,
        createdAt,
        updatedAt: createdAt,
        expiresAt: manifest.expiresAt,
        encryptedPayload,
        targetName: peer.remote.name
      });
      this.save(job);
      await this.dispatch(job.transferId);
      return this.publicJob(this.read(job.transferId));
    } catch (error) {
      this.removeOutgoingSpool(transferId);
      throw error;
    }
  }

  async createTaskPackageTransfer(input = {}) {
    const targetDeviceId = requiredText(input.targetDeviceId, 'targetDeviceId', 128);
    const peer = this.meshService.getPeerContext(targetDeviceId);
    requireCapability(peer.remote, 'task.package.receive');
    const manager = this.peerManagerProvider?.();
    requireDirectTaskPackageConnection(manager, targetDeviceId);
    const taskPackages = this.taskPackageServiceProvider?.();
    if (!taskPackages || typeof taskPackages.exportPackage !== 'function') {
      throw new Error('task-package-service-unavailable');
    }
    const transferId = this.randomUUID();
    ensurePrivateDirectory(this.spoolRoot);
    ensurePrivateDirectory(path.join(this.spoolRoot, 'outgoing'));
    const directory = this.outgoingSpoolDirectory(transferId);
    await fs.promises.mkdir(directory, { mode: 0o700 });
    const destinationPath = this.outgoingSpoolFile(transferId, 0);
    try {
      const exported = await taskPackages.exportPackage({
        ...input,
        transferId,
        destinationPath,
        deliveryMode: 'mesh-direct',
        targetDeviceName: peer.remote.name,
        recordHistory: false
      });
      const stat = await fs.promises.lstat(destinationPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('task-package-spool-invalid');
      ensureDiskSpace(this.spoolRoot, stat.size);
      const packageHash = await hashFile(destinationPath);
      const taskManifest = createTaskPackageTransferManifest({
        transferId,
        packageId: exported.packageId,
        packageHash,
        fileName: safeTaskPackageName(`${exported.packageId}.agentdesk-task`),
        bytesTotal: stat.size,
        summary: taskPackageSummary(exported.manifest)
      }, { now: this.now() });
      const files = [{
        index: 0,
        fileId: exported.packageId,
        name: taskManifest.fileName,
        size: stat.size,
        sha256: packageHash,
        mtimeMs: stat.mtimeMs
      }];
      const fileManifest = createFileManifest({ transferId, files }, {
        now: taskManifest.createdAt,
        expiresAt: taskManifest.expiresAt
      });
      const encryptedPayload = encryptSecurePayload(
        { fileManifest, taskManifest },
        secureContext(peer, transferId, 'task-package-manifest')
      );
      this.setTaskMaterial('outgoing', transferId, {
        packageId: exported.packageId,
        packageHash,
        unlockCode: exported.unlockCode
      }, taskManifest.expiresAt);
      const job = normalizeTransferJob({
        transferId,
        direction: 'outgoing',
        type: 'task-package',
        sourceDeviceId: peer.local.deviceId,
        targetDeviceId,
        state: 'queued',
        itemCount: 1,
        bytesTotal: stat.size,
        bytesTransferred: 0,
        retryCount: 0,
        createdAt: taskManifest.createdAt,
        updatedAt: taskManifest.createdAt,
        expiresAt: taskManifest.expiresAt,
        encryptedPayload,
        targetName: peer.remote.name
      });
      this.save(job);
      taskPackages.tryRecordHistory?.({
        packageId: exported.packageId,
        direction: 'exported',
        deliveryMode: 'mesh-direct',
        state: 'sending',
        createdAt: taskManifest.createdAt,
        title: taskManifest.summary.title,
        sourceAgentName: taskManifest.summary.sourceAgentName,
        targetAgentName: null,
        sourceDeviceName: peer.local.name,
        targetDeviceName: peer.remote.name,
        transferId,
        appId: exported.manifest?.source?.appId || null,
        sessionMode: taskManifest.summary.sessionMode,
        localPath: null,
        bytesTotal: stat.size
      });
      await this.dispatch(transferId);
      return this.publicJob(this.read(transferId));
    } catch (error) {
      this.clearTaskMaterial('outgoing', transferId);
      this.removeOutgoingSpool(transferId);
      throw error;
    }
  }

  async saveTaskPackageFallback(transferId, destinationPath) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'task-package' || job.direction !== 'outgoing') {
      throw new Error('task-package-fallback-not-found');
    }
    if (['completed', 'expired'].includes(job.state)) throw new Error('task-package-fallback-unavailable');
    const secret = this.outgoingTaskSecrets.get(job.transferId);
    if (!secret) throw new Error('task-package-secret-unavailable');
    const manifests = this.taskPackageManifests(job);
    if (secret.packageId !== manifests.taskManifest.packageId
      || secret.packageHash !== manifests.taskManifest.packageHash) {
      throw new Error('task-package-secret-mismatch');
    }
    const sourcePath = this.outgoingSpoolFile(job.transferId, 0);
    await verifyFileHash(
      sourcePath,
      manifests.taskManifest.packageHash,
      manifests.taskManifest.bytesTotal
    );
    const target = portableTaskPackageDestination(destinationPath);
    ensureDiskSpace(path.dirname(target), manifests.taskManifest.bytesTotal);
    const sourceStat = await fs.promises.stat(sourcePath);
    const copied = await copySelectedFile({
      sourcePath,
      size: manifests.taskManifest.bytesTotal,
      mtimeMs: sourceStat.mtimeMs
    }, target);
    if (copied.sha256 !== manifests.taskManifest.packageHash
      || copied.size !== manifests.taskManifest.bytesTotal) {
      await fs.promises.unlink(target).catch(() => false);
      throw new Error('task-package-fallback-copy-mismatch');
    }
    const unlockCode = this.taskUnlockCode(secret);
    this.taskPackageServiceProvider?.()?.tryRecordHistory?.({
      packageId: manifests.taskManifest.packageId,
      direction: 'exported',
      deliveryMode: 'portable-file',
      state: 'ready',
      createdAt: manifests.taskManifest.createdAt,
      title: manifests.taskManifest.summary.title,
      sourceAgentName: manifests.taskManifest.summary.sourceAgentName,
      targetAgentName: null,
      sourceDeviceName: localDeviceName(this.meshService.getOverview()),
      targetDeviceName: job.targetName,
      transferId: job.transferId,
      appId: manifests.taskManifest.summary.appId || null,
      sessionMode: manifests.taskManifest.summary.sessionMode,
      localPath: target,
      bytesTotal: manifests.taskManifest.bytesTotal
    });
    const cancelled = this.update(job, {
      state: 'cancelled',
      lastError: 'task-package-portable-fallback-saved'
    });
    this.rejectTransferAcks(job.transferId, new Error('task-package-portable-fallback-saved'));
    this.clearTaskMaterial('outgoing', job.transferId);
    void this.sendChunkSemantic(cancelled, 'cancel', {
      transferId: job.transferId,
      reasonCode: 'task-package-portable-fallback-saved'
    }).catch(() => false);
    this.cleanupOutgoingSpoolWhenIdle(job.transferId);
    return {
      packageId: manifests.taskManifest.packageId,
      transferId: job.transferId,
      savedPath: target,
      unlockCode
    };
  }

  async dispatch(transferId) {
    if (this.stopped) throw new Error('transfer-service-stopped');
    if (this.inFlight.has(transferId)) return this.read(transferId);
    const job = this.read(transferId);
    if (!job || job.direction !== 'outgoing') return job;
    if (['completed', 'cancelled', 'expired'].includes(job.state)) return job;
    if (Date.parse(job.expiresAt) <= Date.now()) return this.expire(job);
    const manager = this.peerManagerProvider?.();
    const connected = manager?.listConnections().some((item) => (
      item.deviceId === job.targetDeviceId && item.authenticated
    ));
    if (!connected) return this.update(job, { state: 'queued', lastError: null });

    if (job.type === 'file') return this.dispatchFileOffer(job, manager);
    if (job.type === 'task-package') return this.dispatchTaskPackageOffer(job, manager);

    this.inFlight.add(transferId);
    try {
      const sending = this.update(job, {
        state: 'sending',
        retryCount: job.retryCount + 1,
        lastError: null
      });
      await manager.sendSemantic(job.targetDeviceId, 'session.pointer.offer', 'session.pointer.receive', {
        transferId: job.transferId,
        encryptedPayload: job.encryptedPayload
      });
      const latest = this.read(job.transferId) || sending;
      if (['completed', 'cancelled', 'expired'].includes(latest.state)) return latest;
      return this.update(latest, {
        state: 'awaiting-ack',
        bytesTransferred: job.bytesTotal
      });
    } catch (error) {
      return this.update(this.read(job.transferId) || job, {
        state: 'failed',
        lastError: safeError(error)
      });
    } finally {
      this.inFlight.delete(transferId);
    }
  }

  async flushDevice(deviceId) {
    const jobs = this.listRaw().filter((job) => (
      job.direction === 'outgoing'
      && job.targetDeviceId === String(deviceId || '')
      && (['queued', 'failed', 'awaiting-ack'].includes(job.state)
        || (isChunkedTransfer(job) && ['awaiting-accept', 'sending'].includes(job.state)))
    ));
    for (const job of jobs) await this.dispatch(job.transferId);
    const incoming = this.listRaw().filter((job) => (
      isChunkedTransfer(job)
      && job.direction === 'incoming'
      && job.sourceDeviceId === String(deviceId || '')
      && job.state === 'receiving'
    ));
    for (const job of incoming) await this.sendFileAccept(job).catch(() => false);
    return jobs.length + incoming.length;
  }

  async handleEnvelope({ context, envelope }) {
    if (this.stopped) throw new Error('transfer-service-stopped');
    if (String(envelope?.messageType || '').startsWith('task.package.')) {
      this.requireTaskPackageContext(context);
    }
    if (envelope.messageType === 'session.pointer.offer') {
      return this.receiveSessionPointers(context, envelope.payload);
    }
    if (envelope.messageType === 'session.pointer.ack') {
      return this.receiveSessionPointerAck(context, envelope.payload);
    }
    if (envelope.messageType === 'file.offer') return this.receiveFileOffer(context, envelope.payload);
    if (envelope.messageType === 'file.accept') return this.receiveFileAccept(context, envelope.payload);
    if (envelope.messageType === 'file.chunk') return this.receiveFileChunk(context, envelope.payload);
    if (envelope.messageType === 'file.chunk.ack') return this.receiveFileChunkAck(context, envelope.payload);
    if (envelope.messageType === 'file.complete') return this.receiveFileComplete(context, envelope.payload);
    if (envelope.messageType === 'file.cancel') return this.receiveFileCancel(context, envelope.payload);
    if (envelope.messageType === 'file.error') return this.receiveFileError(context, envelope.payload);
    if (envelope.messageType === 'task.package.offer') return this.receiveTaskPackageOffer(context, envelope.payload);
    if (envelope.messageType === 'task.package.accept') return this.receiveFileAccept(context, envelope.payload);
    if (envelope.messageType === 'task.package.chunk') return this.receiveFileChunk(context, envelope.payload);
    if (envelope.messageType === 'task.package.chunk.ack') return this.receiveFileChunkAck(context, envelope.payload);
    if (envelope.messageType === 'task.package.complete') return this.receiveFileComplete(context, envelope.payload);
    if (envelope.messageType === 'task.package.cancel') return this.receiveFileCancel(context, envelope.payload);
    if (envelope.messageType === 'task.package.error') return this.receiveFileError(context, envelope.payload);
    return false;
  }

  async receiveSessionPointers(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const metadata = secureContext(context.peer, transferId, 'session-pointer', { incoming: true });
    const decrypted = decryptSecurePayload(payload.encryptedPayload, metadata);
    const pointers = normalizeSessionPointers(decrypted.pointers);
    if (pointers.some((pointer) => pointer.transferId !== transferId)) {
      throw new Error('session-pointer-transfer-mismatch');
    }
    if (pointers.some((pointer) => Date.parse(pointer.expiresAt) <= Date.parse(this.now()))) {
      throw new Error('session-pointer-expired');
    }
    const existing = this.read(transferId);
    if (existing && (existing.direction !== 'incoming' || existing.sourceDeviceId !== context.peer.remote.deviceId)) {
      throw new Error('transfer-id-conflict');
    }
    const now = this.now();
    const job = normalizeTransferJob({
      transferId,
      direction: 'incoming',
      type: 'session-pointer',
      sourceDeviceId: context.peer.remote.deviceId,
      targetDeviceId: context.peer.local.deviceId,
      state: 'received',
      itemCount: pointers.length,
      bytesTotal: Buffer.byteLength(JSON.stringify(payload.encryptedPayload)),
      bytesTransferred: Buffer.byteLength(JSON.stringify(payload.encryptedPayload)),
      retryCount: existing?.retryCount || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: pointers.reduce((earliest, pointer) => (
        Date.parse(pointer.expiresAt) < Date.parse(earliest) ? pointer.expiresAt : earliest
      ), pointers[0].expiresAt),
      encryptedPayload: payload.encryptedPayload,
      receivedFromName: context.peer.remote.name
    });
    this.save(job);
    await this.peerManagerProvider().sendSemantic(
      context.peer.remote.deviceId,
      'session.pointer.ack',
      'session.pointer.receive',
      { transferId, accepted: true }
    );
    return true;
  }

  receiveSessionPointerAck(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || job.direction !== 'outgoing' || job.targetDeviceId !== context.peer.remote.deviceId) {
      throw new Error('transfer-ack-unexpected');
    }
    if (payload.accepted !== true) return this.update(job, { state: 'failed', lastError: 'transfer-rejected' });
    this.update(job, {
      state: 'completed',
      bytesTransferred: job.bytesTotal,
      lastError: null
    });
    return true;
  }

  async dispatchFileOffer(job, manager) {
    if (this.inFlight.has(job.transferId)) return this.read(job.transferId);
    const manifest = this.fileManifest(job);
    this.assertOutgoingSpool(job.transferId, manifest);
    this.inFlight.add(job.transferId);
    try {
      const sending = this.update(job, {
        state: 'sending',
        retryCount: job.retryCount + 1,
        lastError: null
      });
      this.update(sending, { state: 'awaiting-accept' });
      await manager.sendSemantic(job.targetDeviceId, 'file.offer', 'file.receive', {
        transferId: job.transferId,
        encryptedManifest: job.encryptedPayload
      });
      return this.read(job.transferId);
    } catch (error) {
      return this.update(this.read(job.transferId) || job, {
        state: 'failed',
        lastError: safeError(error)
      });
    } finally {
      this.inFlight.delete(job.transferId);
    }
  }

  async dispatchTaskPackageOffer(job, manager) {
    if (this.inFlight.has(job.transferId)) return this.read(job.transferId);
    requireDirectTaskPackageConnection(manager, job.targetDeviceId);
    const peer = this.meshService.getPeerContext(job.targetDeviceId);
    requireCapability(peer.remote, 'task.package.receive');
    const manifests = this.taskPackageManifests(job);
    const secret = this.outgoingTaskSecrets.get(job.transferId);
    if (!secret || secret.packageId !== manifests.taskManifest.packageId
      || secret.packageHash !== manifests.taskManifest.packageHash) {
      return this.update(job, { state: 'failed', lastError: 'task-package-secret-unavailable' });
    }
    this.assertOutgoingSpool(job.transferId, manifests.fileManifest);
    const unlockEnvelope = sealTaskPackageUnlockCode({
      packageId: secret.packageId,
      packageHash: secret.packageHash,
      unlockCode: this.taskUnlockCode(secret)
    }, taskPackageUnlockSealContext(peer, job.transferId));
    this.inFlight.add(job.transferId);
    try {
      const sending = this.update(job, {
        state: 'sending',
        retryCount: job.retryCount + 1,
        lastError: null
      });
      this.update(sending, { state: 'awaiting-accept' });
      await manager.sendSemantic(job.targetDeviceId, 'task.package.offer', 'task.package.receive', {
        transferId: job.transferId,
        encryptedManifest: job.encryptedPayload,
        unlockEnvelope
      });
      return this.read(job.transferId);
    } catch (error) {
      const failed = this.update(this.read(job.transferId) || job, {
        state: 'failed',
        lastError: safeError(error)
      });
      this.recordTaskPackageTransferHistory(failed, 'failed');
      return failed;
    } finally {
      this.inFlight.delete(job.transferId);
    }
  }

  async receiveTaskPackageOffer(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const peer = this.requireTaskPackageContext(context);
    const manifests = decryptTaskPackageManifests(
      payload.encryptedManifest,
      secureContext(peer, transferId, 'task-package-manifest', { incoming: true }),
      { now: this.now() }
    );
    if (manifests.taskManifest.transferId !== transferId
      || manifests.fileManifest.transferId !== transferId) {
      throw new Error('task-package-transfer-mismatch');
    }
    if (Date.parse(manifests.taskManifest.expiresAt) <= Date.parse(this.now())) {
      throw new Error('task-package-transfer-expired');
    }
    const existing = this.read(transferId);
    if (existing && (existing.type !== 'task-package' || existing.direction !== 'incoming'
      || existing.sourceDeviceId !== peer.remote.deviceId)) {
      throw new Error('transfer-id-conflict');
    }
    if (existing) {
      const previous = this.taskPackageManifests(existing);
      if (!sameTaskPackageManifests(previous, manifests)) {
        throw new Error('task-package-manifest-conflict');
      }
    }
    const deliveryIdentity = taskPackageDeliveryIdentity(peer, manifests);
    const taskPackages = this.taskPackageServiceProvider?.();
    if (taskPackages?.hasConsumedTransfer?.(deliveryIdentity)
      || taskPackages?.hasActiveImportTransfer?.(deliveryIdentity)) {
      if (existing && existing.state !== 'completed') {
        this.update(existing, {
          state: 'completed',
          bytesTransferred: manifests.fileManifest.bytesTotal,
          lastError: null
        });
      }
      const acknowledged = this.read(transferId) || existing || {
        ...normalizeTransferJob({
          transferId,
          direction: 'incoming',
          type: 'task-package',
          sourceDeviceId: peer.remote.deviceId,
          targetDeviceId: peer.local.deviceId,
          state: 'completed',
          itemCount: 1,
          bytesTotal: manifests.fileManifest.bytesTotal,
          bytesTransferred: manifests.fileManifest.bytesTotal,
          retryCount: 0,
          createdAt: manifests.taskManifest.createdAt,
          updatedAt: this.now(),
          expiresAt: manifests.taskManifest.expiresAt,
          encryptedPayload: payload.encryptedManifest,
          receivedFromName: peer.remote.name
        })
      };
      await this.sendChunkSemantic(acknowledged, 'complete', { transferId });
      return true;
    }
    let state = 'received';
    let bytesTransferred = 0;
    let lastError = null;
    let retainEnvelope = true;
    if (existing && ['cancelled', 'expired'].includes(existing.state)) {
      state = existing.state;
      bytesTransferred = existing.bytesTransferred;
    } else if (existing?.state === 'completed') {
      if (await this.verifyIncomingTaskPackageSnapshot(existing, manifests)) {
        state = 'completed';
        bytesTransferred = manifests.fileManifest.bytesTotal;
      } else {
        this.removeIncomingTaskSpool(existing);
        state = 'failed';
        lastError = 'task-package-received-file-missing';
        retainEnvelope = false;
      }
    } else if (existing && ['receiving', 'failed'].includes(existing.state)) {
      try {
        const local = this.readFileLocalState(existing);
        if (local) {
          state = local.completed ? 'completed' : 'receiving';
          bytesTransferred = local.completed
            ? manifests.fileManifest.bytesTotal
            : await this.incomingBytes(existing, manifests.fileManifest, local);
          if (local.completed && !(await this.verifyIncomingTaskPackageSnapshot(existing, manifests))) {
            this.removeIncomingTaskSpool(existing);
            state = 'received';
            bytesTransferred = 0;
          }
        }
      } catch (_error) {
        this.removeIncomingTaskSpool(existing);
        state = 'received';
        bytesTransferred = 0;
      }
    }
    if (retainEnvelope && !['cancelled', 'expired'].includes(state)) {
      this.setTaskMaterial('envelope', transferId, payload.unlockEnvelope, manifests.taskManifest.expiresAt);
    } else {
      this.clearTaskMaterial('envelope', transferId);
    }
    const now = this.now();
    const job = this.save(normalizeTransferJob({
      transferId,
      direction: 'incoming',
      type: 'task-package',
      sourceDeviceId: peer.remote.deviceId,
      targetDeviceId: peer.local.deviceId,
      state,
      itemCount: 1,
      bytesTotal: manifests.fileManifest.bytesTotal,
      bytesTransferred,
      retryCount: existing?.retryCount || 0,
      createdAt: existing?.createdAt || manifests.taskManifest.createdAt,
      updatedAt: now,
      expiresAt: manifests.taskManifest.expiresAt,
      encryptedPayload: payload.encryptedManifest,
      receivedFromName: peer.remote.name,
      lastError
    }));
    if (job.state === 'cancelled' || job.state === 'expired') {
      await this.sendChunkSemantic(job, 'cancel', { transferId });
    } else if (job.state === 'receiving') {
      await this.sendFileAccept(job);
    } else if (job.state === 'completed') {
      await this.sendChunkSemantic(job, 'complete', { transferId });
    } else if (job.lastError === 'task-package-received-file-missing') {
      await this.sendChunkSemantic(job, 'error', {
        transferId,
        reasonCode: job.lastError
      }).catch(() => false);
    }
    return true;
  }

  async verifyIncomingTaskPackageSnapshot(job, manifests = this.taskPackageManifests(job)) {
    try {
      const local = this.readFileLocalState(job);
      const packagePath = local?.completed === true ? local.finalPaths?.[0] : null;
      if (!packagePath || !isRegularFile(packagePath)) return false;
      await verifyFileHash(
        packagePath,
        manifests.taskManifest.packageHash,
        manifests.taskManifest.bytesTotal
      );
      return true;
    } catch (_error) {
      return false;
    }
  }

  async acceptTaskPackageTransfer(transferId) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'task-package' || job.direction !== 'incoming') {
      throw new Error('task-package-transfer-not-found');
    }
    if (!['received', 'failed', 'receiving'].includes(job.state)) {
      throw new Error('task-package-transfer-cannot-accept');
    }
    if (Date.parse(job.expiresAt) <= Date.parse(this.now())) throw new Error('task-package-transfer-expired');
    this.requireTaskPackageImportAuthorization(job);
    if (!this.pendingTaskEnvelopes.has(job.transferId)
      && !this.incomingTaskSecrets.has(job.transferId)) {
      throw new Error('task-package-secret-unavailable');
    }
    ensurePrivateDirectory(this.spoolRoot);
    const root = path.join(this.spoolRoot, 'task-packages');
    ensurePrivateDirectory(root);
    const manifest = this.fileManifest(job);
    await this.prepareIncomingDestination(job, manifest, root);
    const receiving = this.update(job, { state: 'receiving', lastError: null });
    await this.sendFileAccept(receiving);
    return this.publicJob(this.read(job.transferId));
  }

  rejectTaskPackageTransfer(transferId) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'task-package' || job.direction !== 'incoming') {
      throw new Error('task-package-transfer-not-found');
    }
    if (!['received', 'failed', 'receiving'].includes(job.state)) {
      throw new Error('task-package-transfer-cannot-reject');
    }
    const cancelled = this.update(job, { state: 'cancelled', lastError: 'task-package-rejected' });
    this.clearTaskMaterial('envelope', job.transferId);
    this.clearTaskMaterial('incoming', job.transferId);
    this.removeIncomingTaskSpool(job);
    void this.sendChunkSemantic(job, 'cancel', {
      transferId: job.transferId,
      reasonCode: 'task-package-rejected'
    }).catch(() => false);
    return this.publicJob(cancelled);
  }

  async prepareTaskPackageImport(transferId) {
    let job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'task-package' || job.direction !== 'incoming' || job.state !== 'completed') {
      throw new Error('task-package-transfer-not-completed');
    }
    let draft = null;
    let packagePath = null;
    let taskPackages = null;
    try {
      this.requireTaskPackageImportAuthorization(job);
      if (!(await this.verifyIncomingTaskPackageSnapshot(job))) {
        throw new Error('task-package-received-file-invalid');
      }
      const secret = await this.restoreIncomingTaskSecret(job);
      const local = this.readFileLocalState(job);
      packagePath = local?.finalPaths?.[0];
      if (!packagePath || !isRegularFile(packagePath)) throw new Error('task-package-received-file-missing');
      taskPackages = this.taskPackageServiceProvider?.();
      if (!taskPackages) throw new Error('task-package-service-unavailable');
      const manifests = this.taskPackageManifests(job);
      const peer = this.meshService.getPeerContext(job.sourceDeviceId);
      draft = taskPackages.createImportDraft(packagePath);
      taskPackages.attachImportDelivery?.(draft.token, {
        deliveryMode: 'mesh-direct',
        meshId: peer.mesh.meshId,
        transferId: job.transferId,
        packageId: manifests.taskManifest.packageId,
        packageHash: manifests.taskManifest.packageHash,
        sourceDeviceId: job.sourceDeviceId,
        sourceDeviceName: job.receivedFromName,
        targetDeviceId: job.targetDeviceId,
        targetDeviceName: localDeviceName(this.meshService.getOverview())
      });
      const inspected = await taskPackages.inspectImportWithUnlockCode(
        draft.token,
        this.taskUnlockCode(secret)
      );
      job = this.read(job.transferId) || job;
      this.requireTaskPackageImportAuthorization(job);
      if (job.state !== 'completed' || this.incomingTaskSecrets.get(job.transferId) !== secret) {
        throw new Error('task-package-import-expired');
      }
      this.clearAllTaskMaterial(job.transferId);
      this.removeIncomingTaskSpool(job, [packagePath]);
      return { draft, inspected };
    } catch (error) {
      if (draft?.token) taskPackages?.cancelImport?.(draft.token);
      this.clearAllTaskMaterial(job.transferId);
      this.removeIncomingTaskSpool(job, [packagePath]);
      const latest = this.read(job.transferId) || job;
      if (!['cancelled', 'expired'].includes(latest.state)) {
        this.update(latest, { state: 'failed', lastError: safeError(error) });
      }
      throw error;
    }
  }

  async restoreIncomingTaskSecret(job) {
    if (job.state !== 'completed' || !(await this.verifyIncomingTaskPackageSnapshot(job))) {
      throw new Error('task-package-ciphertext-not-verified');
    }
    const peer = this.requireTaskPackageImportAuthorization(job);
    if (this.incomingTaskSecrets.has(job.transferId)) return this.incomingTaskSecrets.get(job.transferId);
    const envelope = this.pendingTaskEnvelopes.get(job.transferId);
    if (!envelope) throw new Error('task-package-secret-unavailable');
    const taskManifest = this.taskPackageManifests(job).taskManifest;
    const unlockCode = openTaskPackageUnlockCode(
      envelope,
      taskManifest,
      taskPackageUnlockOpenContext(peer, job.transferId, this.now())
    );
    const secret = {
      packageId: taskManifest.packageId,
      packageHash: taskManifest.packageHash,
      unlockCode
    };
    this.clearTaskMaterial('envelope', job.transferId);
    return this.setTaskMaterial('incoming', job.transferId, secret, taskManifest.expiresAt);
  }

  requireTaskPackageImportAuthorization(job) {
    const peer = this.meshService.getPeerContext(job.sourceDeviceId);
    requireCapability(peer.remote, 'task.package.receive');
    requireDirectTaskPackageConnection(this.peerManagerProvider?.(), job.sourceDeviceId);
    return peer;
  }

  async receiveFileOffer(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const peer = context.peer;
    const manifest = decryptFileManifest(
      payload.encryptedManifest,
      secureContext(peer, transferId, 'file-manifest', { incoming: true })
    );
    if (manifest.transferId !== transferId) throw new Error('file-transfer-mismatch');
    if (Date.parse(manifest.expiresAt) <= Date.parse(this.now())) throw new Error('file-transfer-expired');
    const existing = this.read(transferId);
    if (existing && (existing.type !== 'file' || existing.direction !== 'incoming'
      || existing.sourceDeviceId !== peer.remote.deviceId)) {
      throw new Error('transfer-id-conflict');
    }
    const state = existing && ['receiving', 'completed', 'cancelled', 'expired'].includes(existing.state)
      ? existing.state
      : 'received';
    const now = this.now();
    const job = this.save(normalizeTransferJob({
      transferId,
      direction: 'incoming',
      type: 'file',
      sourceDeviceId: peer.remote.deviceId,
      targetDeviceId: peer.local.deviceId,
      state,
      itemCount: manifest.files.length,
      bytesTotal: manifest.bytesTotal,
      bytesTransferred: existing?.bytesTransferred || 0,
      retryCount: existing?.retryCount || 0,
      createdAt: existing?.createdAt || manifest.createdAt,
      updatedAt: now,
      expiresAt: manifest.expiresAt,
      encryptedPayload: payload.encryptedManifest,
      receivedFromName: peer.remote.name,
      lastError: null
    }));
    if (job.state === 'completed') {
      await this.sendChunkSemantic(job, 'complete', { transferId });
    } else if (job.state === 'cancelled' || job.state === 'expired') {
      await this.sendChunkSemantic(job, 'cancel', { transferId });
    } else if (job.state === 'receiving') {
      await this.sendFileAccept(job);
    }
    return true;
  }

  async acceptFileTransfer(transferId, destinationRoot) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'file' || job.direction !== 'incoming') throw new Error('file-transfer-not-found');
    if (!['received', 'failed', 'receiving'].includes(job.state)) throw new Error('file-transfer-cannot-accept');
    if (Date.parse(job.expiresAt) <= Date.parse(this.now())) throw new Error('file-transfer-expired');
    const peer = this.meshService.getPeerContext(job.sourceDeviceId);
    requireCapability(peer.remote, 'file.receive');
    const manifest = this.fileManifest(job);
    await this.prepareIncomingDestination(job, manifest, destinationRoot);
    const receiving = this.update(job, { state: 'receiving', lastError: null });
    await this.sendFileAccept(receiving);
    return this.publicJob(this.read(job.transferId));
  }

  async sendFileAccept(job) {
    const manifest = this.fileManifest(job);
    const local = this.readFileLocalState(job);
    if (!local) throw new Error('file-destination-required');
    await this.ensureZeroLengthParts(job, manifest, local);
    if (await this.completeIncomingIfReady(job, manifest, local)) return true;
    const offsets = await this.incomingOffsets(job, manifest, local);
    const connected = this.peerManagerProvider?.().listConnections().some((item) => (
      item.deviceId === job.sourceDeviceId && item.authenticated
    ));
    if (!connected) return false;
    await this.sendChunkSemantic(job, 'accept', {
      transferId: job.transferId,
      offsets
    });
    return true;
  }

  receiveFileAccept(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job) || job.direction !== 'outgoing'
      || job.targetDeviceId !== context.peer.remote.deviceId) {
      throw new Error('file-accept-unexpected');
    }
    if (job.state === 'completed') {
      void this.sendChunkSemantic(job, 'complete', { transferId }).catch(() => false);
      return true;
    }
    if (['cancelled', 'expired'].includes(job.state)) {
      void this.sendChunkSemantic(job, 'cancel', { transferId }).catch(() => false);
      return true;
    }
    const manifest = this.fileManifest(job);
    const offsets = normalizeResumeOffsets(payload.offsets, manifest);
    const active = this.activeFileSends.get(transferId);
    if (active) {
      this.rejectTransferAcks(transferId, new Error('file-resume-replaced'));
      void active.finally(() => this.receiveFileAccept(context, payload)).catch(() => false);
      return true;
    }
    const task = this.sendFileChunks(job, manifest, offsets)
      .catch(async (error) => {
        const latest = this.read(transferId);
        if (!latest || ['completed', 'cancelled', 'expired'].includes(latest.state)
          || error?.message === 'file-resume-replaced') return;
        const reasonCode = safeError(error);
        const failed = this.update(latest, { state: 'failed', lastError: reasonCode });
        if (job.type === 'task-package') this.recordTaskPackageTransferHistory(failed, 'failed');
        await this.sendChunkSemantic(job, 'error', { transferId, reasonCode })
          .catch(() => false);
      })
      .finally(() => this.activeFileSends.delete(transferId));
    this.activeFileSends.set(transferId, task);
    return true;
  }

  async sendFileChunks(job, manifest, offsets) {
    this.assertOutgoingSpool(job.transferId, manifest);
    for (const file of manifest.files) {
      await verifyFileHash(this.outgoingSpoolFile(job.transferId, file.index), file.sha256, file.size);
    }
    let bytesTransferred = offsets.reduce((sum, item) => sum + item.offset, 0);
    this.update(this.read(job.transferId) || job, {
      state: 'sending',
      bytesTransferred,
      lastError: null
    });
    const peer = this.meshService.getPeerContext(job.targetDeviceId);
    for (const file of manifest.files) {
      let offset = offsets[file.index].offset;
      const handle = await openRegularFile(this.outgoingSpoolFile(job.transferId, file.index));
      try {
        while (offset < file.size) {
          if (this.stopped) throw new Error('transfer-service-stopped');
          const latest = this.read(job.transferId);
          if (!latest || ['cancelled', 'expired', 'completed'].includes(latest.state)) return latest;
          const length = Math.min(FILE_CHUNK_BYTES, file.size - offset);
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          if (bytesRead !== length) throw new Error('file-source-short-read');
          const bytes = buffer.subarray(0, bytesRead);
          const encryptedChunk = encryptSecurePayload({
            bytes: bytes.toString('base64'),
            sha256: sha256(bytes)
          }, secureContext(peer, job.transferId, chunkPayloadType(job, file.index, offset)));
          const ackKey = fileAckKey(job.transferId, file.index, offset);
          const ack = timedDeferred(FILE_ACK_TIMEOUT_MS, 'file-chunk-ack-timeout');
          this.pendingChunkAcks.set(ackKey, ack);
          try {
            await this.sendChunkSemantic(job, 'chunk', {
              transferId: job.transferId,
              fileIndex: file.index,
              offset,
              encryptedChunk
            });
            const nextOffset = await ack.promise;
            if (nextOffset !== offset + bytesRead) throw new Error('file-chunk-ack-offset');
          } finally {
            this.pendingChunkAcks.delete(ackKey);
            ack.cancel();
          }
          offset += bytesRead;
          bytesTransferred += bytesRead;
          const acknowledged = this.read(job.transferId) || job;
          if (['completed', 'cancelled', 'expired'].includes(acknowledged.state)) return acknowledged;
          this.updateProgress(acknowledged, {
            state: 'sending',
            bytesTransferred: Math.min(manifest.bytesTotal, bytesTransferred)
          });
        }
      } finally {
        await handle.close();
      }
    }
    const latest = this.read(job.transferId);
    if (latest && !['completed', 'cancelled', 'expired'].includes(latest.state)) {
      this.update(latest, { state: 'awaiting-ack', bytesTransferred: manifest.bytesTotal });
    }
    return this.read(job.transferId);
  }

  async receiveFileChunk(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job) || job.direction !== 'incoming'
      || job.sourceDeviceId !== context.peer.remote.deviceId) {
      throw new Error('file-chunk-unexpected');
    }
    if (job.state === 'completed') {
      await this.sendChunkSemantic(job, 'complete', { transferId });
      return true;
    }
    if (job.state !== 'receiving') throw new Error('file-chunk-not-accepted');
    try {
      const manifest = this.fileManifest(job);
      const fileIndex = boundedInteger(payload.fileIndex, 0, manifest.files.length - 1, 'file-index');
      const offset = boundedInteger(payload.offset, 0, manifest.files[fileIndex].size, 'file-offset');
      const decrypted = decryptSecurePayload(
        payload.encryptedChunk,
        secureContext(context.peer, transferId, chunkPayloadType(job, fileIndex, offset), { incoming: true })
      );
      const bytes = decodeBase64(decrypted.bytes);
      if (!bytes.length || bytes.length > FILE_CHUNK_BYTES) throw new Error('file-chunk-size');
      if (sha256(bytes) !== String(decrypted.sha256 || '')) throw new Error('file-chunk-hash');
      const file = manifest.files[fileIndex];
      if (offset + bytes.length > file.size) throw new Error('file-chunk-overflow');
      const local = this.readFileLocalState(job);
      if (!local) throw new Error('file-destination-required');
      const nextOffset = await this.writeIncomingChunk(job, manifest, local, file, offset, bytes);
      const bytesTransferred = await this.incomingBytes(job, manifest, local);
      this.updateProgress(this.read(transferId) || job, {
        state: 'receiving',
        bytesTransferred,
        lastError: null
      });
      await this.sendChunkSemantic(job, 'chunk.ack', {
        transferId,
        fileIndex,
        offset,
        nextOffset
      });
      await this.completeIncomingIfReady(this.read(transferId), manifest, local);
      return true;
    } catch (error) {
      const latest = this.read(transferId);
      if (latest && !['completed', 'cancelled'].includes(latest.state)) {
        this.update(latest, { state: 'failed', lastError: safeError(error) });
      }
      if (job.type === 'task-package') {
        this.clearTaskMaterial('envelope', transferId);
        this.clearTaskMaterial('incoming', transferId);
        this.removeIncomingTaskSpool(latest || job);
      }
      await this.sendChunkSemantic(job, 'error', {
        transferId,
        reasonCode: safeError(error)
      }).catch(() => false);
      return true;
    }
  }

  receiveFileChunkAck(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job) || job.direction !== 'outgoing'
      || job.targetDeviceId !== context.peer.remote.deviceId) {
      throw new Error('file-chunk-ack-unexpected');
    }
    const fileIndex = boundedInteger(payload.fileIndex, 0, MAX_FILE_COUNT - 1, 'file-index');
    const offset = boundedInteger(payload.offset, 0, MAX_FILE_TRANSFER_BYTES, 'file-offset');
    const nextOffset = boundedInteger(payload.nextOffset, offset, MAX_FILE_TRANSFER_BYTES, 'file-next-offset');
    this.pendingChunkAcks.get(fileAckKey(transferId, fileIndex, offset))?.resolve(nextOffset);
    return true;
  }

  receiveFileComplete(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job) || job.direction !== 'outgoing'
      || job.targetDeviceId !== context.peer.remote.deviceId) {
      throw new Error('file-complete-unexpected');
    }
    if (['cancelled', 'expired'].includes(job.state)) return true;
    if (job.state === 'completed') return true;
    if (job.type === 'task-package'
      && (job.state !== 'awaiting-ack' || job.bytesTransferred !== job.bytesTotal)) {
      const active = this.activeFileSends.get(transferId);
      if (active) {
        void active.then(() => this.receiveFileComplete(context, payload)).catch(() => false);
        return true;
      }
      throw new Error('task-package-complete-before-ciphertext-sent');
    }
    this.update(job, { state: 'completed', bytesTransferred: job.bytesTotal, lastError: null });
    this.rejectTransferAcks(transferId, new Error('file-transfer-completed'));
    this.cleanupOutgoingSpoolWhenIdle(transferId);
    if (job.type === 'task-package') {
      this.clearTaskMaterial('outgoing', transferId);
      this.recordTaskPackageTransferHistory(job, 'delivered');
    }
    return true;
  }

  receiveFileCancel(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job)) throw new Error('file-cancel-unexpected');
    const expected = job.direction === 'outgoing' ? job.targetDeviceId : job.sourceDeviceId;
    if (expected !== context.peer.remote.deviceId) throw new Error('file-cancel-device');
    if (['completed', 'cancelled', 'expired'].includes(job.state)) return true;
    const reasonCode = cleanReasonCode(payload.reasonCode);
    if (job.type === 'task-package' && job.direction === 'outgoing'
      && reasonCode === 'task-package-rejected') {
      const rejected = this.update(job, { state: 'failed', lastError: reasonCode });
      this.rejectTransferAcks(transferId, new Error(reasonCode));
      this.recordTaskPackageTransferHistory(rejected, 'rejected');
      return true;
    }
    const remotelyExpired = job.type === 'task-package'
      && reasonCode === 'task-package-secret-expired';
    const stopped = this.update(job, {
      state: remotelyExpired ? 'expired' : 'cancelled',
      lastError: reasonCode
    });
    this.rejectTransferAcks(transferId, new Error('file-transfer-cancelled'));
    if (job.direction === 'outgoing') this.cleanupOutgoingSpoolWhenIdle(transferId);
    if (job.type === 'task-package') {
      this.clearAllTaskMaterial(transferId);
      if (job.direction === 'incoming') this.removeIncomingTaskSpool(job);
      if (job.direction === 'outgoing') {
        this.recordTaskPackageTransferHistory(stopped, remotelyExpired ? 'expired' : 'cancelled');
      }
    }
    // Receiver `.part` files remain isolated and recoverable; completed user
    // files are never removed by a remote cancellation.
    return true;
  }

  receiveFileError(context, payload = {}) {
    const transferId = requiredText(payload.transferId, 'transferId', 128);
    const job = this.read(transferId);
    if (!job || !isChunkedTransfer(job)) throw new Error('file-error-unexpected');
    const expected = job.direction === 'outgoing' ? job.targetDeviceId : job.sourceDeviceId;
    if (expected !== context.peer.remote.deviceId) throw new Error('file-error-device');
    if (['completed', 'cancelled', 'expired'].includes(job.state)) return true;
    const failed = this.update(job, {
      state: 'failed',
      lastError: safeError(payload.reasonCode || 'file-transfer-failed')
    });
    this.rejectTransferAcks(transferId, new Error('file-transfer-failed'));
    if (job.type === 'task-package') {
      if (job.direction === 'incoming') {
        this.clearTaskMaterial('envelope', transferId);
        this.clearTaskMaterial('incoming', transferId);
        this.removeIncomingTaskSpool(job);
      } else {
        this.recordTaskPackageTransferHistory(failed, 'failed');
      }
    }
    return true;
  }

  list() {
    return this.listRaw().map((job) => this.publicJob(job));
  }

  publicJob(job) {
    const result = publicTransferJob(job);
    if (isChunkedTransfer(job)) {
      try {
        const manifest = this.fileManifest(job);
        result.files = manifest.files.map((file) => ({ name: file.name, size: file.size }));
        result.acceptRequired = job.direction === 'incoming' && job.state === 'received';
        if (job.type === 'file') {
          result.canOpen = job.direction === 'incoming' && job.state === 'completed'
            && Boolean(this.readFileLocalState(job)?.completed);
        } else {
          const taskManifest = this.taskPackageManifests(job).taskManifest;
          result.taskPackage = taskManifest.summary;
          result.packageId = taskManifest.packageId;
          const secretAvailable = job.direction === 'outgoing'
            ? this.outgoingTaskSecrets.has(job.transferId)
            : (this.incomingTaskSecrets.has(job.transferId)
              || this.pendingTaskEnvelopes.has(job.transferId));
          result.canImport = job.direction === 'incoming' && job.state === 'completed'
            && Boolean(this.readFileLocalState(job)?.completed)
            && (this.incomingTaskSecrets.has(job.transferId)
              || this.pendingTaskEnvelopes.has(job.transferId));
          result.canSavePortable = job.direction === 'outgoing'
            && !['completed', 'cancelled', 'expired'].includes(job.state)
            && this.outgoingTaskSecrets.has(job.transferId)
            && isRegularFile(this.outgoingSpoolFile(job.transferId, 0));
          result.secretUnavailable = !secretAvailable;
          result.requiresNewPackage = !secretAvailable && !result.canSavePortable
            && !['cancelled', 'expired'].includes(job.state);
        }
      } catch (error) {
        result.payloadError = safeError(error);
      }
      return result;
    }
    if (job.type !== 'session-pointer' || job.direction !== 'incoming') return result;
    try {
      const peer = this.meshService.getPeerContext(job.sourceDeviceId);
      const decrypted = decryptSecurePayload(
        job.encryptedPayload,
        secureContext(peer, job.transferId, job.type, { incoming: true })
      );
      const bindings = this.projectBindings();
      result.items = normalizeSessionPointers(decrypted.pointers).map((pointer) => {
        const sourcePath = pointer.location.sourceProjectPath || pointer.location.sourceFilePath;
        const mapping = resolveProjectPointer(pointer, bindings, { deviceId: peer.local.deviceId });
        return {
          sourceDeviceId: pointer.source.deviceId,
          profileId: pointer.source.profileId,
          replicaId: pointer.source.replicaId,
          projectId: pointer.location.projectId,
          sourcePath,
          path: mapping.mapped ? mapping.targetPath : sourcePath,
          coordinate: pointer.location.coordinate,
          workspaceRevision: pointer.location.workspaceRevision,
          mapping
        };
      });
    } catch (error) {
      result.payloadError = safeError(error);
    }
    return result;
  }

  cancel(transferId) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job) throw new Error('transfer-not-found');
    if (isChunkedTransfer(job)) {
      if (['completed', 'cancelled', 'expired'].includes(job.state)) throw new Error('transfer-cannot-cancel');
      const cancelled = this.update(job, { state: 'cancelled', lastError: null });
      this.rejectTransferAcks(job.transferId, new Error('file-transfer-cancelled'));
      // Only the sender-side duplicate spool is removed. Original selected files
      // and every completed receiver file are outside this directory and untouched.
      if (job.direction === 'outgoing') this.cleanupOutgoingSpoolWhenIdle(job.transferId);
      void this.sendChunkSemantic(job, 'cancel', { transferId: job.transferId }).catch(() => false);
      if (job.type === 'task-package') {
        this.clearAllTaskMaterial(job.transferId);
        if (job.direction === 'incoming') this.removeIncomingTaskSpool(job);
        if (job.direction === 'outgoing') this.recordTaskPackageTransferHistory(job, 'cancelled');
      }
      return this.publicJob(cancelled);
    }
    if (job.direction !== 'outgoing' || ['completed', 'received'].includes(job.state)) {
      throw new Error('transfer-cannot-cancel');
    }
    return this.publicJob(this.update(job, { state: 'cancelled' }));
  }

  retry(transferId) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job) throw new Error('transfer-not-found');
    if (Date.parse(job.expiresAt) <= Date.now()) throw new Error('transfer-expired');
    if (job.type === 'task-package') {
      const secretAvailable = job.direction === 'outgoing'
        ? this.outgoingTaskSecrets.has(job.transferId)
        : (this.incomingTaskSecrets.has(job.transferId)
          || this.pendingTaskEnvelopes.has(job.transferId));
      if (!secretAvailable) throw new Error('task-package-secret-unavailable');
    }
    if (isChunkedTransfer(job) && job.direction === 'incoming') {
      if (!this.readFileLocalState(job)) throw new Error('file-destination-required');
      const receiving = this.update(job, { state: 'receiving', lastError: null });
      return this.sendFileAccept(receiving).then(() => this.publicJob(this.read(job.transferId)));
    }
    if (job.direction !== 'outgoing') throw new Error('transfer-not-found');
    this.update(job, { state: 'queued', lastError: null });
    return this.dispatch(job.transferId).then((value) => this.publicJob(value));
  }

  openReceivedFileLocation(transferId) {
    const job = this.read(requiredText(transferId, 'transferId', 128));
    if (!job || job.type !== 'file' || job.direction !== 'incoming' || job.state !== 'completed') {
      throw new Error('file-transfer-not-completed');
    }
    const local = this.readFileLocalState(job);
    const first = Array.isArray(local?.finalPaths) ? local.finalPaths.find(Boolean) : null;
    if (!first || !isRegularFile(first)) throw new Error('file-received-location-missing');
    return first;
  }

  handleDeviceRevoked(deviceId) {
    const target = String(deviceId || '');
    for (const job of this.listRaw().filter((item) => (
      item.sourceDeviceId === target || item.targetDeviceId === target
    ))) {
      if (!['completed', 'cancelled', 'expired'].includes(job.state)) {
        this.update(job, { state: 'cancelled', lastError: 'device-revoked' });
      }
      this.rejectTransferAcks(job.transferId, new Error('device-revoked'));
      if (isChunkedTransfer(job) && job.direction === 'outgoing') this.cleanupOutgoingSpoolWhenIdle(job.transferId);
      if (job.type === 'task-package') {
        this.clearAllTaskMaterial(job.transferId);
        if (job.direction === 'incoming') this.removeIncomingTaskSpool(job);
        if (job.direction === 'outgoing') this.recordTaskPackageTransferHistory(job, 'revoked');
      }
    }
  }

  stop() {
    this.stopped = true;
    for (const job of this.listRaw().filter((item) => item.type === 'task-package')) {
      this.rejectTransferAcks(job.transferId, new Error('transfer-service-stopped'));
      if (job.direction === 'outgoing') {
        if (!['completed', 'cancelled', 'expired'].includes(job.state)) {
          const failed = this.update(job, {
            state: 'failed',
            lastError: 'task-package-secret-unavailable'
          });
          this.recordTaskPackageTransferHistory(failed, 'failed');
        }
        this.cleanupOutgoingSpoolWhenIdle(job.transferId);
      } else {
        if (!['cancelled', 'expired'].includes(job.state) && !this.hasImportedTaskPackage(job.transferId)) {
          this.update(job, {
            state: 'failed',
            lastError: 'task-package-secret-unavailable'
          });
        }
        this.removeIncomingTaskSpool(job);
      }
      this.clearAllTaskMaterial(job.transferId);
    }
    for (const timer of this.taskMaterialTimers.values()) clearTimeout(timer);
    this.taskMaterialTimers.clear();
    return true;
  }

  expire(job) {
    const expired = this.update(job, { state: 'expired', lastError: 'transfer-expired' });
    this.rejectTransferAcks(job.transferId, new Error('transfer-expired'));
    if (isChunkedTransfer(job) && job.direction === 'outgoing') {
      this.cleanupOutgoingSpoolWhenIdle(job.transferId);
    }
    if (job.type === 'task-package') {
      this.clearAllTaskMaterial(job.transferId);
      if (job.direction === 'incoming') this.removeIncomingTaskSpool(job);
      if (job.direction === 'outgoing') this.recordTaskPackageTransferHistory(job, 'expired');
    }
    return expired;
  }

  recordTaskPackageTransferHistory(job, state) {
    try {
      const manifest = this.taskPackageManifests(job).taskManifest;
      const overview = this.meshService.getOverview();
      const sourceIsLocal = job.direction === 'outgoing';
      return this.taskPackageServiceProvider?.()?.tryRecordHistory?.({
        packageId: manifest.packageId,
        direction: 'exported',
        deliveryMode: 'mesh-direct',
        state,
        createdAt: manifest.createdAt,
        title: manifest.summary.title,
        sourceAgentName: manifest.summary.sourceAgentName,
        targetAgentName: null,
        sourceDeviceName: sourceIsLocal ? localDeviceName(overview) : job.receivedFromName,
        targetDeviceName: sourceIsLocal ? job.targetName : localDeviceName(overview),
        transferId: job.transferId,
        appId: manifest.summary.appId || null,
        sessionMode: manifest.summary.sessionMode,
        localPath: null,
        bytesTotal: manifest.bytesTotal
      }) || false;
    } catch (_error) {
      return false;
    }
  }

  saveProjectBinding(input = {}) {
    const peer = this.meshService.getPeerContext(input.sourceDeviceId);
    const projectId = requiredText(input.projectId, 'projectId', 128);
    const received = this.list().some((job) => (
      job.direction === 'incoming'
      && job.sourceDeviceId === peer.remote.deviceId
      && (job.items || []).some((item) => item.projectId === projectId)
    ));
    if (!received) throw new Error('project-binding-source-not-found');
    const binding = createProjectBinding({
      projectId,
      deviceId: peer.local.deviceId,
      localRoot: input.localRoot,
      source: 'user-confirmed'
    }, { now: this.now() });
    const store = new MeshStore(this.databasePath);
    try { store.saveProjectBinding(binding, this.now()); } finally { store.close(); }
    this.changed();
    return binding;
  }

  fileManifest(job) {
    const deviceId = job.direction === 'incoming' ? job.sourceDeviceId : job.targetDeviceId;
    const peer = this.meshService.getPeerContext(deviceId);
    if (job.type === 'task-package') return this.taskPackageManifests(job).fileManifest;
    return decryptFileManifest(job.encryptedPayload, secureContext(
      peer,
      job.transferId,
      'file-manifest',
      { incoming: job.direction === 'incoming' }
    ));
  }

  taskPackageManifests(job) {
    const deviceId = job.direction === 'incoming' ? job.sourceDeviceId : job.targetDeviceId;
    const peer = this.meshService.getPeerContext(deviceId);
    return decryptTaskPackageManifests(job.encryptedPayload, secureContext(
      peer,
      job.transferId,
      'task-package-manifest',
      { incoming: job.direction === 'incoming' }
    ), { now: this.now() });
  }

  async spoolSelectedFiles(transferId, value) {
    const selected = Array.isArray(value) ? value : [];
    if (!selected.length || selected.length > MAX_FILE_COUNT) throw new Error('file-selection-count');
    const specs = [];
    const seen = new Set();
    let bytesTotal = 0;
    for (const selectedPath of selected) {
      const sourcePath = String(selectedPath || '');
      if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0')) throw new Error('file-selection-path');
      const linkStat = await fs.promises.lstat(sourcePath);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) throw new Error('file-selection-not-regular');
      const realPath = await fs.promises.realpath(sourcePath);
      if (seen.has(realPath)) throw new Error('file-selection-duplicate');
      seen.add(realPath);
      const stat = await fs.promises.stat(realPath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('file-selection-too-large');
      bytesTotal += stat.size;
      if (!Number.isSafeInteger(bytesTotal) || bytesTotal > MAX_FILE_TRANSFER_BYTES) {
        throw new Error('file-selection-total-too-large');
      }
      specs.push({
        sourcePath: realPath,
        name: safeFileName(path.basename(realPath)),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
    ensurePrivateDirectory(this.spoolRoot);
    ensurePrivateDirectory(path.join(this.spoolRoot, 'outgoing'));
    ensureDiskSpace(this.spoolRoot, bytesTotal);
    const directory = this.outgoingSpoolDirectory(transferId);
    await fs.promises.mkdir(directory, { mode: 0o700 });
    try {
      const files = [];
      for (let index = 0; index < specs.length; index += 1) {
        const copied = await copySelectedFile(specs[index], this.outgoingSpoolFile(transferId, index));
        files.push({
          index,
          fileId: this.randomUUID(),
          name: specs[index].name,
          size: copied.size,
          sha256: copied.sha256,
          mtimeMs: copied.mtimeMs
        });
      }
      return files;
    } catch (error) {
      this.removeOutgoingSpool(transferId);
      throw error;
    }
  }

  outgoingSpoolDirectory(transferId) {
    return path.join(this.spoolRoot, 'outgoing', transferDirectoryName(transferId));
  }

  outgoingSpoolFile(transferId, index) {
    return path.join(this.outgoingSpoolDirectory(transferId), `${String(index).padStart(4, '0')}.bin`);
  }

  assertOutgoingSpool(transferId, manifest) {
    for (const file of manifest.files) {
      const filePath = this.outgoingSpoolFile(transferId, file.index);
      if (!isRegularFile(filePath) || fs.statSync(filePath).size !== file.size) {
        throw new Error('file-spool-missing');
      }
    }
  }

  removeOutgoingSpool(transferId) {
    const parent = path.resolve(this.spoolRoot, 'outgoing');
    const directory = path.resolve(this.outgoingSpoolDirectory(transferId));
    if (path.dirname(directory) !== parent) throw new Error('file-spool-boundary');
    // This directory contains only AgentDesk-created copies. The original files
    // selected in the OS picker are never located below this boundary.
    removePrivatePath(directory, { directory: true });
  }

  removeIncomingTaskSpool(job, knownFinalPaths = []) {
    if (!job || job.type !== 'task-package' || job.direction !== 'incoming') return false;
    const requestedPackageRoot = path.resolve(this.spoolRoot, 'task-packages');
    let packageRoot = null;
    try {
      const rootStat = fs.lstatSync(requestedPackageRoot);
      if (!rootStat.isSymbolicLink() && rootStat.isDirectory()) {
        packageRoot = fs.realpathSync(requestedPackageRoot);
      }
    } catch (_error) { /* package root may not have been created yet */ }
    const finalPaths = Array.isArray(knownFinalPaths) ? [...knownFinalPaths] : [];
    try {
      const local = this.readFileLocalState(job);
      finalPaths.push(...(Array.isArray(local?.finalPaths) ? local.finalPaths : []));
      if (packageRoot && local?.tempDir) {
        const expected = path.resolve(packageRoot, `.agentdesk-receive-${transferDirectoryName(job.transferId)}`);
        if (sameResolvedPath(local.tempDir, expected)) {
          removePrivatePath(expected, { directory: true });
        }
      }
    } catch (_error) {
      // A rejected offer may not have a destination yet, and a corrupt local
      // state must not expand the deletion boundary.
    }
    try {
      const cleanup = this.readTaskPackageCleanupDescriptor(job);
      if (packageRoot && cleanup) {
        removePrivatePath(path.join(packageRoot, cleanup.tempDirectoryName), { directory: true });
        finalPaths.push(...cleanup.finalNames.map((name) => path.join(packageRoot, name)));
      }
    } catch (_error) { /* an invalid descriptor is ignored, never broadened */ }
    for (const filePath of finalPaths) {
      if (!packageRoot || !filePath) continue;
      const resolved = path.resolve(filePath);
      if (!sameResolvedPath(path.dirname(resolved), packageRoot)) continue;
      removePrivatePath(resolved);
    }
    const incomingParent = path.resolve(this.spoolRoot, 'incoming');
    const stateDirectory = path.resolve(path.dirname(this.fileLocalStatePath(job)));
    if (sameResolvedPath(path.dirname(stateDirectory), incomingParent)) {
      removePrivatePath(stateDirectory, { directory: true });
    }
    return true;
  }

  taskPackageCleanupDescriptorPath(job) {
    return path.join(path.dirname(this.fileLocalStatePath(job)), 'cleanup.json');
  }

  readTaskPackageCleanupDescriptor(job) {
    const stored = readJsonStore(this.taskPackageCleanupDescriptorPath(job), (value) => (
      value?.schemaVersion === 1 && value?.transferId === job.transferId
    ));
    if (!stored) return null;
    const value = stored.parsed;
    const expectedTemp = `.agentdesk-receive-${transferDirectoryName(job.transferId)}`;
    if (value.tempDirectoryName !== expectedTemp) throw new Error('task-package-cleanup-temp');
    const finalNames = Array.isArray(value.finalNames) ? value.finalNames : [];
    if (finalNames.length > 1) throw new Error('task-package-cleanup-final-count');
    const normalized = finalNames.map((name) => {
      const text = String(name || '').normalize('NFC');
      if (safeTaskPackageName(text) !== text || path.basename(text) !== text) {
        throw new Error('task-package-cleanup-final-name');
      }
      return text;
    });
    return {
      schemaVersion: 1,
      transferId: job.transferId,
      tempDirectoryName: expectedTemp,
      finalNames: normalized
    };
  }

  writeTaskPackageCleanupDescriptor(job, local) {
    if (job.type !== 'task-package' || job.direction !== 'incoming') return false;
    const packageRoot = realpathResolvedSync(path.resolve(this.spoolRoot, 'task-packages'));
    if (!sameResolvedPath(local.destinationRoot, packageRoot)) {
      throw new Error('task-package-cleanup-root');
    }
    const finalNames = (Array.isArray(local.finalPaths) ? local.finalPaths : [])
      .filter(Boolean)
      .map((filePath) => {
        const resolved = path.resolve(filePath);
        if (!sameResolvedPath(path.dirname(resolved), packageRoot)) {
          throw new Error('task-package-cleanup-final-boundary');
        }
        const name = path.basename(resolved).normalize('NFC');
        if (safeTaskPackageName(name) !== name) throw new Error('task-package-cleanup-final-name');
        return name;
      });
    writeJsonStore(this.taskPackageCleanupDescriptorPath(job), {
      schemaVersion: 1,
      transferId: job.transferId,
      tempDirectoryName: `.agentdesk-receive-${transferDirectoryName(job.transferId)}`,
      finalNames
    }, { skipBackup: true });
    return true;
  }

  cleanupOutgoingSpoolWhenIdle(transferId) {
    const active = this.activeFileSends.get(transferId);
    if (active) {
      void active.finally(() => this.removeOutgoingSpool(transferId)).catch(() => false);
      return;
    }
    this.removeOutgoingSpool(transferId);
  }

  async prepareIncomingDestination(job, manifest, destinationRoot) {
    const requested = String(destinationRoot || '');
    if (!path.isAbsolute(requested) || requested.includes('\0')) throw new Error('file-destination-invalid');
    // Keep destination resolution asynchronous: this path may be a slow UNC or
    // network-backed directory. The later cleanup comparison normalizes the
    // equivalent Windows namespace/casing forms without weakening the exact-root
    // boundary captured here.
    const root = await fs.promises.realpath(path.resolve(requested));
    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) throw new Error('file-destination-not-directory');
    const previous = this.readFileLocalState(job);
    const receivedBytes = previous ? await this.incomingBytes(job, manifest, previous) : 0;
    ensureDiskSpace(root, Math.max(0, manifest.bytesTotal - receivedBytes));
    if (previous) {
      if (!sameResolvedPath(previous.destinationRoot, root)) {
        throw new Error('file-destination-already-selected');
      }
      return previous;
    }
    const existingNames = await fs.promises.readdir(root);
    const targetNames = uniqueTargetNames(manifest.files, existingNames);
    const tempDir = path.join(root, `.agentdesk-receive-${transferDirectoryName(job.transferId)}`);
    await fs.promises.mkdir(tempDir, { mode: 0o700 });
    const tempStat = await fs.promises.lstat(tempDir);
    if (tempStat.isSymbolicLink() || !tempStat.isDirectory()) {
      throw new Error('file-destination-temp-invalid');
    }
    try { await fs.promises.chmod(tempDir, 0o700); } catch (_error) { /* Windows does not enforce POSIX modes. */ }
    const securedTemp = await fs.promises.lstat(tempDir);
    if (process.platform !== 'win32' && (securedTemp.mode & 0o077) !== 0) {
      throw new Error('file-destination-temp-permissions');
    }
    const local = normalizeFileLocalState({
      schemaVersion: 1,
      transferId: job.transferId,
      destinationRoot: root,
      tempDir,
      targetNames,
      finalPaths: Array(manifest.files.length).fill(null),
      verified: [],
      completed: false
    }, manifest);
    this.writeFileLocalState(job, local);
    return local;
  }

  fileLocalStatePath(job) {
    return path.join(this.spoolRoot, 'incoming', transferDirectoryName(job.transferId), 'state.json');
  }

  readFileLocalState(job) {
    const filePath = this.fileLocalStatePath(job);
    const loaded = readJsonStore(filePath, (value) => value && typeof value === 'object' && !Array.isArray(value));
    if (!loaded) return null;
    const peer = this.meshService.getPeerContext(job.sourceDeviceId);
    const decrypted = decryptSecurePayload(
      loaded.parsed,
      secureContext(peer, job.transferId, `${job.type}-local-state`, { incoming: true })
    );
    return normalizeFileLocalState(decrypted.state, this.fileManifest(job));
  }

  writeFileLocalState(job, state) {
    const normalized = normalizeFileLocalState(state, this.fileManifest(job));
    const peer = this.meshService.getPeerContext(job.sourceDeviceId);
    const encrypted = encryptSecurePayload(
      { state: normalized },
      secureContext(peer, job.transferId, `${job.type}-local-state`, { incoming: true })
    );
    const filePath = this.fileLocalStatePath(job);
    ensurePrivateDirectory(path.dirname(filePath));
    writeJsonStore(filePath, encrypted, { skipBackup: true });
    this.writeTaskPackageCleanupDescriptor(job, normalized);
    return normalized;
  }

  incomingPartFile(local, index) {
    if (!local.tempDir) throw new Error('file-transfer-already-finalized');
    return safeChildPath(local.tempDir, `${String(index).padStart(4, '0')}.part`);
  }

  async ensureZeroLengthParts(job, manifest, local) {
    let changed = false;
    for (const file of manifest.files.filter((item) => item.size === 0)) {
      const part = this.incomingPartFile(local, file.index);
      if (!fs.existsSync(part)) await fs.promises.writeFile(part, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      if (!local.verified.includes(file.index)) {
        if (file.sha256 !== sha256(Buffer.alloc(0))) throw new Error('file-empty-hash');
        local.verified.push(file.index);
        changed = true;
      }
    }
    if (changed) this.writeFileLocalState(job, local);
  }

  async incomingOffsets(job, manifest, local) {
    const offsets = [];
    for (const file of manifest.files) {
      const part = this.incomingPartFile(local, file.index);
      const size = await regularFileSize(part);
      if (size > file.size) throw new Error('file-part-overflow');
      offsets.push({ index: file.index, offset: size });
    }
    return offsets;
  }

  async incomingBytes(job, manifest, local) {
    const offsets = await this.incomingOffsets(job, manifest, local);
    return offsets.reduce((sum, item) => sum + item.offset, 0);
  }

  async writeIncomingChunk(job, manifest, local, file, offset, bytes) {
    const part = this.incomingPartFile(local, file.index);
    const currentSize = await regularFileSize(part);
    if (currentSize > offset) {
      if (currentSize < offset + bytes.length) throw new Error('file-chunk-overlap');
      const existing = await readFileRange(part, offset, bytes.length);
      if (!existing.equals(bytes)) throw new Error('file-chunk-duplicate-mismatch');
      return offset + bytes.length;
    }
    if (currentSize !== offset) throw new Error('file-chunk-gap');
    await writeFileRange(part, offset, bytes);
    const nextOffset = offset + bytes.length;
    if (nextOffset === file.size) {
      try {
        await verifyFileHash(part, file.sha256, file.size);
      } catch (error) {
        const preserved = `${part}.checksum-failed-${Date.now()}`;
        await fs.promises.rename(part, preserved).catch(() => false);
        throw error;
      }
      if (!local.verified.includes(file.index)) local.verified.push(file.index);
      this.writeFileLocalState(job, local);
    }
    return nextOffset;
  }

  async completeIncomingIfReady(job, manifest, local) {
    if (!job || job.state === 'completed') return true;
    for (const file of manifest.files) {
      const part = this.incomingPartFile(local, file.index);
      if (await regularFileSize(part) !== file.size) return false;
      if (!local.verified.includes(file.index)) {
        await verifyFileHash(part, file.sha256, file.size);
        local.verified.push(file.index);
        this.writeFileLocalState(job, local);
      }
    }
    await this.finalizeIncomingFiles(job, manifest, local);
    return true;
  }

  async finalizeIncomingFiles(job, manifest, local) {
    for (const file of manifest.files) {
      if (local.finalPaths[file.index] && isRegularFile(local.finalPaths[file.index])) continue;
      const part = this.incomingPartFile(local, file.index);
      let targetName = local.targetNames[file.index];
      let finalPath = safeChildPath(local.destinationRoot, targetName);
      if (fs.existsSync(finalPath)) {
        targetName = uniqueTargetNames([file], await fs.promises.readdir(local.destinationRoot))[0];
        local.targetNames[file.index] = targetName;
        finalPath = safeChildPath(local.destinationRoot, targetName);
      }
      await linkOrCopyExclusive(part, finalPath);
      await verifyFileHash(finalPath, file.sha256, file.size);
      local.finalPaths[file.index] = finalPath;
      this.writeFileLocalState(job, local);
    }
    local.completed = true;
    this.writeFileLocalState(job, local);
    // The exact hidden directory was created by AgentDesk for this transfer and
    // contains only verified duplicate `.part` files. Final user files are siblings.
    removeExactTemporaryDirectory(local.tempDir, local.destinationRoot, job.transferId);
    local.tempDir = null;
    this.writeFileLocalState(job, local);
    this.update(this.read(job.transferId) || job, {
      state: 'completed',
      bytesTransferred: manifest.bytesTotal,
      lastError: null
    });
    await this.sendChunkSemantic(job, 'complete', { transferId: job.transferId })
      .catch(() => false);
  }

  async sendChunkSemantic(job, action, payload) {
    if (this.stopped) throw new Error('transfer-service-stopped');
    const deviceId = job.direction === 'outgoing' ? job.targetDeviceId : job.sourceDeviceId;
    const prefix = job.type === 'task-package' ? 'task.package' : 'file';
    const capability = job.type === 'task-package' ? 'task.package.receive' : 'file.receive';
    if (job.type === 'task-package') {
      const peer = this.meshService.getPeerContext(deviceId);
      requireCapability(peer.remote, capability);
      requireDirectTaskPackageConnection(this.peerManagerProvider?.(), deviceId);
    }
    return this.peerManagerProvider().sendSemantic(deviceId, `${prefix}.${action}`, capability, payload);
  }

  rejectTransferAcks(transferId, error) {
    const prefix = `${String(transferId || '')}:`;
    for (const [key, ack] of this.pendingChunkAcks) {
      if (!key.startsWith(prefix)) continue;
      ack.reject(error);
      ack.cancel();
      this.pendingChunkAcks.delete(key);
    }
  }

  projectBindings() {
    if (!fs.existsSync(this.databasePath)) return [];
    const store = new MeshStore(this.databasePath);
    try { return store.readProjectBindings(); } finally { store.close(); }
  }

  listRaw() {
    if (!fs.existsSync(this.databasePath)) return [];
    const store = new MeshStore(this.databasePath);
    try { return store.readTransferJobs({ limit: 200 }).map(normalizeTransferJob); } finally { store.close(); }
  }

  read(transferId) {
    if (!fs.existsSync(this.databasePath)) return null;
    const store = new MeshStore(this.databasePath);
    try {
      const value = store.readTransferJob(transferId);
      return value ? normalizeTransferJob(value) : null;
    } finally { store.close(); }
  }

  save(job, options = {}) {
    const normalized = normalizeTransferJob(job);
    const store = new MeshStore(this.databasePath);
    try { store.saveTransferJob(normalized, this.now()); } finally { store.close(); }
    if (options.notify !== false) this.changed();
    return normalized;
  }

  update(job, patch, options = {}) {
    return this.save({ ...job, ...patch, updatedAt: this.now() }, options);
  }

  updateProgress(job, patch) {
    const now = Date.now();
    const last = this.progressNotificationAt.get(job.transferId) || 0;
    const completedBytes = Number(patch.bytesTransferred) >= Number(job.bytesTotal);
    const notify = completedBytes || now - last >= 200;
    const saved = this.update(job, patch, { notify });
    if (notify) this.progressNotificationAt.set(job.transferId, now);
    return saved;
  }

  changed() {
    this.onChange(this.list().map((job) => ({ ...job, items: job.items || undefined })));
  }
}

function secureContext(peer, transferId, type, options = {}) {
  const incoming = options.incoming === true;
  return {
    meshId: peer.mesh.meshId,
    transferId,
    type,
    sourceDeviceId: incoming ? peer.remote.deviceId : peer.local.deviceId,
    targetDeviceId: incoming ? peer.local.deviceId : peer.remote.deviceId,
    linkKey: peer.secrets.identityLinkKey
  };
}

function taskPackageUnlockSealContext(peer, transferId) {
  return {
    meshId: peer.mesh.meshId,
    transferId,
    sourceDeviceId: peer.local.deviceId,
    targetDeviceId: peer.remote.deviceId,
    targetDevicePublicKey: peer.remote.devicePublicKey
  };
}

function taskPackageUnlockOpenContext(peer, transferId, now) {
  return {
    meshId: peer.mesh.meshId,
    transferId,
    sourceDeviceId: peer.remote.deviceId,
    targetDeviceId: peer.local.deviceId,
    targetDevicePrivateKey: peer.secrets.devicePrivateKey,
    now
  };
}

function decryptFileManifest(encryptedPayload, context) {
  const decrypted = decryptSecurePayload(encryptedPayload, context);
  return normalizeFileManifest(decrypted.manifest);
}

function decryptTaskPackageManifests(encryptedPayload, context, options = {}) {
  const decrypted = decryptSecurePayload(encryptedPayload, context);
  const fileManifest = normalizeFileManifest(decrypted.fileManifest);
  const taskManifest = normalizeTaskPackageTransferManifest(decrypted.taskManifest, options);
  if (fileManifest.transferId !== taskManifest.transferId
    || fileManifest.files.length !== 1
    || fileManifest.bytesTotal !== taskManifest.bytesTotal
    || fileManifest.files[0].sha256 !== taskManifest.packageHash
    || fileManifest.files[0].name !== taskManifest.fileName) {
    throw new Error('task-package-manifest-mismatch');
  }
  return { fileManifest, taskManifest };
}

function sameTaskPackageManifests(left, right) {
  return Boolean(left && right
    && JSON.stringify(left.fileManifest) === JSON.stringify(right.fileManifest)
    && JSON.stringify(left.taskManifest) === JSON.stringify(right.taskManifest));
}

function taskPackageDeliveryIdentity(peer, manifests) {
  return {
    meshId: peer.mesh.meshId,
    transferId: manifests.taskManifest.transferId,
    packageId: manifests.taskManifest.packageId,
    packageHash: manifests.taskManifest.packageHash,
    sourceDeviceId: peer.remote.deviceId,
    targetDeviceId: peer.local.deviceId
  };
}

function requireDirectTaskPackageConnection(manager, targetDeviceId) {
  const connection = manager?.listConnections?.().find((item) => (
    item.deviceId === targetDeviceId && item.authenticated
  ));
  if (!connection) throw new Error('task-package-direct-connection-required');
  if (!Array.isArray(connection.protocolFeatures)
    || !connection.protocolFeatures.includes(TASK_PACKAGE_TRANSFER_FEATURE)) {
    throw new Error('task-package-direct-feature-unavailable');
  }
  return connection;
}

function requireTaskPackageFeature(context) {
  if (!Array.isArray(context?.negotiatedProtocolFeatures)
    || !context.negotiatedProtocolFeatures.includes(TASK_PACKAGE_TRANSFER_FEATURE)) {
    throw new Error('task-package-direct-feature-unavailable');
  }
  return true;
}

function isChunkedTransfer(job) {
  return job?.type === 'file' || job?.type === 'task-package';
}

function chunkPayloadType(job, index, offset) {
  const base = fileChunkType(index, offset);
  return job?.type === 'task-package' ? base.replace(/^file-/, 'task-package-') : base;
}

function taskPackageSummary(manifest = {}) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  return {
    title: manifest.session?.originalTitle || null,
    sourceAgentName: manifest.source?.agentName || null,
    appId: manifest.source?.appId || null,
    senderLabel: manifest.source?.senderLabel || null,
    objective: manifest.checkpoint?.objective || null,
    sessionMode: manifest.session?.mode,
    attachmentCount: entries.filter((entry) => entry.kind === 'attachment').length
  };
}

function localDeviceName(overview = {}) {
  const localDeviceId = String(overview.localDeviceId || '');
  const devices = Array.isArray(overview.devices) ? overview.devices : [];
  const local = devices.find((device) => (
    device && (device.isLocal === true || String(device.deviceId || '') === localDeviceId)
  ));
  return requiredText(local?.name || 'This device', 'localDeviceName', 160);
}

function transferDirectoryName(transferId) {
  return crypto.createHash('sha256').update(requiredText(transferId, 'transferId', 128)).digest('hex').slice(0, 32);
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('file-spool-directory-invalid');
  try { fs.chmodSync(directory, 0o700); } catch (_error) { /* best effort on Windows */ }
  const secured = fs.lstatSync(directory);
  if (process.platform !== 'win32' && (secured.mode & 0o077) !== 0) {
    throw new Error('file-spool-directory-permissions');
  }
}

function portableTaskPackageDestination(value) {
  const requested = String(value || '').trim();
  if (!requested || !path.isAbsolute(requested) || requested.includes('\0')) {
    throw new TypeError('task-package-fallback-destination');
  }
  const baseName = path.basename(requested).normalize('NFC');
  if (safeTaskPackageName(baseName) !== baseName) {
    throw new Error('task-package-fallback-file-name');
  }
  const parent = fs.realpathSync(path.dirname(path.resolve(requested)));
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error('task-package-fallback-parent');
  }
  const destination = path.join(parent, baseName);
  if (fs.existsSync(destination)) throw new Error('task-package-fallback-exists');
  return destination;
}

function removePrivatePath(target, options = {}) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(target);
      return true;
    }
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    }
    if (options.directory !== true) fs.unlinkSync(target);
  } catch (_error) { /* best effort inside an exact private boundary */ }
  return false;
}

function ensureDiskSpace(directory, requiredBytes) {
  if (typeof fs.statfsSync !== 'function') return true;
  const stats = fs.statfsSync(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  const required = Number(requiredBytes || 0) + FILE_DISK_MARGIN_BYTES;
  if (Number.isFinite(available) && available < required) throw new Error('file-disk-space');
  return true;
}

async function copySelectedFile(spec, targetPath) {
  const source = await openRegularFile(spec.sourcePath);
  let destination;
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size !== spec.size) throw new Error('file-source-changed');
    destination = await fs.promises.open(
      targetPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const length = Math.min(buffer.length, before.size - offset);
      const { bytesRead } = await source.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error('file-source-short-read');
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new Error('file-spool-short-write');
        written += result.bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    await destination.sync();
    const after = await source.stat();
    if (after.size !== before.size || Math.round(after.mtimeMs) !== Math.round(before.mtimeMs)) {
      throw new Error('file-source-changed');
    }
    return { size: before.size, mtimeMs: before.mtimeMs, sha256: hash.digest('hex') };
  } catch (error) {
    await destination?.close().catch(() => false);
    destination = null;
    await fs.promises.unlink(targetPath).catch(() => false);
    throw error;
  } finally {
    await destination?.close().catch(() => false);
    await source.close();
  }
}

async function openRegularFile(filePath) {
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  const stat = await handle.stat();
  if (!stat.isFile()) {
    await handle.close();
    throw new Error('file-not-regular');
  }
  return handle;
}

async function verifyFileHash(filePath, expectedHash, expectedSize) {
  const handle = await openRegularFile(filePath);
  try {
    const stat = await handle.stat();
    if (stat.size !== expectedSize) throw new Error('file-size-mismatch');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (!bytesRead) throw new Error('file-hash-short-read');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (hash.digest('hex') !== expectedHash) throw new Error('file-checksum-failed');
    return true;
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath) {
  const handle = await openRegularFile(filePath);
  try {
    const stat = await handle.stat();
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (!bytesRead) throw new Error('file-hash-short-read');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timedDeferred(timeoutMs, reason) {
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A send can still be awaiting the transport call when cancellation rejects
  // its ACK. Attach a sink immediately so that cancellation is observable by
  // the eventual await without briefly becoming an unhandled rejection.
  promise.catch(() => false);
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectPromise(new Error(reason));
  }, timeoutMs);
  timer.unref?.();
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    },
    cancel() { clearTimeout(timer); }
  };
}

function fileAckKey(transferId, fileIndex, offset) {
  return `${transferId}:${fileIndex}:${offset}`;
}

function boundedInteger(value, min, max, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${field}-invalid`);
  return number;
}

function decodeBase64(value) {
  const text = String(value || '');
  if (!text || text.length > Math.ceil(FILE_CHUNK_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error('file-chunk-encoding');
  }
  const buffer = Buffer.from(text, 'base64');
  if (buffer.toString('base64') !== text) throw new Error('file-chunk-encoding');
  return buffer;
}

function normalizeFileLocalState(value = {}, manifest) {
  if (value.schemaVersion !== 1 || value.transferId !== manifest.transferId) throw new Error('file-local-state-version');
  const destinationRoot = path.resolve(requiredText(value.destinationRoot, 'destinationRoot', 4096));
  if (!path.isAbsolute(destinationRoot)) throw new Error('file-local-root');
  const expectedTemp = path.join(destinationRoot, `.agentdesk-receive-${transferDirectoryName(manifest.transferId)}`);
  const completed = value.completed === true;
  const tempDir = value.tempDir ? path.resolve(value.tempDir) : null;
  if ((!completed && tempDir !== expectedTemp) || (tempDir && tempDir !== expectedTemp)) {
    throw new Error('file-local-temp-boundary');
  }
  const targetNames = Array.isArray(value.targetNames) ? value.targetNames : [];
  if (targetNames.length !== manifest.files.length) throw new Error('file-local-target-count');
  const names = targetNames.map((name) => {
    const safe = safeFileName(name);
    if (safe !== String(name || '').normalize('NFC')) throw new Error('file-local-target-name');
    return safe;
  });
  const finalPaths = Array.isArray(value.finalPaths) ? value.finalPaths : [];
  if (finalPaths.length !== manifest.files.length) throw new Error('file-local-final-count');
  const finals = finalPaths.map((filePath, index) => {
    if (!filePath) return null;
    const normalized = safeChildPath(destinationRoot, path.basename(String(filePath)));
    if (normalized !== path.resolve(filePath) || path.basename(normalized) !== names[index]) {
      throw new Error('file-local-final-boundary');
    }
    return normalized;
  });
  const verified = [...new Set((Array.isArray(value.verified) ? value.verified : [])
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < manifest.files.length))];
  return {
    schemaVersion: 1,
    transferId: manifest.transferId,
    destinationRoot,
    tempDir,
    targetNames: names,
    finalPaths: finals,
    verified,
    completed
  };
}

function safeChildPath(root, name) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(name || ''));
  if (path.dirname(target) !== base) throw new Error('file-target-boundary');
  return target;
}

function realpathResolvedSync(value) {
  return fs.realpathSync(path.resolve(value));
}

function sameResolvedPath(left, right, pathApi = path) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const windowsSemantics = pathApi === path.win32 || pathApi?.sep === '\\';
  const comparable = (value) => {
    if (!windowsSemantics) return pathApi.resolve(value);
    const windowsPath = value.replace(/\//g, '\\');
    if (/^\\\\\?\\UNC\\/i.test(windowsPath)) {
      return pathApi.resolve(`\\\\${windowsPath.slice(8)}`);
    }
    if (/^\\\\\?\\[a-z]:\\/i.test(windowsPath)) {
      return pathApi.resolve(windowsPath.slice(4));
    }
    return pathApi.resolve(windowsPath);
  };
  const leftPath = comparable(left);
  const rightPath = comparable(right);
  return pathApi.relative(leftPath, rightPath) === '';
}

async function regularFileSize(filePath) {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('file-part-invalid');
    return stat.size;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function readFileRange(filePath, offset, length) {
  const handle = await openRegularFile(filePath);
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (bytesRead !== length) throw new Error('file-part-short-read');
    return buffer;
  } finally {
    await handle.close();
  }
}

async function writeFileRange(filePath, offset, bytes) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('file-part-invalid');
  }
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0),
    0o600
  );
  try {
    let written = 0;
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, offset + written);
      if (!result.bytesWritten) throw new Error('file-part-short-write');
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function linkOrCopyExclusive(sourcePath, targetPath) {
  try {
    await fs.promises.link(sourcePath, targetPath);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code)) throw error;
    await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }
}

function removeExactTemporaryDirectory(tempDir, destinationRoot, transferId) {
  const expected = path.join(path.resolve(destinationRoot), `.agentdesk-receive-${transferDirectoryName(transferId)}`);
  if (path.resolve(tempDir) !== expected || path.dirname(expected) !== path.resolve(destinationRoot)) {
    throw new Error('file-temp-cleanup-boundary');
  }
  if (!fs.existsSync(expected)) return;
  const stat = fs.lstatSync(expected);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('file-temp-cleanup-invalid');
  fs.rmSync(expected, { recursive: true, force: false });
}

function isRegularFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return !stat.isSymbolicLink() && stat.isFile();
  } catch (_error) {
    return false;
  }
}

function normalizeSelections(value) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length || list.length > MAX_SESSION_POINTERS) throw new Error('session-selection-count');
  const seen = new Set();
  return list.map((item) => {
    const selection = {
      conversationId: requiredText(item?.conversationId, 'conversationId', 128),
      replicaId: requiredText(item?.replicaId, 'replicaId', 128)
    };
    const key = `${selection.conversationId}:${selection.replicaId}`;
    if (seen.has(key)) throw new Error('session-selection-duplicate');
    seen.add(key);
    return selection;
  });
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function positiveDuration(value, fallback, errorCode) {
  if (value === undefined) return fallback;
  const duration = Number(value);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > TASK_PACKAGE_ENVELOPE_TTL_MS) {
    throw new TypeError(errorCode);
  }
  return duration;
}

function cleanReasonCode(value) {
  return safeError(value || 'file-transfer-cancelled');
}

function safeError(error) {
  return String(error?.message || error || 'transfer-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'transfer-failed';
}

module.exports = {
  POINTER_MESSAGE_LIMIT,
  TransferService,
  normalizeSelections,
  sameResolvedPath,
  secureContext
};
