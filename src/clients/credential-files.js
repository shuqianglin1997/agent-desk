'use strict';

// Helpers for handing a pasted key or token to an account's own client: private
// atomic file writes (0600 files, 0700 folders), merge-preserving edits of TOML,
// .env, YAML and JSON settings, and running one fixed official command with the
// secret on its standard input. A secret never reaches argv, logs or errors.
// Nothing here names a client; each client's ./<id>/credentials.js uses them.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const coreJson = require('../core/json-file');
const { writeFileAtomic } = require('../core/json-file');
const paths = require('../core/paths');

class CredentialError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
// Provider ids and model names as the clients accept them.
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/;
const MAX_CONFIG_BYTES = 1024 * 1024;
const OUTPUT_LIMIT = 64 * 1024;


function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory()) throw new CredentialError('home-invalid');
}

function readOptional(filePath) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CredentialError('config-unreadable');
  }
  if (!stat.isFile()) throw new CredentialError('config-unreadable');
  if (stat.size > MAX_CONFIG_BYTES) throw new CredentialError('config-too-large');
  try { return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); } catch (_error) {
    throw new CredentialError('config-unreadable');
  }
}

function writePrivateFile(filePath, content) {
  ensurePrivateDirectory(path.dirname(filePath));
  try {
    writeFileAtomic(filePath, content, { mode: 0o600, chmod: true });
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw new CredentialError('config-write-failed');
  }
}

function backupOnce(filePath, content) {
  if (content === null) return;
  writePrivateFile(`${filePath}.agentdesk-backup`, content);
}


const tomlString = (value) => JSON.stringify(String(value));

function splitLines(text) {
  return text === null || text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function isHeader(line) {
  return /^\s*\[/.test(line);
}

function headerName(line) {
  const match = /^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/.exec(line);
  if (!match || line.trim().startsWith('[[')) return null;
  return match[1].split('.').map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')).join('\u0000');
}

function setTomlTopLevel(lines, key, value) {
  const firstHeader = lines.findIndex(isHeader);
  const end = firstHeader < 0 ? lines.length : firstHeader;
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const line = `${key} = ${value}`;
  for (let index = 0; index < end; index += 1) {
    if (!pattern.test(lines[index])) continue;
    const rest = lines[index].split('=').slice(1).join('=').trim();
    if (/^(\[|\{|"""|''')/.test(rest) && !/[\]}]\s*(#.*)?$|("""|''')\s*(#.*)?$/.test(rest.slice(1))) {
      throw new CredentialError('config-format-unsupported');
    }
    lines[index] = line;
    return lines;
  }
  let insertAt = end;
  while (insertAt > 0 && !lines[insertAt - 1].trim()) insertAt -= 1;
  lines.splice(insertAt, 0, line);
  return lines;
}

function replaceTomlTable(lines, pathParts, bodyLines) {
  const target = pathParts.join('\u0000');
  const header = `[${pathParts.map((part) => (/^[A-Za-z0-9_-]+$/.test(part) ? part : tomlString(part))).join('.')}]`;
  const start = lines.findIndex((line) => headerName(line) === target);
  const block = [header, ...bodyLines];
  if (start < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    lines.push(...block);
    return lines;
  }
  let end = start + 1;
  while (end < lines.length && !isHeader(lines[end])) end += 1;
  while (end > start + 1 && !lines[end - 1].trim()) end -= 1;
  lines.splice(start, end - start, ...block);
  return lines;
}

// A minimal reader for status checks: tables, string/bool/number values and
// one-line inline tables. Unknown syntax is skipped, never evaluated.
function parseTomlSubset(text) {
  const root = {};
  let current = root;
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const name = headerName(line);
      if (name === null) { current = {}; continue; }
      current = root;
      for (const part of name.split('\u0000')) {
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part];
      }
      continue;
    }
    const match = /^("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    current[match[1].replace(/^["']|["']$/g, '')] = parseTomlValue(match[2].trim());
  }
  return root;
}

function parseTomlValue(value) {
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    try { return JSON.parse(value.slice(0, value.search(/"\s*(#.*)?$/) + 1)); } catch (_error) { return end > 0 ? value.slice(1, end) : ''; }
  }
  if (value.startsWith("'")) return value.slice(1, Math.max(1, value.indexOf("'", 1)));
  if (value.startsWith('{')) {
    const table = {};
    for (const pair of value.replace(/^\{|\}\s*(#.*)?$/g, '').split(',')) {
      const parts = pair.split('=');
      if (parts.length < 2) continue;
      table[parts[0].trim().replace(/^["']|["']$/g, '')] = parseTomlValue(parts.slice(1).join('=').trim());
    }
    return table;
  }
  if (/^(true|false)\b/.test(value)) return value.startsWith('true');
  return value.replace(/\s*#.*$/, '');
}


function setDotenv(text, key, secret) {
  const lines = splitLines(text);
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const line = `${key}='${secret}'`;
  const index = lines.findIndex((item) => pattern.test(item));
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  return `${lines.join('\n')}\n`;
}

function readDotenvValue(text, key) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`);
  for (const line of splitLines(text)) {
    const match = pattern.exec(line);
    if (match) return match[1].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return null;
}


function setYamlRef(text, key, value) {
  const quoted = `'${value}'`;
  if (text === null) return `version: 1\nrefs:\n  ${key}: ${quoted}\n`;
  const lines = splitLines(text);
  if (!lines.some((line) => /^version:\s*1\s*(#.*)?$/.test(line))) throw new CredentialError('credentials-format-unsupported');
  const refsIndex = lines.findIndex((line) => /^refs:/.test(line));
  if (refsIndex < 0) {
    lines.push('refs:', `  ${key}: ${quoted}`);
    return `${lines.join('\n')}\n`;
  }
  const inline = lines[refsIndex].replace(/^refs:\s*/, '').replace(/\s*#.*$/, '');
  if (inline === '{}') {
    lines.splice(refsIndex, 1, 'refs:', `  ${key}: ${quoted}`);
    return `${lines.join('\n')}\n`;
  }
  if (inline) throw new CredentialError('credentials-format-unsupported');
  let end = refsIndex + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end += 1;
  const children = lines.slice(refsIndex + 1, end);
  const indent = (children.find((line) => line.trim()) || '  ').match(/^\s*/)[0] || '  ';
  const keyPattern = new RegExp(`^\\s+${key}\\s*:`);
  const existing = children.findIndex((line) => keyPattern.test(line));
  if (existing >= 0) {
    const rest = children[existing].split(':').slice(1).join(':').trim();
    if (/^[|>]/.test(rest)) throw new CredentialError('credentials-format-unsupported');
    lines[refsIndex + 1 + existing] = `${indent}${key}: ${quoted}`;
  } else {
    lines.splice(refsIndex + 1, 0, `${indent}${key}: ${quoted}`);
  }
  return `${lines.join('\n')}\n`;
}

function readYamlBlockKeys(text, block) {
  const lines = splitLines(text);
  const start = lines.findIndex((line) => new RegExp(`^${block}:`).test(line));
  if (start < 0) return {};
  const result = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !/^\s/.test(line)) break;
    const match = /^(\s{1,4})(["']?)([^"':]+)\2\s*:\s*(.*)$/.exec(line);
    if (!match || match[1].length > 4) continue;
    const firstIndent = /^\s+/.exec(lines.slice(start + 1).find((item) => item.trim()) || '  ')[0].length;
    if (match[1].length !== firstIndent) continue;
    result[match[3].trim()] = match[4].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return result;
}


const queues = new Map();
function serialized(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
  return next;
}

// The account's own launch environment. The registry is required when this runs,
// not when the module loads: adapters load this module while the registry is
// still collecting them.
function officialEnvironment(profile, baseEnv, extra = {}) {
  const client = require('../apps').getApp(profile.appId);
  const base = Object.fromEntries(Object.entries(baseEnv || {}).filter(([key]) => !/^(KIMI_REGISTRY_API_KEY|CODEX_API_KEY)$/i.test(key)));
  return { ...client.launchEnv(profile, base), ...extra };
}

/**
 * Run one fixed official command. Output is never returned except a bounded
 * stdout that callers may parse for a status field; stderr is discarded.
 */
function runOfficial({ launcher, args, env, input = null, timeoutMs = 60_000, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(launcher.command, [...(launcher.prefixArgs || []), ...args], {
        env: { ...env, ...(launcher.extraEnv || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
    } catch (_error) {
      resolve({ code: null, reasonCode: 'official-command-failed', stdout: '' });
      return;
    }
    let stdout = '';
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_error) { /* exited */ }
      finish({ code: null, reasonCode: 'official-command-timeout', stdout: '' });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - stdout.length); });
    child.stderr?.on('data', () => {});
    child.on('error', () => finish({ code: null, reasonCode: 'official-command-failed', stdout: '' }));
    child.on('close', (code) => finish({ code, reasonCode: code === 0 ? null : 'official-command-failed', stdout }));
    child.stdin?.on('error', () => {});
    if (input === null) child.stdin?.end();
    else child.stdin?.end(`${input}\n`);
  });
}


function homeOf(profile) {
  if (!profile?.sessionRoot || !path.isAbsolute(profile.sessionRoot)) throw new CredentialError('home-invalid');
  return profile.sessionRoot;
}

// Merge into a JSON settings file, keeping every other key. A file that does
// not parse is left alone.
function updateJsonFile(file, mutate) {
  const text = readOptional(file);
  let value = {};
  if (text !== null && text.trim()) {
    try { value = JSON.parse(text); } catch (_error) { throw new CredentialError('config-format-unsupported'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CredentialError('config-format-unsupported');
  }
  const next = mutate(value) || value;
  writePrivateFile(file, `${JSON.stringify(next, null, 2)}\n`);
}

function setSelectedAuthType(settingsFile, type) {
  updateJsonFile(settingsFile, (settings) => {
    const security = settings.security && typeof settings.security === 'object' && !Array.isArray(settings.security) ? settings.security : {};
    const auth = security.auth && typeof security.auth === 'object' && !Array.isArray(security.auth) ? security.auth : {};
    return { ...settings, security: { ...security, auth: { ...auth, selectedType: type } } };
  });
}

function tightenFile(filePath) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(filePath, 0o600); } catch (_error) { /* the client did not create it */ }
}

function readOptionalQuiet(filePath) {
  try { return readOptional(filePath); } catch (_error) { return null; }
}

function readJson(filePath, maxBytes = 512 * 1024) {
  return coreJson.readJson(filePath, { maxBytes, stripBom: true });
}

function fileExists(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch (_error) { return false; }
}

function samePath(left, right) {
  return paths.samePathReal(left, right);
}

module.exports = { CredentialError, PROVIDER_ID, MODEL_ID, MAX_CONFIG_BYTES, OUTPUT_LIMIT, ensurePrivateDirectory, readOptional, writePrivateFile, backupOnce, tomlString, splitLines, isHeader, headerName, setTomlTopLevel, replaceTomlTable, parseTomlSubset, parseTomlValue, setDotenv, readDotenvValue, setYamlRef, readYamlBlockKeys, serialized, officialEnvironment, runOfficial, homeOf, updateJsonFile, setSelectedAuthType, tightenFile, readOptionalQuiet, readJson, fileExists, samePath };
