const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const apps = require('../src/apps');
const { scanOpenCode } = require('../src/clients/opencode/sessions');
const { scanGemini } = require('../src/clients/gemini-cli/sessions');
const { scanQwen } = require('../src/clients/qwen-code/sessions');
const discovery = require('../src/account-discovery');
const credentials = require('../src/account-credentials');
const credentialImport = require('../src/credential-import');
const { makeTempDir } = require('./helpers/temp');

const SECRET = 'sk-SENTINELbatch4key0123456789abcdef';
const posixOnly = { skip: process.platform === 'win32' ? 'shell stubs stand in for the official clients on POSIX' : false };

function tmp(t) {
  const root = fs.realpathSync.native(makeTempDir('agentdesk-cli-clients-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const lines = (...records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

test('OpenCode, Gemini CLI and Qwen Code are registered CLI clients with isolated homes', () => {
  for (const id of ['opencode', 'gemini-cli', 'qwen-code']) {
    const client = apps.getApp(id);
    assert.equal(client.noLaunch, true);
    assert.ok(client.cliDiscoveryId && client.maintenanceToolId);
    assert.equal(apps.listApps().find((item) => item.id === id).canLaunch, true);
  }
  const managed = (appId, profilePath) => ({
    appId, profilePath, sessionRoot: apps.getApp(appId).defaultSessionRoot(profilePath, false),
    profilePathMode: 'managed', sessionRootMode: 'managed'
  });
  // Each client clears the variables that would point it at another account.
  const inherited = { PATH: '/usr/bin', XDG_DATA_HOME: '/elsewhere', OPENCODE_CONFIG_DIR: '/x' };
  const inheritedGemini = { PATH: '/usr/bin', GEMINI_CLI_HOME: '/z', GEMINI_API_KEY: 'shell' };
  const inheritedQwen = { PATH: '/usr/bin', QWEN_HOME: '/y', OPENAI_API_KEY: 'shell' };
  const opencode = managed('opencode', '/P/oc');
  assert.equal(opencode.sessionRoot, '/P/oc/opencode-data/opencode');
  assert.deepEqual(apps.getApp('opencode').launchEnv(opencode, inherited), {
    PATH: '/usr/bin', XDG_DATA_HOME: '/P/oc/opencode-data', OPENCODE_CONFIG_DIR: '/P/oc/opencode-config', XDG_STATE_HOME: '/P/oc/opencode-state'
  });
  assert.deepEqual(apps.profileLaunchPlan(opencode).args, ['--standalone']);
  const gemini = managed('gemini-cli', '/P/gm');
  assert.equal(gemini.sessionRoot, '/P/gm/gemini-home/.gemini');
  assert.deepEqual(apps.getApp('gemini-cli').launchEnv(gemini, inheritedGemini), { PATH: '/usr/bin', GEMINI_CLI_HOME: '/P/gm/gemini-home', GEMINI_FORCE_FILE_STORAGE: 'true' });
  const qwen = managed('qwen-code', '/P/qw');
  assert.deepEqual(apps.getApp('qwen-code').launchEnv(qwen, inheritedQwen), { PATH: '/usr/bin', QWEN_HOME: '/P/qw/qwen-home' });
  // The official default homes keep the client's own defaults.
  const defaultGemini = { appId: 'gemini-cli', sessionRoot: path.join(os.homedir(), '.gemini'), profilePathMode: 'custom', sessionRootMode: 'custom' };
  assert.equal(apps.getApp('gemini-cli').launchEnv(defaultGemini, inheritedGemini).GEMINI_CLI_HOME, undefined);
});

test('OpenCode sessions come from opencode.db (v2 and v1 tables) and the legacy JSON store; child sessions stay hidden', (t) => {
  const root = path.join(tmp(t), 'opencode');
  fs.mkdirSync(root, { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(root, 'opencode.db'));
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT);
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT, version TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT NOT NULL, directory TEXT, time_created INTEGER, time_updated INTEGER);
    INSERT INTO project VALUES ('p1', '/work/app', 'app');
    INSERT INTO session_v2 VALUES ('ses_root1', 'p1', NULL, 'a', '/work/app/src', 'Fix login', '2', 1700000000000, 1700000500000, NULL);
    INSERT INTO session_v2 VALUES ('ses_child', 'p1', 'ses_root1', 'b', '/work/app', 'subagent', '2', 1700000100000, 1700000200000, NULL);
    INSERT INTO session_v2 VALUES ('ses_old', 'p1', NULL, 'c', '/work/app', NULL, '2', 1600000000000, 1600000000000, 1600000100000);
    INSERT INTO session VALUES ('ses_root1', 'p1', NULL, 'v1 copy', '/work/app', 1, 1);
    INSERT INTO session VALUES ('ses_v1only', 'p1', NULL, 'Only in v1', '/work/v1', 1650000000000, 1650000000000);`);
  db.close();
  write(path.join(root, 'storage', 'session', 'proj', 'ses_legacy.json'), JSON.stringify({ id: 'ses_legacy', title: 'Legacy', directory: '/work/legacy', time: { created: 1500000000000, updated: 1500000000000 } }));
  write(path.join(root, 'storage', 'session', 'proj', 'ses_legacy_child.json'), JSON.stringify({ id: 'ses_legacy_child', parentID: 'ses_legacy', title: 'x', time: { created: 1, updated: 1 } }));
  const sessions = scanOpenCode({ sessionRoot: root });
  assert.deepEqual(sessions.map((session) => session.id), ['ses_root1', 'ses_v1only', 'ses_old', 'ses_legacy']);
  const first = sessions[0];
  assert.equal(first.title, 'Fix login');
  assert.equal(first.projectPath, '/work/app');
  assert.equal(first.updatedAt, new Date(1700000500000).toISOString());
  assert.equal(sessions.find((session) => session.id === 'ses_old').status, '已归档');
  assert.match(sessions.find((session) => session.id === 'ses_old').title, /^OpenCode old/);
  assert.deepEqual(scanOpenCode({ sessionRoot: path.join(root, 'missing') }), []);
});

test('Gemini CLI sessions: JSONL with $set summaries, older JSON files, project paths; subagents stay hidden', (t) => {
  const root = path.join(tmp(t), '.gemini');
  write(path.join(root, 'projects.json'), JSON.stringify({ projects: { '/work/site': 'site' } }));
  const chats = path.join(root, 'tmp', 'site', 'chats');
  write(path.join(chats, 'session-2026-11-24T10-00-aaaa1111.jsonl'), lines(
    { sessionId: 'aaaa1111-0000', projectHash: 'h', startTime: '2026-11-24T10:00:00Z', lastUpdated: '2026-11-24T10:00:00Z', kind: 'main' },
    { id: 'm1', timestamp: '2026-11-24T10:01:00Z', type: 'user', content: [{ text: '/help' }] },
    { id: 'm2', timestamp: '2026-11-24T10:02:00Z', type: 'user', content: [{ text: 'Make the build faster' }] },
    { $set: { summary: 'Speed up the build', lastUpdated: '2026-11-24T10:05:00Z' } }
  ));
  write(path.join(chats, 'aaaa1111-0000', 'helper.jsonl'), lines({ sessionId: 'sub-1', kind: 'subagent' }));
  write(path.join(chats, 'session-2026-11-24T11-00-bbbb2222.jsonl'), lines({ sessionId: 'bbbb2222-0000', kind: 'subagent', startTime: '2026-11-24T11:00:00Z' }));
  write(path.join(root, 'tmp', 'other', '.project_root'), '/work/other\n');
  write(path.join(root, 'tmp', 'other', 'chats', 'session-old.json'), JSON.stringify({
    sessionId: 'cccc3333', startTime: '2026-01-01T00:00:00Z', lastUpdated: '2026-01-02T00:00:00Z', messages: [{ type: 'user', content: 'Old question' }]
  }));
  const sessions = scanGemini({ sessionRoot: root });
  assert.deepEqual(sessions.map((session) => [session.id, session.title, session.projectPath]), [
    ['aaaa1111-0000', 'Speed up the build', '/work/site'],
    ['cccc3333', 'Old question', '/work/other']
  ]);
  assert.equal(sessions[0].updatedAt, '2026-11-24T10:05:00.000Z');
});

test('Qwen Code sessions: custom titles, first prompts, archive; child sessions and sidechains stay out', (t) => {
  const root = tmp(t);
  const chats = path.join(root, 'projects', '-work-api', 'chats');
  write(path.join(chats, 'u1.jsonl'), lines(
    { uuid: '1', sessionId: 'u1', timestamp: '2026-11-20T09:00:00Z', type: 'user', cwd: '/work/api', message: { parts: [{ text: 'Add pagination' }] } },
    { uuid: '2', sessionId: 'u1', timestamp: '2026-11-20T09:01:00Z', type: 'user', isSidechain: true, message: { parts: [{ text: 'internal' }] } },
    { uuid: '3', sessionId: 'u1', timestamp: '2026-11-20T09:05:00Z', type: 'system', subtype: 'custom_title', systemPayload: { customTitle: 'Pagination work' } }
  ));
  write(path.join(chats, 'u2.jsonl'), lines(
    { uuid: '1', sessionId: 'u2', timestamp: '2026-11-21T09:00:00Z', type: 'user', cwd: '/work/api', systemPayload: { displayText: 'Review the schema' } }
  ));
  write(path.join(chats, 'child.jsonl'), lines(
    { uuid: '1', sessionId: 'child', timestamp: '2026-11-22T09:00:00Z', type: 'system', subtype: 'parent_session', systemPayload: { parentSessionId: 'u1' } }
  ));
  write(path.join(chats, 'archive', 'u0.jsonl'), lines(
    { uuid: '1', sessionId: 'u0', timestamp: '2026-10-01T09:00:00Z', type: 'user', cwd: '/work/api', message: { parts: [{ text: 'Old task' }] } }
  ));
  const sessions = scanQwen({ sessionRoot: root });
  assert.deepEqual(sessions.map((session) => [session.id, session.title, session.status]), [
    ['u2', 'Review the schema', '可用'], ['u1', 'Pagination work', '可用'], ['u0', 'Old task', '已归档']
  ]);
  assert.equal(sessions[1].projectPath, '/work/api');
});

test('discovery tells the three new homes apart from Claude Code and Codex, and reads the Gemini account email', async (t) => {
  const root = tmp(t);
  const home = path.join(root, 'home');
  write(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), '');
  write(path.join(home, '.gemini', 'google_accounts.json'), JSON.stringify({ active: 'me@gmail.example', old: [] }));
  write(path.join(home, '.gemini', 'settings.json'), '{}');
  write(path.join(home, '.qwen', 'settings.json'), '{}');
  fs.mkdirSync(path.join(home, '.qwen', 'projects', '-work', 'chats'), { recursive: true });
  // Claude Code also has settings.json + projects/, but its projects hold .jsonl files directly.
  write(path.join(home, '.claude', 'settings.json'), '{}');
  write(path.join(home, '.claude', 'projects', '-work', 'a.jsonl'), '');
  write(path.join(home, 'accounts', 'g2', '.gemini', 'projects.json'), '{}');
  fs.mkdirSync(path.join(home, 'accounts', 'g2', '.gemini', 'tmp'), { recursive: true });
  write(path.join(home, 'accounts', 'q2', 'subscription_credentials.json'), '{}');
  const result = await discovery.discoverLocations({ deep: true, home, env: {}, desktopDefaults: { claude: null, cursor: null, 'kimi-work': null, kimi: null } });
  const found = result.locations.map((location) => `${location.appId}:${path.relative(home, location.sessionRoot)}`).sort();
  assert.deepEqual(found, [
    'claude-cli:.claude', 'gemini-cli:.gemini', 'gemini-cli:accounts/g2/.gemini',
    'opencode:.local/share/opencode', 'qwen-code:.qwen', 'qwen-code:accounts/q2'
  ]);
  const described = await discovery.describeLocations(result.locations, { profiles: [], home });
  assert.deepEqual(described.find((location) => location.appId === 'gemini-cli' && location.source === 'default').identity, { method: 'oauth', email: 'me@gmail.example', plan: null });
});

function stub(root, name, body) {
  const file = path.join(root, 'bin', name);
  const log = path.join(root, 'stub-log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(log, { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}/${name}.argv"\nenv > "${log}/${name}.env"\n${body}\n`, { mode: 0o755 });
  return { launcher: { command: file, prefixArgs: [], extraEnv: {} }, log };
}

test('OpenCode: a key goes to `opencode auth import` on standard input; status reads only the credential kind', posixOnly, async (t) => {
  const root = tmp(t);
  const profilePath = path.join(root, 'AgentDesk', 'Profiles', 'oc');
  const profile = { appId: 'opencode', profilePath, sessionRoot: path.join(profilePath, 'opencode-data', 'opencode'), profilePathMode: 'managed', sessionRootMode: 'managed' };
  const { launcher, log } = stub(root, 'opencode', 'cat > "$XDG_DATA_HOME/stdin.json"');
  const result = await credentials.applySecret(profile, { secret: SECRET, catalogProviderId: 'anthropic' }, {
    env: { PATH: process.env.PATH }, findLauncher: (id) => (id === 'opencode' ? launcher : null)
  });
  assert.equal(result.via, 'official-stdin');
  const argv = fs.readFileSync(path.join(log, 'opencode.argv'), 'utf8');
  assert.equal(argv, '--standalone\nauth\nimport\n');
  const sent = JSON.parse(fs.readFileSync(path.join(profilePath, 'opencode-data', 'stdin.json'), 'utf8'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].integrationID, 'anthropic');
  assert.deepEqual(sent[0].value, { type: 'key', key: SECRET });
  assert.match(sent[0].id, /^cred_[0-9a-f]+$/);
  assert.equal(fs.readFileSync(path.join(log, 'opencode.env'), 'utf8').includes(SECRET), false);
  // The success check counts active credentials in opencode.db without reading their values out.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(profile.sessionRoot, 'opencode.db'));
  db.exec(`CREATE TABLE credential (id TEXT, integration_id TEXT, label TEXT, value TEXT, active INTEGER);
    INSERT INTO credential VALUES ('cred_1', 'anthropic', 'AgentDesk', '{"type":"key","key":"x"}', 1);`);
  db.close();
  assert.deepEqual(await credentials.credentialStatus(profile, {}), { supported: true, signedIn: true, method: 'api-key', verifiedBy: 'files' });
  const listed = stub(root, 'opencode-list', 'printf \'[]\'');
  assert.equal((await credentials.credentialStatus(profile, { official: true, env: {}, findLauncher: () => listed.launcher })).signedIn, false);
});

test('Gemini CLI and Qwen Code: keys go into the account’s own .env and settings are merged', async (t) => {
  const root = tmp(t);
  const gemini = { appId: 'gemini-cli', sessionRoot: path.join(root, 'gm', '.gemini') };
  write(path.join(gemini.sessionRoot, 'settings.json'), JSON.stringify({ ui: { theme: 'dark' }, security: { folderTrust: { enabled: true } } }));
  await credentials.applySecret(gemini, { secret: SECRET });
  assert.equal(fs.readFileSync(path.join(gemini.sessionRoot, '.env'), 'utf8'), `GEMINI_API_KEY='${SECRET}'\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(gemini.sessionRoot, 'settings.json'), 'utf8')), {
    ui: { theme: 'dark' }, security: { folderTrust: { enabled: true }, auth: { selectedType: 'gemini-api-key' } }
  });
  assert.equal((await credentials.credentialStatus(gemini, {})).method, 'api-key');
  const qwen = { appId: 'qwen-code', sessionRoot: path.join(root, 'qw') };
  await assert.rejects(credentials.applySecret(qwen, { secret: SECRET }), { code: 'credential-method-unsupported' });
  await credentials.applySecret(qwen, { method: 'provider', secret: SECRET, provider: { baseUrl: 'https://dashscope.example/v1', model: 'qwen3-coder' } });
  assert.equal(fs.readFileSync(path.join(qwen.sessionRoot, '.env'), 'utf8'),
    `OPENAI_API_KEY='${SECRET}'\nOPENAI_BASE_URL='https://dashscope.example/v1'\nOPENAI_MODEL='qwen3-coder'\n`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(qwen.sessionRoot, 'settings.json'), 'utf8')).security.auth.selectedType, 'openai');
  assert.deepEqual(await credentials.credentialStatus(qwen, {}), { supported: true, signedIn: true, method: 'provider', verifiedBy: 'files' });
  write(path.join(root, 'qs', 'subscription_credentials.json'), JSON.stringify({ revision: 1, tokens: { access_token: 'a' } }));
  assert.equal((await credentials.credentialStatus({ appId: 'qwen-code', sessionRoot: path.join(root, 'qs') }, {})).method, 'subscription');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(qwen.sessionRoot, '.env')).mode & 0o777, 0o600);
});

test('OpenCode legacy auth.json is told apart from Codex by its content; Gemini oauth_creds.json is staged with its sign-in type', (t) => {
  const root = tmp(t);
  const openCodeAuth = path.join(root, 'oc', 'auth.json');
  write(openCodeAuth, JSON.stringify({ anthropic: { type: 'api', key: SECRET } }));
  const codexAuth = path.join(root, 'cx', 'auth.json');
  write(codexAuth, JSON.stringify({ OPENAI_API_KEY: SECRET }));
  assert.equal(credentialImport.clientForCredentialFile(openCodeAuth), 'opencode');
  assert.equal(credentialImport.clientForCredentialFile(codexAuth), 'codex');
  const target = { appId: 'opencode', profilePath: path.join(root, 'AgentDesk', 'oc1'), sessionRoot: path.join(root, 'AgentDesk', 'oc1', 'opencode-data', 'opencode') };
  credentialImport.stageNewHome('opencode', target, credentialImport.IMPORTERS.opencode.read(openCodeAuth));
  assert.deepEqual(fs.readFileSync(path.join(target.sessionRoot, 'auth.json')), fs.readFileSync(openCodeAuth));
  const geminiCreds = path.join(root, 'g', '.gemini', 'oauth_creds.json');
  write(geminiCreds, JSON.stringify({ access_token: 'a', refresh_token: SECRET, expiry_date: 1 }));
  assert.equal(credentialImport.clientForCredentialFile(geminiCreds), 'gemini-cli');
  const gemini = { appId: 'gemini-cli', profilePath: path.join(root, 'AgentDesk', 'g1'), sessionRoot: path.join(root, 'AgentDesk', 'g1', 'gemini-home', '.gemini') };
  credentialImport.stageNewHome('gemini-cli', gemini, credentialImport.IMPORTERS['gemini-cli'].read(geminiCreds));
  assert.equal(JSON.parse(fs.readFileSync(path.join(gemini.sessionRoot, 'settings.json'), 'utf8')).security.auth.selectedType, 'oauth-personal');
  assert.throws(() => credentialImport.IMPORTERS.opencode.read(codexAuth), { code: 'credential-file-format' });
});
