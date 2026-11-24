'use strict';

/*
 * Read-only session scanners for OpenCode, Gemini CLI and Qwen Code.
 *
 * One row per user conversation: subagent, sidechain and child records are
 * internal and never become rows. Files and databases are only read; SQLite is
 * opened read-only. Every reader is bounded and best-effort, like the other
 * scanners: a broken file or table is skipped, never repaired.
 *
 * Formats (from each project's source, 2026-11):
 *   OpenCode  <data>/opencode.db — session_v2 (v2) or session (v1), project;
 *             legacy <data>/storage/session/<project>/<id>.json
 *   Gemini    <home>/.gemini/tmp/<slug>/chats/session-*.jsonl (first line is
 *             metadata; `$set` updates; kind "subagent" is internal), older
 *             whole-file session-*.json; path from projects.json or .project_root
 *   Qwen      <home>/projects/<cwd>/chats/<uuid>.jsonl (+ chats/archive/),
 *             title from the last system/custom_title or the first user prompt
 *   DSH       <home>/sessions/--<cwd>--/<id>/session.vN.jsonl[.zstd]
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_FILES = 4000;

function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(number) && String(value).trim() !== ''
    ? new Date(number > 10_000_000_000 ? number : number * 1000)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanTitle(value, limit = 120) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch (_error) { return null; }
}

function listDirectory(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); } catch (_error) { return []; }
}

function readText(filePath, limit = MAX_FILE_BYTES) {
  const stat = safeStat(filePath);
  if (!stat?.isFile()) return null;
  try {
    if (stat.size <= limit) return fs.readFileSync(filePath, 'utf8');
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(limit);
      const read = fs.readSync(descriptor, buffer, 0, limit, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (_error) {
    return null;
  }
}

function readJson(filePath, limit = MAX_FILE_BYTES) {
  const text = readText(filePath, limit);
  if (text === null) return null;
  try { return JSON.parse(text); } catch (_error) { return null; }
}

function jsonLines(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (_error) { /* half-written line */ }
  }
  return records;
}

function sortByRecency(records) {
  return records.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

// Gemini `content` and Qwen `message.parts`: a string, a part or a list of parts.
function partsText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(partsText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return partsText(value.parts);
  }
  return '';
}

// ---------- OpenCode ----------

function openReadOnly(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file, { readOnly: true });
  } catch (_error) {
    return null;
  }
}

function tableColumns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); } catch (_error) { return new Set(); }
}

function openCodeDatabaseRows(file) {
  const db = openReadOnly(file);
  if (!db) return [];
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const projects = tables.has('project') ? tableColumns(db, 'project') : new Set();
    const join = projects.has('id') && projects.has('worktree');
    const rows = [];
    for (const table of ['session_v2', 'session']) {
      if (!tables.has(table)) continue;
      const columns = tableColumns(db, table);
      if (!columns.has('id')) continue;
      const pick = (column) => (columns.has(column) ? `s.${column}` : 'NULL');
      const where = columns.has('parent_id') ? 'WHERE s.parent_id IS NULL' : '';
      const order = columns.has('time_updated') ? 'ORDER BY s.time_updated DESC' : '';
      const sql = `SELECT s.id AS id, ${pick('title')} AS title, ${pick('directory')} AS directory,
        ${pick('time_created')} AS created, ${pick('time_updated')} AS updated, ${pick('time_archived')} AS archived,
        ${join && columns.has('project_id') ? 'p.worktree' : 'NULL'} AS worktree
        FROM ${table} s ${join && columns.has('project_id') ? 'LEFT JOIN project p ON p.id = s.project_id' : ''}
        ${where} ${order} LIMIT ${MAX_ROWS}`;
      try { rows.push(...db.prepare(sql).all().map((row) => ({ ...row, table }))); } catch (_error) { /* unknown layout */ }
    }
    return rows;
  } catch (_error) {
    return [];
  } finally {
    try { db.close(); } catch (_error) { /* closed */ }
  }
}

function scanOpenCode(profile) {
  const root = profile.sessionRoot;
  const records = new Map();
  const databases = listDirectory(root)
    .filter((entry) => entry.isFile() && /^opencode(?:-[\w.-]+)?\.db$/.test(entry.name))
    .map((entry) => path.join(root, entry.name));
  for (const file of databases) {
    for (const row of openCodeDatabaseRows(file)) {
      const id = String(row.id || '');
      // A v2 database still holds migrated v1 rows; the v2 row wins.
      if (!id || (records.has(id) && row.table !== 'session_v2')) continue;
      const createdAt = iso(row.created);
      records.set(id, {
        id,
        appId: 'opencode',
        title: cleanTitle(row.title) || `OpenCode ${id.replace(/^ses_/, '').slice(0, 8)}`,
        createdAt,
        updatedAt: iso(row.updated) || createdAt,
        projectPath: (typeof row.worktree === 'string' && row.worktree !== '/' ? row.worktree : null) || (typeof row.directory === 'string' ? row.directory : null),
        source: 'OpenCode',
        status: row.archived ? '已归档' : '可用',
        model: null,
        filePath: file,
        address: id
      });
    }
  }
  // Older releases kept one JSON file per session.
  const storage = path.join(root, 'storage', 'session');
  let files = 0;
  for (const projectEntry of listDirectory(storage)) {
    if (!projectEntry.isDirectory()) continue;
    for (const entry of listDirectory(path.join(storage, projectEntry.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || ++files > MAX_FILES) continue;
      const filePath = path.join(storage, projectEntry.name, entry.name);
      const json = readJson(filePath, 1024 * 1024);
      if (!json || typeof json.id !== 'string' || json.parentID || records.has(json.id)) continue;
      const createdAt = iso(json.time?.created);
      records.set(json.id, {
        id: json.id,
        appId: 'opencode',
        title: cleanTitle(json.title) || `OpenCode ${json.id.replace(/^ses_/, '').slice(0, 8)}`,
        createdAt,
        updatedAt: iso(json.time?.updated) || createdAt,
        projectPath: typeof json.directory === 'string' ? json.directory : null,
        source: 'OpenCode',
        status: json.time?.archived ? '已归档' : '可用',
        model: null,
        filePath,
        address: json.id
      });
    }
  }
  return sortByRecency([...records.values()]);
}

// ---------- Gemini CLI ----------

function geminiProjectRoots(root) {
  const roots = new Map();
  const registry = readJson(path.join(root, 'projects.json'), 1024 * 1024);
  for (const [projectPath, slug] of Object.entries(registry?.projects || {})) {
    if (typeof slug === 'string') roots.set(slug, projectPath);
  }
  return roots;
}

function geminiTitle(messages, summary) {
  if (cleanTitle(summary)) return cleanTitle(summary);
  for (const message of messages) {
    if (message?.type !== 'user') continue;
    const text = cleanTitle(partsText(message.content));
    if (text && !text.startsWith('/')) return text;
  }
  return '';
}

function scanGeminiFile(filePath, projectPath) {
  const stat = safeStat(filePath);
  if (filePath.endsWith('.json')) {
    const json = readJson(filePath);
    if (!json || typeof json.sessionId !== 'string' || json.kind === 'subagent') return null;
    return {
      id: json.sessionId,
      title: geminiTitle(json.messages || [], json.summary),
      createdAt: iso(json.startTime),
      updatedAt: iso(json.lastUpdated) || stat?.mtime?.toISOString() || null
    };
  }
  const lines = jsonLines(readText(filePath));
  const meta = lines[0];
  if (!meta || typeof meta.sessionId !== 'string' || meta.kind === 'subagent') return null;
  let summary = meta.summary;
  let lastUpdated = meta.lastUpdated;
  const messages = [];
  for (const record of lines.slice(1)) {
    if (record?.$set && typeof record.$set === 'object') {
      if (typeof record.$set.summary === 'string') summary = record.$set.summary;
      if (record.$set.lastUpdated) lastUpdated = record.$set.lastUpdated;
    } else if (record?.type) {
      messages.push(record);
      if (record.timestamp) lastUpdated = record.timestamp;
    }
  }
  return {
    id: meta.sessionId,
    title: geminiTitle(messages, summary),
    createdAt: iso(meta.startTime),
    updatedAt: iso(lastUpdated) || stat?.mtime?.toISOString() || null,
    projectPath
  };
}

function scanGemini(profile) {
  const root = profile.sessionRoot;
  const roots = geminiProjectRoots(root);
  const records = new Map();
  let files = 0;
  for (const slugEntry of listDirectory(path.join(root, 'tmp'))) {
    if (!slugEntry.isDirectory()) continue;
    const slugDir = path.join(root, 'tmp', slugEntry.name);
    const projectPath = roots.get(slugEntry.name) || (readText(path.join(slugDir, '.project_root'), 4096) || '').trim() || null;
    // Only files directly in chats/: subagents live in chats/<parentId>/.
    for (const entry of listDirectory(path.join(slugDir, 'chats'))) {
      if (!entry.isFile() || !/^session-.*\.jsonl?$/.test(entry.name) || ++files > MAX_FILES) continue;
      const filePath = path.join(slugDir, 'chats', entry.name);
      const parsed = scanGeminiFile(filePath, projectPath);
      if (!parsed || records.has(parsed.id)) continue;
      records.set(parsed.id, {
        id: parsed.id,
        appId: 'gemini-cli',
        title: parsed.title || `Gemini ${parsed.id.slice(0, 8)}`,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt || parsed.createdAt,
        projectPath: parsed.projectPath || projectPath,
        source: 'Gemini CLI',
        status: '可用',
        model: null,
        filePath,
        address: parsed.id
      });
    }
  }
  return sortByRecency([...records.values()]);
}

// ---------- Qwen Code ----------

function qwenPromptText(record) {
  const display = record?.systemPayload?.displayText;
  if (typeof display === 'string') return display.trim();
  return partsText(record?.message?.parts || record?.message?.content || '').trim();
}

function scanQwenFile(filePath) {
  const lines = jsonLines(readText(filePath));
  let id = path.basename(filePath, '.jsonl');
  let customTitle = '';
  let firstPrompt = '';
  let cwd = null;
  let firstAt = null;
  let lastAt = null;
  let child = false;
  for (const record of lines) {
    if (!record || typeof record !== 'object') continue;
    if (typeof record.sessionId === 'string' && record.sessionId) id = record.sessionId;
    if (record.timestamp) {
      firstAt ||= record.timestamp;
      lastAt = record.timestamp;
    }
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (record.type === 'system' && record.subtype === 'custom_title') {
      customTitle = cleanTitle(record.systemPayload?.customTitle) || customTitle;
    } else if (record.type === 'system' && record.subtype === 'parent_session') {
      child = true;
    } else if (record.type === 'user' && record.subtype === undefined && !record.isSidechain && !firstPrompt) {
      firstPrompt = cleanTitle(qwenPromptText(record));
    }
  }
  if (child || !lines.length) return null;
  return { id, title: customTitle || firstPrompt, cwd, createdAt: iso(firstAt), updatedAt: iso(lastAt) };
}

function scanQwen(profile) {
  const root = profile.sessionRoot;
  const records = new Map();
  let files = 0;
  for (const projectEntry of listDirectory(path.join(root, 'projects'))) {
    if (!projectEntry.isDirectory()) continue;
    const chats = path.join(root, 'projects', projectEntry.name, 'chats');
    for (const [directory, archived] of [[chats, false], [path.join(chats, 'archive'), true]]) {
      for (const entry of listDirectory(directory)) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl') || ++files > MAX_FILES) continue;
        const filePath = path.join(directory, entry.name);
        const parsed = scanQwenFile(filePath);
        if (!parsed || (records.has(parsed.id) && archived)) continue;
        const stat = safeStat(filePath);
        records.set(parsed.id, {
          id: parsed.id,
          appId: 'qwen-code',
          title: parsed.title || `Qwen ${parsed.id.slice(0, 8)}`,
          createdAt: parsed.createdAt || stat?.birthtime?.toISOString() || null,
          updatedAt: parsed.updatedAt || stat?.mtime?.toISOString() || parsed.createdAt,
          projectPath: parsed.cwd,
          source: 'Qwen Code',
          status: archived ? '已归档' : '可用',
          model: null,
          filePath,
          address: parsed.id
        });
      }
    }
  }
  return sortByRecency([...records.values()]);
}

// ---------- DSH ----------
// $DSH_HOME/sessions/--<cwd>--/<id>/session.vN.jsonl[.zstd]: the highest
// generation wins. Line 1 is the header ({ type: "session", id, createdAt,
// cwd?, parentSession?, delegationDepth }); a session with a parent or a
// delegation depth is a child and is not listed. The title is the latest
// session/title event.
const MAX_DSH_LOG_BYTES = 32 * 1024 * 1024;

function dshLogFile(directory) {
  let best = null;
  for (const entry of listDirectory(directory)) {
    if (!entry.isFile()) continue;
    const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry.name);
    if (!match) continue;
    const version = match[1] ? Number(match[1]) : 0;
    if (!best || version > best.version) best = { version, file: path.join(directory, entry.name), compressed: Boolean(match[2]) };
  }
  return best;
}

// The length of one zstd frame starting at offset (RFC 8878 frame and block
// headers), so concatenated frames can be decoded one at a time: Node's
// zstdDecompressSync stops after the first frame.
function zstdFrameLength(bytes, offset) {
  if (offset + 8 > bytes.length) return 0;
  const magic = bytes.readUInt32LE(offset);
  if ((magic & 0xfffffff0) === 0x184d2a50) return 8 + bytes.readUInt32LE(offset + 4); // skippable frame
  if (magic !== 0xfd2fb528) return 0;
  let position = offset + 4;
  const descriptor = bytes[position++];
  const sizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const checksum = (descriptor >> 2) & 1;
  if (!singleSegment) position += 1;
  position += [0, 1, 2, 4][descriptor & 3];
  position += sizeFlag === 0 ? singleSegment : [0, 2, 4, 8][sizeFlag];
  for (;;) {
    if (position + 3 > bytes.length) return 0;
    const header = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
    position += 3;
    const type = (header >> 1) & 3;
    if (type === 3) return 0;
    position += type === 1 ? 1 : header >>> 3;
    if (header & 1) break;
  }
  if (checksum) position += 4;
  return position <= bytes.length ? position - offset : 0;
}

function decodeZstdFrames(bytes) {
  const zlib = require('node:zlib');
  const parts = [];
  let total = 0;
  for (let offset = 0; offset < bytes.length;) {
    const length = zstdFrameLength(bytes, offset);
    if (!length) break; // a torn last frame contributes nothing, as in DSH itself
    if (bytes.readUInt32LE(offset) === 0xfd2fb528) {
      const frame = zlib.zstdDecompressSync(bytes.subarray(offset, offset + length), { maxOutputLength: 4 * MAX_DSH_LOG_BYTES });
      total += frame.length;
      if (total > 4 * MAX_DSH_LOG_BYTES) break;
      parts.push(frame);
    }
    offset += length;
  }
  return Buffer.concat(parts).toString('utf8');
}

function readDshLog(log) {
  const stat = safeStat(log.file);
  if (!stat?.isFile() || stat.size > MAX_DSH_LOG_BYTES) return null;
  try {
    const bytes = fs.readFileSync(log.file);
    return log.compressed ? decodeZstdFrames(bytes) : bytes.toString('utf8');
  } catch (_error) {
    return null;
  }
}

function dshTitle(record) {
  const value = record?.data?.title ?? record?.payload?.title ?? record?.title;
  return typeof value === 'string' ? value : '';
}

function scanDsh(profile) {
  const root = path.join(profile.sessionRoot, 'sessions');
  const records = new Map();
  let files = 0;
  for (const projectEntry of listDirectory(root)) {
    if (!projectEntry.isDirectory()) continue;
    for (const sessionEntry of listDirectory(path.join(root, projectEntry.name))) {
      if (!sessionEntry.isDirectory() || ++files > MAX_FILES) continue;
      const log = dshLogFile(path.join(root, projectEntry.name, sessionEntry.name));
      if (!log) continue;
      const lines = jsonLines(readDshLog(log));
      const header = lines[0];
      if (!header || header.type !== 'session' || typeof header.id !== 'string') continue;
      if (header.parentSession || Number(header.delegationDepth) > 0 || records.has(header.id)) continue;
      let title = '';
      for (const record of lines.slice(1)) if (record?.type === 'session/title' && dshTitle(record)) title = dshTitle(record);
      const stat = safeStat(log.file);
      const createdAt = iso(header.createdAt);
      records.set(header.id, {
        id: header.id,
        appId: 'dsh-cli',
        title: cleanTitle(title) || `DSH ${header.id.replace(/^session-/, '').slice(0, 8)}`,
        createdAt,
        updatedAt: stat?.mtime?.toISOString() || createdAt,
        projectPath: typeof header.cwd === 'string' ? header.cwd : null,
        source: 'DSH',
        status: '可用',
        model: null,
        filePath: log.file,
        address: header.id
      });
    }
  }
  return sortByRecency([...records.values()]);
}

module.exports = { scanOpenCode, scanGemini, scanQwen, scanDsh, partsText };
