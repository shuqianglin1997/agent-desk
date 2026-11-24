'use strict';

/*
 * Copy a dropped or chosen sign-in file into a new isolated home.
 *
 * Copying a sign-in moves it: most refresh tokens are single use, so the
 * original place may sign out later. Callers must say so before copying.
 * Files are read with a size limit and without following links, checked for
 * the client's shape, and written 0600 in a new 0700 home that AgentDesk just
 * reserved. Nothing is logged; failures use fixed reason codes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { splitLines, writePrivateFile, ensurePrivateDirectory } = require('./account-credentials');

const MAX_FILE_BYTES = 256 * 1024;
const KIMI_MANAGED_PROVIDER = 'managed:kimi-code';

class ImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function readSmallFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new ImportError('credential-file-unreadable');
  let descriptor;
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new Error();
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error();
    if (stat.size > MAX_FILE_BYTES) throw new ImportError('credential-file-size');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (!read) break;
      offset += read;
    }
    if (offset > MAX_FILE_BYTES) throw new ImportError('credential-file-size');
    let bytes = buffer.subarray(0, offset);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('credential-file-unreadable');
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_error) { /* closed */ }
  }
}

function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_error) { throw new ImportError('credential-file-format'); }
}

function json(bytes) {
  try { return JSON.parse(utf8(bytes)); } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('credential-file-format');
  }
}

const present = (value) => typeof value === 'string' && value.trim().length > 0;

// Kimi Code's login is credentials/kimi-code.json plus the provider and model
// entries that point at it. Only those entries are carried over.
function kimiConfigSection(sourceHome) {
  let text = null;
  try {
    const file = path.join(sourceHome, 'config.toml');
    const stat = fs.lstatSync(file);
    if (stat.isFile() && stat.size <= MAX_FILE_BYTES) text = fs.readFileSync(file, 'utf8');
  } catch (_error) { /* no config next to it */ }
  const fallback = [
    `[providers.${JSON.stringify(KIMI_MANAGED_PROVIDER)}]`,
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    'api_key = ""',
    'oauth = { storage = "file", key = "oauth/kimi-code" }'
  ];
  if (text === null) return { lines: fallback, complete: false };
  const lines = splitLines(text);
  const blocks = [];
  let current = { header: null, lines: [] };
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      blocks.push(current);
      current = { header: line.trim(), lines: [line] };
    } else current.lines.push(line);
  }
  blocks.push(current);
  const name = (header) => (header || '').replace(/^\[+|\]+$/g, '').split('.').map((part) => part.trim().replace(/^"(.*)"$/, '$1')).join('.');
  const kept = [];
  const aliases = new Set();
  for (const block of blocks.slice(1)) {
    const header = name(block.header);
    if (header === `providers.${KIMI_MANAGED_PROVIDER}` || header.startsWith(`providers.${KIMI_MANAGED_PROVIDER}.`)) {
      // Never carry an inline key: the managed provider signs in through OAuth.
      kept.push(...block.lines.filter((line) => !/^\s*api_key\s*=/.test(line) || /=\s*""\s*$/.test(line)));
    } else if (header.startsWith('models.') && block.lines.some((line) => new RegExp(`^\\s*provider\\s*=\\s*"${KIMI_MANAGED_PROVIDER}"`).test(line))) {
      aliases.add(header.slice('models.'.length));
      kept.push(...block.lines);
    }
  }
  if (!kept.some((line) => line.includes(KIMI_MANAGED_PROVIDER))) return { lines: fallback, complete: false };
  const top = [];
  const defaultLine = blocks[0].lines.find((line) => /^\s*default_model\s*=/.test(line));
  const defaultAlias = defaultLine && /=\s*"([^"]+)"/.exec(defaultLine)?.[1];
  if (defaultAlias && aliases.has(defaultAlias)) top.push(defaultLine.trim(), '');
  return { lines: [...top, ...kept], complete: true };
}

// OpenCode (before 2.1) kept { <provider>: { type: api | oauth | wellknown } }
// in <data>/auth.json; Codex's auth.json has a different shape.
function isOpenCodeAuth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => entry && typeof entry === 'object' && ['api', 'oauth', 'wellknown'].includes(entry.type));
}

// `opencode auth export` prints [{ id, integrationID, label, active, value }].
function isOpenCodeExport(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => (
    entry && typeof entry === 'object' && typeof entry.integrationID === 'string'
    && entry.value && typeof entry.value === 'object' && ['oauth', 'key', 'external'].includes(entry.value.type)
  ));
}

const IMPORTERS = {
  opencode: {
    // Legacy auth.json, or an export file under any .json name (found by content).
    accepts: (fileName) => fileName.endsWith('.json'),
    read(filePath) {
      const bytes = readSmallFile(filePath);
      const value = json(bytes);
      if (isOpenCodeAuth(value)) return { bytes };
      // An export is handed to `opencode auth import` in the new home, not copied as a file.
      if (isOpenCodeExport(value)) return { bytes, export: true, filePath };
      throw new ImportError('credential-file-format');
    },
    sourceHome: (filePath) => path.dirname(filePath),
    // OpenCode 2.x imports a legacy auth.json into opencode.db when it starts.
    stage(profile, payload) {
      ensurePrivateDirectory(profile.sessionRoot);
      writePrivateFile(path.join(profile.sessionRoot, 'auth.json'), payload.bytes);
    },
    stagedFile: (profile) => path.join(profile.sessionRoot, 'auth.json')
  },
  'gemini-cli': {
    accepts: (fileName) => fileName === 'oauth_creds.json',
    read(filePath) {
      const bytes = readSmallFile(filePath);
      const value = json(bytes);
      if (!present(value?.refresh_token) && !present(value?.access_token)) throw new ImportError('credential-file-format');
      return { bytes };
    },
    sourceHome: (filePath) => path.dirname(filePath),
    stage(profile, payload) {
      ensurePrivateDirectory(profile.sessionRoot);
      writePrivateFile(path.join(profile.sessionRoot, 'oauth_creds.json'), payload.bytes);
      writePrivateFile(path.join(profile.sessionRoot, 'settings.json'), `${JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }, null, 2)}\n`);
    },
    stagedFile: (profile) => path.join(profile.sessionRoot, 'oauth_creds.json')
  },
  'dsh-cli': {
    accepts: (fileName) => fileName === '.credentials.yaml',
    read(filePath) {
      const bytes = readSmallFile(filePath);
      const text = utf8(bytes);
      if (!/^version:\s*1\s*$/m.test(text) || !/^(refs|records):/m.test(text)) throw new ImportError('credential-file-format');
      return { bytes };
    },
    sourceHome: (filePath) => path.dirname(filePath),
    stage(profile, payload) {
      ensurePrivateDirectory(profile.sessionRoot);
      if (process.platform !== 'win32') fs.chmodSync(profile.sessionRoot, 0o700);
      writePrivateFile(path.join(profile.sessionRoot, '.credentials.yaml'), payload.bytes);
    },
    stagedFile: (profile) => path.join(profile.sessionRoot, '.credentials.yaml')
  },
  kimi: {
    accepts: (fileName) => fileName === 'kimi-code.json',
    read(filePath) {
      const bytes = readSmallFile(filePath);
      const value = json(bytes);
      if (!present(value?.access_token) || typeof value.refresh_token !== 'string') throw new ImportError('credential-file-format');
      const home = path.basename(path.dirname(filePath)) === 'credentials' ? path.dirname(path.dirname(filePath)) : null;
      return { bytes, config: kimiConfigSection(home || path.dirname(filePath)) };
    },
    sourceHome: (filePath) => (path.basename(path.dirname(filePath)) === 'credentials' ? path.dirname(path.dirname(filePath)) : null),
    stage(profile, payload) {
      ensurePrivateDirectory(path.join(profile.sessionRoot, 'credentials'));
      writePrivateFile(path.join(profile.sessionRoot, 'credentials', 'kimi-code.json'), payload.bytes);
      writePrivateFile(path.join(profile.sessionRoot, 'config.toml'), `${payload.config.lines.join('\n')}\n`);
    },
    stagedFile: (profile) => path.join(profile.sessionRoot, 'credentials', 'kimi-code.json')
  },
  'claude-cli': {
    // macOS keeps Claude Code's sign-in in the Keychain; there is no file.
    platforms: ['linux', 'win32'],
    accepts: (fileName) => fileName === '.credentials.json',
    read(filePath) {
      const bytes = readSmallFile(filePath);
      const value = json(bytes);
      const oauth = value?.claudeAiOauth;
      if (!oauth || typeof oauth !== 'object' || !(present(oauth.refreshToken) || present(oauth.accessToken))) throw new ImportError('credential-file-format');
      return { bytes };
    },
    sourceHome: (filePath) => path.dirname(filePath),
    stage(profile, payload) {
      ensurePrivateDirectory(path.join(profile.sessionRoot, 'projects'));
      writePrivateFile(path.join(profile.sessionRoot, '.credentials.json'), payload.bytes);
    },
    stagedFile: (profile) => path.join(profile.sessionRoot, '.credentials.json')
  }
};

function importerFor(appId, platform = process.platform) {
  const importer = IMPORTERS[appId];
  if (!importer) return null;
  if (importer.platforms && !importer.platforms.includes(platform)) return null;
  return importer;
}

// Which client does a dropped file name belong to? Codex keeps its own reader.
function clientForCredentialFile(filePath, platform = process.platform) {
  const name = path.basename(String(filePath || ''));
  if (name === 'auth.json') {
    try { if (isOpenCodeAuth(JSON.parse(readSmallFile(filePath).toString('utf8')))) return 'opencode'; } catch (_error) { /* not readable here; Codex reader reports it */ }
    return 'codex';
  }
  for (const [appId, importer] of Object.entries(IMPORTERS)) {
    if (appId === 'opencode') continue; // matched by content below
    if (importer.accepts(name)) return importerFor(appId, platform) ? appId : { unsupported: appId };
  }
  if (name.endsWith('.json')) {
    try { if (isOpenCodeExport(JSON.parse(readSmallFile(filePath).toString('utf8')))) return 'opencode'; } catch (_error) { /* not an export */ }
  }
  return null;
}

function sameImportedFile(profiles, appId, bytes) {
  const importer = IMPORTERS[appId];
  return profiles.find((profile) => {
    if (profile.appId !== appId || profile.credentialImported !== appId || !profile.sessionRoot) return false;
    try { return fs.readFileSync(importer.stagedFile(profile)).equals(bytes); } catch (_error) { return false; }
  }) || null;
}

// Reserve a brand-new managed home, then stage. Returns a cleanup that removes
// only what was created here.
function stageNewHome(appId, profile, payload) {
  const importer = IMPORTERS[appId];
  fs.mkdirSync(path.dirname(profile.profilePath), { recursive: true });
  fs.mkdirSync(profile.profilePath, { mode: 0o700 });
  const cleanup = () => fs.rmSync(profile.profilePath, { recursive: true, force: true });
  try {
    importer.stage(profile, payload);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

module.exports = { IMPORTERS, ImportError, isOpenCodeExport, clientForCredentialFile, importerFor, kimiConfigSection, sameImportedFile, stageNewHome, readSmallFile };
