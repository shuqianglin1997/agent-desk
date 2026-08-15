const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Profile 生命周期、Crashpad 保护和安全清理保持稳定的 Main/Preload/UI 契约', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  const settings = read('src/settings.js');
  const runtime = read('src/profile-runtime.js');

  assert.match(settings, /profileQuitBehavior: 'close'/);
  assert.match(settings, /PROFILE_QUIT_BEHAVIORS = new Set\(\['close', 'keep'\]\)/);
  assert.match(html, /id="profileQuitBehavior"[\s\S]*?value="close"[\s\S]*?value="keep"/);
  assert.match(html, /id="stopProfileBtn"[\s\S]*?id="cleanCrashpadBtn"/);
  assert.match(renderer, /persistSettings\(\{ profileQuitBehavior: state\.profileQuitBehavior \}\)/);
  assert.match(renderer, /window\.confirm\(tr\('status\.cleanCrashpadConfirm'/);

  assert.match(preload, /stopProfile: \(id\) => ipcRenderer\.invoke\('profiles:stop', id\)/);
  assert.match(preload, /cleanProfileCrashpad: \(id\) => ipcRenderer\.invoke\('profiles:cleanCrashpad', id\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('profiles:cleanCrashpad',\s*\{/);
  assert.match(main, /ipcMain\.handle\('profiles:cleanCrashpad'[\s\S]*?loadProfiles\(\)\.find[\s\S]*?cleanCrashpad\(profile\)/);
  assert.match(main, /app\.on\('before-quit'[\s\S]*?stopAll\(\{[\s\S]*?terminateOwned: true/);
  assert.match(main, /spawnDetached\([\s\S]*?pid: Number\.isInteger\(child\.pid\)/);
  assert.match(main, /runtimeSupervisor\.registerLaunch\(profile, launched\)/);

  assert.match(runtime, /maxFiles: 100/);
  assert.match(runtime, /maxBytes: 200 \* 1024 \* 1024/);
  assert.match(runtime, /burstLimit: 5/);
  assert.match(runtime, /const ALLOWED_CRASHPAD_FILE = \/\(\?:/);
  assert.match(runtime, /_sidecar\\\.json/);
  assert.doesNotMatch(runtime, /codex-home|sessions|archived_sessions|\.sqlite/i);
});
