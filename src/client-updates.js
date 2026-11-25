'use strict';

// AgentDesk — orderly client updates (docs/ORDERLY_UPDATE_PLAN.md). On macOS
// every account of one client runs the same installed app, and its updater
// can only swap that app once all of them have exited. AgentDesk cannot make
// that independent; it can make it orderly: see that an update is waiting
// for the accounts it opened, and offer to reopen exactly those once the
// update is in place. It never downloads or installs an update, never
// changes a client's update settings and never decides on its own when to
// restart.
//
// "Update waiting" is a fact (src/core/result.js):
//   exact     the app on disk is newer than the version an open account
//             started from (both read from the bundle's Info.plist)
//   inferred  the client's updater has a newer bundle downloaded for this
//             app (the adapter's `waiting` signal, src/clients/app-update.js)
//   unknown   AgentDesk cannot tell; nothing is shown
// Only AgentDesk's own launches count (ProfileRuntimeSupervisor ownership);
// the default instance an updater relaunches is not AgentDesk's.

const apps = require('./apps');
const { CERTAINTY, fact, unknown } = require('./core/result');
const { compareVersions } = require('./tool-maintenance');
const { sharedBundleReader } = require('./clients/app-update');

// Ways an open set can end after which AgentDesk does not offer to reopen it:
// it closed them itself when quitting, or the location was removed, moved or
// stopped for a disk incident.
const NO_REOPEN = new Set(['app-quit', 'profile-remove', 'profile-path-change', 'crashpad-prune-failed']);

// How long a restart waits for the updater to put the new version in place,
// and how often it looks.
const WAIT_FOR_UPDATE_MS = 3 * 60_000;
const WAIT_POLL_MS = 2_000;
const REASON = /^[a-z0-9][a-z0-9-]{0,63}$/;

const newer = (candidate, than) => Boolean(candidate && than) && compareVersions(candidate, than) === 1;

// The clients whose adapter declares how it updates, in list order.
function updateClientIds() {
  return apps.appIds().filter((appId) => Boolean(apps.getApp(appId).update));
}

// Whether an update is waiting for the accounts AgentDesk has open.
//   open: [{ appVersion }]; diskVersion: string | null;
//   signal: the adapter's `waiting` signal or null;
//   staged: the signal's reading ({ state, version }) or null.
function judgeWaiting({ open = [], diskVersion = null, signal = null, staged = null, now = Date.now() } = {}) {
  if (!open.length) return fact(false, CERTAINTY.EXACT, { at: now, source: 'nothing-open' });
  if (diskVersion && open.some((member) => newer(diskVersion, member.appVersion))) {
    return fact(true, CERTAINTY.EXACT, { at: now, source: 'version' });
  }
  if (!signal || !diskVersion || !staged || staged.state === 'unknown') return unknown({ at: now, source: signal });
  if (staged.state === 'staged' && newer(staged.version, diskVersion)) {
    return fact(true, CERTAINTY.INFERRED, { at: now, source: signal });
  }
  // Nothing newer downloaded; an open account whose start version is unknown
  // might still be running an older app.
  if (open.every((member) => member.appVersion)) return fact(false, CERTAINTY.INFERRED, { at: now, source: signal });
  return unknown({ at: now, source: signal });
}

// The reopen offer: AgentDesk's accounts of this client have all exited, the
// set did not end by AgentDesk quitting (or a removed, moved or fused
// location), and the app on disk is newer than what they started from.
//   set: the client's open set; openCount: AgentDesk's accounts open now;
//   liveIds: profile ids that still exist.
function judgeReopen({ set = null, openCount = 0, diskVersion = null, liveIds = new Set() } = {}) {
  if (!set || !set.endedAt || openCount > 0 || NO_REOPEN.has(set.endReason)) return null;
  const members = set.members.filter((member) => liveIds.has(member.profileId));
  const older = members.filter((member) => newer(diskVersion, member.appVersion));
  if (!older.length) return null;
  const fromVersion = older.map((member) => member.appVersion).sort((a, b) => compareVersions(b, a) || 0)[0];
  return { profileIds: members.map((member) => member.profileId), fromVersion, toVersion: diskVersion, endedAt: set.endedAt };
}

function backgroundRunsByProfile(runs) {
  const counts = new Map();
  for (const run of runs) {
    const id = String(run?.target?.id || '');
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function bundlePathOf(open, set) {
  return [...open, ...(set?.members || [])].map((member) => member.appBundle).find(Boolean) || null;
}

// One client's status: AgentDesk's open accounts with their start versions
// and background runs, the version on disk, the waiting fact, the reopen offer.
async function clientStatusOf({ reader, now }, appId, runtime, liveIds, runCounts) {
  const update = apps.getApp(appId).update;
  const open = runtime.ownedOpenProfiles(appId);
  const set = runtime.openSet(appId);
  const bundlePath = bundlePathOf(open, set);
  const disk = bundlePath ? await reader.bundle(bundlePath) : null;
  const diskVersion = disk?.version || null;
  const signal = update.waiting || null;
  const staged = open.length && signal && disk ? await reader.staged(signal, bundlePath, disk.bundleId) : null;
  return {
    appId,
    mechanism: update.mechanism,
    waitingSignal: signal,
    diskVersion,
    open: open.map((member) => ({
      profileId: member.profile.id,
      launchVersion: member.appVersion,
      backgroundRuns: runCounts.get(member.profile.id) || 0
    })),
    waiting: judgeWaiting({ open, diskVersion, signal, staged, now: now() }),
    reopen: judgeReopen({ set, openCount: open.length, diskVersion, liveIds })
  };
}

// The existing stop for each, in order; the first that fails stops the rest.
async function closeEach(runtime, open) {
  const closed = [];
  for (const member of open) {
    const stopped = await runtime.stopProfile(member.profile, 'client-update');
    if (!stopped?.ok) return { closed, failedId: member.profile.id };
    closed.push(member.profile.id);
  }
  return { closed, failedId: null };
}

// The version on disk once it is newer than `baseline`, or null at the deadline.
async function waitForNewVersion({ reader, now, delay, waitMs, pollMs }, bundlePath, baseline) {
  const deadline = now() + waitMs;
  for (;;) {
    const version = (await reader.bundle(bundlePath))?.version || null;
    if (newer(version, baseline)) return version;
    if (now() >= deadline) return null;
    await delay(pollMs);
  }
}

// Each opened the usual way, in order; a failure does not stop the others.
async function openEach(launch, profileIds) {
  const opened = [];
  const failed = [];
  for (const profileId of profileIds) {
    let result = null;
    try { result = await launch(profileId); } catch (_error) { result = null; }
    if (result?.ok) opened.push(profileId);
    else failed.push({ profileId, reasonCode: REASON.test(String(result?.reasonCode || '')) ? result.reasonCode : 'profile-launch-failed' });
  }
  return failed.length
    ? { ok: false, reasonCode: 'client-reopen-failed', opened, failed }
    : { ok: true, opened, failed };
}

// deps:
//   runtime()        the ProfileRuntimeSupervisor (ownership and open sets)
//   profiles()       async: the stored profiles
//   activeRuns()     the hub's runs still starting or running: [{ id, target: { id } }]
//   stopRun(id)      async: stop one hub run (only after the person chose to)
//   launch(id)       async: open one stored profile the usual way ({ ok, reasonCode })
//   reader           a bundle reader (src/clients/app-update.js), for tests
//   platform, now, delay(ms), waitMs, pollMs
function createClientUpdates(deps = {}) {
  const platform = deps.platform || process.platform;
  const timing = {
    reader: deps.reader || sharedBundleReader(),
    now: deps.now || (() => Date.now()),
    delay: deps.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    waitMs: Number.isFinite(deps.waitMs) ? deps.waitMs : WAIT_FOR_UPDATE_MS,
    pollMs: Number.isFinite(deps.pollMs) ? deps.pollMs : WAIT_POLL_MS
  };
  const activeRuns = typeof deps.activeRuns === 'function' ? deps.activeRuns : () => [];
  // One sequence at a time, for any client: { appId, phase, startedAt }.
  let busy = null;

  function runsNow() {
    try { return activeRuns() || []; } catch (_error) { return []; }
  }

  async function context() {
    const runtime = deps.runtime();
    const profiles = await deps.profiles();
    runtime.updateProfiles(profiles);
    return { runtime, liveIds: new Set(profiles.map((profile) => profile.id)) };
  }

  // { supported, busy, clients: [...] }. Only macOS is supported.
  async function status() {
    if (platform !== 'darwin') return { supported: false, busy: null, clients: [] };
    // What a sequence is doing at the moment this was asked.
    const doing = busy ? { appId: busy.appId, phase: busy.phase } : null;
    const { runtime, liveIds } = await context();
    const runCounts = backgroundRunsByProfile(runsNow());
    const clients = [];
    for (const appId of updateClientIds()) clients.push(await clientStatusOf(timing, appId, runtime, liveIds, runCounts));
    return { supported: true, busy: doing, clients };
  }

  // Whether an action can run now: null, or a fixed reason code.
  //   action: 'restart' | 'reopen'; input: { appId, stopBackgroundRuns }
  async function refusal(action, input = {}) {
    if (platform !== 'darwin') return 'platform-unsupported';
    if (!updateClientIds().includes(input.appId)) return 'client-unknown';
    if (busy) return 'client-update-busy';
    const { runtime, liveIds } = await context();
    const client = await clientStatusOf(timing, input.appId, runtime, liveIds, backgroundRunsByProfile(runsNow()));
    if (action === 'reopen') return client.reopen ? null : 'nothing-to-reopen';
    if (!client.open.length) return 'nothing-open';
    if (client.waiting.value !== true) return 'no-update-waiting';
    if (client.open.some((member) => member.backgroundRuns > 0) && input.stopBackgroundRuns !== true) return 'background-runs-active';
    return null;
  }

  // Close every account of this client that AgentDesk opened, wait until the
  // new version is in place, then open exactly those again, each with its own
  // data folder. Background runs on them are stopped only when the person
  // chose to (stopBackgroundRuns). When the new version does not arrive in
  // time, it says so and stops there: the accounts stay closed.
  async function restartAll(input = {}) {
    const refused = await refusal('restart', input);
    if (refused) return { ok: false, reasonCode: refused };
    if (busy) return { ok: false, reasonCode: 'client-update-busy' };
    busy = { appId: input.appId, phase: 'closing', startedAt: timing.now() };
    try {
      const { runtime, liveIds } = await context();
      const runs = runsNow();
      const client = await clientStatusOf(timing, input.appId, runtime, liveIds, backgroundRunsByProfile(runs));
      const open = runtime.ownedOpenProfiles(input.appId);
      const ids = new Set(open.map((member) => member.profile.id));
      for (const run of runs.filter((item) => ids.has(String(item?.target?.id || '')))) {
        if (input.stopBackgroundRuns !== true) return { ok: false, reasonCode: 'background-runs-active', closed: [] };
        try { await deps.stopRun(run.id); } catch (_error) { return { ok: false, reasonCode: 'background-run-stop-failed', closed: [] }; }
      }
      const { closed, failedId } = await closeEach(runtime, open);
      if (failedId) return { ok: false, reasonCode: 'client-close-failed', profileId: failedId, closed };
      // Exact: the newer app is on disk already. Inferred: the updater swaps
      // it in now that the accounts are closed; wait for the version to change.
      busy.phase = 'waiting';
      let version = client.diskVersion;
      if (client.waiting.certainty !== CERTAINTY.EXACT) {
        version = await waitForNewVersion(timing, bundlePathOf(open, null), client.diskVersion);
        if (!version) return { ok: false, reasonCode: 'update-not-installed', closed, waitedMs: timing.waitMs };
      }
      busy.phase = 'opening';
      const { ok, reasonCode, opened, failed } = await openEach(deps.launch, closed);
      return ok ? { ok, version, opened, failed } : { ok, reasonCode, version, opened, failed };
    } finally {
      busy = null;
    }
  }

  // Open again exactly the accounts of the reopen offer.
  async function reopenSet(input = {}) {
    const refused = await refusal('reopen', input);
    if (refused) return { ok: false, reasonCode: refused };
    if (busy) return { ok: false, reasonCode: 'client-update-busy' };
    busy = { appId: input.appId, phase: 'opening', startedAt: timing.now() };
    try {
      const { runtime, liveIds } = await context();
      const client = await clientStatusOf(timing, input.appId, runtime, liveIds, new Map());
      if (!client.reopen) return { ok: false, reasonCode: 'nothing-to-reopen' };
      const version = client.reopen.toVersion;
      const { ok, reasonCode, opened, failed } = await openEach(deps.launch, client.reopen.profileIds);
      return ok ? { ok, version, opened, failed } : { ok, reasonCode, version, opened, failed };
    } finally {
      busy = null;
    }
  }

  return { status, refusal, restartAll, reopenSet };
}

module.exports = { NO_REOPEN, WAIT_FOR_UPDATE_MS, updateClientIds, judgeWaiting, judgeReopen, createClientUpdates };
