const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const apps = require('./apps');
const { probeActivity } = require('./activity');
const { isDefaultWindowsAppRunning, isRunningIn, snapshotProcesses } = require('./process');
const { readJsonStore, writeJsonStore, snapshotFile } = require('./json-store');
const { nearestExistingDirectory } = require('./path-utils');
const settings = require('./settings');
const updater = require('./updater');
const windows = require('./windows');
const { QuotaService } = require('./quota-service');
const { normalizeCat } = require('./yard/cats');

const APP_NAME = 'AgentDesk';
const STORE_VERSION = 2;
const WINDOWS_DISCOVERY_TTL = 30_000;
const UPDATE_CACHE_TTL = 5 * 60_000;
const UPDATE_CHECK_TIMEOUT = 15_000;
const UPDATE_DOWNLOAD_TIMEOUT = 30 * 60_000;
const windowsDiscoveryCache = new Map();
let latestUpdateCache = null;
let updateInstalling = false;
let mainWindow = null;
const quotaService = new QuotaService();
const PROFILE_COPY_EXCLUDES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'crashpad',
  'dawncache',
  'shadercache'
]);

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  return mainWindow;
}

function showMainWindow() {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow();
    else app.whenReady().then(showMainWindow);
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function registerIpc() {
  ipcMain.handle('apps:list', () => {
    return apps.listApps();
  });

  ipcMain.handle('settings:get', (_event, legacySettings = {}) => {
    return loadSettings(legacySettings);
  });

  ipcMain.handle('settings:update', (_event, patch = {}) => {
    return updateSettings(patch);
  });

  ipcMain.handle('updates:check', async () => {
    return checkForUpdates({ force: true });
  });

  ipcMain.handle('updates:install', async (event) => {
    return installLatestUpdate(event.sender);
  });

  ipcMain.handle('profiles:list', () => {
    return loadProfiles();
  });

  ipcMain.handle('profiles:add', (_event, input) => {
    const profiles = loadProfiles();
    const appId = apps.isKnownApp(input.appId) ? input.appId : apps.DEFAULT_APP;
    const name = String(input.name || '').trim() || `${apps.getApp(appId).label} 账号`;
    const id = crypto.randomUUID();
    const profilePath = makeIsolatedProfilePath(appId, name, id);
    const profile = normalizeProfile({
      id,
      appId,
      name,
      profilePath,
      sessionRoot: defaultSessionRoot(appId, profilePath, false),
      profilePathMode: 'managed',
      sessionRootMode: 'managed',
      isProtected: false,
      createdAt: new Date().toISOString(),
      lastLaunchedAt: null,
      group: input.group,
      note: input.note
    });

    ensureDir(profile.profilePath);
    ensureDir(profile.sessionRoot);
    profiles.push(profile);
    saveProfiles(profiles);
    return profile;
  });

  ipcMain.handle('profiles:update', (_event, input) => {
    const updated = updateStoredProfile(input.id, (profile) => {
      const next = { ...profile };
      if (typeof input.name === 'string') next.name = input.name.trim() || next.name;
      if (typeof input.profilePath === 'string' && input.profilePath.trim()) {
        const profilePath = normalizeConfiguredPath(input.profilePath);
        if (!pathsEqual(profilePath, next.profilePath)) next.profilePathMode = 'custom';
        next.profilePath = profilePath;
      }
      if (typeof input.sessionRoot === 'string' && input.sessionRoot.trim()) {
        const sessionRoot = normalizeConfiguredPath(input.sessionRoot);
        if (!pathsEqual(sessionRoot, next.sessionRoot)) next.sessionRootMode = 'custom';
        next.sessionRoot = sessionRoot;
      }
      if (typeof input.executablePath === 'string') {
        next.executablePath = input.executablePath.trim()
          ? normalizeConfiguredPath(input.executablePath)
          : null;
      }
      if (typeof input.group === 'string') next.group = input.group.trim();
      if (typeof input.note === 'string') next.note = input.note;
      if (input.cat && typeof input.cat === 'object') next.cat = { ...next.cat, ...input.cat };
      return next;
    });
    quotaService.invalidate(input.id);
    return updated;
  });

  ipcMain.handle('profiles:remove', (_event, id) => {
    const profiles = loadProfiles();
    const target = profiles.find((profile) => profile.id === id);
    if (!target || target.isProtected) return { ok: false, reason: '默认槽位不能移除' };
    saveProfiles(profiles.filter((profile) => profile.id !== id));
    quotaService.invalidate(id);
    return { ok: true };
  });

  ipcMain.handle('profiles:migrateWindowsPath', async (_event, id) => {
    return migrateWindowsProfilePath(id);
  });

  ipcMain.handle('profiles:launch', async (_event, id) => {
    const profiles = loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return { ok: false, reason: '找不到账号槽位' };

    const profile = profiles[index];
    const result = await launchProfile(profile);
    if (result.ok) {
      // Launch discovery can take several seconds on Windows. Reload the
      // latest profile before committing the timestamp so an edit made while
      // discovery was running cannot be overwritten by this stale snapshot.
      updateStoredProfile(id, (current) => ({
        ...current,
        lastLaunchedAt: new Date().toISOString()
      }));
    }
    return result;
  });

  ipcMain.handle('sessions:list', (_event, profile) => {
    if (!profile) return [];
    const normalized = normalizeProfile(profile);
    return apps.getApp(normalized.appId).scan(normalized);
  });

  ipcMain.handle('sessions:reveal', async (_event, input = {}) => {
    return revealSessionFile(input);
  });

  ipcMain.handle('activity:all', () => {
    const profiles = loadProfiles();
    // 进程快照采一次，供所有账号匹配；null 表示探测不可用（上层退回按活跃度）
    const psText = snapshotProcesses();
    return profiles.map((profile) => ({
      ...probeActivity(profile),
      running: psText === null ? null : profileIsRunning(psText, profile)
    }));
  });

  ipcMain.handle('quota:all', async (_event, options = {}) => {
    return quotaService.getAll(loadProfiles(), {
      force: options.force === true,
      clientVersion: app.getVersion()
    });
  });

  ipcMain.handle('diagnostics:get', (_event, profile) => {
    if (!profile) return null;
    return diagnoseProfile(normalizeProfile(profile));
  });

  ipcMain.handle('system:pickDirectory', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: options.title || '选择目录',
      defaultPath: options.defaultPath || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('system:pickFile', async (_event, options = {}) => {
    const dialogOptions = {
      title: options.title || '选择文件',
      defaultPath: options.defaultPath || app.getPath('home'),
      properties: ['openFile']
    };
    if (process.platform === 'win32') {
      dialogOptions.filters = [
        { name: 'Windows 应用', extensions: ['exe'] },
        { name: '所有文件', extensions: ['*'] }
      ];
    }
    const result = await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('system:showItem', async (_event, itemPath) => {
    return revealPath(itemPath);
  });

  ipcMain.handle('system:openPath', async (_event, itemPath) => {
    return openPathSafely(itemPath);
  });

  ipcMain.handle('clipboard:writeText', (_event, value) => {
    clipboard.writeText(String(value || ''));
    return true;
  });
}

async function checkForUpdates(options = {}) {
  try {
    const update = await latestUpdateInfo(Boolean(options.force));
    return publicUpdateInfo(update);
  } catch (error) {
    return { ok: false, reason: updateErrorMessage(error) };
  }
}

async function latestUpdateInfo(force = false) {
  if (
    !force &&
    latestUpdateCache &&
    Date.now() - latestUpdateCache.at < UPDATE_CACHE_TTL
  ) {
    return latestUpdateCache.value;
  }

  const release = await fetchLatestGitHubRelease();
  const resolved = updater.resolveRelease(release, {
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  });
  const capability = updateCapability(resolved);
  const value = { resolved, capability };
  latestUpdateCache = { at: Date.now(), value };
  return value;
}

async function fetchLatestGitHubRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT);
  try {
    const response = await net.fetch(updater.LATEST_RELEASE_API, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      bypassCustomProtocolHandlers: true,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${APP_NAME}/${app.getVersion()}`,
        'X-GitHub-Api-Version': updater.GITHUB_API_VERSION
      }
    });
    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 404) {
        throw new Error('GitHub 暂无已正式发布的 Release；草稿和仅有 Git tag 的版本不会用于自动更新。');
      }
      if (response.status === 403 && remaining === '0') {
        throw new Error('GitHub API 请求次数暂时用完，请稍后再试。');
      }
      throw new Error(`GitHub Release 查询失败（HTTP ${response.status}）。`);
    }
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error('GitHub Release 响应异常过大。');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function updateCapability(resolved) {
  if (!resolved.updateAvailable) {
    return { installSupported: false, mode: 'none', reason: null, targetPath: null };
  }
  if (!resolved.asset) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: '最新版暂时没有适用于当前系统的安装包。',
      targetPath: null
    };
  }
  if (process.platform !== 'win32') {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: 'macOS 版本需要从 Release 页面打开 DMG 完成替换。',
      targetPath: null
    };
  }
  if (!app.isPackaged) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: '开发模式不会覆盖源码运行环境。',
      targetPath: null
    };
  }

  const targetPath = updater.portableExecutablePath(process.env);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: '当前不是由 Windows portable exe 启动，无法安全地自我替换。',
      targetPath: null
    };
  }
  if (!resolved.asset.sha256) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: 'Release 未提供 GitHub SHA-256 digest，已禁止自动覆盖。',
      targetPath: null
    };
  }
  try {
    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (_error) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: '当前 portable exe 所在目录不可写，请从 GitHub 手动下载更新。',
      targetPath: null
    };
  }
  return {
    installSupported: true,
    mode: 'windows-portable',
    reason: null,
    targetPath
  };
}

function publicUpdateInfo(update) {
  const { resolved, capability } = update;
  return {
    ok: true,
    currentVersion: resolved.currentVersion,
    latestVersion: resolved.latestVersion,
    updateAvailable: resolved.updateAvailable,
    releaseUrl: resolved.releaseUrl,
    publishedAt: resolved.publishedAt,
    notes: resolved.notes,
    assetName: resolved.asset?.name || null,
    assetSize: resolved.asset?.size || null,
    installSupported: capability.installSupported,
    installMode: capability.mode,
    manualReason: capability.reason,
    platform: process.platform,
    packaged: app.isPackaged
  };
}

async function installLatestUpdate(webContents) {
  if (updateInstalling) return { ok: false, reason: '更新正在进行中。' };

  let update;
  try {
    update = await latestUpdateInfo(false);
  } catch (error) {
    return { ok: false, reason: updateErrorMessage(error) };
  }

  const { resolved, capability } = update;
  if (!resolved.updateAvailable) {
    return { ok: true, upToDate: true, message: `当前已经是最新版 v${resolved.currentVersion}。` };
  }

  if (!capability.installSupported) {
    try {
      await shell.openExternal(resolved.releaseUrl);
      return {
        ok: true,
        manual: true,
        message: capability.reason || '已打开 GitHub Release 页面。'
      };
    } catch (error) {
      return { ok: false, reason: `无法打开 GitHub Release：${error.message}` };
    }
  }

  updateInstalling = true;
  let restarting = false;
  try {
    sendUpdateProgress(webContents, {
      stage: 'preparing',
      percent: 0,
      message: `准备下载 v${resolved.latestVersion}…`
    });
    const downloadedPath = await downloadReleaseAsset(resolved, webContents);
    sendUpdateProgress(webContents, {
      stage: 'installing',
      percent: 100,
      message: '校验完成，正在准备替换并重启…'
    });
    // Preserve the exact current user configuration immediately before the
    // executable is replaced. These snapshots are outside the portable exe
    // and remain available if a future schema or interrupted write misbehaves.
    snapshotConfigurationForUpdate();
    await launchWindowsPortableUpdater(downloadedPath, capability.targetPath);
    restarting = true;
    setTimeout(() => app.quit(), 600);
    return {
      ok: true,
      restarting: true,
      message: `v${resolved.latestVersion} 已下载并校验，AgentDesk 即将重启。`
    };
  } catch (error) {
    sendUpdateProgress(webContents, {
      stage: 'error',
      percent: null,
      message: updateErrorMessage(error)
    });
    return { ok: false, reason: updateErrorMessage(error) };
  } finally {
    if (!restarting) updateInstalling = false;
  }
}

async function downloadReleaseAsset(resolved, webContents) {
  const asset = resolved.asset;
  if (!asset?.url || !asset.sha256) throw new Error('Release 资产缺少安全校验信息。');

  const updateDir = path.join(app.getPath('temp'), 'AgentDesk-updates');
  ensureDir(updateDir);
  const safeName = path.basename(asset.name).replace(/[^a-z0-9._ -]+/gi, '-');
  const finalPath = path.join(updateDir, `${resolved.latestVersion}-${safeName}`);
  const partialPath = `${finalPath}.partial`;
  try { fs.rmSync(partialPath, { force: true }); } catch (_error) { /* best effort */ }
  try { fs.rmSync(finalPath, { force: true }); } catch (_error) { /* best effort */ }

  let timedOut = false;
  let received = 0;
  let lastProgressAt = 0;
  let lastPercent = -1;
  const hash = crypto.createHash('sha256');
  const download = createTrustedDownloadRequest(asset.url, {
    Accept: 'application/octet-stream',
    'User-Agent': `${APP_NAME}/${app.getVersion()}`
  });
  const timer = setTimeout(() => {
    timedOut = true;
    download.request?.abort();
  }, UPDATE_DOWNLOAD_TIMEOUT);

  try {
    const { response } = await download.response;
    const statusCode = Number(response.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new Error(`更新包下载失败（HTTP ${statusCode || '-'}）。`);
    }

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.from(chunk);
        received += buffer.length;
        hash.update(buffer);
        const percent = asset.size > 0
          ? Math.min(100, Math.floor((received / asset.size) * 100))
          : null;
        const now = Date.now();
        if (
          percent === 100 ||
          (percent !== lastPercent && now - lastProgressAt >= 150)
        ) {
          lastPercent = percent;
          lastProgressAt = now;
          sendUpdateProgress(webContents, {
            stage: 'downloading',
            percent,
            received,
            total: asset.size,
            message: percent === null ? '正在下载更新…' : `正在下载更新… ${percent}%`
          });
        }
        callback(null, buffer);
      }
    });

    await pipeline(
      response,
      meter,
      fs.createWriteStream(partialPath, { flags: 'wx' })
    );

    if (received !== asset.size) {
      throw new Error(`更新包大小不一致（预期 ${asset.size}，实际 ${received}）。`);
    }
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) throw new Error('更新包 SHA-256 校验失败，已停止覆盖。');
    fs.renameSync(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    try { fs.rmSync(partialPath, { force: true }); } catch (_error) { /* best effort */ }
    if (timedOut) throw new Error('更新包下载超时，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createTrustedDownloadRequest(url, headers) {
  let request;
  const response = new Promise((resolve, reject) => {
    let settled = false;
    let redirects = 0;
    let currentUrl = url;
    let failure = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    request = net.request({
      method: 'GET',
      url,
      redirect: 'manual',
      credentials: 'omit',
      headers
    });
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      redirects += 1;
      if (redirects > 5) {
        failure = new Error('更新包下载重定向次数过多。');
        finish(reject, failure);
        request.abort();
        return;
      }
      if (!updater.isTrustedDownloadResponseUrl(redirectUrl)) {
        failure = new Error('更新包被重定向到了非 GitHub 下载地址。');
        finish(reject, failure);
        request.abort();
        return;
      }
      currentUrl = redirectUrl;
      try {
        request.followRedirect();
      } catch (error) {
        failure = error;
        finish(reject, error);
        request.abort();
      }
    });
    request.once('response', (incoming) => {
      if (!updater.isTrustedDownloadResponseUrl(currentUrl)) {
        failure = new Error('更新包响应来自非 GitHub 下载地址。');
        finish(reject, failure);
        request.abort();
        return;
      }
      finish(resolve, { response: incoming, finalUrl: currentUrl });
    });
    request.once('error', (error) => finish(reject, failure || error));
    request.once('abort', () => {
      finish(reject, failure || new Error('更新包下载已取消。'));
    });
    request.once('close', () => {
      finish(reject, failure || new Error('更新包连接意外关闭。'));
    });
    request.end();
  });
  return { request, response };
}

async function launchWindowsPortableUpdater(downloadedPath, targetPath) {
  const updateDir = path.dirname(downloadedPath);
  const scriptPath = path.join(updateDir, `apply-update-${Date.now()}.ps1`);
  const logPath = path.join(updateDir, 'update-error.log');
  fs.writeFileSync(scriptPath, updater.windowsUpdaterScript(), 'ascii');

  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ProcessId',
    String(process.pid),
    '-Source',
    downloadedPath,
    '-Target',
    targetPath,
    '-LogPath',
    logPath
  ];

  let lastError = null;
  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    try {
      await spawnDetached(executable, args, { ...process.env });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法启动 Windows 更新替换器：${lastError?.message || 'PowerShell 不可用'}`);
}

function sendUpdateProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('updates:progress', payload);
  } catch (_error) {
    // The download can outlive a window that was closed during the update.
  }
}

function updateErrorMessage(error) {
  if (error?.name === 'AbortError') return '连接 GitHub 超时，请检查网络后重试。';
  if (error instanceof SyntaxError) return 'GitHub Release 返回了无法解析的数据。';
  return error?.message || '更新失败。';
}

function loadProfiles() {
  const storeFile = profilesFile();
  ensureDir(path.dirname(storeFile));

  const loaded = [
    storeFile,
    profilesBackupFile(),
    profilesPreUpdateBackupFile()
  ].map(readProfileStore).find(Boolean);
  if (!loaded) {
    const initial = bootstrapProfiles();
    saveProfiles(initial, { skipBackup: true });
    return initial;
  }

  const rawProfiles = Array.isArray(loaded.parsed) ? loaded.parsed : loaded.parsed.profiles;
  const normalized = normalizeProfileList(rawProfiles || []);
  const normalizedPayload = { version: STORE_VERSION, profiles: normalized };
  const currentPayload = Array.isArray(loaded.parsed)
    ? { version: 0, profiles: loaded.parsed }
    : { version: loaded.parsed.version || 0, profiles: loaded.parsed.profiles || [] };

  if (loaded.filePath !== storeFile || JSON.stringify(currentPayload) !== JSON.stringify(normalizedPayload)) {
    saveProfiles(normalized, { skipBackup: loaded.filePath !== storeFile });
  }
  return normalized;
}

function saveProfiles(profiles, options = {}) {
  writeJsonStore(
    profilesFile(),
    { version: STORE_VERSION, profiles },
    { ...options, backupFile: profilesBackupFile() }
  );
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
  ensureDir(path.dirname(storeFile));
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
  return readJsonStore(filePath, (parsed) => (
    Array.isArray(parsed) || (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.profiles)
    )
  ));
}

function readSettingsStore(filePath) {
  return readJsonStore(filePath, (parsed) => Boolean(settings.settingsFromPayload(parsed)));
}

function bootstrapProfiles() {
  return normalizeProfileList([
    {
      id: crypto.randomUUID(),
      appId: 'claude',
      name: '默认 Claude',
      profilePath: defaultProfilePath('claude'),
      sessionRoot: defaultProfilePath('claude'),
      profilePathMode: 'auto',
      sessionRootMode: 'auto',
      isProtected: true,
      createdAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      appId: 'codex',
      name: '默认 Codex',
      profilePath: defaultProfilePath('codex'),
      sessionRoot: defaultSessionRoot('codex', defaultProfilePath('codex'), true),
      profilePathMode: 'auto',
      sessionRootMode: 'auto',
      isProtected: true,
      createdAt: new Date().toISOString()
    }
  ]);
}

function normalizeProfileList(profiles) {
  const normalized = (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
    .map(normalizeProfile);
  if (!normalized.some((profile) => profile.appId === 'claude' && profile.isProtected)) {
    normalized.unshift(normalizeProfile({
      id: crypto.randomUUID(),
      appId: 'claude',
      name: '默认 Claude',
      profilePath: defaultProfilePath('claude'),
      sessionRoot: defaultProfilePath('claude'),
      profilePathMode: 'auto',
      sessionRootMode: 'auto',
      isProtected: true,
      createdAt: new Date().toISOString()
    }));
  }
  if (!normalized.some((profile) => profile.appId === 'codex' && profile.isProtected)) {
    normalized.push(normalizeProfile({
      id: crypto.randomUUID(),
      appId: 'codex',
      name: '默认 Codex',
      profilePath: defaultProfilePath('codex'),
      sessionRoot: defaultSessionRoot('codex', defaultProfilePath('codex'), true),
      profilePathMode: 'auto',
      sessionRootMode: 'auto',
      isProtected: true,
      createdAt: new Date().toISOString()
    }));
  }
  return normalized;
}

function normalizeProfile(profile) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const appId = apps.isKnownApp(profile.appId) ? profile.appId : apps.DEFAULT_APP;
  const id = profile.id || crypto.randomUUID();
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
  return path.join(app.getPath('userData'), 'profiles.json');
}

function profilesBackupFile() {
  return `${profilesFile()}.bak`;
}

function profilesPreUpdateBackupFile() {
  return `${profilesFile()}.pre-update.bak`;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
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
  const root = path.join(app.getPath('userData'), 'Profiles');
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
    .some((candidate) => pathsEqual(candidate.path, itemPath));
}

function inferSessionRootMode(profile, appId, resolvedProfilePath, isProtected) {
  if (['auto', 'managed', 'custom'].includes(profile.sessionRootMode)) return profile.sessionRootMode;
  const legacyProfile = apps.legacyDefaultProfilePath(appId);
  const defaultRoot = defaultSessionRoot(appId, legacyProfile, isProtected);
  if (isProtected && (
    pathsEqual(profile.sessionRoot, defaultRoot) ||
    (appId === 'claude' && pathsEqual(profile.sessionRoot, profile.profilePath))
  )) return 'auto';
  if (!isProtected && (
    pathsEqual(profile.sessionRoot, profile.profilePath) ||
    isSubpath(profile.sessionRoot, profile.profilePath) ||
    pathsEqual(profile.sessionRoot, resolvedProfilePath) ||
    isSubpath(profile.sessionRoot, resolvedProfilePath)
  )) return 'managed';
  return profile.sessionRoot ? 'custom' : (isProtected ? 'auto' : 'managed');
}

function isManagedProfilePath(itemPath) {
  if (!itemPath) return false;
  const oldRoot = path.join(app.getPath('userData'), 'Profiles');
  if (isSubpath(itemPath, oldRoot)) return true;
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

function pathsEqual(left, right) {
  if (!left || !right) return false;
  if (process.platform === 'win32') return windows.pathsEqual(left, right);
  return path.resolve(left) === path.resolve(right);
}

function isSubpath(itemPath, parentPath) {
  if (!itemPath || !parentPath) return false;
  if (process.platform === 'win32') return windows.isSubpath(itemPath, parentPath);
  const relative = path.relative(path.resolve(parentPath), path.resolve(itemPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function profileIsRunning(psText, profile) {
  if (usesWindowsOfficialDefault(profile)) {
    return isDefaultWindowsAppRunning(
      psText,
      apps.getApp(profile.appId).windows?.executableNames || []
    );
  }
  return isRunningIn(psText, profile.profilePath);
}

function usesWindowsOfficialDefault(profile) {
  return process.platform === 'win32' &&
    profile.isProtected &&
    profile.profilePathMode === 'auto';
}

async function launchProfile(profile) {
  const app_ = apps.getApp(profile.appId);
  const appName = app_.appName;
  const windowsDefault = usesWindowsOfficialDefault(profile);

  // Store/MSIX owns the default profile directory and may virtualize it. Let
  // the packaged app create that location itself. Managed profiles live
  // outside AppData and are safe for AgentDesk to create directly.
  try {
    if (!windowsDefault) {
      ensureDir(profile.profilePath);
      ensureDir(profile.sessionRoot);
    } else if (profile.appId === 'codex') {
      ensureDir(profile.sessionRoot);
    }
  } catch (error) {
    return { ok: false, reason: `无法准备账号目录：${error.message}` };
  }

  const args = windowsDefault ? [] : [`--user-data-dir=${profile.profilePath}`];
  const env = app_.launchEnv(profile, { ...process.env });
  if (process.platform === 'win32') windowsDiscoveryCache.clear();
  const launcher = findExecutable(profile);

  try {
    if (process.platform === 'darwin') {
      if (launcher.found) {
        await spawnDetached(launcher.path, args, env);
        return { ok: true, command: launcher.path, source: launcher.source };
      }

      await spawnDetached('/usr/bin/open', ['-n', '-a', appName, '--args', ...args], env);
      return { ok: true, command: `open -a ${appName}`, warning: '没有在标准路径找到 App，已交给 macOS Launch Services 查找。' };
    }

    if (process.platform === 'win32') {
      const failures = [];
      for (const executable of launcher.candidateDetails.filter((item) => item.exists)) {
        try {
          await spawnDetached(executable.path, args, env);
          return {
            ok: true,
            command: executable.path,
            source: executable.source,
            warning: executable.source?.startsWith('Microsoft Store / MSIX')
              ? '已通过当前 Store/MSIX 包启动；应用更新后会在下次打开时重新定位。'
              : null
          };
        } catch (error) {
          failures.push(`${executable.path}: ${error.message}`);
        }
      }

      if (windowsDefault && launcher.protocolAvailable) {
        await shell.openExternal(app_.windows.protocol);
        return {
          ok: true,
          command: app_.windows.protocol,
          source: 'Windows 协议',
          warning: '已通过系统协议打开默认账号。协议启动不支持独立账号参数。'
        };
      }

      const suffix = failures.length ? ` 已找到的启动器也无法运行：${failures[0]}` : '';
      return {
        ok: false,
        reason: `找不到可用的 ${appName} 桌面启动器。请在「路径」里手动选择 ${appName}.exe，或先安装官方 App。${suffix}`
      };
    }

    await spawnDetached(launcher.path || appName.toLowerCase(), args, env);
    return { ok: true, command: launcher.path || appName.toLowerCase() };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function diagnoseProfile(profile) {
  const appName = managedAppName(profile.appId);
  const executable = findExecutable(profile);
  executable.protocolUsable = usesWindowsOfficialDefault(profile) && executable.protocolAvailable;
  executable.launchable = executable.found || executable.protocolUsable;
  executable.configuredPath = profile.executablePath || null;
  const profilePath = inspectPath(profile.profilePath, { createable: true });
  const sessionRoot = inspectPath(profile.sessionRoot, { createable: true });
  const app_ = apps.getApp(profile.appId);
  const sessionAreas = app_.diagnosticAreas(profile).map((area) => ({
    ...area,
    ...inspectPath(area.path, { createable: false })
  }));
  const sessions = app_.scan(profile);
  const warnings = [];
  const defaultProfile = apps.defaultProfilePathInfo(profile.appId);
  const migration = windowsMigrationInfo(profile);

  if (!executable.found && !executable.protocolUsable) {
    warnings.push(`未在标准路径找到 ${appName} 官方 App。`);
  }
  if (executable.explicitMissing) {
    warnings.push('手动指定的官方 App 路径已失效，当前已回退到自动查找。');
  }
  if (!profilePath.exists) {
    warnings.push('账号数据目录还不存在，打开账号时会自动创建。');
  } else if (!profilePath.readable || !profilePath.writable) {
    warnings.push('账号数据目录权限不足。');
  }
  if (!sessionRoot.exists) {
    warnings.push('会话根目录不存在，当前槽位暂时不会读到会话。');
  } else if (!sessionRoot.readable) {
    warnings.push('会话根目录不可读取。');
  }
  if (sessions.length === 0 && sessionRoot.exists && sessionRoot.readable) {
    warnings.push(`会话根目录可读，但没有匹配到 ${app_.label} 会话文件。`);
  }
  if (process.platform === 'win32' && migration.needed) {
    warnings.push('这个账号槽位位于 AppData。Store/MSIX 会把它重定向到包私有目录，Explorer 和 AgentDesk 可能看到不同位置；建议执行路径迁移。');
  }
  if (
    process.platform === 'win32' &&
    !usesWindowsOfficialDefault(profile) &&
    windows.isPathInsideWindowsAppData(profile.sessionRoot) &&
    !isSubpath(profile.sessionRoot, profile.profilePath)
  ) {
    warnings.push('会话根目录仍位于 AppData 且不在账号目录内，MSIX 也可能重定向它；建议改到用户主目录或其他稳定目录。');
  }
  if (process.platform === 'win32' && /[^\x00-\x7f]/.test(profile.profilePath)) {
    warnings.push('账号路径含非 ASCII 字符；部分 Claude Windows 版本创建用户数据目录时存在兼容问题，若启动异常请改用纯英文路径。');
  }
  if (process.platform === 'win32' && Math.max(profile.profilePath.length, profile.sessionRoot.length) >= 240) {
    warnings.push('路径接近 Windows Explorer 的兼容边界；打开位置时将自动退回到可访问的上级目录。');
  }

  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    appName,
    executable,
    profilePath,
    sessionRoot,
    sessionAreas,
    sessionCount: sessions.length,
    storeFile: profilesFile(),
    userData: app.getPath('userData'),
    defaultProfile,
    migration,
    warnings
  };
}

function windowsMigrationInfo(profile) {
  if (process.platform !== 'win32' || usesWindowsOfficialDefault(profile)) {
    return { needed: false, recommendedPath: null, source: null, candidates: [] };
  }
  const recommendedPath = makeIsolatedProfilePath(profile.appId, profile.name, profile.id);
  const risky = windows.isPathInsideWindowsAppData(profile.profilePath);
  const source = windows.chooseWindowsMigrationSource(profile.profilePath, apps.getApp(profile.appId));
  return {
    needed: risky && !pathsEqual(profile.profilePath, recommendedPath),
    recommendedPath,
    source: source.path,
    candidates: source.candidates
  };
}

function inspectPath(itemPath, options = {}) {
  const result = {
    path: itemPath,
    length: String(itemPath || '').length,
    exists: false,
    isDirectory: false,
    isFile: false,
    readable: false,
    writable: false,
    createable: Boolean(options.createable)
  };

  if (!itemPath) return result;

  try {
    const stat = fs.statSync(itemPath);
    result.exists = true;
    result.isDirectory = stat.isDirectory();
    result.isFile = stat.isFile();
  } catch (_error) {
    return result;
  }

  try {
    fs.accessSync(itemPath, fs.constants.R_OK);
    result.readable = true;
  } catch (_error) {
    result.readable = false;
  }

  try {
    fs.accessSync(itemPath, fs.constants.W_OK);
    result.writable = true;
  } catch (_error) {
    result.writable = false;
  }

  return result;
}

function findExecutable(profileOrAppId) {
  const profile = typeof profileOrAppId === 'string'
    ? { appId: profileOrAppId, executablePath: null }
    : profileOrAppId;
  const app_ = apps.getApp(profile.appId);
  const appName = app_.appName;
  const explicitPath = profile.executablePath || null;

  if (process.platform === 'darwin') {
    const candidates = [
      ...(explicitPath ? [explicitPath] : []),
      ...macExecutableCandidates(appName)
    ];
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    return {
      found: Boolean(executable),
      path: executable || null,
      source: executable
        ? (explicitPath && executable === explicitPath ? '手动指定' : '标准应用目录')
        : null,
      candidates,
      candidateDetails: candidates.map((candidate) => ({
        path: candidate,
        source: candidate === explicitPath ? '手动指定' : '标准应用目录',
        exists: fs.existsSync(candidate)
      })),
      explicitMissing: Boolean(explicitPath && !fs.existsSync(explicitPath)),
      protocolAvailable: false
    };
  }

  if (process.platform === 'win32') {
    const registryExecutablePaths = queryWindowsRegistryExecutablePaths(app_) || [];
    const msixRegistryExecutablePaths = queryWindowsMsixRegistryExecutablePaths(app_) || [];
    const appxExecutablePaths = queryWindowsAppxExecutablePaths(app_) || [];
    const resolved = windows.resolveWindowsLauncher(app_, {
      explicitPath,
      registryExecutablePaths,
      msixRegistryExecutablePaths,
      appxExecutablePaths
    });
    return {
      ...resolved,
      protocolAvailable: hasWindowsProtocol(app_),
      discoveryChannels: [
        { source: 'Windows App Paths 注册表', count: registryExecutablePaths.length },
        { source: 'MSIX 包仓库注册表', count: msixRegistryExecutablePaths.length },
        { source: 'Get-AppxPackage', count: appxExecutablePaths.length }
      ]
    };
  }

  const candidates = explicitPath ? [explicitPath, appName.toLowerCase()] : [appName.toLowerCase()];
  const executable = explicitPath && fs.existsSync(explicitPath) ? explicitPath : appName.toLowerCase();
  return {
    found: Boolean(executable),
    path: executable,
    source: explicitPath && executable === explicitPath ? '手动指定' : 'PATH',
    candidates,
    candidateDetails: candidates.map((candidate) => ({
      path: candidate,
      source: candidate === explicitPath ? '手动指定' : 'PATH',
      exists: candidate === executable
    })),
    explicitMissing: Boolean(explicitPath && executable !== explicitPath),
    protocolAvailable: false
  };
}

function macExecutableCandidates(appName) {
  return [
    path.join('/Applications', `${appName}.app`, 'Contents', 'MacOS', appName),
    path.join(os.homedir(), 'Applications', `${appName}.app`, 'Contents', 'MacOS', appName)
  ];
}

function queryWindowsRegistryExecutablePaths(app_) {
  return cachedWindowsDiscovery(`registry:${app_.id}`, () => {
    const output = [];
    const executableNames = app_.windows?.executableNames || [`${app_.appName}.exe`];
    for (const executableName of executableNames) {
      const keys = [
        `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
        `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
        `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`
      ];
      for (const key of keys) {
        try {
          const text = queryWindowsRegistry([key, '/ve']);
          const match = text.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/mi);
          const executable = executableFromCommand(match?.[1]);
          if (executable) output.push(executable);
        } catch (_error) {
          // Missing registry keys are normal.
        }
      }
    }
    return [...new Set(output)];
  });
}

function queryWindowsMsixRegistryExecutablePaths(app_) {
  return cachedWindowsDiscovery(`msix-registry:${app_.id}`, () => {
    let packageList;
    try {
      packageList = queryWindowsRegistry(
        [windows.MSIX_REPOSITORY_PACKAGES_KEY],
        { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }
      );
    } catch (_error) {
      return [];
    }

    const packageKeys = windows.msixRepositoryPackageKeys(app_, packageList, {
      arch: process.arch
    });
    const packageRoots = [];
    // A Store update can briefly leave old package registrations behind.
    // Query several numeric-version-sorted roots and let the normal existence /
    // spawn checks select the first live executable.
    for (const packageKey of packageKeys.slice(0, 16)) {
      try {
        const text = queryWindowsRegistry([packageKey, '/v', 'PackageRootFolder']);
        const packageRoot = windows.registryValueFromQuery(text, 'PackageRootFolder');
        if (packageRoot) packageRoots.push(windows.expandWindowsPath(packageRoot));
      } catch (_error) {
        // A stale package key or a missing value must not block other versions.
      }
    }
    return windows.msixExecutablePaths(app_, packageRoots);
  });
}

function queryWindowsAppxExecutablePaths(app_) {
  return cachedWindowsDiscovery(`appx:${app_.id}`, () => {
    const script = windows.appxExecutableDiscoveryScript(app_);
    if (!script) return [];
    const text = runPowerShell(script);
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z]:\\.*\.exe$/i.test(line));
  });
}

function hasWindowsProtocol(app_) {
  return cachedWindowsDiscovery(`protocol:${app_.id}`, () => {
    const protocol = String(app_.windows?.protocol || '').replace(/:.*$/, '');
    if (!protocol) return false;
    try {
      queryWindowsRegistry([`HKCR\\${protocol}`, '/v', 'URL Protocol']);
      return true;
    } catch (_error) {
      return false;
    }
  });
}

function cachedWindowsDiscovery(key, factory) {
  const cached = windowsDiscoveryCache.get(key);
  if (cached && Date.now() - cached.at < WINDOWS_DISCOVERY_TTL) return cached.value;
  let value;
  try {
    value = factory();
  } catch (_error) {
    value = Array.isArray(cached?.value) ? [] : false;
  }
  windowsDiscoveryCache.set(key, { at: Date.now(), value });
  return value;
}

function runPowerShell(script) {
  const options = {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  };
  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    try {
      return execFileSync(executable, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ], options);
    } catch (_error) {
      // Try the next PowerShell host.
    }
  }
  return '';
}

function queryWindowsRegistry(args, options = {}) {
  return execFileSync('reg.exe', ['query', ...args], {
    encoding: 'utf8',
    timeout: options.timeout || 2000,
    maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
    windowsHide: true
  });
}

function executableFromCommand(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const quoted = trimmed.match(/^"([^"]+\.exe)"/i);
  const plain = trimmed.match(/^(.+?\.exe)(?:\s|$)/i);
  const executable = quoted?.[1] || plain?.[1] || null;
  return executable ? windows.expandWindowsPath(executable) : null;
}

function spawnDetached(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('spawn', () => {
      const timer = setTimeout(() => {
        child.unref();
        finish(resolve);
      }, 350);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) finish(resolve);
        else finish(reject, new Error(`进程启动后立即退出（code=${code}, signal=${signal || '-'}）`));
      });
    });
  });
}

async function migrateWindowsProfilePath(id) {
  if (process.platform !== 'win32') return { ok: false, reason: '路径迁移只用于 Windows。' };
  const profiles = loadProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return { ok: false, reason: '找不到账号槽位。' };

  const profile = profiles[index];
  if (usesWindowsOfficialDefault(profile)) {
    return { ok: false, reason: '自动默认槽位会跟随系统目录，不需要迁移。' };
  }
  const migration = windowsMigrationInfo(profile);
  if (!migration.needed) return { ok: true, profile, message: '当前账号目录已经是 Windows 安全位置。' };

  const sourcePath = migration.source;
  const targetPath = migration.recommendedPath;
  const psText = snapshotProcesses();
  if (psText !== null && (
    isRunningIn(psText, profile.profilePath) ||
    (sourcePath && isRunningIn(psText, sourcePath))
  )) {
    return { ok: false, reason: `请先关闭「${profile.name}」对应的官方 App，再执行迁移。` };
  }

  try {
    ensureDir(path.dirname(targetPath));
    if (sourcePath && !pathsEqual(sourcePath, targetPath)) {
      await fs.promises.cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter: shouldCopyProfileItem
      });
    } else {
      ensureDir(targetPath);
    }

    const latest = loadProfiles().find((item) => item.id === id);
    if (!latest) return { ok: false, reason: '迁移完成前账号槽位已被移除；复制的数据仍保留在目标目录。' };
    if (!pathsEqual(latest.profilePath, profile.profilePath)) {
      return {
        ok: false,
        reason: '迁移期间账号路径被修改，已保留复制的数据但没有覆盖新的路径设置。'
      };
    }

    let sessionRoot = latest.sessionRoot;
    let sessionRootMode = latest.sessionRootMode;
    if (pathsEqual(sessionRoot, latest.profilePath)) {
      sessionRoot = targetPath;
      sessionRootMode = 'managed';
    } else if (isSubpath(sessionRoot, latest.profilePath)) {
      sessionRoot = path.join(targetPath, path.relative(latest.profilePath, sessionRoot));
      sessionRootMode = 'managed';
    }

    const updated = updateStoredProfile(id, (current) => ({
      ...current,
      profilePath: targetPath,
      sessionRoot,
      profilePathMode: 'managed',
      sessionRootMode
    }));
    return {
      ok: true,
      profile: updated,
      sourcePath,
      targetPath,
      message: sourcePath
        ? '账号数据已复制到 Windows 安全目录；旧目录保留为备份。'
        : '未找到旧数据，已创建 Windows 安全目录。'
    };
  } catch (error) {
    return { ok: false, reason: `迁移失败：${error.message}` };
  }
}

function shouldCopyProfileItem(sourcePath) {
  const name = path.basename(sourcePath).toLowerCase();
  return !PROFILE_COPY_EXCLUDES.has(name);
}

async function revealSessionFile(input) {
  const profiles = loadProfiles();
  const profile = profiles.find((item) => item.id === input.profileId);
  if (!profile) return { ok: false, reason: '找不到账号槽位。' };

  const sessions = apps.getApp(profile.appId).scan(profile);
  const refreshed = sessions.find((session) => session.id === input.sessionId);
  const itemPath = refreshed?.filePath || input.filePath || null;
  const result = await revealPath(itemPath, profile.sessionRoot);
  if (!refreshed && result.ok) {
    return {
      ...result,
      exact: false,
      message: '原会话文件已被移动或清理，已打开最近可用的目录。刷新列表后可查看当前状态。'
    };
  }
  return result;
}

async function revealPath(itemPath, fallbackPath = null) {
  if (!itemPath && !fallbackPath) return { ok: false, reason: '没有可打开的路径。' };
  const resolved = nearestExistingDirectory(itemPath, fallbackPath);
  if (!resolved.path) return { ok: false, reason: '原位置和可用的上级目录都不存在。' };

  if (resolved.exact && resolved.originalIsFile && process.platform !== 'win32' && itemPath.length < 240) {
    shell.showItemInFolder(itemPath);
    return { ok: true, exact: true, openedPath: resolved.path, message: '已在文件管理器中定位会话文件。' };
  }

  const opened = await openDirectoryWithFallback(resolved.path);
  if (!opened.ok) return opened;
  if (opened.degraded) {
    return {
      ok: true,
      exact: false,
      openedPath: opened.openedPath,
      message: '目标目录无法由文件管理器直接打开，已退回到可访问的上级目录。'
    };
  }
  if (resolved.exact && resolved.originalIsFile) {
    return {
      ok: true,
      exact: true,
      openedPath: opened.openedPath,
      message: `已打开会话文件所在目录：${path.basename(itemPath)}`
    };
  }
  if (resolved.exact) {
    return { ok: true, exact: true, openedPath: opened.openedPath, message: '已打开目录。' };
  }
  return {
    ok: true,
    exact: false,
    openedPath: opened.openedPath,
    message: '原位置已移动或不存在，已打开最近可用的上级目录。'
  };
}

async function openPathSafely(itemPath) {
  return revealPath(itemPath);
}

async function openDirectoryWithFallback(directoryPath) {
  let current = directoryPath;
  let lastError = '';
  while (current) {
    const error = await shell.openPath(current);
    if (!error) return { ok: true, openedPath: current, degraded: !pathsEqual(current, directoryPath) };
    lastError = error;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { ok: false, reason: lastError || '文件管理器无法打开这个位置。' };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
