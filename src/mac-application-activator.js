/*
 * Bring an already-running managed macOS client to the foreground by its
 * exact browser-process PID. The native helper uses NSRunningApplication only:
 * no Accessibility, Screen Recording, Apple Events automation or shell.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { snapshotProcessRecords, findProfileMainProcesses } = require('./process');

const MAC_APPLICATION_ACTIVATOR = 'AgentDeskAppActivator';

function defaultMacApplicationActivatorPath(options = {}) {
  const base = options.isPackaged ? options.resourcesPath : options.appPath;
  if (typeof base !== 'string' || !path.isAbsolute(base)) return '';
  return options.isPackaged
    ? path.join(base, 'native', MAC_APPLICATION_ACTIVATOR)
    : path.join(base, 'native', 'bin', MAC_APPLICATION_ACTIVATOR);
}

function validateActivator(helperPath, fsImpl = fs) {
  if (typeof helperPath !== 'string' || !path.isAbsolute(helperPath)) {
    return { ok: false, reasonCode: 'profile-activation-helper-unavailable' };
  }
  try {
    const stat = fsImpl.lstatSync(helperPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { ok: false, reasonCode: 'profile-activation-helper-unsafe' };
    }
    if (process.platform !== 'win32' && Number.isInteger(stat.mode) && (stat.mode & 0o111) === 0) {
      return { ok: false, reasonCode: 'profile-activation-helper-not-executable' };
    }
    return { ok: true };
  } catch (_error) {
    return { ok: false, reasonCode: 'profile-activation-helper-unavailable' };
  }
}

function runActivator(helperPath, pid, options = {}) {
  const invoke = options.execFile || execFile;
  return new Promise((resolve) => {
    invoke(helperPath, ['--pid', String(pid)], {
      encoding: 'utf8',
      timeout: options.timeoutMs || 3_000,
      maxBuffer: 8 * 1024,
      windowsHide: true,
      shell: false
    }, (error) => {
      if (!error) return resolve({ ok: true, pid });
      const reasonCode = error.killed || error.code === 'ETIMEDOUT'
        ? 'profile-activation-helper-timeout'
        : 'profile-activation-helper-failed';
      return resolve({ ok: false, reasonCode });
    });
  });
}

async function activateMacProfileApplication(profile, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'darwin') return { ok: false, reasonCode: 'profile-activation-unsupported' };
  if (!profile?.profilePath) return { ok: false, reasonCode: 'profile-activation-profile-invalid' };

  const records = Object.prototype.hasOwnProperty.call(options, 'records')
    ? options.records
    : (options.snapshotProcessRecords || snapshotProcessRecords)();
  if (records === null) {
    return { ok: false, reasonCode: 'profile-activation-process-snapshot-unavailable' };
  }
  const processes = findProfileMainProcesses(records, profile.profilePath);
  if (!processes.length) {
    return { ok: false, reasonCode: 'profile-activation-main-process-not-found' };
  }

  const helperPath = options.helperPath || '';
  const validation = validateActivator(helperPath, options.fs || fs);
  if (!validation.ok) return validation;

  // Duplicate roots are abnormal but possible after an interrupted launch.
  // Try each exact Profile root; never fall back to a bundle-wide activation
  // that could surface another account using the same official app bundle.
  let failure = { ok: false, reasonCode: 'profile-activation-helper-failed' };
  for (const processRecord of processes) {
    failure = await runActivator(helperPath, processRecord.pid, options);
    if (failure.ok) return failure;
  }
  return failure;
}

module.exports = {
  MAC_APPLICATION_ACTIVATOR,
  defaultMacApplicationActivatorPath,
  validateActivator,
  runActivator,
  activateMacProfileApplication
};
