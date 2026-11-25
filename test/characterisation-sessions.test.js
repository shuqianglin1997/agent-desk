// Characterisation (golden) test: the complete output of every session
// scanner and of the activity probe on one fixed fixture per client. It pins
// what the code does today so that later refactors (client adapters, session
// index, worker) cannot change a single field unnoticed. A deliberate change
// regenerates the golden file and the diff is reviewed in the commit:
//   AGENTDESK_UPDATE_GOLDEN=1 node --test test/characterisation-sessions.test.js
// "Today" counts depend on local midnight, so the clock zone is pinned.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { makeTempDir } = require('./helpers/temp');

const GOLDEN = path.join(__dirname, 'fixtures', 'characterisation', 'sessions.golden.json');
const UPDATE = process.env.AGENTDESK_UPDATE_GOLDEN === '1';
const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const at = (minutesBefore) => new Date(NOW - minutesBefore * 60000).toISOString();
const lines = (...records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3';
}
const haveSqlite3 = (() => { try { execFileSync(sqlite3Bin(), ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function write(file, body, minutesBefore) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const seconds = (NOW - minutesBefore * 60000) / 1000;
  fs.utimesSync(file, seconds, seconds);
}

// One directory per client. Each fixture carries the edge cases its scanner
// is known to handle (sub-agents, archives, title precedence, broken files).
const BUILDERS = {
  claude(dir) {
    write(path.join(dir, 'claude-code-sessions', 'w', 'local_c1.json'), JSON.stringify({ sessionId: 'c1', title: 'Desktop task', createdAt: at(120), lastActivityAt: at(5), cwd: '/work/desk', model: 'opus' }), 5);
    write(path.join(dir, 'local-agent-mode-sessions', 'w', 'local_c2.json'), JSON.stringify({ cliSessionId: 'c2', createdAt: at(3000), lastFocusedAt: at(2000), originCwd: '/work/agent', isArchived: true, effort: 'high' }), 2000);
    write(path.join(dir, 'claude-code-sessions', 'w', 'local_broken.json'), '{not json', 1);
  },
  'claude-cli'(dir) {
    const p = path.join(dir, 'projects', '-work-cli');
    write(path.join(p, 'a1.jsonl'), lines(
      { type: 'summary', summary: 'Summary title' },
      { type: 'user', timestamp: at(60), cwd: '/work/cli', message: { role: 'user', content: 'Fix the parser' } },
      { type: 'assistant', timestamp: at(59), message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }], stop_reason: 'tool_use' } },
      { type: 'ai-title', aiTitle: 'AI title wins over summary' },
      { type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' } }
    ), 1);
    write(path.join(p, 'a2.jsonl'), lines(
      { type: 'user', timestamp: at(500), cwd: '/work/cli', message: { role: 'user', content: [{ type: 'text', text: 'First real prompt text' }] } },
      { type: 'custom-title', customTitle: 'Custom title beats all' },
      { type: 'user', timestamp: at(400), message: { role: 'user', content: [{ type: 'tool_result', content: 'tool output' }] } }
    ), 400);
    write(path.join(p, 'sub.jsonl'), lines({ type: 'user', isSidechain: true, timestamp: at(2), cwd: '/work/cli', message: { content: 'sub-agent' } }), 2);
    write(path.join(p, 'junk.jsonl'), 'not json at all\n', 3);
    write(path.join(p, 'nested', 'deep.jsonl'), lines({ type: 'user', timestamp: at(2), message: { content: 'nested, not scanned' } }), 2);
  },
  'dsh-cli'(dir) {
    const sessions = path.join(dir, 'sessions');
    const header = (id, extra = {}) => ({ type: 'session', version: 3, id, createdAt: NOW - 3600000, isSeeded: false, delegationDepth: 0, cwd: '/work/dsh', ...extra });
    const frames = Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(lines(header('session-a')))),
      zlib.zstdCompressSync(Buffer.from(lines({ type: 'session/title', data: { title: 'First title', source: 'fallback' } }))),
      zlib.zstdCompressSync(Buffer.from(lines({ type: 'message/human', data: { text: 'hi' } }, { type: 'session/title', data: { title: 'Better title', source: 'model' } })))
    ]);
    write(path.join(sessions, '--work-dsh--', 'session-a', 'session.v3.jsonl.zstd'), frames, 10);
    write(path.join(sessions, '--work-dsh--', 'session-a', 'session.v1.jsonl'), lines(header('session-a', { version: 1 })), 300);
    write(path.join(sessions, '_no-cwd', 'session-b', 'session.v3.jsonl'), lines({ ...header('session-b'), cwd: undefined }), 30);
    write(path.join(sessions, '--work-dsh--', 'session-child', 'session.v3.jsonl'), lines(header('session-child', { parentSession: 'session-a', delegationDepth: 1 })), 5);
  },
  codex(dir) {
    const meta = (payload, minutes) => ({ timestamp: at(minutes), type: 'session_meta', payload });
    const day = path.join(dir, 'sessions', '2026', '11', '24');
    write(path.join(day, 'rollout-2026-11-24T10-00-00-11111111-1111-4111-8111-111111111111.jsonl'), lines(
      meta({ id: '11111111-1111-4111-8111-111111111111', session_id: '11111111-1111-4111-8111-111111111111', cwd: '/work/codex' }, 120),
      { timestamp: at(119), type: 'event_msg', payload: { type: 'user_message', message: 'Hi' } },
      { timestamp: at(2), type: 'event_msg', payload: { type: 'agent_message', message: 'Done' } },
      { timestamp: at(2), type: 'event_msg', payload: { type: 'task_complete' } }
    ), 2);
    // A root whose session_id differs from payload.id: list identity is session_id.
    write(path.join(day, 'rollout-2026-11-24T09-00-00-22222222-2222-4222-8222-222222222222.jsonl'), lines(
      meta({ id: '22222222-2222-4222-8222-222222222222', session_id: '33333333-3333-4333-8333-333333333333', cwd: '/work/other' }, 200),
      { timestamp: at(150), type: 'response_item', payload: { type: 'reasoning' } }
    ), 150);
    // guardian child of the first root, and an orphan child whose parent is absent.
    write(path.join(day, 'rollout-2026-11-24T10-05-00-44444444-4444-4444-8444-444444444444.jsonl'), lines(
      meta({ id: '44444444-4444-4444-8444-444444444444', session_id: '11111111-1111-4111-8111-111111111111', parent_thread_id: '11111111-1111-4111-8111-111111111111', thread_source: 'subagent', source: { subagent: { other: 'guardian' } } }, 110)
    ), 1);
    write(path.join(day, 'rollout-2026-11-24T10-06-00-55555555-5555-4555-8555-555555555555.jsonl'), lines(
      meta({ id: '55555555-5555-4555-8555-555555555555', parent_thread_id: '99999999-9999-4999-8999-999999999999', thread_source: 'subagent' }, 100)
    ), 1);
    // The same root also present in the archive (lifecycle conflict), plus an archived-only root.
    write(path.join(dir, 'archived_sessions', 'rollout-2026-11-20T10-00-00-11111111-1111-4111-8111-111111111111.jsonl'), lines(
      meta({ id: '11111111-1111-4111-8111-111111111111', session_id: '11111111-1111-4111-8111-111111111111', cwd: '/work/codex' }, 6000)
    ), 5000);
    write(path.join(dir, 'archived_sessions', 'rollout-2026-11-01T10-00-00-66666666-6666-4666-8666-666666666666.jsonl'), lines(
      meta({ id: '66666666-6666-4666-8666-666666666666', cwd: '/work/old' }, 30000)
    ), 30000);
    write(path.join(dir, 'session_index.jsonl'), lines(
      { id: '11111111-1111-4111-8111-111111111111', thread_name: 'Indexed title', updated_at: at(90) },
      { id: '33333333-3333-4333-8333-333333333333', thread_name: 'Indexed by session_id', updated_at: at(160) }
    ) + '{partial', 1);
  },
  kimi(dir) {
    write(path.join(dir, 'sessions', 'wd1', 'session_k1', 'state.json'), JSON.stringify({ title: 'Kimi task', createdAt: at(90), updatedAt: at(4), workDir: '/work/kimi' }), 4);
    write(path.join(dir, 'sessions', 'wd1', 'session_k2abcdefgh', 'state.json'), JSON.stringify({ createdAt: at(900), updatedAt: at(800) }), 800);
    write(path.join(dir, 'sessions', 'wd1', 'session_bad', 'state.json'), '{', 1);
  },
  opencode(dir) {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'opencode.db'));
    db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT);
      CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT, version TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT NOT NULL, directory TEXT, time_created INTEGER, time_updated INTEGER);
      INSERT INTO project VALUES ('p1', '/work/app', 'app');
      INSERT INTO session_v2 VALUES ('ses_root1', 'p1', NULL, 'a', '/work/app/src', 'Fix login', '2', ${NOW - 7200000}, ${NOW - 60000}, NULL);
      INSERT INTO session_v2 VALUES ('ses_child', 'p1', 'ses_root1', 'b', '/work/app', 'subagent', '2', ${NOW - 7000000}, ${NOW - 6000000}, NULL);
      INSERT INTO session_v2 VALUES ('ses_old', 'p1', NULL, 'c', '/work/app', NULL, '2', ${NOW - 90000000}, ${NOW - 90000000}, ${NOW - 80000000});
      INSERT INTO session VALUES ('ses_v1only', 'p1', NULL, 'Only in v1', '/work/v1', ${NOW - 50000000}, ${NOW - 50000000});`);
    db.close();
    for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), (NOW - 60000) / 1000, (NOW - 60000) / 1000);
    write(path.join(dir, 'storage', 'session', 'proj', 'ses_legacy.json'), JSON.stringify({ id: 'ses_legacy', title: 'Legacy', directory: '/work/legacy', time: { created: NOW - 99000000, updated: NOW - 99000000 } }), 2000);
  },
  'gemini-cli'(dir) {
    write(path.join(dir, 'projects.json'), JSON.stringify({ projects: { '/work/site': 'site' } }), 100);
    const chats = path.join(dir, 'tmp', 'site', 'chats');
    write(path.join(chats, 'session-2026-11-24T10-00-aaaa1111.jsonl'), lines(
      { sessionId: 'aaaa1111-0000', projectHash: 'h', startTime: at(120), lastUpdated: at(120), kind: 'main' },
      { id: 'm1', timestamp: at(119), type: 'user', content: [{ text: '/help' }] },
      { id: 'm2', timestamp: at(118), type: 'user', content: [{ text: 'Make the build faster' }] },
      { $set: { summary: 'Speed up the build', lastUpdated: at(3) } }
    ), 3);
    write(path.join(chats, 'aaaa1111-0000', 'helper.jsonl'), lines({ sessionId: 'sub-1', kind: 'subagent' }), 2);
    write(path.join(chats, 'session-2026-11-24T11-00-bbbb2222.jsonl'), lines({ sessionId: 'bbbb2222-0000', kind: 'subagent', startTime: at(60) }), 2);
    write(path.join(dir, 'tmp', 'other', '.project_root'), '/work/other\n', 100);
    write(path.join(dir, 'tmp', 'other', 'chats', 'session-old.json'), JSON.stringify({ sessionId: 'cccc3333', startTime: at(9000), lastUpdated: at(8000), messages: [{ type: 'user', content: 'Old question' }] }), 8000);
  },
  'qwen-code'(dir) {
    const chats = path.join(dir, 'projects', '-work-api', 'chats');
    write(path.join(chats, 'u1.jsonl'), lines(
      { uuid: '1', sessionId: 'u1', timestamp: at(300), type: 'user', cwd: '/work/api', message: { parts: [{ text: 'Add pagination' }] } },
      { uuid: '2', sessionId: 'u1', timestamp: at(299), type: 'user', isSidechain: true, message: { parts: [{ text: 'internal' }] } },
      { uuid: '3', sessionId: 'u1', timestamp: at(250), type: 'system', subtype: 'custom_title', systemPayload: { customTitle: 'Pagination work' } }
    ), 250);
    write(path.join(chats, 'u2.jsonl'), lines({ uuid: '1', sessionId: 'u2', timestamp: at(20), type: 'user', cwd: '/work/api', systemPayload: { displayText: 'Review the schema' } }), 20);
    write(path.join(chats, 'child.jsonl'), lines({ uuid: '1', sessionId: 'child', timestamp: at(10), type: 'system', subtype: 'parent_session', systemPayload: { parentSessionId: 'u1' } }), 10);
    write(path.join(chats, 'archive', 'u0.jsonl'), lines({ uuid: '1', sessionId: 'u0', timestamp: at(9000), type: 'user', cwd: '/work/api', message: { parts: [{ text: 'Old task' }] } }), 9000);
  },
  cursor(dir) {
    if (!haveSqlite3) return false;
    const db = path.join(dir, 'User', 'globalStorage', 'state.vscdb');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    const today = NOW - 600000;
    const old = NOW - 5 * 86400000;
    execFileSync(sqlite3Bin(), [db], { input: `
CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT);
INSERT INTO composerHeaders VALUES ('real-1','w',${today},${today + 1000},0,0,${today},0,'{"name":"Refactor login","subtitle":"please"}');
INSERT INTO composerHeaders VALUES ('old-1','w',${old},${old},1,0,${old},0,'{"name":"Old chat"}');
INSERT INTO composerHeaders VALUES ('sub-1','w',${today},${today},0,1,${today},0,'{"name":"sub-agent"}');
INSERT INTO composerHeaders VALUES ('empty-state-draft','w',${today},${today},0,0,${today},0,'{"name":"draft"}');
INSERT INTO composerHeaders VALUES ('no-update','w',${today},NULL,0,0,${today},0,'{"name":"never updated"}');
` });
    const seconds = (NOW - 600000) / 1000;
    fs.utimesSync(db, seconds, seconds);
    return true;
  },
  'kimi-work'(dir) {
    if (!haveSqlite3) return false;
    const dbDir = path.join(dir, 'agents', 'main', 'sessions', 'hosted-logical');
    fs.mkdirSync(dbDir, { recursive: true });
    const kernelDir = path.join(dir, 'runtime', 'kimi-code', 'home', 'sessions', 'wd_demo_1', 'conv-aaa111');
    write(path.join(kernelDir, 'state.json'), JSON.stringify({ createdAt: at(300), updatedAt: at(6), title: '<meta awareness="low" /> raw first message' }), 6);
    write(path.join(kernelDir, 'agents', 'main', 'wire.jsonl'), JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: NOW - 18000000 }) + '\n', 6);
    const esc = (value) => value.replace(/'/g, "''");
    execFileSync(sqlite3Bin(), [path.join(dbDir, 'conversations.sqlite')], { input: `
CREATE TABLE conversations (agent_id TEXT NOT NULL, conversation_key TEXT NOT NULL, session_key TEXT NOT NULL, conversation_id TEXT NOT NULL, kernel_type TEXT, kernel_session_dir TEXT, kernel_records_path TEXT, origin TEXT NOT NULL, workspace_path TEXT, title TEXT NOT NULL, title_status TEXT NOT NULL, created_at TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (agent_id, conversation_key));
INSERT INTO conversations VALUES ('main','agent:main:main:conversation:11111111-2222-3333-4444-555566667777','s','c1','kimi-code','${esc(kernelDir)}','${esc(path.join(kernelDir, 'agents', 'main', 'wire.jsonl'))}','client','/work/project','Generated title','generated','${at(300)}',${NOW - 18000000},'${at(290)}',${NOW - 17400000});
INSERT INTO conversations VALUES ('main','agent:main:main:conversation:99999999-8888-7777-6666-555544443333','s','c2','kimi-code','${esc(path.join(dir, 'gone'))}','','client','/work/other','Old conversation','generated','${at(9000)}',${NOW - 540000000},'${at(8990)}',${NOW - 539400000});
` });
    return true;
  }
};

function buildAll(root) {
  const profiles = [];
  const skipped = [];
  for (const [appId, build] of Object.entries(BUILDERS)) {
    const dir = path.join(root, appId);
    fs.mkdirSync(dir, { recursive: true });
    if (build(dir) === false) { skipped.push(appId); continue; }
    profiles.push({ id: `char-${appId}`, appId, name: appId, profilePath: dir, sessionRoot: dir });
  }
  return { profiles, skipped };
}

function normalise(value, root) {
  const real = fs.realpathSync(root);
  let text = JSON.stringify(value);
  for (const prefix of [real, root].sort((a, b) => b.length - a.length)) text = text.split(JSON.stringify(prefix).slice(1, -1)).join('<root>');
  // sourceKey hashes the real data-root path, which differs per temp folder.
  return JSON.parse(text, (key, item) => {
    if (key !== 'sourceKey' || item === null) return item;
    assert.match(item, /^[0-9a-f]{64}$/);
    return '<sha256 of the real data root>';
  });
}

// The golden file holds POSIX paths; Windows path behaviour is covered by windows.test.js.
const posixOnly = { skip: process.platform === 'win32' ? 'golden paths are POSIX' : false };

let root;
let fixture;
let golden = { scan: {}, activity: {} };
const produced = { scan: {}, activity: {} };

test.before(() => {
  root = makeTempDir('agentdesk-characterisation-');
  fixture = buildAll(root);
  if (fs.existsSync(GOLDEN)) golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
});

test.after(() => {
  if (UPDATE) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    const merged = { scan: { ...golden.scan, ...produced.scan }, activity: { ...golden.activity, ...produced.activity } };
    fs.writeFileSync(GOLDEN, JSON.stringify(merged, null, 2) + '\n');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// Activity first, while every file is unseen by the probe's per-file memory.
test('activity probe output on the fixed fixture is unchanged', posixOnly, () => {
  const { probeActivities } = require('../src/activity');
  const result = normalise(probeActivities(fixture.profiles, NOW, null), root);
  for (const item of result) {
    produced.activity[item.profileId] = item;
    if (!UPDATE) assert.deepEqual(item, golden.activity[item.profileId], `activity ${item.profileId}`);
  }
});

for (const appId of Object.keys(BUILDERS)) {
  test(`${appId} scanner output on the fixed fixture is unchanged`, posixOnly, (t) => {
    if (fixture.skipped.includes(appId)) return t.skip('sqlite3 command not available');
    const apps = require('../src/apps');
    const profile = fixture.profiles.find((item) => item.appId === appId);
    const rows = normalise(apps.getApp(appId).scan(profile), root);
    produced.scan[appId] = rows;
    if (!UPDATE) {
      assert.ok(golden.scan[appId], `no golden for ${appId}; run with AGENTDESK_UPDATE_GOLDEN=1 and review`);
      assert.deepEqual(rows, golden.scan[appId]);
    }
  });
}
