// AgentDesk — Cursor 会话扫描器单测（node:test）。
// 用系统 sqlite3 造一个真实的迷你 state.vscdb 做 fixture；无 sqlite3 则跳过。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { scanCursor, sessionCounts } = require('../src/cursor-sessions');

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3';
}
function haveSqlite3() {
  try { execFileSync(sqlite3Bin(), ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// 造一个 Cursor 数据目录：<root>/User/globalStorage/state.vscdb，含 composerHeaders
function buildFixture(now) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-fix-'));
  const dir = path.join(root, 'User', 'globalStorage');
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, 'state.vscdb');
  const todayMs = now;
  const oldMs = now - 5 * 86400000;
  const sql = `
CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT);
INSERT INTO composerHeaders VALUES ('real-1','w',${todayMs},${todayMs + 1000},0,0,${todayMs},0,'{"name":"重构登录","subtitle":"帮我改一下"}');
INSERT INTO composerHeaders VALUES ('old-1','w',${oldMs},${oldMs},0,0,${oldMs},0,'{"name":"旧对话"}');
INSERT INTO composerHeaders VALUES ('sub-1','w',${todayMs},${todayMs},0,1,${todayMs},0,'{"name":"子agent，应过滤"}');
INSERT INTO composerHeaders VALUES ('empty-state-draft','w',${todayMs},${todayMs},0,0,${todayMs},0,'{"name":"草稿，应过滤"}');
INSERT INTO composerHeaders VALUES ('no-update','w',${todayMs},NULL,0,0,${todayMs},0,'{"name":"没更新过，应过滤"}');
`;
  execFileSync(sqlite3Bin(), [db], { input: sql });
  return { root, db };
}

test('scanCursor：读 composerHeaders，取 name 当标题，过滤子agent/草稿/无更新', { skip: !haveSqlite3() && '无 sqlite3' }, () => {
  const now = Date.now();
  const { root } = buildFixture(now);
  const recs = scanCursor({ sessionRoot: root });
  const titles = recs.map((r) => r.title);
  assert.ok(titles.includes('重构登录'), '应含今日真实会话');
  assert.ok(titles.includes('旧对话'), '应含旧会话');
  assert.ok(!titles.some((t) => t.includes('子agent')), '子agent 应被过滤');
  assert.ok(!titles.some((t) => t.includes('草稿')), 'empty-state-draft 应被过滤');
  assert.ok(!titles.some((t) => t.includes('没更新过')), 'lastUpdatedAt 为空应被过滤');
  const real = recs.find((r) => r.title === '重构登录');
  assert.equal(real.appId, 'cursor');
  assert.equal(real.source, 'Cursor');
  assert.ok(real.createdAt && real.updatedAt);
});

test('scanCursor：db 不存在返回空数组，不抛', () => {
  assert.deepEqual(scanCursor({ sessionRoot: '/tmp/definitely-no-cursor-here-xyz' }), []);
});

test('sessionCounts：今日活跃/新建来自 SQLite 聚合（过滤子agent/草稿）', { skip: !haveSqlite3() && '无 sqlite3' }, () => {
  const now = Date.now();
  const { root } = buildFixture(now);
  const c = sessionCounts({ sessionRoot: root }, now);
  // real-1 今日活跃+新建；old-1 都不是今日；sub-1/empty-state-draft 被过滤
  assert.equal(c.activeToday, 1);
  assert.equal(c.createdToday, 1);
});
