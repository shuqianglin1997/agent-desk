'use strict';

// AgentDesk — opening a local profile: finding the official client's executable
// (macOS bundles, Windows registry, MSIX/Appx and URL protocols), launching it
// with the profile's own data directory, whether it is running, diagnostics,
// and moving a Windows profile out of the default path. Moved out of
// src/main.js unchanged; Main's services come through `main` (mainContext).

const apps = require('../apps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const windows = require('../windows');
const { activateMacProfileApplication, defaultMacApplicationActivatorPath } = require('../mac-application-activator');
const { execFileSync, spawn } = require('node:child_process');
const { isDefaultWindowsAppRunning, isRunningIn, profileRunningSignal, snapshotProcesses } = require('../process');
const { macApplicationBundlePath, macLaunchServicesArgs } = require('../mac-launch');
const { openMaintenanceTool } = require('./tools');
const { prepareManagedProfileHome } = require('../profile-home');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

const WINDOWS_DISCOVERY_TTL = 30_000;

const windowsDiscoveryCache = new Map();

const PROFILE_COPY_EXCLUDES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'crashpad',
  'dawncache',
  'shadercache'
]);

function profileIsRunning(psText, profile) {
  if (usesWindowsOfficialDefault(profile)) {
    return isDefaultWindowsAppRunning(
      psText,
      apps.getApp(profile.appId).windows?.executableNames || []
    );
  }
  const plan = apps.profileLaunchPlan(profile);
  return profileRunningSignal(psText, profile.profilePath, {
    launchesWithDataDir: plan.ok && plan.args.some((arg) => String(arg).startsWith('--user-data-dir=')),
    isOfficialDefaultFolder: (profilePath) => process.platform !== 'win32'
      && main.pathsEqual(profilePath, apps.defaultProfilePathInfo(profile.appId)?.path)
  });
}

function usesWindowsOfficialDefault(profile) {
  return process.platform === 'win32' &&
    profile.isProtected &&
    profile.profilePathMode === 'auto';
}

async function launchProfile(profile) {
  if (!apps.isKnownApp(profile.appId)) {
    return { ok: false, reason: main.t('main.tools.profileMismatch') };
  }
  const app_ = apps.getApp(profile.appId);
  if (app_.cliDiscoveryId) {
    prepareManagedProfileHome(profile);
    return openMaintenanceTool(app_.maintenanceToolId, profile.id);
  }
  if (app_.noLaunch) {
    return {
      ok: false,
      reason: main.t('main.launch.cliRuns', { label: app_.label })
    };
  }
  const appName = app_.appName;
  const windowsDefault = usesWindowsOfficialDefault(profile);
  const launchPlan = apps.profileLaunchPlan(profile, {
    useOfficialDefault: windowsDefault
  });
  if (!launchPlan.ok) {
    return {
      ok: false,
      reasonCode: launchPlan.reasonCode,
      reason: launchPlan.reasonCode === 'profile-isolation-unsupported'
        ? main.t('main.launch.profileIsolationUnsupported', { label: app_.label })
        : main.t('main.launch.runtimeCheckFailed', { code: launchPlan.reasonCode })
    };
  }
  const runtimeSupervisor = main.getProfileRuntimeSupervisor();

  if (launchPlan.isolated) {
    const preflight = await runtimeSupervisor.preflight(profile);
    if (!preflight.ok) {
      return {
        ok: false,
        reasonCode: preflight.reasonCode,
        reason: preflight.reasonCode === 'profile-crashpad-fused'
          ? main.t('main.launch.crashpadFused')
          : main.t('main.launch.runtimeCheckFailed', { code: preflight.reasonCode })
      };
    }
    if (preflight.alreadyRunning) {
      if (process.platform === 'darwin') {
        const activated = await activateMacProfileApplication(profile, {
          helperPath: defaultMacApplicationActivatorPath({
            isPackaged: main.app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: main.app.getAppPath()
          })
        });
        if (!activated.ok) {
          return {
            ok: false,
            alreadyRunning: true,
            reasonCode: activated.reasonCode,
            reason: main.t('main.launch.activationFailed', { code: activated.reasonCode })
          };
        }
        return {
          ok: true,
          alreadyRunning: true,
          activated: true,
          warning: main.t('main.launch.activated')
        };
      }
      return {
        ok: true,
        alreadyRunning: true,
        warning: main.t('main.launch.alreadyRunning')
      };
    }
  }

  // Store/MSIX owns the default profile directory and may virtualize it. Let
  // the packaged app create that location itself. Managed profiles live
  // outside AppData and are safe for AgentDesk to create directly.
  try {
    if (!windowsDefault) {
      prepareManagedProfileHome(profile);
      main.ensureDir(profile.profilePath);
      main.ensureDir(profile.sessionRoot);
    } else if (app_.managedHome?.outsideAppData) {
      prepareManagedProfileHome(profile);
      main.ensureDir(profile.sessionRoot);
    }
  } catch (error) {
    return { ok: false, reason: main.t('main.err.cannotPrepDir', { msg: error.message }) };
  }

  const args = launchPlan.args;
  let runtimeProfile = profile;
  if (app_.runtimeHome && process.platform === 'darwin') {
    const runtimeHome = app_.runtimeHome.ensure(profile);
    if (runtimeHome.aliased) runtimeProfile = { ...profile, sessionRoot: runtimeHome.sessionRoot };
  }
  const env = app_.launchEnv(runtimeProfile, { ...process.env });
  if (process.platform === 'win32') windowsDiscoveryCache.clear();
  const launcher = findExecutable(profile);
  const launchOwned = async (command, launchArgs, launchEnv) => {
    const launched = await spawnDetached(command, launchArgs, launchEnv);
    const runtime = launchPlan.isolated ? runtimeSupervisor.registerLaunch(profile, launched) : null;
    return { launched, runtime };
  };

  try {
    if (process.platform === 'darwin') {
      if (launcher.found) {
        const bundlePath = launcher.bundlePath || macApplicationBundlePath(launcher.path);
        if (!bundlePath) throw new Error('mac-launch-bundle-required');
        await launchOwned(
          '/usr/bin/open',
          macLaunchServicesArgs(bundlePath, args, env, process.env),
          env
        );
        return {
          ok: true,
          command: `open -a ${bundlePath}`,
          source: launcher.source
        };
      }

      const requiresVerifiedBundleIdentity = apps.macLauncherCandidates(profile.appId)
        .some((candidate) => candidate.bundleIdentifiers.length > 0);
      if (requiresVerifiedBundleIdentity) {
        return {
          ok: false,
          reasonCode: 'client-not-installed',
          reason: main.t('main.launch.noLauncher', {
            appName,
            suffix: launcher.candidates.length
              ? ` (${launcher.candidates.join(', ')})`
              : ''
          })
        };
      }

      const launchAppName = apps.macLaunchAppName(profile.appId);
      await launchOwned(
        '/usr/bin/open',
        macLaunchServicesArgs(launchAppName, args, env, process.env),
        env
      );
      return { ok: true, command: `open -a ${launchAppName}`, warning: main.t('main.launch.launchServices') };
    }

    if (process.platform === 'win32') {
      const failures = [];
      for (const executable of launcher.candidateDetails.filter((item) => item.exists)) {
        try {
          await launchOwned(executable.path, args, env);
          return {
            ok: true,
            command: executable.path,
            source: executable.source,
            warning: executable.source?.startsWith('Microsoft Store / MSIX')
              ? main.t('main.launch.storeMsix')
              : null
          };
        } catch (error) {
          failures.push(`${executable.path}: ${error.message}`);
        }
      }

      if (windowsDefault && launcher.protocolAvailable) {
        await main.shell.openExternal(app_.windows.protocol);
        return {
          ok: true,
          command: app_.windows.protocol,
          source: main.t('main.launch.winProtocolSource'),
          warning: main.t('main.launch.winProtocolWarn')
        };
      }

      const suffix = failures.length ? main.t('main.launch.foundSuffix', { first: failures[0] }) : '';
      return {
        ok: false,
        reason: main.t('main.launch.noLauncher', { appName, suffix })
      };
    }

    await launchOwned(launcher.path || appName.toLowerCase(), args, env);
    return { ok: true, command: launcher.path || appName.toLowerCase() };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function diagnoseProfile(profile) {
  const appName = main.managedAppName(profile.appId);
  const executable = findExecutable(profile);
  executable.protocolUsable = usesWindowsOfficialDefault(profile) && executable.protocolAvailable;
  executable.launchable = executable.found || executable.protocolUsable;
  executable.configuredPath = profile.executablePath || null;
  const profilePath = inspectPath(profile.profilePath, { createable: true });
  const sessionRoot = inspectPath(profile.sessionRoot, { createable: true });
  const app_ = apps.getApp(profile.appId);
  const sessionAreas = app_.diagnosticAreas(profile).map((area) => ({
    ...area,
    ...inspectPath(area.path, { createable: false })
  }));
  const sessions = main.actionRowsOf(profile);
  const warnings = [];
  const defaultProfile = apps.defaultProfilePathInfo(profile.appId);
  const migration = windowsMigrationInfo(profile);
  const runtime = main.getProfileRuntimeSupervisor().status(profile);
  const launchPlan = apps.profileLaunchPlan(profile, {
    useOfficialDefault: usesWindowsOfficialDefault(profile)
  });

  if (!executable.found && !executable.protocolUsable) {
    warnings.push(main.t('main.warn.appNotFound', { appName }));
  }
  if (launchPlan.reasonCode === 'profile-isolation-unsupported') {
    warnings.push(main.t('main.warn.profileIsolationUnsupported', { label: app_.label }));
  }
  if (executable.explicitMissing) {
    warnings.push(main.t('main.warn.manualPathInvalid'));
  }
  if (!profilePath.exists) {
    warnings.push(main.t('main.warn.profileDirMissing'));
  } else if (!profilePath.readable || !profilePath.writable) {
    warnings.push(main.t('main.warn.profileDirPerm'));
  }
  if (!sessionRoot.exists) {
    warnings.push(main.t('main.warn.sessionRootMissing'));
  } else if (!sessionRoot.readable) {
    warnings.push(main.t('main.warn.sessionRootUnreadable'));
  }
  if (sessions.length === 0 && sessionRoot.exists && sessionRoot.readable) {
    warnings.push(main.t('main.warn.noSessionFiles', { label: app_.label }));
  }
  if (process.platform === 'win32' && migration.needed) {
    warnings.push(main.t('main.warn.appDataProfile'));
  }
  if (runtime.fusedAt) warnings.push(main.t('main.warn.crashpadFused'));
  if (runtime.crashpad.errorCode) warnings.push(main.t('main.warn.crashpadUnsafe'));
  if (
    process.platform === 'win32' &&
    !usesWindowsOfficialDefault(profile) &&
    windows.isPathInsideWindowsAppData(profile.sessionRoot) &&
    !main.isSubpath(profile.sessionRoot, profile.profilePath)
  ) {
    warnings.push(main.t('main.warn.appDataSessionRoot'));
  }
  if (process.platform === 'win32' && /[^\x00-\x7f]/.test(profile.profilePath)) {
    warnings.push(main.t('main.warn.nonAscii'));
  }
  if (process.platform === 'win32' && Math.max(profile.profilePath.length, profile.sessionRoot.length) >= 240) {
    warnings.push(main.t('main.warn.nearWinLimit'));
  }

  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    appName,
    executable,
    profilePath,
    sessionRoot,
    sessionAreas,
    sessionCount: sessions.length,
    storeFile: main.profilesFile(),
    userData: main.app.getPath('userData'),
    defaultProfile,
    migration,
    runtime,
    profileIsolation: {
      supported: launchPlan.ok,
      isolated: launchPlan.isolated === true,
      reasonCode: launchPlan.ok ? null : launchPlan.reasonCode
    },
    warnings
  };
}

function windowsMigrationInfo(profile) {
  if (process.platform !== 'win32' || usesWindowsOfficialDefault(profile)) {
    return { needed: false, recommendedPath: null, source: null, candidates: [] };
  }
  const recommendedPath = main.makeIsolatedProfilePath(profile.appId, profile.name, profile.id);
  const risky = windows.isPathInsideWindowsAppData(profile.profilePath);
  const source = windows.chooseWindowsMigrationSource(profile.profilePath, apps.getApp(profile.appId));
  return {
    needed: risky && !main.pathsEqual(profile.profilePath, recommendedPath),
    recommendedPath,
    source: source.path,
    candidates: source.candidates
  };
}

function inspectPath(itemPath, options = {}) {
  const result = {
    path: itemPath,
    length: String(itemPath || '').length,
    exists: false,
    isDirectory: false,
    isFile: false,
    readable: false,
    writable: false,
    createable: Boolean(options.createable)
  };

  if (!itemPath) return result;

  try {
    const stat = fs.statSync(itemPath);
    result.exists = true;
    result.isDirectory = stat.isDirectory();
    result.isFile = stat.isFile();
  } catch (_error) {
    return result;
  }

  try {
    fs.accessSync(itemPath, fs.constants.R_OK);
    result.readable = true;
  } catch (_error) {
    result.readable = false;
  }

  try {
    fs.accessSync(itemPath, fs.constants.W_OK);
    result.writable = true;
  } catch (_error) {
    result.writable = false;
  }

  return result;
}

function findExecutable(profileOrAppId) {
  const profile = typeof profileOrAppId === 'string'
    ? { appId: profileOrAppId, executablePath: null }
    : profileOrAppId;
  const app_ = apps.getApp(profile.appId);
  const appName = app_.appName;
  const explicitPath = profile.executablePath || null;

  if (process.platform === 'darwin') {
    const candidateDetails = [
      ...(explicitPath ? [{
        path: explicitPath,
        bundlePath: macApplicationBundlePath(explicitPath),
        source: main.t('main.src.manual'),
        exists: fs.existsSync(explicitPath),
        identityMatches: true,
        bundleIdentifier: null
      }] : []),
      ...apps.macLauncherCandidates(profile.appId).map((candidate) => {
        const exists = fs.existsSync(candidate.path);
        const bundleIdentifier = exists && candidate.bundleIdentifiers.length
          ? macBundleIdentifier(candidate.bundlePath)
          : null;
        const identityMatches = candidate.bundleIdentifiers.length === 0
          || candidate.bundleIdentifiers.includes(bundleIdentifier);
        return {
          path: candidate.path,
          bundlePath: candidate.bundlePath,
          source: main.t('main.src.standardAppDir'),
          exists,
          identityMatches,
          bundleIdentifier,
          expectedBundleIdentifiers: candidate.bundleIdentifiers
        };
      })
    ];
    const executable = candidateDetails.find((candidate) => (
      candidate.exists && candidate.identityMatches
    ));
    const candidates = candidateDetails.map((candidate) => candidate.path);
    return {
      found: Boolean(executable),
      path: executable?.path || null,
      bundlePath: executable?.bundlePath || null,
      source: executable?.source || null,
      candidates,
      candidateDetails,
      explicitMissing: Boolean(explicitPath && !fs.existsSync(explicitPath)),
      protocolAvailable: false
    };
  }

  if (process.platform === 'win32') {
    const registryExecutablePaths = queryWindowsRegistryExecutablePaths(app_) || [];
    const msixRegistryExecutablePaths = queryWindowsMsixRegistryExecutablePaths(app_) || [];
    const appxExecutablePaths = queryWindowsAppxExecutablePaths(app_) || [];
    const resolved = windows.resolveWindowsLauncher(app_, {
      explicitPath,
      registryExecutablePaths,
      msixRegistryExecutablePaths,
      appxExecutablePaths
    });
    return {
      ...resolved,
      protocolAvailable: hasWindowsProtocol(app_),
      discoveryChannels: [
        { source: main.t('main.src.winAppPathsReg'), count: registryExecutablePaths.length },
        { source: main.t('main.src.msixReg'), count: msixRegistryExecutablePaths.length },
        { source: 'Get-AppxPackage', count: appxExecutablePaths.length }
      ]
    };
  }

  const candidates = explicitPath ? [explicitPath, appName.toLowerCase()] : [appName.toLowerCase()];
  const executable = explicitPath && fs.existsSync(explicitPath) ? explicitPath : appName.toLowerCase();
  return {
    found: Boolean(executable),
    path: executable,
    source: explicitPath && executable === explicitPath ? main.t('main.src.manual') : 'PATH',
    candidates,
    candidateDetails: candidates.map((candidate) => ({
      path: candidate,
      source: candidate === explicitPath ? main.t('main.src.manual') : 'PATH',
      exists: candidate === executable
    })),
    explicitMissing: Boolean(explicitPath && executable !== explicitPath),
    protocolAvailable: false
  };
}

function macBundleIdentifier(bundlePath) {
  try {
    return String(execFileSync('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(bundlePath, 'Contents', 'Info.plist')
    ], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 64 * 1024
    }) || '').trim() || null;
  } catch (_error) {
    return null;
  }
}

function queryWindowsRegistryExecutablePaths(app_) {
  return cachedWindowsDiscovery(`registry:${app_.id}`, () => {
    const output = [];
    const executableNames = app_.windows?.executableNames || [`${app_.appName}.exe`];
    for (const executableName of executableNames) {
      const keys = [
        `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
        `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
        `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`
      ];
      for (const key of keys) {
        try {
          const text = queryWindowsRegistry([key, '/ve']);
          const match = text.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/mi);
          const executable = executableFromCommand(match?.[1]);
          if (executable) output.push(executable);
        } catch (_error) {
          // Missing registry keys are normal.
        }
      }
    }
    return [...new Set(output)];
  });
}

function queryWindowsMsixRegistryExecutablePaths(app_) {
  return cachedWindowsDiscovery(`msix-registry:${app_.id}`, () => {
    let packageList;
    try {
      packageList = queryWindowsRegistry(
        [windows.MSIX_REPOSITORY_PACKAGES_KEY],
        { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }
      );
    } catch (_error) {
      return [];
    }

    const packageKeys = windows.msixRepositoryPackageKeys(app_, packageList, {
      arch: process.arch
    });
    const packageRoots = [];
    // A Store update can briefly leave old package registrations behind.
    // Query several numeric-version-sorted roots and let the normal existence /
    // spawn checks select the first live executable.
    for (const packageKey of packageKeys.slice(0, 16)) {
      try {
        const text = queryWindowsRegistry([packageKey, '/v', 'PackageRootFolder']);
        const packageRoot = windows.registryValueFromQuery(text, 'PackageRootFolder');
        if (packageRoot) packageRoots.push(windows.expandWindowsPath(packageRoot));
      } catch (_error) {
        // A stale package key or a missing value must not block other versions.
      }
    }
    return windows.msixExecutablePaths(app_, packageRoots);
  });
}

function queryWindowsAppxExecutablePaths(app_) {
  return cachedWindowsDiscovery(`appx:${app_.id}`, () => {
    const script = windows.appxExecutableDiscoveryScript(app_);
    if (!script) return [];
    const text = runPowerShell(script);
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z]:\\.*\.exe$/i.test(line));
  });
}

function hasWindowsProtocol(app_) {
  return cachedWindowsDiscovery(`protocol:${app_.id}`, () => {
    const protocol = String(app_.windows?.protocol || '').replace(/:.*$/, '');
    if (!protocol) return false;
    try {
      queryWindowsRegistry([`HKCR\\${protocol}`, '/v', 'URL Protocol']);
      return true;
    } catch (_error) {
      return false;
    }
  });
}

function cachedWindowsDiscovery(key, factory) {
  const cached = windowsDiscoveryCache.get(key);
  if (cached && Date.now() - cached.at < WINDOWS_DISCOVERY_TTL) return cached.value;
  let value;
  try {
    value = factory();
  } catch (_error) {
    value = Array.isArray(cached?.value) ? [] : false;
  }
  windowsDiscoveryCache.set(key, { at: Date.now(), value });
  return value;
}

function runPowerShell(script) {
  const options = {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  };
  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    try {
      return execFileSync(executable, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ], options);
    } catch (_error) {
      // Try the next PowerShell host.
    }
  }
  return '';
}

function queryWindowsRegistry(args, options = {}) {
  return execFileSync('reg.exe', ['query', ...args], {
    encoding: 'utf8',
    timeout: options.timeout || 2000,
    maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
    windowsHide: true
  });
}

function executableFromCommand(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const quoted = trimmed.match(/^"([^"]+\.exe)"/i);
  const plain = trimmed.match(/^(.+?\.exe)(?:\s|$)/i);
  const executable = quoted?.[1] || plain?.[1] || null;
  return executable ? windows.expandWindowsPath(executable) : null;
}

function spawnDetached(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('spawn', () => {
      const launched = {
        pid: Number.isInteger(child.pid) ? child.pid : null,
        processGroupId: process.platform === 'win32' ? null : child.pid
      };
      const timer = setTimeout(() => {
        child.unref();
        finish(resolve, launched);
      }, 350);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) finish(resolve, launched);
        else finish(reject, new Error(main.t('main.err.procExited', { code, signal: signal || '-' })));
      });
    });
  });
}

async function migrateWindowsProfilePath(id) {
  if (process.platform !== 'win32') return { ok: false, reason: main.t('main.mig.winOnly') };
  const profiles = main.loadProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return { ok: false, reason: main.t('main.err.slotNotFoundDot') };

  const profile = profiles[index];
  if (usesWindowsOfficialDefault(profile)) {
    return { ok: false, reason: main.t('main.mig.autoDefault') };
  }
  const migration = windowsMigrationInfo(profile);
  if (!migration.needed) return { ok: true, profile, message: main.t('main.mig.alreadySafe') };

  const sourcePath = migration.source;
  const targetPath = migration.recommendedPath;
  const psText = snapshotProcesses();
  if (psText !== null && (
    isRunningIn(psText, profile.profilePath) ||
    (sourcePath && isRunningIn(psText, sourcePath))
  )) {
    return { ok: false, reason: main.t('main.mig.closeAppFirst', { name: profile.name }) };
  }

  try {
    main.ensureDir(path.dirname(targetPath));
    if (sourcePath && !main.pathsEqual(sourcePath, targetPath)) {
      await fs.promises.cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter: shouldCopyProfileItem
      });
    } else {
      main.ensureDir(targetPath);
    }

    const latest = main.loadProfiles().find((item) => item.id === id);
    if (!latest) return { ok: false, reason: main.t('main.mig.slotRemovedDuring') };
    if (!main.pathsEqual(latest.profilePath, profile.profilePath)) {
      return {
        ok: false,
        reason: main.t('main.mig.pathChangedDuring')
      };
    }

    let sessionRoot = latest.sessionRoot;
    let sessionRootMode = latest.sessionRootMode;
    if (main.pathsEqual(sessionRoot, latest.profilePath)) {
      sessionRoot = targetPath;
      sessionRootMode = 'managed';
    } else if (main.isSubpath(sessionRoot, latest.profilePath)) {
      sessionRoot = path.join(targetPath, path.relative(latest.profilePath, sessionRoot));
      sessionRootMode = 'managed';
    }

    const updated = main.updateStoredProfile(id, (current) => ({
      ...current,
      profilePath: targetPath,
      sessionRoot,
      profilePathMode: 'managed',
      sessionRootMode
    }));
    return {
      ok: true,
      profile: updated,
      sourcePath,
      targetPath,
      message: sourcePath
        ? main.t('main.mig.copiedBackup')
        : main.t('main.mig.createdSafe')
    };
  } catch (error) {
    return { ok: false, reason: main.t('main.mig.failed', { msg: error.message }) };
  }
}

function shouldCopyProfileItem(sourcePath) {
  const name = path.basename(sourcePath).toLowerCase();
  return !PROFILE_COPY_EXCLUDES.has(name);
}

module.exports = { bind, profileIsRunning, usesWindowsOfficialDefault, launchProfile, diagnoseProfile, windowsMigrationInfo, inspectPath, findExecutable, macBundleIdentifier, queryWindowsRegistryExecutablePaths, queryWindowsMsixRegistryExecutablePaths, queryWindowsAppxExecutablePaths, hasWindowsProtocol, cachedWindowsDiscovery, runPowerShell, queryWindowsRegistry, executableFromCommand, spawnDetached, migrateWindowsProfilePath, shouldCopyProfileItem };
