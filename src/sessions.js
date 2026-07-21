/*
 * AgentDesk — local session scanner.
 *
 * Pure Node (fs / os / path only) so it can be unit-tested outside Electron.
 * Reads Claude / Codex local session files and returns normalized records.
 * Extracted verbatim from main.js; behaviour is unchanged.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 按「最后活跃」新→旧排序（updatedAt 优先，退回 createdAt）。就地排序返回同一数组。
function sortByRecency(records) {
  return records.sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
}

function scanSessions(profile) {
  // 各扫描器已按最后活跃排序，这里不再重复排
  if (profile.appId === 'codex') return scanCodex(profile);
  if (profile.appId === 'kimi') return scanKimi(profile);
  return scanClaude(profile);
}

function scanClaude(profile) {
  const roots = [
    { dir: path.join(profile.sessionRoot, 'claude-code-sessions'), source: 'Claude Code' },
    { dir: path.join(profile.sessionRoot, 'local-agent-mode-sessions'), source: 'Claude 本地' }
  ];
  const records = [];

  for (const root of roots) {
    for (const filePath of walkFiles(root.dir, (entry) => entry.isFile() && /^local_.*\.json$/i.test(entry.name))) {
      const json = readJson(filePath);
      if (!json) continue;
      const stat = safeStat(filePath);
      const id = text(json.sessionId) || text(json.cliSessionId) || path.basename(filePath, '.json').replace(/^local_/, '');
      const title = cleanTitle(json.title) || `Claude 会话 ${id.slice(0, 8)}`;
      const createdAt = parseDate(json.createdAt) || stat?.birthtime?.toISOString() || null;
      const updatedAt = parseDate(json.lastActivityAt) || parseDate(json.lastFocusedAt) || stat?.mtime?.toISOString() || createdAt;
      const projectPath = text(json.cwd) || text(json.originCwd) || null;
      const model = text(json.model) || text(json.effort) || null;

      records.push({
        id,
        appId: 'claude',
        title,
        createdAt,
        updatedAt,
        projectPath,
        source: root.source,
        status: json.isArchived ? '已归档' : '可用',
        model,
        filePath,
        // 会话身份必须独立于磁盘位置。Windows/MSIX 更新、路径迁移或
        // Claude 清理缓存后 filePath 可能变化，sessionId 仍然稳定。
        address: id
      });
    }
  }

  return sortByRecency(records);
}

function scanCodex(profile) {
  const root = profile.sessionRoot || path.join(os.homedir(), '.codex');
  const index = readCodexIndex(path.join(root, 'session_index.jsonl'));
  const dirs = [
    { dir: path.join(root, 'sessions'), source: 'Codex', archived: false },
    { dir: path.join(root, 'archived_sessions'), source: 'Codex 归档', archived: true }
  ];
  const records = [];
  const seen = new Set();

  for (const area of dirs) {
    for (const filePath of walkFiles(area.dir, (entry) => entry.isFile() && entry.name.endsWith('.jsonl'))) {
      const first = readFirstJsonLine(filePath);
      const payload = first?.payload || {};
      const id = text(payload.id) || text(payload.session_id) || uuidFromFilename(filePath) || path.basename(filePath, '.jsonl');
      if (seen.has(id)) continue;
      seen.add(id);

      const stat = safeStat(filePath);
      // Codex keys session_index.jsonl by session_id, which differs from
      // payload.id for most rollouts; look it up by session_id first so
      // titles (thread_name) actually resolve.
      const indexed = index.get(text(payload.session_id) || id);
      const title = cleanTitle(indexed?.title) || cleanTitle(payload.title) || `Codex 会话 ${id.slice(0, 8)}`;
      const createdAt = parseDate(first?.timestamp) || stat?.birthtime?.toISOString() || null;
      const updatedAt = indexed?.updatedAt || stat?.mtime?.toISOString() || createdAt;
      const projectPath = text(payload.cwd) || text(payload.current_dir) || null;
      const model = text(payload.model) || text(payload.model_provider) || null;

      records.push({
        id,
        appId: 'codex',
        title,
        createdAt,
        updatedAt,
        projectPath,
        source: area.source,
        status: area.archived ? '已归档' : '可用',
        model,
        filePath,
        address: id
      });
    }
  }

  return sortByRecency(records);
}

// Kimi Code（CLI / VS Code 插件）：<root>/sessions/<workspaceId>/session_<uuid>/state.json，
// 对话记录在同级 agents/<agentId>/wire.jsonl。state.json 直接给出标题与起止时间。
function scanKimi(profile) {
  const root = profile.sessionRoot || path.join(os.homedir(), '.kimi-code');
  const records = [];

  for (const filePath of walkFiles(
    path.join(root, 'sessions'),
    (entry, itemPath) => entry.isFile() && entry.name === 'state.json' && /session_[^/\\]+[/\\]state\.json$/.test(itemPath)
  )) {
    const json = readJson(filePath);
    if (!json) continue;
    const stat = safeStat(filePath);
    const id = path.basename(path.dirname(filePath));
    const shortId = id.replace(/^session_/, '').slice(0, 8);
    const title = cleanTitle(json.title) || `Kimi 会话 ${shortId}`;
    const createdAt = parseDate(json.createdAt) || stat?.birthtime?.toISOString() || null;
    const updatedAt = parseDate(json.updatedAt) || stat?.mtime?.toISOString() || createdAt;

    records.push({
      id,
      appId: 'kimi',
      title,
      createdAt,
      updatedAt,
      projectPath: text(json.workDir) || null,
      source: 'Kimi Code',
      status: '可用',
      model: null,
      filePath,
      address: id
    });
  }

  return sortByRecency(records);
}

// 「会话记录里的最后活跃时间」——比文件 mtime 干净（内容里的时间戳，不受乱 touch 影响）。
// 供猫状态判定用。filePath 由 activity.probeActivity 那趟 walk 顺带找出的最新会话文件传入，
// 这里只读这一个文件、不再自己遍历目录。返回毫秒时间戳或 null。

// Claude：读 local_*.json 内容里的 lastActivityAt（App 按轮次写）。用 parseDate 兼容数值/字符串两种格式。
function claudeActivityFromFile(filePath) {
  if (!filePath) return null;
  const json = readJson(filePath);
  if (!json) return null;
  const iso = parseDate(json.lastActivityAt);
  return iso ? new Date(iso).getTime() : null;
}

// Codex：读 rollout .jsonl 末行事件的 timestamp（生成时逐事件实时追加）。
function codexActivityFromFile(filePath) {
  return lastEventTimestamp(filePath);
}

// Kimi：probe 盯 state.json（每轮写 updatedAt）和 wire.jsonl（逐事件追加，字段是毫秒 time）。
// 传入哪个最新文件就读哪个，保证「正在干活」判定的实时性。
function kimiActivityFromFile(filePath) {
  if (!filePath) return null;
  if (filePath.endsWith('.jsonl')) return lastEventTimestamp(filePath);
  const json = readJson(filePath);
  if (!json) return null;
  const iso = parseDate(json.updatedAt);
  return iso ? new Date(iso).getTime() : null;
}

// 只读文件末尾 64KB，反向找最后一条带 timestamp 的事件（大 rollout 也便宜）。
function lastEventTimestamp(filePath) {
  if (!filePath) return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(64 * 1024, size);
    const buffer = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buffer, 0, len, size - len);
    const lines = buffer.subarray(0, len).toString('utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        // Codex 事件是 ISO 字符串 timestamp；Kimi wire 事件是数字毫秒 time
        const raw = obj.timestamp ?? obj.ts ?? obj.time ?? (obj.payload && obj.payload.timestamp);
        const ts = typeof raw === 'number' ? (raw > 10_000_000_000 ? raw : raw * 1000) : Date.parse(raw);
        if (Number.isFinite(ts) && ts > 0) return ts;
      } catch (_error) { /* 半行/非 JSON，继续往上找 */ }
    }
    return null;
  } catch (_error) {
    return null; // 打不开 / 读失败
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_error) { /* 已关或无效 */ } }
  }
}

function readCodexIndex(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      const id = text(json.id);
      if (!id) continue;
      map.set(id, {
        title: text(json.thread_name),
        updatedAt: parseDate(json.updated_at)
      });
    } catch (_error) {
      // Ignore partial lines written by a running app.
    }
  }
  return map;
}

function walkFiles(root, predicate) {
  const output = [];
  if (!root || !fs.existsSync(root)) return output;
  const pending = [root];
  let scanned = 0;

  while (pending.length && scanned < 12000) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      scanned += 1;
      const itemPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['Cache', 'GPUCache', 'node_modules'].includes(entry.name)) pending.push(itemPath);
      } else if (predicate(entry, itemPath)) {
        output.push(itemPath);
      }
    }
  }

  return output;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function readFirstJsonLine(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const first = buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/)[0];
    return first ? JSON.parse(first) : null;
  } catch (_error) {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (_error) {
    return null;
  }
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (/^\d+(\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanTitle(value) {
  const trimmed = text(value)?.trim();
  return trimmed || null;
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function uuidFromFilename(filePath) {
  const match = path.basename(filePath).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || null;
}

module.exports = { scanSessions, scanClaude, scanCodex, scanKimi, claudeActivityFromFile, codexActivityFromFile, kimiActivityFromFile, parseDate, cleanTitle, uuidFromFilename, text };
