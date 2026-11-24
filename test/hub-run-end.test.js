// How a background run ends (owner-approved timing change, architecture
// phase 5): the session lookup runs off the main thread, the run is recorded
// as ended once it returns, with the moment the process actually exited; the
// wait is bounded, a missing link is filled in later, the state order stays
// starting -> running -> completed/failed/stopped, and stopping never waits on
// the lookup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { HubRunner } = require('../src/hub/runner');
const { HubStore } = require('../src/hub/store');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(options = {}) {
  let time = Date.parse('2026-11-24T10:00:00.000Z');
  const store = new HubStore({ file: null });
  const children = [];
  const lookups = [];
  const spawnImpl = options.spawnImpl || (() => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {}, on() {} };
    children.push(child);
    setImmediate(() => child.emit('spawn'));
    return child;
  });
  const changes = [];
  const runner = new HubRunner({
    store,
    spawnImpl,
    killTree: options.killTree || (() => {}),
    now: () => time,
    lookupTimeoutMs: options.lookupTimeoutMs ?? 2000,
    stopWaitMs: 5000,
    locateSession: (profile, sessionId) => { lookups.push(sessionId); return options.locateSession ? options.locateSession(profile, sessionId) : null; },
    onSessionUnlinked: options.onSessionUnlinked,
    onChange: (record) => changes.push(record.state)
  });
  const adapter = {
    args: () => ['exec'],
    createParser: () => ({ push() {}, end: () => ({ answer: 'done', truncated: false, failed: false, sessionId: options.sessionId === undefined ? 'thread-1' : options.sessionId }) })
  };
  const spec = {
    title: 'Background', from: 'cli', depth: 1, profile: { id: 'p1', appId: 'codex' }, targetName: 'Work', access: 'read',
    cwd: '/tmp', folderId: 'folder-1', launcher: { command: '/bin/true', prefixArgs: [] }, env: {}, prompt: 'hi', adapter
  };
  return { store, runner, children, changes, lookups, spec, advance: (ms) => { time += ms; }, at: () => new Date(time).toISOString() };
}

test('a run is recorded as ended at the moment its process exited, once the session lookup returns', async () => {
  let answer;
  const h = harness({ locateSession: () => new Promise((resolve) => { answer = resolve; }) });
  const { id } = h.runner.start(h.spec);
  await tick();
  assert.equal(h.store.getRun(id).state, 'running');
  h.advance(1000);
  const exitedAt = h.at();
  h.children[0].emit('close', 0, null);
  assert.equal(h.store.getRun(id).state, 'running', 'still running while the lookup works');
  assert.equal(h.runner.isActive(id), true, 'the account is still busy');
  h.advance(700);
  answer('/sessions/thread-1.jsonl');
  await tick();
  const run = h.store.getRun(id);
  assert.equal(run.state, 'completed');
  assert.equal(run.endedAt, exitedAt, 'the end time is the exit, not the moment the record was written');
  assert.deepEqual(run.session, { id: 'thread-1', file: '/sessions/thread-1.jsonl' });
  assert.deepEqual(h.changes, ['starting', 'running', 'completed']);
  assert.equal(h.runner.isActive(id), false);
});

test('a slow lookup never keeps a run running: it ends without the link, and the link is filled when found', async () => {
  let answer;
  const unlinked = [];
  const h = harness({
    lookupTimeoutMs: 30,
    locateSession: () => new Promise((resolve) => { answer = resolve; }),
    onSessionUnlinked: (entry) => unlinked.push(entry)
  });
  const { id } = h.runner.start(h.spec);
  await tick();
  const exitedAt = h.at();
  h.children[0].emit('close', 0, null);
  await sleep(80);
  let run = h.store.getRun(id);
  assert.equal(run.state, 'completed');
  assert.equal(run.endedAt, exitedAt);
  assert.deepEqual(run.session, { id: 'thread-1', file: null });
  assert.deepEqual(unlinked.map((entry) => [entry.runId, entry.profileId, entry.sessionId]), [[id, 'p1', 'thread-1']]);
  answer('/sessions/late.jsonl');
  await tick();
  run = h.store.getRun(id);
  assert.deepEqual(run.session, { id: 'thread-1', file: '/sessions/late.jsonl' }, 'the late answer fills the link');
  assert.equal(run.state, 'completed');
});

test('a failed lookup ends the run at once without the link; the index can fill it later', async () => {
  for (const locateSession of [() => Promise.reject(new Error('scan failed')), () => { throw new Error('scan failed'); }, () => null]) {
    const unlinked = [];
    const h = harness({ locateSession, onSessionUnlinked: (entry) => unlinked.push(entry) });
    const { id } = h.runner.start(h.spec);
    await tick();
    h.children[0].emit('close', 0, null);
    await tick();
    assert.equal(h.store.getRun(id).state, 'completed');
    assert.deepEqual(h.store.getRun(id).session, { id: 'thread-1', file: null });
    assert.equal(unlinked.length, 1);
    assert.equal(h.runner.linkSession(id, 'other-thread', '/x.jsonl'), null, 'only the run\'s own session is linked');
    assert.equal(h.runner.linkSession(id, 'thread-1', '/found.jsonl').session.file, '/found.jsonl');
    assert.equal(h.runner.linkSession(id, 'thread-1', '/again.jsonl'), null, 'a link is filled once');
  }
});

test('stopping never waits on the lookup, before or after the process exits', async () => {
  // Stopped while running: the kill ends the process, the run is stopped at once.
  const running = harness({
    lookupTimeoutMs: 60_000,
    locateSession: () => new Promise(() => {}),
    killTree: (child) => setImmediate(() => child.emit('close', null, 'SIGTERM'))
  });
  const first = running.runner.start(running.spec);
  await tick();
  let started = Date.now();
  const stopped = await running.runner.stop(first.id, 'app-quit');
  assert.ok(Date.now() - started < 1000);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.reasonCode, 'app-quit');
  assert.deepEqual(running.changes, ['starting', 'running', 'stopped']);

  // Exited, lookup still running: quitting ends it now, keeping how it ended.
  const exited = harness({ lookupTimeoutMs: 60_000, locateSession: () => new Promise(() => {}) });
  const second = exited.runner.start(exited.spec);
  await tick();
  exited.children[0].emit('close', 0, null);
  started = Date.now();
  const result = await exited.runner.stopAll('app-quit');
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.ok, true);
  assert.equal(exited.store.getRun(second.id).state, 'completed');
  assert.deepEqual(exited.store.getRun(second.id).session, { id: 'thread-1', file: null });
});

test('a client that never started, or a run without a session, ends at once and looks nothing up', async () => {
  const broken = harness({ spawnImpl: () => { throw new Error('ENOENT'); } });
  const record = broken.runner.start(broken.spec);
  assert.equal(record.state, 'failed', 'the caller still gets the failure straight away');
  assert.equal(record.reasonCode, 'client-start-failed');
  assert.deepEqual(broken.lookups, []);

  const silent = harness({ sessionId: null });
  const { id } = silent.runner.start(silent.spec);
  await tick();
  silent.children[0].emit('close', 0, null);
  assert.equal(silent.store.getRun(id).state, 'completed', 'no session to look up: ended in the same turn');
  assert.deepEqual(silent.lookups, []);
});
