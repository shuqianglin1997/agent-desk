const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return mainSource.slice(start, end);
}

test('异步打开账号结束后只合并启动时间，不回写启动前的整份旧快照', () => {
  const handler = sourceBetween(
    "ipcMain.handle('profiles:launch'",
    "ipcMain.handle('sessions:list'"
  );

  assert.match(handler, /await launchProfile\(profile\)/);
  assert.match(handler, /updateStoredProfile\(id,/);
  assert.doesNotMatch(handler, /saveProfiles\(profiles\)/);
});

test('Windows 路径迁移在异步复制后重新读取最新账号并做局部更新', () => {
  const migration = sourceBetween(
    'async function migrateWindowsProfilePath',
    'function shouldCopyProfileItem'
  );

  const copyIndex = migration.indexOf('await fs.promises.cp');
  const reloadIndex = migration.indexOf('const latest = loadProfiles()');
  const updateIndex = migration.indexOf('updateStoredProfile(id');
  assert.ok(copyIndex >= 0);
  assert.ok(reloadIndex > copyIndex);
  assert.ok(updateIndex > reloadIndex);
});

test('应用使用单实例锁，避免两个进程同时写配置', () => {
  assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /app\.on\('second-instance'/);
});

test('renderer 使用 contextIsolation 且启用 Chromium sandbox', () => {
  const windowSetup = sourceBetween('function createWindow()', 'function showMainWindow()');
  assert.match(windowSetup, /contextIsolation:\s*true/);
  assert.match(windowSetup, /nodeIntegration:\s*false/);
  assert.match(windowSetup, /sandbox:\s*true/);
});

test('会话 IPC 只保留浏览、定位与导出，不再暴露资料索引入口', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(mainSource, /ipcMain\.handle\('sessions:list'/);
  assert.match(mainSource, /ipcMain\.handle\('sessions:reveal'/);
  assert.match(mainSource, /ipcMain\.handle\('sessions:export'/);
  assert.doesNotMatch(mainSource, /sessions:artifacts/);
  assert.doesNotMatch(preload, /listSessionArtifacts|sessions:artifacts/);
});

test('账号局部编辑会合并猫外观，归一化不删自定义颜色和未来字段', () => {
  const handler = sourceBetween(
    "ipcMain.handle('profiles:update'",
    "ipcMain.handle('profiles:remove'"
  );
  const normalizer = sourceBetween('function normalizeProfile(profile)', 'function profilesFile()');

  assert.match(handler, /next\.cat = \{ \.\.\.next\.cat, \.\.\.input\.cat \}/);
  assert.match(normalizer, /\.\.\.profile,/);
  assert.match(normalizer, /cat: normalizeCat\(profile\.cat, id\)/);
});

test('所有账号都可删除，删除最后一个后空账本不会按平台自动补回', () => {
  const handler = sourceBetween(
    "ipcMain.handle('profiles:remove'",
    "ipcMain.handle('profiles:migrateWindowsPath'"
  );
  const listNormalizer = sourceBetween(
    'function normalizeProfileList(profiles)',
    'function normalizeProfile(profile)'
  );
  const removeClickStart = rendererSource.indexOf("els.removeProfileBtn.addEventListener('click'");
  const removeClickEnd = rendererSource.indexOf("els.launchBtn.addEventListener('click'", removeClickStart);
  const headerStart = rendererSource.indexOf('function renderAccountHeader()');
  const headerEnd = rendererSource.indexOf('function sessionColumns()', headerStart);
  assert.ok(removeClickStart >= 0 && removeClickEnd > removeClickStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);

  assert.match(handler, /if \(!target\).*main\.err\.slotNotFound/);
  assert.match(handler, /saveProfiles\(profiles\.filter/);
  assert.doesNotMatch(handler, /isProtected|profiles\.length/);
  assert.doesNotMatch(listNormalizer, /normalized\.(?:push|unshift)\(|hasLocal\w+Data/);
  assert.doesNotMatch(
    rendererSource.slice(removeClickStart, removeClickEnd),
    /isProtected/
  );
  assert.doesNotMatch(
    rendererSource.slice(headerStart, headerEnd),
    /removeProfileBtn\.disabled\s*=\s*[^;]*isProtected/
  );
});

test('替换可执行文件前只快照仍在使用的账号与界面设置', () => {
  const snapshot = sourceBetween('function snapshotConfigurationForUpdate()', '// 以下三个曾按');
  const installer = sourceBetween('async function installLatestUpdate', 'async function downloadReleaseAsset');

  assert.match(snapshot, /profilesFile\(\), profilesPreUpdateBackupFile\(\)/);
  assert.match(snapshot, /settingsFile\(\), settingsPreUpdateBackupFile\(\)/);
  assert.doesNotMatch(snapshot, /Agent|adapter/i);
  assert.doesNotMatch(mainSource, /agent-adapters|customAgents/);
  assert.match(installer, /snapshotConfigurationForUpdate\(\)/);
});

test('identityKey：清空能生效（显式 null 不被回填），只迁移从未有过字段的旧槽位', () => {
  const repin = sourceBetween('// Kimi Code 与 Kimi Work 是同一桌面 App 生态', 'function normalizeProfile(');
  // 迁移条件必须是「字段不存在」，不能是宽泛的 falsy —— 否则用户清空会被静默回填
  assert.match(repin, /profile\.identityKey === undefined/);
  assert.doesNotMatch(repin, /!profile\.identityKey\b/);

  const normalize = sourceBetween('function normalizeProfile(', 'function inferProfilePathMode');
  // normalizeProfile 只在字段存在时规范化，保留「从未设置」语义
  assert.match(normalize, /hasOwnProperty\.call\(profile, 'identityKey'\)/);
});
