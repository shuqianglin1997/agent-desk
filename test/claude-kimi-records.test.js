// Claude Code session records and Kimi wire records each have one reader
// (src/clients/claude-cli/records.js, src/clients/kimi/wire.js), used by the
// scanner, the transcript export, export attachments and the hub's final
// answer. These cases pin what each of those returns today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const apps = require('../src/apps');
const hub = require('../src/hub/adapters');
const { prepareSessionExport } = require('../src/session-export');

const PNG = Buffer.from('fixture png bytes').toString('base64');

function root(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-claude-kimi-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function claudeHome(base) {
  const dir = path.join(base, 'claude-home', 'projects', '-w');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '11111111-1111-4111-8111-111111111111.jsonl');
  const event = (fields) => JSON.stringify({ timestamp: '2026-11-24T10:00:00.000Z', cwd: '/w', ...fields });
  fs.writeFileSync(file, [
    event({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
    event({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta text' } }),
    event({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'please look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] } }),
    event({ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'text', text: ' a ' }, { type: 'text', text: 'b' }, { type: 'tool_use', name: 'Read' }] } }),
    event({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    event({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'side' }] } }),
    event({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'final' }, { type: 'text', text: 'answer' }] } }),
    'not json'
  ].join('\n') + '\n');
  return { home: path.join(base, 'claude-home'), file };
}

function kimiHome(base) {
  const dir = path.join(base, 'kimi-home', 'sessions', 'ws', 'session_22222222-2222-4222-8222-222222222222');
  fs.mkdirSync(path.join(dir, 'agents', 'main'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ title: 'Kimi 标题', createdAt: '2026-11-24T10:00:00Z', updatedAt: '2026-11-24T10:05:00Z', workDir: '/k' }));
  fs.writeFileSync(path.join(dir, 'agents', 'main', 'wire.jsonl'), [
    { type: 'context.append_message', message: { role: 'user', origin: { kind: 'user' }, content: [{ type: 'text', text: 'hi kimi' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] } },
    { type: 'context.append_message', message: { role: 'user', origin: { kind: 'injection' }, content: [{ type: 'text', text: 'injected' }] } },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'kimi says' } } },
    { type: 'context.append_loop_event', event: { type: 'tool.call', name: 'grep', description: 'look' } }
  ].map((record) => JSON.stringify(record)).join('\n') + '\n');
  return { home: path.join(base, 'kimi-home'), state: path.join(dir, 'state.json') };
}

const body = (markdown) => markdown.slice(markdown.indexOf('---\n\n') + 5);

test('Claude Code: title, reply state, transcript, hub answer and attachments', async (t) => {
  const base = root(t);
  const { home, file } = claudeHome(base);
  const client = apps.getApp('claude-cli');
  const [row] = client.scan({ id: 'c', appId: 'claude-cli', sessionRoot: home });
  assert.deepEqual([row.title, row.lastRole, row.replyDone], ['please look', 'assistant', true]);
  const markdown = client.exportTranscript({ filePath: file, title: 'T' }).markdown;
  assert.match(markdown, /^# T\n\n- 项目：`\/w`\n/);
  assert.equal(body(markdown), '## 🧑 用户\n\nplease look\n\n## 🤖 Claude\n\na\n\nb\n\n> 🔧 Read\n\nfinal\n\nanswer\n');
  assert.deepEqual(hub.ADAPTERS['claude-cli'].lastAnswerFromRecord(file), { text: 'final\nanswer', truncated: false });
  const exported = await prepareSessionExport([{ profile: { id: 'p', appId: 'claude-cli', sessionRoot: home }, session: { id: row.id, title: 'T', filePath: file }, client }]);
  assert.deepEqual([exported.format, exported.attachmentCount], ['zip', 1]);
});

test('Kimi wire: transcript and attachments, for Kimi Code and Kimi Work', async (t) => {
  const base = root(t);
  const { home, state } = kimiHome(base);
  const [row] = apps.getApp('kimi').scan({ id: 'k', appId: 'kimi', sessionRoot: home });
  assert.equal(row.title, 'Kimi 标题');
  const markdown = apps.getApp('kimi').exportTranscript({ filePath: state, title: row.title }).markdown;
  assert.match(markdown, /^# Kimi 标题\n\n- 项目：`\/k`\n/);
  assert.equal(body(markdown), '## 🧑 用户\n\nhi kimi\n\n## 🤖 Kimi\n\nkimi says\n\n> 🔧 grep — look\n');
  for (const appId of ['kimi', 'kimi-work']) {
    const exported = await prepareSessionExport([{ profile: { id: 'p', appId, sessionRoot: home }, session: { id: row.id, title: 'K', filePath: state }, client: apps.getApp(appId) }]);
    assert.deepEqual([exported.format, exported.attachmentCount], ['zip', 1], appId);
  }
});
