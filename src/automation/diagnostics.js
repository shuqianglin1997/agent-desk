'use strict';

// `Catshelf --cli diagnostics` (docs/FIX_AND_REBUILD.md): what an assistant
// helping someone needs first. Which source this copy was built from, the
// system, where the data folder and the log are, the end of the log, and a few
// self-checks: can the data folder be read and written, does the command line
// reach a running Catshelf. It prints no keys, tokens, session contents,
// titles or account names; paths under the home folder start with ~. The only
// thing it writes is one empty probe file in the data folder, removed at once.
// Main passes in what only Electron knows (src/main.js).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTail, logFiles, redact } = require('../core/log');

const DEFAULT_LINES = 40;
const STORE_FILES = ['profiles.json', 'settings.json'];

/**
 * A path as the person would read it, with ~ for the home folder.
 * @param {string | null | undefined} value
 * @param {string} home
 */
function displayPath(value, home) {
  if (typeof value !== 'string' || !value) return null;
  return redact(value, home);
}

/** @param {string} directory */
function checkDataFolder(directory) {
  let stat;
  try { stat = fs.statSync(directory); } catch (error) {
    return { state: error?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  if (!stat.isDirectory()) return { state: 'not-directory' };
  try { fs.readdirSync(directory); } catch (_error) { return { state: 'unreadable' }; }
  const probe = path.join(directory, `.diagnostics-probe-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  let writable = false;
  try {
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    writable = true;
  } catch (_error) { /* reported below */ }
  finally {
    try { fs.rmSync(probe, { force: true }); } catch (_error) { /* best effort */ }
  }
  const files = Object.fromEntries(STORE_FILES.map((name) => [name, fs.existsSync(path.join(directory, name))]));
  return { state: writable ? 'ok' : 'not-writable', files };
}

/** @param {() => boolean} probe */
function checkDesktop(probe) {
  try {
    const running = probe() === true;
    return {
      running,
      meaning: running
        ? 'A Catshelf is running and receives relayed commands (normally the desktop window).'
        : 'No Catshelf is running; commands that need the desktop answer desktop-not-running.'
    };
  } catch (_error) {
    return { running: null, reasonCode: 'desktop-probe-failed' };
  }
}

/**
 * Where the macOS app runs from: an app opened straight from Downloads or the
 * DMG runs from a randomised read-only copy (App Translocation).
 * @param {string} executable
 */
function macAppLocation(executable) {
  if (/\/AppTranslocation\//.test(executable)) return 'translocated';
  if (/^\/Volumes\//.test(executable)) return 'disk-image';
  if (/^\/Applications\//.test(executable)) return 'applications';
  return 'other';
}

/**
 * @param {{
 *   lines?: number,
 *   build: object,
 *   system: Record<string, string | null>,
 *   userData: string,
 *   logDirectory: string,
 *   home?: string,
 *   platform?: string,
 *   executable: string,
 *   portableExecutable?: string | null,
 *   probeDesktop: () => boolean
 * }} input
 */
function collectDiagnostics(input) {
  const home = input.home || os.homedir();
  const platform = input.platform || process.platform;
  const count = Number.isInteger(input.lines) ? Number(input.lines) : DEFAULT_LINES;
  const checks = {
    dataFolder: checkDataFolder(input.userData),
    desktop: checkDesktop(input.probeDesktop),
    log: logFiles(input.logDirectory),
    ...(platform === 'darwin' ? { appLocation: macAppLocation(input.executable) } : {})
  };
  return {
    build: input.build,
    system: input.system,
    executable: displayPath(input.executable, home),
    ...(input.portableExecutable ? { portableExecutable: displayPath(input.portableExecutable, home) } : {}),
    paths: {
      dataFolder: displayPath(input.userData, home),
      logFolder: displayPath(input.logDirectory, home),
      logFile: displayPath(path.join(input.logDirectory, 'catshelf.log'), home)
    },
    checks,
    log: {
      lines: readTail(input.logDirectory, count, { home }),
      note: 'Fixed event names, reason codes and build facts only. Older lines are in catshelf.1.log and catshelf.2.log.'
    },
    guide: 'docs/FIX_AND_REBUILD.md'
  };
}

module.exports = { collectDiagnostics, checkDataFolder, macAppLocation, displayPath, DEFAULT_LINES };
