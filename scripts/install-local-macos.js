#!/usr/bin/env node

/*
 * Safe local macOS installer for Catshelf development builds.
 *
 * Never move or replace a bundle while a process still maps files from it.
 * Doing so makes macOS attribute later privacy prompts to the temporary bundle
 * path. This installer quits the old manager first (Catshelf, or AgentDesk from
 * before the rename), stages a verified copy on the destination volume,
 * atomically swaps it, and verifies the relaunched process maps the canonical
 * /Applications bundle. Only then does it delete /Applications/AgentDesk.app
 * (same bundle id, no process using it), so one copy stays on the computer,
 * and write the `catshelf` and `agentdesk` commands (docs/RENAME_PLAN.md).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { PRODUCT_NAME, LEGACY_NAME, BUNDLE_ID, CLI_COMMANDS } = require('../src/core/product');

const APP_ID = BUNDLE_ID;
const BUNDLE_NAME = `${PRODUCT_NAME}.app`;
const DEFAULT_TARGET = `/Applications/${BUNDLE_NAME}`;
// The app from before the rename; removed once the new one runs.
const LEGACY_TARGET = `/Applications/${LEGACY_NAME}.app`;
// The data folder keeps the old name (src/core/product.js).
const DEFAULT_SETTINGS = path.join(os.homedir(), 'Library', 'Application Support', LEGACY_NAME, 'settings.json');
const BUNDLE_PATH_PATTERN = /(?:^|\/)(?:Catshelf|AgentDesk)\.app(?:[./]|$)/;
const PROCESS_NAMES = [PRODUCT_NAME, LEGACY_NAME];
const DEFAULT_COMMAND_DIRECTORY = path.join(os.homedir(), '.local', 'bin');
const COMMAND_MARKER = '# Catshelf command line, written by scripts/install-local-macos.js';

async function installLocalMacApp(options = {}, dependencies = {}) {
  if (process.platform !== 'darwin' && options.allowNonDarwin !== true) {
    throw installError('macos-required');
  }
  const deps = defaultDependencies(dependencies);
  const source = path.resolve(requiredPath(options.source, 'source-required'));
  const target = path.resolve(options.target || DEFAULT_TARGET);
  validateInstallPaths(source, target, options);
  const legacyTarget = options.legacyTarget === undefined
    ? (target === DEFAULT_TARGET ? LEGACY_TARGET : null)
    : options.legacyTarget && path.resolve(options.legacyTarget);
  assertBundle(source, deps);

  const initialProcesses = deps.listProcesses();
  let restoreSettings = null;
  try {
    if (initialProcesses.length) {
      if (options.preserveClients !== true) {
        throw installError('agentdesk-running');
      }
      restoreSettings = temporarilyKeepManagedClients(options.settingsFile || DEFAULT_SETTINGS, deps);
      deps.terminateProcesses(initialProcesses);
      await waitForNoBundleProcesses(deps, options.quitTimeoutMs || 15_000);
    }
  } finally {
    if (restoreSettings) restoreSettings();
  }

  // Recheck immediately before the first destination mutation. This is the
  // critical invariant that the old manual reinstall violated.
  const beforeMutation = deps.listProcesses();
  if (beforeMutation.length) throw installError('agentdesk-still-running');

  const destinationDirectory = path.dirname(target);
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const staging = path.join(destinationDirectory, `.${PRODUCT_NAME}.install-${token}.app`);
  const rollback = path.join(destinationDirectory, `.${PRODUCT_NAME}.rollback-${token}.app`);
  const failed = path.join(destinationDirectory, `.${PRODUCT_NAME}.failed-${token}.app`);
  let rollbackCreated = false;
  let targetPublished = false;
  let launchRequested = false;

  assertGeneratedPath(staging, destinationDirectory, `.${PRODUCT_NAME}.install-`);
  assertGeneratedPath(rollback, destinationDirectory, `.${PRODUCT_NAME}.rollback-`);
  assertGeneratedPath(failed, destinationDirectory, `.${PRODUCT_NAME}.failed-`);

  try {
    deps.copyBundle(source, staging);
    assertBundle(staging, deps);

    if (fs.existsSync(target)) {
      fs.renameSync(target, rollback);
      rollbackCreated = true;
    }
    fs.renameSync(staging, target);
    targetPublished = true;
    assertBundle(target, deps);

    launchRequested = true;
    deps.launchBundle(target);
    await waitForCanonicalLaunch(target, deps, options.launchTimeoutMs || 20_000);

    let retainedRollback = null;
    if (rollbackCreated) {
      try {
        removeGeneratedBundle(rollback, destinationDirectory, `.${PRODUCT_NAME}.rollback-`);
      } catch (_cleanupError) {
        retainedRollback = rollback;
      }
    }
    // The new app runs: everything below is clean-up and convenience, and a
    // failure there never undoes the install.
    const legacy = removeLegacyBundle(legacyTarget, deps);
    const commands = options.writeCommands === false
      ? []
      : writeCommandLaunchers(options.commandDirectory || DEFAULT_COMMAND_DIRECTORY, path.join(target, 'Contents', 'MacOS', PRODUCT_NAME));
    return { ok: true, source, target, relaunched: true, retainedRollback, legacy, commands };
  } catch (error) {
    if (launchRequested) {
      const livePublishedProcesses = processesMappedInside(deps.listProcesses(), target);
      if (livePublishedProcesses.length) {
        deps.terminateProcesses(livePublishedProcesses);
        try {
          await waitForNoBundleProcesses(deps, options.quitTimeoutMs || 15_000);
        } catch (_stopError) {
          // Never recreate the original bug by moving a bundle that is still
          // mapped by a live process. Leave both target and rollback in place.
          error.rollbackBlockedByLiveProcess = true;
          if (fs.existsSync(staging)) {
            removeGeneratedBundle(staging, destinationDirectory, `.${PRODUCT_NAME}.install-`);
          }
          throw error;
        }
      }
    }
    if (targetPublished && fs.existsSync(target)) {
      fs.renameSync(target, failed);
      targetPublished = false;
    }
    if (rollbackCreated && fs.existsSync(rollback) && !fs.existsSync(target)) {
      fs.renameSync(rollback, target);
      rollbackCreated = false;
    }
    if (fs.existsSync(staging)) removeGeneratedBundle(staging, destinationDirectory, `.${PRODUCT_NAME}.install-`);
    if (fs.existsSync(failed)) error.failedBundle = failed;
    throw error;
  }
}

function defaultDependencies(overrides) {
  return {
    listProcesses: () => listAppBundleProcesses(),
    terminateProcesses,
    copyBundle: (source, destination) => {
      execFileSync('/usr/bin/ditto', ['--noqtn', source, destination], { stdio: 'inherit' });
    },
    verifyBundle: (bundlePath) => {
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundlePath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    },
    bundleIdentifier: (bundlePath) => execFileSync('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(bundlePath, 'Contents', 'Info.plist')
    ], { encoding: 'utf8' }).trim(),
    launchBundle: (bundlePath) => {
      execFileSync('/usr/bin/open', ['-n', bundlePath], { stdio: 'ignore' });
    },
    sleep,
    ...overrides
  };
}

// Processes of Catshelf and of AgentDesk from before the rename, each found by
// its command name and kept only when it maps a file from such a bundle.
function listAppBundleProcesses() {
  const byPid = new Map();
  for (const name of PROCESS_NAMES) {
    for (const entry of parseLsofProcesses(lsofText(name))) {
      if (entry.paths.some((item) => BUNDLE_PATH_PATTERN.test(item))) byPid.set(entry.pid, entry);
    }
  }
  return [...byPid.values()];
}

function lsofText(commandName) {
  try {
    return execFileSync('/usr/sbin/lsof', [
      '-n',
      '-P',
      '-F',
      'pcn',
      '-a',
      '-c',
      commandName,
      '-d',
      'txt'
    ], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (error) {
    // lsof returns 1 when no matching process exists.
    if (error.status === 1 && !error.stdout) return '';
    if (typeof error.stdout === 'string') return error.stdout;
    throw installError('process-inspection-failed');
  }
}

function parseLsofProcesses(text) {
  const processes = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('p')) {
      if (current) processes.push(current);
      const pid = Number(line.slice(1));
      current = Number.isSafeInteger(pid) && pid > 0 ? { pid, command: '', paths: [] } : null;
    } else if (current && line.startsWith('c')) {
      current.command = line.slice(1);
    } else if (current && line.startsWith('n')) {
      current.paths.push(line.slice(1));
    }
  }
  if (current) processes.push(current);
  return processes;
}

function terminateProcesses(processes) {
  const ordered = [...processes].sort((left, right) => (
    processRank(left) - processRank(right) || left.pid - right.pid
  ));
  for (const entry of ordered) {
    try {
      process.kill(entry.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

function processRank(entry) {
  return PROCESS_NAMES.includes(entry.command) ? 0 : 1;
}

async function waitForNoBundleProcesses(deps, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!deps.listProcesses().length) return;
    await deps.sleep(200);
  }
  throw installError('agentdesk-quit-timeout');
}

async function waitForCanonicalLaunch(target, deps, timeoutMs) {
  const canonical = `${path.resolve(target)}${path.sep}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = deps.listProcesses();
    if (running.some((entry) => entry.paths.some((item) => (
      path.resolve(item).startsWith(canonical)
    )))) return;
    await deps.sleep(250);
  }
  throw installError('canonical-launch-not-observed');
}

function processesMappedInside(processes, bundlePath) {
  const canonical = `${path.resolve(bundlePath)}${path.sep}`;
  return processes.filter((entry) => entry.paths.some((item) => (
    path.resolve(item).startsWith(canonical)
  )));
}

function temporarilyKeepManagedClients(settingsFile, deps) {
  if (!fs.existsSync(settingsFile)) throw installError('settings-not-found');
  const stat = fs.lstatSync(settingsFile);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
    throw installError('settings-file-unsafe');
  }
  const original = fs.readFileSync(settingsFile, 'utf8');
  const payload = JSON.parse(original);
  const body = payload && typeof payload === 'object' && payload.settings && typeof payload.settings === 'object'
    ? payload.settings
    : payload;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw installError('settings-format-invalid');
  }
  body.profileQuitBehavior = 'keep';
  const temporary = `${JSON.stringify(payload, null, 2)}\n`;
  writePrivateAtomic(settingsFile, temporary);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    writePrivateAtomic(settingsFile, original);
    if (typeof deps.onSettingsRestored === 'function') deps.onSettingsRestored();
  };
}

function writePrivateAtomic(filePath, contents) {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (_error) { /* already published */ }
  }
}

function assertBundle(bundlePath, deps) {
  const stat = fs.lstatSync(bundlePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw installError('bundle-path-unsafe');
  deps.verifyBundle(bundlePath);
  if (deps.bundleIdentifier(bundlePath) !== APP_ID) throw installError('bundle-identifier-mismatch');
}

// Delete the app from before the rename, but only when it is the same app
// (bundle id) and no process maps a file from it. Otherwise leave it and say why.
function removeLegacyBundle(legacyTarget, deps) {
  if (!legacyTarget) return { path: null, removed: false, reason: 'not-checked' };
  let stat;
  try {
    stat = fs.lstatSync(legacyTarget);
  } catch (_error) {
    return { path: legacyTarget, removed: false, reason: 'absent' };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { path: legacyTarget, removed: false, reason: 'not-a-bundle' };
  let identifier = null;
  try {
    identifier = deps.bundleIdentifier(legacyTarget);
  } catch (_error) {
    return { path: legacyTarget, removed: false, reason: 'unreadable' };
  }
  if (identifier !== APP_ID) return { path: legacyTarget, removed: false, reason: 'other-app' };
  if (processesMappedInside(deps.listProcesses(), legacyTarget).length) return { path: legacyTarget, removed: false, reason: 'in-use' };
  try {
    fs.rmSync(legacyTarget, { recursive: true });
  } catch (_error) {
    return { path: legacyTarget, removed: false, reason: 'remove-failed' };
  }
  return { path: legacyTarget, removed: !fs.existsSync(legacyTarget), reason: fs.existsSync(legacyTarget) ? 'remove-failed' : null };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function launcherScript(executable) {
  return [
    '#!/bin/sh',
    COMMAND_MARKER,
    '# Runs the app\'s command line; a leading --cli is accepted and dropped.',
    'if [ "$1" = "--cli" ]; then shift; fi',
    `exec ${shellQuote(executable)} --cli "$@"`,
    ''
  ].join('\n');
}

// `catshelf` and the old name `agentdesk`: both run the app's --cli. A file of
// the same name this script did not write is left alone.
function writeCommandLaunchers(directory, executable) {
  const results = [];
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
  } catch (_error) {
    return CLI_COMMANDS.map((name) => ({ name, path: path.join(directory, name), written: false, reason: 'directory-unavailable' }));
  }
  for (const name of CLI_COMMANDS) {
    const file = path.join(directory, name);
    const temporary = path.join(directory, `.${name}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || !stat.isFile() || !fs.readFileSync(file, 'utf8').includes(COMMAND_MARKER))) {
        results.push({ name, path: file, written: false, reason: 'not-ours' });
        continue;
      }
      fs.writeFileSync(temporary, launcherScript(executable), { mode: 0o755, flag: 'wx' });
      fs.renameSync(temporary, file);
      fs.chmodSync(file, 0o755);
      results.push({ name, path: file, written: true, reason: null });
    } catch (_error) {
      fs.rmSync(temporary, { force: true });
      results.push({ name, path: file, written: false, reason: 'write-failed' });
    }
  }
  return results;
}

function validateInstallPaths(source, target, options) {
  if (source === target) throw installError('source-equals-target');
  if (path.basename(source) !== BUNDLE_NAME) throw installError('source-bundle-name-invalid');
  if (path.basename(target) !== BUNDLE_NAME) throw installError('target-bundle-name-invalid');
  if (options.allowCustomTarget !== true && target !== DEFAULT_TARGET) {
    throw installError('target-must-be-applications');
  }
}

function assertGeneratedPath(candidate, parent, prefix) {
  if (path.dirname(candidate) !== parent || !path.basename(candidate).startsWith(prefix)) {
    throw installError('generated-path-invalid');
  }
}

function removeGeneratedBundle(candidate, parent, prefix) {
  assertGeneratedPath(candidate, parent, prefix);
  fs.rmSync(candidate, { recursive: true, force: true });
}

function requiredPath(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw installError(code);
  return value;
}

function installError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArguments(argv) {
  const parsed = { source: null, preserveClients: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') {
      parsed.source = argv[index + 1];
      index += 1;
    } else if (item === '--preserve-clients') {
      parsed.preserveClients = true;
    } else {
      throw installError(`unknown-argument:${item}`);
    }
  }
  if (!parsed.source) parsed.source = defaultBuildSource();
  return parsed;
}

function defaultBuildSource() {
  const candidates = [
    path.join(__dirname, '..', 'release', 'mac-arm64', BUNDLE_NAME),
    path.join(__dirname, '..', 'release', 'mac-universal', BUNDLE_NAME),
    path.join(__dirname, '..', 'release', 'mac', BUNDLE_NAME)
  ].filter((candidate) => fs.existsSync(candidate));
  if (candidates.length !== 1) throw installError('build-source-ambiguous');
  return candidates[0];
}

async function main() {
  try {
    const result = await installLocalMacApp(parseArguments(process.argv.slice(2)));
    process.stdout.write(`Installed and verified ${result.target}\n`);
    if (result.legacy.removed) process.stdout.write(`Removed ${result.legacy.path}\n`);
    else if (result.legacy.reason !== 'absent' && result.legacy.reason !== 'not-checked') {
      process.stdout.write(`Kept ${result.legacy.path}: ${result.legacy.reason}\n`);
    }
    for (const command of result.commands) {
      process.stdout.write(command.written ? `Command ${command.name}: ${command.path}\n` : `Command ${command.name} not written (${command.reason}): ${command.path}\n`);
    }
  } catch (error) {
    const failed = error.failedBundle ? `; failed bundle kept at ${error.failedBundle}` : '';
    process.stderr.write(`${PRODUCT_NAME} local install failed: ${error.code || error.message}${failed}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  APP_ID,
  DEFAULT_TARGET,
  LEGACY_TARGET,
  DEFAULT_SETTINGS,
  BUNDLE_PATH_PATTERN,
  COMMAND_MARKER,
  parseLsofProcesses,
  listAppBundleProcesses,
  temporarilyKeepManagedClients,
  removeLegacyBundle,
  writeCommandLaunchers,
  launcherScript,
  installLocalMacApp,
  validateInstallPaths
};
