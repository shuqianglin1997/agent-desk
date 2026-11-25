'use strict';

/*
 * AgentDesk — the command table (docs/ARCHITECTURE_PLAN.md §5.5).
 *
 * Every operation the window can ask Main for is one command:
 *   id        stable name, "<feature>.<verb>"
 *   channel   the IPC channel the window invokes
 *   preload   the preload method(s) that call it (src/preload.js stays an
 *             explicit allow-list; test/command-table.test.js holds it to
 *             this table, both ways)
 *   input     optional: shapes the raw argument before poll and exec
 *   poll      optional: (deps, input) -> null when it can run now, else a
 *             fixed reason code; the window then gets refuse(reason) or
 *             { ok: false, reasonCode }
 *   exec      (deps, input) -> the result
 * Feature modules (src/commands/<feature>.js) hold the commands; events are
 * what Main tells the window (./events.js).
 *
 * The command line's commands are in the same table (cli-local.js: run in
 * the CLI process; cli-desktop.js: relayed to the running desktop): name,
 * description, parameters, effects and exec. `capabilities` prints the
 * descriptor fields only (cliDescriptor).
 *
 * Commands never import Electron; Main passes its services in as `deps`.
 * The IPC shell is src/main/ipc/command-shell.js; docs/INTERNAL.md §7 is
 * generated from this table (scripts/command-docs.js).
 */

const { EVENTS } = require('./events');
const { CLI_LOCAL } = require('./cli-local');
const { CLI_DESKTOP } = require('./cli-desktop');

// Feature modules with implemented commands, in the order the list shows them.
const FEATURE_MODULES = [
  ['local-reads', require('./local-reads')],
  ['settings', require('./settings')],
  ['tools', require('./tools')],
  ['session-marks', require('./session-marks')],
  ['profiles', require('./profiles')],
  ['client-updates', require('./client-updates')],
  ['system', require('./system')],
  ['devices', require('./devices')],
  ['agents', require('./agents')],
  ['remote', require('./remote')],
  ['transfers', require('./transfers')],
  ['task-packages', require('./task-packages')],
  ['hub', require('./hub')],
  ['recruit', require('./recruit')],
  ['window', require('./window')]
];

const ID = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;
const CHANNEL = /^[a-z][a-zA-Z]*:[a-z][a-zA-Z-]*$/;
const METHOD = /^[a-z][a-zA-Z]*$/;
const REASON = /^[a-z0-9][a-z0-9-]{0,63}$/;

function idOf(channel) {
  const [feature, verb] = channel.split(':');
  return `${feature}.${verb.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())}`;
}

function featureOf(id) {
  return id.split('.')[0];
}

// module: the command's file in src/commands/ ('event' for events).
function normalize(command, module) {
  const preload = Array.isArray(command.preload) ? command.preload : [command.preload];
  return Object.freeze({ ...command, preload: Object.freeze([...preload]), feature: featureOf(command.id), module });
}

// Throws on a malformed or duplicated entry.
function validate(commands, events) {
  const ids = new Set();
  const channels = new Set();
  const methods = new Set();
  for (const command of [...commands, ...events]) {
    if (!ID.test(command.id)) throw new TypeError(`command-id-invalid: ${command.id}`);
    if (!CHANNEL.test(command.channel)) throw new TypeError(`command-channel-invalid: ${command.channel}`);
    if (ids.has(command.id)) throw new TypeError(`command-id-duplicate: ${command.id}`);
    if (channels.has(command.channel)) throw new TypeError(`command-channel-duplicate: ${command.channel}`);
    ids.add(command.id);
    channels.add(command.channel);
    if (!command.preload.length) throw new TypeError(`command-preload-missing: ${command.id}`);
    for (const method of command.preload) {
      if (!METHOD.test(method)) throw new TypeError(`command-preload-invalid: ${method}`);
      if (methods.has(method)) throw new TypeError(`command-preload-duplicate: ${method}`);
      methods.add(method);
    }
  }
  for (const command of commands) {
    if (typeof command.exec !== 'function') throw new TypeError(`command-exec-missing: ${command.id}`);
  }
}

let cached = null;

// { commands, events }: every invoke channel and every event, validated once.
function commandTable() {
  if (cached) return cached;
  const commands = FEATURE_MODULES.flatMap(([name, module]) => module.COMMANDS.map((command) => normalize(command, `src/commands/${name}.js`)));
  const events = EVENTS.map(([channel, preload]) => normalize({ id: idOf(channel), channel, preload }, 'event'));
  validate(commands, events);
  cached = Object.freeze({ commands: Object.freeze(commands), events: Object.freeze(events) });
  return cached;
}

const CLI_RUNS = new Set(['cli', 'packaged', 'desktop']);
let cliCached = null;

// The command line's commands, in the order capabilities lists them.
function cliTable() {
  if (cliCached) return cliCached;
  const entries = [...CLI_LOCAL, ...CLI_DESKTOP];
  const names = new Set();
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || !/^[a-z][a-z-]*(?: [a-z][a-z-]*)?$/.test(entry.name)) throw new TypeError(`cli-name-invalid: ${entry.name}`);
    if (names.has(entry.name)) throw new TypeError(`cli-name-duplicate: ${entry.name}`);
    names.add(entry.name);
    if (!CLI_RUNS.has(entry.runs)) throw new TypeError(`cli-runs-invalid: ${entry.name}`);
    if (typeof entry.exec !== 'function') throw new TypeError(`cli-exec-missing: ${entry.name}`);
  }
  cliCached = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  return cliCached;
}

// One CLI command by name, only when it runs where asked ('cli', 'packaged', 'desktop').
function cliCommand(name, ...runs) {
  return cliTable().find((entry) => entry.name === name && runs.includes(entry.runs)) || null;
}

// What capabilities prints for a command: description, parameters and, when
// it has one, effects.
function cliDescriptor(entry) {
  return { description: entry.description, parameters: entry.parameters, ...(entry.effects ? { effects: entry.effects } : {}) };
}

// Runs one command: input, then poll, then exec. `context` carries what the
// caller adds (the IPC shell passes { event } for commands that answer the
// sender, such as progress).
async function runCommand(command, deps, raw, context = {}) {
  const input = typeof command.input === 'function' ? command.input(raw) : raw;
  if (typeof command.poll === 'function') {
    const reason = await command.poll(deps, input, context);
    if (reason) {
      if (!REASON.test(String(reason))) throw new TypeError('command-reason-invalid');
      return typeof command.refuse === 'function' ? command.refuse(reason, input) : { ok: false, reasonCode: reason };
    }
  }
  return command.exec(deps, input, context);
}

module.exports = { commandTable, runCommand, idOf, REASON, cliTable, cliCommand, cliDescriptor };
