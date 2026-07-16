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
