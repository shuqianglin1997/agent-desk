const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

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

test('替换可执行文件前同时快照账号外观和界面设置', () => {
  const snapshot = sourceBetween('function snapshotConfigurationForUpdate()', '// 以下三个曾按');
  const installer = sourceBetween('async function installLatestUpdate', 'async function downloadReleaseAsset');

  assert.match(snapshot, /profilesFile\(\), profilesPreUpdateBackupFile\(\)/);
  assert.match(snapshot, /settingsFile\(\), settingsPreUpdateBackupFile\(\)/);
  assert.match(installer, /snapshotConfigurationForUpdate\(\)/);
});
