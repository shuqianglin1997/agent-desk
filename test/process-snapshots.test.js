// One process list for the whole app: concurrent callers share one collection,
// a recent copy is reused, a failed collection is shared as null, and the
// runtime supervisor's periodic tick never collects synchronously.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProcessSnapshots } = require('../src/process-snapshots');
const { processText } = require('../src/process');
const { ProfileRuntimeSupervisor } = require('../src/profile-runtime');
const { makeTempDir } = require('./helpers/temp');

test('callers share one collection and a copy no older than they ask for', async () => {
  let now = 1000;
  let calls = 0;
  let release;
  const snapshots = createProcessSnapshots({
    now: () => now,
    collect: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); }
  });
  const first = snapshots.records();
  const second = snapshots.records();
  await new Promise((resolve) => setImmediate(resolve));
  release([{ pid: 1, ppid: 0, pgid: 1, command: 'a --user-data-dir=/x' }]);
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  now += 500;
  await snapshots.records({ maxAgeMs: 1000 });
  assert.equal(calls, 1, 'a recent copy is reused');
  const fresh = snapshots.records({ maxAgeMs: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  release([]);
  assert.deepEqual(await fresh, []);
  assert.equal(calls, 2, 'maxAgeMs 0 collects again');
});

test('a failed collection is shared as unavailable, and the text form keeps null', async () => {
  const snapshots = createProcessSnapshots({ collect: async () => { throw new Error('ps failed'); } });
  assert.equal(await snapshots.records(), null);
  assert.equal(processText(null), null);
  assert.equal(processText([{ command: 'a' }, { command: 'b c' }]), 'a\nb c');
});

test('the supervisor tick uses the shared list and never the synchronous one', async (t) => {
  const root = makeTempDir('agentdesk-process-snapshots-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profiles = ['a', 'b', 'c'].map((id) => ({ id, profilePath: path.join(root, id) }));
  let asyncCalls = 0;
  let syncCalls = 0;
  const supervisor = new ProfileRuntimeSupervisor({
    stateFile: path.join(root, 'profile-runtime.json'),
    snapshotProcessRecords: async () => { asyncCalls += 1; return []; },
    snapshotProcessRecordsSync: () => { syncCalls += 1; return []; },
    signalProcess: () => {},
    limits: { terminateGraceMs: 0 }
  });
  supervisor.updateProfiles(profiles);
  // A launch is a user action: its status may collect once, synchronously.
  for (const profile of profiles) supervisor.registerLaunch(profile, { pid: 4000 });
  asyncCalls = 0;
  syncCalls = 0;
  await supervisor.tick();
  assert.ok(asyncCalls >= 1, 'the tick took the shared list');
  // status() after the tick reads that list instead of collecting.
  assert.equal(supervisor.status(profiles[0]).active, false);
  assert.equal(syncCalls, 0, 'neither the tick nor status() after it collected synchronously');
});
