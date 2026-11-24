// AgentDesk — 猫有多忙、新回复、颜色标签：数据层（docs/SESSION_MARKS_PLAN.md 第 6 节第 1 批）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SessionMarksStore, freshReplyAt, normalizeKey, normalizeName } = require('../src/session-marks');
const { scanClaudeCli, scanCodex, replyStateOf } = require('../src/sessions');
const { probeActivities, WRITING_WINDOW_MS } = require('../src/activity');
const { mergeActivity } = require('../src/identity-groups');
const { markKeyOf, keyOf } = require('../src/session-table');
const YardCats = require('../src/yard/cats');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-marks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeLines(file, events, ageMs = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  }
  return file;
}

const T = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const claudeUser = (text, at) => ({ type: 'user', timestamp: at, cwd: '/w', message: { role: 'user', content: text } });
const claudeToolResult = (at) => ({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } });
const claudeAssistant = (stop, at) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'ok' }] } });
const codexMeta = (id, at) => ({ type: 'session_meta', timestamp: at, payload: { id, session_id: id, cwd: '/w' } });
const codexMsg = (role, at, phase) => ({ type: 'response_item', timestamp: at, payload: { type: 'message', role, ...(phase ? { phase } : {}), content: [] } });
const codexEvent = (type, at) => ({ type: 'event_msg', timestamp: at, payload: { type } });
const codexCall = (at) => ({ type: 'response_item', timestamp: at, payload: { type: 'function_call', name: 'x' } });

test('the cat window and the “running” window are one constant', () => {
  assert.equal(YardCats.WORKING_WINDOW, 90_000);
  assert.equal(WRITING_WINDOW_MS, YardCats.WORKING_WINDOW);
});

test('Claude CLI: role and end of turn come from the tail only', (t) => {
  const root = tmp(t);
  const dir = path.join(root, 'projects', '-w');
  const done = writeLines(path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), [
    claudeUser('hi', T(-60_000)), claudeAssistant('tool_use', T(-50_000)), claudeToolResult(T(-40_000)),
    claudeAssistant('end_turn', T(-30_000)), { type: 'system', subtype: 'stop_hook_summary', timestamp: T(-29_000) }
  ]);
  writeLines(path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), [
    claudeUser('hi', T(-60_000)), claudeAssistant('tool_use', T(-50_000)), claudeToolResult(T(-40_000))
  ]);
  writeLines(path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000003.jsonl'), [
    claudeUser('hi', T(-60_000)), claudeAssistant('end_turn', T(-50_000)), claudeUser('and then', T(-40_000)),
    { type: 'user', isMeta: true, timestamp: T(-39_000), message: { role: 'user', content: 'meta' } }
  ]);
  writeLines(path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000004.jsonl'), [
    claudeUser('hi', T(-60_000)), { type: 'assistant', timestamp: T(-50_000), message: { role: 'assistant', content: [] } }
  ]);
  const rows = Object.fromEntries(scanClaudeCli({ sessionRoot: root }).map((row) => [row.address.slice(-1), row]));
  assert.deepEqual([rows[1].lastRole, rows[1].replyDone], ['assistant', true]);
  assert.equal(rows[1].lastReplyAt, new Date(Date.parse(rows[1].lastReplyAt)).toISOString());
  assert.deepEqual([rows[2].lastRole, rows[2].replyDone], ['assistant', false]);
  assert.deepEqual([rows[3].lastRole, rows[3].replyDone], ['user', false]);
  assert.deepEqual([rows[4].lastRole, rows[4].replyDone], ['assistant', null]);
  assert.deepEqual(replyStateOf('claude-cli', done), { lastRole: 'assistant', lastReplyAt: rows[1].lastReplyAt, replyDone: true });
  assert.equal(replyStateOf('kimi', done), null, 'other clients are not judged this round');
});

test('Codex: task_complete ends a turn; tool calls, commentary and aborts do not', (t) => {
  const root = tmp(t);
  const day = path.join(root, 'sessions', '2026', '11', '24');
  const id = (n) => `019a0000-0000-7000-8000-00000000000${n}`;
  writeLines(path.join(day, `rollout-a-${id(1)}.jsonl`), [codexMeta(id(1), T(-90_000)), codexMsg('user', T(-80_000)),
    codexMsg('assistant', T(-70_000), 'commentary'), codexCall(T(-60_000)), codexMsg('assistant', T(-50_000), 'final_answer'), codexEvent('token_count', T(-49_000)), codexEvent('task_complete', T(-48_000))]);
  writeLines(path.join(day, `rollout-b-${id(2)}.jsonl`), [codexMeta(id(2), T(-90_000)), codexMsg('user', T(-80_000)),
    codexMsg('assistant', T(-70_000), 'commentary'), codexCall(T(-60_000))]);
  writeLines(path.join(day, `rollout-c-${id(3)}.jsonl`), [codexMeta(id(3), T(-90_000)), codexMsg('user', T(-80_000)),
    codexMsg('assistant', T(-70_000), 'commentary'), codexEvent('turn_aborted', T(-60_000))]);
  writeLines(path.join(day, `rollout-d-${id(4)}.jsonl`), [codexMeta(id(4), T(-90_000)), codexMsg('assistant', T(-80_000), 'final_answer'),
    codexEvent('task_complete', T(-79_000)), codexEvent('task_started', T(-70_000)), codexMsg('user', T(-69_000))]);
  const rows = Object.fromEntries(scanCodex({ sessionRoot: root }).map((row) => [row.address.slice(-1), row]));
  assert.deepEqual([rows[1].lastRole, rows[1].replyDone], ['assistant', true]);
  assert.ok(rows[1].lastReplyAt && rows[1].updatedAt, 'the same tail read still gives the last activity time');
  assert.deepEqual([rows[2].lastRole, rows[2].replyDone], ['assistant', false]);
  assert.deepEqual([rows[3].lastRole, rows[3].replyDone], ['assistant', false]);
  assert.deepEqual([rows[4].lastRole, rows[4].replyDone], ['user', false]);
});

test('freshReplyAt: assistant, finished, later than seen and the first-use start', () => {
  const at = Date.parse('2026-11-24T10:00:00Z');
  const reply = { lastRole: 'assistant', replyDone: true, lastReplyAt: new Date(at).toISOString() };
  assert.equal(freshReplyAt(reply, { baselineAt: at - 1 }), at);
  assert.equal(freshReplyAt(reply, { baselineAt: at + 1 }), null, 'replies before first use are never marked');
  assert.equal(freshReplyAt(reply, { baselineAt: 1, seenAt: at }), null, 'seen at that reply');
  assert.equal(freshReplyAt(reply, { baselineAt: 1, writing: true }), null, 'still running');
  assert.equal(freshReplyAt({ ...reply, lastRole: 'user' }, { baselineAt: 1 }), null);
  assert.equal(freshReplyAt({ ...reply, replyDone: false }, { baselineAt: 1, quiet: true }), null);
  assert.equal(freshReplyAt({ ...reply, replyDone: null }, { baselineAt: 1 }), null, 'unsure and not quiet yet');
  assert.equal(freshReplyAt({ ...reply, replyDone: null }, { baselineAt: 1, quiet: true }), at, 'unsure but quiet for 90 s');
});

test('activity: running count, running keys and new replies per run location', (t) => {
  const root = tmp(t);
  const dir = path.join(root, 'projects', '-w');
  const id = (n) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
  // 1: still writing (tool_use, just appended). 2: finished just now. 3: finished long ago, before first use.
  // 4: finished after first use but quiet. 5: sub-agent file, never counted.
  writeLines(path.join(dir, `${id(1)}.jsonl`), [claudeUser('hi', T(-20_000)), claudeAssistant('tool_use', T(-5_000))]);
  writeLines(path.join(dir, `${id(2)}.jsonl`), [claudeUser('hi', T(-20_000)), claudeAssistant('end_turn', T(-5_000))]);
  writeLines(path.join(dir, `${id(3)}.jsonl`), [claudeUser('hi', T(-9e6)), claudeAssistant('end_turn', T(-8e6))], 8e6);
  writeLines(path.join(dir, `${id(4)}.jsonl`), [claudeUser('hi', T(-600_000)), claudeAssistant('end_turn', T(-500_000))], 500_000);
  writeLines(path.join(dir, `${id(5)}.jsonl`), [{ ...claudeUser('hi', T(-3_000)), isSidechain: true }, { ...claudeAssistant('tool_use', T(-2_000)), isSidechain: true }]);
  const profiles = [{ id: 'p1', appId: 'claude-cli', sessionRoot: root }, { id: 'p2', appId: 'claude-cli', sessionRoot: root }];
  const seen = new Map();
  const marks = { baselineAt: Date.now() - 3_600_000, seenAt: (key) => seen.get(key) || null };
  const [first, second] = probeActivities(profiles, Date.now(), marks);
  assert.equal(first.writingNow, 1);
  assert.deepEqual(first.writingKeys, [`p1::${id(1)}`]);
  assert.deepEqual(second.writingKeys, [`p2::${id(1)}`], 'a shared data root keys rows by each run location');
  assert.deepEqual(first.freshKeys.map((item) => item.key).sort(), [`p1::${id(2)}`, `p1::${id(4)}`]);
  assert.equal(first.freshReplies, 2);
  assert.equal(JSON.stringify(first).includes('writingAddresses'), false, 'internal lists never cross IPC');

  seen.set(`p1::${id(4)}`, Date.now());
  const [again] = probeActivities(profiles, Date.now(), marks);
  assert.deepEqual(again.freshKeys.map((item) => item.key), [`p1::${id(2)}`]);

  const [noMarks] = probeActivities(profiles, Date.now());
  assert.equal(noMarks.freshReplies, null, 'without the local marks nothing is judged');
  assert.equal(noMarks.writingNow, 1);
});

test('activity: archived Codex roots are never running; unsupported clients report no new replies', (t) => {
  const root = tmp(t);
  const id = '019a0000-0000-7000-8000-0000000000aa';
  writeLines(path.join(root, 'archived_sessions', `rollout-x-${id}.jsonl`), [codexMeta(id, T(-5_000)), codexMsg('user', T(-4_000))]);
  const [codex] = probeActivities([{ id: 'c', appId: 'codex', sessionRoot: root }], Date.now(), { baselineAt: 1, seenAt: () => null });
  assert.equal(codex.writingNow, 0);
  assert.deepEqual(codex.writingKeys, []);

  const kimi = tmp(t);
  const state = path.join(kimi, 'sessions', 'w', 'session_abc', 'state.json');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, '{}');
  const [result] = probeActivities([{ id: 'k', appId: 'kimi', sessionRoot: kimi }], Date.now(), { baselineAt: 1, seenAt: () => null });
  assert.equal(result.writingNow, 1);
  assert.deepEqual(result.writingKeys, ['k::session_abc']);
  assert.equal(result.freshReplies, null);
});

test('mergeActivity sums known running counts and keeps unknown as unknown', () => {
  const merged = mergeActivity([
    { profileId: 'a', sourceKey: 's1', writingNow: 2, writingKeys: ['a::1', 'a::2'], freshReplies: 1, freshKeys: [{ key: 'a::3', at: 1 }] },
    { profileId: 'b', sourceKey: 's1', writingNow: 2, writingKeys: ['b::1', 'b::2'], freshReplies: 1, freshKeys: [{ key: 'b::3', at: 1 }] },
    { profileId: 'c', sourceKey: 's2', writingNow: null, freshReplies: null }
  ]);
  assert.equal(merged.writingNow, 2, 'one data root counts once');
  assert.equal(merged.freshReplies, 1);
  assert.deepEqual(merged.writingKeys, ['a::1', 'a::2', 'b::1', 'b::2']);
  assert.equal(mergeActivity([{ profileId: 'x', writingNow: null }]).writingNow, null);
});

test('markKeyOf is the local keyOf whether or not the device mesh is on', () => {
  const local = { _profileId: 'p1', address: 'abc', title: 't' };
  const meshLocal = { ...local, conversationId: 'conv-1', _remote: false };
  assert.equal(markKeyOf(local), keyOf(local));
  assert.equal(markKeyOf(meshLocal), 'p1::abc');
  assert.equal(markKeyOf({ ...meshLocal, _remote: true }), 'mesh::conv-1');
  assert.equal(markKeyOf({ _hubRun: { id: 'r' } }), '');
});

test('SessionMarksStore: first-use start, tags, names, seen times and validation', (t) => {
  const file = path.join(tmp(t), 'session-marks.json');
  let clock = 1_000_000;
  const store = new SessionMarksStore({ file, now: () => clock });
  const first = store.snapshot();
  assert.equal(first.baselineAt, 1_000_000);
  assert.deepEqual(first.names, [null, null, null, null, null]);
  assert.ok(fs.existsSync(file), 'the start time is written on first use');

  assert.equal(store.setTag(['p1::a', 'p1::b'], 3).tags['p1::b'], 3);
  assert.equal(store.setTag(['p1::a'], 0).tags['p1::a'], undefined);
  for (const bad of [[['nope'], 1], [['p1::a'], 6], [['p1::a'], 1.5], [[], 1], [['p1::a\n'], 1], ['p1::a', 1], [[`p1::${'x'.repeat(600)}`], 1]]) {
    assert.equal(store.setTag(...bad).ok, false, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(store.markSeen([{ key: 'p1::a', at: 5_000 }]).seen['p1::a'], 5_000);
  assert.equal(store.markSeen([{ key: 'p1::a', at: 4_000 }]).seen['p1::a'], 5_000, 'seen only moves forward');
  assert.equal(store.markSeen([{ key: 'p1::a', at: 'later' }]).ok, false);
  assert.equal(store.rename(2, '  要紧\u0007的事情要紧的事情要紧的  ').names[1], '要紧 的事情要紧的事情要');
  assert.equal(store.rename(2, '').names[1], null, 'an empty name returns to the colour word');
  assert.equal(store.rename(6, 'x').ok, false);
  assert.equal([...normalizeName('一二三四五六七八九十甲乙丙')].length, 12);
  assert.equal(normalizeKey('mesh::conv'), 'mesh::conv');

  clock = 2_000_000;
  const reread = new SessionMarksStore({ file, now: () => clock }).snapshot();
  assert.equal(reread.baselineAt, 1_000_000, 'the start time survives a restart');
  assert.deepEqual(reread.tags, { 'p1::b': 3 });
  assert.equal(reread.seen['p1::a'], 5_000);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.includes('/'), false, 'no paths are stored');
});

test('SessionMarksStore: past the limit, the oldest automatic seen marks go before tags', (t) => {
  const file = path.join(tmp(t), 'session-marks.json');
  let clock = 1;
  const store = new SessionMarksStore({ file, now: () => clock, maxEntries: 3 });
  clock = 10; store.setTag(['p::tagged-old'], 1);
  clock = 20; store.markSeen([{ key: 'p::seen-old', at: 5 }]);
  clock = 30; store.markSeen([{ key: 'p::seen-new', at: 5 }]);
  clock = 40; const after = store.markSeen([{ key: 'p::seen-newest', at: 5 }]);
  assert.deepEqual(Object.keys(after.tags), ['p::tagged-old']);
  assert.deepEqual(Object.keys(after.seen).sort(), ['p::seen-new', 'p::seen-newest']);
});

test('session marks travel only through four narrow IPC channels', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  for (const channel of ['sessionMarks:get', 'sessionMarks:setTag', 'sessionMarks:markSeen', 'sessionMarks:rename']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`));
  }
  const bridge = preload.slice(preload.indexOf('getSessionMarks:'), preload.indexOf('getSessionMarks:') + 900);
  assert.doesNotMatch(bridge, /path|filePath|sessionRoot/i);
  assert.match(main, /session-marks\.json/);
});
