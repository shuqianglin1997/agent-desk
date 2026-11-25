'use strict';

// AgentDesk — what an installed macOS app bundle says about its own updates
// (docs/ORDERLY_UPDATE_PLAN.md §5). Each desktop adapter declares `update`:
//   mechanism  the official updater on macOS: 'squirrel' (Squirrel.Mac),
//              'sparkle', 'vscode' (VS Code family) or 'unknown'
//   windows    the updater on Windows: 'msix', 'squirrel' or 'unknown'
//              (recorded only; the orderly update is offered on macOS only)
//   waiting    how a downloaded update can be seen before it is installed:
//              'squirrel-shipit', or null when AgentDesk cannot tell
// This module reads, never writes: the bundle's Info.plist and, for
// Squirrel.Mac, the ShipIt state that the updater keeps per bundle id in
// ~/Library/Caches/<bundle id>.ShipIt (ShipItState.plist names the target
// bundle and the downloaded one; after an install the downloaded bundle is
// gone). It never downloads, installs or changes an update setting.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { fileURLToPath } = require('node:url');
const { extractVersion } = require('../tool-maintenance');

const MECHANISMS = Object.freeze(['squirrel', 'sparkle', 'vscode', 'unknown']);
const WINDOWS_MECHANISMS = Object.freeze(['msix', 'squirrel', 'unknown']);
const WAITING_SIGNALS = Object.freeze(['squirrel-shipit']);
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

function plistValue(file, key) {
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024
    }, (error, stdout) => resolve(error ? null : (String(stdout || '').trim() || null)));
  });
}

const missing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

// A file URL from a plist as an absolute path, or null.
function urlPath(value) {
  try {
    const resolved = fileURLToPath(String(value || ''));
    return path.isAbsolute(resolved) ? path.resolve(resolved) : null;
  } catch (_error) {
    return null;
  }
}

// One reader per Main process. Values are cached by each file's identity
// (inode, size, modification time), so a poll costs a few stat calls and
// plutil runs only when a file changed. Everything is asynchronous.
//   bundle(bundlePath) -> { version, bundleId } | null (no readable Info.plist)
//   staged(signal, bundlePath, bundleId)
//     -> { state: 'none' } | { state: 'staged', version } | { state: 'unknown' }
function createBundleReader(options = {}) {
  const fsp = options.fs?.promises || fs.promises;
  const readValue = options.plistValue || plistValue;
  const home = options.home || os.homedir();
  const cache = new Map();

  async function stamp(file) {
    const stat = await fsp.stat(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  }

  async function cached(file, keys) {
    const current = await stamp(file);
    const hit = cache.get(file);
    if (hit && hit.stamp === current) return hit.values;
    const values = {};
    for (const key of keys) values[key] = await readValue(file, key);
    // A value plutil could not read is asked again next time.
    if (keys.every((key) => values[key] !== null)) {
      cache.set(file, { stamp: current, values });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return values;
  }

  async function bundle(bundlePath) {
    if (typeof bundlePath !== 'string' || !path.isAbsolute(bundlePath)) return null;
    try {
      const values = await cached(path.join(bundlePath, 'Contents', 'Info.plist'), ['CFBundleShortVersionString', 'CFBundleIdentifier']);
      const bundleId = BUNDLE_ID.test(values.CFBundleIdentifier || '') ? values.CFBundleIdentifier : null;
      return { version: extractVersion(values.CFBundleShortVersionString), bundleId };
    } catch (_error) {
      return null;
    }
  }

  async function squirrelShipIt(bundlePath, bundleId) {
    if (!bundleId || !BUNDLE_ID.test(bundleId)) return { state: 'unknown' };
    const root = path.join(home, 'Library', 'Caches', `${bundleId}.ShipIt`);
    let state;
    try {
      state = await cached(path.join(root, 'ShipItState.plist'), ['targetBundleURL', 'updateBundleURL']);
    } catch (error) {
      return missing(error) ? { state: 'none' } : { state: 'unknown' };
    }
    const target = urlPath(state.targetBundleURL);
    const update = urlPath(state.updateBundleURL);
    if (!target || !update) return { state: 'unknown' };
    if (target !== path.resolve(bundlePath)) return { state: 'none' };
    // The downloaded bundle must sit inside this ShipIt folder.
    if (!update.startsWith(`${root}${path.sep}`)) return { state: 'unknown' };
    try {
      const values = await cached(path.join(update, 'Contents', 'Info.plist'), ['CFBundleShortVersionString']);
      const version = extractVersion(values.CFBundleShortVersionString);
      return version ? { state: 'staged', version } : { state: 'unknown' };
    } catch (error) {
      // Installed already: the downloaded bundle was moved into place.
      return missing(error) ? { state: 'none' } : { state: 'unknown' };
    }
  }

  async function staged(signal, bundlePath, bundleId) {
    if (signal !== 'squirrel-shipit' || typeof bundlePath !== 'string' || !path.isAbsolute(bundlePath)) return { state: 'unknown' };
    return squirrelShipIt(bundlePath, bundleId);
  }

  return { bundle, staged };
}

let shared = null;

// The process's one reader (the launcher and the update status share its cache).
function sharedBundleReader() {
  if (!shared) shared = createBundleReader();
  return shared;
}

module.exports = { MECHANISMS, WINDOWS_MECHANISMS, WAITING_SIGNALS, createBundleReader, sharedBundleReader };
