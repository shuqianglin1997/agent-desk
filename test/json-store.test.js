const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readJsonStore, writeJsonStore, snapshotFile } = require('../src/json-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-store-'));
}

test('JSON 配置写入时保留上一版备份', () => {
  const dir = tempDir();
  const file = path.join(dir, 'settings.json');
  const backup = `${file}.bak`;

  writeJsonStore(file, { value: 1 }, { backupFile: backup });
  writeJsonStore(file, { value: 2 }, { backupFile: backup });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { value: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), { value: 1 });
});

test('主配置损坏时可以按候选顺序从备份读取', () => {
  const dir = tempDir();
  const file = path.join(dir, 'profiles.json');
  const backup = `${file}.bak`;
  fs.writeFileSync(file, '{broken', 'utf8');
  fs.writeFileSync(backup, JSON.stringify({ profiles: [{ id: 'kept' }] }), 'utf8');

  const loaded = [file, backup]
    .map((candidate) => readJsonStore(candidate, (value) => Array.isArray(value.profiles)))
    .find(Boolean);

  assert.equal(loaded.filePath, backup);
  assert.equal(loaded.parsed.profiles[0].id, 'kept');
});

test('更新前快照复制当前完整配置且不修改源文件', () => {
  const dir = tempDir();
  const file = path.join(dir, 'profiles.json');
  const snapshot = `${file}.pre-update.bak`;
  fs.writeFileSync(file, JSON.stringify({ cat: { breed: 'black' } }), 'utf8');

  assert.equal(snapshotFile(file, snapshot), true);
  assert.equal(fs.readFileSync(snapshot, 'utf8'), fs.readFileSync(file, 'utf8'));
  assert.equal(snapshotFile(path.join(dir, 'missing.json'), snapshot), false);
});
