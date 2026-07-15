const { app, BrowserWindow, ipcMain, shell, clipboard, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { scanSessions } = require('./sessions');
const { probeActivity } = require('./activity');
const { isRunningIn, snapshotProcesses } = require('./process');
const { normalizeCat } = require('./yard/cats');

const APP_NAME = 'AgentDesk';
const STORE_VERSION = 1;

function createWindow() {
  const win = new BrowserWindow({
    width: 1220,
    height: 760,
    minWidth: 1080,
    minHeight: 660,
    title: APP_NAME,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('profiles:list', () => {
    return loadProfiles();
  });

  ipcMain.handle('profiles:add', (_event, input) => {
    const profiles = loadProfiles();
    const appId = input.appId === 'codex' ? 'codex' : 'claude';
    const name = String(input.name || '').trim() || `${managedAppName(appId)} 账号`;
    const profilePath = makeIsolatedProfilePath(appId, name);
    const profile = normalizeProfile({
      id: crypto.randomUUID(),
      appId,
      name,
      profilePath,
      sessionRoot: defaultSessionRoot(appId, profilePath, false),
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
    const profiles = loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === input.id);
    if (index < 0) return null;

    const next = { ...profiles[index] };
    if (typeof input.name === 'string') next.name = input.name.trim() || next.name;
    if (typeof input.profilePath === 'string') next.profilePath = input.profilePath.trim() || next.profilePath;
    if (typeof input.sessionRoot === 'string') next.sessionRoot = input.sessionRoot.trim() || next.sessionRoot;
    if (typeof input.group === 'string') next.group = input.group.trim();
    if (typeof input.note === 'string') next.note = input.note;
    if (input.cat && typeof input.cat === 'object') next.cat = { ...next.cat, ...input.cat };

    profiles[index] = normalizeProfile(next);
    saveProfiles(profiles);
    return profiles[index];
  });

  ipcMain.handle('profiles:remove', (_event, id) => {
    const profiles = loadProfiles();
    const target = profiles.find((profile) => profile.id === id);
    if (!target || target.isProtected) return { ok: false, reason: '默认槽位不能移除' };
    saveProfiles(profiles.filter((profile) => profile.id !== id));
    return { ok: true };
  });

  ipcMain.handle('profiles:launch', (_event, id) => {
    const profiles = loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return { ok: false, reason: '找不到账号槽位' };

    const profile = profiles[index];
    const result = launchProfile(profile);
    if (result.ok) {
      profiles[index] = { ...profile, lastLaunchedAt: new Date().toISOString() };
      saveProfiles(profiles);
    }
    return result;
  });

  ipcMain.handle('sessions:list', (_event, profile) => {
    if (!profile) return [];
    return scanSessions(normalizeProfile(profile));
  });

  ipcMain.handle('activity:all', () => {
    const profiles = loadProfiles();
    // 进程快照采一次，供所有账号匹配；null 表示探测不可用（上层退回 mtime）
    const psText = snapshotProcesses();
    return profiles.map((profile) => ({
      ...probeActivity(profile),
      running: psText === null ? null : isRunningIn(psText, profile.profilePath)
    }));
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

  ipcMain.handle('system:showItem', (_event, itemPath) => {
    if (!itemPath) return false;
    shell.showItemInFolder(itemPath);
    return true;
  });

  ipcMain.handle('system:openPath', (_event, itemPath) => {
    if (!itemPath) return false;
    shell.openPath(itemPath);
    return true;
  });

  ipcMain.handle('clipboard:writeText', (_event, value) => {
    clipboard.writeText(String(value || ''));
    return true;
  });
}

function loadProfiles() {
  const storeFile = profilesFile();
  ensureDir(path.dirname(storeFile));

  if (!fs.existsSync(storeFile)) {
    const initial = bootstrapProfiles();
    saveProfiles(initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const rawProfiles = Array.isArray(parsed) ? parsed : parsed.profiles;
    const normalized = normalizeProfileList(rawProfiles || []);
    saveProfiles(normalized);
    return normalized;
  } catch (_error) {
    const fallback = bootstrapProfiles();
    saveProfiles(fallback);
    return fallback;
  }
}

function saveProfiles(profiles) {
  ensureDir(path.dirname(profilesFile()));
  fs.writeFileSync(
    profilesFile(),
    JSON.stringify({ version: STORE_VERSION, profiles }, null, 2),
    'utf8'
  );
}

function bootstrapProfiles() {
  return normalizeProfileList([
    {
      id: crypto.randomUUID(),
      appId: 'claude',
      name: '默认 Claude',
      profilePath: defaultProfilePath('claude'),
      sessionRoot: defaultProfilePath('claude'),
      isProtected: true,
      createdAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      appId: 'codex',
      name: '默认 Codex',
      profilePath: defaultProfilePath('codex'),
      sessionRoot: defaultSessionRoot('codex', defaultProfilePath('codex'), true),
      isProtected: true,
      createdAt: new Date().toISOString()
    }
  ]);
}

function normalizeProfileList(profiles) {
  const normalized = profiles.map(normalizeProfile);
  if (!normalized.some((profile) => profile.appId === 'claude' && profile.isProtected)) {
    normalized.unshift(normalizeProfile({
      id: crypto.randomUUID(),
      appId: 'claude',
      name: '默认 Claude',
      profilePath: defaultProfilePath('claude'),
      sessionRoot: defaultProfilePath('claude'),
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
      isProtected: true,
      createdAt: new Date().toISOString()
    }));
  }
  return normalized;
}

function normalizeProfile(profile) {
  const appId = profile.appId === 'codex' ? 'codex' : 'claude';
  const profilePath = profile.profilePath || defaultProfilePath(appId);
  const id = profile.id || crypto.randomUUID();
  return {
    id,
    appId,
    name: profile.name || `默认 ${managedAppName(appId)}`,
    profilePath,
    sessionRoot: profile.sessionRoot || defaultSessionRoot(appId, profilePath, Boolean(profile.isProtected)),
    isProtected: Boolean(profile.isProtected),
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

function defaultProfilePath(appId) {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', managedAppName(appId));
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), managedAppName(appId));
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), managedAppName(appId));
}

function defaultSessionRoot(appId, profilePath, isDefault) {
  if (appId === 'codex') {
    return isDefault ? path.join(os.homedir(), '.codex') : path.join(profilePath, 'codex-home');
  }
  return profilePath;
}

function makeIsolatedProfilePath(appId, name) {
  return path.join(app.getPath('userData'), 'Profiles', managedAppName(appId), slug(name));
}

function managedAppName(appId) {
  return appId === 'codex' ? 'Codex' : 'Claude';
}

function slug(value) {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'account';
}

function launchProfile(profile) {
  ensureDir(profile.profilePath);
  ensureDir(profile.sessionRoot);

  const appName = managedAppName(profile.appId);
  const args = [`--user-data-dir=${profile.profilePath}`];
  const env = {
    ...process.env,
    CODEX_HOME: profile.appId === 'codex' ? profile.sessionRoot : process.env.CODEX_HOME
  };

  try {
    if (process.platform === 'darwin') {
      const executable = findMacExecutable(appName);
      if (executable) {
        spawnDetached(executable, args, env);
        return { ok: true, command: executable };
      }

      spawnDetached('/usr/bin/open', ['-n', '-a', appName, '--args', ...args], env);
      return { ok: true, command: `open -a ${appName}`, warning: '没有在标准路径找到 App，已交给 macOS Launch Services 查找。' };
    }

    if (process.platform === 'win32') {
      const executable = findWindowsExecutable(appName);
      if (!executable) {
        return { ok: false, reason: `找不到 ${appName}.exe。可以先安装官方 ${appName} App。` };
      }
      spawnDetached(executable, args, env);
      return { ok: true, command: executable };
    }

    spawnDetached(appName.toLowerCase(), args, env);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function diagnoseProfile(profile) {
  const appName = managedAppName(profile.appId);
  const executable = findExecutable(profile.appId);
  const profilePath = inspectPath(profile.profilePath, { createable: true });
  const sessionRoot = inspectPath(profile.sessionRoot, { createable: true });
  const sessionAreas = expectedSessionAreas(profile).map((area) => ({
    ...area,
    ...inspectPath(area.path, { createable: false })
  }));
  const sessions = scanSessions(profile);
  const warnings = [];

  if (!executable.found) {
    warnings.push(`未在标准路径找到 ${appName} 官方 App。`);
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
    warnings.push('会话根目录可读，但没有匹配到 Claude/Codex 会话文件。');
  }

  return {
    platform: process.platform,
    appName,
    executable,
    profilePath,
    sessionRoot,
    sessionAreas,
    sessionCount: sessions.length,
    storeFile: profilesFile(),
    userData: app.getPath('userData'),
    warnings
  };
}

function expectedSessionAreas(profile) {
  if (profile.appId === 'codex') {
    return [
      { label: 'Codex 索引', path: path.join(profile.sessionRoot, 'session_index.jsonl'), kind: 'file' },
      { label: 'Codex 会话', path: path.join(profile.sessionRoot, 'sessions'), kind: 'directory' },
      { label: 'Codex 归档', path: path.join(profile.sessionRoot, 'archived_sessions'), kind: 'directory' }
    ];
  }

  return [
    { label: 'Claude Code', path: path.join(profile.sessionRoot, 'claude-code-sessions'), kind: 'directory' },
    { label: 'Claude 本地', path: path.join(profile.sessionRoot, 'local-agent-mode-sessions'), kind: 'directory' }
  ];
}

function inspectPath(itemPath, options = {}) {
  const result = {
    path: itemPath,
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

function findExecutable(appId) {
  const appName = managedAppName(appId);
  if (process.platform === 'darwin') {
    const executable = findMacExecutable(appName);
    return {
      found: Boolean(executable),
      path: executable,
      candidates: macExecutableCandidates(appName)
    };
  }
  if (process.platform === 'win32') {
    const candidates = windowsExecutableCandidates(appName);
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    return {
      found: Boolean(executable),
      path: executable || null,
      candidates
    };
  }
  return {
    found: false,
    path: null,
    candidates: [appName.toLowerCase()]
  };
}

function findMacExecutable(appName) {
  return macExecutableCandidates(appName).find((candidate) => fs.existsSync(candidate));
}

function macExecutableCandidates(appName) {
  return [
    path.join('/Applications', `${appName}.app`, 'Contents', 'MacOS', appName),
    path.join(os.homedir(), 'Applications', `${appName}.app`, 'Contents', 'MacOS', appName)
  ];
}

function findWindowsExecutable(appName) {
  return windowsExecutableCandidates(appName).find((candidate) => fs.existsSync(candidate));
}

function windowsExecutableCandidates(appName) {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(local, 'Programs', appName, `${appName}.exe`),
    path.join(local, 'Programs', appName.toLowerCase(), `${appName}.exe`),
    path.join(local, 'Programs', `@${appName.toLowerCase()}`, `${appName}.exe`),
    path.join(local, appName, `${appName}.exe`),
    path.join(roaming, appName, `${appName}.exe`),
    path.join(local, `Anthropic`, appName, `${appName}.exe`),
    path.join(local, `Anthropic${appName}`, `${appName}.exe`),
    path.join(programFiles, appName, `${appName}.exe`),
    path.join(programFiles, 'OpenAI', appName, `${appName}.exe`),
    path.join(programFiles, 'Anthropic', appName, `${appName}.exe`),
    path.join(programFilesX86, appName, `${appName}.exe`),
    path.join(programFilesX86, 'OpenAI', appName, `${appName}.exe`),
    path.join(programFilesX86, 'Anthropic', appName, `${appName}.exe`)
  ];
}

function spawnDetached(command, args, env) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env
  });
  child.unref();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
