/*
 * AgentDesk — Cursor 会话扫描器。
 *
 * Cursor（VSCode 分支）把对话存在 SQLite：
 *   <profilePath>/User/globalStorage/state.vscdb
 * 其中 composerHeaders 表每行是一次会话（composer）：
 *   composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, value(JSON)
 *   value.name = 标题，value.subtitle = 首条消息。
 *
 * 用系统自带 sqlite3（macOS /usr/bin/sqlite3）以 -readonly -json 查询，
 * 不引第三方依赖、不锁库（Cursor 开着也能读）。schema 依据真实 Cursor 3.11 数据确认。
 * 纯 Node，可用 fixture 单测。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3'; // 其他平台走 PATH；不存在时 query 会优雅失败
}

function queryJson(dbPath, sql) {
  try {
    const out = execFileSync(sqlite3Bin(), ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 * 1024
    });
    const trimmed = out.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch (_error) {
    return null; // 无 sqlite3 / 库锁 / 损坏 → 上层按空处理
  }
}

function stateDbPath(profile) {
  return path.join(profile.sessionRoot, 'User', 'globalStorage', 'state.vscdb');
}

function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toRecord(row, db) {
  const id = String(row.id || '');
  const created = Number(row.createdAt) || null;
  const updated = Number(row.lastUpdatedAt) || created;
  const name = row.name && String(row.name).trim();
  const subtitle = row.subtitle && String(row.subtitle).trim();
  return {
    id,
    appId: 'cursor',
    title: name || subtitle || `Cursor 会话 ${id.slice(0, 8)}`,
    createdAt: created ? new Date(created).toISOString() : null,
    updatedAt: updated ? new Date(updated).toISOString() : null,
    projectPath: null, // workspaceIdentifier 是内部 id 而非路径，暂不映射
    source: 'Cursor',
    status: row.isArchived ? '已归档' : '可用',
    model: null,
    filePath: db, // 会话是 db 行、无独立文件；填 db 路径便于「打开文件」定位
    address: id
  };
}

function scanCursor(profile) {
  const db = stateDbPath(profile);
  if (!fs.existsSync(db)) return [];

  // 主路径：composerHeaders 索引表（现代 Cursor）；过滤子 agent 与空草稿
  let rows = queryJson(db,
    "SELECT composerId AS id, createdAt, lastUpdatedAt, isArchived, " +
    "json_extract(value,'$.name') AS name, json_extract(value,'$.subtitle') AS subtitle " +
    "FROM composerHeaders " +
    "WHERE isSubagent=0 AND composerId<>'empty-state-draft' AND lastUpdatedAt IS NOT NULL " +
    "ORDER BY lastUpdatedAt DESC LIMIT 2000;"
  );

  // 兜底：老版本无 composerHeaders → 读 cursorDiskKV 的 composerData（只 json_extract 元数据，不拉大 blob）
  if (!rows || rows.length === 0) {
    rows = queryJson(db,
      "SELECT substr(key,14) AS id, json_extract(value,'$.createdAt') AS createdAt, " +
      "json_extract(value,'$.name') AS name FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT 2000;"
    ) || [];
  }

  const records = rows.map((row) => toRecord(row, db));
  return records.sort((a, b) => {
    const left = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const right = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return left - right;
  });
}

// 供排行榜：今日活跃/新建会话数（SQLite 一次聚合查询，比按文件数更准）
function sessionCounts(profile, now = Date.now()) {
  const db = stateDbPath(profile);
  const zero = { activeToday: 0, createdToday: 0 };
  if (!fs.existsSync(db)) return zero;
  const t = startOfDay(now);
  const rows = queryJson(db,
    `SELECT SUM(CASE WHEN lastUpdatedAt >= ${t} THEN 1 ELSE 0 END) AS activeToday, ` +
    `SUM(CASE WHEN createdAt >= ${t} THEN 1 ELSE 0 END) AS createdToday ` +
    "FROM composerHeaders WHERE isSubagent=0 AND composerId<>'empty-state-draft' AND lastUpdatedAt IS NOT NULL;"
  );
  if (!rows || !rows.length) return zero;
  return {
    activeToday: Number(rows[0].activeToday) || 0,
    createdToday: Number(rows[0].createdToday) || 0
  };
}

module.exports = { scanCursor, sessionCounts, stateDbPath };
