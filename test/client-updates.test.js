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
  assert.deepEqual(await elsewhere.status(), { supported: false, clients: [] });
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
