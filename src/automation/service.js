'use strict';

// Local, read-only application interface. Do not import main.js: its readers
// can migrate stores, initialize Mesh/Keychain and start the desktop lifecycle.
const fs = require('node:fs');
const path = require('node:path');
const apps = require('../apps');
const locations = require('../session-location');
const { needsShortRuntimeHome } = require('../codex-runtime-home');
const { CLI_DEFINITIONS, discoverCli } = require('../cli-discovery');
const { provisioningAdapterDescriptor } = require('../mesh/main/provisioning-adapters');

class InterfaceError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

const parameter = (description, required = false, extra = {}) => ({ type: 'string', description, required, ...extra });
const userData = parameter('Absolute AgentDesk userData directory; never inferred from the shell client home.', true);
const profileId = parameter('Exact local Profile ID returned by profiles list.', true);
const COMMANDS = {
  capabilities: { description: 'Discover this interface, its parameters, boundaries and extension guide.', parameters: {} },
  paths: { description: 'Suggest the standard desktop data directory without reading it.', parameters: {} },
  apps: { description: 'List registered client capabilities, not installed or authenticated state.', parameters: {} },
  tools: { description: 'Discover fixed CLI launchers without executing them or checking updates.', parameters: {} },
  'profiles list': { description: 'Read persisted local Profile metadata, without recovery or migration.', parameters: { 'user-data': userData } },
  'profiles inspect': { description: 'Inspect one Profile, path availability and external configuration ownership.', parameters: { 'user-data': userData, profile: profileId } },
  'sessions list': { description: 'Scan one local Profile using the existing best-effort adapter; no transcript output.', parameters: {
    'user-data': userData, profile: profileId,
    query: parameter('Literal case-insensitive title or project filter.'),
    limit: parameter('Page size.', false, { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
    offset: parameter('Offset in this scan, not a persistent cursor.', false, { type: 'integer', minimum: 0, maximum: 1000000, default: 0 })
  } },
  'sessions locate': { description: 'Return the shared path/coordinate format; do not open files or modify clipboard.', parameters: {
    'user-data': userData, profile: profileId, session: parameter('Exact session ID returned by sessions list.', true)
  } },
  'integration plan': { description: 'Preflight existing client roots for registration; never writes configuration or applies a plan.', parameters: {
    'user-data': userData, app: parameter('Registered client ID from apps.', true),
    'profile-path': parameter('Absolute client data directory.', true),
    'session-root': parameter('Absolute client configuration/session root.', true)
  } }
};

function capabilities() {
  return {
    interfaceVersion: 1,
    commands: Object.entries(COMMANDS).map(([name, definition]) => ({ name, ...definition, effects: 'read-only' })),
    output: { format: 'json', envelope: ['schemaVersion', 'ok', 'command', 'data or error'], unknownFields: 'ignore additive response fields' },
    exitCodes: { 0: 'success (inspect data warnings)', 1: 'internal error', 2: 'invalid invocation', 3: 'not found', 4: 'unreadable or incompatible local data', 5: 'unsupported capability' },
    boundaries: {
      scope: 'local persisted Profiles, not the global Mesh Agent catalog',
      network: false, writes: false, launchesClients: false, readsCredentials: false,
      sessionContents: 'Adapters may read session records to derive metadata; no transcript is returned.',
      sqlite: 'Cursor and Kimi Work adapters may run the fixed sqlite3 read-only query.',
      notAvailable: ['profile mutations', 'provider configuration writes', 'launch', 'live quota', 'remote actions', 'Mesh writes', 'generic execution', 'HTTP server', 'MCP server']
    },
    guide: 'docs/AI_INTERFACE.md',
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
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing', profiles: [] };
    throw new InterfaceError('profile-store-unreadable', 'Cannot read profiles.json. Use desktop recovery; this interface never restores backups.', 4);
  }
  // Use the exact persisted v2 paths. Do not synthesize IDs, fall back to Claude,
  // discover Windows default paths or silently normalize a legacy store.
  if (!payload || payload.version !== 2 || !Array.isArray(payload.profiles)) {
    throw new InterfaceError('profile-store-version', 'Expected a version 2 Profile store. Migrate using AgentDesk before reading it.', 4);
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
    runtimeHomeMayBeShortAlias: profile.appId === 'codex' && needsShortRuntimeHome(profile.sessionRoot),
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
  return app.scan(profile);
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
  const a = process.platform === 'win32' ? left.toLowerCase() : left;
  const b = process.platform === 'win32' ? right.toLowerCase() : right;
  const within = (child, parent) => {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return within(a, b) || within(b, a);
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
      'In AgentDesk use Manage Agent → Import runtime location; choose the exact client and roots through its path picker, then explicitly assign the intended Agent.',
      'Read back the resulting Profile using profiles inspect. Only open or make a billable API test when the user requests it.'
    ]
  };
}

function execute(command, options = {}) {
  if (!Object.hasOwn(COMMANDS, command)) throw new InterfaceError('unknown-command', 'Unknown command. Use capabilities.', 2);
  if (command === 'capabilities') return capabilities();
  if (command === 'paths') return { platform: process.platform, suggestedUserData: apps.appSupportDir('AgentDesk'), confirmed: false, note: 'Pass --user-data explicitly. Portable/test/custom installations may use another directory; CODEX_HOME is not AgentDesk userData.' };
  if (command === 'apps') return { apps: apps.listApps().map((item) => {
    const descriptor = provisioningAdapterDescriptor(item.id);
    return {
      ...item,
      canScanSessions: apps.getApp(item.id).sessionScanSupported !== false,
      configurationOwner: 'external-client',
      desktopPreparation: {
        supportedOnThisPlatform: Boolean(descriptor?.supportedPlatforms.includes(process.platform)),
        portableSettingKeys: [...(descriptor?.portableSettingKeys || [])]
      }
    };
  }) };
  // Codex uses the app-server resolver shared with quota instead of a generic
  // CLI_DEFINITIONS entry; discovery still never invokes that server.
  if (command === 'tools') return { tools: ['codex', ...Object.keys(CLI_DEFINITIONS)].map((id) => {
    const launcher = discoverCli(id);
    return { id, found: Boolean(launcher), path: launcher?.path || null, source: launcher?.source || null };
  }), note: 'Discovery does not execute launchers or establish version, integrity, login or API availability.' };
  const store = readProfiles(options['user-data']);
  if (command === 'profiles list') return { storeState: store.state, scope: 'local-profiles', profiles: store.profiles.map(publicProfile) };
  if (command === 'integration plan') return integrationPlan(options, store);
  const profile = getProfile(store, options.profile);
  if (command === 'profiles inspect') return inspectProfile(profile);
  const sessions = scanProfile(profile);
  if (command === 'sessions locate') {
    const matches = sessions.filter((session) => sessionId(session) === options.session);
    if (!matches.length) throw new InterfaceError('session-not-found', 'No session matches that ID in the selected Profile scan.', 3);
    if (matches.length !== 1) throw new InterfaceError('session-ambiguous', 'The adapter returned multiple records for that ID. No source was guessed.', 4);
    const session = matches[0];
    return { profileId: profile.id, sessionId: sessionId(session), path: locations.pathOf(session), coordinate: locations.coordinateOf(session), text: locations.format(session), warnings: scanWarnings() };
  }
  const query = (options.query || '').toLowerCase();
  const filtered = sessions.filter((session) => !query || [session.title, session.projectPath].some((value) => String(value || '').toLowerCase().includes(query)));
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  return {
    profileId: profile.id, scannedAt: new Date().toISOString(), totalInScan: filtered.length, offset, limit,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    sessions: filtered.slice(offset, offset + limit).map((session) => ({
      id: sessionId(session), title: session.title || null, createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null, status: session.status || null
    })), warnings: scanWarnings()
  };
}

module.exports = { COMMANDS, InterfaceError, execute };
