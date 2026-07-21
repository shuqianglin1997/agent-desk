// AgentDesk — Claude Code CLI（终端）会话扫描器单测。
// 用户自己终端里跑的 claude 会话存在 ~/.claude/projects/<路径slug>/<uuid>.jsonl，
// 与桌面 App 的 claude-code-sessions 是两套。事件行带 timestamp/cwd/sessionId；
// 标题事件：custom-title（用户改名）> ai-title（AI 生成）> 首条真实 user 文本。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanClaudeCli, scanSessions, lastEventTimestamp } = require('../src/sessions');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ccli-'));
}

function writeSession(root, slug, uuid, events) {
  const dir = path.join(root, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  return file;
}

const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const UUID_SIDE = 'cccccccc-1111-2222-3333-444444444444';

test('scanClaudeCli：标题优先 ai-title，读 cwd 和首末时间戳', () => {
  const root = tmpRoot();
  writeSession(root, '-Users-demo-proj', UUID_A, [
    { type: 'user', message: { role: 'user', content: '帮我修一个登录 bug' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/Users/demo/proj', sessionId: UUID_A },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] }, timestamp: '2026-07-20T02:00:05.000Z', cwd: '/Users/demo/proj', sessionId: UUID_A },
    { type: 'ai-title', aiTitle: '修复登录 bug', sessionId: UUID_A },
    { type: 'user', message: { role: 'user', content: '继续' }, timestamp: '2026-07-20T03:00:00.000Z', cwd: '/Users/demo/proj', sessionId: UUID_A }
  ]);

  const recs = scanClaudeCli({ sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].appId, 'claude-cli');
  assert.equal(recs[0].id, UUID_A);
  assert.equal(recs[0].title, '修复登录 bug');
  assert.equal(recs[0].projectPath, '/Users/demo/proj');
  assert.equal(recs[0].createdAt, '2026-07-20T02:00:00.000Z');
  assert.equal(recs[0].updatedAt, '2026-07-20T03:00:00.000Z');
  assert.equal(recs[0].source, 'Claude CLI');
});

test('scanClaudeCli：custom-title 压过 ai-title；无标题时用首条真实 user 文本', () => {
  const root = tmpRoot();
  writeSession(root, '-Users-demo-a', UUID_A, [
    { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/a', sessionId: UUID_A },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '这才是真实输入' }] }, timestamp: '2026-07-20T02:01:00.000Z', cwd: '/a', sessionId: UUID_A },
    { type: 'ai-title', aiTitle: 'AI 标题', sessionId: UUID_A },
    { type: 'custom-title', customTitle: '我的自定义名', sessionId: UUID_A }
  ]);
  writeSession(root, '-Users-demo-b', UUID_B, [
    { type: 'user', message: { role: 'user', content: '<local-command-stdout>噪音</local-command-stdout>' }, timestamp: '2026-07-21T02:00:00.000Z', cwd: '/b', sessionId: UUID_B },
    { type: 'user', message: { role: 'user', content: '没有标题事件的会话' }, timestamp: '2026-07-21T02:01:00.000Z', cwd: '/b', sessionId: UUID_B }
  ]);

  const recs = scanClaudeCli({ sessionRoot: root });
  const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
  assert.equal(byId[UUID_A].title, '我的自定义名');
  assert.equal(byId[UUID_B].title, '没有标题事件的会话');
});

test('scanClaudeCli：跳过子 agent（isSidechain）文件与坏文件，不递归子目录', () => {
  const root = tmpRoot();
  writeSession(root, '-Users-demo-a', UUID_A, [
    { type: 'user', message: { role: 'user', content: '主会话' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/a', sessionId: UUID_A }
  ]);
  writeSession(root, '-Users-demo-a', UUID_SIDE, [
    { type: 'user', isSidechain: true, message: { role: 'user', content: '子 agent 任务' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/a', sessionId: UUID_SIDE }
  ]);
  // 子目录里的 jsonl 不应被扫到（memory/<uuid>/ 等）
  const sub = path.join(root, 'projects', '-Users-demo-a', 'memory');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'not-a-session.jsonl'), '{"type":"user"}\n');
  fs.writeFileSync(path.join(root, 'projects', '-Users-demo-a', 'broken.jsonl'), '{oops');

  const recs = scanClaudeCli({ sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, UUID_A);
});

test('scanClaudeCli：缺目录 → 空数组；scanSessions 按 appId 分派', () => {
  const root = tmpRoot();
  assert.deepEqual(scanClaudeCli({ sessionRoot: path.join(root, 'none') }), []);
  writeSession(root, '-Users-demo-a', UUID_A, [
    { type: 'user', message: { role: 'user', content: 'x' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/a', sessionId: UUID_A }
  ]);
  const recs = scanSessions({ appId: 'claude-cli', sessionRoot: root });
  assert.equal(recs.length, 1);
});

test('lastEventTimestamp 对 claude-cli 事件（ISO timestamp）直接可用', () => {
  const root = tmpRoot();
  const file = writeSession(root, '-Users-demo-a', UUID_A, [
    { type: 'user', message: { role: 'user', content: 'x' }, timestamp: '2026-07-20T02:00:00.000Z', cwd: '/a', sessionId: UUID_A },
    { type: 'assistant', message: { role: 'assistant', content: [] }, timestamp: '2026-07-20T02:34:56.000Z', cwd: '/a', sessionId: UUID_A }
  ]);
  assert.equal(lastEventTimestamp(file), Date.parse('2026-07-20T02:34:56.000Z'));
});

// ── 注册表契约 ─────────────────────────────────────

const apps = require('../src/apps');

test('注册表 claude-cli：默认读 ~/.claude，独立槽位用 CLAUDE_CONFIG_DIR 隔离，不可 launch', () => {
  assert.equal(apps.isKnownApp('claude-cli'), true);
  const app_ = apps.getApp('claude-cli');
  assert.equal(app_.label, 'Claude CLI');
  assert.equal(app_.noLaunch, true);
  assert.equal(app_.defaultSessionRoot('/tmp/slot', true), path.join(os.homedir(), '.claude'));
  assert.equal(app_.defaultSessionRoot('/tmp/slot', false), path.join('/tmp/slot', 'claude-cli-home'));
  const env = app_.launchEnv({ sessionRoot: '/tmp/slot/claude-cli-home' }, { PATH: '/usr/bin' });
  assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/slot/claude-cli-home');
  const byId = Object.fromEntries(apps.listApps().map((item) => [item.id, item]));
  assert.equal(byId['claude-cli'].canExportTranscript, true);
  assert.equal(byId['claude-cli'].canLaunch, false);
  assert.equal(byId.claude.canLaunch, true);
});
