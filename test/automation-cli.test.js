'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run, parse } = require('../src/automation/cli');
const { execute } = require('../src/automation/service');
const apps = require('../src/apps');
const location = require('../src/session-location');

function invoke(args) {
  let output = '';
  const code = run(args, { write(value) { output += value; } });
  return { code, output, result: JSON.parse(output) };
}

function fixture(t, appId = 'codex') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-interface-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'AgentDesk');
  const profilePath = path.join(root, 'company client');
  const sessionRoot = path.join(root, 'company home');
  for (const dir of [userData, profilePath, sessionRoot]) fs.mkdirSync(dir);
  const profile = { id: 'company-slot', appId, name: '公司环境', profilePath, sessionRoot, profilePathMode: 'custom', sessionRootMode: 'custom', isProtected: false, note: 'DO-NOT-OUTPUT-SECRET', token: 'DO-NOT-OUTPUT-SECRET', future: { auth: 'DO-NOT-OUTPUT-SECRET' } };
  const file = path.join(userData, 'profiles.json');
  fs.writeFileSync(file, JSON.stringify({ version: 2, profiles: [profile] }));
  fs.writeFileSync(path.join(sessionRoot, 'auth.json'), 'DO-NOT-READ-CREDENTIALS');
  fs.writeFileSync(path.join(sessionRoot, 'config.toml'), 'DO-NOT-READ-CONFIG');
  return { root, userData, profile, file, args: ['--user-data', userData, '--profile', profile.id] };
}

function codexRecord(root, id, extra = {}) {
  const directory = path.join(root, 'sessions');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', timestamp: '2026-09-26T08:00:00Z', payload: { id, title: `Task ${id}`, cwd: '/example/project', ...extra } }) + '\n');
  return file;
}

test('CLI discovers its complete contract without loading Electron or creating files', () => {
  const result = invoke(['capabilities']);
  assert.equal(result.code, 0);
  assert.equal(result.result.schemaVersion, 1);
  assert.ok(result.result.data.commands.some((command) => command.name === 'integration plan'));
  assert.ok(result.result.data.commands.every((command) => command.effects === 'read-only'));
  assert.equal(Object.keys(require.cache).some((file) => file.endsWith('/src/main.js')), false);
  assert.equal(invoke([]).result.command, 'capabilities');
  assert.equal(invoke(['paths']).result.data.confirmed, false);
});

test('registered capabilities are distinct from launch/discovery/login claims', () => {
  const list = invoke(['apps']).result.data.apps;
  assert.deepEqual(list.map((app) => app.id), apps.appIds());
  assert.equal(list.find((app) => app.id === 'dsh-cli').canScanSessions, false);
  assert.equal(list.find((app) => app.id === 'claude-cli').canLaunch, true);
  assert.equal(list.find((app) => app.id === 'claude-cli').supportsManagedProfiles, false);
  assert.equal(list.find((app) => app.id === 'claude-cli').desktopPreparation.supportedOnThisPlatform, false);
  assert.equal(list.find((app) => app.id === 'cursor').desktopPreparation.supportedOnThisPlatform, false);
  assert.equal(list.find((app) => app.id === 'codex').desktopPreparation.supportedOnThisPlatform, ['darwin', 'win32'].includes(process.platform));
  assert.deepEqual(list.find((app) => app.id === 'codex').desktopPreparation.portableSettingKeys, []);
});

test('invalid/secret/unknown/duplicate options are rejected without echoing their values', () => {
  for (const args of [
    ['profiles', 'list'], ['generic-exec', 'DO-NOT-OUTPUT-SECRET'],
    ['apps', '--token', 'DO-NOT-OUTPUT-SECRET'], ['apps', '--__proto__', 'DO-NOT-OUTPUT-SECRET'],
    ['sessions', 'list', '--limit', '0'], ['sessions', 'list', '--limit', '201'],
    ['sessions', 'list', '--offset', '-1'], ['sessions', 'list', '--limit', '2x'],
    ['profiles', 'list', '--user-data', 'a', '--user-data', 'b'],
    ['profiles', 'list', '--user-data', 'relative/path']
  ]) {
    const result = invoke(args);
    assert.equal(result.code, 2, JSON.stringify(args));
    assert.equal(result.result.ok, false);
    assert.doesNotMatch(result.output, /DO-NOT-OUTPUT-SECRET/);
  }
  assert.throws(() => execute('not-a-command'), { code: 'unknown-command' });
});

test('missing store remains absent; corrupt/versioned/duplicate stores never recover or normalize', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file);
  fs.renameSync(f.file, `${f.file}.bak`);
  assert.deepEqual(invoke(['profiles', 'list', '--user-data', f.userData]).result.data, { storeState: 'missing', scope: 'local-profiles', profiles: [] });
  assert.equal(fs.existsSync(f.file), false);
  for (const payload of ['{DO-NOT-OUTPUT-SECRET', '[]', '{"version":3,"profiles":[]}', JSON.stringify({ version: 2, profiles: [f.profile, f.profile] }), JSON.stringify({ version: 2, profiles: [{ ...f.profile, appId: 'unknown' }] })]) {
    fs.writeFileSync(f.file, payload);
    const result = invoke(['profiles', 'list', '--user-data', f.userData]);
    assert.equal(result.code, 4);
    assert.doesNotMatch(result.output, /DO-NOT-OUTPUT-SECRET/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), payload);
    assert.deepEqual(fs.readFileSync(`${f.file}.bak`), before);
  }
});

test('profile reads whitelist output, never read auth/config, and leave all fixture bytes untouched', (t) => {
  const f = fixture(t, 'claude-cli');
  const before = fs.readFileSync(f.file);
  const originalRead = fs.readFileSync;
  const forbidden = ['auth.json', 'config.toml', 'settings.json', 'mesh.db', 'mesh-keys.json'];
  fs.readFileSync = function (file, ...args) {
    assert.equal(forbidden.includes(path.basename(String(file))), false, String(file));
    return originalRead.call(fs, file, ...args);
  };
  try {
    const list = invoke(['profiles', 'list', '--user-data', f.userData]);
    assert.deepEqual(list.result.data.profiles, [{ id: f.profile.id, appId: 'claude-cli', name: '公司环境' }]);
    const inspected = invoke(['profiles', 'inspect', ...f.args]);
    assert.equal(inspected.code, 0);
    assert.deepEqual(inspected.result.data.configuration.rootEnvironment, { CLAUDE_CONFIG_DIR: f.profile.sessionRoot });
    assert.equal(inspected.result.data.configuration.providerConfigurationManagedByAgentDesk, false);
    assert.doesNotMatch(inspected.output, /DO-NOT/);
    assert.equal(Object.hasOwn(inspected.result.data.configuration.rootEnvironment, 'ANTHROPIC_API_KEY'), false);
  } finally { fs.readFileSync = originalRead; }
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(invoke(['profiles', 'inspect', '--user-data', f.userData, '--profile', 'absent']).code, 3);
});

test('local session list reuses root classification, filters, pagination and shared locator', (t) => {
  const f = fixture(t);
  codexRecord(f.profile.sessionRoot, 'root-one');
  codexRecord(f.profile.sessionRoot, 'root-two');
  codexRecord(f.profile.sessionRoot, 'child', { thread_source: 'subagent', parent_thread_id: 'root-one', source: { subagent: { other: 'guardian' } } });
  const result = invoke(['sessions', 'list', ...f.args, '--limit', '1']);
  assert.equal(result.code, 0);
  assert.equal(result.result.data.totalInScan, 2);
  assert.equal(result.result.data.nextOffset, 1);
  assert.equal(result.result.data.sessions.length, 1);
  assert.equal(Object.hasOwn(result.result.data.sessions[0], 'filePath'), false);
  const filtered = invoke(['sessions', 'list', ...f.args, '--query', 'ROOT-ONE']);
  assert.equal(filtered.result.data.sessions[0].id, 'root-one');
  assert.equal(filtered.result.data.totalInScan, 1);
  const page = invoke(['sessions', 'list', ...f.args, '--limit', '1', '--offset', '1']);
  assert.equal(page.result.data.nextOffset, null);
  const locate = invoke(['sessions', 'locate', ...f.args, '--session', 'root-one']);
  const original = apps.getApp('codex').scan(f.profile).find((session) => session.id === 'root-one');
  assert.equal(locate.result.data.text, location.format(original));
  assert.equal(invoke(['sessions', 'locate', ...f.args, '--session', 'child']).code, 3);
});

test('unsupported/missing sessions and ambiguous IDs do not pretend success', (t) => {
  const f = fixture(t, 'dsh-cli');
  assert.equal(invoke(['sessions', 'list', ...f.args]).code, 5);
  fs.writeFileSync(f.file, JSON.stringify({ version: 2, profiles: [{ ...f.profile, appId: 'codex', sessionRoot: path.join(f.root, 'absent') }] }));
  assert.equal(invoke(['sessions', 'list', ...f.args]).code, 4);
  fs.writeFileSync(f.file, JSON.stringify({ version: 2, profiles: [{ ...f.profile, appId: 'claude' }] }));
  for (const area of ['claude-code-sessions', 'local-agent-mode-sessions']) {
    const dir = path.join(f.profile.sessionRoot, area);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'local_same.json'), JSON.stringify({ sessionId: 'same', title: 'ambiguous' }));
  }
  assert.equal(invoke(['sessions', 'locate', ...f.args, '--session', 'same']).result.error.code, 'session-ambiguous');
});

test('integration preflight uses canonical root overlap, rejects unknown clients and never applies', (t) => {
  const f = fixture(t);
  const candidate = path.join(f.root, 'link');
  fs.symlinkSync(f.profile.sessionRoot, candidate, process.platform === 'win32' ? 'junction' : 'dir');
  const args = ['integration', 'plan', '--user-data', f.userData, '--app', 'codex', '--profile-path', path.join(candidate, 'new-child'), '--session-root', candidate];
  const before = fs.readFileSync(f.file);
  const result = invoke(args);
  assert.equal(result.code, 0);
  assert.equal(result.result.data.applied, false);
  assert.equal(result.result.data.collisions[0].id, f.profile.id);
  assert.equal(result.result.data.pathState.profile, 'missing');
  assert.equal(fs.existsSync(path.join(candidate, 'new-child')), false);
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(invoke(args.map((value) => value === 'codex' ? 'unknown' : value)).code, 5);
  const unsupported = invoke(args.map((value) => value === 'codex' ? 'kimi-work' : value));
  assert.equal(unsupported.result.data.launchPolicy.ok, false);
});

test('every documented command is discoverable and CLI is runnable without Electron or npm', (t) => {
  const f = fixture(t);
  const child = spawnSync(process.execPath, [path.join(__dirname, '../src/automation/cli.js'), 'profiles', 'list', '--user-data', f.userData], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).ok, true);
  assert.equal(child.stdout.trim().split('\n').length, 1);
  assert.equal(parse(['sessions', 'list', '--help']).help, true);
});

test('tool discovery does not execute a found launcher or leak the inherited environment', (t) => {
  const f = fixture(t, 'claude-cli');
  const launcher = path.join(f.root, 'claude.cjs');
  const marker = path.join(f.root, 'executed');
  fs.writeFileSync(launcher, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  const child = spawnSync(process.execPath, [path.join(__dirname, '../src/automation/cli.js'), 'tools'], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, AGENTDESK_CLAUDE_CLI: launcher, ANTHROPIC_API_KEY: 'DO-NOT-OUTPUT-SECRET' }
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).data.tools.find((tool) => tool.id === 'claude').found, true);
  assert.ok(JSON.parse(child.stdout).data.tools.some((tool) => tool.id === 'codex'));
  assert.equal(fs.existsSync(marker), false);
  assert.doesNotMatch(child.stdout, /DO-NOT-OUTPUT-SECRET/);
});

test('all read commands reject filesystem mutations and private-store reads at runtime', (t) => {
  const f = fixture(t);
  codexRecord(f.profile.sessionRoot, 'safe-root');
  const originals = new Map();
  for (const method of ['writeFileSync', 'mkdirSync', 'renameSync', 'copyFileSync', 'unlinkSync', 'rmSync', 'symlinkSync', 'chmodSync']) {
    originals.set(method, fs[method]);
    fs[method] = () => { throw new Error('unexpected-write'); };
  }
  const originalRead = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function (file, ...args) { reads.push(String(file)); return originalRead.call(fs, file, ...args); };
  try {
    for (const args of [
      ['capabilities'], ['paths'], ['apps'], ['tools'],
      ['profiles', 'list', '--user-data', f.userData], ['profiles', 'inspect', ...f.args],
      ['sessions', 'list', ...f.args], ['sessions', 'locate', ...f.args, '--session', 'safe-root'],
      ['integration', 'plan', '--user-data', f.userData, '--app', 'codex', '--profile-path', f.profile.profilePath, '--session-root', f.profile.sessionRoot]
    ]) assert.equal(invoke(args).code, 0, args.join(' '));
    assert.equal(reads.some((file) => /(?:auth\.json|config\.toml|mesh\.db|mesh-keys\.json)$/.test(file)), false);
  } finally {
    fs.readFileSync = originalRead;
    for (const [method, original] of originals) fs[method] = original;
  }
});

test('unregistered official roots are warned about, and internal failures never expose source text', (t) => {
  const f = fixture(t);
  const originalSupport = apps.appSupportDir;
  const originalScan = apps.APPS.codex.scan;
  apps.appSupportDir = () => path.join(f.root, 'official-default');
  try {
    const result = invoke(['integration', 'plan', '--user-data', f.userData, '--app', 'codex', '--profile-path', path.join(f.root, 'official-default'), '--session-root', path.join(f.root, 'separate-home')]);
    assert.equal(result.result.data.usesOfficialRoot, process.platform !== 'win32');
    apps.APPS.codex.scan = () => { throw new Error('DO-NOT-OUTPUT-SECRET'); };
    const failure = invoke(['sessions', 'list', ...f.args]);
    assert.equal(failure.code, 1);
    assert.equal(failure.result.error.code, 'internal-error');
    assert.doesNotMatch(failure.output, /DO-NOT-OUTPUT-SECRET/);
  } finally {
    apps.appSupportDir = originalSupport;
    apps.APPS.codex.scan = originalScan;
  }
});
