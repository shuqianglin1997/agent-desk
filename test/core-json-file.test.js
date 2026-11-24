const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const json = require('../src/core/json-file');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-core-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('reading tells missing, damaged, too large and wrong shape apart from a value', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.json');
  assert.deepEqual(json.readJsonFile(file), { ok: false, code: 'missing' });
  fs.writeFileSync(file, '{"a":');
  assert.deepEqual(json.readJsonFile(file), { ok: false, code: 'invalid-json' });
  fs.writeFileSync(file, '﻿{"a":1}');
  assert.deepEqual(json.readJsonFile(file), { ok: false, code: 'invalid-json' });
  assert.deepEqual(json.readJsonFile(file, { stripBom: true }), { ok: true, value: { a: 1 } });
  assert.deepEqual(json.readJsonFile(file, { maxBytes: 3 }), { ok: false, code: 'too-large' });
  assert.deepEqual(json.readJsonFile(dir, { maxBytes: 10 }), { ok: false, code: 'not-a-file' });
  assert.deepEqual(json.readJsonFile(dir), { ok: false, code: 'not-a-file' });
  assert.deepEqual(json.readJsonFile(file, { stripBom: true, validate: (value) => Array.isArray(value) }), { ok: false, code: 'invalid-shape' });
  assert.equal(json.readJson(file), null);
});

test('an atomic write replaces the file whole, keeps a backup when asked and leaves no temp files', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, 'old');
  json.writeFileAtomic(file, 'new', { backupFile: `${file}.bak` });
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['store.json', 'store.json.bak']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('an atomic write does not create a missing folder unless asked', (t) => {
  const dir = tempDir(t);
  const nested = path.join(dir, 'gone', 'response.json');
  assert.throws(() => json.writeFileAtomic(nested, '{}'), /ENOENT/);
  assert.equal(fs.existsSync(path.join(dir, 'gone')), false);
  json.writeJsonAtomic(nested, { a: 1 }, { createDirectory: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(nested, 'utf8')), { a: 1 });
});

test('a versioned store loads defaults, migrates in order keeping other fields, and never touches a newer file', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'ledger.json');
  const store = json.createVersionedStore({
    file, version: 3, defaults: () => ({ entries: [] }),
    validate: (value) => Array.isArray(value.entries),
    migrations: [
      { from: 2, up: (value) => { const { retired, ...rest } = value; return rest; } },
      { from: 1, up: (value) => ({ ...value, entries: value.items || [] }) }
    ]
  });
  assert.deepEqual(store.load(), { ok: true, value: { value: { entries: [] }, version: 3, migrated: false, newer: false } });
  fs.writeFileSync(file, JSON.stringify({ version: 1, data: { items: [1], keep: 'me', retired: true } }));
  const migrated = store.load();
  assert.equal(migrated.ok, true);
  assert.deepEqual(migrated.value.value, { items: [1], keep: 'me', entries: [1] });
  assert.equal(migrated.value.migrated, true);
  store.save(migrated.value.value);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 3, data: { items: [1], keep: 'me', entries: [1] } });
  fs.writeFileSync(file, JSON.stringify({ version: 4, data: { entries: [9], future: true } }));
  const newer = store.load();
  assert.deepEqual(newer.value, { value: { entries: [9], future: true }, version: 4, migrated: false, newer: true });
  assert.throws(() => store.save({ entries: [] }), /newer-on-disk/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).version, 4);
  fs.writeFileSync(file, '{"nope":1}');
  assert.deepEqual(store.load(), { ok: false, code: 'invalid-shape' });
});
