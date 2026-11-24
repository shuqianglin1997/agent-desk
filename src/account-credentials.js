'use strict';

/*
 * AgentDesk — hand a pasted key or token to the account's own client.
 *
 * AgentDesk never keeps a key, token or password. A pasted value is passed to
 * the official client of that one account — on its standard input, through the
 * one environment variable the client documents for the purpose (only to that
 * child process), or into the client's own documented configuration file
 * inside that account's home — and is then dropped. It never goes into
 * AgentDesk storage, logs, argv, error text or command output.
 *
 * Every write is merge-preserving (other settings stay), atomic (temporary file
 * in the same folder, then rename) and private (0600 files, 0700 folders).
 * Status checks report only whether a sign-in is present and its kind.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const coreJson = require('./core/json-file');
const { writeFileAtomic } = coreJson;
const paths = require('./core/paths');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const apps = require('./apps');

class CredentialError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Printable ASCII without quotes, backslash, backtick, dollar or space: safe as
// a literal in .env (single quotes), TOML/JSON strings and YAML single quotes.
const SECRET_PATTERN = /^[\x21\x23\x25\x26\x28-\x5b\x5d-\x5f\x61-\x7e]{8,4096}$/;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/;
const CODEX_RESERVED_PROVIDERS = new Set(['openai', 'ollama', 'lmstudio', 'oss', 'amazon-bedrock', 'bedrock', 'vertex', 'gcp', 'google']);
const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/v1';
const MAX_CONFIG_BYTES = 1024 * 1024;
const OUTPUT_LIMIT = 64 * 1024;

function normalizeSecret(value) {
  const text = typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : '';
  if (!SECRET_PATTERN.test(text)) throw new CredentialError('secret-invalid');
  return text;
}

function normalizeProvider(appId, input = {}) {
  const descriptor = credentialDescriptor(appId);
  const required = descriptor?.provider?.fields || [];
  const optional = descriptor?.provider?.optional || [];
  const fields = [...required, ...optional.filter((field) => String(input[field] || '').trim())];
  const provider = {};
  if (fields.includes('id')) {
    const id = String(input.id || '').trim().toLowerCase();
    if (!PROVIDER_ID.test(id) || (appId === 'codex' && CODEX_RESERVED_PROVIDERS.has(id))) throw new CredentialError('provider-id-invalid');
    provider.id = id;
  }
  if (fields.includes('baseUrl')) {
    let url;
    try { url = new URL(String(input.baseUrl || '').trim()); } catch (_error) { throw new CredentialError('provider-url-invalid'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password
      || url.href.length > 512 || /[\s"'\\`$]/.test(url.href)) {
      throw new CredentialError('provider-url-invalid');
    }
    provider.baseUrl = url.href.replace(/\/$/, '');
  }
  if (fields.includes('model')) {
    const model = String(input.model || '').trim();
    if (!MODEL_ID.test(model)) throw new CredentialError('provider-model-invalid');
    provider.model = model;
  }
  return provider;
}

function credentialDescriptor(appId) {
  return apps.isKnownApp(appId) ? apps.getApp(appId).credentials || null : null;
}

// ---------- private atomic file writes ----------

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

// ---------- TOML (line based; only the keys and tables AgentDesk owns) ----------

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

// ---------- .env (dotenv: single quotes are literal) ----------

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

// ---------- DSH .credentials.yaml (version 1: refs + records) ----------

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

// ---------- official client runs ----------

const queues = new Map();
function serialized(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
  return next;
}

function officialEnvironment(profile, baseEnv, extra = {}) {
  const client = apps.getApp(profile.appId);
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

// ---------- per-client adapters ----------

function homeOf(profile) {
  if (!profile?.sessionRoot || !path.isAbsolute(profile.sessionRoot)) throw new CredentialError('home-invalid');
  return profile.sessionRoot;
}

function codexEnvKey(id) {
  return `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

function ensureCodexFileStore(home) {
  const file = path.join(home, 'config.toml');
  const text = readOptional(file);
  const config = parseTomlSubset(text || '');
  if (config.cli_auth_credentials_store === 'file') return;
  backupOnce(file, text);
  const lines = setTomlTopLevel(splitLines(text), 'cli_auth_credentials_store', tomlString('file'));
  writePrivateFile(file, `${lines.join('\n')}\n`);
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

function openCodeCredentialTypes(dataDirectory) {
  const types = [];
  for (const entry of (() => { try { return fs.readdirSync(dataDirectory); } catch (_error) { return []; } })()) {
    if (!/^opencode(?:-[\w.-]+)?\.db$/.test(entry)) continue;
    let db;
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(path.join(dataDirectory, entry), { readOnly: true });
      // Only the credential kind is read; the value column never leaves SQLite.
      const rows = db.prepare("SELECT json_extract(value, '$.type') AS type FROM credential WHERE active = 1").all();
      types.push(...rows.map((row) => row.type));
    } catch (_error) {
      // No credential table yet, or an older layout.
    } finally {
      try { db?.close(); } catch (_error) { /* closed */ }
    }
  }
  return types;
}

function credentialId() {
  return `cred_${Date.now().toString(16).padStart(12, '0')}${crypto.randomBytes(8).toString('hex')}`;
}

function claudeSettingsPath(profile, home = os.homedir()) {
  return path.join(homeOf(profile), 'settings.json');
}

function updateClaudeEnv(profile, mutate) {
  const file = claudeSettingsPath(profile);
  const text = readOptional(file);
  let settings = {};
  if (text !== null && text.trim()) {
    try { settings = JSON.parse(text); } catch (_error) { throw new CredentialError('config-format-unsupported'); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new CredentialError('config-format-unsupported');
  }
  const env = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env) ? { ...settings.env } : {};
  // One sign-in at a time: an older key would otherwise outrank a new token.
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL']) delete env[key];
  mutate(env);
  writePrivateFile(file, `${JSON.stringify({ ...settings, env }, null, 2)}\n`);
}

const ADAPTERS = {
  opencode: {
    async setKey(profile, secret, context, options = {}) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const integration = String(options.catalogProviderId || '').trim().toLowerCase();
      if (!PROVIDER_ID.test(integration)) throw new CredentialError('provider-id-invalid');
      const launcher = context.findLauncher('opencode');
      if (!launcher) throw new CredentialError('official-client-missing');
      // `auth import` reads an export-shaped array from standard input.
      const payload = JSON.stringify([{ id: credentialId(), integrationID: integration, label: 'AgentDesk', active: true, value: { type: 'key', key: secret } }]);
      const result = await serialized('opencode', () => runOfficial({
        launcher, args: ['--standalone', 'auth', 'import'], env: officialEnvironment(profile, context.env), input: payload, spawnImpl: context.spawnImpl
      }));
      if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
      return { method: 'api-key', via: 'official-stdin', storedInPlaintext: true };
    },
    status(profile) {
      const home = homeOf(profile);
      const types = openCodeCredentialTypes(home);
      if (types.length) return { signedIn: true, method: types.includes('oauth') ? 'oauth' : 'api-key' };
      const legacy = readJson(path.join(home, 'auth.json'));
      const entries = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? Object.values(legacy) : [];
      if (entries.some((entry) => entry && typeof entry === 'object' && entry.type)) {
        return { signedIn: true, method: entries.some((entry) => entry.type === 'oauth') ? 'oauth' : 'api-key' };
      }
      return { signedIn: false, method: null };
    },
    officialStatus: { toolId: 'opencode', args: ['--standalone', 'auth', 'list', '--format', 'json'], parseList: true }
  },
  'gemini-cli': {
    async setKey(profile, secret) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const envFile = path.join(home, '.env');
      writePrivateFile(envFile, setDotenv(readOptional(envFile), 'GEMINI_API_KEY', secret));
      setSelectedAuthType(path.join(home, 'settings.json'), 'gemini-api-key');
      return { method: 'api-key', via: 'config-file', storedInPlaintext: true };
    },
    status(profile) {
      const home = homeOf(profile);
      const oauth = readJson(path.join(home, 'oauth_creds.json'));
      if (typeof oauth?.refresh_token === 'string' && oauth.refresh_token) return { signedIn: true, method: 'oauth' };
      if (readDotenvValue(readOptionalQuiet(path.join(home, '.env')) || '', 'GEMINI_API_KEY')) return { signedIn: true, method: 'api-key' };
      if (fileExists(path.join(home, 'gemini-credentials.json'))) return { signedIn: true, method: 'api-key' };
      return { signedIn: false, method: null };
    }
  },
  'qwen-code': {
    async setProvider(profile, secret, provider) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const envFile = path.join(home, '.env');
      let text = readOptional(envFile);
      text = setDotenv(text, 'OPENAI_API_KEY', secret);
      text = setDotenv(text, 'OPENAI_BASE_URL', provider.baseUrl);
      text = setDotenv(text, 'OPENAI_MODEL', provider.model);
      writePrivateFile(envFile, text);
      setSelectedAuthType(path.join(home, 'settings.json'), 'openai');
      return { method: 'provider', via: 'config-file', storedInPlaintext: true };
    },
    status(profile) {
      const home = homeOf(profile);
      const subscription = readJson(path.join(home, 'subscription_credentials.json'));
      if (subscription?.tokens && typeof subscription.tokens === 'object') return { signedIn: true, method: 'subscription' };
      const oauth = readJson(path.join(home, 'oauth_creds.json'));
      if (typeof oauth?.refresh_token === 'string' && oauth.refresh_token) return { signedIn: true, method: 'oauth' };
      const settings = readJson(path.join(home, 'settings.json'));
      const selected = settings?.security?.auth?.selectedType;
      const dotenv = readOptionalQuiet(path.join(home, '.env')) || '';
      const hasKey = Boolean(settings?.security?.auth?.apiKey || settings?.env?.OPENAI_API_KEY || readDotenvValue(dotenv, 'OPENAI_API_KEY'));
      if (selected && selected !== 'qwen-oauth' && selected !== 'qwen-subscription' && hasKey) return { signedIn: true, method: 'provider' };
      return { signedIn: false, method: null };
    }
  },
  codex: {
    async setKey(profile, secret, context) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      ensureCodexFileStore(home);
      const launcher = context.findLauncher('codex');
      if (!launcher) throw new CredentialError('official-client-missing');
      const result = await serialized('codex', () => runOfficial({
        launcher, args: ['login', '--with-api-key'], env: officialEnvironment(profile, context.env), input: secret, spawnImpl: context.spawnImpl
      }));
      if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
      return { method: 'api-key', via: 'official-stdin', storedInPlaintext: false };
    },
    async setProvider(profile, secret, provider) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const envKey = codexEnvKey(provider.id);
      const configFile = path.join(home, 'config.toml');
      const text = readOptional(configFile);
      backupOnce(configFile, text);
      let lines = splitLines(text);
      lines = setTomlTopLevel(lines, 'cli_auth_credentials_store', tomlString('file'));
      lines = setTomlTopLevel(lines, 'model_provider', tomlString(provider.id));
      lines = setTomlTopLevel(lines, 'model', tomlString(provider.model));
      lines = replaceTomlTable(lines, ['model_providers', provider.id], [
        `name = ${tomlString(provider.id)}`,
        `base_url = ${tomlString(provider.baseUrl)}`,
        `env_key = ${tomlString(envKey)}`,
        `wire_api = ${tomlString('responses')}`
      ]);
      const envFile = path.join(home, '.env');
      const envText = setDotenv(readOptional(envFile), envKey, secret);
      writePrivateFile(envFile, envText);
      writePrivateFile(configFile, `${lines.join('\n')}\n`);
      return { method: 'provider', via: 'config-file', storedInPlaintext: true };
    },
    status(profile) {
      const home = homeOf(profile);
      const auth = readJson(path.join(home, 'auth.json'));
      const present = (value) => typeof value === 'string' && value.trim().length > 0;
      if (auth && present(auth.tokens?.refresh_token) && (auth.auth_mode == null || auth.auth_mode === 'chatgpt')) return { signedIn: true, method: 'chatgpt' };
      if (auth && present(auth.OPENAI_API_KEY)) return { signedIn: true, method: 'api-key' };
      const config = parseTomlSubset(readOptionalQuiet(path.join(home, 'config.toml')) || '');
      const providerId = typeof config.model_provider === 'string' ? config.model_provider : null;
      const envKey = providerId && config.model_providers?.[providerId]?.env_key;
      if (envKey && readDotenvValue(readOptionalQuiet(path.join(home, '.env')) || '', envKey)) return { signedIn: true, method: 'provider' };
      return { signedIn: false, method: null, ...(config.cli_auth_credentials_store && config.cli_auth_credentials_store !== 'file' ? { note: 'credentials-store-not-file' } : {}) };
    },
    officialStatus: { toolId: 'codex', args: ['login', 'status'] }
  },
  'claude-cli': {
    async setKey(profile, secret) {
      ensurePrivateDirectory(homeOf(profile));
      const isOAuthToken = /^sk-ant-oat/i.test(secret);
      updateClaudeEnv(profile, (env) => {
        env[isOAuthToken ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = secret;
      });
      return { method: isOAuthToken ? 'oauth-token' : 'api-key', via: 'settings-file', storedInPlaintext: true };
    },
    async setProvider(profile, secret, provider) {
      ensurePrivateDirectory(homeOf(profile));
      updateClaudeEnv(profile, (env) => {
        env.ANTHROPIC_BASE_URL = provider.baseUrl;
        env.ANTHROPIC_AUTH_TOKEN = secret;
        if (provider.model) env.ANTHROPIC_MODEL = provider.model;
      });
      return { method: 'provider', via: 'settings-file', storedInPlaintext: true };
    },
    status(profile, context) {
      const home = homeOf(profile);
      const settings = readJson(path.join(home, 'settings.json'));
      const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
      const present = (key) => typeof env[key] === 'string' && env[key].trim().length > 0;
      if (present('ANTHROPIC_BASE_URL') && present('ANTHROPIC_AUTH_TOKEN')) return { signedIn: true, method: 'provider' };
      if (present('ANTHROPIC_AUTH_TOKEN') || present('ANTHROPIC_API_KEY')) return { signedIn: true, method: 'api-key' };
      if (present('CLAUDE_CODE_OAUTH_TOKEN')) return { signedIn: true, method: 'oauth-token' };
      if (fileExists(path.join(home, '.credentials.json'))) return { signedIn: true, method: 'subscription' };
      const officialHome = path.join(context.home || os.homedir(), '.claude');
      const configFile = samePath(home, officialHome) ? path.join(context.home || os.homedir(), '.claude.json') : path.join(home, '.claude.json');
      const config = readJson(configFile, 8 * 1024 * 1024);
      // On macOS the subscription token sits in the Keychain; the account
      // record here is a hint that only the official check can confirm.
      if (config?.oauthAccount && typeof config.oauthAccount === 'object') return { signedIn: null, method: 'subscription', note: 'confirm-with-official-check' };
      return { signedIn: false, method: null };
    },
    officialStatus: { toolId: 'claude', args: ['auth', 'status'], parseMethod: true }
  },
  kimi: {
    async setKey(profile, secret, context, options = {}) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const catalogId = String(options.catalogProviderId || '').trim().toLowerCase();
      if (!PROVIDER_ID.test(catalogId)) throw new CredentialError('provider-id-invalid');
      const launcher = context.findLauncher('kimi');
      if (!launcher) throw new CredentialError('official-client-missing');
      // `kimi provider catalog add` accepts the key only as --api-key or this
      // documented variable; it goes to this one child, never to argv.
      const result = await serialized('kimi', () => runOfficial({
        launcher,
        args: ['provider', 'catalog', 'add', catalogId, ...(options.model ? ['--default-model', options.model] : [])],
        env: officialEnvironment(profile, context.env, { KIMI_REGISTRY_API_KEY: secret }),
        spawnImpl: context.spawnImpl
      }));
      if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
      tightenFile(path.join(home, 'config.toml'));
      return { method: 'api-key', via: 'official-env', storedInPlaintext: true };
    },
    async setProvider(profile, secret, provider) {
      const home = homeOf(profile);
      ensurePrivateDirectory(home);
      const file = path.join(home, 'config.toml');
      const text = readOptional(file);
      const alias = `${provider.id}/${provider.model}`;
      let lines = splitLines(text);
      lines = setTomlTopLevel(lines, 'default_model', tomlString(alias));
      lines = replaceTomlTable(lines, ['providers', provider.id], [
        `type = ${tomlString('openai')}`,
        `base_url = ${tomlString(provider.baseUrl)}`,
        `api_key = ${tomlString(secret)}`
      ]);
      lines = replaceTomlTable(lines, ['models', alias], [
        `provider = ${tomlString(provider.id)}`,
        `model = ${tomlString(provider.model)}`
      ]);
      writePrivateFile(file, `${lines.join('\n')}\n`);
      return { method: 'provider', via: 'config-file', storedInPlaintext: true };
    },
    status(profile) {
      const home = homeOf(profile);
      const config = parseTomlSubset(readOptionalQuiet(path.join(home, 'config.toml')) || '');
      const providers = config.providers && typeof config.providers === 'object' ? config.providers : {};
      const credentialsDirectory = path.join(home, 'credentials');
      let tokenRevoked = false;
      for (const [id, provider] of Object.entries(providers)) {
        const key = provider?.oauth?.key;
        if (typeof key !== 'string' || !key.startsWith('oauth/')) continue;
        const credentials = readJson(path.join(credentialsDirectory, `${key.slice('oauth/'.length).replace(/[^A-Za-z0-9._-]/g, '')}.json`));
        if (!credentials) continue;
        if (typeof credentials.access_token === 'string' && credentials.access_token.length > 0) {
          return { signedIn: true, method: id.startsWith('managed:') ? 'subscription' : 'oauth' };
        }
        tokenRevoked = true;
      }
      const modelAlias = typeof config.default_model === 'string' ? config.default_model : null;
      const providerId = modelAlias ? config.models?.[modelAlias]?.provider : null;
      const selected = providerId ? providers[providerId] : null;
      if (selected && ((typeof selected.api_key === 'string' && selected.api_key) || selected.api_key_env)) {
        return { signedIn: true, method: 'provider' };
      }
      return { signedIn: false, method: null, ...(tokenRevoked ? { note: 'token-revoked' } : {}) };
    }
  },
  'dsh-cli': {
    async setKey(profile, secret) {
      writeDshRefs(profile, { DEEPSEEK_API_KEY: secret });
      return { method: 'api-key', via: 'credentials-file', storedInPlaintext: true };
    },
    async setProvider(profile, secret, provider) {
      writeDshRefs(profile, { DEEPSEEK_API_KEY: secret, DEEPSEEK_BASE_URL: provider.baseUrl });
      return { method: 'provider', via: 'credentials-file', storedInPlaintext: true };
    },
    status(profile) {
      const file = path.join(homeOf(profile), '.credentials.yaml');
      const text = readOptionalQuiet(file);
      if (text === null) return { signedIn: false, method: null };
      if (process.platform !== 'win32') {
        try { if (fs.statSync(file).mode & 0o077) return { signedIn: false, method: null, note: 'credentials-permissions-open' }; } catch (_error) { /* raced */ }
      }
      const refs = readYamlBlockKeys(text, 'refs');
      const records = readYamlBlockKeys(text, 'records');
      if (Object.keys(records).some((key) => key === 'deepseek-account-platform/default')) return { signedIn: true, method: 'subscription' };
      if (refs.DEEPSEEK_API_KEY) return { signedIn: true, method: refs.DEEPSEEK_BASE_URL ? 'provider' : 'api-key' };
      return { signedIn: false, method: null };
    }
  }
};

function writeDshRefs(profile, refs) {
  const home = homeOf(profile);
  ensurePrivateDirectory(home);
  if (process.platform !== 'win32') fs.chmodSync(home, 0o700);
  const file = path.join(home, '.credentials.yaml');
  let text = readOptional(file);
  for (const [key, value] of Object.entries(refs)) text = setYamlRef(text, key, value);
  writePrivateFile(file, text);
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

// Copy an `opencode auth export` file into an account by running the
// official import in that account's home. The file path is not a secret; the
// export's contents are read by OpenCode itself.
async function importOpenCodeExport(profile, filePath, context = {}) {
  if (profile?.appId !== 'opencode') throw new CredentialError('credential-method-unsupported');
  ensurePrivateDirectory(homeOf(profile));
  const launcher = context.findLauncher?.('opencode');
  if (!launcher) throw new CredentialError('official-client-missing');
  const result = await serialized('opencode', () => runOfficial({
    launcher, args: ['--standalone', 'auth', 'import', filePath], env: officialEnvironment(profile, context.env || process.env), spawnImpl: context.spawnImpl
  }));
  if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
  return { method: 'api-key', via: 'official-file' };
}

// ---------- public API ----------

function adapterFor(profile) {
  const adapter = ADAPTERS[profile?.appId];
  if (!adapter) throw new CredentialError('credential-method-unsupported');
  return adapter;
}

/**
 * Hand a pasted secret to the profile's client. `method` is 'key' or
 * 'provider'. The returned object never contains the secret.
 */
async function applySecret(profile, request, context = {}) {
  const descriptor = credentialDescriptor(profile?.appId);
  const method = request?.method === 'provider' ? 'provider' : 'key';
  if (!descriptor?.[method]) throw new CredentialError('credential-method-unsupported');
  const adapter = adapterFor(profile);
  let secret = normalizeSecret(request?.secret);
  const ctx = {
    env: context.env || process.env,
    home: context.home,
    spawnImpl: context.spawnImpl,
    findLauncher: context.findLauncher || (() => null)
  };
  try {
    if (method === 'provider') {
      const provider = normalizeProvider(profile.appId, request.provider);
      return { ...(await adapter.setProvider(profile, secret, provider, ctx)), plaintextWarning: Boolean(descriptor.provider.plaintext) };
    }
    const options = {};
    if (descriptor.key.catalogProvider) {
      options.catalogProviderId = request.catalogProviderId;
      if (request.model) {
        if (!MODEL_ID.test(String(request.model))) throw new CredentialError('provider-model-invalid');
        options.model = String(request.model);
      }
    }
    return { ...(await adapter.setKey(profile, secret, ctx, options)), plaintextWarning: Boolean(descriptor.key.plaintext) };
  } finally {
    secret = null;
  }
}

/**
 * Report whether the account is signed in using each client's success check.
 * `official: true` also runs the client's own status command when it has one.
 */
async function credentialStatus(profile, context = {}) {
  const adapter = ADAPTERS[profile?.appId];
  if (!adapter) return { supported: false, signedIn: null, method: null, verifiedBy: null };
  let result;
  try { result = adapter.status(profile, context); } catch (_error) { result = { signedIn: false, method: null, note: 'home-unreadable' }; }
  const status = { supported: true, signedIn: result.signedIn, method: result.method, verifiedBy: 'files', ...(result.note ? { note: result.note } : {}) };
  const official = adapter.officialStatus;
  if (!context.official || !official) return status;
  const launcher = context.findLauncher?.(official.toolId);
  if (!launcher) return { ...status, officialCheck: 'client-missing' };
  const run = await serialized(profile.appId, () => runOfficial({
    launcher, args: official.args, env: officialEnvironment(profile, context.env || process.env), timeoutMs: 20_000, spawnImpl: context.spawnImpl
  }));
  if (run.code === null) return { ...status, officialCheck: run.reasonCode };
  if (official.parseList) {
    let listed = null;
    try { listed = JSON.parse(run.stdout); } catch (_error) { /* not JSON */ }
    const signedIn = run.code === 0 && Array.isArray(listed) && listed.length > 0;
    return { supported: true, signedIn, method: signedIn ? status.method || 'api-key' : null, verifiedBy: 'official', officialCheck: 'ok' };
  }
  let method = status.method;
  if (official.parseMethod && run.code === 0) {
    try {
      const reported = JSON.parse(run.stdout).authMethod;
      const known = { 'claude.ai': 'subscription', oauth_token: 'oauth-token', api_key: 'api-key', api_key_helper: 'api-key', third_party: 'provider' };
      if (Object.hasOwn(known, reported)) method = known[reported];
    } catch (_error) { /* keep the file result */ }
  }
  return { supported: true, signedIn: run.code === 0, method: run.code === 0 ? method : null, verifiedBy: 'official', officialCheck: 'ok' };
}

module.exports = {
  CredentialError,
  KIMI_CODE_BASE_URL,
  applySecret,
  importOpenCodeExport,
  credentialDescriptor,
  credentialStatus,
  normalizeProvider,
  normalizeSecret,
  parseTomlSubset,
  readYamlBlockKeys,
  replaceTomlTable,
  runOfficial,
  setDotenv,
  setTomlTopLevel,
  setYamlRef,
  splitLines,
  writePrivateFile,
  ensurePrivateDirectory,
  readOptional
};
