// The renderer's refresh path (activity poll, session list) needs the profile
// list every few seconds: it keeps the last list and checks profiles.json
// asynchronously, reading it again only when the file changed. Reading the
// store reads a backup only when the primary file is unusable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveProfileStore, createProfileSnapshot } = require('../src/main/profile-store-policy');

test('a readable primary store is the only file read', () => {
  const reads = [];
  const stores = { primary: { parsed: { version: 3, profiles: [{ id: 'a' }] } }, backup: { parsed: { version: 3, profiles: [{ id: 'old' }] } } };
  const load = (primary) => resolveProfileStore({
    candidates: ['primary', 'backup', 'pre-update'],
    exists: () => true,
    read: (file) => { reads.push(file); return file === 'primary' ? primary : stores[file] || null; },
    normalize: (profiles) => profiles,
    persist: () => {},
    version: 3
  });
  assert.deepEqual(load(stores.primary), [{ id: 'a' }]);
  assert.deepEqual(reads, ['primary']);
  reads.length = 0;
  assert.deepEqual(load(null), [{ id: 'old' }], 'a damaged primary still falls back to the backup');
  assert.deepEqual(reads, ['primary', 'backup']);
});

test('the refresh path reads profiles.json again only when the file changed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-profile-snapshot-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'profiles.json');
  fs.writeFileSync(file, JSON.stringify({ version: 3, profiles: [{ id: 'a' }] }));
  let loads = 0;
  const snapshot = createProfileSnapshot({
    file: () => file,
    load: () => { loads += 1; return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).profiles : []; }
  });
  const first = await snapshot.profiles();
  assert.deepEqual(first, [{ id: 'a' }]);
  first[0].id = 'changed by a caller';
  assert.deepEqual(await snapshot.profiles(), [{ id: 'a' }], 'callers get copies');
  assert.equal(loads, 1, 'an unchanged file is not read again');
  fs.writeFileSync(file, JSON.stringify({ version: 3, profiles: [{ id: 'a' }, { id: 'b' }] }));
  assert.deepEqual((await snapshot.profiles()).map((profile) => profile.id), ['a', 'b']);
  assert.equal(loads, 2);
  fs.rmSync(file);
  await snapshot.profiles();
  await snapshot.profiles();
  assert.equal(loads, 4, 'without a file to check, every call loads (the store decides what a missing file means)');
});
