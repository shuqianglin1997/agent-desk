'use strict';

/*
 * Catshelf — Antigravity conversation scanner.
 *
 * Antigravity (Google's agent desktop app, 2.x) keeps one summary row per
 * conversation in SQLite, <sessionRoot>/conversation_summaries.db
 * (sessionRoot is ~/.gemini/antigravity):
 *   conversation_summaries: conversation_id (key), title, preview,
 *     last_modified_time, last_user_input_time, workspace_uris, status,
 *     not_fully_idle, killed, parent_conversation_id, nesting_depth, ...
 *   conversation_parents: conversation_id → parent_id
 * The conversation body is conversations/<id>.pb (protobuf without a public
 * schema; never read here) and the agent's artifacts are in brain/<id>/.
 *
 * Read through the system sqlite3 with -readonly (../sqlite.js), never
 * raw_summary or the full-text tables. The structure was checked on
 * Antigravity 2.34.0 (macOS) with an empty table; value formats are read
 * defensively (Go times as text or numbers, booleans as 0/1 or words,
 * workspace_uris as a JSON list or plain URIs).
 *
 * Sub-conversations (a parent, a nesting depth above 0, or a row in
 * conversation_parents) are internal and never listed. A database that is
 * missing means no conversations; one that exists but cannot be read, or whose
 * table is missing or unknown, is a failure with a fixed code, never "none".
 */

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { querySqlite, storeUnreadable } = require('../sqlite');
const { parseDate, cleanTitle } = require('../scan');
const TIME_WINDOWS = require('../../core/time-windows');

const DB_NAME = 'conversation_summaries.db';
const SUMMARIES = 'conversation_summaries';
const PARENTS = 'conversation_parents';
const REQUIRED = ['conversation_id', 'last_modified_time'];
const OPTIONAL = ['title', 'preview', 'last_user_input_time', 'workspace_uris', 'status', 'not_fully_idle', 'killed', 'parent_conversation_id', 'nesting_depth'];
const ROW_LIMIT = 2000;
// Before this, a time is Go's zero time or garbage, not a real one.
const EARLIEST = Date.UTC(2000, 0, 1);
// Only ids that are plain file names are joined into paths.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function dbPath(profile) {
  return path.join(profile.sessionRoot, DB_NAME);
}

// A Go time as text ("2026-11-26 08:32:01.123456789+08:00", "… +0800 CST",
// RFC 3339) or a number; null for a missing, zero or unreadable time.
const GO_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?(?:\s+[A-Za-z]{1,6})?(?:\s+m=[+-]?\d+(?:\.\d+)?)?$/;
function parseTime(value) {
  let iso = null;
  if (typeof value === 'string') {
    const match = value.trim().match(GO_TIME);
    if (match) {
      const fraction = match[3] ? match[3].slice(0, 4) : '';
      let zone = match[4] || 'Z';
      if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
      iso = parseDate(`${match[1]}T${match[2]}${fraction}${zone}`);
    }
  }
  if (!iso && (typeof value === 'number' || typeof value === 'string')) {
    try { iso = parseDate(value); } catch (_error) { iso = null; }
  }
  const millis = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(millis) && millis >= EARLIEST ? iso : null;
}

function flag(value) {
  if (value === true || value === 1) return true;
  return typeof value === 'string' && /^(?:1|true|t|yes)$/i.test(value.trim());
}

function localPath(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 4096 || text.includes('\0')) return null;
  if (/^file:/i.test(text)) {
    try { return path.normalize(fileURLToPath(text)); } catch (_error) { return null; }
  }
  // Remote workspaces (ssh, containers) have no folder on this computer.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  return path.isAbsolute(text) ? path.normalize(text) : null;
}

// workspace_uris: a JSON list of URIs (or of objects with one), one URI, or
// URIs on separate lines. Returns local folder paths, first one first.
function workspacePaths(value) {
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];
  let items;
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    items = text.split(/\r?\n/);
  }
  const paths = [];
  for (const item of items) {
    const candidate = typeof item === 'string' ? item
      : (item && typeof item === 'object' ? (item.uri ?? item.folderUri ?? item.path ?? null) : null);
    const resolved = localPath(candidate);
    if (resolved && !paths.includes(resolved)) paths.push(resolved);
  }
  return paths;
}

function firstLine(value) {
  const line = cleanTitle(String(value ?? '').split(/\r?\n/).find((part) => part.trim()) || '');
  return line ? line.slice(0, 200) : null;
}

function later(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

// Which tables and columns the database has: Map<table, Set<column>>.
function readSchema(db) {
  const result = querySqlite(db,
    "SELECT m.name AS tableName, p.name AS columnName FROM sqlite_master AS m " +
    'JOIN pragma_table_info(m.name) AS p ' +
    `WHERE m.type = 'table' AND m.name IN ('${SUMMARIES}', '${PARENTS}');`
  );
  if (!result.ok) throw storeUnreadable(result.code === 'sqlite-unavailable' ? result.code : 'session-store-unreadable');
  const tables = new Map();
  for (const row of result.value) {
    if (!tables.has(row.tableName)) tables.set(row.tableName, new Set());
    tables.get(row.tableName).add(row.columnName);
  }
  return tables;
}

function normalizeRow(row) {
  const id = String(row.conversation_id ?? '').trim();
  const modifiedAt = parseTime(row.last_modified_time);
  const inputAt = parseTime(row.last_user_input_time);
  const archived = /archiv/i.test(String(row.status ?? ''));
  return {
    id,
    title: cleanTitle(row.title),
    preview: firstLine(row.preview),
    updatedAt: later(modifiedAt, inputAt),
    workspaces: workspacePaths(row.workspace_uris),
    archived,
    // Antigravity's own flag that the agent has not settled. A killed run is
    // stopped, so it never counts as running; the conversation stays listed.
    running: !archived && flag(row.not_fully_idle) && !flag(row.killed)
  };
}

// The user's own conversations, newest first (at most ROW_LIMIT rows).
function readSummaryRows(db) {
  const tables = readSchema(db);
  const columns = tables.get(SUMMARIES);
  // A table this version does not have, or without the columns we read, is a
  // format Catshelf does not know: a failure, never "no conversations".
  if (!columns || !REQUIRED.every((name) => columns.has(name))) throw storeUnreadable('session-store-unreadable');
  const select = [...REQUIRED, ...OPTIONAL].map((name) => (columns.has(name) ? `\`${name}\`` : `NULL AS \`${name}\``));
  const where = ["COALESCE(`conversation_id`, '') <> ''"];
  if (columns.has('parent_conversation_id')) where.push("COALESCE(`parent_conversation_id`, '') = ''");
  if (columns.has('nesting_depth')) where.push('COALESCE(`nesting_depth`, 0) <= 0');
  if (tables.get(PARENTS)?.has('conversation_id')) {
    where.push(`\`conversation_id\` NOT IN (SELECT \`conversation_id\` FROM \`${PARENTS}\` WHERE \`conversation_id\` IS NOT NULL)`);
  }
  const result = querySqlite(db,
    `SELECT ${select.join(', ')} FROM \`${SUMMARIES}\` WHERE ${where.join(' AND ')} ` +
    `ORDER BY \`last_modified_time\` DESC LIMIT ${ROW_LIMIT};`
  );
  if (!result.ok) throw storeUnreadable(result.code === 'sqlite-unavailable' ? result.code : 'session-store-unreadable');
  if (!Array.isArray(result.value)) throw storeUnreadable('session-store-unreadable');
  return result.value.map(normalizeRow).filter((row) => row.id);
}

// The list, the counts and the activity time share one read while the
// database and its write-ahead log are unchanged.
const memo = new Map();
const MEMO_LIMIT = 32;
function revisionOf(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (_error) {
    return '-';
  }
}

function summaryRows(db) {
  const revision = `${revisionOf(db)}|${revisionOf(`${db}-wal`)}`;
  const hit = memo.get(db);
  if (hit && hit.revision === revision) return hit.rows;
  const rows = readSummaryRows(db);
  memo.delete(db);
  memo.set(db, { revision, rows });
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value);
  return rows;
}

function isDirectory(itemPath) {
  try { return fs.statSync(itemPath).isDirectory(); } catch (_error) { return false; }
}

function isFile(itemPath) {
  try { return fs.statSync(itemPath).isFile(); } catch (_error) { return false; }
}

// Where the conversation lives, for the copied coordinate and "open folder":
// its artifact folder (brain/<id>, readable Markdown), else its own record
// (conversations/<id>.pb), else the summary database that holds its row.
function conversationLocator(sessionRoot, id, db) {
  if (!SAFE_ID.test(id) || id.includes('..')) return db;
  const brain = path.join(sessionRoot, 'brain', id);
  if (isDirectory(brain)) return brain;
  const record = path.join(sessionRoot, 'conversations', `${id}.pb`);
  if (isFile(record)) return record;
  return db;
}

function toRecord(row, sessionRoot, db) {
  return {
    id: row.id,
    appId: 'antigravity',
    title: row.title || row.preview || `Antigravity 会话 ${row.id.slice(0, 8)}`,
    // No creation time is recorded; unknown stays unknown.
    createdAt: null,
    updatedAt: row.updatedAt,
    projectPath: row.workspaces[0] || null,
    source: 'Antigravity',
    status: row.archived ? '已归档' : '可用',
    model: null,
    filePath: conversationLocator(sessionRoot, row.id, db),
    address: row.id
  };
}

function scanAntigravity(profile) {
  const db = dbPath(profile);
  if (!fs.existsSync(db)) return [];
  const records = summaryRows(db).map((row) => toRecord(row, profile.sessionRoot, db));
  return records.sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0));
}

function startOfDay(now) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// For the activity probe: conversations are database rows, so file counts
// would be wrong. "Running" is Antigravity's own not-settled flag on the
// user's conversations; the creation time is not recorded, so createdToday is
// left to the probe.
function sessionCounts(profile, now = Date.now()) {
  const zero = { sessionCount: 0, activeNow: 0, activeToday: 0, writingNow: 0, writingAddresses: [] };
  const db = dbPath(profile);
  if (!fs.existsSync(db)) return zero;
  const rows = summaryRows(db);
  const today = startOfDay(now);
  const counts = { ...zero, sessionCount: rows.length, writingAddresses: [] };
  for (const row of rows) {
    const at = Date.parse(row.updatedAt || '');
    if (Number.isFinite(at) && at >= today && at <= now + 1000) counts.activeToday += 1;
    if (!row.archived && Number.isFinite(at) && at >= now - TIME_WINDOWS.ACTIVE_NOW_MS && at <= now + 1000) counts.activeNow += 1;
    if (row.running) {
      counts.writingNow += 1;
      counts.writingAddresses.push(row.id);
    }
  }
  return counts;
}

// The newest conversation time in milliseconds, or null.
function latestActivity(profile) {
  const db = dbPath(profile);
  if (!fs.existsSync(db)) return null;
  let latest = null;
  for (const row of summaryRows(db)) {
    const at = Date.parse(row.updatedAt || '');
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

module.exports = { DB_NAME, dbPath, scanAntigravity, sessionCounts, latestActivity, parseTime, workspacePaths };
