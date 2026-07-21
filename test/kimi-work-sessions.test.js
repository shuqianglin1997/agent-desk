// AgentDesk — Kimi Work 会话扫描器单测（node:test）。
// Kimi Work（Kimi 桌面 App 的 agent 工作台）把会话索引存在 SQLite：
//   <sessionRoot>/agents/main/sessions/hosted-logical/conversations.sqlite
// 正文是 kimi-code 内核目录（kernel_session_dir → state.json + agents/main/wire.jsonl）。
// 用系统 sqlite3 造迷你 fixture；无 sqlite3 则跳过（与 cursor 测试同款保护）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { scanKimiWork, kimiWorkDbPath } = require('../src/kimi-work-sessions');

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3';
}
function haveSqlite3() {
  try { execFileSync(sqlite3Bin(), ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const CONV_SCHEMA = `
CREATE TABLE conversations (
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  session_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  kernel_type TEXT,
  kernel_session_dir TEXT,
  kernel_records_path TEXT,
  origin TEXT NOT NULL,
  workspace_path TEXT,
  title TEXT NOT NULL,
  title_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (agent_id, conversation_key)
);`;

// 造一个 Kimi Work 数据根：sqlite 索引 + 可选的 kernel 会话目录
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-work-fix-'));
  const dbDir = path.join(root, 'agents', 'main', 'sessions', 'hosted-logical');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = path.join(dbDir, 'conversations.sqlite');

  // kernel 会话目录（新会话）：state.json 的 updatedAt 晚于 sqlite 行的 updated_at
  const kernelDir = path.join(root, 'runtime', 'kimi-code', 'home', 'sessions', 'wd_demo_1', 'conv-aaa111');
  fs.mkdirSync(path.join(kernelDir, 'agents', 'main'), { recursive: true });
  fs.writeFileSync(path.join(kernelDir, 'state.json'), JSON.stringify({
    createdAt: '2026-07-21T03:22:14.966Z',
    updatedAt: '2026-07-21T08:24:33.533Z',
    title: '<meta awareness="low" /> 原始首条消息标题'
  }));
  fs.writeFileSync(
    path.join(kernelDir, 'agents', 'main', 'wire.jsonl'),
    JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: 1784604134995 }) + '\n'
  );

  const esc = (value) => value.replace(/'/g, "''");
  const sql = `${CONV_SCHEMA}
INSERT INTO conversations VALUES ('main','agent:main:main:conversation:11111111-2222-3333-4444-555566667777','s','c1','kimi-code','${esc(kernelDir)}','${esc(path.join(kernelDir, 'agents', 'main', 'wire.jsonl'))}','client','/Users/demo/project','了解ze系列AI助手功能','generated','2026-07-21T03:22:14.865Z',1784604134865,'2026-07-21T03:22:25.045Z',1784604145045);
INSERT INTO conversations VALUES ('main','agent:main:main:conversation:99999999-8888-7777-6666-555544443333','s','c2','kimi-code','${esc(path.join(root, 'gone'))}','','client','/Users/demo/other','旧会话（kernel 目录已清理）','generated','2026-07-18T00:00:00.000Z',1784332800000,'2026-07-18T00:00:10.000Z',1784332810000);
`;
  execFileSync(sqlite3Bin(), [db], { input: sql });
  return { root, db, kernelDir };
}

test('scanKimiWork：读 sqlite 索引，标题用 generated title，updatedAt 优先 state.json', { skip: !haveSqlite3() && '无 sqlite3' }, () => {
  const { root, kernelDir } = buildFixture();
  const recs = scanKimiWork({ sessionRoot: root });
  assert.equal(recs.length, 2);

  const fresh = recs[0];
  assert.equal(fresh.appId, 'kimi-work');
  assert.equal(fresh.id, '11111111-2222-3333-4444-555566667777');
  assert.equal(fresh.title, '了解ze系列AI助手功能');
  assert.equal(fresh.projectPath, '/Users/demo/project');
  assert.equal(fresh.source, 'Kimi Work');
  // 真实活跃时间来自 kernel state.json（sqlite 的 updated_at 只记会话建立）
  assert.equal(fresh.updatedAt, '2026-07-21T08:24:33.533Z');
  assert.equal(fresh.filePath, path.join(kernelDir, 'state.json'));

  const stale = recs[1];
  assert.equal(stale.id, '99999999-8888-7777-6666-555544443333');
  // kernel 目录没了 → 回退 sqlite 时间与 db 路径
  assert.equal(stale.updatedAt, '2026-07-18T00:00:10.000Z');
  assert.ok(stale.filePath.endsWith('conversations.sqlite'));
});

test('scanKimiWork：缺 db / 缺目录 → 空数组', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-work-empty-'));
  assert.deepEqual(scanKimiWork({ sessionRoot: empty }), []);
  assert.deepEqual(scanKimiWork({ sessionRoot: path.join(empty, 'missing') }), []);
});

test('kimiWorkDbPath 指向 hosted-logical 下的 conversations.sqlite', () => {
  const db = kimiWorkDbPath({ sessionRoot: '/tmp/daimon' });
  assert.equal(db, path.join('/tmp/daimon', 'agents', 'main', 'sessions', 'hosted-logical', 'conversations.sqlite'));
});

// ── 注册表契约：kimi-work 槽位 ─────────────────────────

const apps = require('../src/apps');

test('注册表 kimi-work：会话根指向 daimon 数据目录，声明可导出', () => {
  assert.equal(apps.isKnownApp('kimi-work'), true);
  const app_ = apps.getApp('kimi-work');
  assert.equal(app_.label, 'Kimi Work');
  assert.equal(
    app_.defaultSessionRoot('/tmp/kimi-desktop', true),
    path.join('/tmp/kimi-desktop', 'daimon-share', 'daimon')
  );
  const list = apps.listApps();
  const byId = Object.fromEntries(list.map((item) => [item.id, item]));
  assert.equal(byId['kimi-work'].canExportTranscript, true);
  // Kimi Code 与 Kimi Work 并存后，label 必须能区分
  assert.equal(byId.kimi.label, 'Kimi Code');
});

test('注册表 kimi-work：默认数据目录名是 kimi-desktop（Electron userData），不是 App 显示名', () => {
  const app_ = apps.getApp('kimi-work');
  assert.equal(app_.profileDirName, 'kimi-desktop');
  if (process.platform === 'darwin') {
    assert.match(apps.defaultProfilePath('kimi-work'), /kimi-desktop$/);
  }
});
