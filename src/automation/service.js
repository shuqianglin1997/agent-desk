'use strict';

// Local, read-only application interface. Do not import main.js: its readers
// can migrate stores, initialize Mesh/Keychain and start the desktop lifecycle.
const fs = require('node:fs');
const path = require('node:path');
const paths = require('../core/paths');
const { readProfileFile } = require('../core/profile-file');
const { buildInfo } = require('../core/product');
const apps = require('../apps');
const locations = require('../session-location');
const { TOOL_IDS, discoverCli } = require('../cli-discovery');
const { provisioningAdapterDescriptor } = require('../mesh/main/provisioning-adapters');
const { findSession } = require('../session-index');
const { cliTable, cliCommand, cliDescriptor } = require('../commands/registry');

class InterfaceError extends Error {
  // `extra` carries explicit, non-sensitive fields such as the candidates of
  // an ambiguous name; it is never an exception's own text.
  constructor(code, message, exitCode = 1, extra = null) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.extra = extra && typeof extra === 'object' ? extra : null;
  }
}

// The CLI's commands are entries of the command table (src/commands/cli-local.js);
// this file is their local shell: the readers they use, and execute().
const COMMANDS = Object.fromEntries(cliTable().filter((entry) => entry.runs === 'cli').map((entry) => [entry.name, cliDescriptor(entry)]));

function capabilities() {
  return {
    interfaceVersion: 1,
    commands: Object.entries(COMMANDS).map(([name, definition]) => ({ name, ...definition, effects: 'read-only' })),
    output: { format: 'json', envelope: ['schemaVersion', 'ok', 'command', 'data or error'], unknownFields: 'ignore additive response fields' },
    exitCodes: { 0: 'success (inspect data warnings)', 1: 'internal error', 2: 'invalid invocation', 3: 'not found', 4: 'unreadable or incompatible local data', 5: 'unsupported capability' },
    boundaries: {
      scope: 'local persisted Profiles, not the global Mesh Agent catalog',
      network: false, writes: false, launchesClients: false, readsCredentials: false,
      sessionContents: 'Session lists contain metadata. Only explicit sessions read returns a local transcript.',
      sqlite: 'Cursor, Kimi Work and Antigravity adapters may run the fixed sqlite3 read-only query.',
      notAvailable: ['profile mutations', 'provider configuration writes', 'launch', 'live quota', 'remote actions', 'Mesh writes', 'generic execution', 'HTTP server', 'MCP server']
    },
    guide: 'docs/AI_INTERFACE.md',
    // Which source this copy was built from; docs/FIX_AND_REBUILD.md uses it.
    build: buildInfo(),
    extensionPoints: [
      { purpose: 'Client paths, isolation and scan adapters', source: 'src/apps.js' },
      { purpose: 'Known CLI discovery (not arbitrary commands)', source: 'src/cli-discovery.js' },
      { purpose: 'Explicit supported tool maintenance', source: 'src/tool-maintenance.js' },
      { purpose: 'Headless read operations and contract', source: 'src/automation/service.js' },
      { purpose: 'Desktop Profile writes and consent', source: 'src/main.js' }
    ]
  };
}

function absoluteDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) {
    throw new InterfaceError('invalid-path', 'Use an explicit absolute directory, without control characters.', 2);
  }
  return path.normalize(value);
}

function directoryState(value) {
  try {
    if (!fs.statSync(value).isDirectory()) return 'not-directory';
    fs.accessSync(value, fs.constants.R_OK);
    return 'directory';
  }
  catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unreadable'; }
}

function readProfiles(directory) {
  const file = path.join(absoluteDirectory(directory), 'profiles.json');
  const read = readProfileFile(file);
  if (!read.ok && read.code === 'missing') return { state: 'missing', profiles: [] };
  if (!read.ok && read.code !== 'invalid-shape') {
    throw new InterfaceError('profile-store-unreadable', 'Cannot read profiles.json. Use desktop recovery; this interface never restores backups.', 4);
  }
  // Use the exact persisted v2 paths. Do not synthesize IDs, fall back to Claude,
  // discover Windows default paths or silently normalize a legacy store.
  const payload = read.ok ? read.value.parsed : null;
  if (!payload || payload.version !== 2 || !Array.isArray(payload.profiles)) {
    throw new InterfaceError('profile-store-version', 'Expected a version 2 Profile store. Migrate using Catshelf before reading it.', 4);
  }
  const ids = new Set();
  for (const profile of payload.profiles) {
    if (!profile || typeof profile.id !== 'string' || !profile.id || ids.has(profile.id)
      || !apps.isKnownApp(profile.appId)
      || !['profilePath', 'sessionRoot'].every((key) => typeof profile[key] === 'string' && path.isAbsolute(profile[key]) && !/[\x00-\x1f]/.test(profile[key]))) {
      throw new InterfaceError('profile-store-invalid', 'Profile IDs, client IDs or stored paths are invalid. No data was repaired or skipped.', 4);
    }
    ids.add(profile.id);
  }
  return { state: 'present', profiles: payload.profiles };
}

function publicProfile(profile) {
  // A future/unknown field or user note may contain credentials. Never spread a
  // stored object into the machine-readable response.
  return { id: profile.id, appId: profile.appId, name: typeof profile.name === 'string' ? profile.name : null };
}

function getProfile(store, id) {
  const profile = store.profiles.find((item) => item.id === id);
  if (!profile) throw new InterfaceError('profile-not-found', 'No Profile matches that ID in this userData directory.', 3);
  return profile;
}

function configurationBoundary(profile) {
  const app = apps.getApp(profile.appId);
  return {
    owner: 'official-client-or-external-configurator',
    providerConfigurationManagedByAgentDesk: false,
    // Pass an empty environment: never print process.env, secrets or auth files.
    rootEnvironment: app.launchEnv ? app.launchEnv(profile, {}) : {},
    clearsInheritedEnvironmentKeys: [...(app.cliClearEnvKeys || [])],
    runtimeHomeMayBeShortAlias: app.runtimeHome?.mayAlias(profile) === true,
    note: 'Configure the canonical root using client-supported tooling. A root/launcher does not prove login, API connectivity, isolation of all credentials, or subscription quota.'
  };
}

function inspectProfile(profile) {
  return {
    ...publicProfile(profile),
    profilePath: profile.profilePath, sessionRoot: profile.sessionRoot,
    pathState: { profile: directoryState(profile.profilePath), session: directoryState(profile.sessionRoot) },
    pathSemantics: 'persisted snapshot; desktop may re-resolve auto paths on launch',
    launchPolicy: apps.profileLaunchPlan(profile),
    configuration: configurationBoundary(profile)
  };
}

function scanProfile(profile) {
  const app = apps.getApp(profile.appId);
  if (app.sessionScanSupported === false) throw new InterfaceError('sessions-unsupported', 'This client has no session scanner.', 5);
  if (directoryState(profile.sessionRoot) !== 'directory') {
    throw new InterfaceError('session-root-unavailable', 'The selected session root is missing, unreadable or not a directory.', 4);
  }
  try {
    return app.scan(profile);
  } catch (error) {
    if (['session-store-unreadable', 'sqlite-unavailable', 'sqlite-query-failed'].includes(error?.code)) {
      throw new InterfaceError('session-store-unreadable', 'The client\'s session store exists but could not be read. No sessions were guessed.', 4);
    }
    throw error;
  }
}

function sessionId(session) { return String(session.address || session.id || ''); }

function scanWarnings() {
  return ['Adapters are bounded and best-effort: an empty result does not prove an empty or healthy client database. Results are local Profile records, not a Mesh-wide snapshot.'];
}

function canonicalPath(value) {
  // Resolve existing ancestors too: planned/new children of a symlink still
  // overlap the corresponding real root. No directories are created.
  let current = path.resolve(value);
  const tail = [];
  while (true) {
    try { return path.join(fs.realpathSync(current), ...tail); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new InterfaceError('path-unreadable', 'Cannot resolve a proposed directory.', 4);
      const parent = path.dirname(current);
      if (parent === current) throw new InterfaceError('path-unreadable', 'Cannot resolve a proposed directory.', 4);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

function overlaps(left, right) {
  const options = { resolve: false };
  return paths.isInside(left, right, options) || paths.isInside(right, left, options);
}

function integrationPlan(options, store) {
  if (!apps.isKnownApp(options.app)) throw new InterfaceError('client-unsupported', 'Choose a registered client ID from apps.', 5);
  const candidate = {
    appId: options.app, profilePath: absoluteDirectory(options['profile-path']), sessionRoot: absoluteDirectory(options['session-root']),
    isProtected: false, profilePathMode: 'custom', sessionRootMode: 'custom'
  };
  const proposed = [candidate.profilePath, candidate.sessionRoot].map(canonicalPath);
  const collisions = store.profiles.filter((existing) => [existing.profilePath, existing.sessionRoot]
    .map(canonicalPath).some((existingPath) => proposed.some((target) => overlaps(target, existingPath))))
    .map(publicProfile);
  const inspected = inspectProfile(candidate);
  const warnings = [];
  if (collisions.length) warnings.push('Roots overlap existing registrations. Reuse the intended Profile; do not treat this as a new isolated company account.');
  if (Object.values(inspected.pathState).some((state) => state !== 'directory')) warnings.push('Both roots must be existing readable client directories before import; this command creates nothing.');
  if (!inspected.launchPolicy.ok) warnings.push('This client does not support the proposed isolated launch. Do not register it as isolated.');
  const app = apps.getApp(candidate.appId);
  // Official roots may not be registered in AgentDesk at all.
  const officialProfile = apps.appSupportDir(app.profileDirName || app.appName);
  const officialRoots = process.platform === 'win32' ? [] : [officialProfile, app.defaultSessionRoot(officialProfile, true)];
  const usesOfficialRoot = officialRoots.map(canonicalPath).some((root) => proposed.some((target) => overlaps(root, target)));
  if (usesOfficialRoot) warnings.push('A proposed root overlaps an official default root; it is not an isolated company environment.');
  if (process.platform === 'win32') warnings.push('Windows Store/MSIX default roots are not probed by this read-only plan. Check the desktop path diagnostics before importing.');
  return {
    applied: false, operation: 'external-environment-registration-preflight',
    candidate: { appId: candidate.appId, profilePath: candidate.profilePath, sessionRoot: candidate.sessionRoot },
    pathState: inspected.pathState, launchPolicy: inspected.launchPolicy, configuration: inspected.configuration,
    collisions, usesOfficialRoot, warnings,
    nextSteps: [
      'Resolve root warnings and confirm which exact environment the user wants; never derive account identity from its name or API host.',
      'Use the official client or external configurator to set provider, endpoint, model and authentication in that root; do not put secrets in this plan, argv, repository or logs.',
      'In Catshelf use Manage Agent → Import runtime location; choose the exact client and roots through its path picker, then explicitly assign the intended Agent.',
      'Read back the resulting Profile using profiles inspect. Only open or make a billable API test when the user requests it.'
    ]
  };
}

// What the local commands use.
const LOCAL_DEPS = Object.freeze({
  capabilities, apps, provisioningAdapterDescriptor, TOOL_IDS, discoverCli, readProfiles, publicProfile, getProfile,
  inspectProfile, scanProfile, sessionId, scanWarnings, findSession, InterfaceError, locations, integrationPlan
});

function execute(command, options = {}) {
  const entry = cliCommand(command, 'cli');
  if (!entry) throw new InterfaceError('unknown-command', 'Unknown command. Use capabilities.', 2);
  return entry.exec(LOCAL_DEPS, options);
}

module.exports = { COMMANDS, InterfaceError, execute, readProfiles, getProfile };
