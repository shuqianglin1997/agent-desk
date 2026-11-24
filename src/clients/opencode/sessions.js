'use strict';

// OpenCode sessions: <data>/opencode.db (session_v2 in v2, session in v1, and
// project), or legacy <data>/storage/session/<project>/<id>.json. SQLite is
// opened read-only. One row per user conversation; child sessions are internal.

const path = require('node:path');
const { MAX_ROWS, MAX_FILES, iso, cleanTitle, listDirectory, readJson, sortByRecency } = require('../cli-scan');

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

module.exports = { scanOpenCode };
