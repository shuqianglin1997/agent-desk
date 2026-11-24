'use strict';

/*
 * AgentDesk — find existing client accounts on this computer.
 *
 * Three layers, all read-only and credential-free:
 *   1. each client's default location and the directory its environment
 *      variable points to;
 *   2. a bounded walk of the user's home folder that recognises client homes by
 *      their marker files (depth, directory, entry and time limits; cancellable;
 *      never follows symbolic links; skips folders that trigger macOS privacy
 *      prompts, cloud sync roots and package caches);
 *   3. the same walk inside one folder the user picked.
 *
 * The per-client markers live in the registry (src/apps.js → discovery). This
 * module only reads directory listings and, for Codex, checks that an auth.json
 * has the Codex shape. Identity labels are derived in Main and only the email or
 * plan text leaves this module; tokens and keys never do.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson } = require('./core/json-file');
const apps = require('./apps');
const { readCodexAuthFile } = require('./codex-account-import');

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 4,
  maxDirectories: 4000,
  maxEntries: 80_000,
  maxEntriesPerDirectory: 4000,
  timeMs: 5000
});

// Never descend into these anywhere: they are large, generated or private.
const SKIP_ANY_DEPTH = new Set([
  'node_modules', '.git', '.hg', '.svn', '.Trash', '.Trashes', 'Library', '.cache', '.npm', '.pnpm-store',
  '.yarn', '.cargo', '.rustup', '.gradle', '.m2', '.nvm', '.pyenv', '.rbenv', '.conda', 'anaconda3',
  'miniconda3', '.venv', 'venv', '__pycache__', '.docker', '.vscode', '.vscode-server', '.Spotlight-V100',
  '.DocumentRevisions-V100', '.fseventsd', 'Applications', '.android', '.gem', '.bun', '.deno', 'go',
  '.colima', '.lima', '.orbstack', '.minikube', '.kube', '.terraform.d', '.oh-my-zsh', 'site-packages'
]);

// At the top of a home folder: macOS privacy-prompt folders (Desktop,
// Documents, Downloads), media libraries, Windows AppData and cloud sync roots.
const SKIP_AT_HOME = new Set([
  'Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'AppData', 'Dropbox',
  'Google Drive', 'iCloud Drive', 'iCloudDrive', 'Box', 'Box Sync', 'pCloud Drive', 'Nextcloud',
  'Creative Cloud Files', 'Sync', 'MEGA', 'Yandex.Disk', 'OneDrive'
]);
const CLOUD_PREFIXES = ['OneDrive', 'Google Drive', 'Dropbox', 'Box-', 'Seafile'];

class ScanCanceled extends Error {
  constructor() { super('discovery-canceled'); this.code = 'discovery-canceled'; }
}

function pathKey(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return null;
  let resolved;
  try { resolved = fs.realpathSync.native(directory); } catch (_error) { return null; }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function realDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) return null;
  try {
    const resolved = fs.realpathSync.native(directory);
    if (!fs.statSync(resolved).isDirectory()) return null;
    return resolved === path.parse(resolved).root ? null : resolved;
  } catch (_error) {
    return null;
  }
}

function discoveryOf(appId) {
  return apps.isKnownApp(appId) ? apps.getApp(appId).discovery || null : null;
}

function entryType(dirent) {
  if (dirent.isDirectory()) return 'dir';
  if (dirent.isFile()) return 'file';
  if (dirent.isSymbolicLink()) return 'link';
  return 'other';
}

function listDirectorySync(directory, cap = DEFAULT_LIMITS.maxEntriesPerDirectory) {
  const entries = new Map();
  let handle;
  try { handle = fs.opendirSync(directory); } catch (_error) { return { entries, truncated: false, readable: false }; }
  let truncated = false;
  try {
    let dirent;
    while ((dirent = handle.readSync()) !== null) {
      if (entries.size >= cap) { truncated = true; break; }
      entries.set(dirent.name, entryType(dirent));
    }
  } catch (_error) {
    // A listing that fails half way is treated as what was read.
  } finally {
    try { handle.closeSync(); } catch (_error) { /* already closed */ }
  }
  return { entries, truncated, readable: true };
}

async function listDirectory(directory, cap, budget) {
  const entries = new Map();
  let handle;
  try { handle = await fs.promises.opendir(directory); } catch (_error) { return { entries, truncated: false, readable: false }; }
  let truncated = false;
  try {
    for await (const dirent of handle) {
      if (entries.size >= cap || budget.entries <= 0) { truncated = true; break; }
      budget.entries -= 1;
      entries.set(dirent.name, entryType(dirent));
    }
  } catch (_error) {
    // Keep the partial listing.
  }
  // for-await closes the handle when the loop ends or breaks.
  return { entries, truncated, readable: true };
}

function statType(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch (_error) {
    return null;
  }
}

// Qwen Code keeps chats under projects/<cwd>/chats/; Claude Code keeps
// .jsonl files directly under projects/<cwd>/. An empty projects/ is Claude's.
function projectsHaveChats(directory) {
  const { entries } = listDirectorySync(directory, 64);
  let probed = 0;
  for (const [name, type] of entries) {
    if (type !== 'dir' || probed >= 8) continue;
    probed += 1;
    if (statType(path.join(directory, name, 'chats')) === 'dir') return true;
  }
  return false;
}

const VERIFIERS = {
  'codex-auth': (filePath) => {
    try { readCodexAuthFile(filePath); return true; } catch (_error) { return false; }
  },
  'claude-projects': (directory) => !projectsHaveChats(directory),
  'qwen-projects': (directory) => projectsHaveChats(directory)
};

function markerPresent(directory, entries, marker, verify) {
  const wantsDirectory = marker.endsWith('/');
  const name = wantsDirectory ? marker.slice(0, -1) : marker;
  const segments = name.split('/');
  const first = entries.get(segments[0]);
  if (!first) return false;
  let type = first;
  if (segments.length > 1) {
    if (first !== 'dir' && first !== 'link') return false;
    type = statType(path.join(directory, ...segments));
  } else if (first === 'link') {
    type = statType(path.join(directory, name));
  }
  if (type !== (wantsDirectory ? 'dir' : 'file')) return false;
  const check = verify?.[marker];
  return check ? VERIFIERS[check]?.(path.join(directory, ...segments.filter(Boolean))) === true : true;
}

function sessionsShape(directory, entries) {
  if (entries.get('sessions') !== 'dir') return null;
  const { entries: children } = listDirectorySync(path.join(directory, 'sessions'), 64);
  if ([...children.keys()].some((name) => /^\d{4}$/.test(name))) return 'dated';
  let probed = 0;
  for (const [name, type] of children) {
    if (type !== 'dir' || probed >= 6) continue;
    probed += 1;
    if (statType(path.join(directory, 'sessions', name, 'state.json')) === 'file') return 'state-dirs';
  }
  return null;
}

// Which registered clients does this directory belong to? A set matches when
// every marker in it exists. Exclusive markers settle overlaps; Codex and Kimi
// Code share config.toml + sessions/, so the sessions/ layout decides last.
function recognize(directory, entries, options = {}) {
  const appIds = options.appIds || apps.appIds();
  const matches = [];
  for (const appId of appIds) {
    const discovery = discoveryOf(appId);
    if (!discovery?.markerSets) continue;
    if (options.homeScan && discovery.homeScan !== true) continue;
    if ((discovery.excludedBy || []).some((marker) => markerPresent(directory, entries, marker))) continue;
    const evidence = new Set();
    for (const set of discovery.markerSets) {
      if (set.every((marker) => markerPresent(directory, entries, marker, discovery.verify))) {
        for (const marker of set) evidence.add(marker);
      }
    }
    if (!evidence.size) continue;
    const strong = (discovery.exclusive || []).some((marker) => evidence.has(marker))
      || discovery.kind === 'desktop';
    matches.push({ appId, evidence: [...evidence], strong });
  }
  if (matches.length <= 1) return matches[0] ? { appId: matches[0].appId, evidence: matches[0].evidence } : null;
  const strong = matches.filter((match) => match.strong);
  if (strong.length === 1) return { appId: strong[0].appId, evidence: strong[0].evidence };
  const shape = sessionsShape(directory, entries);
  const byShape = (strong.length ? strong : matches)
    .filter((match) => shape && discoveryOf(match.appId).sessionsShape === shape);
  if (byShape.length === 1) return { appId: byShape[0].appId, evidence: byShape[0].evidence };
  return { ambiguous: matches.map((match) => match.appId) };
}

function anyMarkerPresent(appId, directory) {
  const discovery = discoveryOf(appId);
  if (!discovery?.markerSets) return false;
  const { entries } = listDirectorySync(directory);
  const markers = new Set(discovery.markerSets.flat());
  return [...markers].some((marker) => markerPresent(directory, entries, marker, discovery.verify));
}

function officialDesktopPath(appId, overrides) {
  if (overrides && Object.hasOwn(overrides, appId)) return overrides[appId];
  try { return apps.defaultProfilePath(appId); } catch (_error) { return null; }
}

function officialHome(appId, home) {
  const discovery = discoveryOf(appId);
  return discovery?.defaultHome ? path.join(home, discovery.defaultHome) : null;
}

// Turn a recognised directory into the two roots a Profile stores. A CLI home
// is its own Profile root; Codex and Kimi Code keep a separate desktop data
// directory that registration chooses (official default or a new managed one).
function locationFor(appId, directory, options = {}) {
  const client = apps.getApp(appId);
  const discovery = discoveryOf(appId);
  if (discovery.kind === 'desktop') {
    const official = officialDesktopPath(appId, options.desktopDefaults);
    const isDefault = Boolean(official) && pathKey(official) === pathKey(directory);
    return { appId, kind: 'desktop', profilePath: directory, sessionRoot: client.defaultSessionRoot(directory, isDefault), isDefault };
  }
  const isDefault = pathKey(officialHome(appId, options.home || os.homedir())) === pathKey(directory);
  return {
    appId,
    kind: 'home',
    profilePath: client.cliDiscoveryId ? directory : null,
    sessionRoot: directory,
    isDefault
  };
}

function defaultCandidates(appIds, options) {
  const home = options.home || os.homedir();
  const env = options.env || {};
  const found = [];
  const hints = [];
  for (const appId of appIds) {
    const discovery = discoveryOf(appId);
    if (!discovery) continue;
    if (discovery.kind === 'desktop') {
      const directory = realDirectory(officialDesktopPath(appId, options.desktopDefaults));
      if (!directory) continue;
      const location = locationFor(appId, directory, options);
      if (!realDirectory(location.sessionRoot) && discovery.defaultOnly) continue;
      found.push({ ...location, source: 'default' });
      continue;
    }
    const pairs = [['default', officialHome(appId, home)]];
    if (discovery.envVar && typeof env[discovery.envVar] === 'string' && env[discovery.envVar].trim()) {
      const value = env[discovery.envVar].trim();
      pairs.push(['environment', discovery.envSubdir ? path.join(value, discovery.envSubdir) : value]);
    }
    for (const [source, candidate] of pairs) {
      const directory = realDirectory(candidate);
      if (!directory || pathKey(directory) === pathKey(home)) continue;
      if (!anyMarkerPresent(appId, directory)) continue;
      found.push({ ...locationFor(appId, directory, options), source });
    }
    for (const legacy of discovery.legacyHomes || []) {
      const directory = realDirectory(path.join(home, legacy));
      if (directory && listDirectorySync(directory, 4).entries.size) {
        hints.push({ appId, kind: 'legacy-home', path: directory });
      }
    }
  }
  return { found, hints };
}

function shouldSkip(name, depth, atHome) {
  if (SKIP_ANY_DEPTH.has(name)) return true;
  if (depth === 1 && atHome) {
    if (SKIP_AT_HOME.has(name)) return true;
    if (CLOUD_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  }
  return false;
}

// Breadth-first walk under one root. Returns what it found before a limit,
// time budget or cancellation stopped it, and says which one did.
async function scanTree(root, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const appIds = options.appIds || apps.appIds();
  const signal = options.signal;
  const now = options.now || Date.now;
  const deadline = now() + limits.timeMs;
  const budget = { entries: limits.maxEntries };
  const atHome = options.atHome === true;
  const homeKey = pathKey(options.home || os.homedir());
  const found = [];
  const ambiguous = [];
  let visited = 0;
  let stopReason = null;
  let truncatedDirectories = 0;
  const queue = [{ directory: root, depth: 0 }];

  while (queue.length) {
    if (signal?.aborted) { stopReason = 'canceled'; break; }
    if (now() > deadline) { stopReason = 'time'; break; }
    if (visited >= limits.maxDirectories) { stopReason = 'directories'; break; }
    if (budget.entries <= 0) { stopReason = 'entries'; break; }
    const { directory, depth } = queue.shift();
    visited += 1;
    const listing = await listDirectory(directory, limits.maxEntriesPerDirectory, budget);
    if (!listing.readable) continue;
    if (listing.truncated) truncatedDirectories += 1;
    const skipRoot = depth === 0 && options.includeRoot !== true;
    if (!skipRoot && pathKey(directory) !== homeKey) {
      const match = recognize(directory, listing.entries, { appIds, homeScan: true });
      if (match?.appId) {
        found.push({ appId: match.appId, directory, evidence: match.evidence });
        continue; // A client home's own folders are not searched further.
      }
      if (match?.ambiguous) ambiguous.push({ directory, appIds: match.ambiguous });
    }
    if (depth >= limits.maxDepth) continue;
    for (const [name, type] of listing.entries) {
      if (type !== 'dir' || shouldSkip(name, depth + 1, atHome && depth === 0)) continue;
      queue.push({ directory: path.join(directory, name), depth: depth + 1 });
    }
    // Yield so the Electron main process keeps serving the window.
    if (visited % 32 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (!stopReason && budget.entries <= 0) stopReason = 'entries';
  return {
    found,
    ambiguous,
    visitedDirectories: visited,
    truncated: Boolean(stopReason) || truncatedDirectories > 0,
    stopReason: stopReason || (truncatedDirectories ? 'directory-entries' : null)
  };
}

function locationKey(location) {
  return `${location.appId}\u0000${pathKey(location.kind === 'desktop' ? location.profilePath : location.sessionRoot) || ''}`;
}

/**
 * Find account locations. `deep` adds the bounded home walk; `folder` adds a
 * walk inside a folder the user chose. Returns locations without identity or
 * registration state; describeLocations adds those.
 */
async function discoverLocations(options = {}) {
  const appIds = options.appId ? [options.appId] : apps.appIds();
  if (options.appId && !apps.isKnownApp(options.appId)) throw new Error('unknown-client');
  const home = options.home || os.homedir();
  const base = { ...options, home };
  const { found, hints } = options.skipDefaults ? { found: [], hints: [] } : defaultCandidates(appIds, base);
  const layers = [{ layer: 'default', count: found.length }];
  const locations = [...found];
  const ambiguous = [];
  let truncated = false;
  let stopReason = null;
  const addFromScan = (result, source) => {
    for (const item of result.found) {
      const discovery = discoveryOf(item.appId);
      if (discovery.defaultOnly) continue;
      locations.push({ ...locationFor(item.appId, item.directory, base), source });
    }
    ambiguous.push(...result.ambiguous);
    truncated ||= result.truncated;
    stopReason ||= result.stopReason;
    layers.push({ layer: source, count: result.found.length, visitedDirectories: result.visitedDirectories, stopReason: result.stopReason });
  };
  if (options.deep) {
    const homeDirectory = realDirectory(home);
    if (homeDirectory) addFromScan(await scanTree(homeDirectory, { ...base, appIds, atHome: true }), 'home-scan');
  }
  if (options.folder) {
    const folder = realDirectory(options.folder);
    if (!folder) throw new Error('discovery-folder-invalid');
    addFromScan(await scanTree(folder, { ...base, appIds, includeRoot: true, atHome: pathKey(folder) === pathKey(home) }), 'picked');
  }
  const seen = new Set();
  const unique = [];
  for (const location of locations) {
    const key = locationKey(location);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
  }
  return { locations: unique, hints, ambiguous, truncated, stopReason, layers };
}

function readJsonBounded(filePath, maxBytes = 512 * 1024) {
  return readJson(filePath, { maxBytes, stripBom: true });
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part || part.length > 16 * 1024) return null;
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch (_error) { return null; }
}

const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,190}$/;
const cleanEmail = (value) => (typeof value === 'string' && EMAIL.test(value.trim()) ? value.trim() : null);
const cleanLabel = (value) => (typeof value === 'string' && /^[\w .+-]{1,40}$/.test(value.trim()) ? value.trim() : null);

// Only labels leave this function: an email, a plan name or the sign-in kind.
const IDENTITY_READERS = {
  codex(location) {
    const auth = readJsonBounded(path.join(location.sessionRoot, 'auth.json'));
    if (!auth) return null;
    const claims = decodeJwtPayload(auth.tokens?.id_token);
    if (claims) {
      const plan = cleanLabel(claims['https://api.openai.com/auth']?.chatgpt_plan_type);
      return { method: 'chatgpt', email: cleanEmail(claims.email), plan };
    }
    if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()) return { method: 'api-key', email: null, plan: null };
    return null;
  },
  'claude-cli'(location, options) {
    const home = options.home || os.homedir();
    const configPath = pathKey(location.sessionRoot) === pathKey(path.join(home, '.claude'))
      ? path.join(home, '.claude.json')
      : path.join(location.sessionRoot, '.claude.json');
    const config = readJsonBounded(configPath, 8 * 1024 * 1024);
    const email = cleanEmail(config?.oauthAccount?.emailAddress);
    return email ? { method: 'subscription', email, plan: null } : null;
  },
  'gemini-cli'(location) {
    const accounts = readJsonBounded(path.join(location.sessionRoot, 'google_accounts.json'));
    const email = cleanEmail(accounts?.active);
    return email ? { method: 'oauth', email, plan: null } : null;
  }
};

function readIdentity(location, options = {}) {
  const reader = IDENTITY_READERS[location.appId];
  if (!reader) return null;
  try { return reader(location, options) || null; } catch (_error) { return null; }
}

// Session counts reuse the product scanners; database-backed clients report
// null (unknown) rather than spawning sqlite for every candidate.
const COUNT_UNSUPPORTED = new Set(['cursor', 'kimi-work']);
function countSessions(location) {
  const client = apps.getApp(location.appId);
  if (client.sessionScanSupported === false || COUNT_UNSUPPORTED.has(location.appId)) return null;
  if (!realDirectory(location.sessionRoot)) return 0;
  try {
    const sessions = client.scan({ id: 'discovery', appId: location.appId, profilePath: location.profilePath || location.sessionRoot, sessionRoot: location.sessionRoot });
    return Array.isArray(sessions) ? sessions.length : null;
  } catch (_error) {
    return null;
  }
}

// Re-check a location right before it is registered: the folder must still be
// a recognisable home of the same client (defaults keep their lenient check).
function verifyLocation(location) {
  if (!location || !apps.isKnownApp(location.appId) || !discoveryOf(location.appId)) return false;
  const directory = realDirectory(location.kind === 'desktop' ? location.profilePath : location.sessionRoot);
  if (!directory) return false;
  if (location.source === 'default' || location.source === 'environment') {
    return location.kind === 'desktop' || anyMarkerPresent(location.appId, directory);
  }
  const { entries } = listDirectorySync(directory);
  return recognize(directory, entries, { appIds: [location.appId] })?.appId === location.appId;
}

function registeredProfile(profiles, location) {
  const key = pathKey(location.sessionRoot);
  const profileKey = location.kind === 'desktop' ? pathKey(location.profilePath) : null;
  if (!key) return null;
  return (profiles || []).find((profile) => (
    profile.appId === location.appId
    && pathKey(profile.sessionRoot) === key
    && (!profileKey || pathKey(profile.profilePath) === profileKey)
  )) || null;
}

async function describeLocations(locations, options = {}) {
  const described = [];
  const maxCounted = options.maxCounted ?? 40;
  for (const [index, location] of locations.entries()) {
    if (options.signal?.aborted) throw new ScanCanceled();
    const registered = registeredProfile(options.profiles, location);
    described.push({
      ...location,
      identity: readIdentity(location, options),
      sessionCount: options.countSessions === false || index >= maxCounted ? null : countSessions(location),
      registeredProfileId: registered?.id || null
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  return described;
}

module.exports = {
  DEFAULT_LIMITS,
  SKIP_ANY_DEPTH,
  SKIP_AT_HOME,
  ScanCanceled,
  countSessions,
  describeLocations,
  discoverLocations,
  listDirectorySync,
  locationFor,
  locationKey,
  pathKey,
  readIdentity,
  realDirectory,
  recognize,
  registeredProfile,
  scanTree,
  verifyLocation
};
