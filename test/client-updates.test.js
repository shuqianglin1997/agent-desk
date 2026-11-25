// Orderly client updates (docs/ORDERLY_UPDATE_PLAN.md): the launch version
// and open set in the runtime store, the bundle reader, and the "update
// waiting" fact. Fake bundles, fake versions and fake processes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp');
const { ProfileRuntimeSupervisor, RUNTIME_STATE_VERSION } = require('../src/profile-runtime');
const { createBundleReader } = require('../src/clients/app-update');
const { judgeWaiting, judgeReopen, createClientUpdates, updateClientIds } = require('../src/client-updates');
const apps = require('../src/apps');

// A fake app bundle and ShipIt cache under a temp home. plutil is replaced by
// a table of values per file; files exist so the reader can stat them.
function fakeMac(t) {
  const home = makeTempDir(t, 'agentdesk-client-update-');
  const bundle = path.join(home, 'Applications', 'Fake.app');
  const values = new Map();
  const calls = [];
  const writePlist = (file, entries) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries));
    values.set(file, entries);
  };
  const plistValue = async (file, key) => {
    calls.push([file, key]);
    return values.get(file)?.[key] ?? null;
  };
  const shipIt = path.join(home, 'Library', 'Caches', 'com.example.fake.ShipIt');
  return {
    home, bundle, shipIt, calls, writePlist,
    info: path.join(bundle, 'Contents', 'Info.plist'),
    reader: createBundleReader({ home, plistValue })
  };
}

test('the bundle reader reads the version and bundle id, and plutil again only after the file changes', async (t) => {
  const mac = fakeMac(t);
  mac.writePlist(mac.info, { CFBundleShortVersionString: '1.2.0', CFBundleIdentifier: 'com.example.fake' });
  assert.deepEqual(await mac.reader.bundle(mac.bundle), { version: '1.2.0', bundleId: 'com.example.fake' });
  const first = mac.calls.length;
  await mac.reader.bundle(mac.bundle);
  assert.equal(mac.calls.length, first, 'unchanged file: no second plutil');
  mac.writePlist(mac.info, { CFBundleShortVersionString: '1.3.0', CFBundleIdentifier: 'com.example.fake', more: 'bytes' });
  assert.equal((await mac.reader.bundle(mac.bundle)).version, '1.3.0');
  assert.equal(await mac.reader.bundle(path.join(mac.home, 'Missing.app')), null);
  assert.equal(await mac.reader.bundle('relative/Fake.app'), null);
});

test('Squirrel ShipIt: a newer downloaded bundle for this app is staged; an installed or foreign one is not', async (t) => {
  const mac = fakeMac(t);
  const state = path.join(mac.shipIt, 'ShipItState.plist');
  const update = path.join(mac.shipIt, 'update.ABC', 'Fake.app');
  assert.deepEqual(await mac.reader.staged('squirrel-shipit', mac.bundle, 'com.example.fake'), { state: 'none' }, 'no ShipIt folder');

  mac.writePlist(state, { targetBundleURL: `file://${mac.bundle}/`, updateBundleURL: `file://${update}/` });
  assert.deepEqual(await mac.reader.staged('squirrel-shipit', mac.bundle, 'com.example.fake'), { state: 'none' }, 'downloaded bundle already moved into place');

  mac.writePlist(path.join(update, 'Contents', 'Info.plist'), { CFBundleShortVersionString: '1.3.0' });
  assert.deepEqual(await mac.reader.staged('squirrel-shipit', mac.bundle, 'com.example.fake'), { state: 'staged', version: '1.3.0' });

  assert.deepEqual(await mac.reader.staged('squirrel-shipit', path.join(mac.home, 'Other.app'), 'com.example.fake'), { state: 'none' }, 'targets another copy');
  mac.writePlist(state, { targetBundleURL: `file://${mac.bundle}/`, updateBundleURL: `file://${path.join(mac.home, 'elsewhere', 'Fake.app')}/` });
  assert.deepEqual(await mac.reader.staged('squirrel-shipit', mac.bundle, 'com.example.fake'), { state: 'unknown' }, 'outside the ShipIt folder');
  assert.deepEqual(await mac.reader.staged(null, mac.bundle, 'com.example.fake'), { state: 'unknown' });
  assert.deepEqual(await mac.reader.staged('squirrel-shipit', mac.bundle, '../escape'), { state: 'unknown' });
});

test('update waiting: exact from the version on disk, inferred from the updater, otherwise not shown', () => {
  const at = 1000;
  assert.deepEqual(judgeWaiting({ open: [], now: at }), { value: false, certainty: 'exact', at, source: 'nothing-open' });
  assert.deepEqual(judgeWaiting({ open: [{ appVersion: '1.2.0' }, { appVersion: '1.3.0' }], diskVersion: '1.3.0', now: at }),
    { value: true, certainty: 'exact', at, source: 'version' });
  const staged = { state: 'staged', version: '1.4.0' };
  assert.deepEqual(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: '1.3.0', signal: 'squirrel-shipit', staged, now: at }),
    { value: true, certainty: 'inferred', at, source: 'squirrel-shipit' });
  assert.equal(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: '1.3.0', signal: 'squirrel-shipit', staged: { state: 'staged', version: '1.3.0' } }).value, false);
  assert.deepEqual(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: '1.3.0', signal: 'squirrel-shipit', staged: { state: 'none' }, now: at }),
    { value: false, certainty: 'inferred', at, source: 'squirrel-shipit' });
  // Not known: no signal, an unreadable app, an unknown start version.
  assert.equal(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: '1.3.0' }).certainty, 'unknown');
  assert.equal(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: null, signal: 'squirrel-shipit', staged }).certainty, 'unknown');
  assert.equal(judgeWaiting({ open: [{ appVersion: null }], diskVersion: '1.3.0', signal: 'squirrel-shipit', staged: { state: 'none' } }).certainty, 'unknown');
  assert.equal(judgeWaiting({ open: [{ appVersion: '1.3.0' }], diskVersion: '1.3.0', signal: 'squirrel-shipit', staged: { state: 'unknown' } }).value, null);
  assert.equal(judgeWaiting({ open: [{ appVersion: '2.0.0' }], diskVersion: '1.3.0' }).value, null, 'an older app on disk is not an update');
});

test('reopen offer: all exited, the set did not end by quitting, and the app on disk is newer', () => {
  const set = {
    members: [{ profileId: 'a', appVersion: '1.2.0' }, { profileId: 'b', appVersion: '1.2.0' }, { profileId: 'gone', appVersion: '1.2.0' }],
    startedAt: '2026-11-24T08:00:00.000Z', endedAt: '2026-11-24T09:00:00.000Z', endReason: 'observed-client-exit'
  };
  const liveIds = new Set(['a', 'b']);
  assert.deepEqual(judgeReopen({ set, openCount: 0, diskVersion: '1.3.0', liveIds }),
    { profileIds: ['a', 'b'], fromVersion: '1.2.0', toVersion: '1.3.0', endedAt: set.endedAt });
  assert.equal(judgeReopen({ set, openCount: 1, diskVersion: '1.3.0', liveIds }), null, 'one is open again');
  assert.equal(judgeReopen({ set, openCount: 0, diskVersion: '1.2.0', liveIds }), null, 'same version');
  assert.equal(judgeReopen({ set: { ...set, endedAt: null }, diskVersion: '1.3.0', liveIds }), null, 'not ended');
  for (const endReason of ['app-quit', 'profile-remove', 'profile-path-change', 'crashpad-prune-failed']) {
    assert.equal(judgeReopen({ set: { ...set, endReason }, diskVersion: '1.3.0', liveIds }), null, endReason);
  }
  assert.equal(judgeReopen({ set, diskVersion: '1.3.0', liveIds: new Set() }), null, 'every member removed');
  assert.equal(judgeReopen({ set: { ...set, endReason: 'client-update' }, diskVersion: '1.3.0', liveIds }).profileIds.length, 2);
});

function processFor(pid, profilePath) {
  return { pid, ppid: 1, pgid: pid, command: `Fake --user-data-dir="${profilePath}" --type=browser` };
}

test('the runtime store keeps each launch version and the open set until the last account exits', async (t) => {
  const root = makeTempDir(t, 'agentdesk-open-set-');
  const stateFile = path.join(root, 'profile-runtime.json');
  const profiles = ['a', 'b'].map((id) => ({ id, appId: 'claude', profilePath: path.join(root, id) }));
  const other = { id: 'c', appId: 'cursor', profilePath: path.join(root, 'c') };
  let processes = [];
  const supervisor = new ProfileRuntimeSupervisor({ stateFile, snapshotProcessRecords: () => processes, limits: { terminateGraceMs: 0 } });
  supervisor.updateProfiles([...profiles, other]);
  supervisor.registerLaunch(profiles[0], { pid: 11, appVersion: '1.2.0', appBundle: '/Applications/Fake.app' });
  supervisor.registerLaunch(profiles[1], { pid: 12, appVersion: 'not a version!', appBundle: 'relative.app' });
  supervisor.registerLaunch(other, { pid: 13 });
  processes = [processFor(11, profiles[0].profilePath), processFor(12, profiles[1].profilePath), processFor(13, other.profilePath)];

  assert.deepEqual(supervisor.ownedOpenProfiles('claude').map((item) => [item.profile.id, item.appVersion, item.appBundle]),
    [['a', '1.2.0', '/Applications/Fake.app'], ['b', null, null]]);
  assert.deepEqual(supervisor.openSet('claude').members.map((member) => member.profileId), ['a', 'b']);

  processes = processes.filter((item) => item.pid !== 11);
  await supervisor.stopProfile(profiles[0], 'user-request');
  assert.equal(supervisor.openSet('claude').endedAt, null, 'b is still open');
  processes = processes.filter((item) => item.pid !== 12);
  await supervisor.tick();
  const ended = supervisor.openSet('claude');
  assert.equal(ended.endReason, 'observed-client-exit');
  assert.ok(ended.endedAt);
  assert.deepEqual(ended.members.map((member) => member.profileId), ['a', 'b'], 'everyone who was open in the set');
  assert.equal(supervisor.openSet('cursor').endedAt, null, 'another client is its own set');

  // Saved as version 2 and read back.
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(saved.version, RUNTIME_STATE_VERSION);
  assert.equal(saved.version, 2);
  const reloaded = new ProfileRuntimeSupervisor({ stateFile, snapshotProcessRecords: () => processes });
  assert.deepEqual(reloaded.openSet('claude'), ended);

  // A new launch after the set ended starts a new set.
  reloaded.updateProfiles([...profiles, other]);
  reloaded.registerLaunch(profiles[1], { pid: 21, appVersion: '1.3.0' });
  assert.deepEqual(reloaded.openSet('claude').members.map((member) => [member.profileId, member.appVersion]), [['b', '1.3.0']]);
});

test('quitting AgentDesk ends the open set as app-quit; a version 1 store loads with versions unknown', async (t) => {
  const root = makeTempDir(t, 'agentdesk-open-set-quit-');
  const stateFile = path.join(root, 'profile-runtime.json');
  const profile = { id: 'a', appId: 'claude', profilePath: path.join(root, 'a') };
  fs.writeFileSync(stateFile, JSON.stringify({
    version: 1,
    records: [{ profileId: 'a', profilePath: profile.profilePath, launchPid: 11, launchedAt: '2026-11-24T08:00:00.000Z', active: true, owned: true }]
  }));
  let processes = [processFor(11, profile.profilePath)];
  const supervisor = new ProfileRuntimeSupervisor({ stateFile, snapshotProcessRecords: () => processes, limits: { terminateGraceMs: 0 } });
  supervisor.updateProfiles([profile]);
  assert.deepEqual(supervisor.ownedOpenProfiles('claude').map((item) => [item.profile.id, item.appVersion]), [['a', null]]);
  assert.equal(supervisor.openSet('claude'), null, 'a version 1 store has no open set');
  supervisor.registerLaunch(profile, { pid: 11, appVersion: '1.2.0' });
  const signal = () => { processes = []; };
  const quitting = new ProfileRuntimeSupervisor({ stateFile, snapshotProcessRecords: () => processes, signalProcess: signal, limits: { terminateGraceMs: 0 } });
  quitting.updateProfiles([profile]);
  await quitting.stopAll({ terminateOwned: true, reason: 'app-quit' });
  assert.equal(quitting.openSet('claude').endReason, 'app-quit');
});

test('status: macOS only, AgentDesk accounts with their start versions, no paths', async () => {
  const runtime = {
    updateProfiles() {},
    ownedOpenProfiles: (appId) => (appId === 'claude'
      ? [{ profile: { id: 'a' }, appVersion: '1.2.0', appBundle: '/Applications/Fake.app' }, { profile: { id: 'b' }, appVersion: '1.3.0', appBundle: '/Applications/Fake.app' }]
      : []),
    openSet: (appId) => (appId === 'codex'
      ? { members: [{ profileId: 'c', appVersion: '2.0.0', appBundle: '/Applications/Other.app' }], endedAt: '2026-11-24T09:00:00.000Z', endReason: 'observed-client-exit' }
      : null)
  };
  const reader = {
    bundle: async (bundlePath) => ({ version: bundlePath.endsWith('Fake.app') ? '1.3.0' : '2.1.0', bundleId: 'com.example.fake' }),
    staged: async () => ({ state: 'none' })
  };
  const service = createClientUpdates({
    platform: 'darwin',
    now: () => 5,
    runtime: () => runtime,
    profiles: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    activeRuns: () => [{ id: 'run-1', target: { id: 'b' } }],
    reader
  });
  const result = await service.status();
  assert.equal(result.supported, true);
  assert.equal(result.busy, null);
  assert.deepEqual(result.clients.map((client) => client.appId), updateClientIds());
  const claude = result.clients.find((client) => client.appId === 'claude');
  assert.deepEqual(claude, {
    appId: 'claude',
    mechanism: 'squirrel',
    waitingSignal: 'squirrel-shipit',
    diskVersion: '1.3.0',
    open: [{ profileId: 'a', launchVersion: '1.2.0', backgroundRuns: 0 }, { profileId: 'b', launchVersion: '1.3.0', backgroundRuns: 1 }],
    waiting: { value: true, certainty: 'exact', at: 5, source: 'version' },
    reopen: null
  });
  const codex = result.clients.find((client) => client.appId === 'codex');
  assert.deepEqual(codex.reopen, { profileIds: ['c'], fromVersion: '2.0.0', toVersion: '2.1.0', endedAt: '2026-11-24T09:00:00.000Z' });
  assert.equal(JSON.stringify(result).includes('/Applications'), false, 'no bundle paths leave Main');

  const elsewhere = createClientUpdates({ platform: 'win32', runtime: () => runtime, profiles: async () => [] });
  assert.deepEqual(await elsewhere.status(), { supported: false, busy: null, clients: [] });
});

test('only desktop adapters declare how they update, with known mechanisms', () => {
  const { MECHANISMS, WINDOWS_MECHANISMS, WAITING_SIGNALS } = require('../src/clients/app-update');
  assert.deepEqual(updateClientIds(), ['claude', 'codex', 'kimi', 'kimi-work', 'cursor']);
  for (const appId of updateClientIds()) {
    const update = apps.getApp(appId).update;
    assert.ok(MECHANISMS.includes(update.mechanism), appId);
    assert.ok(WINDOWS_MECHANISMS.includes(update.windows), appId);
    assert.ok(update.waiting === null || WAITING_SIGNALS.includes(update.waiting), appId);
  }
});

// A fake supervisor: AgentDesk's open accounts of 'claude', stopped on request.
function fakeRuntime({ open = [], set = null, failStop = null } = {}) {
  const state = { open: open.map((member) => ({ ...member })), set, stops: [] };
  return {
    state,
    updateProfiles() {},
    ownedOpenProfiles: (appId) => (appId === 'claude'
      ? state.open.map((member) => ({ profile: { id: member.id, appId: 'claude' }, appVersion: member.version, appBundle: '/Applications/Fake.app' }))
      : []),
    openSet: (appId) => (appId === 'claude' ? state.set : null),
    async stopProfile(profile, reason) {
      state.stops.push([profile.id, reason]);
      if (failStop === profile.id) return { ok: false, reasonCode: 'profile-process-still-running' };
      state.open = state.open.filter((member) => member.id !== profile.id);
      return { ok: true, stopped: 1, remaining: 0 };
    }
  };
}

// The service with a fake clock: delay() moves time on, onWait runs each poll.
function service({ runtime, disk, staged = { state: 'none' }, runs = [], launchFails = [], onWait = () => {}, platform = 'darwin' }) {
  let clock = 0;
  const log = [];
  const updates = createClientUpdates({
    platform,
    now: () => clock,
    delay: async (ms) => { clock += ms; onWait(clock); },
    waitMs: 10_000,
    pollMs: 2_000,
    runtime: () => runtime,
    profiles: async () => [{ id: 'a' }, { id: 'b' }],
    activeRuns: () => runs,
    stopRun: async (id) => { log.push(['stop-run', id]); },
    launch: async (id) => { log.push(['open', id]); return launchFails.includes(id) ? { ok: false, reasonCode: 'client-not-installed' } : { ok: true }; },
    reader: {
      bundle: async () => ({ version: disk(), bundleId: 'com.example.fake' }),
      staged: async () => staged
    }
  });
  return { updates, log };
}

test('restart all: the newer app is on disk, so close each, then open the same ones again', async () => {
  const runtime = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }, { id: 'b', version: '1.2.0' }] });
  const { updates, log } = service({ runtime, disk: () => '1.3.0' });
  assert.equal(await updates.refusal('restart', { appId: 'claude' }), null);
  assert.deepEqual(await updates.restartAll({ appId: 'claude' }), { ok: true, version: '1.3.0', opened: ['a', 'b'], failed: [] });
  assert.deepEqual(runtime.state.stops, [['a', 'client-update'], ['b', 'client-update']]);
  assert.deepEqual(log, [['open', 'a'], ['open', 'b']]);
  assert.equal((await updates.status()).busy, null);
});

test('restart all: a downloaded update is waited for after closing; it stops there when it never arrives', async () => {
  let version = '1.2.0';
  const runtime = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }] });
  const seen = [];
  let check = null;
  const { updates, log } = service({
    runtime,
    disk: () => version,
    staged: { state: 'staged', version: '1.3.0' },
    onWait: (clock) => { seen.push(clock); if (clock >= 4_000) version = '1.3.0'; check = updates.status(); }
  });
  const result = await updates.restartAll({ appId: 'claude' });
  assert.deepEqual(result, { ok: true, version: '1.3.0', opened: ['a'], failed: [] });
  assert.deepEqual(seen, [2_000, 4_000]);
  assert.equal((await check).busy.phase, 'waiting', 'the status says what it is doing meanwhile');
  assert.deepEqual(log, [['open', 'a']]);

  const stuck = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }, { id: 'b', version: '1.2.0' }] });
  const never = service({ runtime: stuck, disk: () => '1.2.0', staged: { state: 'staged', version: '1.3.0' } });
  assert.deepEqual(await never.updates.restartAll({ appId: 'claude' }), { ok: false, reasonCode: 'update-not-installed', closed: ['a', 'b'], waitedMs: 10_000 });
  assert.deepEqual(never.log, [], 'nothing is opened without the new version');
});

test('restart all: background runs refuse it unless the person chose to stop them; a failed close stops there', async () => {
  const runs = [{ id: 'run-1', target: { id: 'b' } }];
  const runtime = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }, { id: 'b', version: '1.2.0' }] });
  const refused = service({ runtime, disk: () => '1.3.0', runs });
  assert.equal(await refused.updates.refusal('restart', { appId: 'claude' }), 'background-runs-active');
  assert.deepEqual(await refused.updates.restartAll({ appId: 'claude' }), { ok: false, reasonCode: 'background-runs-active' });
  assert.deepEqual(runtime.state.stops, []);

  const chosen = service({ runtime, disk: () => '1.3.0', runs });
  assert.equal((await chosen.updates.restartAll({ appId: 'claude', stopBackgroundRuns: true })).ok, true);
  assert.deepEqual(chosen.log, [['stop-run', 'run-1'], ['open', 'a'], ['open', 'b']]);

  const failing = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }, { id: 'b', version: '1.2.0' }], failStop: 'b' });
  const failed = service({ runtime: failing, disk: () => '1.3.0' });
  assert.deepEqual(await failed.updates.restartAll({ appId: 'claude' }), { ok: false, reasonCode: 'client-close-failed', profileId: 'b', closed: ['a'] });
  assert.deepEqual(failed.log, []);
});

test('one sequence at a time, and fixed reasons when there is nothing to do', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = fakeRuntime({ open: [{ id: 'a', version: '1.2.0' }] });
  const slow = createClientUpdates({
    platform: 'darwin',
    runtime: () => runtime,
    profiles: async () => [{ id: 'a' }],
    launch: async () => { await gate; return { ok: true }; },
    reader: { bundle: async () => ({ version: '1.3.0', bundleId: 'x' }), staged: async () => ({ state: 'none' }) }
  });
  const first = slow.restartAll({ appId: 'claude' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((await slow.status()).busy, { appId: 'claude', phase: 'opening' });
  assert.equal(await slow.refusal('reopen', { appId: 'claude' }), 'client-update-busy');
  assert.deepEqual(await slow.restartAll({ appId: 'claude' }), { ok: false, reasonCode: 'client-update-busy' });
  release();
  assert.equal((await first).ok, true);

  const idle = service({ runtime: fakeRuntime({ open: [{ id: 'a', version: '1.3.0' }] }), disk: () => '1.3.0' });
  assert.equal(await idle.updates.refusal('restart', { appId: 'claude' }), 'no-update-waiting');
  assert.equal(await idle.updates.refusal('restart', { appId: 'claude-cli' }), 'client-unknown');
  assert.equal(await idle.updates.refusal('reopen', { appId: 'claude' }), 'nothing-to-reopen');
  const empty = service({ runtime: fakeRuntime(), disk: () => '1.3.0' });
  assert.equal(await empty.updates.refusal('restart', { appId: 'claude' }), 'nothing-open');
  const windows = service({ runtime: fakeRuntime(), disk: () => '1.3.0', platform: 'win32' });
  assert.equal(await windows.updates.refusal('restart', { appId: 'claude' }), 'platform-unsupported');
});

test('reopen: the accounts that were open before the update, each opened the usual way', async () => {
  const set = { members: [{ profileId: 'a', appVersion: '1.2.0', appBundle: '/Applications/Fake.app' }, { profileId: 'b', appVersion: '1.2.0', appBundle: '/Applications/Fake.app' }], startedAt: null, endedAt: '2026-11-24T09:00:00.000Z', endReason: 'observed-client-exit' };
  const { updates, log } = service({ runtime: fakeRuntime({ set }), disk: () => '1.3.0', launchFails: ['b'] });
  assert.equal(await updates.refusal('reopen', { appId: 'claude' }), null);
  assert.deepEqual(await updates.reopenSet({ appId: 'claude' }), {
    ok: false, reasonCode: 'client-reopen-failed', version: '1.3.0', opened: ['a'], failed: [{ profileId: 'b', reasonCode: 'client-not-installed' }]
  });
  assert.deepEqual(log, [['open', 'a'], ['open', 'b']]);
});

test('the three commands take only a client id and one choice; refusals are reason codes', async () => {
  const { runCommand, loadPreload } = require('./helpers/behaviour');
  const calls = [];
  const clientUpdates = {
    status: async () => ({ supported: true, busy: null, clients: [] }),
    refusal: async (action, input) => { calls.push([action, input]); return input.appId === 'claude' ? null : 'client-unknown'; },
    restartAll: async (input) => ({ ok: true, input }),
    reopenSet: async (input) => ({ ok: true, input })
  };
  assert.deepEqual(await runCommand('client:updateStatus', { clientUpdates }), { supported: true, busy: null, clients: [] });
  assert.deepEqual(await runCommand('client:updateRestartAll', { clientUpdates }, { appId: 'claude', stopBackgroundRuns: 'yes', profilePath: '/x' }),
    { ok: true, input: { appId: 'claude', stopBackgroundRuns: false } });
  assert.deepEqual(await runCommand('client:reopenSet', { clientUpdates }, { appId: 'claude', stopBackgroundRuns: true }), { ok: true, input: { appId: 'claude' } });
  assert.deepEqual(await runCommand('client:updateRestartAll', { clientUpdates }, { appId: '../Claude' }), { ok: false, reasonCode: 'client-unknown' });
  assert.deepEqual(calls.map(([action]) => action), ['restart', 'reopen', 'restart']);

  const { api, calls: ipc } = loadPreload();
  await api.restartClientForUpdate('claude', { stopBackgroundRuns: true, extra: 1 });
  await api.reopenClientSet('codex');
  await api.getClientUpdateStatus();
  assert.deepEqual(JSON.parse(JSON.stringify(ipc)), [
    ['invoke', 'client:updateRestartAll', { appId: 'claude', stopBackgroundRuns: true }],
    ['invoke', 'client:reopenSet', { appId: 'codex' }],
    ['invoke', 'client:updateStatus']
  ]);
});

test('the command line relays the same actions, refuses without a supervising desktop, and reports failures as errors', async () => {
  const { cliCommand } = require('../src/commands/registry');
  const { InterfaceError } = require('../src/automation/service');
  const seen = [];
  const clientUpdates = {
    status: async () => ({ supported: true, busy: null, clients: [] }),
    restartAll: async (input) => { seen.push(input); return input.appId === 'cursor' ? { ok: false, reasonCode: 'update-not-installed', closed: ['a'], waitedMs: 180000 } : { ok: false, reasonCode: 'background-runs-active' }; },
    reopenSet: async (input) => ({ ok: true, version: '1.3.0', opened: [input.appId], failed: [] })
  };
  const deps = { clientUpdates, cliOnlyInstance: false, InterfaceError };
  const restart = cliCommand('clients restart-all', 'desktop');
  assert.equal(restart.effects, 'restart-local-clients');
  assert.deepEqual(await cliCommand('clients update-status', 'desktop').exec(deps, {}), { supported: true, busy: null, clients: [] });
  assert.deepEqual(await cliCommand('clients reopen', 'desktop').exec(deps, { app: 'claude' }), { ok: true, version: '1.3.0', opened: ['claude'], failed: [] });
  await assert.rejects(restart.exec(deps, { app: 'claude', 'stop-background-runs': 'true' }), (error) => error.code === 'background-runs-active' && error.exitCode === 2 && error.extra === null);
  await assert.rejects(restart.exec(deps, { app: 'cursor' }), (error) => error.code === 'update-not-installed' && error.extra.closed[0] === 'a' && error.extra.waitedMs === 180000);
  assert.deepEqual(seen, [{ appId: 'claude', stopBackgroundRuns: false }, { appId: 'cursor', stopBackgroundRuns: false }], 'only "yes" stops background runs');
  await restart.exec(deps, { app: 'claude', 'stop-background-runs': 'yes' }).catch(() => {});
  assert.equal(seen[2].stopBackgroundRuns, true);
  await assert.rejects(cliCommand('clients update-status', 'desktop').exec({ ...deps, cliOnlyInstance: true }, {}), (error) => error.code === 'desktop-not-running');
  // The command line waits long enough for a restart that waits for the updater.
  const { relayTimeoutFor } = require('../src/automation/packaged-cli');
  const { WAIT_FOR_UPDATE_MS } = require('../src/client-updates');
  assert.ok(relayTimeoutFor('clients restart-all') >= WAIT_FOR_UPDATE_MS + 60_000);
  assert.equal(relayTimeoutFor('clients reopen'), relayTimeoutFor('profiles launch'), 'the others keep the usual wait');
});
