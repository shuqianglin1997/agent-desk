/*
 * AgentDesk — Kimi Work 会话扫描器。
 *
 * Kimi Work（Kimi 桌面 App 的 agent 工作台）分两层存数据：
 *   索引：<sessionRoot>/agents/main/sessions/hosted-logical/conversations.sqlite
 *         conversations 表每行一个会话（generated 标题、workspace_path、kernel 指针）。
 *   正文：kernel_session_dir 指向内嵌 kimi-code 内核的会话目录
 *         （state.json + agents/main/wire.jsonl，与 ~/.kimi-code 完全同构）。
 * sessionRoot 即 daimon 数据根（App Support/kimi-desktop/daimon-share/daimon）。
 *
 * sqlite 行的 updated_at 只记会话建立/标题生成，不反映后续轮次（实测确认），
 * 所以最后活跃优先读 kernel state.json 的 updatedAt。
 * 复用 cursor-sessions 的系统 sqlite3 只读查询，零第三方依赖。
 */

const fs = require('node:fs');
const path = require('node:path');
const { queryJson } = require('./cursor-sessions');
const { parseDate, cleanTitle } = require('./sessions');

function kimiWorkDbPath(profile) {
  return path.join(profile.sessionRoot, 'agents', 'main', 'sessions', 'hosted-logical', 'conversations.sqlite');
}

function readStateJson(kernelSessionDir) {
  if (!kernelSessionDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(kernelSessionDir, 'state.json'), 'utf8'));
  } catch (_error) {
    return null;
  }
}

function toRecord(row, db) {
  const key = String(row.conversation_key || '');
  const id = key.split(':').pop() || key;
  const state = readStateJson(row.kernel_session_dir);
  const createdAt = parseDate(row.created_at) || null;
  // 真实活跃时间在 kernel state.json；kernel 目录被清理时退回 sqlite 行时间
  const updatedAt = (state && parseDate(state.updatedAt)) || parseDate(row.updated_at) || createdAt;
  const statePath = row.kernel_session_dir ? path.join(row.kernel_session_dir, 'state.json') : null;

  return {
    id,
    appId: 'kimi-work',
    title: cleanTitle(row.title) || `Kimi Work 会话 ${id.slice(0, 8)}`,
    createdAt,
    updatedAt,
    projectPath: row.workspace_path ? String(row.workspace_path) : null,
    source: 'Kimi Work',
    status: '可用',
    model: null,
    // 有 kernel 记录时指向 state.json（导出/定位都认它）；否则退回 db 便于「打开位置」
    filePath: state ? statePath : db,
    address: id
  };
}

function scanKimiWork(profile) {
  const db = kimiWorkDbPath(profile);
  if (!fs.existsSync(db)) return [];

  // LIMIT 截断按 sqlite 自己的 updated_at_ms（建立时间）排序；state.json 修正只作用于
  // 取回的窗口内。超过 2000 条历史会话时，最旧的可能取不到——与 cursor 扫描器同款取舍。
  const rows = queryJson(db,
    'SELECT conversation_key, title, workspace_path, kernel_session_dir, kernel_records_path, ' +
    'created_at, updated_at FROM conversations ORDER BY updated_at_ms DESC LIMIT 2000;'
  );
  if (!rows) return [];

  const records = rows.map((row) => toRecord(row, db));
  // updatedAt 可能被 state.json 改写，按最终值重排
  return records.sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
}

module.exports = { scanKimiWork, kimiWorkDbPath };
