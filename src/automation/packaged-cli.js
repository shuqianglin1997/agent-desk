'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parse, helpText, success, failure } = require('./cli');
const { COMMANDS, InterfaceError, execute } = require('./service');

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
  }
};

const PACKAGED_COMMANDS = {
  ...COMMANDS,
  'profiles discover': {
    description: 'Find known local client homes and paths suitable for registering in place.',
    parameters: { app: pathParameter('Limit discovery to one client ID.') }
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

function packagedRead(parsed, options) {
  const { command, options: input } = parsed;
  if (command === 'paths') return { platform: process.platform, userData: options.userData, confirmed: true };
  if (command === 'profiles discover') return { locations: options.discover(input.app) };
  if (command === 'apps') {
    const result = execute(command, input);
    return { apps: result.apps.map((app) => ({ ...app, canRegisterExisting: true, credentialImportFile: app.id === 'codex' ? 'auth.json' : null })) };
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
      writes: 'explicit local registration and credential-file import',
      launchesClients: 'profiles launch only',
      readsCredentials: 'only during explicit credential-file import',
      notAvailable: ['arbitrary provider configuration', 'remote actions', 'direct Mesh writes', 'generic execution', 'HTTP server', 'MCP server']
    }
  };
}

function createCliBroker({ userData, whenReady, dispatch }) {
  let pending = Promise.resolve();

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
      response = success(command, await dispatch(command, parsed.options));
    } catch (error) {
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
      pending = pending.then(() => handle(id));
      return true;
    },
    async drain() {
      let queued;
      do { queued = pending; await queued; } while (queued !== pending);
    }
  };
}

async function dispatchPackagedAction(args, options) {
  const { app, userData, broker, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const requestId = crypto.randomUUID();
  const directory = path.join(privateRequestRoot(userData), requestId);
  fs.mkdirSync(directory, { mode: 0o700 });
  try {
    const payload = JSON.stringify(args);
    if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw new InterfaceError('request-too-large', 'The command arguments are too large.', 2);
    const queued = path.join(directory, 'request.json');
    fs.writeFileSync(queued, payload, { flag: 'wx', mode: 0o600 });
    const data = { agentdeskCliRequest: requestId };
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
    else if (Object.hasOwn(ACTIONS, command)) response = await dispatchPackagedAction(invocation.argv, options);
    else response = success(command, packagedRead(parsed, options));
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

module.exports = { packagedCliArguments, createCliBroker, runPackagedCli };
