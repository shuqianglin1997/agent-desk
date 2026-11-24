'use strict';

// Read-only queries through the system sqlite3 program (macOS /usr/bin/sqlite3)
// with -readonly -json: no third-party dependency and no lock on the client's
// database, so it can be read while the client is open.

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { ok, fail, valueOr } = require('../core/result');

function sqlite3Bin() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sqlite3')) return '/usr/bin/sqlite3';
  return 'sqlite3'; // 其他平台走 PATH；不存在时 query 会优雅失败
}

// One read-only query. ok(rows) | fail('sqlite-unavailable' when the sqlite3
// program cannot run, 'sqlite-query-failed' when it ran and the query failed:
// locked, damaged, or a table this client version does not have).
function querySqlite(dbPath, sql) {
  let out;
  try {
    out = execFileSync(sqlite3Bin(), ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (error) {
    return fail(error?.code === 'ENOENT' || error?.code === 'EACCES' ? 'sqlite-unavailable' : 'sqlite-query-failed');
  }
  try {
    const trimmed = out.trim();
    return ok(trimmed ? JSON.parse(trimmed) : []);
  } catch (_error) {
    return fail('sqlite-query-failed');
  }
}

// Rows, or null when the query failed.
function queryJson(dbPath, sql) {
  return valueOr(querySqlite(dbPath, sql), null);
}

function storeUnreadable(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = { sqlite3Bin, querySqlite, queryJson, storeUnreadable };
