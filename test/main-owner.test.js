// One owner for Main's periodic tasks and resources (architecture phase 5,
// docs/ARCHITECTURE_PLAN.md §5.6 and §5.9): tasks are registered with their
// interval and whether they pause while the window is hidden; resources with
// how to stop them; quitting stops tasks first, then resources in the order
// they were registered, each started even when an earlier one fails or is
// still finishing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOwner } = require('../src/main/owner');
const { makeTempDir } = require('./helpers/temp');

function fakeClock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    setInterval(fn, ms) { const id = next++; timers.set(id, { fn, ms, at: now + ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [, timer] = due;
        now = timer.at;
        timer.at += timer.ms;
        timer.fn();
      }
      now = end;
    },
    count: () => timers.size
  };
}

test('a periodic task runs on its interval, can be cancelled, and pauses while hidden only when asked', () => {
  const clock = fakeClock();
  const owner = createOwner({ setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  const runs = { always: 0, visibleOnly: 0 };
  const always = owner.every('supervisor', 2000, () => { runs.always += 1; });
  owner.every('poll', 1000, () => { runs.visibleOnly += 1; }, { pauseWhenHidden: true });
  clock.advance(4000);
  assert.deepEqual(runs, { always: 2, visibleOnly: 4 });
  owner.setWindowVisible(false);
  clock.advance(4000);
  assert.deepEqual(runs, { always: 4, visibleOnly: 4 }, 'only the task that asked to pause paused');
  owner.setWindowVisible(true);
  clock.advance(2000);
  assert.deepEqual(runs, { always: 5, visibleOnly: 6 });
  always.cancel();
  clock.advance(4000);
  assert.equal(runs.always, 5);
  assert.deepEqual(owner.list().tasks, ['poll']);
});

test('quitting stops the tasks, then every resource in order with the reason, even past a failure', async () => {
  const clock = fakeClock();
  const owner = createOwner({ setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  const calls = [];
  owner.every('supervisor', 2000, () => calls.push('tick'));
  let finishSlow;
  owner.own('first', (reason) => { calls.push(`first:${reason}`); });
  owner.own('slow', () => { calls.push('slow:start'); return new Promise((resolve) => { finishSlow = resolve; }); });
  owner.own('broken', () => { calls.push('broken'); throw new Error('stop failed'); });
  owner.own('last', (reason) => { calls.push(`last:${reason}`); });
  assert.deepEqual(owner.list().resources, ['first', 'slow', 'broken', 'last']);
  const done = owner.shutdown('app-quit');
  assert.deepEqual(calls, ['first:app-quit', 'slow:start', 'broken', 'last:app-quit'], 'all started in order, at once');
  assert.equal(clock.count(), 0, 'no periodic task is left');
  clock.advance(10_000);
  assert.equal(calls.includes('tick'), false);
  finishSlow();
  const report = await done;
  assert.deepEqual(report.map((item) => [item.name, item.ok]), [['first', true], ['slow', true], ['broken', false], ['last', true]]);
  assert.deepEqual(await owner.shutdown('again'), [], 'a second quit does nothing');
  assert.throws(() => owner.own('late', () => {}), /owner-shut-down/);
});

test('a live codex app-server child is stopped when AgentDesk quits', async () => {
  const quota = require('../src/clients/codex/quota');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let stdinEnded = 0;
  let killed = 0;
  child.stdin = { write() { return true; }, end() { stdinEnded += 1; }, on() {} };
  child.kill = () => { killed += 1; };
  const pending = quota.queryCodexAppServer({ id: 'p', appId: 'codex', sessionRoot: '/tmp/codex-home' }, {
    launcher: { command: 'codex', prefixArgs: [] },
    spawnImpl: () => child,
    timeoutMs: 60_000
  }).catch((error) => error.code);
  assert.equal(quota.liveAppServers(), 1);
  quota.stopAppServers();
  assert.equal(stdinEnded, 1, 'its standard input is closed');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(killed, 1, 'and it is killed if it is still there');
  assert.equal(await pending, 'CODEX_RPC_STOPPED');
  assert.equal(quota.liveAppServers(), 0);
});

test('the runtime supervisor can be scheduled by the owner', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { ProfileRuntimeSupervisor } = require('../src/profile-runtime');
  const root = makeTempDir('agentdesk-owner-');
  try {
    const scheduled = [];
    const supervisor = new ProfileRuntimeSupervisor({
      stateFile: path.join(root, 'runtime.json'),
      snapshotProcessRecords: async () => [],
      schedule: (fn, ms) => { const task = { fn, ms, cancelled: false, cancel() { this.cancelled = true; } }; scheduled.push(task); return task; }
    });
    supervisor.start([]);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, 2000);
    supervisor.start([]);
    assert.equal(scheduled.length, 1, 'starting twice keeps one task');
    supervisor.stopMonitoring();
    assert.equal(scheduled[0].cancelled, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Main owns its resources in the old quit order, then the quota children and the scan worker', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const block = main.slice(main.indexOf('function ownMainResources() {'), main.indexOf('\n}\n', main.indexOf('function ownMainResources() {')));
  const names = [...block.matchAll(/mainOwner\.own\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, [
    'profile-runtime', 'pairing-endpoint-timer', 'invitation-inspections', 'pairing-approvals', 'provisioning', 'transfers',
    'task-packages', 'agent-actions', 'global-shortcuts', 'remote-control', 'remote-input', 'peers', 'signaling',
    'pairing-endpoint', 'quota-app-servers', 'scan-worker'
  ]);
  // The supervisor is created in src/main/support.js, scheduled by Main's owner.
  assert.match(require('./helpers/main-handler-source').mainHandlerSource(), /schedule: \(run, ms\) => (?:main\.)?mainOwner\.every\('profile-runtime', ms, run\)/);
  const quit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('function ownMainResources() {'));
  assert.match(quit, /appQuitting = true;\n\s*void mainOwner\.shutdown\('app-quit'\);/);
});
