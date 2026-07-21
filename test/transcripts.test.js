// AgentDesk — session transcript export tests (node:test, zero deps).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { kimiTranscriptMarkdown, suggestedTranscriptName } = require('../src/transcripts');

function makeSession(state, wireEvents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-transcript-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  const agentDir = path.join(dir, 'agents', 'main');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'wire.jsonl'),
    wireEvents.map((event) => JSON.stringify(event)).join('\n') + '\n'
  );
  return path.join(dir, 'state.json');
}

const STATE = {
  createdAt: '2026-07-18T03:00:13.852Z',
  updatedAt: '2026-07-18T03:20:13.956Z',
  title: '配置一下权限',
  workDir: '/Users/demo/project'
};

const WIRE = [
  { type: 'metadata', protocol_version: '1.4', created_at: 1784343613890 },
  { type: 'config.update', profileName: 'agent', systemPrompt: '系统提示不应出现在导出里' },
  {
    type: 'context.append_message',
    message: { role: 'user', content: [{ type: 'text', text: '你能给自己配置一下权限吗？' }], origin: { kind: 'user' } },
    origin: { kind: 'user' },
    time: 1784343613960
  },
  {
    type: 'context.append_loop_event',
    event: { type: 'content.part', part: { type: 'think', think: '内部思考不导出' } },
    time: 1784343614000
  },
  {
    type: 'context.append_loop_event',
    event: { type: 'content.part', part: { type: 'text', text: '我调用内置的配置技能来查看和调整权限设置。' } },
    time: 1784343615000
  },
  {
    type: 'context.append_loop_event',
    event: { type: 'tool.call', name: 'Bash', description: 'Reading config', args: { command: 'cat config.toml' } },
    time: 1784343616000
  },
  {
    type: 'context.append_message',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>注入消息不导出</system-reminder>' }],
      origin: { kind: 'injection', variant: 'todo_list_reminder' }
    },
    time: 1784343617000
  },
  {
    type: 'context.append_loop_event',
    event: { type: 'content.part', part: { type: 'text', text: '已把权限模式设为 yolo。' } },
    time: 1784343618000
  }
];

test('kimiTranscriptMarkdown 输出标题头、用户消息与助手正文', () => {
  const statePath = makeSession(STATE, WIRE);
  const markdown = kimiTranscriptMarkdown(statePath);
  assert.match(markdown, /^# 配置一下权限/);
  assert.match(markdown, /\/Users\/demo\/project/);
  assert.match(markdown, /## 🧑 用户[\s\S]*你能给自己配置一下权限吗？/);
  assert.match(markdown, /## 🤖 Kimi[\s\S]*我调用内置的配置技能来查看和调整权限设置。/);
  assert.match(markdown, /已把权限模式设为 yolo。/);
});

test('kimiTranscriptMarkdown 标注工具调用，过滤思考 / 注入 / 系统提示', () => {
  const statePath = makeSession(STATE, WIRE);
  const markdown = kimiTranscriptMarkdown(statePath);
  assert.match(markdown, /🔧 Bash/);
  assert.doesNotMatch(markdown, /内部思考不导出/);
  assert.doesNotMatch(markdown, /注入消息不导出/);
  assert.doesNotMatch(markdown, /系统提示不应出现在导出里/);
});

test('kimiTranscriptMarkdown 对缺 wire.jsonl 的会话仍导出元数据头', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-transcript-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(STATE));
  const markdown = kimiTranscriptMarkdown(path.join(dir, 'state.json'));
  assert.match(markdown, /^# 配置一下权限/);
  assert.match(markdown, /没有找到对话记录/);
});

test('kimiTranscriptMarkdown 对坏输入抛出带说明的错误', () => {
  assert.throws(() => kimiTranscriptMarkdown(null), /会话文件/);
  assert.throws(
    () => kimiTranscriptMarkdown(path.join(os.tmpdir(), 'agentdesk-none', 'state.json')),
    /会话文件/
  );
});

test('suggestedTranscriptName 清洗非法字符并限长', () => {
  assert.equal(suggestedTranscriptName('配置一下权限'), '配置一下权限.md');
  const cleaned = suggestedTranscriptName('a/b\\c:d*e?f"g<h>i|j');
  assert.doesNotMatch(cleaned, /[/\\:*?"<>|]/);
  const long = suggestedTranscriptName('长'.repeat(120));
  assert.ok(long.length <= 64 + '.md'.length);
  assert.equal(suggestedTranscriptName(''), 'kimi-session.md');
});
