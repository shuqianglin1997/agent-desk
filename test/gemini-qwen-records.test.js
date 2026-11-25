// Gemini CLI and Qwen Code (a Gemini CLI fork) store text as Gemini parts: a
// string, a part, a list of parts, or an object holding `parts`. One reader of
// that format (src/clients/gemini-cli/parts.js) serves the scanner's titles,
// the transcript export and the hub's final answer. Transcripts and titles
// are pinned unchanged; the hub used a copy that did not look inside
// `{ parts }` and answered with the previous reply.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp');
const transcripts = {
  ...require('../src/clients/gemini-cli/transcript'),
  ...require('../src/clients/qwen-code/transcript')
};
const hub = require('../src/hub/adapters');
const { scanGemini } = require('../src/clients/gemini-cli/sessions');
const { scanQwen } = require('../src/clients/qwen-code/sessions');

function root(t) {
  const dir = fs.realpathSync(makeTempDir('agentdesk-gemini-qwen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function geminiHome(t) {
  const home = root(t);
  const chats = path.join(home, 'tmp', 'slug', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const json = path.join(chats, 'session-a.json');
  fs.writeFileSync(json, JSON.stringify({ sessionId: 'g1', startTime: '2026-11-24T10:00:00Z', lastUpdated: '2026-11-24T10:05:00Z', messages: [
    { type: 'user', content: 'first question' },
    { type: 'gemini', content: [{ text: 'a' }, { text: 'thinking', thought: true }, { text: 'b' }] },
    { type: 'user', content: [{ text: 'second' }, { text: 'part' }] },
    { type: 'gemini', content: { parts: [{ text: 'nested' }] } }
  ] }));
  const jsonl = path.join(chats, 'session-b.jsonl');
  fs.writeFileSync(jsonl, [
    JSON.stringify({ sessionId: 'g2', startTime: '2026-11-24T09:00:00Z' }),
    JSON.stringify({ type: 'user', content: [{ text: 'hi' }, { text: 'there' }], timestamp: '2026-11-24T09:01:00Z' }),
    JSON.stringify({ type: 'gemini', content: [{ text: 'reply' }] }),
    'oops'
  ].join('\n') + '\n');
  return { home, json, jsonl };
}

function qwenHome(t) {
  const home = root(t);
  const chats = path.join(home, 'projects', 'p', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, 'q1.jsonl');
  fs.writeFileSync(file, [
    { sessionId: 'q1', type: 'user', message: { parts: [{ text: 'hello' }, { text: 'world' }] }, timestamp: '2026-11-24T10:00:00Z', cwd: '/p' },
    { type: 'assistant', message: { parts: [{ text: 'pondering', thought: true }, { text: 'answer one' }] } },
    { type: 'user', isSidechain: true, message: { parts: [{ text: 'side' }] } },
    { type: 'assistant', isSidechain: true, message: { parts: [{ text: 'side answer' }] } },
    { type: 'user', subtype: 'tool_result', message: { parts: [{ text: 'tool' }] } },
    { type: 'user', systemPayload: { displayText: 'shown text' }, message: { parts: [{ text: 'raw' }] } },
    { type: 'assistant', message: { content: { parts: [{ text: 'nested q' }] } } }
  ].map((record) => JSON.stringify(record)).join('\n') + '\n');
  return { home, file };
}

test('Gemini transcripts and titles read parts, leave out thoughts, and stay as they were', (t) => {
  const { home, json, jsonl } = geminiHome(t);
  assert.equal(transcripts.geminiTranscriptMarkdown(json),
    '## 🧑 用户\n\nfirst question\n\n## 🤖 Gemini\n\na\nb\n\n## 🧑 用户\n\nsecond\npart\n\n## 🤖 Gemini\n\nnested');
  assert.equal(transcripts.geminiTranscriptMarkdown(jsonl), '## 🧑 用户\n\nhi\nthere\n\n## 🤖 Gemini\n\nreply');
  assert.deepEqual(scanGemini({ sessionRoot: home }).map((row) => [row.id, row.title]), [['g1', 'first question'], ['g2', 'hi there']]);
});

test('Qwen transcripts and titles stay as they were', (t) => {
  const { home, file } = qwenHome(t);
  assert.equal(transcripts.qwenTranscriptMarkdown(file),
    '## 🧑 用户\n\nhello\nworld\n\n## 🤖 Qwen\n\nanswer one\n\n## 🧑 用户\n\nshown text\n\n## 🤖 Qwen\n\nnested q');
  assert.deepEqual(scanQwen({ sessionRoot: home }).map((row) => [row.id, row.title]), [['q1', 'hello world']]);
});

test('the hub answer is the last reply, also when its parts sit inside an object', (t) => {
  const { json, jsonl } = geminiHome(t);
  const { file } = qwenHome(t);
  assert.deepEqual(hub.ADAPTERS['gemini-cli'].lastAnswerFromRecord(json), { text: 'nested', truncated: false });
  assert.deepEqual(hub.ADAPTERS['gemini-cli'].lastAnswerFromRecord(jsonl), { text: 'reply', truncated: false });
  assert.deepEqual(hub.ADAPTERS['qwen-code'].lastAnswerFromRecord(file), { text: 'nested q', truncated: false });
});
