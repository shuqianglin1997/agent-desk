'use strict';

// AgentDesk — Main's own stores: profiles.json and settings.json (read, recover
// from backups, normalise, save atomically with a backup, snapshot before an
// update), the default and managed folders a profile uses, and the session
// marks store. Moved out of src/main.js unchanged; Main's services come
// through `main` (mainContext).

const apps = require('../apps');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../settings');
const windows = require('../windows');
const { SessionMarksStore } = require('../session-marks');
const { normalizeCat } = require('../yard/cats');
const { readJsonStore, snapshotFile, writeJsonStore } = require('../json-store');
const { readProfileFile } = require('../core/profile-file');
const { resolveProfileStore } = require('./profile-store-policy');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

const STORE_VERSION = 2;

function loadProfiles() {
  const storeFile = profilesFile();
  main.ensureDir(path.dirname(storeFile));
  return resolveProfileStore({
    candidates: [storeFile, profilesBackupFile(), profilesPreUpdateBackupFile()],
    exists: fs.existsSync,
    read: readProfileStore,
    normalize: normalizeProfileList,
    persist: saveProfiles,
    version: STORE_VERSION
  });
}

function saveProfiles(profiles, options = {}) {
  writeJsonStore(
    profilesFile(),
    { version: STORE_VERSION, profiles },
    { ...options, backupFile: profilesBackupFile() }
  );
  main.profileRuntimeSupervisor?.updateProfiles(profiles);
  void main.agentHub?.profilesChanged(profiles).catch(() => {});
}

function updateStoredProfile(id, mutator) {
  const profiles = loadProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return null;
  const next = mutator({ ...profiles[index] });
  if (!next || typeof next !== 'object') return profiles[index];
  profiles[index] = normalizeProfile(next);
  saveProfiles(profiles);
  return profiles[index];
}

function loadSettings(legacySettings = {}) {
  const storeFile = settingsFile();
  main.ensureDir(path.dirname(storeFile));
  const loaded = [
    storeFile,
    settingsBackupFile(),
    settingsPreUpdateBackupFile()
  ].map(readSettingsStore).find(Boolean);
  const storedSettings = loaded ? settings.settingsFromPayload(loaded.parsed) : null;
  // localStorage remains a downgrade/crash mirror. If it differs from the
  // stable file, it represents a UI change made by an older build or a change
  // made immediately before the renderer exited, so reconcile it on startup.
  const normalized = loaded
    ? settings.mergeSettings(storedSettings, legacySettings)
    : settings.normalizeSettings(legacySettings);
  const normalizedPayload = {
    version: settings.SETTINGS_VERSION,
    settings: normalized
  };
  const currentPayload = loaded
    ? {
        version: loaded.parsed.version || 0,
        settings: storedSettings
      }
    : null;

  if (
    !loaded ||
    loaded.filePath !== storeFile ||
    JSON.stringify(currentPayload) !== JSON.stringify(normalizedPayload)
  ) {
    saveSettings(normalized, { skipBackup: !loaded || loaded.filePath !== storeFile });
  }
  return normalized;
}

function saveSettings(value, options = {}) {
  writeJsonStore(
    settingsFile(),
    { version: settings.SETTINGS_VERSION, settings: value },
    { ...options, backupFile: settingsBackupFile() }
  );
}

function updateSettings(patch) {
  const current = loadSettings();
  const next = settings.mergeSettings(current, patch);
  if (JSON.stringify(current) !== JSON.stringify(next)) saveSettings(next);
  return next;
}

function readProfileStore(filePath) {
  const result = readProfileFile(filePath);
  return result.ok ? { filePath, parsed: result.value.parsed } : null;
}

function readSettingsStore(filePath) {
  return readJsonStore(filePath, (parsed) => Boolean(settings.settingsFromPayload(parsed)));
}

function normalizeProfileList(profiles) {
  const normalized = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
    .map(normalizeProfile);
  // No account is mandatory. Normalization must preserve an empty store and
  // must not infer required accounts from a provider, platform, or app type.
  // Kimi Code 与 Kimi Work 是同一桌面 App 生态的两个形态，同机必然同登录身份；
  // 这样的客户端由适配器声明 defaultIdentityKey。
  // 只给「从未有过 identityKey 字段」的旧默认槽位补关联（一次性迁移）；
  // 用户显式清空后字段为 null（存在），不再回填 —— 清空必须能生效。
  return normalized.map((profile) => {
    const key = apps.isKnownApp(profile.appId) ? apps.getApp(profile.appId).defaultIdentityKey : null;
    return key && profile.isProtected && profile.identityKey === undefined
      ? { ...profile, identityKey: key }
      : profile;
  });
}

function normalizeProfile(profile) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const appId = apps.isKnownApp(profile.appId) ? profile.appId : apps.DEFAULT_APP;
  const id = profile.id || crypto.randomUUID();
  // Historical field name: this now describes a system-default path slot only.
  // It affects path/launch behavior and presentation, never whether deletion is allowed.
  const isProtected = Boolean(profile.isProtected);
  const profilePathMode = inferProfilePathMode(profile, appId, isProtected);
  const profilePath = profilePathMode === 'auto'
    ? defaultProfilePath(appId)
    : normalizeConfiguredPath(profile.profilePath || defaultProfilePath(appId));
  const sessionRootMode = inferSessionRootMode(profile, appId, profilePath, isProtected);
  const sessionRoot = sessionRootMode === 'auto'
    ? defaultSessionRoot(appId, profilePath, isProtected)
    : normalizeConfiguredPath(profile.sessionRoot || defaultSessionRoot(appId, profilePath, isProtected));
  return {
    // Keep fields introduced by newer versions. Normalizing known fields must
    // never act like a destructive schema migration and erase customizations.
    ...profile,
    // identityKey 的「字段不存在」有语义（从未迁移过，见 normalizeProfileList），
    // 只在字段存在时规范化，不无中生有地写入 null。
    ...(Object.prototype.hasOwnProperty.call(profile, 'identityKey')
      ? {
        identityKey: typeof profile.identityKey === 'string' && profile.identityKey.trim()
          ? profile.identityKey.trim()
          : null
      }
      : {}),
    id,
    appId,
    name: profile.name || `默认 ${managedAppName(appId)}`,
    profilePath,
    sessionRoot,
    profilePathMode,
    sessionRootMode,
    executablePath: profile.executablePath ? normalizeConfiguredPath(profile.executablePath) : null,
    isProtected,
    createdAt: profile.createdAt || new Date().toISOString(),
    lastLaunchedAt: profile.lastLaunchedAt || null,
    group: (profile.group || '').trim(),
    note: profile.note || '',
    cat: normalizeCat(profile.cat, id)
  };
}

function profilesFile() {
  return path.join(main.app.getPath('userData'), 'profiles.json');
}

function profilesBackupFile() {
  return `${profilesFile()}.bak`;
}

function profilesPreUpdateBackupFile() {
  return `${profilesFile()}.pre-update.bak`;
}

function profileRuntimeStateFile() {
  return path.join(main.app.getPath('userData'), 'profile-runtime.json');
}

function settingsFile() {
  return path.join(main.app.getPath('userData'), 'settings.json');
}

// 会话的颜色标签与“看过”的记号：只存在 AgentDesk 自己的 userData 里（docs/SESSION_MARKS_PLAN.md 第 5.3 节）。
let sessionMarksStore = null;

function getSessionMarks() {
  sessionMarksStore ||= new SessionMarksStore({ file: path.join(main.app.getPath('userData'), 'session-marks.json') });
  return sessionMarksStore;
}

function sessionMarksResult(run) {
  try {
    return run(getSessionMarks());
  } catch (_error) {
    return { ok: false, reasonCode: 'session-marks-unavailable' };
  }
}

function sessionMarksFreshContext() {
  try { return getSessionMarks().freshContext(); } catch (_error) { return null; }
}

function settingsBackupFile() {
  return `${settingsFile()}.bak`;
}

function settingsPreUpdateBackupFile() {
  return `${settingsFile()}.pre-update.bak`;
}

function snapshotConfigurationForUpdate() {
  for (const [source, target] of [
    [profilesFile(), profilesPreUpdateBackupFile()],
    [settingsFile(), settingsPreUpdateBackupFile()]
  ]) {
    snapshotFile(source, target);
  }
}

// 以下三个曾按 claude/codex 二元写死，现全部委托给 src/apps.js 注册表，
// 加新工具只改注册表、这里不动。
function defaultProfilePath(appId) {
  return apps.defaultProfilePath(appId);
}

function defaultSessionRoot(appId, profilePath, isDefault) {
  return apps.getApp(appId).defaultSessionRoot(profilePath, isDefault);
}

function makeIsolatedProfilePath(appId, name, id) {
  if (process.platform === 'win32') {
    return windows.managedProfilePath(managedAppName(appId), id);
  }
  const root = path.join(main.app.getPath('userData'), 'Profiles');
  const suffix = String(id || crypto.randomUUID()).slice(0, 8);
  return path.join(root, managedAppName(appId), `${slug(name)}-${suffix}`);
}

function managedAppName(appId) {
  return apps.getApp(appId).appName;
}

function slug(value) {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'account';
}

function inferProfilePathMode(profile, appId, isProtected) {
  if (['auto', 'managed', 'custom'].includes(profile.profilePathMode)) return profile.profilePathMode;
  if (isProtected && isKnownDefaultProfilePath(appId, profile.profilePath)) return 'auto';
  if (!isProtected && isManagedProfilePath(profile.profilePath)) return 'managed';
  return profile.profilePath ? 'custom' : (isProtected ? 'auto' : 'managed');
}

function isKnownDefaultProfilePath(appId, itemPath) {
  if (!itemPath) return false;
  return apps.defaultProfilePathInfo(appId).candidates
    .some((candidate) => main.pathsEqual(candidate.path, itemPath));
}

function inferSessionRootMode(profile, appId, resolvedProfilePath, isProtected) {
  if (['auto', 'managed', 'custom'].includes(profile.sessionRootMode)) return profile.sessionRootMode;
  const legacyProfile = apps.legacyDefaultProfilePath(appId);
  const defaultRoot = defaultSessionRoot(appId, legacyProfile, isProtected);
  if (isProtected && (
    main.pathsEqual(profile.sessionRoot, defaultRoot) ||
    (apps.getApp(appId).sessionsInProfileFolder === true && main.pathsEqual(profile.sessionRoot, profile.profilePath))
  )) return 'auto';
  if (!isProtected && (
    main.pathsEqual(profile.sessionRoot, profile.profilePath) ||
    main.isSubpath(profile.sessionRoot, profile.profilePath) ||
    main.pathsEqual(profile.sessionRoot, resolvedProfilePath) ||
    main.isSubpath(profile.sessionRoot, resolvedProfilePath)
  )) return 'managed';
  return profile.sessionRoot ? 'custom' : (isProtected ? 'auto' : 'managed');
}

function isManagedProfilePath(itemPath) {
  if (!itemPath) return false;
  const oldRoot = path.join(main.app.getPath('userData'), 'Profiles');
  if (main.isSubpath(itemPath, oldRoot)) return true;
  return process.platform === 'win32' && windows.isSubpath(itemPath, windows.managedProfilesRoot());
}

function normalizeConfiguredPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (process.platform === 'win32') return windows.expandWindowsPath(trimmed);
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

module.exports = { bind, loadProfiles, saveProfiles, updateStoredProfile, loadSettings, saveSettings, updateSettings, readProfileStore, readSettingsStore, normalizeProfileList, normalizeProfile, profilesFile, profilesBackupFile, profilesPreUpdateBackupFile, profileRuntimeStateFile, settingsFile, getSessionMarks, sessionMarksResult, sessionMarksFreshContext, settingsBackupFile, settingsPreUpdateBackupFile, snapshotConfigurationForUpdate, defaultProfilePath, defaultSessionRoot, makeIsolatedProfilePath, managedAppName, slug, inferProfilePathMode, isKnownDefaultProfilePath, inferSessionRootMode, isManagedProfilePath, normalizeConfiguredPath };
