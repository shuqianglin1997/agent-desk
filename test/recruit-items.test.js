const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecruitItems } = require('../src/main/recruit-items');
const { createLocationRegistrar } = require('../src/main/profile-registration');

const SECRET = 'sentinel-drop-secret-91c2';

function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A store, a registrar and the item planner wired the way Main wires them.
function harness(t, platform = 'linux') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-drop-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { profiles: [] };
  let sequence = 0;
  const managed = path.join(root, 'AgentDesk', 'Profiles');
  const build = (_profiles, input, options = {}) => {
    sequence += 1;
    const profilePath = options.externalLocation?.profilePath || path.join(managed, `${input.appId}-${sequence}`);
    return {
      id: `p${sequence}`, appId: input.appId, name: input.name || `${input.appId} ${sequence}`, profilePath,
      sessionRoot: options.externalLocation?.sessionRoot || path.join(profilePath, 'home'),
      ...(options.credentialImport ? { credentialImported: options.credentialImport } : {}),
      ...(options.codexAuth ? { codexAuthImported: true } : {})
    };
  };
  const registrar = createLocationRegistrar({
    loadProfiles: () => store.profiles.slice(),
    saveProfiles: (next) => { store.profiles = next.slice(); },
    buildProfile: build,
    defaultProfilePath: (appId) => path.join(root, 'support', appId),
    home: path.join(root, 'home')
  });
  const createStoredProfile = (input, options = {}) => {
    const profile = build(store.profiles, input, options);
    if (options.codexAuth) {
      fs.mkdirSync(profile.sessionRoot, { recursive: true });
      fs.writeFileSync(path.join(profile.sessionRoot, 'auth.json'), options.codexAuth);
    }
    options.stage?.(profile);
    store.profiles.push(profile);
    return profile;
  };
  const defaults = [];
  const items = createRecruitItems({
    loadProfiles: () => store.profiles.slice(),
    registerLocations: (inputs) => registrar.registerLocations(inputs),
    planExistingLocation: (input, profiles) => registrar.planExistingLocation(input, profiles),
    createStoredProfile,
    discoverCodexHomes: () => defaults.filter((item) => item.appId === 'codex').map((item) => ({ directory: item.sessionRoot })),
    discoverLocations: async ({ appId }) => ({ locations: defaults.filter((item) => item.appId === appId) }),
    env: {},
    platform
  });
  return { root, store, items, defaults };
}

const codexAuth = () => JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'a.b.c', access_token: SECRET, refresh_token: SECRET } });

test('each droppable sign-in file is recognised and, when it is not from a known home, copied after confirmation', async (t) => {
  const { root, store, items } = harness(t);
  const files = {
    codex: path.join(root, 'downloads', 'auth.json'),
    'dsh-cli': path.join(root, 'downloads', '.credentials.yaml'),
    kimi: path.join(root, 'old-kimi', 'credentials', 'kimi-code.json'),
    'claude-cli': path.join(root, 'linux-claude', '.credentials.json')
  };
  write(files.codex, codexAuth());
  write(files['dsh-cli'], `version: 1\nrefs:\n  DEEPSEEK_API_KEY: '${SECRET}'\n`);
  write(files.kimi, JSON.stringify({ access_token: SECRET, refresh_token: SECRET }));
  write(files['claude-cli'], JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: SECRET } }));
  for (const [appId, file] of Object.entries(files)) {
    const planned = await items.planItem(file);
    assert.equal(planned.kind, 'file');
    assert.equal(planned.appId, appId);
    assert.equal(planned.action, 'copy', `${appId} is copied`);
    assert.equal(JSON.stringify({ ...planned, plan: undefined }).includes(SECRET), false);
    const done = await items.executeItem(file, 'copy');
    assert.equal(done.copied, true);
    assert.equal(done.appId, appId);
    // Dropping the same file again reuses the copy instead of making another.
    assert.equal((await items.planItem(file)).action, 'existing');
  }
  assert.equal(store.profiles.length, 4);
  assert.ok(fs.existsSync(files.codex), 'sources are never moved');
});

test('a sign-in file from a default home registers that home where it is', async (t) => {
  const { root, items, defaults } = harness(t);
  const codexHome = path.join(root, 'home', '.codex');
  const dshHome = path.join(root, 'home', '.dsh');
  write(path.join(codexHome, 'auth.json'), codexAuth());
  write(path.join(dshHome, '.credentials.yaml'), 'version: 1\nrefs: {}\n');
  defaults.push({ appId: 'codex', sessionRoot: codexHome }, { appId: 'dsh-cli', sessionRoot: dshHome });
  for (const file of [path.join(codexHome, 'auth.json'), path.join(dshHome, '.credentials.yaml')]) {
    assert.equal((await items.planItem(file)).action, 'register');
    const done = await items.executeItem(file, 'register');
    assert.equal(done.inPlace, true);
    assert.equal((await items.planItem(file)).action, 'existing');
  }
});

test('each client folder is registered in place; the second drop finds it on the desk', async (t) => {
  const { root, store, items } = harness(t);
  const folders = {
    codex: ['codex-home', 'config.toml', 'sessions/2026/'],
    'claude-cli': ['claude-home', '.claude.json'],
    kimi: ['kimi-home', 'credentials/kimi-code.json'],
    'dsh-cli': ['dsh-home', '.credentials.yaml'],
    claude: ['claude-desktop', 'Local State', 'claude-code-sessions/'],
    cursor: ['cursor-data', 'User/globalStorage/state.vscdb']
  };
  for (const [appId, [name, ...markers]] of Object.entries(folders)) {
    const folder = path.join(root, 'drops', name);
    for (const marker of markers) {
      if (marker.endsWith('/')) fs.mkdirSync(path.join(folder, marker), { recursive: true });
      else write(path.join(folder, marker), '{}');
    }
    const planned = await items.planItem(folder);
    assert.deepEqual([planned.kind, planned.appId, planned.action], ['folder', appId, 'register']);
    await items.executeItem(folder, 'register');
    assert.equal((await items.planItem(folder)).action, 'existing');
  }
  assert.equal(store.profiles.length, 6);
  const cursor = store.profiles.find((profile) => profile.appId === 'cursor');
  assert.equal(cursor.profilePath, path.join(root, 'drops', 'cursor-data'), 'a desktop data folder keeps its own path');
});

test('unsupported and unrecognised items are refused with a reason and nothing is written', async (t) => {
  const { root, store, items } = harness(t, 'darwin');
  const cases = {
    'credential-import-unsupported-platform': path.join(root, 'mac', '.credentials.json'),
    'credential-file-unrecognized': path.join(root, 'notes.txt'),
    'location-unrecognized': path.join(root, 'projects', 'website'),
    'location-ambiguous': path.join(root, 'unclear'),
    'client-default-only': path.join(root, 'kimi-desktop'),
    'credential-file-format': path.join(root, 'bad', '.credentials.yaml'),
    'credential-file-unreadable': path.join(root, 'missing.json')
  };
  write(cases['credential-import-unsupported-platform'], '{}');
  write(cases['credential-file-unrecognized'], 'hello');
  write(path.join(cases['location-unrecognized'], 'index.html'), '');
  write(path.join(cases['location-ambiguous'], 'config.toml'), '');
  fs.mkdirSync(path.join(cases['location-ambiguous'], 'sessions'));
  fs.mkdirSync(path.join(cases['client-default-only'], 'daimon-share', 'daimon'), { recursive: true });
  write(cases['credential-file-format'], 'DEEPSEEK_API_KEY: flat\n');
  for (const [code, item] of Object.entries(cases)) {
    await assert.rejects(items.planItem(item), (error) => error.code === code, code);
  }
  await assert.rejects(items.planItem('relative/path'), { code: 'credential-file-unreadable' });
  assert.equal(store.profiles.length, 0);
});

test('an item that changed after it was inspected is not acted on', async (t) => {
  const { root, store, items, defaults } = harness(t);
  const file = path.join(root, 'loose', '.credentials.yaml');
  write(file, 'version: 1\nrefs: {}\n');
  assert.equal((await items.planItem(file)).action, 'copy');
  // Before the user confirms the copy, the same home becomes a default home.
  defaults.push({ appId: 'dsh-cli', sessionRoot: path.dirname(file) });
  await assert.rejects(items.executeItem(file, 'copy'), { code: 'location-changed' });
  assert.equal(store.profiles.length, 0);
});
