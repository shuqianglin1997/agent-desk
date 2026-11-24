const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  codexProfileAtHome,
  discoverCodexHomes,
  inspectCodexHome,
  profileWithSameCodexAuth,
  readCodexAuthFile,
  stageCodexAuthHome
} = require('../src/codex-account-import');
const { getApp, profileLaunchPlan } = require('../src/apps');

const chatgptAuth = JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: { id_token: 'fixture-id', access_token: 'fixture-access', refresh_token: 'fixture-refresh' }
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Codex home discovery lists only standard runtime roots and deduplicates directory aliases', (t) => {
  const home = fixture(t);
  const standard = path.join(home, '.codex');
  const custom = path.join(home, 'account-home');
  fs.mkdirSync(standard);
  // A keychain-backed home can have existing config/sessions and no auth.json.
  fs.mkdirSync(path.join(standard, 'sessions'));
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'config.toml'), '');

  assert.deepEqual(discoverCodexHomes({ home, env: { CODEX_HOME: custom } }), [
    { source: 'default', directory: fs.realpathSync.native(standard) },
    { source: 'environment', directory: fs.realpathSync.native(custom) }
  ]);
  assert.equal(inspectCodexHome(home), null);
  assert.equal(inspectCodexHome('account-home'), null);

  const alias = path.join(home, 'alias');
  fs.symlinkSync(standard, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(discoverCodexHomes({ home, env: { CODEX_HOME: alias } }).length, 1);
  const profile = { id: 'existing', appId: 'codex', sessionRoot: alias };
  assert.equal(codexProfileAtHome([profile], standard), profile);
  assert.equal(codexProfileAtHome([{ ...profile, appId: 'claude' }], standard), null);
});

test('auth import accepts local file formats and returns fixed errors for bad files', (t) => {
  const root = fixture(t);
  const authPath = path.join(root, 'auth.json');
  assert.throws(() => readCodexAuthFile(path.join(root, 'secrets.json')), /^Error: codex-auth-filename$/);
  assert.throws(() => readCodexAuthFile(authPath), /^Error: codex-auth-unreadable$/);

  fs.writeFileSync(authPath, '\uFEFF' + chatgptAuth);
  assert.equal(readCodexAuthFile(authPath).toString(), chatgptAuth);
  const apiAuth = JSON.stringify({ OPENAI_API_KEY: 'fixture-api-key' });
  fs.writeFileSync(authPath, apiAuth);
  assert.equal(readCodexAuthFile(authPath).toString(), apiAuth);

  fs.writeFileSync(authPath, '{invalid-secret-bearing-file');
  assert.throws(() => readCodexAuthFile(authPath), /^Error: codex-auth-format$/);
  fs.writeFileSync(authPath, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access' } }));
  assert.throws(() => readCodexAuthFile(authPath), /^Error: codex-auth-format$/);
  fs.truncateSync(authPath, 256 * 1024 + 1);
  assert.throws(() => readCodexAuthFile(authPath), /^Error: codex-auth-size$/);
});

test('auth staging creates an isolated launchable home and can roll it back without touching the source', (t) => {
  const root = fixture(t);
  const source = path.join(root, 'auth.json');
  fs.writeFileSync(source, chatgptAuth);
  const profilePath = path.join(root, 'Profiles', 'codex-1');
  const profile = {
    id: 'new', appId: 'codex', profilePath, sessionRoot: path.join(profilePath, 'codex-home'), codexAuthImported: true
  };
  const bytes = readCodexAuthFile(source);
  const cleanup = stageCodexAuthHome(profile, bytes);
  const imported = path.join(profile.sessionRoot, 'auth.json');
  assert.deepEqual(fs.readdirSync(profile.sessionRoot), ['auth.json']);
  assert.deepEqual(fs.readFileSync(imported), bytes);
  if (process.platform !== 'win32') assert.equal(fs.statSync(imported).mode & 0o077, 0);
  assert.deepEqual(getApp('codex').launchEnv(profile, { CODEX_HOME: root }), { CODEX_HOME: profile.sessionRoot });
  assert.deepEqual(profileLaunchPlan(profile).args, [`--user-data-dir=${profilePath}`]);
  assert.equal(profileWithSameCodexAuth([profile], bytes), profile);
  assert.equal(profileWithSameCodexAuth([{ ...profile, codexAuthImported: false }], bytes), null);
  assert.throws(() => stageCodexAuthHome(profile, Buffer.from('replacement')), /EEXIST/);
  assert.deepEqual(fs.readFileSync(imported), bytes);
  cleanup();
  assert.equal(fs.existsSync(profilePath), false);
  assert.equal(fs.readFileSync(source, 'utf8'), chatgptAuth);
});

test('failed staging removes the newly reserved directory', (t) => {
  const root = fixture(t);
  const profilePath = path.join(root, 'codex-fail');
  const sessionRoot = path.join(profilePath, 'missing-parent', 'codex-home');
  assert.throws(() => stageCodexAuthHome({ profilePath, sessionRoot }, Buffer.from(chatgptAuth)), /ENOENT/);
  assert.equal(fs.existsSync(profilePath), false);
});

test('the preload accepts a native dropped file without exposing a path or a generic IPC method', async () => {
  const calls = [];
  const auth = {};
  const selected = path.resolve('auth.json');
  let manager;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { manager = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } },
    webUtils: { getPathForFile: (file) => file === auth ? selected : '' }
  };
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  vm.runInNewContext(preload, { require: () => electron });
  // The old Codex-only drop was removed with its dialog; recruiting's drop is the one entry.
  assert.equal(manager.importDroppedCodexAuth, undefined);
  assert.equal((await manager.inspectRecruitItem(selected)).reasonCode, 'credential-file-unreadable');
  assert.deepEqual(calls, []);
  assert.deepEqual(await manager.inspectRecruitItem(auth), { ok: true });
  assert.deepEqual(calls, [['recruit:inspectItem', selected]]);
  assert.equal(manager.invoke, undefined);
});
