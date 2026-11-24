'use strict';

// 调度中枢 through the packaged CLI: the prompt travels on stdin and in memory,
// never in argv or the request folder; depth comes from the caller's own
// environment; ambiguous names return candidates; nothing changes access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliBroker, runPackagedCli, readPromptFromStdin, PACKAGED_COMMANDS } = require('../src/automation/packaged-cli');
const { InterfaceError } = require('../src/automation/service');

const PROMPT = 'PROMPT-SENTINEL-c41 check the diff\n';

function harness(t, dispatch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-hub-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'AgentDesk');
  const broker = createCliBroker({ userData, whenReady: async () => {}, dispatch });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = (data) => { broker.accept(data); return false; };
  async function invoke(argv, options = {}) {
    let output = '';
    const code = await runPackagedCli(argv, {
      app, userData, broker, version: 'test', timeoutMs: 400,
      readPrompt: async () => options.prompt ?? PROMPT,
      env: options.env || {},
      stdout: { write: (value) => { output += value; } }
    });
    return { code, data: output ? JSON.parse(output) : null };
  }
  return { root, userData, invoke };
}

test('run hands the prompt and nesting depth to the desktop in memory only', async (t) => {
  const seen = [];
  const { invoke, userData } = harness(t, (command, input, extra) => {
    const requests = path.join(userData, 'cli-requests');
    const onDisk = fs.readdirSync(requests).map((id) => fs.readdirSync(path.join(requests, id))
      .map((name) => fs.readFileSync(path.join(requests, id, name), 'utf8')).join('')).join('');
    seen.push({ command, input: { ...input }, extra, onDisk });
    return { id: 'run-1', state: 'starting' };
  });
  const result = await invoke(['run', '--agent', 'Mochi', '--title', 'Review', '--cwd', '/tmp', '--from', 'Claude personal'], {
    env: { AGENTDESK_HUB_DEPTH: '1', AGENTDESK_HUB_RUN: 'run-parent', CODEX_HOME: '/Users/me/.codex', OPENAI_API_KEY: 'sk-not-passed', CLAUDE_CONFIG_DIR: 'relative' }
  });
  assert.equal(result.code, 0);
  assert.equal(result.data.data.id, 'run-1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, 'run');
  assert.deepEqual(seen[0].input, { agent: 'Mochi', title: 'Review', cwd: '/tmp', from: 'Claude personal' });
  assert.equal(seen[0].extra.prompt, PROMPT);
  assert.deepEqual(seen[0].extra.context, { depth: '1', parentRunId: 'run-parent', homes: { CODEX_HOME: '/Users/me/.codex' } });
  assert.equal(seen[0].onDisk.includes('PROMPT-SENTINEL'), false);
  assert.equal(JSON.stringify(result.data).includes('PROMPT-SENTINEL'), false);
});

test('the prompt is never an argument and must come from a pipe', async (t) => {
  const { invoke } = harness(t, () => ({}));
  const asOption = await invoke(['run', '--agent', 'a', '--title', 't', '--cwd', '/tmp', '--prompt', 'hi']);
  assert.equal(asOption.code, 2);
  assert.equal(asOption.data.error.code, 'unknown-option');

  await assert.rejects(readPromptFromStdin({ isTTY: true }), (error) => error.code === 'prompt-stdin-required');
  const big = new PassThrough();
  const pending = readPromptFromStdin(big);
  big.end(Buffer.alloc(64 * 1024 + 1, 0x61));
  await assert.rejects(pending, (error) => error.code === 'prompt-too-large');
  const empty = new PassThrough();
  const pendingEmpty = readPromptFromStdin(empty);
  empty.end('  \n');
  await assert.rejects(pendingEmpty, (error) => error.code === 'prompt-required');
  const ok = new PassThrough();
  const pendingOk = readPromptFromStdin(ok);
  ok.end('line one\nline two\n');
  assert.equal(await pendingOk, 'line one\nline two\n');
});

test('hub reads and stop are relayed; an ambiguous name returns the candidates', async (t) => {
  const calls = [];
  const { invoke } = harness(t, (command, input) => {
    calls.push([command, input.run || input.limit || null]);
    if (command === 'agents list') {
      throw new InterfaceError('agent-ambiguous', 'More than one allowed account has that name. Use one of the IDs.', 2, {
        candidates: [{ id: 'a', name: 'Tofu', app: 'codex' }, { id: 'b', name: 'Tofu', app: 'claude-cli' }]
      });
    }
    return { ok: true };
  });
  const ambiguous = await invoke(['agents', 'list']);
  assert.equal(ambiguous.code, 2);
  assert.equal(ambiguous.data.error.code, 'agent-ambiguous');
  assert.deepEqual(ambiguous.data.error.candidates.map((item) => item.id), ['a', 'b']);
  for (const argv of [['runs', 'list', '--limit', '5'], ['runs', 'status', '--run', 'run-x'], ['runs', 'output', '--run', 'run-x'], ['runs', 'stop', '--run', 'run-x']]) {
    assert.equal((await invoke(argv)).code, 0);
  }
  assert.deepEqual(calls, [['agents list', null], ['runs list', 5], ['runs status', 'run-x'], ['runs output', 'run-x'], ['runs stop', 'run-x']]);
  assert.equal((await invoke(['runs', 'list', '--limit', '0'])).code, 2);
});

test('capabilities describe the hub; no command can switch an account on or add a folder', async (t) => {
  const { invoke } = harness(t, () => ({}));
  const capabilities = (await invoke(['capabilities'])).data.data;
  const names = capabilities.commands.map((item) => item.name);
  for (const name of ['agents list', 'run', 'runs list', 'runs status', 'runs output', 'runs stop']) assert.ok(names.includes(name), name);
  assert.equal(capabilities.commands.find((item) => item.name === 'run').effects, 'start-background-run');
  assert.match(capabilities.hub.relay, /never starts, queues, retries or schedules/);
  assert.match(capabilities.hub.stored, /never the prompt or the answer/);
  for (const [name, definition] of Object.entries(PACKAGED_COMMANDS)) {
    assert.doesNotMatch(name, /allow|access|folder|limit|grant/);
    assert.equal(Object.hasOwn(definition.parameters, 'prompt'), false);
  }
});

test('Main relays hub commands only from a running desktop and maps refusals to fixed codes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /const cliOnlyInstance = cliLaunchArgs !== null;/);
  assert.match(main, /if \(cliOnlyInstance && HUB_DESKTOP_COMMANDS\.has\(command\)\) throw hubInterfaceError\(new HubError\('desktop-not-running'\)\)/);
  assert.match(main, /const HUB_DESKTOP_COMMANDS = new Set\(\['agents list', 'run', 'runs stop'\]\)/);
  // Background runs end before the client wind-down, whatever the keep setting.
  const quit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('const quitBehavior = loadSettings().profileQuitBehavior;'));
  assert.match(quit, /agentHub\.stopAll\('app-quit'\)/);
  // The switches change only through the desktop window's IPC.
  assert.match(main, /ipcMain\.handle\('hub:setAccess'/);
  assert.match(main, /if \(callable && !adapterFor\(profile\.appId\)\) return \{ ok: false, reasonCode: 'client-unsupported'/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(preload, /hubAddFolder: \(\) => ipcRenderer\.invoke\('hub:addFolder'\)/);
  assert.doesNotMatch(preload, /hubAddFolder: \([^)]+\)/);
});

test('a broker request without a running desktop still drains cleanly', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-hub-cli-own-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'AgentDesk');
  const extras = [];
  const broker = createCliBroker({ userData, whenReady: async () => {}, dispatch: (_command, _input, extra) => { extras.push(extra); return { ok: true }; } });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  let output = '';
  const code = await runPackagedCli(['run', '--agent', 'a', '--title', 't', '--cwd', '/tmp'], {
    app, userData, broker, version: 'test', timeoutMs: 400, readPrompt: async () => PROMPT, env: {},
    stdout: { write: (value) => { output += value; } }
  });
  assert.equal(code, 0);
  assert.equal(extras[0].prompt, PROMPT);
  assert.deepEqual(extras[0].context, {});
  assert.equal(JSON.parse(output).ok, true);
});
