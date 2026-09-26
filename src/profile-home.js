/*
 * AgentDesk — seed isolated CLI homes for managed slots.
 *
 * A managed Claude CLI / DSH slot must not inherit the official ~/.claude or
 * ~/.dsh account, proxy, or credential files. This module only creates the
 * isolated root. DSH setup remains the responsibility of its own tooling. Credentials,
 * oauth tokens, session history, and user patch layers stay out.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function samePath(left, right, pathImpl = path) {
  if (!left || !right) return false;
  let a = pathImpl.resolve(String(left));
  let b = pathImpl.resolve(String(right));
  if (process.platform === 'win32') {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a === b;
}

function mkdir(fsImpl, dir) {
  fsImpl.mkdirSync(dir, { recursive: true });
}

function officialDefaultHome(appId, home, pathImpl) {
  if (appId === 'claude-cli') return pathImpl.join(home, '.claude');
  if (appId === 'dsh-cli') return pathImpl.join(home, '.dsh');
  return null;
}

function isOfficialDefaultHome(profile, home, pathImpl) {
  const official = officialDefaultHome(profile?.appId, home, pathImpl);
  if (!official || !profile?.sessionRoot) return false;
  if (profile.isProtected === true || profile.sessionRootMode === 'auto') return true;
  return samePath(profile.sessionRoot, official, pathImpl);
}

function seedClaudeCliHome(sessionRoot, fsImpl, pathImpl) {
  mkdir(fsImpl, sessionRoot);
  mkdir(fsImpl, pathImpl.join(sessionRoot, 'projects'));
  return {
    seeded: true,
    appId: 'claude-cli',
    path: sessionRoot,
    files: []
  };
}

function prepareManagedProfileHome(profile, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const home = options.home || os.homedir();
  if (!profile?.sessionRoot) return { seeded: false, reason: 'session-root-required' };
  if (isOfficialDefaultHome(profile, home, pathImpl)) {
    return { seeded: false, reason: 'official-default' };
  }

  if (profile.profilePath) mkdir(fsImpl, profile.profilePath);
  mkdir(fsImpl, profile.sessionRoot);

  if (profile.appId === 'claude-cli') {
    return seedClaudeCliHome(profile.sessionRoot, fsImpl, pathImpl);
  }
  if (profile.appId === 'dsh-cli') {
    // DSH configuration may contain inline credentials. Leave existing files
    // untouched and let DSH initialize an empty managed home itself.
    return { seeded: false, reason: 'configuration-required' };
  }
  return { seeded: false, reason: 'no-seed-needed' };
}

module.exports = {
  prepareManagedProfileHome
};
