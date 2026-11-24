'use strict';

/*
 * One per-file memo for the session scanners (docs/ARCHITECTURE_PLAN.md
 * phase 4). What a file says is parsed again only when the file changed:
 * the same path with the same size, modification time, inode and change time
 * is the same file. Each kind of parse ("claude-cli/head", "codex/tail", ...)
 * is remembered separately, so the session list and the activity probe share
 * one read of the same file.
 *
 *  - Callers get a shallow copy: changing a returned row never changes what
 *    is remembered. Remembered values are plain data.
 *  - A parse that throws is not remembered (a failed or unreadable read is
 *    tried again next time); the error goes to the caller.
 *  - A file that cannot be stat'ed is parsed every time and never cached.
 *  - At most LIMIT entries; the least recently used goes first.
 *
 * The memo lives in the module, so each thread (Main, the scan worker) has
 * its own.
 */

const fs = require('node:fs');

const LIMIT = 20000;
const entries = new Map();
let hits = 0;
let parses = 0;

function revisionOf(stat) {
  if (!stat || typeof stat.size !== 'number') return null;
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function copy(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

/**
 * The remembered result of parse(filePath, stat) for this kind of read.
 * `stat` may be passed when the caller already has it; undefined means
 * stat here, null means the file is gone (parsed, never cached).
 */
function remember(kind, filePath, parse, stat) {
  let current = stat;
  if (current === undefined) {
    try { current = fs.statSync(filePath); } catch (_error) { current = null; }
  }
  const revision = revisionOf(current);
  const key = `${kind}\u0000${filePath}`;
  if (revision) {
    const hit = entries.get(key);
    if (hit && hit.revision === revision) {
      hits += 1;
      entries.delete(key);
      entries.set(key, hit);
      return copy(hit.value);
    }
  }
  parses += 1;
  const value = parse(filePath, current);
  if (revision) {
    entries.delete(key);
    entries.set(key, { revision, value });
    if (entries.size > LIMIT) entries.delete(entries.keys().next().value);
  } else {
    entries.delete(key);
  }
  return copy(value);
}

// A read that failed: thrown by a parse so that nothing is remembered.
function unreadable(filePath) {
  const error = new Error('file-unreadable');
  error.code = 'file-unreadable';
  error.filePath = filePath;
  return error;
}

function stats() {
  return { entries: entries.size, hits, parses };
}

function clear() {
  entries.clear();
  hits = 0;
  parses = 0;
}

module.exports = { remember, unreadable, stats, clear, LIMIT };
