// The session index: one scan serves concurrent and repeated requests, a
// failed rescan keeps the last good rows (phase 1) and is carried as a result
// (phase 2), and there is one way to find a session by id.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, fail } = require('../src/core/result');
const { createSessionIndex, findSession } = require('../src/session-index');

function harness(results) {
  let time = 0;
  const scans = [];
  const index = createSessionIndex({
    now: () => time,
    reuseMs: 3000,
    scan: (profile) => { scans.push(profile.id); return results.shift(); }
  });
  return { index, scans, advance: (ms) => { time += ms; } };
}

const profile = { id: 'p', appId: 'codex', sessionRoot: '/home/p' };

test('requests share one scan, reuse it for a while, then scan again', async () => {
  const { index, scans, advance } = harness([ok([{ id: 'a' }]), ok([{ id: 'a' }, { id: 'b' }])]);
  const [first, second] = await Promise.all([index.rows(profile), index.rows(profile)]);
  assert.deepEqual(first, second);
  assert.equal(scans.length, 1);
  advance(2000);
  await index.rows(profile);
  assert.equal(scans.length, 1, 'still recent');
  advance(1500);
  assert.equal((await index.rows(profile)).length, 2);
  assert.equal(scans.length, 2);
});

test('a request for a fresh scan never gets a scan that started before it', async () => {
  let time = 0;
  const started = [];
  const release = [];
  const index = createSessionIndex({
    now: () => time,
    scan: () => new Promise((resolve) => { started.push(time); release.push(resolve); })
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const first = index.rows(profile);
  await tick();
  time = 100;
  // While the first scan runs, a user action asks for rows no older than now.
  const fresh = index.rows(profile, { maxAgeMs: 0 });
  const alsoFresh = index.rows(profile, { maxAgeMs: 0 });
  const recentEnough = index.rows(profile);
  await tick();
  assert.equal(started.length, 1, 'the fresh scan waits for the running one instead of racing it');
  release[0](ok([{ id: 'old' }]));
  assert.deepEqual(await first, [{ id: 'old' }]);
  await tick();
  assert.equal(started.length, 2, 'then exactly one more scan starts');
  assert.ok(started[1] >= 100);
  release[1](ok([{ id: 'old' }, { id: 'new' }]));
  assert.deepEqual(await fresh, [{ id: 'old' }, { id: 'new' }]);
  assert.deepEqual(await alsoFresh, [{ id: 'old' }, { id: 'new' }], 'fresh requests waiting together share that scan');
  assert.deepEqual(await recentEnough, [{ id: 'old' }, { id: 'new' }], 'a later caller shares the queued, newer scan');
  assert.equal(started.length, 2);
  assert.deepEqual(index.rowsSync(profile), [{ id: 'old' }, { id: 'new' }]);
});

test('another folder for the same profile never serves the old rows', async () => {
  const { index, scans } = harness([ok([{ id: 'a' }]), ok([{ id: 'z' }])]);
  await index.rows(profile);
  assert.deepEqual(await index.rows({ ...profile, sessionRoot: '/elsewhere' }), [{ id: 'z' }]);
  assert.equal(scans.length, 2);
});

test('a scan for a folder the profile no longer uses is dropped when it lands', async () => {
  let release;
  const scans = [];
  const index = createSessionIndex({
    scan: (current) => {
      scans.push(current.sessionRoot);
      if (current.sessionRoot === '/old') return new Promise((resolve) => { release = resolve; });
      return ok([{ id: 'new-folder' }]);
    }
  });
  const old = index.rows({ ...profile, sessionRoot: '/old' });
  await new Promise((resolve) => setImmediate(resolve));
  const moved = { ...profile, sessionRoot: '/new' };
  assert.deepEqual(await index.rows(moved), [{ id: 'new-folder' }]);
  release(ok([{ id: 'old-folder' }]));
  assert.deepEqual(await old, [{ id: 'old-folder' }], 'the caller that asked still gets its answer');
  assert.deepEqual(index.peek(moved).rows, [{ id: 'new-folder' }], 'but the late result does not replace the current one');
  assert.deepEqual(index.rowsSync(moved), [{ id: 'new-folder' }]);
  assert.deepEqual(scans, ['/old', '/new']);
});

test('a failed rescan keeps the last good rows and says so; no good rows means the failure', async () => {
  const { index, advance } = harness([ok([{ id: 'a' }], { truncated: true }), fail('session-store-unreadable')]);
  await index.rows(profile);
  assert.equal(index.peek(profile).truncated, true);
  advance(5000);
  assert.deepEqual(await index.rows(profile), [{ id: 'a' }]);
  const entry = index.peek(profile);
  assert.equal(entry.stale, true);
  assert.deepEqual({ ...entry.result }, { ok: false, code: 'session-store-unreadable' });
  const never = harness([fail('sqlite-unavailable')]);
  await assert.rejects(never.index.rows(profile), { code: 'sqlite-unavailable' });
  const thrown = createSessionIndex({ scan: () => { const error = new Error('x'); error.code = 'session-store-unreadable'; throw error; } });
  await assert.rejects(thrown.rows(profile), { code: 'session-store-unreadable' });
});

test('the synchronous path reads what the index has, and scans only when it has nothing', async () => {
  const { index, scans } = harness([ok([{ id: 'a' }]), ok([{ id: 'b' }])]);
  assert.deepEqual(index.rowsSync(profile), [{ id: 'a' }]);
  assert.deepEqual(index.rowsSync(profile), [{ id: 'a' }]);
  assert.equal(scans.length, 1);
  assert.deepEqual(index.rowsSync(profile, { maxAgeMs: -1 }), [{ id: 'b' }], 'a caller can ask for a fresh scan');
});

test('the index tells a listener about rows it keeps, not about failures or dropped results', async () => {
  const seen = [];
  const results = [ok([{ id: 'a' }]), fail('session-store-unreadable')];
  const index = createSessionIndex({
    now: () => 0,
    reuseMs: -1,
    scan: () => results.shift(),
    onRecord: (current, entry) => seen.push([current.id, entry.rows.map((row) => row.id)])
  });
  await index.rows(profile);
  await index.rows(profile);
  assert.deepEqual(seen, [['p', ['a']]], 'a failed rescan keeps the old rows and is not announced');
  const throwing = createSessionIndex({ scan: () => ok([{ id: 'b' }]), onRecord: () => { throw new Error('listener'); } });
  assert.deepEqual(await throwing.rows(profile), [{ id: 'b' }], 'a failing listener does not break the index');
});

test('one lookup: by id or by address, first match or unique', () => {
  const rows = [{ id: 'one', address: 'addr-1' }, { id: 'two' }, { id: 'dup' }, { id: 'dup', address: 'x' }];
  assert.equal(findSession(rows, 'one').id, 'one');
  assert.equal(findSession(rows, 'addr-1'), null, 'the id key ignores addresses');
  assert.equal(findSession(rows, 'addr-1', { key: 'address' }).id, 'one');
  assert.equal(findSession(rows, 'two', { key: 'address' }).id, 'two', 'an address falls back to the id');
  assert.equal(findSession(rows, 'dup').address, undefined, 'first match');
  assert.deepEqual(findSession(rows, 'dup', { unique: true }), { ambiguous: true });
  assert.equal(findSession(rows, ''), null);
  assert.equal(findSession(null, 'one'), null);
});
