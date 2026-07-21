// AgentDesk — Kimi Code session scanner tests (node:test, zero deps).
// 目录形态与 ~/.kimi-code 实测一致：
//   <root>/sessions/<workspaceId>/session_<uuid>/state.json
//   <root>/sessions/<workspaceId>/session_<uuid>/agents/main/wire.jsonl
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanSessions, scanKimi, kimiActivityFromFile } = require('../src/sessions');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-kimi-'));
}

function makeKimiSession(root, workspace, sessionId, state, wireEvents = null) {
  const dir = path.join(root, 'sessions', workspace, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  if (wireEvents) {
    const agentDir = path.join(dir, 'agents', 'main');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'wire.jsonl'),
      wireEvents.map((event) => JSON.stringify(event)).join('\n') + '\n'
    );
  }
  return dir;
}

test('scanKimi 读 state.json 的标题 / 时间 / workDir', () => {
  const root = tmpDir();
  makeKimiSession(root, 'wd_demo_abc123', 'session_11112222-3333-4444-5555-666677778888', {
    createdAt: '2026-07-17T08:46:59.069Z',
    updatedAt: '2026-07-19T08:08:38.033Z',
    title: '完整理解这个项目',
    workDir: '/Users/demo/project'
  });

  const recs = scanKimi({ sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].appId, 'kimi');
  assert.equal(recs[0].id, 'session_11112222-3333-4444-5555-666677778888');
  assert.equal(recs[0].address, 'session_11112222-3333-4444-5555-666677778888');
  assert.equal(recs[0].title, '完整理解这个项目');
  assert.equal(recs[0].projectPath, '/Users/demo/project');
  assert.equal(recs[0].createdAt, '2026-07-17T08:46:59.069Z');
  assert.equal(recs[0].updatedAt, '2026-07-19T08:08:38.033Z');
  assert.equal(recs[0].source, 'Kimi Code');
  assert.ok(recs[0].filePath.endsWith('state.json'));
});

test('scanKimi 缺标题时给短 id 占位，不带 session_ 前缀', () => {
  const root = tmpDir();
  makeKimiSession(root, 'wd_demo_abc123', 'session_aaaabbbb-0000-0000-0000-000000000000', {
    createdAt: '2026-07-17T08:46:59.069Z',
    updatedAt: '2026-07-17T08:46:59.069Z'
  });

  const recs = scanKimi({ sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /^Kimi 会话 aaaabbbb/);
});

test('scanKimi 容错缺目录 / 坏 JSON，并按最后活跃新→旧排序', () => {
  const empty = tmpDir();
  assert.deepEqual(scanKimi({ sessionRoot: path.join(empty, 'missing') }), []);

  const root = tmpDir();
  makeKimiSession(root, 'wd_x_1', 'session_00000000-0000-0000-0000-000000000001', {
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    title: '旧会话'
  });
  makeKimiSession(root, 'wd_x_1', 'session_00000000-0000-0000-0000-000000000002', {
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    title: '新会话'
  });
  const brokenDir = path.join(root, 'sessions', 'wd_x_1', 'session_broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'state.json'), '{not json');

  const recs = scanKimi({ sessionRoot: root });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].title, '新会话');
  assert.equal(recs[1].title, '旧会话');
});

test('scanSessions 按 appId=kimi 分派到 scanKimi', () => {
  const root = tmpDir();
  makeKimiSession(root, 'wd_x_1', 'session_00000000-0000-0000-0000-00000000000a', {
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    title: '分派检查'
  });
  const recs = scanSessions({ appId: 'kimi', sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].appId, 'kimi');
});

test('kimiActivityFromFile: state.json 读 updatedAt → 毫秒', () => {
  const root = tmpDir();
  const dir = makeKimiSession(root, 'wd_x_1', 'session_00000000-0000-0000-0000-00000000000b', {
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-19T08:08:38.033Z',
    title: 'x'
  });
  const ts = kimiActivityFromFile(path.join(dir, 'state.json'));
  assert.equal(ts, Date.parse('2026-07-19T08:08:38.033Z'));
});

test('kimiActivityFromFile: wire.jsonl 取末行事件的毫秒 time', () => {
  const root = tmpDir();
  const dir = makeKimiSession(
    root,
    'wd_x_1',
    'session_00000000-0000-0000-0000-00000000000c',
    { createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', title: 'x' },
    [
      { type: 'metadata', protocol_version: '1.4', created_at: 1784425175029 },
      { type: 'context.append_message', message: { role: 'user', content: [] }, time: 1784425176000 },
      { type: 'context.append_loop_event', event: { type: 'step.begin' }, time: 1784448518037 }
    ]
  );
  const ts = kimiActivityFromFile(path.join(dir, 'agents', 'main', 'wire.jsonl'));
  assert.equal(ts, 1784448518037);
});

test('kimiActivityFromFile: 空路径 / 缺文件 → null', () => {
  assert.equal(kimiActivityFromFile(null), null);
  assert.equal(kimiActivityFromFile(path.join(tmpDir(), 'nope.json')), null);
});

// ── 注册表契约：kimi 槽位的隔离与能力声明 ─────────────────

const apps = require('../src/apps');

test('注册表 kimi：默认槽位读 ~/.kimi-code，独立槽位用 kimi-code-home', () => {
  const app_ = apps.getApp('kimi');
  assert.equal(apps.isKnownApp('kimi'), true);
  assert.equal(app_.defaultSessionRoot('/tmp/slot', true), path.join(os.homedir(), '.kimi-code'));
  assert.equal(app_.defaultSessionRoot('/tmp/slot', false), path.join('/tmp/slot', 'kimi-code-home'));
});

test('注册表 kimi：启动环境注入 KIMI_CODE_HOME 指向会话根（官方数据目录变量）', () => {
  const app_ = apps.getApp('kimi');
  const env = app_.launchEnv({ sessionRoot: '/tmp/slot/kimi-code-home' }, { PATH: '/usr/bin' });
  assert.equal(env.KIMI_CODE_HOME, '/tmp/slot/kimi-code-home');
  assert.equal(env.PATH, '/usr/bin');
});

test('注册表：只有声明 exportTranscript 的客户端标记可导出', () => {
  const list = apps.listApps();
  const byId = Object.fromEntries(list.map((item) => [item.id, item]));
  assert.equal(byId.kimi.canExportTranscript, true);
  assert.equal(byId.claude.canExportTranscript, false);
  assert.equal(byId.codex.canExportTranscript, false);
  assert.equal(byId.cursor.canExportTranscript, false);
});

test('注册表 kimi：exportTranscript 输出 markdown 和清洗后的文件名', () => {
  const root = tmpDir();
  const dir = makeKimiSession(
    root,
    'wd_x_1',
    'session_00000000-0000-0000-0000-00000000000d',
    { createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', title: '导出检查/含斜杠', workDir: '/tmp/p' },
    [
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '你好' }], origin: { kind: 'user' } }, time: 1784425176000 }
    ]
  );
  const app_ = apps.getApp('kimi');
  const exported = app_.exportTranscript({ filePath: path.join(dir, 'state.json'), title: '导出检查/含斜杠' });
  assert.match(exported.markdown, /# 导出检查\/含斜杠/);
  assert.match(exported.markdown, /你好/);
  assert.doesNotMatch(exported.suggestedName, /[/\\]/);
  assert.ok(exported.suggestedName.endsWith('.md'));
});
