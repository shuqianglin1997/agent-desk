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

// deps:
//   runtime()      the ProfileRuntimeSupervisor (ownership and open sets)
//   profiles()     async: the stored profiles
//   activeRuns()   the hub's runs still starting or running: [{ id, target: { id } }]
//   reader         a bundle reader (src/clients/app-update.js), for tests
//   platform, now
function createClientUpdates(deps = {}) {
  const platform = deps.platform || process.platform;
  const now = deps.now || (() => Date.now());
  const reader = deps.reader || sharedBundleReader();
  const activeRuns = typeof deps.activeRuns === 'function' ? deps.activeRuns : () => [];

  function backgroundRunsByProfile() {
    const counts = new Map();
    let runs = [];
    try { runs = activeRuns() || []; } catch (_error) { runs = []; }
    for (const run of runs) {
      const id = String(run?.target?.id || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  async function clientStatus(appId, runtime, liveIds, runCounts) {
    const update = apps.getApp(appId).update;
    const open = runtime.ownedOpenProfiles(appId);
    const set = runtime.openSet(appId);
    const bundlePath = [...open, ...(set?.members || [])].map((member) => member.appBundle).find(Boolean) || null;
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

  // { supported, clients: [...] }. Only macOS is supported.
  async function status() {
    if (platform !== 'darwin') return { supported: false, clients: [] };
    const runtime = deps.runtime();
    const profiles = await deps.profiles();
    runtime.updateProfiles(profiles);
    const liveIds = new Set(profiles.map((profile) => profile.id));
    const runCounts = backgroundRunsByProfile();
    const clients = [];
    for (const appId of updateClientIds()) clients.push(await clientStatus(appId, runtime, liveIds, runCounts));
    return { supported: true, clients };
  }

  return { status };
}

module.exports = { NO_REOPEN, updateClientIds, judgeWaiting, judgeReopen, createClientUpdates };
