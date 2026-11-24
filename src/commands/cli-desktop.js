'use strict';

// AgentDesk — the packaged command line's actions that the running desktop
// carries out (runs: 'desktop'): local profile registration, credential
// import, opening a profile, new isolated environments, keys handed to an
// account's own client, and the hub (调度中枢: agents list, run, runs …).
// The packaged CLI relays the request; Main runs it with its own services as
// `deps`. A key or prompt arrives in `extra` (from standard input), never as
// an argument. The order here is the order `capabilities` lists them in.

const { pathParameter, profileId } = require('./cli-local');

// Profile actions tell the window when a new registration appeared.
function registered(deps, result) {
  deps.notifyProfileRegistrations(result);
  return result;
}

const CLI_DESKTOP = [
  {
    name: 'profiles register',
    runs: 'desktop',
    description: 'Register an existing local client home without moving its credentials or sessions.',
    parameters: {
      app: pathParameter('Exact supported client ID from apps.', true),
      'session-root': pathParameter('Absolute existing client home or session root.', true),
      'profile-path': pathParameter('Absolute existing desktop data directory, when needed.'),
      name: pathParameter('Display name for a new registration.')
    },
    effects: 'register-local-profile',
    exec: (deps, input) => registered(deps, deps.registerExistingProfileFromCli(input))
  },
  {
    name: 'profiles import-auth',
    runs: 'desktop',
    description: 'Import a local credential file for a supported client into a local account.',
    parameters: {
      app: pathParameter('Exact client ID with credential-file import capability.', true),
      file: pathParameter('Absolute path to the original credential file.', true)
    },
    effects: 'import-local-credentials',
    async exec(deps, input) {
      const { apps, accountResult, importCredentialFile, InterfaceError } = deps;
      if (!apps.isKnownApp(input.app)) throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
      const imported = await accountResult(() => importCredentialFile(input.app, input.file), 'credential-import-failed');
      if (!imported.ok) {
        const unsupported = ['credential-import-unsupported', 'credential-import-unsupported-platform'].includes(imported.reasonCode);
        throw new InterfaceError(imported.reasonCode, 'Credential-file import failed. Check apps for supported file formats.', unsupported ? 5 : 1);
      }
      return registered(deps, {
        profileId: imported.profileId,
        existing: imported.existing === true,
        inPlace: imported.inPlace === true,
        copied: imported.copied === true,
        warnings: [
          ...(imported.copied ? ['The sign-in now exists in two places. Refresh tokens are often single use, so the original place may sign out.'] : []),
          ...(imported.warnings || [])
        ]
      });
    }
  },
  {
    name: 'profiles launch',
    runs: 'desktop',
    description: 'Open an exact local Profile through its registered client launcher.',
    parameters: { profile: profileId },
    effects: 'launch-local-client',
    async exec({ launchStoredProfile, InterfaceError }, input) {
      const result = await launchStoredProfile(input.profile);
      if (!result.ok) throw new InterfaceError(result.reasonCode || 'profile-launch-failed', 'The client could not be opened. Check the selected profile and launcher.');
      return { profileId: input.profile, opened: true, alreadyRunning: result.alreadyRunning === true };
    }
  },
  {
    name: 'profiles create',
    runs: 'desktop',
    description: 'Create a new isolated environment for one client and return its Profile ID and folders. It does not sign in or open the client.',
    parameters: {
      app: pathParameter('Exact supported client ID from apps.', true),
      name: pathParameter('Display name for the new account.')
    },
    effects: 'create-local-profile',
    exec: (deps, input) => registered(deps, deps.createLocalAccount({ appId: input.app, name: input.name }))
  },
  {
    name: 'profiles set-key',
    runs: 'desktop',
    description: 'Read an API key or token from standard input and hand it to the Profile\'s own client (its login command or its documented configuration file). The value is never accepted as an argument, stored by AgentDesk or echoed.',
    parameters: {
      profile: profileId,
      method: pathParameter('key (default) or provider: a custom API endpoint for this account.'),
      'provider-id': pathParameter('Provider identifier for --method provider (Codex, Kimi Code).'),
      'base-url': pathParameter('HTTPS endpoint for --method provider.'),
      model: pathParameter('Model ID for --method provider, or the default model for a Kimi Code catalog key.'),
      'catalog-provider': pathParameter('Kimi Code: models.dev catalog provider ID for the key.')
    },
    effects: 'write-client-credentials',
    secretOnStdin: true,
    async exec(deps, input, extra = {}) {
      const { accountResult, applyProfileSecret, InterfaceError } = deps;
      if (typeof extra.secret !== 'string' || !extra.secret) {
        throw new InterfaceError('secret-stdin-required', 'Pipe the key or token on standard input; it is never accepted as an argument.', 2);
      }
      const applied = await accountResult(() => applyProfileSecret(input.profile, {
        method: input.method === 'provider' ? 'provider' : 'key',
        secret: extra.secret,
        provider: { id: input['provider-id'], baseUrl: input['base-url'], model: input.model },
        catalogProviderId: input['catalog-provider'],
        model: input.model
      }), 'credential-apply-failed');
      if (!applied.ok) {
        const invalid = ['secret-invalid', 'provider-id-invalid', 'provider-url-invalid', 'provider-model-invalid'].includes(applied.reasonCode);
        const unsupported = applied.reasonCode === 'credential-method-unsupported';
        throw new InterfaceError(applied.reasonCode, applied.reasonCode === 'profile-not-found'
          ? 'No Profile matches that ID.' : 'The key or token was not applied. Nothing secret is included in this error.',
        applied.reasonCode === 'profile-not-found' ? 3 : invalid ? 2 : unsupported ? 5 : 1);
      }
      return registered(deps, {
        profileId: applied.profileId,
        method: applied.method,
        via: applied.via,
        storedInPlaintext: applied.plaintextWarning === true,
        status: applied.status,
        existing: true
      });
    }
  },
  // 调度中枢: relayed through the running desktop, which supervises each run.
  {
    name: 'agents list',
    runs: 'desktop',
    description: 'List the accounts the person has allowed to be called, with name, ID, client, readiness and energy level. Contains no secret.',
    parameters: {},
    effects: 'read-only',
    exec: ({ hubCommand }) => hubCommand('agents list', (hub) => hub.agentsList())
  },
  {
    name: 'run',
    runs: 'desktop',
    description: 'Have one allowed account run a background conversation. The prompt is read from standard input (never an argument). Returns the run ID at once.',
    parameters: {
      agent: pathParameter('Exact cat name from agents list, or its ID when a name is shared.', true),
      title: pathParameter('Short title shown in the AgentDesk ledger.', true),
      cwd: pathParameter('Absolute working directory inside a folder the person allowed in AgentDesk.', true),
      from: pathParameter('Display label for the caller, for example "Claude personal". Shown only; never an identity.'),
      access: pathParameter('read (default) or write: write also needs the account\'s own "may edit files" switch.')
    },
    effects: 'start-background-run',
    promptOnStdin: true,
    exec: ({ hubCommand }, input, extra = {}) => hubCommand('run', (hub) => hub.startRun({
      agent: input.agent,
      title: input.title,
      cwd: input.cwd,
      from: input.from,
      access: input.access,
      prompt: extra.prompt,
      depth: extra.context?.depth,
      parentRunId: extra.context?.parentRunId,
      callerHomes: extra.context?.homes
    }))
  },
  {
    name: 'runs list',
    runs: 'desktop',
    description: 'Recent background runs: title, caller label, target account and state.',
    parameters: { limit: { type: 'integer', description: 'Number of runs, newest first.', required: false, minimum: 1, maximum: 200, default: 20 } },
    effects: 'read-only',
    exec: ({ hubCommand }, input) => hubCommand('runs list', (hub) => hub.list(input.limit))
  },
  {
    name: 'runs status',
    runs: 'desktop',
    description: 'State of one background run: starting, running, completed, failed or stopped, with elapsed time.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'read-only',
    exec: ({ hubCommand }, input) => hubCommand('runs status', (hub) => hub.status(input.run))
  },
  {
    name: 'runs output',
    runs: 'desktop',
    description: 'The called account\'s final reply for a finished run, from its own output or its own session record.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'read-only',
    exec: ({ hubCommand }, input) => hubCommand('runs output', (hub) => hub.output(input.run))
  },
  {
    name: 'runs stop',
    runs: 'desktop',
    description: 'Stop one background run.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'stop-background-run',
    exec: ({ hubCommand }, input) => hubCommand('runs stop', (hub) => hub.stop(input.run))
  }
];

module.exports = { CLI_DESKTOP };
