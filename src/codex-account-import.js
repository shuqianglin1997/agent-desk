const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTH_FILENAME = 'auth.json';
const MAX_AUTH_BYTES = 256 * 1024;
const HOME_MARKERS = {
  [AUTH_FILENAME]: 'file',
  'config.toml': 'file',
  '.codex-global-state.json': 'file',
  'history.jsonl': 'file',
  sessions: 'directory',
  archived_sessions: 'directory'
};

function canonicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return null;
  try {
    const resolved = fs.realpathSync.native(directory);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch (_error) {
    return null;
  }
}

function codexHomeKey(directory) {
  const resolved = canonicalDirectory(directory);
  return resolved && process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inspectCodexHome(directory) {
  const resolved = canonicalDirectory(directory);
  if (!resolved || resolved === path.parse(resolved).root) return null;
  const found = Object.entries(HOME_MARKERS).some(([marker, kind]) => {
    const stat = fs.statSync(path.join(resolved, marker), { throwIfNoEntry: false });
    return kind === 'file' ? stat?.isFile() : stat?.isDirectory();
  });
  return found ? resolved : null;
}

function discoverCodexHomes({ home = os.homedir(), env = process.env } = {}) {
  const seen = new Set();
  const candidates = [];
  for (const [source, directory] of [['default', path.join(home, '.codex')], ['environment', env.CODEX_HOME]]) {
    let resolved;
    try { resolved = inspectCodexHome(directory); } catch (_error) { continue; }
    const key = codexHomeKey(resolved);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ source, directory: resolved });
  }
  return candidates;
}

function codexProfileAtHome(profiles, directory) {
  const key = codexHomeKey(directory);
  if (!key) return null;
  return profiles.find((profile) => profile.appId === 'codex' && codexHomeKey(profile.sessionRoot) === key) || null;
}

function readCodexAuthFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.basename(filePath).toLowerCase() !== AUTH_FILENAME) {
    throw new Error('codex-auth-filename');
  }
  let bytes;
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new Error();
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    const descriptor = fs.openSync(filePath, flags);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new Error();
      if (stat.size > MAX_AUTH_BYTES) throw new Error('codex-auth-size');
      const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
        if (!read) break;
        offset += read;
      }
      if (offset > MAX_AUTH_BYTES) throw new Error('codex-auth-size');
      bytes = buffer.subarray(0, offset);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error.message === 'codex-auth-size') throw error;
    throw new Error('codex-auth-unreadable');
  }

  // Strip a UTF-8 BOM so the saved file can be read by Codex's JSON parser.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  let auth;
  try { auth = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (_error) {
    throw new Error('codex-auth-format');
  }
  const present = (value) => typeof value === 'string' && value.trim().length > 0;
  const mode = auth?.auth_mode;
  const apiKey = (mode == null || mode === 'apikey') && present(auth?.OPENAI_API_KEY);
  const chatgpt = (mode == null || mode === 'chatgpt')
    && ['id_token', 'access_token', 'refresh_token'].every((key) => present(auth?.tokens?.[key]));
  if (!apiKey && !chatgpt) throw new Error('codex-auth-format');
  return bytes;
}

function profileWithSameCodexAuth(profiles, bytes) {
  return profiles.find((profile) => {
    if (profile.appId !== 'codex' || !profile.codexAuthImported || !profile.sessionRoot) return false;
    try {
      return bytes.equals(readCodexAuthFile(path.join(profile.sessionRoot, AUTH_FILENAME)));
    } catch (_error) {
      return false;
    }
  }) || null;
}

function stageCodexAuthHome(profile, bytes) {
  fs.mkdirSync(path.dirname(profile.profilePath), { recursive: true });
  // Reserve the new managed directory exclusively before writing credentials.
  fs.mkdirSync(profile.profilePath, { mode: 0o700 });
  const cleanup = () => fs.rmSync(profile.profilePath, { recursive: true, force: true });
  try {
    fs.mkdirSync(profile.sessionRoot, { mode: 0o700 });
    fs.writeFileSync(path.join(profile.sessionRoot, AUTH_FILENAME), bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

module.exports = {
  canonicalDirectory,
  codexHomeKey,
  codexProfileAtHome,
  discoverCodexHomes,
  inspectCodexHome,
  profileWithSameCodexAuth,
  readCodexAuthFile,
  stageCodexAuthHome
};
