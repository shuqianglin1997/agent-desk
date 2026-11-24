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

test('another folder for the same profile never serves the old rows', async () => {
  const { index, scans } = harness([ok([{ id: 'a' }]), ok([{ id: 'z' }])]);
  await index.rows(profile);
  assert.deepEqual(await index.rows({ ...profile, sessionRoot: '/elsewhere' }), [{ id: 'z' }]);
  assert.equal(scans.length, 2);
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
