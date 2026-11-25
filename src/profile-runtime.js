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
const paths = require('./core/paths');
const { readJsonStore, writeJsonStore } = require('./json-store');
const apps = require('./apps');

// The client's opt-in history upkeep (Codex), or null.
const historyUpkeepOf = (profile) => (apps.isKnownApp(profile?.appId) ? apps.getApp(profile.appId).historyUpkeep || null : null);
const {
  snapshotProcessRecords,
  collectProcessRecords,
  findProfileProcesses,
  findProfileClientProcesses
} = require('./process');

// Version 2 (docs/ORDERLY_UPDATE_PLAN.md §4): each record also keeps the app
// version and bundle a launch started from, and each client keeps its open
// set (the accounts AgentDesk had open since the set was last empty). A
// version 1 file loads with those unknown and is written as version 2.
const RUNTIME_STATE_VERSION = 2;
const RUNTIME_STATE_VERSIONS = new Set([1, 2]);
const VERSION_TEXT = /^[0-9A-Za-z.+-]{1,64}$/;
const launchVersionOf = (value) => (typeof value === 'string' && VERSION_TEXT.test(value) ? value : null);
const launchBundleOf = (value) => (typeof value === 'string' && path.isAbsolute(value) && value.length <= 1024 ? path.resolve(value) : null);
const isoOrNull = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeRun(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.members)) return null;
  const members = [];
  for (const member of value.members.slice(0, 256)) {
    if (!member || typeof member.profileId !== 'string' || members.some((item) => item.profileId === member.profileId)) continue;
    members.push({ profileId: member.profileId, appVersion: launchVersionOf(member.appVersion), appBundle: launchBundleOf(member.appBundle) });
  }
  if (!members.length) return null;
  return {
    members,
    startedAt: isoOrNull(value.startedAt),
    endedAt: isoOrNull(value.endedAt),
    endReason: typeof value.endReason === 'string' && RUN_ID.test(value.endReason) ? value.endReason : null
  };
}
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
  if (!paths.isInside(realPendingPath, realProfileRoot, { resolve: false })) throw new Error('crashpad-path-outside-profile');
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
    // Process lists: the periodic tick and the launch and stop paths await a
    // shared snapshot (`snapshotProcessRecords(options)` may return a promise);
    // status() reads the most recent one and only collects synchronously when
    // there is none recent (right after a launch, or before the first tick).
    this.snapshot = options.snapshotProcessRecords || (() => collectProcessRecords());
    this.snapshotSync = options.snapshotProcessRecordsSync || options.snapshotProcessRecords || snapshotProcessRecords;
    this.lastSnapshot = null;
    this.signal = options.signalProcess || ((pid, signal) => process.kill(pid, signal));
    this.platform = options.platform || process.platform;
    this.isManagedProfile = typeof options.isManagedProfile === 'function'
      ? options.isManagedProfile
      : () => false;
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    // The periodic tick: Main hands in its owner's scheduler (src/main/owner.js);
    // it must keep running while the window is hidden (disk and process guard).
    this.schedule = typeof options.schedule === 'function' ? options.schedule : (run, ms) => {
      const timer = setInterval(run, ms);
      timer.unref?.();
      return { cancel: () => clearInterval(timer) };
    };
    this.onIncident = typeof options.onIncident === 'function' ? options.onIncident : () => {};
    this.maintainHistory = options.maintainHistory || ((profile, opts) => historyUpkeepOf(profile).run(profile, opts));
    this.historyMaintenance = new Map();
    this.historyMaintenanceNext = new Map();
    this.profiles = new Map();
    this.records = new Map();
    // Per client (appId): the open set, { members, startedAt, endedAt, endReason }.
    this.runs = new Map();
    this.crashpadStatuses = new Map();
    this.timer = null;
    this.tickPromise = null;
    this.loadState();
  }

  loadState() {
    if (!this.stateFile) return;
    const loaded = readJsonStore(this.stateFile, (value) => (
      value && RUNTIME_STATE_VERSIONS.has(value.version) && Array.isArray(value.records)
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
        appVersion: launchVersionOf(item.appVersion),
        appBundle: launchBundleOf(item.appBundle),
        fusedAt: legacyBurstFuse ? null : (typeof item.fusedAt === 'string' ? item.fusedAt : null),
        fuseReason: legacyBurstFuse ? null : (typeof item.fuseReason === 'string' ? item.fuseReason : null),
        lastIncident: item.lastIncident && typeof item.lastIncident === 'object'
          ? item.lastIncident
          : null
      });
    }
    const runs = loaded?.parsed?.runs;
    if (runs && typeof runs === 'object' && !Array.isArray(runs)) {
      for (const [appId, value] of Object.entries(runs)) {
        const run = RUN_ID.test(appId) ? normalizeRun(value) : null;
        if (run) this.runs.set(appId, run);
      }
    }
    if (migratedLegacyBurstFuse) this.saveState();
  }

  saveState() {
    if (!this.stateFile) return;
    this.fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    try { this.fs.chmodSync(path.dirname(this.stateFile), 0o700); } catch (_error) { /* best effort */ }
    writeJsonStore(this.stateFile, {
      version: RUNTIME_STATE_VERSION,
      records: [...this.records.values()],
      runs: Object.fromEntries(this.runs)
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
    this.timer = this.schedule(runTick, this.limits.pollIntervalMs);
    runTick();
  }

  stopMonitoring() {
    if (this.timer) this.timer.cancel();
    this.timer = null;
  }

  async takeSnapshot(options = {}) {
    const records = await this.snapshot(options);
    this.lastSnapshot = { at: this.now(), records: Array.isArray(records) ? records : null };
    return this.lastSnapshot.records;
  }

  recentRecords() {
    if (this.lastSnapshot && this.now() - this.lastSnapshot.at <= this.limits.pollIntervalMs + 500) return this.lastSnapshot.records;
    let records = this.snapshotSync();
    // An asynchronous source cannot answer here: unknown, never a guess.
    if (records && typeof records.then === 'function') { records.catch?.(() => {}); records = null; }
    this.lastSnapshot = { at: this.now(), records: Array.isArray(records) ? records : null };
    return this.lastSnapshot.records;
  }

  ownProcesses(records, profile, finder) {
    if (records === null) return null;
    return finder(records, profile.profilePath)
      .filter((record) => record.pid !== process.pid && record.pid !== process.ppid);
  }

  // Fresh by default: launch and stop decisions never use an old list.
  async processRecords(profile, options = { maxAgeMs: 0 }) {
    return this.ownProcesses(await this.takeSnapshot(options), profile, findProfileProcesses);
  }

  async clientProcessRecords(profile, options = { maxAgeMs: 0 }) {
    return this.ownProcesses(await this.takeSnapshot(options), profile, findProfileClientProcesses);
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
    const processes = this.ownProcesses(this.recentRecords(), profile, findProfileClientProcesses);
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
    // A relaunch must not race opt-in maintenance of the same closed client.
    await this.historyMaintenance.get(profile.id);
    this.updateProfiles([...this.profiles.values(), profile]);
    await this.tick();
    await this.historyMaintenance.get(profile.id);
    const processes = await this.clientProcessRecords(profile);
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

  // launch: { pid, appVersion, appBundle } — the app version and bundle this
  // launch started from, when the launcher could read them (else unknown).
  registerLaunch(profile, launch = {}) {
    const record = {
      profileId: profile.id,
      profilePath: profile.profilePath,
      launchPid: Number.isInteger(launch.pid) ? launch.pid : null,
      launchedAt: new Date(this.now()).toISOString(),
      active: true,
      owned: true,
      appVersion: launchVersionOf(launch.appVersion),
      appBundle: launchBundleOf(launch.appBundle),
      fusedAt: null,
      fuseReason: null,
      lastIncident: this.records.get(profile.id)?.lastIncident || null
    };
    this.records.set(profile.id, record);
    this.updateProfiles([...this.profiles.values(), profile]);
    this.joinOpenSet(profile, record);
    this.saveState();
    // The list from before this launch cannot show the new client.
    this.lastSnapshot = null;
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
    const matched = await this.processRecords(profile);
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
      if (record.owned) this.leaveOpenSet(profile, reason);
      this.saveState();
      if (record.owned) void this.maintainStoppedHistory(profile);
      return { ok: true, stopped: 0, remaining: 0 };
    }

    for (const item of matched) {
      try { this.signal(item.pid, 'SIGTERM'); } catch (_error) { /* verify below */ }
    }
    await delay(this.limits.terminateGraceMs);
    const afterTerm = await this.processRecords(profile);
    if (afterTerm === null) return { ok: false, reasonCode: 'profile-process-snapshot-unavailable' };
    for (const item of afterTerm) {
      try { this.signal(item.pid, 'SIGKILL'); } catch (_error) { /* verify below */ }
    }
    if (afterTerm.length) await delay(Math.min(500, this.limits.terminateGraceMs));
    const remainingRecords = await this.processRecords(profile);
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
    if (remaining === 0 && record.owned) this.leaveOpenSet(profile, reason);
    this.saveState();
    if (remaining === 0 && record.owned) void this.maintainStoppedHistory(profile);
    return remaining === 0
      ? { ok: true, stopped: matched.length, remaining: 0 }
      : { ok: false, reasonCode: 'profile-process-still-running', stopped: matched.length, remaining };
  }

  async stopProfile(profile, reason = 'user-request') {
    return this.terminateProcesses(profile, reason);
  }

  // The open set of one client: a launch joins it (a new set starts when the
  // last one had ended); when AgentDesk's last open account of that client has
  // exited, the set ends with the reason of that last exit. Only AgentDesk's
  // own launches are members. Callers save the state.
  joinOpenSet(profile, record) {
    const appId = typeof profile?.appId === 'string' && RUN_ID.test(profile.appId) ? profile.appId : null;
    if (!appId) return;
    const current = this.runs.get(appId);
    const run = current && !current.endedAt
      ? current
      : { members: [], startedAt: record.launchedAt, endedAt: null, endReason: null };
    run.members = [
      ...run.members.filter((member) => member.profileId !== profile.id),
      { profileId: profile.id, appVersion: record.appVersion, appBundle: record.appBundle }
    ];
    this.runs.set(appId, run);
  }

  leaveOpenSet(profile, reason) {
    const appId = profile?.appId;
    const run = appId ? this.runs.get(appId) : null;
    if (!run || run.endedAt) return;
    if (this.ownedOpenProfiles(appId).some((item) => item.profile.id !== profile.id)) return;
    run.endedAt = new Date(this.now()).toISOString();
    run.endReason = RUN_ID.test(String(reason)) ? String(reason) : 'exited';
  }

  // AgentDesk's own launches of one client that have not been seen to exit,
  // with the version and bundle each started from. Read-only.
  ownedOpenProfiles(appId) {
    const open = [];
    for (const [profileId, record] of this.records) {
      const profile = this.profiles.get(profileId);
      if (!record.owned || !record.active || !profile || profile.appId !== appId) continue;
      open.push({ profile, appVersion: record.appVersion || null, appBundle: record.appBundle || null, launchedAt: record.launchedAt || null });
    }
    return open;
  }

  // The client's open set as last recorded (a copy), or null.
  openSet(appId) {
    const run = this.runs.get(appId);
    return run ? { ...run, members: run.members.map((member) => ({ ...member })) } : null;
  }

  async maintainStoppedHistory(profile, options = {}) {
    if (!historyUpkeepOf(profile)) return;
    if (this.historyMaintenance.has(profile.id)) return this.historyMaintenance.get(profile.id);
    this.historyMaintenanceNext.set(profile.id, this.now() + 60 * 60 * 1000);
    const task = Promise.resolve().then(() => this.maintainHistory(profile, options)).catch(() => ({ skipped: 'history-maintenance-deferred' }));
    this.historyMaintenance.set(profile.id, task);
    try { return await task; }
    finally { this.historyMaintenance.delete(profile.id); }
  }

  historyPolicySelected(profile) {
    // An explicitly enabled canonical root is also authorized for default/custom
    // clients. No Crashpad ownership exception is inherited by this adapter.
    try { return historyUpkeepOf(profile)?.policySelected(profile.sessionRoot) === true; }
    catch { return false; }
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
      // Reuse the existing supervisor, including for clients kept open for days.
      // Only opted-in roots are writable; live clients permit old archived turns
      // only. One background worker at a time avoids a startup I/O burst.
      if (historyUpkeepOf(profile) &&
          this.historyMaintenance.size === 0 &&
          this.now() >= (this.historyMaintenanceNext.get(profile.id) || 0) &&
          (this.isManagedProfile(profile) || record?.owned || this.historyPolicySelected(profile))) {
        void this.maintainStoppedHistory(profile, { openArchived: true, openIdle: true });
      }
      if (record?.owned && record.active) {
        // One shared list per tick, not one `ps` per profile.
        const clients = await this.clientProcessRecords(profile, { maxAgeMs: this.limits.pollIntervalMs / 2 });
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

  // 退出前要关掉的那几个：AgentDesk 自己启动、现在还在运行的 Profile。只读，不改任何记录。
  ownedActiveProfileIds() {
    const ids = [];
    for (const [profileId, record] of this.records) {
      if (record.owned && record.active && this.profiles.has(profileId)) ids.push(profileId);
    }
    return ids;
  }

  async stopAll(options = {}) {
    this.stopMonitoring();
    if (options.terminateOwned !== true) return { ok: true, results: [] };
    const results = [];
    for (const [profileId, record] of this.records) {
      if (!record.owned || !record.active) continue;
      const profile = this.profiles.get(profileId);
      if (!profile) continue;
      const result = { profileId, ...(await this.stopProfile(profile, options.reason || 'app-quit')) };
      results.push(result);
      // 每关好一个就说一声（关灯时对应的猫先睡下）；回调出错不影响收口。
      if (result.ok && typeof options.onStopped === 'function') {
        try { options.onStopped(profileId); } catch (_error) { /* presentation only */ }
      }
    }
    await Promise.all([...this.historyMaintenance.values()]);
    return { ok: results.every((item) => item.ok), results };
  }
}

module.exports = {
  RUNTIME_STATE_VERSION,
  RUNTIME_STATE_VERSIONS,
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
