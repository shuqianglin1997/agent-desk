// Catshelf — Antigravity adapter (src/clients/antigravity/): the session
// scanner on fake SQLite data built with the real table structure
// (conversation_summaries.db of Antigravity 2.34.0, structure only), the
// "running" flag, empty and broken stores, discovery that never mixes up
// Antigravity's folders with Gemini CLI's, one-account-only registration and
// the copied locator. The scanner tests need the sqlite3 program and are
// skipped without it, like the Cursor and Kimi Work tests.
process.env.TZ = 'UTC';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const apps = require('../src/apps');
const discovery = require('../src/account-discovery');
const sessions = require('../src/clients/antigravity/sessions');
const SessionLocation = require('../src/session-location');
const { probeActivities } = require('../src/activity');
const { unsupportedReason } = require('../src/hub/adapters');
const { macLaunchServicesArgs } = require('../src/mac-launch');
const { createLocationRegistrar } = require('../src/main/profile-registration');
const { createRecruitHandlers } = require('../src/main/recruit-discovery');
const { PathSelectionRegistry } = require('../src/main/ipc/path-selections');
const { makeTempDir } = require('./helpers/temp');

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3';
}
const haveSqlite3 = (() => { try { execFileSync(sqlite3Bin(), ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const needsSqlite = { skip: !haveSqlite3 && 'sqlite3 command not available' };

const NOW = Date.parse('2026-11-26T12:00:00.000Z');
// Go writes times as text; these are the shapes the scanner accepts.
const goTime = (minutesBefore) => new Date(NOW - minutesBefore * 60000).toISOString().replace('T', ' ').replace('Z', '+00:00');

// The tables of conversation_summaries.db as Antigravity 2.34.0 creates them.
const SCHEMA = `
CREATE TABLE \`conversation_summaries\` (\`conversation_id\` text,\`title\` text NOT NULL DEFAULT "",\`preview\` text NOT NULL DEFAULT "",\`step_count\` integer NOT NULL DEFAULT 0,\`last_modified_time\` datetime NOT NULL,\`workspace_uris\` text NOT NULL,\`status\` text NOT NULL DEFAULT "",\`source\` text NOT NULL DEFAULT "",\`project_id\` text NOT NULL DEFAULT "",\`agent_name\` text NOT NULL DEFAULT "",\`parent_conversation_id\` text NOT NULL DEFAULT "",\`nesting_depth\` integer NOT NULL DEFAULT 0,\`battle_id\` text NOT NULL DEFAULT "",\`winning_conversation_id\` text NOT NULL DEFAULT "",\`not_fully_idle\` numeric NOT NULL DEFAULT false,\`killed\` numeric NOT NULL DEFAULT false,\`last_user_input_time\` datetime NOT NULL,\`last_user_input_step_index\` integer NOT NULL DEFAULT -1,\`app_data_dir\` text NOT NULL DEFAULT "",\`raw_summary\` blob,\`group_id\` text NOT NULL DEFAULT "",PRIMARY KEY (\`conversation_id\`));
CREATE INDEX \`idx_conversation_summaries_last_user_input_time\` ON \`conversation_summaries\`(\`last_user_input_time\`);
CREATE INDEX \`idx_conversation_summaries_last_modified_time\` ON \`conversation_summaries\`(\`last_modified_time\`);
CREATE TABLE search_schema_version (version INTEGER PRIMARY KEY);
CREATE TABLE conversation_parents (conversation_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL) WITHOUT ROWID;
`;
// The full-text index next to it; the scanner never reads it.
const FTS = `CREATE VIRTUAL TABLE conversations_fts USING fts5(conversation_id UNINDEXED, chunk_index UNINDEXED, chunk_first_step UNINDEXED, chunk_last_step UNINDEXED, last_modified_time UNINDEXED, step_count UNINDEXED, last_step_created_at UNINDEXED, archived UNINDEXED, user_step_byte_offsets UNINDEXED, agent_step_byte_offsets UNINDEXED, title, workspace, project, user_body, agent_body, tokenize = 'unicode61 remove_diacritics 2', prefix = '1 2 3');`;

const quote = (value) => (value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`);
function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT INTO ${table} (${columns.map((name) => `\`${name}\``).join(', ')}) VALUES (${columns.map((name) => quote(row[name])).join(', ')});`;
}
function summary(row) {
  return insert('conversation_summaries', { workspace_uris: '', last_user_input_time: '0001-01-01 00:00:00+00:00', ...row });
}

function sql(db, text) {
  execFileSync(sqlite3Bin(), [db], { input: text, stdio: ['pipe', 'ignore', 'pipe'] });
}

// A Catshelf Profile for the official location: sessionRoot is
// <home>/.gemini/antigravity, the Electron data folder sits elsewhere.
function antigravityHome(t, rows = [], extra = '') {
  const root = makeTempDir(t, 'agentdesk-antigravity-');
  const sessionRoot = path.join(root, 'home', '.gemini', 'antigravity');
  fs.mkdirSync(sessionRoot, { recursive: true });
  const db = path.join(sessionRoot, sessions.DB_NAME);
  sql(db, SCHEMA);
  try { sql(db, FTS); } catch (_error) { /* this sqlite3 has no FTS5; the scanner never uses it */ }
  if (rows.length || extra) sql(db, [...rows, extra].join('\n'));
  const profile = { id: 'ag-1', appId: 'antigravity', name: 'Antigravity', profilePath: path.join(root, 'support', 'Antigravity'), sessionRoot, isProtected: true, profilePathMode: 'auto' };
  return { root, sessionRoot, db, profile };
}

function project(root, name) {
  const folder = path.join(root, 'work', name);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

test('the scanner lists only the user\'s own conversations, with titles, projects and times', needsSqlite, (t) => {
  const base = makeTempDir(t, 'agentdesk-antigravity-work-');
  const proj = project(base, 'shop');
  const other = project(base, 'other');
  const f = antigravityHome(t, [
    summary({ conversation_id: 'root-1', title: 'Refactor login', preview: 'please refactor', workspace_uris: JSON.stringify([pathToFileURL(proj).href, pathToFileURL(other).href, 'vscode-remote://ssh-remote+box/srv']), last_modified_time: goTime(1), last_user_input_time: goTime(2), not_fully_idle: 1, killed: 0 }),
    summary({ conversation_id: 'root-2', title: '', preview: 'Fix the parser\nsecond line', last_modified_time: goTime(180), last_user_input_time: goTime(10), not_fully_idle: 1, killed: 1 }),
    summary({ conversation_id: 'root-3', title: '', preview: '', status: 'ARCHIVED', last_modified_time: `${new Date(NOW - 3000 * 60000).toISOString().replace('T', ' ').slice(0, 23)} +0000 UTC m=+0.001`, last_user_input_time: '0001-01-01 00:00:00+00:00' }),
    summary({ conversation_id: '../evil', title: 'Odd id', last_modified_time: goTime(400) }),
    // Sub-conversations: a parent, a nesting depth, or a row in conversation_parents.
    summary({ conversation_id: 'child-parent', title: 'Sub task', parent_conversation_id: 'root-1', last_modified_time: goTime(0), not_fully_idle: 1 }),
    summary({ conversation_id: 'child-depth', title: 'Nested', nesting_depth: 1, last_modified_time: goTime(0), not_fully_idle: 1 }),
    summary({ conversation_id: 'child-table', title: 'Listed child', last_modified_time: goTime(0), not_fully_idle: 1 }),
    insert('conversation_parents', { conversation_id: 'child-table', parent_id: 'root-1' })
  ]);
  // root-1 has an artifact folder, root-2 only its record; root-3 has neither.
  fs.mkdirSync(path.join(f.sessionRoot, 'brain', 'root-1'), { recursive: true });
  fs.mkdirSync(path.join(f.sessionRoot, 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(f.sessionRoot, 'conversations', 'root-2.pb'), Buffer.from([0x0a, 0x00]));

  const rows = apps.getApp('antigravity').scan(f.profile);
  assert.deepEqual(rows.map((row) => row.id), ['root-1', 'root-2', '../evil', 'root-3']);
  const [one, two, evil, three] = rows;
  assert.equal(one.title, 'Refactor login');
  assert.equal(one.projectPath, path.normalize(proj), 'the first local workspace folder; remote ones are skipped');
  assert.equal(one.updatedAt, new Date(NOW - 60000).toISOString(), 'the later of the two times');
  assert.equal(one.filePath, path.join(f.sessionRoot, 'brain', 'root-1'));
  assert.equal(two.title, 'Fix the parser', 'no title: the first line of the preview');
  assert.equal(two.updatedAt, new Date(NOW - 600000).toISOString(), 'the last user input is later than the last change');
  assert.equal(two.projectPath, null);
  assert.equal(two.filePath, path.join(f.sessionRoot, 'conversations', 'root-2.pb'));
  assert.equal(two.status, '可用', 'a killed run stays listed');
  assert.equal(three.title, 'Antigravity 会话 root-3');
  assert.equal(three.status, '已归档');
  assert.equal(three.updatedAt, new Date(NOW - 3000 * 60000).toISOString(), 'Go zero time is ignored');
  assert.equal(three.filePath, f.db);
  assert.equal(evil.filePath, f.db, 'an id that is not a plain file name is never joined into a path');
  for (const row of rows) {
    assert.deepEqual([row.appId, row.address, row.createdAt, row.model, row.source], ['antigravity', row.id, null, null, 'Antigravity']);
  }

  // Copy session info: the project folder and the conversation's own place + its ID.
  assert.equal(SessionLocation.format(one, { path: '路径', coordinate: '坐标' }),
    `路径: ${path.normalize(proj)}\n坐标: ${path.join(f.sessionRoot, 'brain', 'root-1')}#root-1`);
  assert.equal(SessionLocation.format(two, { path: 'Path', coordinate: 'Coordinate' }),
    `Path: ${path.join(f.sessionRoot, 'conversations', 'root-2.pb')}\nCoordinate: ${path.join(f.sessionRoot, 'conversations', 'root-2.pb')}#root-2`);
});

test('running follows not_fully_idle on the user\'s conversations, as for every client', needsSqlite, (t) => {
  const f = antigravityHome(t, [
    summary({ conversation_id: 'busy', title: 'Busy', last_modified_time: goTime(1), not_fully_idle: 1, killed: 0 }),
    summary({ conversation_id: 'killed', title: 'Stopped', last_modified_time: goTime(1), not_fully_idle: 1, killed: 1 }),
    summary({ conversation_id: 'idle', title: 'Idle', last_modified_time: goTime(30), not_fully_idle: 0 }),
    summary({ conversation_id: 'archived', title: 'Old', status: 'archived', last_modified_time: goTime(2), not_fully_idle: 1 }),
    summary({ conversation_id: 'sub', title: 'Sub', parent_conversation_id: 'busy', last_modified_time: goTime(0), not_fully_idle: 1 })
  ]);
  const counts = apps.getApp('antigravity').sessionCounts(f.profile, NOW);
  assert.deepEqual(counts, { sessionCount: 4, activeNow: 2, activeToday: 4, writingNow: 1, writingAddresses: ['busy'] });
  assert.equal(apps.getApp('antigravity').contentActivityAt(f.profile), NOW - 60000);
  // Through the activity probe: the card's count and the list's "running" marks.
  const [activity] = probeActivities([f.profile], NOW, null);
  assert.equal(activity.writingNow, 1);
  assert.deepEqual(activity.writingKeys, ['ag-1::busy']);
  assert.equal(activity.sessionCount, 4);
  assert.equal(activity.contentActiveAt, NOW - 60000);
});

test('a missing database or an empty table means no conversations', needsSqlite, (t) => {
  const empty = antigravityHome(t);
  assert.deepEqual(apps.scanResult(empty.profile), { ok: true, value: [], truncated: false });
  assert.deepEqual(apps.getApp('antigravity').sessionCounts(empty.profile, NOW), { sessionCount: 0, activeNow: 0, activeToday: 0, writingNow: 0, writingAddresses: [] });
  assert.equal(apps.getApp('antigravity').contentActivityAt(empty.profile), null);
  const missing = antigravityHome(t);
  fs.rmSync(missing.db);
  assert.deepEqual(apps.getApp('antigravity').scan(missing.profile), []);
  assert.equal(probeActivities([missing.profile], NOW, null)[0].writingNow, 0);
});

test('a broken or unknown store is a fixed failure, never an empty list or a crash', needsSqlite, (t) => {
  const unreadable = { ok: false, code: 'session-store-unreadable' };
  // Not a database at all.
  const garbage = antigravityHome(t);
  fs.writeFileSync(garbage.db, 'this is not a database');
  assert.deepEqual({ ...apps.scanResult(garbage.profile) }, unreadable);
  // A database without the table (another version).
  const noTable = antigravityHome(t);
  fs.rmSync(noTable.db);
  sql(noTable.db, 'CREATE TABLE something_else (x TEXT);');
  assert.deepEqual({ ...apps.scanResult(noTable.profile) }, unreadable);
  // The table without the columns the scanner needs.
  const noColumns = antigravityHome(t);
  fs.rmSync(noColumns.db);
  sql(noColumns.db, 'CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT);');
  assert.deepEqual({ ...apps.scanResult(noColumns.profile) }, unreadable);
  // The activity probe says "unknown" instead of throwing.
  const [activity] = probeActivities([noColumns.profile], NOW, null);
  assert.equal(activity.writingNow, null);
  assert.deepEqual(activity.writingKeys, []);
});

test('an older or newer table with fewer columns still lists conversations', needsSqlite, (t) => {
  const f = antigravityHome(t);
  fs.rmSync(f.db);
  sql(f.db, [
    'CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, last_modified_time DATETIME);',
    insert('conversation_summaries', { conversation_id: 'a', title: 'Only three columns', last_modified_time: new Date(NOW - 5 * 60000).toISOString() })
  ].join('\n'));
  const [row] = apps.getApp('antigravity').scan(f.profile);
  assert.deepEqual([row.id, row.title, row.updatedAt, row.projectPath], ['a', 'Only three columns', new Date(NOW - 300000).toISOString(), null]);
  assert.equal(apps.getApp('antigravity').sessionCounts(f.profile, NOW).writingNow, 0);
});

test('time and workspace values are read defensively', () => {
  assert.equal(sessions.parseTime('2026-11-26 08:32:01.123456789+08:00'), '2026-11-26T00:32:01.123Z');
  assert.equal(sessions.parseTime('2026-11-26 08:32:01.5 +0800 CST m=+0.000123'), '2026-11-26T00:32:01.500Z');
  assert.equal(sessions.parseTime('2026-11-26T00:00:00Z'), '2026-11-26T00:00:00.000Z');
  assert.equal(sessions.parseTime(1764158400000), '2025-11-26T12:00:00.000Z');
  for (const value of ['0001-01-01 00:00:00+00:00', 'garbage', '', null, undefined, {}, 1e30]) assert.equal(sessions.parseTime(value), null);
  const folder = path.join(path.parse(process.cwd()).root, 'work', 'a b');
  assert.deepEqual(sessions.workspacePaths(JSON.stringify([pathToFileURL(folder).href])), [path.normalize(folder)]);
  assert.deepEqual(sessions.workspacePaths(JSON.stringify([{ uri: pathToFileURL(folder).href }])), [path.normalize(folder)]);
  assert.deepEqual(sessions.workspacePaths(pathToFileURL(folder).href), [path.normalize(folder)]);
  assert.deepEqual(sessions.workspacePaths('vscode-remote://ssh-remote+box/srv\nrelative/path'), []);
  assert.deepEqual(sessions.workspacePaths('{not json'), []);
});

// A home folder with Antigravity's two folders under ~/.gemini, and the
// Electron data folder in the support folder, without Gemini CLI.
function antigravityOnly(t) {
  const root = fs.realpathSync.native(makeTempDir(t, 'agentdesk-antigravity-find-'));
  const home = path.join(root, 'home');
  const support = path.join(root, 'support');
  const write = (file, body = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const agent = path.join(home, '.gemini', 'antigravity');
  write(path.join(agent, 'installation_id'), '00000000-0000-4000-8000-000000000000');
  write(path.join(agent, sessions.DB_NAME));
  write(path.join(agent, 'antigravity_state.pbtxt'));
  write(path.join(agent, 'bin', 'agentapi'));
  for (const name of ['conversations', 'brain', 'daemon', 'builtin']) fs.mkdirSync(path.join(agent, name), { recursive: true });
  const config = path.join(home, '.gemini', 'config');
  write(path.join(config, 'config.json'), '{}');
  write(path.join(config, 'mcp_config.json'));
  for (const name of ['projects', 'plugins', 'sidecars']) fs.mkdirSync(path.join(config, name), { recursive: true });
  const data = path.join(support, 'Antigravity');
  write(path.join(data, 'Local State'), '{}');
  write(path.join(data, 'app_storage.json'), '{}');
  fs.mkdirSync(path.join(data, 'Partitions'), { recursive: true });
  // Every desktop client's official folder points into the fixture.
  const desktopDefaults = Object.fromEntries(apps.appIds().filter((id) => apps.getApp(id).discovery?.kind === 'desktop')
    .map((id) => [id, path.join(support, id === 'antigravity' ? 'Antigravity' : `none-${id}`)]));
  return { root, home, support, agent, config, data, desktopDefaults, write };
}

test('Antigravity\'s folders under ~/.gemini are never taken for a Gemini CLI account', async (t) => {
  const f = antigravityOnly(t);
  const found = await discovery.discoverLocations({ deep: true, home: f.home, env: {}, desktopDefaults: f.desktopDefaults });
  assert.deepEqual(found.locations.map((item) => [item.appId, item.source, item.isDefault]), [['antigravity', 'default', true]]);
  assert.deepEqual([found.locations[0].profilePath, found.locations[0].sessionRoot], [f.data, path.join(f.home, '.gemini', 'antigravity')]);
  for (const folder of [path.join(f.home, '.gemini'), f.agent, f.config]) {
    assert.equal(discovery.recognize(folder, discovery.listDirectorySync(folder).entries, { homeScan: true }), null, folder);
  }
  // Even if a later Antigravity writes a settings.json next to its installation_id.
  f.write(path.join(f.agent, 'settings.json'), '{}');
  assert.equal(discovery.recognize(f.agent, discovery.listDirectorySync(f.agent).entries), null);
  assert.equal((await discovery.discoverLocations({ appId: 'gemini-cli', deep: true, home: f.home, env: {} })).locations.length, 0);
});

test('a Gemini CLI home is never taken for an Antigravity account', async (t) => {
  const f = antigravityOnly(t);
  fs.rmSync(f.agent, { recursive: true });
  f.write(path.join(f.home, '.gemini', 'google_accounts.json'), JSON.stringify({ active: 'me@example.com' }));
  f.write(path.join(f.home, '.gemini', 'settings.json'), '{}');
  fs.mkdirSync(path.join(f.home, '.gemini', 'tmp', 'p', 'chats'), { recursive: true });
  const found = await discovery.discoverLocations({ deep: true, home: f.home, env: {}, desktopDefaults: f.desktopDefaults });
  assert.deepEqual(found.locations.map((item) => [item.appId, item.sessionRoot]), [['gemini-cli', path.join(f.home, '.gemini')]]);
  // Antigravity is found only when both its data folder and its agent folder exist.
  const withoutData = { ...f.desktopDefaults, antigravity: path.join(f.support, 'missing') };
  fs.mkdirSync(f.agent, { recursive: true });
  assert.equal((await discovery.discoverLocations({ appId: 'antigravity', home: f.home, env: {}, desktopDefaults: withoutData })).locations.length, 0);
  // Both installed: two accounts, each in its own folder.
  const both = await discovery.discoverLocations({ deep: true, home: f.home, env: {}, desktopDefaults: f.desktopDefaults });
  assert.deepEqual(both.locations.map((item) => [item.appId, item.sessionRoot]).sort(), [
    ['antigravity', path.join(f.home, '.gemini', 'antigravity')], ['gemini-cli', path.join(f.home, '.gemini')]
  ]);
});

function registrar(f) {
  const store = { profiles: [], saves: 0 };
  let sequence = 0;
  const instance = createLocationRegistrar({
    loadProfiles: () => store.profiles.map((profile) => ({ ...profile })),
    saveProfiles: (next) => { store.saves += 1; store.profiles = next.map((profile) => ({ ...profile })); },
    buildProfile: (_profiles, input, options) => ({
      id: `p${++sequence}`, appId: input.appId, name: input.name || input.appId,
      profilePath: options.externalLocation.profilePath, sessionRoot: options.externalLocation.sessionRoot,
      isProtected: options.externalLocation.isDefault
    }),
    defaultProfilePath: (appId) => f.desktopDefaults[appId] || path.join(f.support, `none-${appId}`),
    home: f.home
  });
  return { store, ...instance };
}

test('only the one account on this computer can be registered, from either recruit path', async (t) => {
  const f = antigravityOnly(t);
  const { store, registerLocations } = registrar(f);
  const selections = new PathSelectionRegistry({ maxEntries: 256 });
  const handlers = createRecruitHandlers({
    selections, registerLocations, loadProfiles: () => store.profiles, pickDirectory: async () => null, env: {}, home: f.home,
    discovery: { ...discovery, discoverLocations: (options) => discovery.discoverLocations({ ...options, desktopDefaults: f.desktopDefaults }) }
  });
  // "New account": registers the official location in place.
  const created = await handlers.registerDefault({ appId: 'antigravity', name: 'Work' });
  assert.deepEqual([created.ok, created.existing, created.onDesk], [true, false, true]);
  assert.deepEqual(store.profiles.map((profile) => [profile.appId, profile.name, profile.profilePath, profile.sessionRoot, profile.isProtected]),
    [['antigravity', 'Work', f.data, path.join(f.home, '.gemini', 'antigravity'), true]]);
  // Again, or through "bring existing ones back": the same account.
  assert.deepEqual([(await handlers.registerDefault({ appId: 'antigravity' })).existing, store.profiles.length], [true, 1]);
  const scanned = await handlers.discover({});
  const listed = scanned.locations.find((item) => item.appId === 'antigravity');
  assert.equal(listed.registeredProfileId, store.profiles[0].id);
  assert.equal(handlers.register({ selectionIds: [listed.selectionId] }).results[0].existing, true);
  // A second location cannot be made.
  const other = path.join(f.root, 'other-agent');
  fs.mkdirSync(other);
  assert.equal(registerLocations([{ appId: 'antigravity', sessionRoot: other, profilePath: f.data }])[0].reasonCode, 'client-default-only');
  // Not set up on this computer: a fixed reason, nothing registered.
  fs.rmSync(f.agent, { recursive: true });
  assert.deepEqual(await handlers.registerDefault({ appId: 'antigravity' }), { ok: false, reasonCode: 'client-default-missing' });
});

test('the adapter declares one account, honest gaps and a namespace of its own', () => {
  const [listed] = apps.listApps({ uiHints: true }).filter((item) => item.id === 'antigravity');
  assert.deepEqual([listed.defaultOnly, listed.supportsManagedProfiles, listed.canLaunch, listed.canExportTranscript, listed.taskPackageMode, listed.signIn.browser, listed.signIn.key, listed.signIn.provider],
    [true, false, true, false, 'unsupported', false, false, false]);
  assert.deepEqual(apps.clientFacts('antigravity'), { providerNamespace: 'antigravity', clientForm: 'desktop' });
  assert.notEqual(apps.clientFacts('antigravity').providerNamespace, apps.clientFacts('gemini-cli').providerNamespace);
  // Launch: the official location only, without a second copy of the app.
  assert.deepEqual(apps.profileLaunchPlan({ appId: 'antigravity', isProtected: true, profilePathMode: 'auto' }), { ok: true, isolated: false, args: [] });
  assert.equal(apps.profileLaunchPlan({ appId: 'antigravity', isProtected: false, profilePathMode: 'managed', profilePath: '/x' }).reasonCode, 'profile-isolation-unsupported');
  assert.deepEqual(macLaunchServicesArgs('/Applications/Antigravity.app', [], {}, {}, { newInstance: false }), ['-a', '/Applications/Antigravity.app', '--args']);
  assert.deepEqual(apps.macLauncherCandidates('antigravity', { applicationRoots: ['/Applications'] }).map((item) => [item.path, item.bundleIdentifiers]),
    [[path.join('/Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'), ['com.google.antigravity']]]);
  // The agent data follows the home folder, on every system.
  const home = path.join(path.parse(process.cwd()).root, 'Users', 'someone');
  assert.equal(apps.getApp('antigravity').defaultSessionRoot('/ignored', true, { home }), path.join(home, '.gemini', 'antigravity'));
  // What it cannot do says why, in all three languages.
  assert.equal(unsupportedReason('antigravity'), 'desktop-only-no-cli');
  const reason = apps.getApp('antigravity').quota.unsupportedReason;
  for (const lang of ['zh', 'en', 'ja']) {
    const table = require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang];
    for (const key of [reason, 'hub.dossier.desktopNoCli', 'recruit.method.default', 'recruit.method.default.hint', 'recruit.new.registerDefault', 'recruit.new.defaultDone', 'recruit.new.defaultExisting', 'recruit.error.client-default-missing']) {
      assert.ok(typeof table[key] === 'string' && table[key].trim(), `${lang} ${key}`);
    }
  }
  const hub = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'hub.js'), 'utf8');
  assert.match(hub, /'desktop-only-no-cli': 'hub\.dossier\.desktopNoCli'/);
});

test('"new account" for a one-account client goes to the default registration, never a new folder', async () => {
  const { runCommand, loadPreload } = require('./helpers/behaviour');
  const { accountResult } = require('../src/main/accounts');
  const calls = [];
  const deps = (reply) => ({
    apps,
    accountResult,
    quotaService: { invalidate: () => calls.push(['invalidate']) },
    createLocalAccount: () => { throw new Error('a new folder must not be made'); },
    createAccountWithSecret: () => { throw new Error('no key is handed over'); },
    recruitHandlers: { registerDefault: async (input) => { calls.push(['registerDefault', input.appId, input.name]); return reply; } }
  });
  const created = await runCommand('recruit:createAccount', deps({ ok: true, profileId: 'p1', existing: false, onDesk: true }), { appId: 'antigravity', name: 'Mine', signIn: 'default' });
  assert.deepEqual(created, { ok: true, profileId: 'p1', existing: false, onDesk: true, created: true, signIn: 'default' });
  assert.deepEqual(calls, [['registerDefault', 'antigravity', 'Mine'], ['invalidate']]);
  const missing = await runCommand('recruit:createAccount', deps({ ok: false, reasonCode: 'client-default-missing' }), { appId: 'antigravity', signIn: 'default' });
  assert.deepEqual(missing, { ok: false, reasonCode: 'client-default-missing' });
  // Only a one-account client takes this path.
  const refused = await runCommand('recruit:createAccount', deps({ ok: true }), { appId: 'codex', signIn: 'default' });
  assert.deepEqual(refused, { ok: false, reasonCode: 'credential-method-unsupported' });
  // The preload passes the method through and nothing else.
  const { api, calls: ipc } = loadPreload();
  await api.recruitCreateAccount({ appId: 'antigravity', name: 'Mine', signIn: 'default', path: '/etc' });
  assert.equal(ipc[0][1], 'recruit:createAccount');
  assert.equal(ipc[0][2].signIn, 'default');
  assert.equal(ipc[0][2].path, undefined);
});
