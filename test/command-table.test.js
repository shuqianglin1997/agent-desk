// The command table (src/commands/registry.js) is the one list of what the
// window can ask Main for and what Main tells the window. src/preload.js stays
// an explicit allow-list, held to the table both ways; every channel is
// registered exactly once, by the command shell or where the table says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { commandTable, runCommand } = require('../src/commands/registry');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Preload: which method invokes which channel, and which subscribes to which event.
function preloadMap() {
  const source = read('src/preload.js');
  const start = source.indexOf('contextBridge.exposeInMainWorld');
  const helpers = {};
  for (const match of source.slice(0, start).matchAll(/function\s+(\w+)\s*\(/g)) {
    const from = match.index;
    const next = source.slice(from + 10, start).search(/\n(?:async\s+)?function\s/);
    const chunk = source.slice(from, next < 0 ? start : from + 10 + next);
    helpers[match[1]] = [...chunk.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((item) => item[1]);
  }
  const invoke = new Map();
  const events = new Map();
  const add = (map, channel, method) => map.set(channel, [...new Set([...(map.get(channel) || []), method])]);
  let current = null;
  for (const line of source.slice(start).split('\n').slice(1)) {
    const property = line.match(/^ {2}(\w+)(?::\s*(\w+)?|,|$)/);
    if (property) {
      current = property[1];
      const reference = line.match(/^ {2}(\w+)(?::\s*(\w+))?,?$/);
      const helper = reference && helpers[reference[2] || reference[1]];
      if (helper) for (const channel of helper) add(invoke, channel, current);
    }
    for (const match of line.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) add(invoke, match[1], current);
    for (const match of line.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)) add(events, match[1], current);
  }
  return { invoke, events, source };
}

const MAIN_SIDE = ['src/main.js', ...fs.readdirSync(path.join(ROOT, 'src/main')).filter((name) => name.endsWith('.js')).map((name) => `src/main/${name}`),
  ...fs.readdirSync(path.join(ROOT, 'src/main/ipc')).map((name) => `src/main/ipc/${name}`)];

test('the table is valid: unique ids, channels and preload methods', () => {
  const { commands, events } = commandTable();
  assert.ok(commands.length >= 100);
  assert.equal(new Set(commands.map((command) => command.channel)).size, commands.length);
  for (const command of commands) {
    assert.equal(typeof command.exec, 'function', command.id);
    assert.match(command.module, /^src\/commands\/[a-z-]+\.js$/);
  }
  for (const event of events) assert.equal(event.module, 'event');
});

test('preload invokes exactly the table\'s channels, each through the methods the table names', () => {
  const { commands } = commandTable();
  const { invoke } = preloadMap();
  assert.deepEqual([...invoke.keys()].sort(), commands.map((command) => command.channel).sort());
  for (const command of commands) assert.deepEqual([...invoke.get(command.channel)].sort(), [...command.preload].sort(), command.channel);
});

test('preload subscribes exactly to the table\'s events, and Main sends each of them', () => {
  const { events } = commandTable();
  const { events: subscribed } = preloadMap();
  assert.deepEqual([...subscribed.keys()].sort(), events.map((event) => event.channel).sort());
  for (const event of events) assert.deepEqual(subscribed.get(event.channel), [...event.preload], event.channel);
  const mainSide = MAIN_SIDE.map(read).join('\n');
  for (const event of events) assert.ok(mainSide.includes(`'${event.channel}'`), `${event.channel} is sent by Main`);
});

test('the window\'s channels are registered only by the command shell, each once', () => {
  const { commands } = commandTable();
  const known = new Set(commands.map((command) => command.channel));
  for (const file of MAIN_SIDE.filter((name) => name !== 'src/main/ipc/command-shell.js')) {
    for (const match of read(file).matchAll(/\.handle\(\s*'([^']+)'/g)) {
      assert.equal(known.has(match[1]), false, `${match[1]} is registered by hand in ${file}`);
    }
  }
  const registered = [];
  require('../src/main/ipc/command-shell').registerCommandIpc({ ipcMain: { handle: (channel) => registered.push(channel) }, deps: {} });
  assert.deepEqual(registered.sort(), [...known].sort());
});

test('commands never import Electron, and the shell runs input, poll, then exec', async () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'src/commands'))) {
    assert.doesNotMatch(read(`src/commands/${name}`), /require\(['"]electron['"]\)/, name);
  }
  const calls = [];
  const command = {
    input: (raw) => { calls.push('input'); return { value: String(raw?.value || '').slice(0, 3) }; },
    poll: (_deps, input) => { calls.push('poll'); return input.value === 'no' ? 'not-now' : null; },
    exec: (deps, input) => { calls.push('exec'); return deps.echo(input.value); }
  };
  assert.equal(await runCommand(command, { echo: (value) => `got ${value}` }, { value: 'abcdef' }), 'got abc');
  assert.deepEqual(calls, ['input', 'poll', 'exec']);
  assert.deepEqual(await runCommand(command, {}, { value: 'no' }), { ok: false, reasonCode: 'not-now' });
  await assert.rejects(runCommand({ poll: () => 'Not A Code', exec() {} }, {}, {}), /command-reason-invalid/);
});

test('Main hands the commands and the moved modules every service they take, as generated', () => {
  const mainContext = require('../scripts/main-context');
  const main = read('src/main.js');
  assert.equal(mainContext.current(main), mainContext.block(main), 'run node scripts/main-context.js --write');
  // The log (src/main/app-log.js) records failed commands by id and reason code.
  assert.match(main, /registerCommandIpc\(\{ ipcMain, deps: mainContext\(\), log: appLog \}\)/);
});

test('the command line reads its commands from the same table, and prints only their descriptors', () => {
  const { cliTable, cliDescriptor } = require('../src/commands/registry');
  const service = require('../src/automation/service');
  const packaged = require('../src/automation/packaged-cli');
  assert.deepEqual(Object.keys(packaged.PACKAGED_COMMANDS), cliTable().map((entry) => entry.name));
  assert.deepEqual(service.COMMANDS, Object.fromEntries(cliTable().filter((entry) => entry.runs === 'cli').map((entry) => [entry.name, cliDescriptor(entry)])));
  for (const entry of cliTable()) {
    assert.deepEqual(Object.keys(cliDescriptor(entry)).filter((key) => !['description', 'parameters', 'effects'].includes(key)), [], entry.name);
  }
  // Main relays the desktop actions through the table, not through its own list.
  assert.match(require('./helpers/main-handler-source').mainHandlerSource(), /const entry = cliCommand\(command, 'desktop'\);/);
});
