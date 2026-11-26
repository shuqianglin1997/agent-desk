'use strict';

// AgentDesk — the command line's commands that run in the CLI process: the
// source CLI (src/automation/cli.js) and the packaged `AgentDesk --cli`. They
// never load Main. `deps` are the CLI's local readers (src/automation/
// service.js) or, for the packaged-only ones, the packaged CLI's helpers.
//   runs: 'cli'       both CLIs, read-only
//         'packaged'  the packaged CLI only
// The commands relayed to the running desktop are in ./cli-desktop.js. The
// order here is the order `capabilities` lists them in.

// The data folder keeps the old name (docs/RENAME_PLAN.md).
const { LEGACY_NAME } = require('../core/product');

const parameter = (description, required = false, extra = {}) => ({ type: 'string', description, required, ...extra });
const userData = parameter('Absolute Catshelf userData directory (its folder is still named AgentDesk); never inferred from the shell client home.', true);
const profileId = parameter('Exact local Profile ID returned by profiles list.', true);
const pathParameter = (description, required = false) => ({ type: 'string', description, required });

// sessions locate / sessions read: one lookup by address; two matches are ambiguous.
function locate({ readProfiles, getProfile, scanProfile, findSession, InterfaceError }, options) {
  const profile = getProfile(readProfiles(options['user-data']), options.profile);
  const sessions = scanProfile(profile);
  const session = findSession(sessions, options.session, { key: 'address', unique: true });
  if (!session) throw new InterfaceError('session-not-found', 'No session matches that ID in the selected Profile scan.', 3);
  if (session.ambiguous) throw new InterfaceError('session-ambiguous', 'The adapter returned multiple records for that ID. No source was guessed.', 4);
  return { profile, session };
}

// A window-only action (docs/ORDERLY_UPDATE_PLAN.md §5): the command line
// answers window-only at once and never reaches the desktop. `windowOnly`
// names the window's command (src/commands/client-updates.js).
function windowOnly(name, command, description, extraParameters = {}) {
  return {
    name,
    runs: 'packaged',
    windowOnly: command,
    description,
    parameters: { app: pathParameter('Desktop client ID from apps (accepted; the answer is always window-only).'), ...extraParameters },
    effects: 'window-only',
    exec({ InterfaceError }) {
      throw new InterfaceError('window-only', 'Only the person does this, in the Catshelf window (System > Tools).', 5);
    }
  };
}

const CLI_LOCAL = [
  {
    name: 'capabilities',
    runs: 'cli',
    description: 'Discover this interface, its parameters, boundaries and extension guide.',
    parameters: {},
    exec: ({ capabilities }) => capabilities()
  },
  {
    name: 'paths',
    runs: 'cli',
    description: 'Suggest the standard desktop data directory without reading it.',
    parameters: {},
    exec: ({ apps }) => ({ platform: process.platform, suggestedUserData: apps.appSupportDir(LEGACY_NAME), confirmed: false, note: 'Pass --user-data explicitly. Portable/test/custom installations may use another directory; CODEX_HOME is not Catshelf userData. The folder keeps the name AgentDesk from before the rename.' })
  },
  {
    name: 'diagnostics',
    runs: 'packaged',
    description: 'For troubleshooting: this copy\'s build (version, commit, repository), the system, where the data folder and the log are, the last log lines, and self-checks (data folder readable and writable, whether a running Catshelf receives commands). No keys, tokens, session contents, titles or account names; paths under the home folder start with ~. Writes only one empty probe file in the data folder and removes it.',
    parameters: {
      lines: parameter('How many of the last log lines to include.', false, { type: 'integer', minimum: 0, maximum: 200, default: 40 })
    },
    effects: 'read-only',
    exec({ diagnostics, InterfaceError }, input) {
      if (typeof diagnostics !== 'function') throw new InterfaceError('diagnostics-unavailable', 'Diagnostics need the packaged app.', 5);
      return diagnostics({ lines: input.lines ?? 40 });
    }
  },
  {
    name: 'apps',
    runs: 'cli',
    description: 'List registered client capabilities, not installed or authenticated state.',
    parameters: {},
    exec: ({ apps, provisioningAdapterDescriptor }) => ({ apps: apps.listApps().map((item) => {
      const descriptor = provisioningAdapterDescriptor(item.id);
      const client = apps.getApp(item.id);
      return {
        ...item,
        canScanSessions: client.sessionScanSupported !== false,
        // What the adapter says it cannot do, as the desktop shows it: quota
        // (a reason key when there is no reader) and hub background runs.
        quota: typeof client.quota?.read === 'function'
          ? { supported: true, reason: null }
          : { supported: false, reason: client.quota?.unsupportedReason || 'quota.reason.unsupported' },
        backgroundRuns: client.hub
          ? { supported: true, reason: null }
          : { supported: false, reason: typeof client.hubUnsupported === 'string' ? client.hubUnsupported : 'not-verified-yet' },
        configurationOwner: 'external-client',
        desktopPreparation: {
          supportedOnThisPlatform: Boolean(descriptor?.supportedPlatforms.includes(process.platform)),
          portableSettingKeys: [...(descriptor?.portableSettingKeys || [])]
        }
      };
    }) })
  },
  {
    name: 'tools',
    runs: 'cli',
    description: 'Discover fixed CLI launchers without executing them or checking updates.',
    parameters: {},
    // Codex resolves its CLI with the app-server resolver shared with quota (its
    // adapter's cliLauncher); discovery still never invokes that server.
    exec: ({ TOOL_IDS, discoverCli }) => ({ tools: TOOL_IDS.map((id) => {
      const launcher = discoverCli(id);
      return { id, found: Boolean(launcher), path: launcher?.path || null, source: launcher?.source || null };
    }), note: 'Discovery does not execute launchers or establish version, integrity, login or API availability.' })
  },
  {
    name: 'profiles list',
    runs: 'cli',
    description: 'Read persisted local Profile metadata, without recovery or migration.',
    parameters: { 'user-data': userData },
    exec({ readProfiles, publicProfile }, options) {
      const store = readProfiles(options['user-data']);
      return { storeState: store.state, scope: 'local-profiles', profiles: store.profiles.map(publicProfile) };
    }
  },
  {
    name: 'profiles inspect',
    runs: 'cli',
    description: 'Inspect one Profile, path availability and external configuration ownership.',
    parameters: { 'user-data': userData, profile: profileId },
    exec: ({ readProfiles, getProfile, inspectProfile }, options) => inspectProfile(getProfile(readProfiles(options['user-data']), options.profile))
  },
  {
    name: 'sessions list',
    runs: 'cli',
    description: 'Scan one local Profile using the existing best-effort adapter; no transcript output.',
    parameters: {
      'user-data': userData, profile: profileId,
      query: parameter('Literal case-insensitive title or project filter.'),
      limit: parameter('Page size.', false, { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
      offset: parameter('Offset in this scan, not a persistent cursor.', false, { type: 'integer', minimum: 0, maximum: 1000000, default: 0 })
    },
    exec({ readProfiles, getProfile, scanProfile, sessionId, scanWarnings }, options) {
      const profile = getProfile(readProfiles(options['user-data']), options.profile);
      const sessions = scanProfile(profile);
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
  },
  {
    name: 'sessions locate',
    runs: 'cli',
    description: 'Return the shared path/coordinate format; do not open files or modify clipboard.',
    parameters: {
      'user-data': userData, profile: profileId, session: parameter('Exact session ID returned by sessions list.', true)
    },
    exec(deps, options) {
      const { profile, session } = locate(deps, options);
      const { locations, sessionId, scanWarnings } = deps;
      return { profileId: profile.id, sessionId: sessionId(session), path: locations.pathOf(session), coordinate: locations.coordinateOf(session), text: locations.format(session), warnings: scanWarnings() };
    }
  },
  {
    name: 'sessions read',
    runs: 'cli',
    description: 'Read an exact local session as Markdown when the client supports transcript export.',
    parameters: {
      'user-data': userData, profile: profileId, session: parameter('Exact session ID returned by sessions list.', true),
      'max-chars': parameter('Maximum Markdown characters.', false, { type: 'integer', minimum: 200, maximum: 262144, default: 32000 })
    },
    exec(deps, options) {
      const { profile, session } = locate(deps, options);
      const { apps, sessionId, InterfaceError } = deps;
      const exporter = apps.getApp(profile.appId).exportTranscript;
      if (typeof exporter !== 'function') throw new InterfaceError('transcript-unsupported', 'This client does not have a transcript parser. Use sessions locate for its local record.', 5);
      let markdown;
      try { markdown = exporter(session).markdown; } catch (_error) {
        throw new InterfaceError('transcript-unavailable', 'The selected session transcript could not be read.', 4);
      }
      const limit = options['max-chars'] ?? 32000;
      return { profileId: profile.id, sessionId: sessionId(session), markdown: markdown.slice(0, limit), truncated: markdown.length > limit };
    }
  },
  {
    name: 'integration plan',
    runs: 'cli',
    description: 'Preflight existing client roots for registration; never writes configuration or applies a plan.',
    parameters: {
      'user-data': userData, app: parameter('Registered client ID from apps.', true),
      'profile-path': parameter('Absolute client data directory.', true),
      'session-root': parameter('Absolute client configuration/session root.', true)
    },
    exec: ({ readProfiles, integrationPlan }, options) => integrationPlan(options, readProfiles(options['user-data']))
  },
  {
    name: 'profiles discover',
    runs: 'packaged',
    description: 'Find existing client homes (default locations, optional bounded home scan or one folder) to register in place. No credentials are read for output or copied.',
    parameters: {
      app: pathParameter('Limit discovery to one client ID.'),
      scan: pathParameter('defaults (default) or home: also walk the home folder up to four levels, with time and size limits.'),
      folder: pathParameter('Absolute folder to search with the same markers.')
    },
    async exec({ discover, userData: directory }, input) {
      const result = await discover({ app: input.app, scan: input.scan, folder: input.folder }, { userData: directory });
      return Array.isArray(result) ? { locations: result } : result;
    }
  },
  {
    name: 'profiles status',
    runs: 'packaged',
    description: 'Report whether a Profile is signed in, and how, using the client\'s success check. Prints no secret.',
    parameters: {
      profile: profileId,
      check: pathParameter('files (default) or official: also run the client\'s own status command when it has one.')
    },
    exec({ status, userData: directory, InterfaceError }, input) {
      if (input.check && !['files', 'official'].includes(input.check)) {
        throw new InterfaceError('invalid-arguments', 'Use --check files or --check official.', 2);
      }
      return status({ profile: input.profile, official: input.check === 'official' }, { userData: directory });
    }
  },
  windowOnly('clients restart-all', 'client.updateRestartAll', 'Window only: closing every account of a desktop client Catshelf opened and reopening them after its update is done by the person in Catshelf (System > Tools). Always answers window-only.', { 'stop-background-runs': pathParameter('Accepted; the answer is always window-only.') }),
  windowOnly('clients reopen', 'client.reopenSet', 'Window only: reopening the accounts that were open before a client update is done by the person in Catshelf (System > Tools). Always answers window-only.')
];

module.exports = { CLI_LOCAL, parameter, pathParameter, profileId };
