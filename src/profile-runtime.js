/*
 * AgentDesk Profile runtime guard.
 *
 * The official desktop clients own their Crashpad implementation. AgentDesk
 * still owns the resource boundary of every Profile it launches: duplicate
 * launch prevention, process lifecycle and bounded pending crash reports.
 * Repeated helper-process dumps are observed and reported without terminating
 * a healthy client; the hard file/byte limits remain the disk-safety boundary.
 * Ordinary lifecycle actions remain ownership-bound; only a confirmed disk
 * incident may also stop an inherited process left behind by an older manager.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJsonStore, writeJsonStore } = require('./json-store');
const {
  snapshotProcessRecords,
  findProfileProcesses,
  findProfileClientProcesses
} = require('./process');

const RUNTIME_STATE_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 100,
  maxBytes: 200 * 1024 * 1024,
  burstLimit: 5,
  burstWindowMs: 60_000,
  pollIntervalMs: 2_000,
  terminateGraceMs: 1_000
});
const ALLOWED_CRASHPAD_FILE = /(?:\.dmp|_sidecar\.json)$/i;

function safeAbsoluteProfilePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('profile-path-invalid');
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new Error('profile-path-too-broad');
  return resolved;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveCrashpadPending(profilePath, fsImpl = fs) {
  const profileRoot = safeAbsoluteProfilePath(profilePath);
  const crashpadPath = path.join(profileRoot, 'Crashpad');
  const pendingPath = path.join(crashpadPath, 'pending');
  if (!fsImpl.existsSync(profileRoot) || !fsImpl.existsSync(pendingPath)) {
    return { exists: false, profileRoot, crashpadPath, pendingPath };
  }

  const crashpadStat = fsImpl.lstatSync(crashpadPath);
  const pendingStat = fsImpl.lstatSync(pendingPath);
  if (
    crashpadStat.isSymbolicLink() || pendingStat.isSymbolicLink() ||
    !crashpadStat.isDirectory() || !pendingStat.isDirectory()
  ) throw new Error('crashpad-path-unsafe');

  const realProfileRoot = fsImpl.realpathSync(profileRoot);
  const realPendingPath = fsImpl.realpathSync(pendingPath);
  if (!pathInside(realProfileRoot, realPendingPath)) throw new Error('crashpad-path-outside-profile');
  return {
    exists: true,
    profileRoot,
    crashpadPath,
    pendingPath,
    realProfileRoot,
    realPendingPath
  };
}

function crashEventKey(name) {
  return String(name).replace(/_sidecar\.json$/i, '').replace(/\.dmp$/i, '');
}

function scanCrashpadPending(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const burstWindowMs = Number.isFinite(options.burstWindowMs)
    ? options.burstWindowMs
    : DEFAULT_LIMITS.burstWindowMs;
  const resolved = resolveCrashpadPending(profilePath, fsImpl);
  const empty = {
    exists: resolved.exists,
    pendingPath: resolved.realPendingPath || resolved.pendingPath,
    fileCount: 0,
    totalBytes: 0,
    dumpCount: 0,
    newestAt: null,
    burstCount: 0,
    burstSignature: null,
    files: []
  };
  if (!resolved.exists) return empty;

  const files = [];
  for (const entry of fsImpl.readdirSync(resolved.realPendingPath, { withFileTypes: true })) {
    if (!entry.isFile() || !ALLOWED_CRASHPAD_FILE.test(entry.name)) continue;
    const filePath = path.join(resolved.realPendingPath, entry.name);
    const stat = fsImpl.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    files.push({
      name: entry.name,
      path: filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      eventKey: crashEventKey(entry.name),
      kind: /\.dmp$/i.test(entry.name) ? 'dump' : 'sidecar'
    });
  }

  const recentSignatures = new Map();
  for (const file of files) {
    if (file.kind !== 'dump' || now - file.mtimeMs > burstWindowMs || file.mtimeMs > now + 5_000) continue;
    // Crashpad handler loops produce stable dump sizes. A size-only signature
    // avoids opening a memory dump or sidecar that may contain private paths.
    const signature = `dump-size:${file.size}`;
    recentSignatures.set(signature, (recentSignatures.get(signature) || 0) + 1);
  }
  const burst = [...recentSignatures.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  return {
    ...empty,
    exists: true,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    dumpCount: files.filter((file) => file.kind === 'dump').length,
    newestAt: files.length ? Math.max(...files.map((file) => file.mtimeMs)) : null,
    burstCount: burst[1],
    burstSignature: burst[0],
    files
  };
}

function removeAllowedCrashpadFile(file, pendingPath, fsImpl = fs) {
  if (!file || !ALLOWED_CRASHPAD_FILE.test(file.name)) throw new Error('crashpad-file-not-allowed');
  const pendingStat = fsImpl.lstatSync(pendingPath);
  if (!pendingStat.isDirectory() || pendingStat.isSymbolicLink()) throw new Error('crashpad-path-unsafe');
  if (path.resolve(fsImpl.realpathSync(pendingPath)) !== path.resolve(pendingPath)) {
    throw new Error('crashpad-path-changed');
  }
  const expected = path.join(pendingPath, path.basename(file.name));
  if (path.resolve(file.path) !== path.resolve(expected)) throw new Error('crashpad-file-outside-pending');
  const stat = fsImpl.lstatSync(expected);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('crashpad-file-unsafe');
  fsImpl.unlinkSync(expected);
}

function pruneCrashpadPending(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : DEFAULT_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_LIMITS.maxBytes;
  const scan = options.scan || scanCrashpadPending(profilePath, { ...options, fs: fsImpl });
  if (!scan.exists || (scan.fileCount <= maxFiles && scan.totalBytes <= maxBytes)) {
    return { ...scan, removedFiles: 0, removedBytes: 0 };
  }

  const groups = new Map();
  for (const file of scan.files) {
    const group = groups.get(file.eventKey) || { key: file.eventKey, files: [], mtimeMs: 0, bytes: 0 };
    group.files.push(file);
    group.mtimeMs = Math.max(group.mtimeMs, file.mtimeMs);
    group.bytes += file.size;
    groups.set(file.eventKey, group);
  }

  let keptFiles = 0;
  let keptBytes = 0;
  let removedFiles = 0;
  let removedBytes = 0;
  const newestFirst = [...groups.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const group of newestFirst) {
    const fits = keptFiles + group.files.length <= maxFiles && keptBytes + group.bytes <= maxBytes;
    if (fits) {
      keptFiles += group.files.length;
      keptBytes += group.bytes;
      continue;
    }
    for (const file of group.files) {
      removeAllowedCrashpadFile(file, scan.pendingPath, fsImpl);
      removedFiles += 1;
      removedBytes += file.size;
    }
  }
  const after = scanCrashpadPending(profilePath, { ...options, fs: fsImpl });
  return { ...after, removedFiles, removedBytes };
}

function cleanCrashpadPending(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const scan = scanCrashpadPending(profilePath, { ...options, fs: fsImpl });
  if (!scan.exists) return { ...scan, removedFiles: 0, removedBytes: 0 };
  let removedBytes = 0;
  for (const file of scan.files) {
    removeAllowedCrashpadFile(file, scan.pendingPath, fsImpl);
    removedBytes += file.size;
  }
  return {
    ...scanCrashpadPending(profilePath, { ...options, fs: fsImpl }),
    removedFiles: scan.files.length,
    removedBytes
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const input = Array.isArray(items) ? items : [];
  const output = new Array(input.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), input.length) }, async () => {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(input[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function summarizeCrashpadFiles(resolved, files, now, burstWindowMs) {
  const recentSignatures = new Map();
  for (const file of files) {
    if (file.kind !== 'dump' || now - file.mtimeMs > burstWindowMs || file.mtimeMs > now + 5_000) continue;
    const signature = `dump-size:${file.size}`;
    recentSignatures.set(signature, (recentSignatures.get(signature) || 0) + 1);
  }
  const burst = [...recentSignatures.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  return {
    exists: resolved.exists,
    pendingPath: resolved.realPendingPath || resolved.pendingPath,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    dumpCount: files.filter((file) => file.kind === 'dump').length,
    newestAt: files.length ? Math.max(...files.map((file) => file.mtimeMs)) : null,
    burstCount: burst[1],
    burstSignature: burst[0],
    files
  };
}

async function scanCrashpadPendingAsync(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const burstWindowMs = Number.isFinite(options.burstWindowMs)
    ? options.burstWindowMs
    : DEFAULT_LIMITS.burstWindowMs;
  const resolved = resolveCrashpadPending(profilePath, fsImpl);
  if (!resolved.exists) return summarizeCrashpadFiles(resolved, [], now, burstWindowMs);

  const entries = await fsImpl.promises.readdir(resolved.realPendingPath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && ALLOWED_CRASHPAD_FILE.test(entry.name));
  const inspected = await mapWithConcurrency(candidates, 32, async (entry) => {
    const filePath = path.join(resolved.realPendingPath, entry.name);
    try {
      const stat = await fsImpl.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return {
        name: entry.name,
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        eventKey: crashEventKey(entry.name),
        kind: /\.dmp$/i.test(entry.name) ? 'dump' : 'sidecar'
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  });
  return summarizeCrashpadFiles(resolved, inspected.filter(Boolean), now, burstWindowMs);
}

async function removeAllowedCrashpadFileAsync(file, pendingPath, fsImpl = fs) {
  if (!file || !ALLOWED_CRASHPAD_FILE.test(file.name)) throw new Error('crashpad-file-not-allowed');
  const pendingStat = await fsImpl.promises.lstat(pendingPath);
  if (!pendingStat.isDirectory() || pendingStat.isSymbolicLink()) throw new Error('crashpad-path-unsafe');
  if (path.resolve(await fsImpl.promises.realpath(pendingPath)) !== path.resolve(pendingPath)) {
    throw new Error('crashpad-path-changed');
  }
  const expected = path.join(pendingPath, path.basename(file.name));
  if (path.resolve(file.path) !== path.resolve(expected)) throw new Error('crashpad-file-outside-pending');
  try {
    const stat = await fsImpl.promises.lstat(expected);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('crashpad-file-unsafe');
    await fsImpl.promises.unlink(expected);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function pruneCrashpadPendingAsync(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : DEFAULT_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_LIMITS.maxBytes;
  const scan = options.scan || await scanCrashpadPendingAsync(profilePath, { ...options, fs: fsImpl });
  if (!scan.exists || (scan.fileCount <= maxFiles && scan.totalBytes <= maxBytes)) {
    return { ...scan, removedFiles: 0, removedBytes: 0 };
  }

  const groups = new Map();
  for (const file of scan.files) {
    const group = groups.get(file.eventKey) || { key: file.eventKey, files: [], mtimeMs: 0, bytes: 0 };
    group.files.push(file);
    group.mtimeMs = Math.max(group.mtimeMs, file.mtimeMs);
    group.bytes += file.size;
    groups.set(file.eventKey, group);
  }
  let keptFiles = 0;
  let keptBytes = 0;
  let removedFiles = 0;
  let removedBytes = 0;
  const filesToRemove = [];
  const newestFirst = [...groups.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const group of newestFirst) {
    const fits = keptFiles + group.files.length <= maxFiles && keptBytes + group.bytes <= maxBytes;
    if (fits) {
      keptFiles += group.files.length;
      keptBytes += group.bytes;
      continue;
    }
    filesToRemove.push(...group.files);
  }
  await mapWithConcurrency(filesToRemove, 16, async (file) => {
    await removeAllowedCrashpadFileAsync(file, scan.pendingPath, fsImpl);
    removedFiles += 1;
    removedBytes += file.size;
  });
  const after = await scanCrashpadPendingAsync(profilePath, { ...options, fs: fsImpl });
  return { ...after, removedFiles, removedBytes };
}

async function cleanCrashpadPendingAsync(profilePath, options = {}) {
  const fsImpl = options.fs || fs;
  const scan = await scanCrashpadPendingAsync(profilePath, { ...options, fs: fsImpl });
  if (!scan.exists) return { ...scan, removedFiles: 0, removedBytes: 0 };
  await mapWithConcurrency(scan.files, 16, (file) => (
    removeAllowedCrashpadFileAsync(file, scan.pendingPath, fsImpl)
  ));
  return {
    ...await scanCrashpadPendingAsync(profilePath, { ...options, fs: fsImpl }),
    removedFiles: scan.files.length,
    removedBytes: scan.totalBytes
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProfileRuntimeSupervisor {
  constructor(options = {}) {
    this.stateFile = options.stateFile;
    this.fs = options.fs || fs;
    this.now = options.now || (() => Date.now());
    this.snapshot = options.snapshotProcessRecords || snapshotProcessRecords;
    this.signal = options.signalProcess || ((pid, signal) => process.kill(pid, signal));
    this.platform = options.platform || process.platform;
    this.isManagedProfile = typeof options.isManagedProfile === 'function'
      ? options.isManagedProfile
      : () => false;
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    this.onIncident = typeof options.onIncident === 'function' ? options.onIncident : () => {};
    this.profiles = new Map();
    this.records = new Map();
    this.crashpadStatuses = new Map();
    this.timer = null;
    this.tickPromise = null;
    this.loadState();
  }

  loadState() {
    if (!this.stateFile) return;
    const loaded = readJsonStore(this.stateFile, (value) => (
      value && value.version === RUNTIME_STATE_VERSION && Array.isArray(value.records)
    ));
    let migratedLegacyBurstFuse = false;
    for (const item of loaded?.parsed?.records || []) {
      if (!item || typeof item.profileId !== 'string' || typeof item.profilePath !== 'string') continue;
      const legacyBurstFuse = [
        'crashpad-repeated-signature',
        'crashpad-burst-preflight'
      ].includes(item.fuseReason);
      if (legacyBurstFuse) migratedLegacyBurstFuse = true;
      this.records.set(item.profileId, {
        profileId: item.profileId,
        profilePath: item.profilePath,
        launchPid: Number.isInteger(item.launchPid) ? item.launchPid : null,
        launchedAt: typeof item.launchedAt === 'string' ? item.launchedAt : null,
        active: item.active === true,
        owned: item.owned === true,
        fusedAt: legacyBurstFuse ? null : (typeof item.fusedAt === 'string' ? item.fusedAt : null),
        fuseReason: legacyBurstFuse ? null : (typeof item.fuseReason === 'string' ? item.fuseReason : null),
        lastIncident: item.lastIncident && typeof item.lastIncident === 'object'
          ? item.lastIncident
          : null
      });
    }
    if (migratedLegacyBurstFuse) this.saveState();
  }

  saveState() {
    if (!this.stateFile) return;
    this.fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    try { this.fs.chmodSync(path.dirname(this.stateFile), 0o700); } catch (_error) { /* best effort */ }
    writeJsonStore(this.stateFile, {
      version: RUNTIME_STATE_VERSION,
      records: [...this.records.values()]
    }, { skipBackup: true, mode: 0o600 });
  }

  updateProfiles(profiles = []) {
    this.profiles = new Map((Array.isArray(profiles) ? profiles : [])
      .filter((profile) => profile?.id && profile?.profilePath)
      .map((profile) => [profile.id, profile]));
  }

  start(profiles = []) {
    this.updateProfiles(profiles);
    if (this.timer) return;
    const runTick = () => void this.tick().catch(() => {
      // Profile-scoped scan/prune failures are cached as safe diagnostics.
      // An unexpected failure must not become an unhandled Main rejection;
      // the next interval retries without weakening the fuse or path boundary.
    });
    this.timer = setInterval(runTick, this.limits.pollIntervalMs);
    this.timer.unref?.();
    runTick();
  }

  stopMonitoring() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  processRecords(profile) {
    const records = this.snapshot();
    if (records === null) return null;
    return findProfileProcesses(records, profile.profilePath)
      .filter((record) => record.pid !== process.pid && record.pid !== process.ppid);
  }

  clientProcessRecords(profile) {
    const records = this.snapshot();
    if (records === null) return null;
    return findProfileClientProcesses(records, profile.profilePath)
      .filter((record) => record.pid !== process.pid && record.pid !== process.ppid);
  }

  async refreshCrashpadStatus(profile) {
    try {
      const status = await scanCrashpadPendingAsync(profile.profilePath, {
        fs: this.fs,
        now: this.now(),
        burstWindowMs: this.limits.burstWindowMs
      });
      const result = { ...status, errorCode: null };
      this.crashpadStatuses.set(profile.id, result);
      return result;
    } catch (error) {
      const result = {
        exists: true,
        pendingPath: path.join(profile.profilePath, 'Crashpad', 'pending'),
        fileCount: null,
        totalBytes: null,
        dumpCount: null,
        newestAt: null,
        burstCount: null,
        burstSignature: null,
        files: [],
        errorCode: String(error?.message || 'crashpad-scan-failed')
      };
      this.crashpadStatuses.set(profile.id, result);
      return result;
    }
  }

  status(profile) {
    const record = this.records.get(profile.id) || null;
    const processes = this.clientProcessRecords(profile);
    const crashpad = this.crashpadStatuses.get(profile.id) || {
      exists: null,
      pendingPath: path.join(profile.profilePath, 'Crashpad', 'pending'),
      fileCount: null,
      totalBytes: null,
      dumpCount: null,
      newestAt: null,
      burstCount: null,
      errorCode: null
    };
    return {
      profileId: profile.id,
      owned: record?.owned === true,
      active: processes === null ? null : processes.length > 0,
      processCount: processes === null ? null : processes.length,
      launchedAt: record?.launchedAt || null,
      fusedAt: record?.fusedAt || null,
      fuseReason: record?.fuseReason || null,
      lastIncident: record?.lastIncident || null,
      crashpad: {
        exists: crashpad.exists,
        pendingPath: crashpad.pendingPath,
        fileCount: crashpad.fileCount,
        totalBytes: crashpad.totalBytes,
        dumpCount: crashpad.dumpCount,
        newestAt: crashpad.newestAt,
        burstCount: crashpad.burstCount,
        errorCode: crashpad.errorCode,
        limits: {
          maxFiles: this.limits.maxFiles,
          maxBytes: this.limits.maxBytes,
          burstLimit: this.limits.burstLimit,
          burstWindowMs: this.limits.burstWindowMs
        }
      }
    };
  }

  async preflight(profile) {
    this.updateProfiles([...this.profiles.values(), profile]);
    await this.tick();
    const processes = this.clientProcessRecords(profile);
    if (processes === null) return { ok: false, reasonCode: 'profile-process-snapshot-unavailable' };
    if (processes.length) return { ok: true, alreadyRunning: true, processCount: processes.length };
    const record = this.records.get(profile.id);
    const crashpad = this.crashpadStatuses.get(profile.id) || await this.refreshCrashpadStatus(profile);
    if (crashpad.errorCode) return { ok: false, reasonCode: crashpad.errorCode };
    if (record?.fusedAt) {
      return { ok: false, reasonCode: 'profile-crashpad-fused', runtime: this.status(profile) };
    }
    return { ok: true, alreadyRunning: false };
  }

  registerLaunch(profile, launch = {}) {
    this.records.set(profile.id, {
      profileId: profile.id,
      profilePath: profile.profilePath,
      launchPid: Number.isInteger(launch.pid) ? launch.pid : null,
      launchedAt: new Date(this.now()).toISOString(),
      active: true,
      owned: true,
      fusedAt: null,
      fuseReason: null,
      lastIncident: this.records.get(profile.id)?.lastIncident || null
    });
    this.updateProfiles([...this.profiles.values(), profile]);
    this.saveState();
    return this.status(profile);
  }

  setFuse(profile, crashpad, reason) {
    const current = this.records.get(profile.id) || {
      profileId: profile.id,
      profilePath: profile.profilePath,
      launchPid: null,
      launchedAt: null,
      active: false,
      owned: false
    };
    const occurredAt = new Date(this.now()).toISOString();
    const next = {
      ...current,
      fusedAt: current.fusedAt || occurredAt,
      fuseReason: reason,
      lastIncident: {
        occurredAt,
        reason,
        fileCount: crashpad.fileCount,
        totalBytes: crashpad.totalBytes,
        burstCount: crashpad.burstCount,
        burstSignature: crashpad.burstSignature
      }
    };
    const isNewIncident = !current.fusedAt;
    this.records.set(profile.id, next);
    this.saveState();
    if (isNewIncident) this.onIncident({ profileId: profile.id, ...next.lastIncident });
    return next;
  }

  observeCrashpadBurst(profile, crashpad) {
    const current = this.records.get(profile.id) || {
      profileId: profile.id,
      profilePath: profile.profilePath,
      launchPid: null,
      launchedAt: null,
      active: false,
      owned: false,
      fusedAt: null,
      fuseReason: null,
      lastIncident: null
    };
    const occurredAt = new Date(this.now()).toISOString();
    const previous = current.lastIncident;
    const previousAt = Date.parse(previous?.occurredAt || '');
    const sameRecentBurst = previous?.reason === 'crashpad-burst-contained' &&
      previous?.burstSignature === crashpad.burstSignature &&
      Number.isFinite(previousAt) &&
      this.now() - previousAt < this.limits.burstWindowMs;
    if (sameRecentBurst) return current;
    const incident = {
      occurredAt,
      reason: 'crashpad-burst-contained',
      fileCount: crashpad.fileCount,
      totalBytes: crashpad.totalBytes,
      burstCount: crashpad.burstCount,
      burstSignature: crashpad.burstSignature,
      newestAt: crashpad.newestAt
    };
    const next = { ...current, lastIncident: incident };
    this.records.set(profile.id, next);
    this.saveState();
    if (!sameRecentBurst) this.onIncident({ profileId: profile.id, ...incident });
    return next;
  }

  async terminateProcesses(profile, reason = 'user-request', options = {}) {
    const record = this.records.get(profile.id);
    // Emergency disk containment may stop an inherited exact-profile process.
    // User/quit lifecycle calls never set allowUnowned and remain ownership-bound.
    const mayContainInheritedManagedProcess = options.allowUnowned === true && this.isManagedProfile(profile);
    if (!record?.owned && !mayContainInheritedManagedProcess) {
      return { ok: false, reasonCode: 'profile-process-not-owned' };
    }
    if (!record) return { ok: false, reasonCode: 'profile-runtime-record-missing' };
    const matched = this.processRecords(profile);
    if (matched === null) return { ok: false, reasonCode: 'profile-process-snapshot-unavailable' };
    if (!matched.length) {
      this.records.set(profile.id, {
        ...record,
        active: false,
        owned: false,
        launchPid: null,
        stoppedAt: new Date(this.now()).toISOString(),
        stopReason: reason
      });
      this.saveState();
      return { ok: true, stopped: 0, remaining: 0 };
    }

    for (const item of matched) {
      try { this.signal(item.pid, 'SIGTERM'); } catch (_error) { /* verify below */ }
    }
    await delay(this.limits.terminateGraceMs);
    const afterTerm = this.processRecords(profile);
    if (afterTerm === null) return { ok: false, reasonCode: 'profile-process-snapshot-unavailable' };
    for (const item of afterTerm) {
      try { this.signal(item.pid, 'SIGKILL'); } catch (_error) { /* verify below */ }
    }
    if (afterTerm.length) await delay(Math.min(500, this.limits.terminateGraceMs));
    const remainingRecords = this.processRecords(profile);
    const remaining = remainingRecords === null ? null : remainingRecords.length;
    const next = {
      ...record,
      active: remaining !== 0,
      owned: remaining === 0 ? false : record.owned,
      launchPid: remaining === 0 ? null : record.launchPid,
      stoppedAt: new Date(this.now()).toISOString(),
      stopReason: reason
    };
    this.records.set(profile.id, next);
    this.saveState();
    return remaining === 0
      ? { ok: true, stopped: matched.length, remaining: 0 }
      : { ok: false, reasonCode: 'profile-process-still-running', stopped: matched.length, remaining };
  }

  async stopProfile(profile, reason = 'user-request') {
    return this.terminateProcesses(profile, reason);
  }

  async cleanCrashpad(profile) {
    const result = await cleanCrashpadPendingAsync(profile.profilePath, { fs: this.fs, now: this.now() });
    this.crashpadStatuses.set(profile.id, { ...result, errorCode: null });
    const current = this.records.get(profile.id);
    if (current) {
      this.records.set(profile.id, { ...current, fusedAt: null, fuseReason: null });
      this.saveState();
    }
    return { ok: true, ...result, runtime: this.status(profile) };
  }

  tick() {
    if (this.tickPromise) return this.tickPromise;
    this.tickPromise = this.performTick().finally(() => {
      this.tickPromise = null;
    });
    return this.tickPromise;
  }

  async performTick() {
    for (const profile of this.profiles.values()) {
      let record = this.records.get(profile.id);
      if (record?.owned && record.active) {
        const clients = this.clientProcessRecords(profile);
        if (Array.isArray(clients) && clients.length === 0) {
          // A crashed Electron browser can leave its Crashpad handlers alive.
          // They are still covered by the existing ownership record, so close
          // that exact Profile process set before releasing ownership. This
          // prevents an orphan handler from blocking the next explicit launch.
          await this.terminateProcesses(profile, 'observed-client-exit');
          record = this.records.get(profile.id);
        }
      }
      // AgentDesk-created isolated directories are always safe to contain by
      // exact path after an upgrade. Default/custom official-client profiles
      // are observed only while this manager has an explicit ownership record.
      if (!this.isManagedProfile(profile) && !(record?.owned && record.active)) continue;
      const crashpad = await this.refreshCrashpadStatus(profile);
      if (crashpad.errorCode) continue;
      let bounded = crashpad;
      if (
        crashpad.fileCount > this.limits.maxFiles ||
        crashpad.totalBytes > this.limits.maxBytes
      ) {
        try {
          bounded = await pruneCrashpadPendingAsync(profile.profilePath, {
            fs: this.fs,
            now: this.now(),
            burstWindowMs: this.limits.burstWindowMs,
            maxFiles: this.limits.maxFiles,
            maxBytes: this.limits.maxBytes,
            scan: crashpad
          });
          this.crashpadStatuses.set(profile.id, { ...bounded, errorCode: null });
        } catch (error) {
          this.crashpadStatuses.set(profile.id, {
            ...crashpad,
            errorCode: String(error?.message || 'crashpad-prune-failed')
          });
          this.setFuse(profile, crashpad, 'crashpad-prune-failed');
          await this.terminateProcesses(profile, 'crashpad-prune-failed', { allowUnowned: true });
          continue;
        }
      }
      if (bounded.burstCount >= this.limits.burstLimit) {
        // A tool, renderer or Crashpad handler can crash repeatedly while the
        // desktop client remains fully usable. Do not turn a helper failure
        // into an account outage. The hard limits above still bound disk use,
        // and owned orphan handlers are collected by observed-client-exit.
        this.observeCrashpadBurst(profile, bounded);
      } else if (bounded.removedFiles > 0) {
        this.onIncident({
          profileId: profile.id,
          occurredAt: new Date(this.now()).toISOString(),
          reason: 'crashpad-limit-pruned',
          removedFiles: bounded.removedFiles,
          removedBytes: bounded.removedBytes
        });
      }
    }
  }

  async stopAll(options = {}) {
    this.stopMonitoring();
    if (options.terminateOwned !== true) return { ok: true, results: [] };
    const results = [];
    for (const [profileId, record] of this.records) {
      if (!record.owned || !record.active) continue;
      const profile = this.profiles.get(profileId);
      if (!profile) continue;
      results.push({ profileId, ...(await this.stopProfile(profile, options.reason || 'app-quit')) });
    }
    return { ok: results.every((item) => item.ok), results };
  }
}

module.exports = {
  RUNTIME_STATE_VERSION,
  DEFAULT_LIMITS,
  safeAbsoluteProfilePath,
  resolveCrashpadPending,
  scanCrashpadPending,
  pruneCrashpadPending,
  cleanCrashpadPending,
  scanCrashpadPendingAsync,
  pruneCrashpadPendingAsync,
  cleanCrashpadPendingAsync,
  ProfileRuntimeSupervisor
};
