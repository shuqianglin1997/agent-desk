'use strict';

/*
 * AgentDesk 调度中枢 — Main's relay and ledger service.
 *
 * A person asks their own Agent; that Agent calls the packaged CLI; Main
 * relays one exact call to one allowed account and records its title and
 * state. Main never starts, queues, retries or schedules a run on its own,
 * never chooses an account and never hands one run's result to another.
 * Refusals are immediate and carry fixed reason codes only.
 */

const path = require('node:path');
const { adapterFor, unsupportedReason } = require('../hub/adapters');
const {
  MAX_DEPTH,
  HubError,
  normalizeAccess,
  buildRoster,
  resolveAgent,
  resolveAllowedCwd,
  resolveCallerProfile,
  parseDepth
} = require('../hub/roster');
const { ACTIVE_STATES, RUN_ID } = require('../hub/store');

const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_TITLE = 120;
const MAX_FROM = 80;
// Variables a run must not inherit from AgentDesk itself.
const DROPPED_ENV = /^(KIMI_REGISTRY_API_KEY|CODEX_API_KEY|AGENTDESK_HUB_DEPTH|AGENTDESK_HUB_RUN)$/i;

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}

function elapsedMs(run, now) {
  const start = Date.parse(run.startedAt || run.createdAt || '');
  if (!Number.isFinite(start)) return null;
  const end = ACTIVE_STATES.has(run.state) ? now : Date.parse(run.endedAt || '');
  return Number.isFinite(end) ? Math.max(0, end - start) : null;
}

// What the CLI and the ledger see. No prompt, no answer, no session path.
function publicRun(run, now = Date.now()) {
  return {
    id: run.id,
    title: run.title,
    from: run.from,
    target: { id: run.target.profileId, name: run.target.name, app: run.target.app },
    state: run.state,
    reasonCode: run.reasonCode,
    access: run.access,
    depth: run.depth,
    parentRunId: run.parentRunId,
    caller: run.caller ? { id: run.caller.profileId, via: run.caller.via } : null,
    folder: run.cwd ? path.basename(run.cwd) : null,
    cwd: run.cwd,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    elapsedMs: elapsedMs(run, now),
    session: run.session ? { id: run.session.id, profileId: run.target.profileId, recordFound: Boolean(run.session.file) } : null
  };
}

function createAgentHub(deps) {
  const {
    store,
    runner,
    loadProfiles,
    catNames = () => new Map(),
    findLauncher = () => null,
    homeExists = () => true,
    signInState = async () => null,
    energyPeek = () => 'unknown',
    energyCheck = async (profile) => energyPeek(profile),
    baseEnv = () => process.env,
    launchEnv = (_profile, env) => env,
    callerHomeFor = () => null,
    realpath,
    now = () => Date.now()
  } = deps;

  async function measuredRoster() {
    const profiles = loadProfiles();
    const callable = profiles.filter((profile) => normalizeAccess(profile.hub).callable);
    const launchers = new Map();
    const signedIn = new Map();
    for (const profile of callable) {
      const adapter = adapterFor(profile.appId);
      if (!adapter) continue;
      if (!launchers.has(adapter.toolId)) launchers.set(adapter.toolId, Boolean(findLauncher(adapter.toolId)));
      let state = null;
      try { state = await signInState(profile); } catch (_error) { state = null; }
      signedIn.set(String(profile.id), state);
    }
    const roster = buildRoster(profiles, {
      names: catNames(profiles),
      launcherFound: (toolId) => launchers.get(toolId) === true,
      homeExists,
      signedIn: (profile) => signedIn.get(String(profile.id)),
      energy: (profile) => energyPeek(profile),
      busy: (profileId) => Boolean(runner.activeForProfile(profileId))
    });
    return { profiles, roster };
  }

  async function agentsList() {
    const { roster } = await measuredRoster();
    return {
      scope: 'callable-local-accounts',
      maxDepth: MAX_DEPTH,
      maxConcurrent: store.maxConcurrent(),
      running: runner.activeCount(),
      agents: roster
    };
  }

  function environmentFor(profile, depth, runId) {
    const base = Object.fromEntries(Object.entries(baseEnv() || {}).filter(([key]) => !DROPPED_ENV.test(key)));
    return { ...launchEnv(profile, base), AGENTDESK_HUB_DEPTH: String(depth), AGENTDESK_HUB_RUN: runId };
  }

  async function startRun(input = {}) {
    const title = cleanText(input.title, MAX_TITLE);
    if (!title) throw new HubError('title-required');
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!prompt.trim()) throw new HubError('prompt-required');
    if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new HubError('prompt-too-large');
    const access = input.access === undefined || input.access === null || input.access === 'read' ? 'read'
      : (input.access === 'write' ? 'write' : null);
    if (!access) throw new HubError('access-invalid');
    const depth = parseDepth(input.depth) + 1;
    if (depth > MAX_DEPTH) throw new HubError('depth-limit');

    const { profiles, roster } = await measuredRoster();
    const entry = resolveAgent(roster, input.agent);
    const profile = profiles.find((item) => String(item.id) === entry.id);
    const adapter = adapterFor(profile?.appId);
    if (!profile || !adapter) throw new HubError('client-unsupported', { reason: unsupportedReason(profile?.appId) });
    if (access === 'write' && entry.access !== 'read-write') throw new HubError('write-not-allowed');
    const { cwd, folderId } = resolveAllowedCwd(input.cwd, store.folders());
    if (homeExists(profile) === false) throw new HubError('home-missing');
    if (entry.blockers.includes('not-signed-in')) throw new HubError('not-signed-in');
    const launcher = findLauncher(adapter.toolId);
    if (!launcher) throw new HubError('client-missing');
    let energy = 'unknown';
    try { energy = await energyCheck(profile); } catch (_error) { energy = 'unknown'; }
    if (energy === 'exhausted') throw new HubError('quota-exhausted');
    // Checked after the last await, so two calls cannot both take the slot.
    if (runner.activeForProfile(profile.id)) throw new HubError('agent-busy');
    if (runner.activeCount() >= store.maxConcurrent()) throw new HubError('run-limit');

    const parentRunId = RUN_ID.test(input.parentRunId || '') && store.getRun(input.parentRunId) ? input.parentRunId : null;
    const parentTarget = parentRunId ? store.getRun(parentRunId).target.profileId : null;
    const homeCaller = parentTarget ? null : resolveCallerProfile(input.callerHomes, profiles, { homeFor: callerHomeFor, ...(realpath ? { realpath } : {}) });
    const caller = parentTarget
      ? { profileId: parentTarget, via: 'parent-run' }
      : (homeCaller ? { profileId: homeCaller, via: 'account-home' } : null);
    const id = store.newRunId();
    const record = runner.start({
      id,
      profile,
      adapter,
      launcher,
      env: { ...environmentFor(profile, depth, id), ...(launcher.extraEnv || {}) },
      cwd,
      folderId,
      access,
      prompt,
      title,
      from: cleanText(input.from, MAX_FROM) || null,
      depth,
      parentRunId,
      caller,
      targetName: entry.name
    });
    return publicRun(record, now());
  }

  function getRun(id) {
    const run = typeof id === 'string' && RUN_ID.test(id) ? store.getRun(id) : null;
    if (!run) throw new HubError('run-not-found');
    return run;
  }

  function status(id) {
    return publicRun(getRun(id), now());
  }

  function list(limit = 20) {
    const count = Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 20;
    const runs = store.runs().reverse().slice(0, count).map((run) => publicRun(run, now()));
    return { running: runner.activeCount(), maxConcurrent: store.maxConcurrent(), runs };
  }

  // The client's final reply: from memory while this desktop instance has it,
  // otherwise read back from the client's own session record.
  function output(id) {
    const run = getRun(id);
    const base = { run: publicRun(run, now()), answer: null, truncated: false, source: null };
    if (ACTIVE_STATES.has(run.state)) return { ...base, reasonCode: 'run-not-finished' };
    const remembered = runner.answer(run.id);
    if (remembered) return { ...base, answer: remembered.text, truncated: remembered.truncated, source: 'client-output' };
    const adapter = adapterFor(run.target.app);
    if (adapter && run.session?.file) {
      try {
        const fromRecord = adapter.lastAnswerFromRecord(run.session.file);
        if (fromRecord) return { ...base, answer: fromRecord.text, truncated: fromRecord.truncated, source: 'session-record' };
      } catch (_error) { /* reported below */ }
    }
    return { ...base, reasonCode: 'output-unavailable' };
  }

  async function stop(id) {
    const run = getRun(id);
    if (!runner.isActive(run.id)) return publicRun(run, now());
    return publicRun(await runner.stop(run.id, 'stopped-by-person'), now());
  }

  async function profilesChanged(profiles) {
    const live = new Set((profiles || []).map((profile) => String(profile.id)));
    for (const run of store.runs()) {
      if (runner.isActive(run.id) && !live.has(run.target.profileId)) await runner.stop(run.id, 'account-removed');
    }
  }

  return {
    agentsList,
    startRun,
    status,
    list,
    output,
    stop,
    stopAll: (reason) => runner.stopAll(reason),
    activeCount: () => runner.activeCount(),
    profilesChanged,
    publicRun: (run) => publicRun(run, now())
  };
}

module.exports = { createAgentHub, publicRun, MAX_PROMPT_BYTES, DROPPED_ENV };
