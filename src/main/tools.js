'use strict';

// AgentDesk — the tools page: finding installed official desktop apps and CLIs,
// their versions and latest releases, opening one (in a terminal for CLIs) and
// updating one supported tool with its fixed command. Moved out of src/main.js
// unchanged; Main's services come through `main` (mainContext).

const apps = require('../apps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const toolMaintenance = require('../tool-maintenance');
const { cliCandidates, discoverCliInventory, resolveExecutableCandidates } = require('../cli-discovery');
const { execFileSync, spawn } = require('node:child_process');
const { prepareManagedProfileHome } = require('../profile-home');
const { terminalLauncherScript } = require('../terminal-launcher');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

const TOOL_MAINTENANCE_CACHE_TTL = 10 * 60_000;

const TOOL_MAINTENANCE_FETCH_TIMEOUT = 15_000;

const TOOL_MAINTENANCE_UPDATE_TIMEOUT = 15 * 60_000;

const TOOL_MAINTENANCE_MAX_RESPONSE = 512 * 1024;

const TOOL_MAINTENANCE_MAX_OUTPUT = 512 * 1024;

let toolMaintenanceCache = null;

let toolMaintenanceUpdating = null;

function maintenanceManagerLauncher(manager) {
  const names = {
    npm: ['npm'],
    brew: ['brew'],
    uv: ['uv']
  }[manager];
  if (!names) return null;
  return resolveExecutableCandidates(cliCandidates(names, {
    platform: process.platform,
    env: process.env
  }), {
    platform: process.platform,
    env: process.env
  });
}

function maintenanceNpmRoots() {
  const launcher = maintenanceManagerLauncher('npm');
  if (!launcher) return [];
  try {
    const output = execFileSync(
      launcher.command,
      [...(launcher.prefixArgs || []), 'root', '--global'],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: { ...process.env, ...(launcher.extraEnv || {}) }
      }
    );
    return output.split(/\r?\n/).map((item) => item.trim()).filter(path.isAbsolute);
  } catch (_error) {
    return [];
  }
}

function baseMaintenanceLauncher(launcher) {
  if (!launcher) return null;
  const visiblePath = launcher.path || launcher.command;
  if (!visiblePath) return null;
  return resolveExecutableCandidates([{
    path: visiblePath,
    source: launcher.source || 'PATH'
  }], {
    platform: process.platform,
    env: process.env
  }) || launcher;
}

function probeMaintenanceVersion(launcher, versionArgs) {
  if (!launcher || !Array.isArray(versionArgs) || !versionArgs.length) return null;
  try {
    const output = execFileSync(
      launcher.command,
      [...(launcher.prefixArgs || []), ...versionArgs],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          ...(launcher.extraEnv || {}),
          NO_COLOR: '1'
        }
      }
    );
    return toolMaintenance.extractVersion(output);
  } catch (error) {
    return toolMaintenance.extractVersion(
      `${error?.stdout || ''}\n${error?.stderr || ''}`
    );
  }
}

function desktopBundleVersion(executablePath) {
  if (!executablePath) return null;
  if (process.platform === 'darwin') {
    const normalized = executablePath.replace(/\\/g, '/');
    const marker = '.app/Contents/';
    const index = normalized.indexOf(marker);
    if (index < 0) return null;
    const bundleRoot = normalized.slice(0, index + 4);
    const plist = path.join(bundleRoot, 'Contents', 'Info.plist');
    try {
      const output = execFileSync('/usr/bin/plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        plist
      ], {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 64 * 1024
      });
      return toolMaintenance.extractVersion(output);
    } catch (_error) {
      return null;
    }
  }
  if (process.platform === 'win32') {
    const escaped = executablePath.replace(/'/g, "''");
    return toolMaintenance.extractVersion(
      main.runPowerShell(`(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`)
    );
  }
  return null;
}

function maintenanceDesktopRecord(tool) {
  let launcher = null;
  let appId = null;
  for (const candidateId of tool.appIds || []) {
    const candidate = main.findExecutable(candidateId);
    if (candidate?.found || candidate?.protocolAvailable) {
      launcher = candidate;
      appId = candidateId;
      break;
    }
    if (!launcher) {
      launcher = candidate;
      appId = candidateId;
    }
  }
  const installed = Boolean(launcher?.found || launcher?.protocolAvailable);
  const record = {
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
    detail: tool.detail,
    tool,
    appId,
    installed,
    installedVersion: installed ? desktopBundleVersion(launcher?.path) : null,
    latestVersion: null,
    updateAvailable: null,
    source: launcher?.source || (launcher?.protocolAvailable ? main.t('main.launch.winProtocolSource') : ''),
    sourceKey: installed
      ? (launcher?.protocolAvailable && !launcher?.found ? 'windowsProtocol' : 'appDirectory')
      : null,
    executablePath: launcher?.path || null,
    launcher,
    installation: installed ? {
      manager: 'desktop',
      packageName: null,
      writable: false
    } : null,
    canOpen: true
  };
  record.updatePlan = toolMaintenance.updatePlanFor(record);
  return record;
}

function maintenanceCliRecord(tool, discoveredLauncher, npmRoots) {
  const launcher = baseMaintenanceLauncher(discoveredLauncher);
  const installed = Boolean(launcher);
  const installation = installed
    ? toolMaintenance.detectInstallation(launcher.path || launcher.command, tool, { npmRoots })
    : null;
  const installedVersion = installation?.version ||
    (installed ? probeMaintenanceVersion(launcher, tool.versionArgs) : null);
  const record = {
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
    detail: tool.detail,
    tool,
    installed,
    installedVersion,
    latestVersion: null,
    updateAvailable: null,
    source: launcher?.source || '',
    sourceKey: !installed
      ? 'catalog'
      : installation?.manager === 'npm'
        ? 'npmGlobal'
        : installation?.manager === 'brew'
          ? 'homebrew'
          : installation?.manager === 'uv'
            ? 'uvTool'
            : launcher?.source === 'PATH'
              ? 'path'
              : 'localExecutable',
    executablePath: launcher?.path || null,
    launcher,
    installation,
    canOpen: true
  };
  record.updatePlan = toolMaintenance.updatePlanFor(record);
  return record;
}

function maintenanceTerminalRecord(tool) {
  const record = {
    id: tool.id,
    kind: tool.kind,
    label: process.platform === 'win32' ? 'Windows Terminal' : tool.label,
    detail: tool.detail,
    tool,
    installed: true,
    installedVersion: null,
    latestVersion: null,
    updateAvailable: false,
    source: process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'Shell'),
    sourceKey: null,
    installation: { manager: 'system', writable: false },
    canOpen: true
  };
  record.updatePlan = toolMaintenance.updatePlanFor(record);
  return record;
}

async function scanMaintenanceTools(options = {}) {
  if (
    !options.force &&
    toolMaintenanceCache &&
    Date.now() - toolMaintenanceCache.at < TOOL_MAINTENANCE_CACHE_TTL
  ) {
    return publicMaintenanceInventory(toolMaintenanceCache.records, toolMaintenanceCache.checkedAt);
  }

  const cliLaunchers = discoverCliInventory(
    toolMaintenance.TOOL_CATALOG
      .filter((tool) => tool.kind === 'cli')
      .map((tool) => tool.discoveryId),
    { platform: process.platform, env: process.env }
  );
  const npmRoots = maintenanceNpmRoots();
  let records = toolMaintenance.TOOL_CATALOG.map((tool) => {
    if (tool.kind === 'desktop') return maintenanceDesktopRecord(tool);
    if (tool.kind === 'cli') return maintenanceCliRecord(tool, cliLaunchers.get(tool.discoveryId), npmRoots);
    return maintenanceTerminalRecord(tool);
  });

  records = await mapWithConcurrency(records, 4, async (record) => {
    const request = toolMaintenance.latestRequestFor(record);
    if (!request) return toolMaintenance.applyLatestVersion(record, null);
    try {
      const latestVersion = await fetchMaintenanceLatest(request);
      const next = toolMaintenance.applyLatestVersion(record, latestVersion);
      next.updatePlan = toolMaintenance.updatePlanFor(next);
      return next;
    } catch (error) {
      const next = toolMaintenance.applyLatestVersion(record, null, maintenanceErrorMessage(error));
      next.updatePlan = toolMaintenance.updatePlanFor(next);
      return next;
    }
  });

  const checkedAt = new Date().toISOString();
  toolMaintenanceCache = { at: Date.now(), checkedAt, records };
  return publicMaintenanceInventory(records, checkedAt);
}

async function mapWithConcurrency(values, concurrency, worker) {
  const input = Array.isArray(values) ? values : [];
  const output = new Array(input.length);
  let cursor = 0;
  async function consume() {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(input[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), input.length || 1) }, consume)
  );
  return output;
}

async function fetchMaintenanceLatest(request) {
  if (!toolMaintenance.isTrustedLatestRequest(request)) {
    throw new Error(main.t('main.tools.untrustedUpdateSource'));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_MAINTENANCE_FETCH_TIMEOUT);
  try {
    const response = await main.net.fetch(request.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `AgentDesk/${main.app.getVersion()}`
      }
    });
    if (!response.ok) {
      throw new Error(main.t('main.tools.checkHttp', { status: response.status }));
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > TOOL_MAINTENANCE_MAX_RESPONSE) {
      throw new Error(main.t('main.tools.responseTooLarge'));
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > TOOL_MAINTENANCE_MAX_RESPONSE) {
      throw new Error(main.t('main.tools.responseTooLarge'));
    }
    const latest = toolMaintenance.latestVersionFromPayload(request, JSON.parse(text));
    if (!latest) throw new Error(main.t('main.tools.badVersion'));
    return latest;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(main.t('main.tools.checkTimeout'));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// The clients a tool belongs to: a desktop app's own ids, or the clients whose
// conversations run through this command-line tool (updated through it, or
// using it as their command line, as Codex does). The window matches tools to
// accounts by these.
function toolClientIds(record) {
  if (record.kind === 'desktop') return [...(record.tool?.appIds || [])];
  const discoveryId = record.tool?.discoveryId || null;
  return apps.appIds().filter((appId) => {
    const app_ = apps.getApp(appId);
    return app_.maintenanceToolId === record.id || Boolean(discoveryId && app_.cliLauncher?.toolId === discoveryId);
  });
}

function publicMaintenanceInventory(records, checkedAt) {
  const items = records.map((record) => ({ ...toolMaintenance.publicRecord(record), clientIds: toolClientIds(record) }));
  return {
    ok: true,
    checkedAt,
    items,
    summary: {
      total: items.length,
      installed: items.filter((item) => item.installed).length,
      updates: items.filter((item) => item.updateAvailable === true).length,
      automatic: items.filter((item) => (
        item.installed && item.canAutoUpdate && item.updateAvailable !== false
      )).length,
      checkErrors: items.filter((item) => item.checkError).length
    }
  };
}

function maintenanceErrorMessage(error) {
  const message = String(error?.message || error || main.t('main.tools.unknownError'));
  return message.slice(0, 240);
}

async function maintenanceRecord(toolId, options = {}) {
  await scanMaintenanceTools({ force: options.force === true });
  return toolMaintenanceCache?.records.find((item) => item.id === toolId) || null;
}

async function openMaintenanceTool(toolId, requestedProfileId) {
  const tool = toolMaintenance.catalogTool(toolId);
  if (!tool) return { ok: false, reason: main.t('main.tools.notFound') };
  let record = await maintenanceRecord(toolId);
  if (!record?.installed && tool.kind !== 'terminal') {
    record = await maintenanceRecord(toolId, { force: true });
  }
  if (tool.kind === 'desktop' && record?.installed) {
    const profiles = main.loadProfiles();
    const requested = profiles.find((profile) => (
      profile.id === requestedProfileId && tool.appIds.includes(profile.appId)
    ));
    const profile = requested ||
      profiles.find((item) => tool.appIds.includes(item.appId) && item.isProtected) ||
      profiles.find((item) => tool.appIds.includes(item.appId));
    if (profile) {
      const result = await main.launchProfile(profile);
      if (result.ok) {
        main.updateStoredProfile(profile.id, (current) => ({
          ...current,
          lastLaunchedAt: new Date().toISOString()
        }));
      }
      return result;
    }
    if (record.executablePath) {
      try {
        await main.spawnDetached(record.executablePath, [], { ...process.env });
        return { ok: true, message: main.t('main.tools.opened', { label: record.label }) };
      } catch (error) {
        return { ok: false, reason: maintenanceErrorMessage(error) };
      }
    }
  }
  if (tool.kind === 'cli' && record?.installed) {
    const profile = main.loadProfiles().find((item) => item.id === requestedProfileId) || null;
    if (requestedProfileId && !profile) return { ok: false, reason: main.t('main.tools.profileMismatch') };
    // The tools dialog supplies the current selection even for unrelated tools.
    // Only a matching CLI slot supplies an isolated account context.
    const matching = profile && apps.getApp(profile.appId).cliDiscoveryId === tool.discoveryId;
    return openMaintenanceCliInTerminal(record, matching ? profile : null, Boolean(matching));
  }
  if (tool.kind === 'terminal') return openSystemTerminal();
  return openMaintenanceOfficialPage(tool);
}

async function openMaintenanceOfficialPage(tool) {
  if (!tool?.officialUrl) return { ok: false, reason: main.t('main.tools.noOfficialPage') };
  try {
    await main.shell.openExternal(tool.officialUrl);
    return { ok: true, openedOfficial: true, message: main.t('main.tools.openedOfficial') };
  } catch (error) {
    return { ok: false, reason: maintenanceErrorMessage(error) };
  }
}

function maintenanceLauncherFile(record, options = {}) {
  const directory = path.join(main.app.getPath('temp'), 'AgentDesk-tool-launchers');
  main.ensureDir(directory);
  const safeId = record.id.replace(/[^a-z0-9_-]+/gi, '-');
  const extension = process.platform === 'win32' ? 'cmd' : 'command';
  const filePath = path.join(directory, `${safeId}-${Date.now()}.${extension}`);
  const launcher = record.launcher || {};
  const batchLauncher = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(launcher.path || '');
  const executablePath = batchLauncher ? launcher.path : (launcher.command || record.executablePath || launcher.path);
  if (!executablePath) throw new Error(main.t('main.tools.noExecutable'));
  if (process.platform === 'win32' && (executablePath.includes('"') || os.homedir().includes('"'))) {
    throw new Error(main.t('main.tools.invalidExecutable'));
  }
  const script = terminalLauncherScript({
    ...options,
    command: executablePath,
    prefixArgs: batchLauncher ? [] : launcher.prefixArgs,
    extraEnv: launcher.extraEnv,
    baseEnv: options.baseEnv || process.env,
    platform: process.platform,
    home: os.homedir()
  });
  fs.writeFileSync(filePath, script, { encoding: 'utf8', mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o700);
  return filePath;
}

function cliMaintenanceProfileContext(record, profile, profileWasRequested = false) {
  if (!profile) {
    if (profileWasRequested) {
      return { error: main.t('main.tools.profileMismatch') };
    }
    return { launchEnv: { ...process.env }, clearEnvKeys: [], args: [] };
  }
  const app_ = apps.getApp(profile.appId);
  if (app_.cliDiscoveryId !== record.tool?.discoveryId) {
    return { error: main.t('main.tools.profileMismatch') };
  }
  const baseEnv = { ...process.env };
  const launchEnv = app_.launchEnv(profile, baseEnv);
  const listedClearKeys = app_.cliClearEnvKeys || [];
  const clearEnvKeys = [...new Set([
    ...listedClearKeys,
    ...Object.keys(baseEnv).filter((key) => (
      listedClearKeys.includes(key.toUpperCase()) ||
      /^(?:ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|DSH_HOME$)/i.test(key)
    ) && !Object.prototype.hasOwnProperty.call(launchEnv, key))
  ])];
  return {
    launchEnv,
    clearEnvKeys,
    args: app_.cliArgsForProfile ? app_.cliArgsForProfile(profile) : []
  };
}

async function openMaintenanceCliInTerminal(record, profile = null, profileWasRequested = false) {
  try {
    const context = cliMaintenanceProfileContext(record, profile, profileWasRequested);
    if (context.error) return { ok: false, reason: context.error };
    prepareManagedProfileHome(profile);
    const launcherFile = maintenanceLauncherFile(record, {
      ...context,
      baseEnv: process.env
    });
    if (process.platform === 'darwin') {
      await main.spawnDetached('/usr/bin/open', ['-a', 'Terminal', launcherFile], { ...process.env });
    } else if (process.platform === 'win32') {
      await spawnVisibleDetached(
        process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
        ['/D', '/K', launcherFile],
        { ...process.env }
      );
    } else {
      const terminal = linuxTerminalLauncher();
      if (!terminal) throw new Error(main.t('main.tools.noTerminal'));
      await spawnVisibleDetached(terminal.command, [...terminal.args, launcherFile], { ...process.env });
    }
    return { ok: true, message: main.t('main.tools.openedTerminal', { label: record.label }) };
  } catch (error) {
    return { ok: false, reason: maintenanceErrorMessage(error) };
  }
}

async function openSystemTerminal() {
  try {
    if (process.platform === 'darwin') {
      await main.spawnDetached('/usr/bin/open', ['-a', 'Terminal'], { ...process.env });
    } else if (process.platform === 'win32') {
      await spawnVisibleDetached(
        process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
        ['/K'],
        { ...process.env }
      );
    } else {
      const terminal = linuxTerminalLauncher();
      if (!terminal) throw new Error(main.t('main.tools.noTerminal'));
      await spawnVisibleDetached(terminal.command, [], { ...process.env });
    }
    return { ok: true, message: main.t('main.tools.openedTerminal', { label: 'Shell' }) };
  } catch (error) {
    return { ok: false, reason: maintenanceErrorMessage(error) };
  }
}

function linuxTerminalLauncher() {
  const candidates = [
    { command: '/usr/bin/x-terminal-emulator', args: ['-e'] },
    { command: '/usr/bin/gnome-terminal', args: ['--'] },
    { command: '/usr/bin/konsole', args: ['-e'] },
    { command: '/usr/bin/xterm', args: ['-e'] }
  ];
  return candidates.find((candidate) => fs.existsSync(candidate.command)) || null;
}

function spawnVisibleDetached(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function maintenanceCommand(record) {
  const plan = record.updatePlan || toolMaintenance.updatePlanFor(record);
  const args = toolMaintenance.updateArgumentsFor(plan);
  if (!args) return null;
  if (plan.manager === 'self') {
    return record.launcher ? { launcher: record.launcher, args } : null;
  }
  const launcher = maintenanceManagerLauncher(plan.manager);
  return launcher ? { launcher, args } : null;
}

async function updateMaintenanceTool(toolId, sender, options = {}) {
  const tool = toolMaintenance.catalogTool(toolId);
  if (!tool) return { ok: false, reason: main.t('main.tools.notFound') };
  if (toolMaintenanceUpdating) {
    return {
      ok: false,
      reason: main.t('main.tools.updateBusy', { label: toolMaintenanceUpdating })
    };
  }
  const record = await maintenanceRecord(toolId, { force: options.force === true });
  if (!record) return { ok: false, reason: main.t('main.tools.notFound') };
  if (!record.installed || record.updatePlan?.mode === 'manual') {
    return openMaintenanceOfficialPage(tool);
  }
  if (record.updatePlan?.mode !== 'automatic') {
    return { ok: false, reason: main.t('main.tools.systemManaged') };
  }
  if (record.updateAvailable === false) {
    return {
      ok: true,
      current: true,
      message: main.t('main.tools.alreadyCurrent', {
        label: record.label,
        version: record.installedVersion || '-'
      })
    };
  }
  const command = maintenanceCommand(record);
  if (!command) {
    return { ok: false, reason: main.t('main.tools.managerMissing', { label: record.label }) };
  }

  toolMaintenanceUpdating = record.label;
  sendToolProgress(sender, {
    toolId,
    phase: 'starting',
    message: main.t('main.tools.updating', { label: record.label })
  });
  try {
    await runMaintenanceCommand(record, command, sender);
    toolMaintenanceCache = null;
    const inventory = await scanMaintenanceTools({ force: true });
    const updated = inventory.items.find((item) => item.id === toolId);
    const message = main.t('main.tools.updated', {
      label: record.label,
      version: updated?.installedVersion || updated?.latestVersion || '-'
    });
    sendToolProgress(sender, { toolId, phase: 'complete', message });
    return { ok: true, item: updated || null, message };
  } catch (error) {
    const reason = maintenanceErrorMessage(error);
    sendToolProgress(sender, { toolId, phase: 'error', message: reason });
    return { ok: false, reason };
  } finally {
    toolMaintenanceUpdating = null;
  }
}

function runMaintenanceCommand(record, command, sender) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command.launcher.command,
      [...(command.launcher.prefixArgs || []), ...command.args],
      {
        cwd: os.homedir(),
        env: {
          ...process.env,
          ...(command.launcher.extraEnv || {}),
          NO_COLOR: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    let settled = false;
    let capturedBytes = 0;
    let tail = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_error) { /* already exited */ }
      finish(reject, new Error(main.t('main.tools.updateTimeout', { label: record.label })));
    }, TOOL_MAINTENANCE_UPDATE_TIMEOUT);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const consume = (chunk, stream) => {
      if (capturedBytes >= TOOL_MAINTENANCE_MAX_OUTPUT) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = TOOL_MAINTENANCE_MAX_OUTPUT - capturedBytes;
      const text = cleanMaintenanceOutput(buffer.subarray(0, remaining).toString('utf8'));
      capturedBytes += Math.min(buffer.length, remaining);
      if (!text) return;
      tail = `${tail}${text}`.slice(-4000);
      const line = text.trim().split(/\r?\n/).filter(Boolean).pop();
      if (line) {
        sendToolProgress(sender, {
          toolId: record.id,
          phase: 'running',
          stream,
          message: line.slice(0, 240)
        });
      }
    };
    child.stdout?.on('data', (chunk) => consume(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => consume(chunk, 'stderr'));
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      const detail = tail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' · ');
      finish(reject, new Error(
        detail || main.t('main.tools.updateExit', { code, signal: signal || '-' })
      ));
    });
  });
}

function cleanMaintenanceOutput(value) {
  return String(value || '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/[^\P{C}\n\r\t]/gu, '');
}

function sendToolProgress(sender, payload) {
  if (!sender || sender.isDestroyed()) return;
  sender.send('tools:progress', payload);
}

module.exports = { bind, maintenanceManagerLauncher, maintenanceNpmRoots, baseMaintenanceLauncher, probeMaintenanceVersion, desktopBundleVersion, maintenanceDesktopRecord, maintenanceCliRecord, maintenanceTerminalRecord, scanMaintenanceTools, mapWithConcurrency, fetchMaintenanceLatest, publicMaintenanceInventory, maintenanceErrorMessage, maintenanceRecord, openMaintenanceTool, openMaintenanceOfficialPage, maintenanceLauncherFile, cliMaintenanceProfileContext, openMaintenanceCliInTerminal, openSystemTerminal, linuxTerminalLauncher, spawnVisibleDetached, maintenanceCommand, updateMaintenanceTool, runMaintenanceCommand, cleanMaintenanceOutput, sendToolProgress };
