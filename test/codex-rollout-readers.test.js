// Every reader of Codex rollout files (transcript export, the hub's final
// answer, the cached quota, the task package and the scanner) goes through one
// reader of the format, src/clients/codex/rollout.js. These cases pin what
// each reader returns; the last one is the task package finding a child whose
// first line is longer than 64 KB, which the scanner already did.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const apps = require('../src/apps');
const hub = require('../src/hub/adapters');
const { readCachedCodexQuota } = require('../src/codex-quota');
const { captureCodexTaskSession } = require('../src/task-package/codex-adapter');

function line(type, payload, timestamp = '2026-11-24T10:00:00.000Z') { return JSON.stringify({ timestamp, type, payload }); }
const userItem = (text) => line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const assistantItem = (text) => line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const userEvent = (message) => line('event_msg', { type: 'user_message', message });
const agentEvent = (message) => line('event_msg', { type: 'agent_message', message });
const tokenCount = (timestamp) => line('event_msg', { type: 'token_count', rate_limits: {
  primary: { used_percent: 42, window_minutes: 300, resets_in_seconds: 600 },
  secondary: { used_percent: 7, window_minutes: 10080, resets_in_seconds: 86400 }
} }, timestamp);

function home(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-readers-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'sessions', '2026', '11', '24');
  fs.mkdirSync(dir, { recursive: true });
  const rollout = (id, time, meta, body) => {
    const file = path.join(dir, `rollout-2026-11-24T${time}-${id}.jsonl`);
    fs.writeFileSync(file, [line('session_meta', { id, ...meta }), ...body].join('\n') + '\n');
    return file;
  };
  return { root, rollout };
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('transcripts prefer the event stream; the hub answer is the last assistant message', (t) => {
  const { rollout } = home(t);
  const a = rollout(A, '10-00-00', { cwd: '/w' }, [userItem('hello item'), userEvent('hello'), assistantItem('answer one item'),
    agentEvent('answer one'), tokenCount('2026-11-24T10:05:00.000Z'), assistantItem('final item'), agentEvent('final'), 'not json']);
  const b = rollout(B, '09-00-00', {}, [userItem('question'), assistantItem('only items'), assistantItem('   ')]);
  const c = rollout(C, '08-00-00', {}, [userEvent('asked'), assistantItem('item reply')]);
  const transcript = (file) => apps.getApp('codex').exportTranscript({ filePath: file, title: 't' }).markdown;
  assert.equal(transcript(a), '## 🧑 用户\n\nhello\n\n## 🤖 Codex\n\nanswer one\n\nfinal');
  assert.equal(transcript(b), '## 🧑 用户\n\nquestion\n\n## 🤖 Codex\n\nonly items');
  assert.equal(transcript(c), '## 🧑 用户\n\nasked');
  assert.deepEqual(hub.ADAPTERS.codex.lastAnswerFromRecord(a), { text: 'final', truncated: false });
  assert.deepEqual(hub.ADAPTERS.codex.lastAnswerFromRecord(b), { text: 'only items', truncated: false });
  assert.deepEqual(hub.ADAPTERS.codex.lastAnswerFromRecord(c), { text: 'item reply', truncated: false });
});

test('the cached quota comes from the newest token_count line', (t) => {
  const { root, rollout } = home(t);
  rollout(A, '10-00-00', {}, [userEvent('hello'), tokenCount('2026-11-24T10:05:00.000Z'), agentEvent('final')]);
  const quota = readCachedCodexQuota({ id: 'p', sessionRoot: root });
  assert.equal(quota.status, 'stale');
  assert.equal(quota.source, 'codex-session-log');
  assert.equal(quota.observedAt, '2026-11-24T10:05:00.000Z');
  assert.deepEqual(quota.windows.map((window) => [window.kind, window.usedPercent, window.windowMinutes]),
    [['primary', 42, 300], ['secondary', 7, 10080]]);
});

test('a task package captures every internal child, including one whose first line exceeds 64 KB', async (t) => {
  const { root, rollout } = home(t);
  const rootId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const rootFile = rollout(rootId, '10-00-00', {}, [userEvent('go'), agentEvent('done')]);
  rollout('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '10-01-00', { parent_thread_id: rootId, thread_source: 'subagent' }, [agentEvent('short child')]);
  rollout('ffffffff-ffff-4fff-8fff-ffffffffffff', '10-02-00',
    { parent_thread_id: rootId, thread_source: 'subagent', base_instructions: { text: 'x'.repeat(70 * 1024) } }, [agentEvent('long child')]);
  const captured = await captureCodexTaskSession({
    profile: { appId: 'codex', sessionRoot: root },
    session: { filePath: rootFile, id: rootId },
    stagingRoot: path.join(root, 'stage')
  });
  assert.deepEqual(captured.entries.map((entry) => entry.metadata.physicalRecordId),
    [rootId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff']);
});
