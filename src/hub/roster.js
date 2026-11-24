'use strict';

/*
 * AgentDesk 调度中枢 — who may be called, by which name, and in which folder.
 *
 * Pure functions: the access switches live on the Profile record (default off),
 * the roster only lists accounts whose switch is on, and a name resolves to one
 * exact Profile or fails with the candidates. Nothing here picks an account on
 * its own: a duplicate name is an error, never a guess.
 */

const fs = require('node:fs');
const path = require('node:path');
const { adapterFor, unsupportedReason } = require('./adapters');

const MAX_DEPTH = 2;
const DEFAULT_MAX_CONCURRENT = 2;
const MAX_CONCURRENT_LIMIT = 4;
const MAX_FOLDERS = 24;

class HubError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function normalizeAccess(value) {
  const callable = value?.callable === true;
  return { callable, writable: callable && value?.writable === true };
}

function normalizeMaxConcurrent(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_CONCURRENT_LIMIT ? number : DEFAULT_MAX_CONCURRENT;
}

// The name a person sees on the cat, compared without case or outer spaces.
function nameKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

/*
 * One roster entry per callable Profile. `facts` supplies what Main measured:
 * names (cat names by Profile ID), launchers (found or not, by tool ID), home
 * and sign-in state, the energy level and whether a run is active.
 */
function buildRoster(profiles, facts = {}) {
  const entries = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile?.id || !normalizeAccess(profile.hub).callable) continue;
    const adapter = adapterFor(profile.appId);
    const access = normalizeAccess(profile.hub);
    const blockers = [];
    if (!adapter) blockers.push(unsupportedReason(profile.appId));
    else if (!facts.launcherFound?.(adapter.toolId)) blockers.push('client-missing');
    if (adapter && facts.homeExists?.(profile) === false) blockers.push('home-missing');
    if (adapter && facts.signedIn?.(profile) === false) blockers.push('not-signed-in');
    const energy = facts.energy?.(profile) || 'unknown';
    if (energy === 'exhausted') blockers.push('quota-exhausted');
    const busy = facts.busy?.(profile.id) === true;
    if (busy) blockers.push('busy');
    entries.push({
      id: String(profile.id),
      name: String(facts.names?.get(String(profile.id)) || profile.name || profile.id).slice(0, 120),
      app: profile.appId,
      access: access.writable ? 'read-write' : 'read',
      ready: blockers.length === 0,
      blockers,
      busy,
      energy
    });
  }
  return entries;
}

// Exact ID first, then the cat name. Two cats with one name: return both and
// ask for an ID. A Profile whose switch is off is simply not found.
function resolveAgent(roster, value) {
  const wanted = String(value || '').trim();
  if (!wanted) throw new HubError('agent-required');
  const byId = roster.find((entry) => entry.id === wanted);
  if (byId) return byId;
  const matches = roster.filter((entry) => nameKey(entry.name) === nameKey(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new HubError('agent-ambiguous', matches.map((entry) => ({ id: entry.id, name: entry.name, app: entry.app })));
  }
  throw new HubError('agent-not-found');
}

function realDirectory(value, fsImpl = fs) {
  try {
    const real = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(value) : fsImpl.realpathSync(value);
    return fsImpl.statSync(real).isDirectory() ? real : null;
  } catch (_error) {
    return null;
  }
}

function within(child, parent, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const a = platform === 'win32' ? child.toLowerCase() : child;
  const b = platform === 'win32' ? parent.toLowerCase() : parent;
  const relative = pathApi.relative(b, a);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}

// The working directory must be inside a folder the person allowed. Both are
// resolved to real paths first, so a symbolic link cannot step outside.
function resolveAllowedCwd(cwd, folders, options = {}) {
  const fsImpl = options.fs || fs;
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (typeof cwd !== 'string' || !pathApi.isAbsolute(cwd) || /[\x00-\x1f]/.test(cwd) || cwd.length > 4096) {
    throw new HubError('cwd-invalid');
  }
  const real = realDirectory(cwd, fsImpl);
  if (!real) throw new HubError('cwd-missing');
  for (const folder of Array.isArray(folders) ? folders : []) {
    const root = realDirectory(folder.path, fsImpl);
    if (root && within(real, root, platform)) return { cwd: real, folderId: folder.id };
  }
  throw new HubError('cwd-not-allowed');
}

// The account folder variables a calling process may carry. A caller is shown
// as a cat only when exactly one registered account's own folder matches what
// its environment says; otherwise it stays an unplaced, self-declared label.
const CALLER_HOME_KEYS = Object.freeze(['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'KIMI_CODE_HOME', 'DSH_HOME', 'GEMINI_CLI_HOME', 'QWEN_HOME']);

function resolveCallerProfile(homes, profiles, options = {}) {
  const homeOf = options.homeFor || (() => null);
  const real = options.realpath || ((value) => { try { return fs.realpathSync.native(value); } catch (_error) { return null; } });
  const seen = new Set();
  for (const [key, value] of Object.entries(homes || {})) {
    if (!CALLER_HOME_KEYS.includes(key) || typeof value !== 'string' || !path.isAbsolute(value)) continue;
    const callerHome = real(value);
    if (!callerHome) continue;
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      const expected = homeOf(profile, key);
      if (!expected) continue;
      const profileHome = real(expected);
      if (profileHome && profileHome === callerHome) seen.add(String(profile.id));
    }
  }
  return seen.size === 1 ? [...seen][0] : null;
}

// Depth travels in AGENTDESK_HUB_DEPTH. A person's own Agent has none (0); a
// called Agent runs at 1; one it calls runs at 2; deeper calls are refused.
function parseDepth(value) {
  if (value === undefined || value === null || value === '') return 0;
  const text = String(value).trim();
  if (!/^\d{1,2}$/.test(text)) return MAX_DEPTH;
  return Math.min(Number(text), 99);
}

module.exports = {
  CALLER_HOME_KEYS,
  resolveCallerProfile,
  MAX_DEPTH,
  DEFAULT_MAX_CONCURRENT,
  MAX_CONCURRENT_LIMIT,
  MAX_FOLDERS,
  HubError,
  normalizeAccess,
  normalizeMaxConcurrent,
  nameKey,
  buildRoster,
  resolveAgent,
  resolveAllowedCwd,
  parseDepth,
  within
};
