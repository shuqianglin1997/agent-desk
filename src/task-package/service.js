const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const apps = require('../apps');
const { readJsonStore, writeJsonStore } = require('../json-store');
const {
  TASK_PACKAGE_SCHEMA_VERSION,
  generateUnlockCode,
  writeEncryptedTaskPackage,
  decryptTaskPackage,
  extractTaskPackageEntry,
  publicTaskPackageManifest
} = require('./format');
const {
  captureCodexTaskSession,
  importCodexTaskSession,
  importedConversationTitle
} = require('./codex-adapter');

const IMPORT_DRAFT_TTL_MS = 30 * 60_000;
const HISTORY_LIMIT = 200;
const MAX_ATTACHMENT_COUNT = 32;
const MAX_GIT_PATCH_BYTES = 32 * 1024 * 1024;
const MAX_GIT_STATUS_BYTES = 4 * 1024 * 1024;
const MAX_GIT_SNAPSHOT_ATTEMPTS = 3;

class TaskPackageService {
  constructor(options = {}) {
    this.profileProvider = options.profileProvider || (() => []);
    this.meshOverviewProvider = options.meshOverviewProvider || (() => null);
    this.historyFile = path.resolve(options.historyFile || path.join(os.tmpdir(), 'agentdesk-task-package-history.json'));
    this.consumedFile = path.resolve(options.consumedFile || path.join(
      path.dirname(this.historyFile),
      'task-package-consumed.json'
    ));
    this.stagingRoot = path.resolve(options.stagingRoot || path.join(os.tmpdir(), 'agentdesk-task-packages'));
    this.now = options.now || (() => new Date().toISOString());
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.launchProfile = options.launchProfile || null;
    this.onChange = options.onChange || (() => {});
    this.decryptPackage = options.decryptTaskPackage || decryptTaskPackage;
    this.removeDraftRoot = options.removeDraftRoot || ((draftRoot) => {
      fs.rmSync(draftRoot, { recursive: true, force: true });
    });
    this.importDraftTtlMs = positiveDuration(
      options.importDraftTtlMs,
      IMPORT_DRAFT_TTL_MS,
      'task-package-import-draft-ttl'
    );
    this.stopped = false;
    this.importDrafts = new Map();
    this.importDraftTimers = new Map();
    this.stagingRoot = ensurePrivateStagingRoot(this.stagingRoot);
    this.cleanupStaleStaging();
  }

  previewExport(input = {}) {
    const { profile, session } = this.resolveLocalSession(input.profileId, input.sessionId);
    const context = this.sourceContext(profile);
    const app_ = apps.getApp(profile.appId);
    const native = profile.appId === 'codex';
    const transcript = typeof app_.exportTranscript === 'function';
    return {
      supported: native || transcript,
      mode: native ? 'native' : (transcript ? 'transcript' : 'unsupported'),
      profileId: profile.id,
      appId: profile.appId,
      appLabel: app_.label,
      sessionId: session.id,
      title: session.title,
      projectName: session.projectPath ? path.basename(session.projectPath) : null,
      sourceAgentName: context.agentName,
      nativeRecordCount: native ? 1 + Number(session.internalBranchCount || 0) : 0
    };
  }

  async exportPackage(input = {}) {
    const { profile, session } = this.resolveLocalSession(input.profileId, input.sessionId);
    const destinationPath = absolutePath(input.destinationPath, 'destinationPath');
    const packageId = this.randomUUID();
    const workRoot = path.join(this.stagingRoot, `export-${packageId}`);
    createPrivateStagingDirectory(workRoot, this.stagingRoot);
    const source = this.sourceContext(profile, input.senderLabel);
    const unlockCode = input.unlockCode || generateUnlockCode(this.randomBytes);
    const entries = [];
    let sessionCapture;
    try {
      if (profile.appId === 'codex') {
        sessionCapture = await captureCodexTaskSession({
          profile,
          session,
          stagingRoot: path.join(workRoot, 'native')
        });
        entries.push(...sessionCapture.entries);
      } else {
        const app_ = apps.getApp(profile.appId);
        if (typeof app_.exportTranscript !== 'function') throw new Error('task-package-source-unsupported');
        const exported = app_.exportTranscript(session);
        sessionCapture = {
          adapterId: `${profile.appId}-transcript-markdown`,
          adapterVersion: 1,
          mode: 'transcript',
          contentEntryId: 'conversation-transcript',
          childEntryIds: []
        };
        entries.push({
          entryId: sessionCapture.contentEntryId,
          kind: 'conversation-transcript',
          name: 'conversation/conversation.md',
          buffer: Buffer.from(String(exported.markdown || ''), 'utf8'),
          metadata: { sourceAppId: profile.appId }
        });
      }

      const project = input.includeProject === false
        ? null
        : captureGitProject(session.projectPath, workRoot);
      if (project?.entry) entries.push(project.entry);
      const usedAttachmentNames = new Set();
      const attachmentRoot = path.join(workRoot, 'attachments');
      const attachmentEntries = normalizeAttachments(input.attachmentPaths).map((filePath, index) => {
        const originalName = safePortableName(path.basename(filePath));
        const portableName = uniquePortableName(originalName, usedAttachmentNames);
        const snapshotPath = path.join(attachmentRoot, `${String(index + 1).padStart(4, '0')}.attachment`);
        snapshotRegularFile(filePath, snapshotPath);
        return {
          entryId: `attachment-${index + 1}`,
          kind: 'attachment',
          name: `attachments/${portableName}`,
          sourcePath: snapshotPath,
          metadata: { originalName }
        };
      });
      entries.push(...attachmentEntries);

      const manifest = {
        schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
        packageId,
        createdAt: this.now(),
        kind: 'task-package',
        source,
        checkpoint: input.checkpoint || {},
        session: {
          mode: sessionCapture.mode,
          adapterId: sessionCapture.adapterId,
          adapterVersion: sessionCapture.adapterVersion,
          conversationId: cleanText(input.conversationId, 128) || null,
          sessionId: String(session.id),
          originalTitle: session.title || `Session ${String(session.id).slice(0, 8)}`,
          suggestedTitle: importedConversationTitle({
            source,
            session: { originalTitle: session.title }
          }),
          contentEntryId: sessionCapture.contentEntryId,
          childEntryIds: sessionCapture.childEntryIds
        },
        project: project ? project.manifest : null,
        lineage: { parentPackageId: cleanText(input.parentPackageId, 128) || null }
      };
      const result = await writeEncryptedTaskPackage({
        destinationPath,
        unlockCode,
        manifest,
        entries
      });
      const historyRecorded = input.recordHistory === false ? false : this.tryRecordHistory({
        packageId,
        direction: 'exported',
        deliveryMode: cleanText(input.deliveryMode, 32) || 'portable-file',
        state: 'ready',
        createdAt: result.manifest.createdAt,
        title: result.manifest.session.originalTitle,
        sourceAgentName: result.manifest.source.agentName,
        targetAgentName: cleanText(input.targetAgentName, 120) || null,
        sourceDeviceName: result.manifest.source.deviceName || null,
        targetDeviceName: cleanText(input.targetDeviceName, 120) || null,
        transferId: cleanText(input.transferId, 128) || null,
        appId: result.manifest.source.appId,
        sessionMode: result.manifest.session.mode,
        localPath: result.savedPath,
        bytesTotal: result.manifest.bytesTotal
      });
      return {
        packageId,
        savedPath: result.savedPath,
        unlockCode,
        historyRecorded,
        manifest: publicTaskPackageManifest(result.manifest)
      };
    } finally {
      try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
    }
  }

  createImportDraft(packagePath) {
    if (this.stopped) throw new Error('task-package-service-stopped');
    this.pruneImportDrafts();
    const resolved = absolutePath(packagePath, 'packagePath');
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('task-package-import-source');
    const token = this.randomUUID();
    const draftRoot = path.join(this.stagingRoot, `import-${token}`);
    createPrivateStagingDirectory(draftRoot, this.stagingRoot);
    this.importDrafts.set(token, {
      token,
      packagePath: resolved,
      fileName: path.basename(resolved),
      createdAt: Date.now(),
      draftRoot,
      archive: null,
      inspecting: false,
      cancelled: false
    });
    this.scheduleImportDraftExpiry(token);
    return { token, fileName: path.basename(resolved), size: stat.size };
  }

  async inspectImport(input = {}) {
    const draft = this.requireDraft(input.token);
    if (draft.inspecting) throw new Error('task-package-import-busy');
    draft.inspecting = true;
    if (draft.archive?.plainPath) {
      try { fs.unlinkSync(draft.archive.plainPath); } catch (_error) { /* replace inspection */ }
      draft.archive = null;
    }
    const plainPath = path.join(draft.draftRoot, 'archive.inner');
    let archive = null;
    try {
      archive = await this.decryptPackage({
        packagePath: draft.packagePath,
        unlockCode: input.unlockCode,
        plainPath
      });
      if (this.stopped || draft.cancelled || this.importDrafts.get(draft.token) !== draft) {
        throw new Error('task-package-import-cancelled');
      }
      draft.archive = archive;
      draft.unlockedAt = Date.now();
      const profiles = this.compatibleProfiles(archive.manifest);
      return {
        token: draft.token,
        fileName: draft.fileName,
        manifest: publicTaskPackageManifest(archive.manifest),
        compatibleProfiles: profiles,
        canImportNative: archive.manifest.session.mode === 'native' && profiles.some((profile) => profile.canNativeImport)
      };
    } catch (error) {
      try { fs.unlinkSync(archive?.plainPath || plainPath); } catch (_cleanupError) { /* best effort */ }
      if (draft.cancelled || this.stopped || this.importDrafts.get(draft.token) !== draft) {
        try { this.removeDraftRoot(draft.draftRoot); } catch (_cleanupError) { /* retry after decrypt closes */ }
        throw new Error('task-package-import-cancelled');
      }
      throw error;
    } finally {
      draft.inspecting = false;
    }
  }

  async inspectImportWithUnlockCode(token, unlockCode) {
    return this.inspectImport({ token, unlockCode });
  }

  async commitImport(input = {}) {
    const draft = this.requireDraft(input.token);
    if (!draft.archive) throw new Error('task-package-import-not-inspected');
    const manifest = draft.archive.manifest;
    const profile = this.profileProvider().find((item) => item.id === String(input.targetProfileId || ''));
    if (!profile) throw new Error('task-package-target-profile');
    const compatible = this.compatibleProfiles(manifest).find((item) => item.profileId === profile.id);
    if (!compatible) throw new Error('task-package-target-incompatible');
    const baseDirectory = absolutePath(input.artifactDirectory, 'artifactDirectory');
    const artifactDirectory = uniqueArtifactDirectory(baseDirectory, manifest);
    const directDelivery = consumedDeliveryRecord(draft, manifest, this.now());
    let consumedReserved = false;
    if (directDelivery) {
      this.recordConsumedTransfer({ ...directDelivery, state: 'committing' });
      consumedReserved = true;
    }
    let nativeImport = null;
    try {
      fs.mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(artifactDirectory, '交接说明.md'),
        renderCheckpointMarkdown(manifest),
        { encoding: 'utf8', mode: 0o600 }
      );
      for (const entry of draft.archive.entries) {
        if (entry.kind === 'native-session-root' || entry.kind === 'native-session-child') continue;
        const destination = artifactEntryDestination(artifactDirectory, entry);
        await extractTaskPackageEntry({
          plainPath: draft.archive.plainPath,
          entry,
          destinationPath: destination
        });
      }
      if (manifest.session.mode === 'native') {
        nativeImport = await importCodexTaskSession({
          profile,
          manifest,
          archive: draft.archive,
          stagingRoot: path.join(draft.draftRoot, 'native-import'),
          now: this.now()
        });
      }
    } catch (error) {
      try { fs.rmSync(artifactDirectory, { recursive: true, force: true }); } catch (_cleanupError) { /* preserve cause */ }
      if (consumedReserved) this.removeConsumedReservation(directDelivery);
      throw error;
    }

    let consumedRecorded = false;
    if (directDelivery) {
      try {
        this.recordConsumedTransfer({ ...directDelivery, state: 'consumed', consumedAt: this.now() });
        consumedRecorded = true;
      } catch (_error) {
        // The already-persisted `committing` reservation remains fail-closed.
      }
    }

    // From this point the import is committed. History bookkeeping and opening
    // the client are follow-up conveniences; neither may roll back an imported
    // native session or delete the received materials.
    this.discardImportDraft(draft.token);
    const historyRecorded = this.tryRecordHistory({
      packageId: manifest.packageId,
      direction: 'imported',
      deliveryMode: cleanText(draft.deliveryMode, 32) || 'portable-file',
      state: nativeImport ? 'native-imported' : 'materials-imported',
      createdAt: this.now(),
      title: manifest.session.originalTitle,
      sourceAgentName: manifest.source.agentName,
      targetAgentName: compatible.agentName,
      sourceDeviceId: cleanText(draft.sourceDeviceId, 128) || null,
      sourceDeviceName: cleanText(draft.sourceDeviceName, 120)
        || manifest.source.deviceName
        || null,
      targetDeviceId: cleanText(draft.targetDeviceId, 128) || null,
      targetDeviceName: cleanText(draft.targetDeviceName, 120) || null,
      transferId: cleanText(draft.transferId, 128) || null,
      appId: manifest.source.appId,
      targetAppId: profile.appId,
      sessionMode: manifest.session.mode,
      localPath: artifactDirectory,
      bytesTotal: manifest.bytesTotal
    });
    const openRequested = input.openAfterImport !== false;
    let opened = false;
    if (openRequested && typeof this.launchProfile === 'function') {
      try {
        const launchResult = await this.launchProfile(profile);
        opened = launchResult !== false && launchResult?.ok !== false;
      } catch (_error) {
        opened = false;
      }
    }
    return {
      packageId: manifest.packageId,
      artifactDirectory,
      targetProfileId: profile.id,
      targetProfileName: profile.name,
      targetAgentName: compatible.agentName,
      sessionMode: manifest.session.mode,
      nativeImport,
      consumedRecorded,
      historyRecorded,
      openRequested,
      opened,
      openFailed: openRequested && !opened
    };
  }

  cancelImport(token) {
    this.discardImportDraft(String(token || ''));
    return true;
  }

  attachImportDelivery(token, input = {}) {
    const draft = this.requireDraft(token);
    draft.deliveryMode = cleanText(input.deliveryMode, 32) || null;
    draft.meshId = cleanText(input.meshId, 128) || null;
    draft.transferId = cleanText(input.transferId, 128) || null;
    draft.packageId = cleanText(input.packageId, 128) || null;
    draft.packageHash = sha256Text(input.packageHash) || null;
    draft.sourceDeviceId = cleanText(input.sourceDeviceId, 128) || null;
    draft.sourceDeviceName = cleanText(input.sourceDeviceName, 120) || null;
    draft.targetDeviceId = cleanText(input.targetDeviceId, 128) || null;
    draft.targetDeviceName = cleanText(input.targetDeviceName, 120) || null;
    return true;
  }

  stop() {
    this.stopped = true;
    for (const token of [...this.importDrafts.keys()]) this.discardImportDraft(token);
    for (const timer of this.importDraftTimers.values()) clearTimeout(timer);
    this.importDraftTimers.clear();
  }

  listHistory() {
    return this.readHistory().map(({ localPath, ...entry }) => ({
      ...entry,
      canReveal: Boolean(localPath && fs.existsSync(localPath))
    }));
  }

  hasActiveImportTransfer(input = {}) {
    const expected = normalizeConsumedLookup(input);
    for (const draft of this.importDrafts.values()) {
      if (draft.cancelled) continue;
      if (sameConsumedIdentity(draft, expected)) return true;
    }
    return false;
  }

  hasConsumedTransfer(input = {}) {
    const expected = normalizeConsumedLookup(input);
    return this.readConsumedTransfers().some((entry) => (
      ['committing', 'consumed'].includes(entry.state)
      && sameConsumedIdentity(entry, expected)
    ));
  }

  hasConsumedTransferId(transferId) {
    const id = cleanText(transferId, 128);
    if (!id) return false;
    return this.readConsumedTransfers().some((entry) => (
      entry.transferId === id && ['committing', 'consumed'].includes(entry.state)
    ));
  }

  historyLocation(packageId, direction = null) {
    const item = this.readHistory().find((entry) => (
      entry.packageId === String(packageId || '')
      && (!direction || entry.direction === direction)
    ));
    if (!item?.localPath || !fs.existsSync(item.localPath)) throw new Error('task-package-history-location');
    return item.localPath;
  }

  compatibleProfiles(manifest) {
    const native = manifest.session.mode === 'native';
    const overview = this.meshOverviewProvider() || {};
    const sameSourceDevice = manifest.source.deviceId
      ? manifest.source.deviceId === overview.localDeviceId
      : !overview.localDeviceId;
    return this.profileProvider()
      .filter((profile) => !native || profile.appId === 'codex')
      .filter((profile) => !(sameSourceDevice && manifest.source.profileId === profile.id))
      .map((profile) => {
        const context = this.sourceContext(profile);
        return {
          profileId: profile.id,
          name: profile.name,
          agentName: context.agentName,
          appId: profile.appId,
          appLabel: apps.getApp(profile.appId).label,
          canNativeImport: native && profile.appId === 'codex'
        };
      });
  }

  resolveLocalSession(profileId, sessionId) {
    const profile = this.profileProvider().find((item) => item.id === String(profileId || ''));
    if (!profile) throw new Error('task-package-source-profile');
    const session = apps.getApp(profile.appId).scan(profile)
      .find((item) => String(item.id) === String(sessionId || ''));
    if (!session) throw new Error('task-package-source-session');
    return { profile, session };
  }

  sourceContext(profile, senderLabel = null) {
    const overview = this.meshOverviewProvider() || {};
    const localDeviceId = overview.localDeviceId || null;
    const slot = (overview.slots || []).find((item) => (
      item.profileId === profile.id && (!localDeviceId || item.deviceId === localDeviceId)
    ));
    const agent = (overview.agents || []).find((item) => item.agentId === slot?.agentId);
    const device = (overview.devices || []).find((item) => item.deviceId === localDeviceId);
    return {
      senderLabel: cleanText(senderLabel, 120) || null,
      deviceId: localDeviceId,
      deviceName: device?.name || os.hostname(),
      agentId: slot?.agentId || null,
      agentName: agent?.displayName || profile.name,
      profileId: profile.id,
      appId: profile.appId
    };
  }

  readHistory() {
    try {
      const stored = readJsonStore(this.historyFile, (value) => (
        value?.schemaVersion === 1 && Array.isArray(value.entries)
      ));
      return stored?.parsed?.entries || [];
    } catch (_error) {
      return [];
    }
  }

  recordHistory(entry) {
    const current = this.readHistory().filter((item) => !(
      item.packageId === entry.packageId && item.direction === entry.direction
    ));
    const next = [{ ...entry, recordedAt: this.now() }, ...current].slice(0, HISTORY_LIMIT);
    writeJsonStore(this.historyFile, { schemaVersion: 1, entries: next });
    try { this.onChange(this.listHistory()); } catch (_error) { /* notification is best effort */ }
  }

  tryRecordHistory(entry) {
    try {
      this.recordHistory(entry);
      return true;
    } catch (_error) {
      return false;
    }
  }

  requireDraft(token) {
    if (this.stopped) throw new Error('task-package-service-stopped');
    this.pruneImportDrafts();
    const draft = this.importDrafts.get(String(token || ''));
    if (!draft) throw new Error('task-package-import-draft');
    return draft;
  }

  discardImportDraft(token) {
    const draft = this.importDrafts.get(token);
    if (!draft) return;
    draft.cancelled = true;
    this.importDrafts.delete(token);
    const timer = this.importDraftTimers.get(token);
    if (timer) clearTimeout(timer);
    this.importDraftTimers.delete(token);
    try { this.removeDraftRoot(draft.draftRoot); } catch (_error) { /* retry after an active decrypt closes */ }
  }

  scheduleImportDraftExpiry(token) {
    const existing = this.importDraftTimers.get(token);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.discardImportDraft(token), this.importDraftTtlMs);
    timer.unref?.();
    this.importDraftTimers.set(token, timer);
  }

  pruneImportDrafts() {
    const cutoff = Date.now() - this.importDraftTtlMs;
    for (const draft of this.importDrafts.values()) {
      if (draft.createdAt < cutoff) this.discardImportDraft(draft.token);
    }
  }

  cleanupStaleStaging() {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    let entries = [];
    try { entries = fs.readdirSync(this.stagingRoot, { withFileTypes: true }); } catch (_error) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^(export|import)-[a-zA-Z0-9-]+$/.test(entry.name)) continue;
      const target = path.join(this.stagingRoot, entry.name);
      try {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
        if (stat.mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
      } catch (_error) { /* best effort */ }
    }
  }

  readConsumedTransfers() {
    try {
      const stored = readJsonStore(this.consumedFile, (value) => (
        value?.schemaVersion === 1 && Array.isArray(value.entries)
      ));
      return (stored?.parsed?.entries || []).map(normalizeConsumedEntry);
    } catch (_error) {
      return [];
    }
  }

  recordConsumedTransfer(input = {}) {
    const entry = normalizeConsumedEntry(input);
    const current = this.readConsumedTransfers();
    const conflict = current.find((item) => (
      item.transferId === entry.transferId && !sameConsumedIdentity(item, entry)
    ));
    if (conflict) throw new Error('task-package-consumed-conflict');
    const next = [entry, ...current.filter((item) => item.transferId !== entry.transferId)].slice(0, 500);
    writeJsonStore(this.consumedFile, { schemaVersion: 1, entries: next });
    return true;
  }

  removeConsumedReservation(input = {}) {
    try {
      const expected = normalizeConsumedLookup(input);
      const current = this.readConsumedTransfers();
      const next = current.filter((entry) => !(
        entry.state === 'committing' && sameConsumedIdentity(entry, expected)
      ));
      if (next.length !== current.length) {
        writeJsonStore(this.consumedFile, { schemaVersion: 1, entries: next });
      }
    } catch (_error) { /* a stale reservation fails closed */ }
  }
}

function ensurePrivateStagingRoot(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('task-package-staging-root-invalid');
  }
  try { fs.chmodSync(directory, 0o700); } catch (_error) { /* Windows does not enforce POSIX modes. */ }
  const secured = fs.lstatSync(directory);
  if (process.platform !== 'win32' && (secured.mode & 0o077) !== 0) {
    throw new Error('task-package-staging-root-permissions');
  }
  return fs.realpathSync(directory);
}

function createPrivateStagingDirectory(directory, stagingRoot) {
  const parent = ensurePrivateStagingRoot(stagingRoot);
  const target = path.resolve(directory);
  if (path.dirname(target) !== parent) throw new Error('task-package-staging-boundary');
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('task-package-staging-directory-invalid');
  try { fs.chmodSync(target, 0o700); } catch (_error) { /* Windows does not enforce POSIX modes. */ }
  const secured = fs.lstatSync(target);
  if (process.platform !== 'win32' && (secured.mode & 0o077) !== 0) {
    throw new Error('task-package-staging-directory-permissions');
  }
  return target;
}

function consumedDeliveryRecord(draft, manifest, now) {
  if (draft.deliveryMode !== 'mesh-direct') return null;
  return normalizeConsumedEntry({
    schemaVersion: 1,
    state: 'committing',
    meshId: draft.meshId,
    transferId: draft.transferId,
    packageId: draft.packageId || manifest.packageId,
    packageHash: draft.packageHash,
    sourceDeviceId: draft.sourceDeviceId,
    targetDeviceId: draft.targetDeviceId,
    createdAt: now,
    consumedAt: null
  });
}

function normalizeConsumedLookup(value = {}) {
  return {
    meshId: requiredConsumedText(value.meshId, 'meshId'),
    transferId: requiredConsumedText(value.transferId, 'transferId'),
    packageId: requiredConsumedText(value.packageId, 'packageId'),
    packageHash: requiredSha256(value.packageHash, 'packageHash'),
    sourceDeviceId: requiredConsumedText(value.sourceDeviceId, 'sourceDeviceId'),
    targetDeviceId: requiredConsumedText(value.targetDeviceId, 'targetDeviceId')
  };
}

function normalizeConsumedEntry(value = {}) {
  const lookup = normalizeConsumedLookup(value);
  const state = String(value.state || '');
  if (!['committing', 'consumed'].includes(state)) throw new Error('task-package-consumed-state');
  const createdAt = normalizeConsumedIso(value.createdAt, 'createdAt');
  const consumedAt = value.consumedAt == null ? null : normalizeConsumedIso(value.consumedAt, 'consumedAt');
  return { schemaVersion: 1, state, ...lookup, createdAt, consumedAt };
}

function sameConsumedIdentity(left, right) {
  return ['meshId', 'transferId', 'packageId', 'packageHash', 'sourceDeviceId', 'targetDeviceId']
    .every((field) => left?.[field] === right?.[field]);
}

function requiredConsumedText(value, field) {
  const text = cleanText(value, 128);
  if (!text) throw new Error(`task-package-consumed-${field}`);
  return text;
}

function requiredSha256(value, field) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`task-package-consumed-${field}`);
  return text;
}

function sha256Text(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
}

function normalizeConsumedIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`task-package-consumed-${field}`);
  return new Date(time).toISOString();
}

function positiveDuration(value, fallback, errorCode) {
  if (value === undefined) return fallback;
  const duration = Number(value);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 24 * 60 * 60_000) {
    throw new TypeError(errorCode);
  }
  return duration;
}

function captureGitProject(projectPath, workRoot) {
  if (!projectPath || !fs.existsSync(projectPath)) return null;
  const root = git(projectPath, ['rev-parse', '--show-toplevel']);
  if (!root) return {
    manifest: {
      name: path.basename(projectPath), remote: null, branch: null, head: null,
      dirty: false, statusSummary: [], patchEntryId: null
    },
    entry: null
  };
  for (let attempt = 0; attempt < MAX_GIT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const headBefore = git(root, ['rev-parse', 'HEAD']);
    const branchBefore = git(root, ['branch', '--show-current']);
    const remoteBefore = git(root, ['config', '--get', 'remote.origin.url']);
    const statusBefore = gitRaw(root, ['status', '--porcelain=v1', '--untracked-files=normal'], MAX_GIT_STATUS_BYTES);
    if (!/^[a-f0-9]{40,64}$/i.test(headBefore || '') || branchBefore === null || statusBefore === null) {
      throw new Error('task-package-git-snapshot-failed');
    }
    const patchBefore = gitBuffer(
      root,
      ['diff', '--binary', '--no-ext-diff', headBefore, '--'],
      MAX_GIT_PATCH_BYTES
    );
    const patchAfter = gitBuffer(
      root,
      ['diff', '--binary', '--no-ext-diff', headBefore, '--'],
      MAX_GIT_PATCH_BYTES
    );
    const statusAfter = gitRaw(root, ['status', '--porcelain=v1', '--untracked-files=normal'], MAX_GIT_STATUS_BYTES);
    const headAfter = git(root, ['rev-parse', 'HEAD']);
    const branchAfter = git(root, ['branch', '--show-current']);
    const remoteAfter = git(root, ['config', '--get', 'remote.origin.url']);
    if (patchBefore === null || patchAfter === null || statusAfter === null || !headAfter || branchAfter === null) {
      throw new Error('task-package-git-snapshot-failed');
    }
    if (
      headBefore !== headAfter
      || branchBefore !== branchAfter
      || remoteBefore !== remoteAfter
      || statusBefore !== statusAfter
      || !patchBefore.equals(patchAfter)
    ) continue;

    const statusSummary = statusBefore
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, 200);
    const patchEntryId = patchBefore.length ? 'git-working-tree' : null;
    const entry = patchEntryId ? {
      entryId: patchEntryId,
      kind: 'git-working-tree',
      name: 'project/working-tree.patch',
      buffer: patchBefore,
      metadata: { format: 'git-diff-binary', appliesToHead: headBefore }
    } : null;
    return {
      manifest: {
        name: path.basename(root),
        remote: remoteBefore,
        branch: branchBefore || null,
        head: headBefore,
        dirty: statusSummary.length > 0,
        statusSummary,
        patchEntryId
      },
      entry
    };
  }
  throw new Error('task-package-git-snapshot-failed');
}

function git(cwd, args, maxBuffer = 1024 * 1024) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer
    }).trim();
  } catch (_error) {
    return null;
  }
}

function gitBuffer(cwd, args, maxBuffer) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: null,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer
    });
  } catch (error) {
    if (error?.code === 'ENOBUFS') throw new Error('task-package-git-patch-too-large');
    return null;
  }
}

function gitRaw(cwd, args, maxBuffer) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer
    });
  } catch (_error) {
    return null;
  }
}

function normalizeAttachments(values) {
  const paths = [...new Set((Array.isArray(values) ? values : []).map((value) => absolutePath(value, 'attachmentPath')))];
  if (paths.length > MAX_ATTACHMENT_COUNT) throw new Error('task-package-attachment-count');
  for (const filePath of paths) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('task-package-attachment-invalid');
  }
  return paths;
}

function snapshotRegularFile(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  let source;
  let target;
  try {
    source = fs.openSync(sourcePath, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(source);
    if (!before.isFile()) throw new Error('task-package-attachment-invalid');
    target = fs.openSync(destinationPath, 'wx', 0o600);
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const bytesRead = fs.readSync(source, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!bytesRead) throw new Error('task-package-attachment-short-read');
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(target, buffer, written, bytesRead - written);
        if (!bytesWritten) throw new Error('task-package-attachment-write');
        written += bytesWritten;
      }
      offset += bytesRead;
    }
    const after = fs.fstatSync(source);
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
    ) throw new Error('task-package-attachment-changing');
    fs.fsyncSync(target);
  } catch (error) {
    if (target !== undefined) {
      try { fs.closeSync(target); } catch (_closeError) { /* preserve cause */ }
      target = undefined;
    }
    try { fs.unlinkSync(destinationPath); } catch (_unlinkError) { /* best effort */ }
    throw error;
  } finally {
    if (target !== undefined) fs.closeSync(target);
    if (source !== undefined) fs.closeSync(source);
  }
}

function renderCheckpointMarkdown(manifest) {
  const checkpoint = manifest.checkpoint || {};
  const source = manifest.source || {};
  const lines = [
    `# ${manifest.session.originalTitle}`,
    '',
    `- 任务包：\`${manifest.packageId}\``,
    `- 来源 Agent：${source.agentName || '-'}`,
    `- 交接人：${source.senderLabel || '-'}`,
    `- 来源客户端：${source.appId || '-'}`,
    `- 创建时间：${manifest.createdAt}`,
    `- 会话形态：${manifest.session.mode === 'native' ? '原生会话' : '只读会话内容'}`,
    ''
  ];
  appendSection(lines, '目标', checkpoint.objective ? [checkpoint.objective] : []);
  appendSection(lines, '已经完成', checkpoint.completed);
  appendSection(lines, '接下来', checkpoint.next);
  appendSection(lines, '阻塞与风险', checkpoint.blockers);
  appendSection(lines, '验收标准', checkpoint.acceptance);
  if (manifest.project) {
    lines.push('## 项目检查点', '');
    lines.push(`- 项目：${manifest.project.name || '-'}`);
    lines.push(`- 仓库：${manifest.project.remote || '-'}`);
    lines.push(`- 分支：${manifest.project.branch || '-'}`);
    lines.push(`- 提交：${manifest.project.head || '-'}`);
    lines.push(`- 工作树：${manifest.project.dirty ? '有未提交修改' : '干净'}`, '');
  }
  return `${lines.join('\n').trim()}\n`;
}

function appendSection(lines, title, items = []) {
  lines.push(`## ${title}`, '');
  if (!items?.length) lines.push('- 未填写', '');
  else for (const item of items) lines.push(`- ${String(item).replace(/\n/g, '\n  ')}`);
  if (items?.length) lines.push('');
}

function artifactEntryDestination(root, entry) {
  if (entry.kind === 'conversation-transcript') return path.join(root, '会话内容.md');
  if (entry.kind === 'git-working-tree') return path.join(root, 'working-tree.patch');
  if (entry.kind === 'attachment') return path.join(root, '附件', safePortableName(path.basename(entry.name)));
  throw new Error('task-package-artifact-entry-kind');
}

function uniqueArtifactDirectory(base, manifest) {
  const stem = safePortableName(`${manifest.session.originalTitle}-${manifest.packageId.slice(0, 8)}`).slice(0, 100);
  let target = path.join(base, stem);
  let suffix = 2;
  while (fs.existsSync(target)) {
    target = path.join(base, `${stem}-${suffix}`);
    suffix += 1;
  }
  return target;
}

function safePortableName(value) {
  const clean = String(value || '任务包').normalize('NFC')
    .replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (clean || '任务包').slice(0, 180);
}

function uniquePortableName(value, used) {
  const original = safePortableName(value);
  let candidate = original;
  let index = 2;
  const extension = path.extname(original);
  const stem = extension ? original.slice(0, -extension.length) : original;
  while (used.has(candidate.toLocaleLowerCase('en-US'))) {
    const suffix = `-${index}`;
    candidate = `${stem.slice(0, Math.max(1, 180 - extension.length - suffix.length))}${suffix}${extension}`;
    index += 1;
  }
  used.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

function absolutePath(value, field) {
  const text = String(value || '').trim();
  if (!text || !path.isAbsolute(text) || text.includes('\0')) throw new TypeError(`${field} is invalid`);
  return path.resolve(text);
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

module.exports = {
  TaskPackageService,
  captureGitProject,
  renderCheckpointMarkdown,
  uniqueArtifactDirectory
};
