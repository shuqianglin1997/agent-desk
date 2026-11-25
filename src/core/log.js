'use strict';

// Catshelf's own small log, for whoever helps when something goes wrong
// (docs/FIX_AND_REBUILD.md): start-up phases, the build, uncaught exceptions
// and the fixed reason codes of failed operations. A line holds a fixed event
// name and whitelisted values only, never free text: no keys, tokens, session
// contents, titles, account names or e-mail addresses; an error is its name,
// its code and where in the source it was thrown, not its message. Paths under
// the home folder start with ~. At most three files of about 1 MiB:
// catshelf.log, then catshelf.1.log and catshelf.2.log.
//
// Where it lives (logDirectory): macOS ~/Library/Logs/Catshelf (Electron's
// app.getPath('logs') for this name); Windows and Linux the data folder's
// logs/ (%APPDATA%\AgentDesk\logs); with an explicit --user-data-dir (tests,
// portable setups) always <that folder>/logs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRODUCT_NAME } = require('./product');

const LOG_FILE = 'catshelf.log';
const MAX_BYTES = 1024 * 1024;
const KEEP_FILES = 3;
const MAX_LINE = 2048;
const REPEAT_MS = 10 * 60_000;
const TAIL_BYTES = 256 * 1024;

const EVENT = /^[a-z][a-z0-9.-]{0,63}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
// Codes, versions, commits, platform names: no spaces, slashes or @.
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,79}$/;
const HEX_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// Where in Catshelf's own source, or in Node's: never another path.
const FRAME = /^(?:(?:src|scripts|test)\/[A-Za-z0-9_./-]{1,160}|node:[A-Za-z0-9_/.-]{1,80}):\d{1,6}:\d{1,6}$/;

/** @param {string} home */
function homePattern(home) {
  if (!home || home.length < 2) return null;
  const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')]);
  const escaped = [...variants].sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), process.platform === 'win32' ? 'gi' : 'g');
}

/**
 * The last line of defence, applied to every line written and read: the home
 * folder becomes ~, e-mail addresses and things shaped like keys or tokens
 * are replaced.
 * @param {string} text
 * @param {string} [home]
 */
function redact(text, home = os.homedir()) {
  let value = String(text);
  const pattern = homePattern(home);
  if (pattern) value = value.replace(pattern, '~');
  return value
    .replace(/[^\s@"'<>()[\]{},;]+@[^\s@"'<>()[\]{},;]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '<secret>')
    .replace(/\b(?:gh[pousr]_|github_pat_|xox[abposr]-|AIza|glpat-)[A-Za-z0-9_-]{8,}/g, '<secret>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '<secret>')
    .replace(/\b[A-Za-z0-9+_-]{32,}={0,2}/g, (match) => (HEX_ID.test(match) ? match : '<secret>'));
}

/** @param {unknown} value */
function safeValue(value) {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '?';
  if (typeof value !== 'string') return '?';
  if (HEX_ID.test(value)) return value;
  if (!VALUE.test(value) || redact(value, '') !== value) return '?';
  // A long mixed-case value with digits looks like a key; codes and versions are not.
  if (value.length >= 24 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) return '?';
  return value;
}

/**
 * An error as fixed fields: its name, its code when it has a code-like one,
 * and up to eight places in Catshelf's source (relative to `appRoot`). The
 * message is left out: it can quote paths, file contents or a key.
 * @param {any} error
 * @param {string} appRoot
 */
function errorFields(error, appRoot) {
  const fields = {};
  const name = typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : (error instanceof Error ? 'Error' : typeof error);
  fields.error = name;
  if (typeof error?.code === 'string' || typeof error?.code === 'number') fields.code = error.code;
  const stack = typeof error?.stack === 'string' ? error.stack.split('\n') : [];
  const root = appRoot ? path.resolve(appRoot) : null;
  const frames = [];
  for (const line of stack) {
    const match = line.match(/^\s+at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) continue;
    let file = match[1].replace(/^file:\/\//, '');
    if (file.startsWith('node:')) frames.push(`${file}:${match[2]}:${match[3]}`);
    else if (root && path.resolve(file).startsWith(root + path.sep)) {
      frames.push(`${path.relative(root, path.resolve(file)).split(path.sep).join('/')}:${match[2]}:${match[3]}`);
    } else frames.push('?');
    if (frames.length >= 8) break;
  }
  const kept = frames.filter((frame) => frame === '?' || FRAME.test(frame));
  if (kept.length) fields.at = kept.join(',');
  return fields;
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
function formatFields(event, fields) {
  const parts = [EVENT.test(event) ? event : 'event-invalid'];
  for (const [key, value] of Object.entries(fields || {})) {
    if (!KEY.test(key) || value === undefined) continue;
    if (key === 'at' && typeof value === 'string' && value.split(',').every((frame) => frame === '?' || FRAME.test(frame))) {
      parts.push(`at=${value}`);
      continue;
    }
    parts.push(`${key}=${safeValue(value)}`);
  }
  return parts.join(' ');
}

/**
 * @param {{ platform?: string, home?: string, userData: string, explicitUserData?: boolean }} options
 */
function logDirectory({ platform = process.platform, home = os.homedir(), userData, explicitUserData = false }) {
  if (explicitUserData || platform !== 'darwin') return path.join(userData, 'logs');
  return path.join(home, 'Library', 'Logs', PRODUCT_NAME);
}

/** @param {string} directory @param {number} index */
const fileAt = (directory, index) => path.join(directory, index ? `catshelf.${index}.log` : LOG_FILE);

/**
 * @param {{ directory: string, home?: string, appRoot?: string, maxBytes?: number, keep?: number, now?: () => Date }} options
 */
function createLog({ directory, home = os.homedir(), appRoot = path.join(__dirname, '..', '..'), maxBytes = MAX_BYTES, keep = KEEP_FILES, now = () => new Date() }) {
  const file = fileAt(directory, 0);
  const recent = new Map();

  function rotate() {
    for (let index = keep - 1; index >= 1; index -= 1) {
      try { fs.renameSync(fileAt(directory, index - 1), fileAt(directory, index)); } catch (_error) { /* not there yet */ }
    }
  }

  /** @param {string} body */
  function append(body) {
    const time = now();
    const key = body;
    const last = recent.get(key);
    if (last !== undefined && time.getTime() - last < REPEAT_MS) return false;
    if (recent.size >= 256) recent.clear();
    recent.set(key, time.getTime());
    let line = `${time.toISOString()} ${redact(body, home)}`;
    if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE - 1)}…`;
    line += '\n';
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      let size = 0;
      try { size = fs.statSync(file).size; } catch (_error) { /* a new file */ }
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) rotate();
      fs.appendFileSync(file, line, { mode: 0o600 });
      return true;
    } catch (_error) {
      return false;
    }
  }

  return {
    directory,
    file,
    /** @param {string} event @param {Record<string, unknown>} [fields] */
    write(event, fields = {}) { return append(formatFields(event, fields)); },
    /** @param {string} event @param {unknown} error @param {Record<string, unknown>} [fields] */
    error(event, error, fields = {}) { return append(formatFields(event, { ...fields, ...errorFields(error, appRoot) })); }
  };
}

/**
 * The last `count` lines, oldest first, across the current and older files;
 * each read from the end and redacted again.
 * @param {string} directory
 * @param {number} count
 * @param {{ home?: string, keep?: number }} [options]
 */
function readTail(directory, count, { home = os.homedir(), keep = KEEP_FILES } = {}) {
  /** @type {string[]} */
  let lines = [];
  for (let index = 0; index < keep && lines.length < count; index += 1) {
    let text;
    try {
      const handle = fs.openSync(fileAt(directory, index), 'r');
      try {
        const size = fs.fstatSync(handle).size;
        const start = Math.max(0, size - TAIL_BYTES);
        const buffer = Buffer.alloc(size - start);
        fs.readSync(handle, buffer, 0, buffer.length, start);
        text = buffer.toString('utf8');
        if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      } finally {
        fs.closeSync(handle);
      }
    } catch (_error) {
      continue;
    }
    const fileLines = text.split(/\r?\n/).filter(Boolean).map((line) => redact(line.slice(0, MAX_LINE), home));
    lines = fileLines.concat(lines);
  }
  return lines.slice(-count);
}

/**
 * The log files that exist and their total size.
 * @param {string} directory
 * @param {number} [keep]
 */
function logFiles(directory, keep = KEEP_FILES) {
  let files = 0;
  let bytes = 0;
  for (let index = 0; index < keep; index += 1) {
    try {
      const stat = fs.statSync(fileAt(directory, index));
      if (stat.isFile()) { files += 1; bytes += stat.size; }
    } catch (_error) { /* not there */ }
  }
  return { files, bytes };
}

module.exports = { LOG_FILE, MAX_BYTES, KEEP_FILES, createLog, readTail, logFiles, logDirectory, redact, safeValue, errorFields };
