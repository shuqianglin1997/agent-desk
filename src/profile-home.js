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
const paths = require('./core/paths');
const apps = require('./apps');

function samePath(left, right, pathImpl = path) {
  return paths.samePath(left, right, { pathApi: pathImpl, caseInsensitive: process.platform === 'win32' });
}

function mkdir(fsImpl, dir) {
  fsImpl.mkdirSync(dir, { recursive: true });
}

// What a client's adapter says about its managed homes (`managedHome`): the
// official default home a seeding must never touch, and how to seed a new one.
function managedHomeOf(appId) {
  return apps.isKnownApp(appId) ? apps.getApp(appId).managedHome || null : null;
}

function officialDefaultHome(appId, home, pathImpl) {
  const name = managedHomeOf(appId)?.officialDefault;
  return name ? pathImpl.join(home, name) : null;
}

function isOfficialDefaultHome(profile, home, pathImpl) {
  const official = officialDefaultHome(profile?.appId, home, pathImpl);
  if (!official || !profile?.sessionRoot) return false;
  if (profile.isProtected === true || profile.sessionRootMode === 'auto') return true;
  return samePath(profile.sessionRoot, official, pathImpl);
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

  const seed = managedHomeOf(profile.appId)?.seed;
  if (typeof seed === 'function') return seed(profile, fsImpl, pathImpl);
  return { seeded: false, reason: 'no-seed-needed' };
}

module.exports = {
  prepareManagedProfileHome
};
