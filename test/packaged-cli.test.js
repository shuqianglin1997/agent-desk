const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packagedCliArguments, createCliBroker, runPackagedCli } = require('../src/automation/packaged-cli');
const { makeTempDir } = require('./helpers/temp');

function harness(t, dispatch = () => {}, mainRunning = false) {
  const root = makeTempDir('agentdesk-packaged-cli-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'AgentDesk');
  const broker = createCliBroker({ userData, whenReady: async () => {}, dispatch });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = (data) => {
    if (mainRunning) broker.accept(data);
    return !mainRunning;
  };
  async function invoke(argv) {
    let output = '';
    const code = await runPackagedCli(argv, {
      app, userData, broker, version: 'test-version', discover: () => [{ appId: 'codex' }], timeoutMs: 180,
      stdout: { write: (value) => { output += value; } }
    });
    return { code, data: output ? JSON.parse(output) : null };
  }
  return { root, userData, invoke, broker };
}

test('packaged entry separates Electron flags from strict CLI command arguments', () => {
  assert.deepEqual(packagedCliArguments(['AgentDesk', '--cli', 'capabilities']), ['capabilities']);
  assert.deepEqual(packagedCliArguments(['Electron', '.', '--user-data-dir=/tmp/test', '--cli', 'paths'], true), ['paths']);
  assert.equal(packagedCliArguments(['AgentDesk', 'other', '--cli']), null);
});

test('packaged reads advertise supported actions and use the app data directory by default', async (t) => {
  const { invoke, userData } = harness(t);
  const capabilities = await invoke(['capabilities']);
  assert.equal(capabilities.data.data.packaged, true);
  assert.equal(capabilities.data.data.version, 'test-version');
  assert.equal(capabilities.data.data.commands.find((item) => item.name === 'profiles import-auth').effects, 'import-local-credentials');
  assert.deepEqual((await invoke(['profiles', 'list'])).data.data.profiles, []);
  assert.equal((await invoke(['paths'])).data.data.userData, userData);
  assert.deepEqual((await invoke(['profiles', 'discover'])).data.data.locations, [{ appId: 'codex' }]);
  assert.equal(fs.existsSync(userData), false);
});

test('the primary instance runs allowlisted operations and writes private JSON to a new file', async (t) => {
  const calls = [];
  const { invoke, root, userData } = harness(t, (command, input) => {
    calls.push({ command, ...input });
    return { profileId: 'slot-1' };
  });
  const output = path.join(root, 'cli result.json');
  const args = ['profiles', 'register', '--app', 'codex', '--session-root', root, '--output', output];
  assert.equal((await invoke(args)).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).data.profileId, 'slot-1');
  assert.deepEqual(calls, [{ command: 'profiles register', app: 'codex', 'session-root': root }]);
  assert.deepEqual(fs.readdirSync(path.join(userData, 'cli-requests')), []);
  assert.equal((await invoke(args)).code, 2);
  assert.equal(calls.length, 1);
});

test('a running desktop handles secondary requests and rejects unsupported or secret arguments', async (t) => {
  const calls = [];
  const { invoke, root, broker } = harness(t, (command) => {
    calls.push(command);
    return { profileId: 'slot-2' };
  }, true);
  assert.equal(broker.accept({ agentdeskCliRequest: '../traversal' }), false);
  assert.equal((await invoke(['profiles', 'launch', '--profile', 'slot-2'])).data.data.profileId, 'slot-2');
  const rejected = await invoke(['profiles', 'import-auth', '--app', 'codex', '--file', path.join(root, 'auth.json'), '--token', 'opaque-secret']);
  assert.equal(rejected.code, 2);
  assert.equal(JSON.stringify(rejected).includes('opaque-secret'), false);
  assert.deepEqual(calls, ['profiles launch']);
});
