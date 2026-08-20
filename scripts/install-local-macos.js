#!/usr/bin/env node

/*
 * Safe local macOS installer for AgentDesk development builds.
 *
 * Never move or replace a bundle while a process still maps files from it.
 * Doing so makes macOS attribute later privacy prompts to the temporary bundle
 * path. This installer quits the old manager first, stages a verified copy on
 * the destination volume, atomically swaps it, and verifies the relaunched
 * process maps the canonical /Applications bundle.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const APP_ID = 'com.hupo.agentdesk';
const DEFAULT_TARGET = '/Applications/AgentDesk.app';
const DEFAULT_SETTINGS = path.join(os.homedir(), 'Library', 'Application Support', 'AgentDesk', 'settings.json');
const BUNDLE_PATH_PATTERN = /(?:^|\/)AgentDesk\.app(?:[./]|$)/;

async function installLocalMacApp(options = {}, dependencies = {}) {
  if (process.platform !== 'darwin' && options.allowNonDarwin !== true) {
    throw installError('macos-required');
  }
  const deps = defaultDependencies(dependencies);
  const source = path.resolve(requiredPath(options.source, 'source-required'));
  const target = path.resolve(options.target || DEFAULT_TARGET);
  validateInstallPaths(source, target, options);
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
  const staging = path.join(destinationDirectory, `.AgentDesk.install-${token}.app`);
  const rollback = path.join(destinationDirectory, `.AgentDesk.rollback-${token}.app`);
  const failed = path.join(destinationDirectory, `.AgentDesk.failed-${token}.app`);
  let rollbackCreated = false;
  let targetPublished = false;
  let launchRequested = false;

  assertGeneratedPath(staging, destinationDirectory, '.AgentDesk.install-');
  assertGeneratedPath(rollback, destinationDirectory, '.AgentDesk.rollback-');
  assertGeneratedPath(failed, destinationDirectory, '.AgentDesk.failed-');

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
        removeGeneratedBundle(rollback, destinationDirectory, '.AgentDesk.rollback-');
      } catch (_cleanupError) {
        retainedRollback = rollback;
      }
    }
    return { ok: true, source, target, relaunched: true, retainedRollback };
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
            removeGeneratedBundle(staging, destinationDirectory, '.AgentDesk.install-');
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
    if (fs.existsSync(staging)) removeGeneratedBundle(staging, destinationDirectory, '.AgentDesk.install-');
    if (fs.existsSync(failed)) error.failedBundle = failed;
    throw error;
  }
}

function defaultDependencies(overrides) {
  return {
    listProcesses: () => listAgentDeskBundleProcesses(),
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

function listAgentDeskBundleProcesses() {
  let output = '';
  try {
    output = execFileSync('/usr/sbin/lsof', [
      '-n',
      '-P',
      '-F',
      'pcn',
      '-a',
      '-c',
      'AgentDesk',
      '-d',
      'txt'
    ], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (error) {
    // lsof returns 1 when no matching process exists.
    if (error.status === 1 && !error.stdout) return [];
    if (typeof error.stdout === 'string') output = error.stdout;
    else throw installError('process-inspection-failed');
  }
  return parseLsofProcesses(output).filter((entry) => (
    entry.paths.some((item) => BUNDLE_PATH_PATTERN.test(item))
  ));
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
  return entry.command === 'AgentDesk' ? 0 : 1;
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

function validateInstallPaths(source, target, options) {
  if (source === target) throw installError('source-equals-target');
  if (path.basename(source) !== 'AgentDesk.app') throw installError('source-bundle-name-invalid');
  if (path.basename(target) !== 'AgentDesk.app') throw installError('target-bundle-name-invalid');
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
    path.join(__dirname, '..', 'release', 'mac-arm64', 'AgentDesk.app'),
    path.join(__dirname, '..', 'release', 'mac-universal', 'AgentDesk.app'),
    path.join(__dirname, '..', 'release', 'mac', 'AgentDesk.app')
  ].filter((candidate) => fs.existsSync(candidate));
  if (candidates.length !== 1) throw installError('build-source-ambiguous');
  return candidates[0];
}

async function main() {
  try {
    const result = await installLocalMacApp(parseArguments(process.argv.slice(2)));
    process.stdout.write(`Installed and verified ${result.target}\n`);
  } catch (error) {
    const failed = error.failedBundle ? `; failed bundle kept at ${error.failedBundle}` : '';
    process.stderr.write(`AgentDesk local install failed: ${error.code || error.message}${failed}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  APP_ID,
  DEFAULT_TARGET,
  BUNDLE_PATH_PATTERN,
  parseLsofProcesses,
  listAgentDeskBundleProcesses,
  temporarilyKeepManagedClients,
  installLocalMacApp,
  validateInstallPaths
};
