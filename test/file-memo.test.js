// One per-file memo for the session scanners (architecture phase 4): a file is
// parsed again only when it changed (path, size, modification time); callers
// get copies; a failed read is never remembered; the list scan and the
// activity probe share one read of the same file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const memo = require('../src/clients/file-memo');
const apps = require('../src/apps');
const { makeTempDir } = require('./helpers/temp');

function tempRoot(t, name) {
  const root = fs.realpathSync(makeTempDir(`agentdesk-file-memo-${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function touchLater(filePath, seconds) {
  const at = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(filePath, at, at);
}

test('a file is parsed once while unchanged, again when its size or time changes, and callers get copies', (t) => {
  memo.clear();
  const root = tempRoot(t, 'basic');
  const file = path.join(root, 'a.txt');
  fs.writeFileSync(file, 'one');
  let parses = 0;
  const parse = (filePath) => { parses += 1; return { text: fs.readFileSync(filePath, 'utf8') }; };
  const first = memo.remember('test/basic', file, parse);
  first.text = 'changed by a caller';
  assert.deepEqual(memo.remember('test/basic', file, parse), { text: 'one' }, 'a caller cannot change what is remembered');
  assert.equal(parses, 1);
  fs.appendFileSync(file, ' two');
  assert.deepEqual(memo.remember('test/basic', file, parse), { text: 'one two' });
  assert.equal(parses, 2, 'a new size is a new parse');
  touchLater(file, 5);
  memo.remember('test/basic', file, parse);
  assert.equal(parses, 3, 'a new modification time is a new parse');
  memo.remember('test/other-kind', file, parse);
  assert.equal(parses, 4, 'each kind of parse is remembered separately');
  assert.equal(memo.stats().hits >= 1, true);
});

test('a failed read is not remembered, and a missing file is never cached', (t) => {
  memo.clear();
  const root = tempRoot(t, 'failure');
  const file = path.join(root, 'a.txt');
  fs.writeFileSync(file, 'x');
  let calls = 0;
  const failing = () => { calls += 1; throw Object.assign(new Error('unreadable'), { code: 'EACCES' }); };
  assert.throws(() => memo.remember('test/fail', file, failing), { code: 'EACCES' });
  assert.throws(() => memo.remember('test/fail', file, failing), { code: 'EACCES' });
  assert.equal(calls, 2, 'the second call read again');
  let missing = 0;
  const gone = path.join(root, 'gone.txt');
  memo.remember('test/missing', gone, () => { missing += 1; return null; });
  memo.remember('test/missing', gone, () => { missing += 1; return null; });
  assert.equal(missing, 2);
  assert.equal(memo.stats().entries, 0);
});

function claudeCliHome(t, count) {
  const root = tempRoot(t, 'claude-cli');
  const dir = path.join(root, 'projects', '-w');
  fs.mkdirSync(dir, { recursive: true });
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `1111111${index}-1111-4111-8111-111111111111`;
    ids.push(id);
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: '2026-11-24T10:00:00.000Z', cwd: '/w', message: { role: 'user', content: `hello ${index}` } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T10:01:00.000Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } })
    ].join('\n') + '\n');
  }
  return { profile: { id: 'p', appId: 'claude-cli', sessionRoot: root, profilePath: root }, dir, ids };
}

test('a Claude CLI rescan parses only the file that changed, and its rows equal a scan from nothing', (t) => {
  memo.clear();
  const { profile, dir, ids } = claudeCliHome(t, 3);
  const scan = () => apps.getApp('claude-cli').scan(profile);
  const before = scan();
  const parsesAfterFirst = memo.stats().parses;
  assert.deepEqual(scan(), before, 'an unchanged folder gives the same rows');
  assert.equal(memo.stats().parses, parsesAfterFirst, 'and reads nothing again');
  fs.appendFileSync(path.join(dir, `${ids[1]}.jsonl`), JSON.stringify({ type: 'custom-title', customTitle: 'Renamed', timestamp: '2026-11-24T11:00:00.000Z' }) + '\n');
  const after = scan();
  assert.equal(after.find((row) => row.id === ids[1]).title, 'Renamed');
  assert.ok(memo.stats().parses - parsesAfterFirst <= 2, 'only the changed file was read again');
  memo.clear();
  assert.deepEqual(scan(), after, 'remembered rows equal rows read from nothing');
});

test('the Codex list and the activity reply state share one read of a rollout tail', (t) => {
  memo.clear();
  const root = tempRoot(t, 'codex');
  const day = path.join(root, 'sessions', '2026', '11', '24');
  fs.mkdirSync(day, { recursive: true });
  const id = '22222222-2222-4222-8222-222222222222';
  const file = path.join(day, `rollout-2026-11-24T10-00-00-${id}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ timestamp: '2026-11-24T10:00:00.000Z', type: 'session_meta', payload: { id, session_id: id, cwd: '/w' } }),
    JSON.stringify({ timestamp: '2026-11-24T10:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
    JSON.stringify({ timestamp: '2026-11-24T10:00:02.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'hello' } }),
    JSON.stringify({ timestamp: '2026-11-24T10:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete' } })
  ].join('\n') + '\n');
  const codex = apps.getApp('codex');
  const [row] = codex.scan({ id: 'c', appId: 'codex', sessionRoot: root, profilePath: root });
  const parses = memo.stats().parses;
  const reply = codex.replyState(file, fs.statSync(file));
  assert.equal(memo.stats().parses, parses, 'the reply state reused the list read');
  assert.deepEqual(reply, { lastRole: row.lastRole, lastReplyAt: row.lastReplyAt, replyDone: row.replyDone });
  assert.equal(reply.replyDone, true);
});

test('Gemini CLI and Qwen Code rescans read nothing again while their files are unchanged', (t) => {
  memo.clear();
  const gemini = tempRoot(t, 'gemini');
  const chats = path.join(gemini, 'tmp', 'slug', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(gemini, 'projects.json'), JSON.stringify({ projects: { '/w': 'slug' } }));
  fs.writeFileSync(path.join(chats, 'session-1.jsonl'), [
    JSON.stringify({ sessionId: 'g1', startTime: '2026-11-24T10:00:00.000Z' }),
    JSON.stringify({ type: 'user', content: 'hello gemini', timestamp: '2026-11-24T10:01:00.000Z' })
  ].join('\n') + '\n');
  const qwen = tempRoot(t, 'qwen');
  const qwenChats = path.join(qwen, 'projects', '-w', 'chats');
  fs.mkdirSync(qwenChats, { recursive: true });
  fs.writeFileSync(path.join(qwenChats, '33333333-3333-4333-8333-333333333333.jsonl'),
    JSON.stringify({ sessionId: 'q1', type: 'user', cwd: '/w', timestamp: '2026-11-24T10:00:00.000Z', message: { role: 'user', parts: [{ text: 'hello qwen' }] } }) + '\n');
  const profiles = [
    { id: 'g', appId: 'gemini-cli', sessionRoot: gemini, profilePath: gemini },
    { id: 'q', appId: 'qwen-code', sessionRoot: qwen, profilePath: qwen }
  ];
  const scanAll = () => profiles.map((profile) => apps.getApp(profile.appId).scan(profile));
  const first = scanAll();
  assert.deepEqual(first.map((rows) => rows.length), [1, 1]);
  assert.equal(first[0][0].projectPath, '/w', 'the project folder is still added per scan');
  const { parses, hits } = memo.stats();
  assert.deepEqual(scanAll(), first);
  assert.equal(memo.stats().parses, parses);
  assert.equal(memo.stats().hits - hits, 2, 'each file came from the memo');
});
