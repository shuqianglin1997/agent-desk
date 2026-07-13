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

function scanSessions(profile) {
  const records = profile.appId === 'codex' ? scanCodex(profile) : scanClaude(profile);
  return records.sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
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
        address: filePath
      });
    }
  }

  return records;
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

  return records;
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

module.exports = { scanSessions, parseDate, cleanTitle, uuidFromFilename, text };
