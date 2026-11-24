'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parse, helpText, success, failure } = require('./cli');
const { COMMANDS, InterfaceError, execute } = require('./service');
const { CALLER_HOME_KEYS } = require('../hub/roster');

const pathParameter = (description, required = false) => ({ type: 'string', description, required });
const ACTIONS = {
  'profiles register': {
    description: 'Register an existing local client home without moving its credentials or sessions.',
    parameters: {
      app: pathParameter('Exact supported client ID from apps.', true),
      'session-root': pathParameter('Absolute existing client home or session root.', true),
      'profile-path': pathParameter('Absolute existing desktop data directory, when needed.'),
      name: pathParameter('Display name for a new registration.')
    },
    effects: 'register-local-profile'
  },
  'profiles import-auth': {
    description: 'Import a local credential file for a supported client into a local account.',
    parameters: {
      app: pathParameter('Exact client ID with credential-file import capability.', true),
      file: pathParameter('Absolute path to the original credential file.', true)
    },
    effects: 'import-local-credentials'
  },
  'profiles launch': {
    description: 'Open an exact local Profile through its registered client launcher.',
    parameters: { profile: COMMANDS['profiles inspect'].parameters.profile },
    effects: 'launch-local-client'
  },
  'profiles create': {
    description: 'Create a new isolated environment for one client and return its Profile ID and folders. It does not sign in or open the client.',
    parameters: {
      app: pathParameter('Exact supported client ID from apps.', true),
      name: pathParameter('Display name for the new account.')
    },
    effects: 'create-local-profile'
  },
  'profiles set-key': {
    description: 'Read an API key or token from standard input and hand it to the Profile\'s own client (its login command or its documented configuration file). The value is never accepted as an argument, stored by AgentDesk or echoed.',
    parameters: {
      profile: COMMANDS['profiles inspect'].parameters.profile,
      method: pathParameter('key (default) or provider: a custom API endpoint for this account.'),
      'provider-id': pathParameter('Provider identifier for --method provider (Codex, Kimi Code).'),
      'base-url': pathParameter('HTTPS endpoint for --method provider.'),
      model: pathParameter('Model ID for --method provider, or the default model for a Kimi Code catalog key.'),
      'catalog-provider': pathParameter('Kimi Code: models.dev catalog provider ID for the key.')
    },
    effects: 'write-client-credentials'
  },
  // 调度中枢: relayed through the running desktop, which supervises each run.
  'agents list': {
    description: 'List the accounts the person has allowed to be called, with name, ID, client, readiness and energy level. Contains no secret.',
    parameters: {},
    effects: 'read-only'
  },
  run: {
    description: 'Have one allowed account run a background conversation. The prompt is read from standard input (never an argument). Returns the run ID at once.',
    parameters: {
      agent: pathParameter('Exact cat name from agents list, or its ID when a name is shared.', true),
      title: pathParameter('Short title shown in the AgentDesk ledger.', true),
      cwd: pathParameter('Absolute working directory inside a folder the person allowed in AgentDesk.', true),
      from: pathParameter('Display label for the caller, for example "Claude personal". Shown only; never an identity.'),
      access: pathParameter('read (default) or write: write also needs the account\'s own "may edit files" switch.')
    },
    effects: 'start-background-run'
  },
  'runs list': {
    description: 'Recent background runs: title, caller label, target account and state.',
    parameters: { limit: { type: 'integer', description: 'Number of runs, newest first.', required: false, minimum: 1, maximum: 200, default: 20 } },
    effects: 'read-only'
  },
  'runs status': {
    description: 'State of one background run: starting, running, completed, failed or stopped, with elapsed time.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'read-only'
  },
  'runs output': {
    description: 'The called account\'s final reply for a finished run, from its own output or its own session record.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'read-only'
  },
  'runs stop': {
    description: 'Stop one background run.',
    parameters: { run: pathParameter('Run ID returned by run.', true) },
    effects: 'stop-background-run'
  }
};
const SECRET_ACTIONS = new Set(['profiles set-key']);
const PROMPT_ACTIONS = new Set(['run']);
const MAX_SECRET_BYTES = 8 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;

const PACKAGED_COMMANDS = {
  ...COMMANDS,
  'profiles discover': {
    description: 'Find existing client homes (default locations, optional bounded home scan or one folder) to register in place. No credentials are read for output or copied.',
    parameters: {
      app: pathParameter('Limit discovery to one client ID.'),
      scan: pathParameter('defaults (default) or home: also walk the home folder up to four levels, with time and size limits.'),
      folder: pathParameter('Absolute folder to search with the same markers.')
    }
  },
  'profiles status': {
    description: 'Report whether a Profile is signed in, and how, using the client\'s success check. Prints no secret.',
    parameters: {
      profile: COMMANDS['profiles inspect'].parameters.profile,
      check: pathParameter('files (default) or official: also run the client\'s own status command when it has one.')
    }
  },
  ...ACTIONS
};
const MAX_REQUEST_BYTES = 20 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function packagedCliArguments(argv, development = false) {
  const args = argv.slice(development ? 2 : 1);
  const launchArgs = args[0]?.startsWith('--user-data-dir=') ? args.slice(1) : args;
  return launchArgs[0] === '--cli' ? launchArgs.slice(1) : null;
}

function extractOutputOption(argv) {
  const index = argv.indexOf('--output');
  if (index < 0) return { argv, outputPath: null };
  const outputPath = argv[index + 1];
  if (argv.lastIndexOf('--output') !== index || !path.isAbsolute(outputPath || '') || /[\x00-\x1f]/.test(outputPath)) {
    throw new InterfaceError('invalid-output', 'Use one absolute, new path for --output.', 2);
  }
  return { argv: argv.slice(0, index).concat(argv.slice(index + 2)), outputPath };
}

function privateRequestRoot(userData) {
  const root = path.join(userData, 'cli-requests');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || stat.mode & 0o077))) {
    throw new Error('cli-request-root-invalid');
  }
  return root;
}

function parsePackaged(argv, userData) {
  return parse(argv, PACKAGED_COMMANDS, { 'user-data': userData });
}

async function packagedRead(parsed, options) {
  const { command, options: input } = parsed;
  if (command === 'paths') return { platform: process.platform, userData: options.userData, confirmed: true };
  if (command === 'profiles discover') {
    const result = await options.discover({ app: input.app, scan: input.scan, folder: input.folder }, { userData: options.userData });
    return Array.isArray(result) ? { locations: result } : result;
  }
  if (command === 'profiles status') {
    if (input.check && !['files', 'official'].includes(input.check)) {
      throw new InterfaceError('invalid-arguments', 'Use --check files or --check official.', 2);
    }
    return options.status({ profile: input.profile, official: input.check === 'official' }, { userData: options.userData });
  }
  if (command === 'apps') {
    const result = execute(command, input);
    return { apps: result.apps.map((app) => ({
      ...app,
      canRegisterExisting: true,
      credentialImportFile: app.signIn?.importFiles?.[0] || null,
      credentialImportFiles: app.signIn?.importFiles || []
    })) };
  }
  const result = execute(command, input);
  if (command !== 'capabilities') return result;
  return {
    ...result,
    packaged: true,
    version: options.version,
    commands: Object.entries(PACKAGED_COMMANDS).map(([name, definition]) => ({
      name, ...definition, effects: definition.effects || 'read-only'
    })),
    output: { ...result.output, fileOption: '--output <new-absolute-path>' },
    boundaries: {
      ...result.boundaries,
      writes: 'explicit local registration, new isolated environments, credential-file import and keys passed on stdin to the account\'s own client',
      launchesClients: 'profiles launch only; set-key and status --check official run the client\'s fixed login or status command without a window',
      readsCredentials: 'only during explicit credential-file import or status checks; values are never printed',
      secrets: 'Keys are read from stdin only, held in memory and passed to the account\'s client; AgentDesk does not store them.',
      notAvailable: ['arbitrary provider configuration', 'remote actions', 'direct Mesh writes', 'generic execution', 'HTTP server', 'MCP server', 'changing who may be called, allowed folders or limits']
    },
    hub: {
      relay: 'run is relayed only when a caller asks; AgentDesk never starts, queues, retries or schedules runs, never picks an account and never passes one run\'s result to another',
      callable: 'only accounts the person switched on in AgentDesk; the switch, allowed folders and the concurrency limit are changed in the desktop only',
      prompt: 'standard input only, at most 64 KiB; it is not stored by AgentDesk',
      access: 'read-only by default; write needs --access write and the account\'s own switch',
      limits: 'one run per account, a global limit set in AgentDesk, and at most two levels of nesting (AGENTDESK_HUB_DEPTH)',
      requiresDesktop: 'agents list, run and runs stop need the AgentDesk desktop to be running; runs list, status and output also read finished records without it',
      stored: 'title, caller label, target, state, times and where the client\'s own session record is; never the prompt or the answer'
    }
  };
}

function createCliBroker({ userData, whenReady, dispatch }) {
  let pending = Promise.resolve();
  // A key piped to `profiles set-key` travels in memory with the single
  // instance message; it never touches the request folder.
  const secrets = new Map();
  // A `run` prompt travels the same way and is dropped once handed to Main.
  const prompts = new Map();
  const contexts = new Map();

  async function handle(requestId) {
    let directory;
    let claimed = false;
    let command = null;
    let response;
    try {
      directory = path.join(privateRequestRoot(userData), requestId);
      if (!fs.lstatSync(directory).isDirectory()) return;
      const queued = path.join(directory, 'request.json');
      const stat = fs.lstatSync(queued);
      if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) return;
      const running = path.join(directory, 'running.json');
      fs.renameSync(queued, running);
      claimed = true;
      const argv = JSON.parse(fs.readFileSync(running, 'utf8'));
      if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) throw new Error('cli-request-invalid');
      const parsed = parsePackaged(argv, userData);
      command = parsed.command;
      if (parsed.help || !Object.hasOwn(ACTIONS, command)) throw new Error('cli-request-invalid');
      await whenReady();
      const secret = SECRET_ACTIONS.has(command) ? secrets.get(requestId) : undefined;
      const prompt = PROMPT_ACTIONS.has(command) ? prompts.get(requestId) : undefined;
      const context = contexts.get(requestId) || {};
      secrets.delete(requestId);
      prompts.delete(requestId);
      contexts.delete(requestId);
      response = success(command, await dispatch(command, parsed.options, { secret, prompt, context }));
    } catch (error) {
      secrets.delete(requestId);
      prompts.delete(requestId);
      contexts.delete(requestId);
      if (!claimed) return;
      response = failure(command, error);
    }
    try {
      const temporary = path.join(directory, 'response.tmp');
      fs.writeFileSync(temporary, JSON.stringify(response), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, path.join(directory, 'response.json'));
    } catch (_error) { /* The caller may have timed out and cleaned the request. */ }
  }

  return {
    accept(data) {
      const id = data?.agentdeskCliRequest;
      if (typeof id !== 'string' || !REQUEST_ID.test(id)) return false;
      const secret = data?.agentdeskCliSecret;
      if (typeof secret === 'string' && secret.length && secret.length <= MAX_SECRET_BYTES) secrets.set(id, secret);
      const prompt = data?.agentdeskCliPrompt;
      if (typeof prompt === 'string' && prompt.length && Buffer.byteLength(prompt) <= MAX_PROMPT_BYTES) prompts.set(id, prompt);
      const context = data?.agentdeskCliContext;
      if (context && typeof context === 'object') {
        const homes = {};
        for (const key of CALLER_HOME_KEYS) {
          const value = context.homes?.[key];
          if (typeof value === 'string' && value.length <= 4096) homes[key] = value;
        }
        contexts.set(id, {
          ...(typeof context.depth === 'string' ? { depth: context.depth.slice(0, 8) } : {}),
          ...(typeof context.parentRunId === 'string' ? { parentRunId: context.parentRunId.slice(0, 64) } : {}),
          ...(Object.keys(homes).length ? { homes } : {})
        });
      }
      pending = pending.then(() => handle(id));
      return true;
    },
    async drain() {
      let queued;
      do { queued = pending; await queued; } while (queued !== pending);
    }
  };
}

async function dispatchPackagedAction(args, options, secret, extra = {}) {
  const { app, userData, broker, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const requestId = crypto.randomUUID();
  const directory = path.join(privateRequestRoot(userData), requestId);
  fs.mkdirSync(directory, { mode: 0o700 });
  try {
    const payload = JSON.stringify(args);
    if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw new InterfaceError('request-too-large', 'The command arguments are too large.', 2);
    const queued = path.join(directory, 'request.json');
    fs.writeFileSync(queued, payload, { flag: 'wx', mode: 0o600 });
    const data = {
      agentdeskCliRequest: requestId,
      ...(secret ? { agentdeskCliSecret: secret } : {}),
      ...(extra.prompt ? { agentdeskCliPrompt: extra.prompt } : {}),
      ...(extra.context ? { agentdeskCliContext: extra.context } : {})
    };
    if (app.requestSingleInstanceLock(data)) {
      app.on('second-instance', (_event, _args, _cwd, additionalData) => broker.accept(additionalData));
      broker.accept(data);
      await broker.drain();
    }

    const responsePath = path.join(directory, 'response.json');
    const deadline = Date.now() + timeoutMs;
    do {
      if (fs.existsSync(responsePath)) {
        const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
        if (!Number.isInteger(response?.code) || typeof response?.text !== 'string') throw new Error('cli-response-invalid');
        return response;
      }
      await delay(50);
    } while (Date.now() < deadline);

    let canceled = false;
    try { fs.unlinkSync(queued); canceled = true; } catch (_error) { /* The desktop may have claimed it. */ }
    const claimed = !canceled && fs.existsSync(path.join(directory, 'running.json'));
    throw new InterfaceError(claimed ? 'operation-outcome-unknown' : 'desktop-unavailable', claimed
      ? 'The desktop accepted the operation but the result timed out. Inspect the profile before retrying.'
      : 'The currently running AgentDesk did not accept the command. Check the desktop version or retry when it is idle.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Read a key from a pipe or redirected file. A terminal is refused so the
// value is never typed visibly or kept in shell history.
async function readSecretFromStdin(stream = process.stdin, timeoutMs = 30_000) {
  return readStdinText(stream, {
    timeoutMs,
    maxBytes: MAX_SECRET_BYTES,
    required: () => new InterfaceError('secret-stdin-required', 'Pipe the key or token on standard input; it is never accepted as an argument.', 2),
    tooLarge: () => new InterfaceError('secret-invalid', 'The value on standard input is too large.', 2),
    timeout: () => new InterfaceError('secret-stdin-timeout', 'Standard input did not close in time.', 2)
  });
}

// A background run's prompt: piped or redirected, never typed into a terminal
// and never an argument. Long material belongs in a file in the working folder.
async function readPromptFromStdin(stream = process.stdin, timeoutMs = 30_000) {
  const text = await readStdinText(stream, {
    timeoutMs,
    maxBytes: MAX_PROMPT_BYTES,
    keepTrailingNewline: true,
    required: () => new InterfaceError('prompt-stdin-required', 'Pipe the prompt on standard input; it is never accepted as an argument.', 2),
    tooLarge: () => new InterfaceError('prompt-too-large', 'The prompt is larger than 64 KiB. Put long material in a file inside the working folder and refer to it.', 2),
    timeout: () => new InterfaceError('prompt-stdin-timeout', 'Standard input did not close in time.', 2)
  });
  if (!text.trim()) throw new InterfaceError('prompt-required', 'The prompt on standard input is empty.', 2);
  return text;
}

async function readStdinText(stream, limits) {
  const { timeoutMs, maxBytes } = limits;
  if (!stream || stream.isTTY) throw limits.required();
  const chunks = [];
  let size = 0;
  const bytes = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(limits.timeout()), timeoutMs);
    function done(error) {
      clearTimeout(timer);
      stream.removeAllListeners?.('data');
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    }
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { done(limits.tooLarge()); return; }
      chunks.push(Buffer.from(chunk));
    });
    stream.once('end', () => done());
    stream.once('error', () => done(limits.required()));
    stream.resume?.();
  });
  const decoded = bytes.toString('utf8');
  const text = limits.keepTrailingNewline ? decoded : decoded.replace(/\r?\n$/, '');
  bytes.fill(0);
  for (const chunk of chunks) chunk.fill(0);
  return text;
}

async function runPackagedCli(argv, options) {
  let output;
  let command = null;
  let response;
  try {
    const invocation = extractOutputOption(argv);
    if (invocation.outputPath) {
      try { output = fs.openSync(invocation.outputPath, 'wx', 0o600); } catch (_error) {
        throw new InterfaceError('output-unavailable', 'The output path must name a new writable file.', 2);
      }
    }
    if (output === undefined && !options.stdout && process.platform === 'win32') {
      try { fs.fstatSync(1); } catch (_error) { return 2; }
    }
    const parsed = parsePackaged(invocation.argv, options.userData);
    command = parsed.command;
    if (parsed.help) response = { code: 0, text: helpText(PACKAGED_COMMANDS, true) };
    else if (Object.hasOwn(ACTIONS, command)) {
      const secret = SECRET_ACTIONS.has(command) ? await (options.readSecret || readSecretFromStdin)() : null;
      const extra = {};
      if (PROMPT_ACTIONS.has(command)) {
        extra.prompt = await (options.readPrompt || readPromptFromStdin)();
        // Nesting depth from the caller's own environment (AgentDesk sets it
        // for every run it starts); a person's own Agent has none.
        const env = options.env || process.env;
        // The caller's own account folder, when it runs inside one: only
        // compared with registered accounts in Main, never opened or stored.
        const homes = {};
        for (const key of CALLER_HOME_KEYS) {
          const value = env[key];
          if (typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !/[\x00-\x1f]/.test(value)) homes[key] = value;
        }
        extra.context = {
          ...(typeof env.AGENTDESK_HUB_DEPTH === 'string' ? { depth: env.AGENTDESK_HUB_DEPTH.slice(0, 8) } : {}),
          ...(typeof env.AGENTDESK_HUB_RUN === 'string' ? { parentRunId: env.AGENTDESK_HUB_RUN.slice(0, 64) } : {}),
          ...(Object.keys(homes).length ? { homes } : {})
        };
      }
      response = await dispatchPackagedAction(invocation.argv, options, secret, extra);
    }
    else response = success(command, await packagedRead(parsed, options));
  } catch (error) {
    response = failure(command, error);
  }
  try {
    if (output === undefined && options.stdout) options.stdout.write(response.text);
    else fs.writeFileSync(output ?? 1, response.text);
    return response.code;
  } catch (_error) {
    return 1;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}

module.exports = { packagedCliArguments, createCliBroker, runPackagedCli, readSecretFromStdin, readPromptFromStdin, PACKAGED_COMMANDS, MAX_PROMPT_BYTES };
