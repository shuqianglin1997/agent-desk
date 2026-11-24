'use strict';

// AgentDesk — Main's side of the hub (调度中枢) and of the packaged command line:
// the run ledger, who may be called and their names, energy, finding the
// session a run wrote (on the scan worker) and linking it later, the hub's
// command-line commands and the relay of desktop actions. AgentDesk never
// starts, queues or picks a run by itself. Moved out of src/main.js unchanged;
// Main's services come through `main` (mainContext).

const IdentityGroups = require('../identity-groups');
const accountCredentials = require('../account-credentials');
const apps = require('../apps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HubError, normalizeAccess } = require('../hub/roster');
const { HubRunner } = require('../hub/runner');
const { HubStore } = require('../hub/store');
const { InterfaceError } = require('../automation/service');
const { adapterFor, unsupportedReason } = require('../hub/adapters');
const { cliCommand } = require('../commands/registry');
const { createAgentHub } = require('./agent-hub');
const { deriveEnergy } = require('../yard/energy');
const { discoverCli } = require('../cli-discovery');
const { findSession } = require('../session-index');
const { identityFingerprint } = require('../identity');
const { loadProfiles, updateStoredProfile } = require('./stores');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

// ── 调度中枢 ────────────────────────────────────────
const HUB_DESKTOP_COMMANDS = new Set(['agents list', 'run', 'runs stop']);

// Fixed, non-sensitive messages; exit 2 invalid call, 3 not found, 5 unsupported, 1 try later.
const HUB_ERRORS = {
  'agent-required': [2, 'Name the account with --agent.'],
  'title-required': [2, 'Give the run a short --title.'],
  'prompt-required': [2, 'The prompt on standard input is empty.'],
  'prompt-too-large': [2, 'The prompt is larger than 64 KiB. Put long material in a file inside the working folder and refer to it.'],
  'access-invalid': [2, 'Use --access read or --access write.'],
  'depth-limit': [2, 'Calls nest at most two levels. This Agent was itself called by another.'],
  'agent-ambiguous': [2, 'More than one allowed account has that name. Use one of the IDs.'],
  'write-not-allowed': [2, 'This account is not allowed to edit files. Ask the person to switch it on in AgentDesk, or use --access read.'],
  'cwd-invalid': [2, 'Use an absolute working directory without control characters.'],
  'cwd-not-allowed': [2, 'The working directory is not inside a folder allowed in AgentDesk. Ask the person to allow it on the System page.'],
  'cwd-missing': [3, 'The working directory does not exist.'],
  'agent-not-found': [3, 'No allowed account has that name or ID. Use agents list; the person switches accounts on in AgentDesk.'],
  'run-not-found': [3, 'No run has that ID.'],
  'client-unsupported': [5, 'This client cannot run in the background. Desktop-only clients need the same account\'s command-line client.'],
  'home-missing': [4, 'The account\'s folder is missing. Check the account in AgentDesk.'],
  'not-signed-in': [1, 'The account is not signed in. The person signs it in from AgentDesk.'],
  'client-missing': [1, 'The account\'s command-line client is not installed or was not found.'],
  'quota-exhausted': [1, 'The account is almost out of quota, so it does not take new runs.'],
  'agent-busy': [1, 'This account is already running a background conversation. One run per account.'],
  'run-limit': [1, 'The limit of background runs set in AgentDesk is reached. Nothing was queued; try again later.'],
  'desktop-not-running': [1, 'Open AgentDesk first. Background runs are supervised by the running desktop.']
};

function hubInterfaceError(error) {
  if (!(error instanceof HubError)) return error;
  const [exitCode, message] = HUB_ERRORS[error.code] || [1, 'The background run could not be started.'];
  const extra = error.code === 'agent-ambiguous' && Array.isArray(error.details)
    ? { candidates: error.details }
    : (error.code === 'client-unsupported' && error.details?.reason ? { reason: error.details.reason } : null);
  return new InterfaceError(error.code, message, exitCode, extra);
}

function hubStoreFile() {
  return path.join(main.app.getPath('userData'), 'agent-hub.json');
}

function hubCatNames(profiles) {
  let names = new Map();
  try { names = main.getMeshService().localAgentNames(); } catch (_error) { names = new Map(); }
  const groups = IdentityGroups.groupProfilesByIdentity(profiles.map((profile) => ({
    ...profile, identityFingerprint: identityFingerprint(profile)
  })));
  for (const group of groups) {
    for (const member of group.members) {
      if (!names.has(String(member.id))) names.set(String(member.id), group.primary.name);
    }
  }
  return names;
}

function hubEnergy(snapshot) {
  try { return deriveEnergy(snapshot); } catch (_error) { return 'unknown'; }
}

// The session a background run just wrote: a scan that starts now, on the
// scan worker, through the index's one lookup. The runner waits for it at most
// two seconds before recording the run as ended without the link.
async function hubLocateSession(profile, sessionId) {
  const app_ = apps.getApp(profile.appId);
  if (app_.sessionScanSupported === false) return null;
  const match = await main.sessionIndex.find(profile, sessionId, { key: 'address', maxAgeMs: 0 });
  return match?.filePath || null;
}

// Runs that ended before their session turned up are linked when the session
// index next keeps a scan that has it. At most 64, forgotten after 30 minutes.
const HUB_PENDING_LINK_MS = 30 * 60_000;

const hubPendingLinks = new Map();

let hubRunner = null;

function rememberHubLink({ runId, profileId, sessionId }) {
  hubPendingLinks.delete(runId);
  if (hubPendingLinks.size >= 64) hubPendingLinks.delete(hubPendingLinks.keys().next().value);
  hubPendingLinks.set(runId, { profileId, sessionId, until: Date.now() + HUB_PENDING_LINK_MS });
}

function linkHubSessions(profile, rows) {
  if (!hubPendingLinks.size || !hubRunner) return;
  const now = Date.now();
  for (const [runId, pending] of hubPendingLinks) {
    if (pending.until < now) { hubPendingLinks.delete(runId); continue; }
    if (pending.profileId !== String(profile.id)) continue;
    const match = findSession(rows, pending.sessionId, { key: 'address' });
    if (!match?.filePath) continue;
    hubRunner.linkSession(runId, pending.sessionId, match.filePath);
    hubPendingLinks.delete(runId);
  }
}

// Run state is pushed at each transition (starting, running, session found,
// ended); the Renderer never polls for it.
function notifyHubChanged(record = null) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  const run = record && main.agentHub ? main.agentHub.publicRun(record) : null;
  main.mainWindow.webContents.send('hub:changed', run ? { run: { ...run, cwd: undefined } } : {});
}

function getAgentHub() {
  if (main.agentHub) return main.agentHub;
  const store = new HubStore({ file: hubStoreFile() });
  const runner = new HubRunner({ store, locateSession: hubLocateSession, onSessionUnlinked: rememberHubLink, onChange: notifyHubChanged });
  hubRunner = runner;
  main.agentHub = createAgentHub({
    store,
    runner,
    loadProfiles,
    catNames: hubCatNames,
    findLauncher: (toolId) => { try { return discoverCli(toolId); } catch (_error) { return null; } },
    homeExists: (profile) => {
      try { return fs.statSync(profile.sessionRoot).isDirectory(); } catch (_error) { return false; }
    },
    // Files-only check; "no" only when it is certain (a keychain-held or
    // unconfirmed sign-in stays unknown and does not block a run).
    signInState: async (profile) => {
      const status = await accountCredentials.credentialStatus(profile, main.credentialContext());
      return status.signedIn === false && status.note ? null : status.signedIn;
    },
    energyPeek: (profile) => hubEnergy(main.quotaService.peek(profile)),
    energyCheck: async (profile) => hubEnergy(await main.quotaService.get(profile)),
    baseEnv: () => process.env,
    launchEnv: (profile, env) => apps.getApp(profile.appId).launchEnv(profile, env),
    // Which folder each account's client would carry in that variable.
    callerHomeFor: (profile, key) => {
      const discovery = apps.getApp(profile.appId).discovery;
      if (!profile.sessionRoot || discovery?.envVar !== key) return null;
      return discovery.envSubdir && path.basename(profile.sessionRoot) === discovery.envSubdir
        ? path.dirname(profile.sessionRoot)
        : profile.sessionRoot;
    }
  });
  main.agentHub.store = store;
  return main.agentHub;
}

// The hub's command-line commands (src/commands/cli-desktop.js) run through
// here: the ones that need a live desktop refuse in a CLI-only instance, and
// hub errors become the command line's fixed codes.
async function hubCommand(command, action) {
  if (main.cliOnlyInstance && HUB_DESKTOP_COMMANDS.has(command)) throw hubInterfaceError(new HubError('desktop-not-running'));
  const hub = getAgentHub();
  try {
    return await action(hub);
  } catch (error) {
    throw hubInterfaceError(error);
  }
}

// Which clients can be called at all, for the dossier and the System page.
// `via` names the command-line client a call actually runs.
function hubClientSupport() {
  return Object.fromEntries(apps.appIds().map((appId) => [appId, adapterFor(appId)
    ? { callable: true, reason: null, via: adapterFor(appId).label }
    : { callable: false, reason: unsupportedReason(appId), via: null }]));
}

// Every local account with the name a caller uses for it (the same names the
// CLI roster shows) and its two switches. No paths, no sign-in details.
function hubAccounts() {
  const profiles = loadProfiles();
  const names = hubCatNames(profiles);
  return profiles.map((profile) => {
    const access = normalizeAccess(profile.hub);
    return {
      id: String(profile.id),
      name: String(names.get(String(profile.id)) || profile.name || profile.id).slice(0, 120),
      callable: access.callable,
      writable: access.writable
    };
  });
}

function hubPublicState() {
  const hub = getAgentHub();
  const home = os.homedir();
  return {
    accounts: hubAccounts(),
    folders: hub.store.folders().map((folder) => ({
      id: folder.id,
      name: path.basename(folder.path) || folder.path,
      displayPath: folder.path.startsWith(`${home}${path.sep}`) ? `~${folder.path.slice(home.length)}` : folder.path
    })),
    maxConcurrent: hub.store.maxConcurrent(),
    running: hub.activeCount(),
    clients: hubClientSupport(),
    runs: hub.list(50).runs.map((run) => ({ ...run, cwd: undefined }))
  };
}

// The two dossier switches. Only the desktop window changes them; the CLI has
// no command for it, so an Agent cannot grant itself or another access.
function setHubAccess(input = {}) {
  const profileId = main.boundedText(input.profileId, 128);
  const profile = loadProfiles().find((item) => item.id === profileId);
  if (!profile) return { ok: false, reasonCode: 'profile-not-found' };
  const callable = input.callable === true;
  if (callable && !adapterFor(profile.appId)) return { ok: false, reasonCode: 'client-unsupported', reason: unsupportedReason(profile.appId) };
  const next = updateStoredProfile(profileId, (current) => ({
    ...current,
    hub: normalizeAccess({ callable, writable: input.writable === true })
  }));
  notifyHubChanged();
  return { ok: true, profileId, hub: normalizeAccess(next?.hub) };
}

// The packaged command line's desktop actions are commands in the table
// (src/commands/cli-desktop.js); the CLI broker relays them here.
async function runCliProfileAction(command, input, extra = {}) {
  const entry = cliCommand(command, 'desktop');
  if (!entry) throw new InterfaceError('unknown-command', 'Unknown profile action. Use capabilities.', 2);
  return entry.exec(main.mainContext(), input, extra);
}

// A new registration from the command line shows up in the window.
function notifyProfileRegistrations(result) {
  if (!result.existing && main.mainWindow && !main.mainWindow.isDestroyed()) {
    main.mainWindow.webContents.send('profiles:registrationsChanged');
  }
}

module.exports = { bind, hubInterfaceError, hubStoreFile, hubCatNames, hubEnergy, hubLocateSession, rememberHubLink, linkHubSessions, notifyHubChanged, getAgentHub, hubCommand, hubClientSupport, hubAccounts, hubPublicState, setHubAccess, runCliProfileAction, notifyProfileRegistrations };
