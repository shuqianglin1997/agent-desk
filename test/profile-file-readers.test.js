// profiles.json has one reader (src/core/profile-file.js) and three policies
// on top of it: the desktop's recovering store, the CLI's strict read-only
// view, and the lenient list used by `profiles discover`. These tests pin each
// policy on the same edge inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProfiles } = require('../src/automation/service');
const { makeTempDir } = require('./helpers/temp');

function userData(t, content) {
  const dir = makeTempDir('agentdesk-profile-readers-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'profiles.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}
const good = (dir) => ({ id: 'p', appId: 'codex', profilePath: path.join(dir, 'p'), sessionRoot: path.join(dir, 'p') });
const codeOf = (fn) => { try { fn(); return 'ok'; } catch (error) { return error.code; } };

function lenient(dir) {
  const localLocations = require('../src/automation/local-locations');
  return localLocations.readRegisteredProfiles(dir);
}

test('CLI strict view: missing, unreadable, wrong version, invalid entries, valid v2', (t) => {
  assert.deepEqual(readProfiles(userData(t)), { state: 'missing', profiles: [] });
  assert.equal(codeOf(() => readProfiles(userData(t, '{"version":2,'))), 'profile-store-unreadable');
  assert.equal(codeOf(() => readProfiles(userData(t, []))), 'profile-store-version');
  assert.equal(codeOf(() => readProfiles(userData(t, { version: 3, profiles: [] }))), 'profile-store-version');
  assert.equal(codeOf(() => readProfiles(userData(t, { version: 2 }))), 'profile-store-version');
  assert.equal(codeOf(() => readProfiles(userData(t, 'null'))), 'profile-store-version');
  const dir = userData(t);
  fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify({ version: 2, profiles: [{ ...good(dir), appId: 'nope' }] }));
  assert.equal(codeOf(() => readProfiles(dir)), 'profile-store-invalid');
  fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify({ version: 2, profiles: [good(dir)] }));
  assert.deepEqual(readProfiles(dir), { state: 'present', profiles: [good(dir)] });
  const folder = userData(t);
  fs.mkdirSync(path.join(folder, 'profiles.json'));
  assert.equal(codeOf(() => readProfiles(folder)), 'profile-store-unreadable');
});

test('lenient discovery list: never throws, keeps only entries with a session root', (t) => {
  assert.deepEqual(lenient(userData(t)), { profiles: [], state: 'missing' });
  assert.deepEqual(lenient(userData(t, '{oops')), { profiles: [], state: 'unreadable' });
  assert.deepEqual(lenient(userData(t, 'null')), { profiles: [], state: 'present' });
  assert.deepEqual(lenient(userData(t, [{ sessionRoot: '/x' }])), { profiles: [], state: 'present' });
  assert.deepEqual(lenient(userData(t, { version: 9, profiles: [{ sessionRoot: '/x' }, { id: 'no-root' }] })), { profiles: [{ sessionRoot: '/x' }], state: 'present' });
  assert.deepEqual(lenient('relative/path'), { profiles: [], state: 'unknown' });
});

test('desktop store reader: arrays and {profiles} objects are read, anything else is unreadable', (t) => {
  const { readProfileFile } = require('../src/core/profile-file');
  const dir = userData(t);
  const file = path.join(dir, 'profiles.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'legacy' }]));
  assert.deepEqual(readProfileFile(file), { ok: true, value: { parsed: [{ id: 'legacy' }], version: 0, profiles: [{ id: 'legacy' }], legacyArray: true } });
  fs.writeFileSync(file, JSON.stringify({ version: 3, profiles: [] }));
  assert.equal(readProfileFile(file).value.version, 3);
  fs.writeFileSync(file, JSON.stringify({ version: 3 }));
  assert.deepEqual(readProfileFile(file), { ok: false, code: 'invalid-shape' });
  assert.deepEqual(readProfileFile(path.join(dir, 'missing.json')), { ok: false, code: 'missing' });
});
