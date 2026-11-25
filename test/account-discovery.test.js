const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const discovery = require('../src/account-discovery');
const { createLocationRegistrar } = require('../src/main/profile-registration');
const { createRecruitHandlers } = require('../src/main/recruit-discovery');
const { PathSelectionRegistry } = require('../src/main/ipc/path-selections');
const { discoverLocalProfileLocations } = require('../src/automation/local-locations');
const { makeTempDir } = require('./helpers/temp');

const SECRET = 'sentinel-discovery-secret-7f3a';

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.${SECRET}`;
}

function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

// A home folder with all seven registered clients at default and custom
// places, plus folders the walk must not enter.
function fixture(t) {
  const root = fs.realpathSync.native(makeTempDir('agentdesk-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const support = path.join(root, 'support');
  const codexAuth = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      id_token: jwt({ email: 'work@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }),
      access_token: SECRET, refresh_token: SECRET
    }
  });
  write(path.join(home, '.codex', 'auth.json'), codexAuth);
  write(path.join(home, '.codex', 'sessions', '2026', '11', '24', 'rollout-a.jsonl'), '');
  write(path.join(home, '.claude', 'settings.json'), '{}');
  mkdir(path.join(home, '.claude', 'projects'));
  write(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com', accessToken: SECRET } }));
  write(path.join(home, '.kimi-code', 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: SECRET }));
  write(path.join(home, '.dsh', '.credentials.yaml'), `refs:\n  DEEPSEEK_API_KEY: ${SECRET}\n`);
  write(path.join(home, '.kimi', 'config.json'), '{}');
  // Custom homes found by the bounded walk.
  write(path.join(home, 'work', 'codex-b', 'config.toml'), 'model = "x"\n');
  mkdir(path.join(home, 'work', 'codex-b', 'sessions', '2026'));
  write(path.join(home, 'work', 'kimi-b', 'config.toml'), '');
  write(path.join(home, 'work', 'kimi-b', 'sessions', 'abc', 'state.json'), '{}');
  write(path.join(home, 'tools', 'claude-b', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'b@example.com' } }));
  write(path.join(home, 'a', 'b', 'c', 'dsh-deep', '.credentials.yaml'), 'refs: {}\n');
  write(path.join(home, 'a', 'b', 'c', 'd', 'too-deep', '.credentials.yaml'), 'refs: {}\n');
  write(path.join(home, 'profiles', 'cursor-b', 'User', 'globalStorage', 'state.vscdb'), '');
  // Not a Codex home: an auth.json of another shape (for example OpenCode).
  write(path.join(home, '.local', 'share', 'opencode', 'auth.json'), JSON.stringify({ anthropic: { type: 'api', key: SECRET } }));
  // Skipped folders: privacy-prompt folders, packages, generated folders.
  write(path.join(home, 'Documents', 'codex-hidden', 'auth.json'), codexAuth);
  write(path.join(home, 'node_modules', 'x', '.claude.json'), '{}');
  write(path.join(home, 'OneDrive - Org', 'c', '.credentials.yaml'), '');
  // A symbolic link loop must not be followed.
  fs.symlinkSync(home, path.join(home, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  // Desktop clients: default data directories.
  write(path.join(support, 'Claude', 'Local State'), '{}');
  mkdir(path.join(support, 'Claude', 'claude-code-sessions'));
  write(path.join(support, 'Cursor', 'User', 'globalStorage', 'state.vscdb'), '');
  mkdir(path.join(support, 'kimi-desktop', 'daimon-share', 'daimon'));
  const desktopDefaults = {
    claude: path.join(support, 'Claude'),
    cursor: path.join(support, 'Cursor'),
    'kimi-work': path.join(support, 'kimi-desktop'),
    kimi: path.join(support, 'Kimi')
  };
  const envCodex = path.join(root, 'env-codex');
  write(path.join(envCodex, '.codex-global-state.json'), '{}');
  return { root, home, support, desktopDefaults, env: { CODEX_HOME: envCodex }, envCodex };
}

const rel = (base, location) => path.relative(base, location.kind === 'desktop' ? location.profilePath : location.sessionRoot);

test('discovery finds all seven registered clients across default, environment and home-scan layers', async (t) => {
  const f = fixture(t);
  const result = await discovery.discoverLocations({ deep: true, home: f.home, env: f.env, desktopDefaults: f.desktopDefaults });
  const byApp = new Set(result.locations.map((location) => location.appId));
  assert.deepEqual([...byApp].sort(), ['claude', 'claude-cli', 'codex', 'cursor', 'dsh-cli', 'kimi', 'kimi-work', 'opencode']);
  // OpenCode's legacy auth.json is OpenCode's, never mistaken for a Codex home.
  assert.equal(result.locations.find((location) => location.appId === 'opencode').source, 'default');
  assert.equal(result.locations.some((location) => location.appId === 'codex' && /opencode/.test(location.sessionRoot)), false);
  const found = result.locations.map((location) => `${location.appId}:${location.source}:${rel(f.root, location)}`);
  for (const expected of [
    'codex:default:home/.codex', 'codex:environment:env-codex', 'claude-cli:default:home/.claude',
    'kimi:default:home/.kimi-code', 'dsh-cli:default:home/.dsh', 'claude:default:support/Claude',
    'cursor:default:support/Cursor', 'kimi-work:default:support/kimi-desktop',
    'codex:home-scan:home/work/codex-b', 'kimi:home-scan:home/work/kimi-b',
    'claude-cli:home-scan:home/tools/claude-b', 'dsh-cli:home-scan:home/a/b/c/dsh-deep',
    'cursor:home-scan:home/profiles/cursor-b'
  ]) assert.ok(found.includes(expected), `${expected} missing from ${found.join(', ')}`);
  // Never deeper than four levels, never inside skipped folders, never twice.
  assert.equal(found.some((item) => /too-deep|Documents|node_modules|OneDrive|loop/.test(item)), false);
  assert.equal(new Set(found.map((item) => item.split(':').slice(0, 1).concat(item.split(':').slice(2)).join(':'))).size, found.length);
  assert.deepEqual(result.hints.map((hint) => [hint.appId, hint.kind]), [['kimi', 'legacy-home']]);
  assert.equal(result.truncated, false);
  // Kimi Work's data directory gives the daimon session root.
  const kimiWork = result.locations.find((location) => location.appId === 'kimi-work');
  assert.equal(kimiWork.sessionRoot, path.join(f.support, 'kimi-desktop', 'daimon-share', 'daimon'));
  assert.equal(kimiWork.isDefault, true);
});

test('Codex and Kimi Code homes that share config.toml + sessions/ are told apart by the sessions layout', (t) => {
  const f = fixture(t);
  for (const [folder, appId] of [['codex-b', 'codex'], ['kimi-b', 'kimi']]) {
    const directory = path.join(f.home, 'work', folder);
    const { entries } = discovery.listDirectorySync(directory);
    assert.equal(discovery.recognize(directory, entries).appId, appId);
  }
  const unclear = path.join(f.root, 'unclear');
  write(path.join(unclear, 'config.toml'), '');
  mkdir(path.join(unclear, 'sessions'));
  assert.deepEqual(discovery.recognize(unclear, discovery.listDirectorySync(unclear).entries).ambiguous.sort(), ['codex', 'kimi']);
});

test('the walk stops at limits, on cancellation and never follows links', async (t) => {
  const f = fixture(t);
  const limited = await discovery.scanTree(f.home, { home: f.home, atHome: true, limits: { maxDirectories: 3 } });
  assert.equal(limited.truncated, true);
  assert.equal(limited.stopReason, 'directories');
  assert.ok(limited.visitedDirectories <= 3);
  const controller = new AbortController();
  controller.abort();
  const canceled = await discovery.scanTree(f.home, { home: f.home, atHome: true, signal: controller.signal });
  assert.equal(canceled.stopReason, 'canceled');
  assert.deepEqual(canceled.found, []);
  let clock = 0;
  const timed = await discovery.scanTree(f.home, { home: f.home, atHome: true, now: () => (clock += 10_000), limits: { timeMs: 5000 } });
  assert.equal(timed.stopReason, 'time');
});

test('identity labels carry only an email or plan; no credential bytes leave the module', async (t) => {
  const f = fixture(t);
  const { locations } = await discovery.discoverLocations({ home: f.home, env: f.env, desktopDefaults: f.desktopDefaults });
  const described = await discovery.describeLocations(locations, { profiles: [], home: f.home });
  const codex = described.find((location) => location.appId === 'codex' && location.source === 'default');
  assert.deepEqual(codex.identity, { method: 'chatgpt', email: 'work@example.com', plan: 'pro' });
  assert.equal(codex.sessionCount, 1);
  const claude = described.find((location) => location.appId === 'claude-cli');
  assert.deepEqual(claude.identity, { method: 'subscription', email: 'me@example.com', plan: null });
  assert.equal(JSON.stringify(described).includes(SECRET), false);
});

function registrar(t, profiles = []) {
  const store = { profiles: profiles.slice(), saves: 0 };
  let sequence = 0;
  const instance = createLocationRegistrar({
    loadProfiles: () => store.profiles.map((profile) => ({ ...profile })),
    saveProfiles: (next) => { store.saves += 1; store.profiles = next.map((profile) => ({ ...profile })); },
    buildProfile: (_profiles, input, options) => ({
      id: `p${++sequence}`, appId: input.appId, name: input.name || input.appId,
      profilePath: options.externalLocation.profilePath || `/managed/${sequence}`,
      sessionRoot: options.externalLocation.sessionRoot, isProtected: options.externalLocation.isDefault
    }),
    defaultProfilePath: (appId) => ({ claude: '/nonexistent/Claude', cursor: '/nonexistent/Cursor' }[appId] || `/nonexistent/${appId}`),
    home: t.home
  });
  return { store, ...instance };
}

test('batch registration saves once, is idempotent and reports per-location failures', (t) => {
  const f = fixture(t);
  t.home = f.home;
  const { store, registerLocations } = registrar(t);
  const inputs = [
    { appId: 'claude-cli', sessionRoot: path.join(f.home, '.claude') },
    { appId: 'codex', sessionRoot: path.join(f.home, 'work', 'codex-b') },
    { appId: 'dsh-cli', sessionRoot: path.join(f.home, '.dsh') },
    { appId: 'claude-cli', sessionRoot: path.join(f.home, '.claude') },
    { appId: 'kimi-work', sessionRoot: path.join(f.support, 'kimi-desktop', 'daimon-share', 'daimon'), profilePath: path.join(f.support, 'kimi-desktop') },
    { appId: 'codex', sessionRoot: path.join(f.root, 'missing') }
  ];
  const first = registerLocations(inputs);
  assert.equal(store.saves, 1);
  assert.equal(store.profiles.length, 3);
  assert.deepEqual(first.map((item) => item.ok), [true, true, true, true, false, false]);
  assert.equal(first[3].existing, true);
  assert.equal(first[3].profileId, first[0].profileId);
  assert.equal(first[4].reasonCode, 'client-default-only');
  assert.equal(first[5].reasonCode, 'client-directory-invalid');
  const second = registerLocations(inputs.slice(0, 3));
  assert.equal(store.saves, 1, 'a repeat batch writes nothing');
  assert.deepEqual(second.map((item) => item.existing), [true, true, true]);
  // The CLI home is its own Profile root; Codex keeps a separate desktop directory.
  assert.equal(store.profiles[0].profilePath, fs.realpathSync.native(path.join(f.home, '.claude')));
  assert.match(store.profiles[1].profilePath, /^\/managed\//);
});

test('recruit IPC hands out selection IDs only, re-checks locations and registers a batch', async (t) => {
  const f = fixture(t);
  t.home = f.home;
  const { store, registerLocations } = registrar(t);
  const selections = new PathSelectionRegistry({ maxEntries: 256 });
  const handlers = createRecruitHandlers({
    selections, registerLocations, loadProfiles: () => store.profiles,
    pickDirectory: async () => path.join(f.home, 'work'),
    env: f.env, home: f.home,
    discovery: {
      ...discovery,
      discoverLocations: (options) => discovery.discoverLocations({ ...options, desktopDefaults: f.desktopDefaults })
    }
  });
  const scanned = await handlers.discover({ deep: true });
  assert.equal(scanned.ok, true);
  assert.ok(scanned.locations.length >= 13);
  for (const location of scanned.locations) {
    assert.deepEqual(Object.keys(location).sort(), ['appId', 'displayPath', 'identity', 'isDefault', 'registeredProfileId', 'selectionId', 'sessionCount', 'shortPath', 'source']);
  }
  assert.equal(JSON.stringify(scanned).includes(SECRET), false);
  const pick = (appId, source) => scanned.locations.find((item) => item.appId === appId && item.source === source).selectionId;
  const chosen = [pick('claude-cli', 'default'), pick('kimi', 'home-scan'), pick('cursor', 'home-scan')];
  // The folder changed since the scan: the Kimi home is no longer recognisable.
  fs.rmSync(path.join(f.home, 'work', 'kimi-b', 'sessions'), { recursive: true });
  const result = handlers.register({ selectionIds: [...chosen, 'forged-id'] });
  assert.equal(result.added, 2);
  assert.deepEqual(result.results.map((item) => item.reasonCode || 'ok'), ['ok', 'location-changed', 'ok', 'path-selection-expired']);
  // Selections are single use.
  assert.equal(handlers.register({ selectionIds: [chosen[0]] }).results[0].reasonCode, 'path-selection-expired');
  const again = await handlers.discover({ deep: true });
  const claude = again.locations.find((item) => item.appId === 'claude-cli' && item.source === 'default');
  assert.equal(claude.registeredProfileId, store.profiles[0].id);
  const folder = await handlers.discoverFolder();
  assert.equal(folder.folderRecognized, true);
  assert.deepEqual(folder.locations.map((item) => item.source), ['picked']);
});

test('the packaged CLI discover command reports every client from the same module', async (t) => {
  const f = fixture(t);
  const userData = path.join(f.root, 'AgentDesk');
  write(path.join(userData, 'profiles.json'), JSON.stringify({ version: 2, profiles: [{ id: 'known', appId: 'dsh-cli', sessionRoot: path.join(f.home, '.dsh'), profilePath: path.join(f.home, '.dsh') }] }));
  const result = await discoverLocalProfileLocations({ scan: 'home' }, { userData, env: f.env, home: f.home });
  assert.ok(new Set(result.locations.map((item) => item.appId)).size >= 5);
  const dsh = result.locations.find((item) => item.appId === 'dsh-cli' && item.source === 'default');
  assert.equal(dsh.registeredProfileId, 'known');
  assert.equal(dsh.registerArguments, null);
  const codex = result.locations.find((item) => item.appId === 'codex' && item.source === 'home-scan');
  assert.deepEqual(codex.registerArguments.slice(0, 4), ['profiles', 'register', '--app', 'codex']);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  await assert.rejects(discoverLocalProfileLocations({ scan: 'everything' }, { userData }), { code: 'invalid-arguments' });
  await assert.rejects(discoverLocalProfileLocations({ folder: 'relative/path' }, { userData }), { code: 'discovery-folder-invalid' });
  const folder = await discoverLocalProfileLocations({ folder: path.join(f.home, 'work') }, { userData, env: {}, home: f.home });
  assert.ok(folder.locations.some((item) => item.source === 'picked' && item.appId === 'kimi'));
});
