'use strict';

// Electron main entry for checks that must not disturb the person using this
// computer: the real AgentDesk Main process and renderer, but no window is
// ever shown or focused, the keychain is mocked, and every channel that would
// start an official client, open a native dialog, reveal a file, write the
// system clipboard or reach the network is answered by a recording stub.
// Use only with a disposable --user-data-dir and a temp HOME (see
// scripts/hidden-check.js and `node scripts/ui-acceptance.js --hidden`).
//
// Optional task (AGENTDESK_HIDDEN_TASK=probe): once start-up has settled,
// record IPC payload shapes and scanner calls, write them to
// AGENTDESK_HIDDEN_OUTPUT and exit.

const fs = require('node:fs');
// The device name comes from the system hostname, which macOS changes with the
// network (e.g. "localhost", "bogon"); hidden runs use one fixed name so the
// screenshots and computed styles do not depend on it.
require('node:os').hostname = () => 'agentdesk-hidden';
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = electron;

const ROOT = path.resolve(__dirname, '..');
const startedAt = Date.now();
const record = { stubbed: [], blockedProcesses: [], scans: [], clipboard: [], startupReadyAt: null, syncOnRefresh: { total: 0, byCaller: {} }, workerCalls: [], mainLag: [] };
const task = process.env.AGENTDESK_HIDDEN_TASK || '';
const output = process.env.AGENTDESK_HIDDEN_OUTPUT || '';
// Without a task the caller may kill this process at any time, so every stub
// or block is written out as it happens.
function note(list, entry) {
  record[list].push(entry);
  if (!task && output) fs.writeFileSync(output, JSON.stringify({ stubbed: record.stubbed, blockedProcesses: record.blockedProcesses }));
}

if (typeof app.setAppPath === 'function') app.setAppPath(ROOT);
app.setName('AgentDesk');
for (const flag of ['use-mock-keychain', 'disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) {
  app.commandLine.appendSwitch(flag);
}

for (const name of ['show', 'showInactive', 'focus', 'moveTop', 'flashFrame']) {
  BrowserWindow.prototype[name] = function hiddenNoop() {};
}
app.focus = () => {};
app.whenReady().then(() => { if (process.platform === 'darwin') app.dock?.hide(); });

// Native dialogs would appear on screen: answer them as cancelled. Renderer
// confirm()/alert() reach Main as showMessageBox with an AbortSignal; when a
// DevTools client drives the page (AGENTDESK_HIDDEN_JS_DIALOGS=devtools) those
// stay pending until DevTools answers and Electron aborts the signal.
dialog.showOpenDialog = async () => { note('stubbed', { api: 'dialog.showOpenDialog' }); return { canceled: true, filePaths: [] }; };
dialog.showSaveDialog = async () => { note('stubbed', { api: 'dialog.showSaveDialog' }); return { canceled: true, filePath: undefined }; };
dialog.showMessageBox = async (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && !(arg instanceof BrowserWindow)) || {};
  const cancel = Number.isInteger(options.cancelId) ? options.cancelId : 0;
  if (options.signal && process.env.AGENTDESK_HIDDEN_JS_DIALOGS === 'devtools') {
    return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ response: cancel, checkboxChecked: false }), { once: true }));
  }
  note('stubbed', { api: 'dialog.showMessageBox' });
  return { response: cancel, checkboxChecked: false };
};
dialog.showOpenDialogSync = () => undefined;
dialog.showSaveDialogSync = () => undefined;
dialog.showMessageBoxSync = (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && !(arg instanceof BrowserWindow)) || {};
  return Number.isInteger(options.cancelId) ? options.cancelId : 0;
};
dialog.showErrorBox = () => {};
shell.openPath = async () => { note('stubbed', { api: 'shell.openPath' }); return ''; };
shell.showItemInFolder = () => { note('stubbed', { api: 'shell.showItemInFolder' }); };
shell.openExternal = async () => { note('stubbed', { api: 'shell.openExternal' }); };
clipboard.writeText = (value) => { record.clipboard.push(String(value).length); };
// No network from a hidden check (update and tool version lookups fail as offline).
globalThis.fetch = async () => { throw new Error('hidden-check-offline'); };

// Official clients, their CLIs and app launchers never start from a hidden
// check: the command is replaced by a path that does not exist, so callers see
// the ordinary "not installed" error. Read-only system tools (ps, lsof,
// sqlite3, git, plutil, codesign, ditto) and node itself still run.
const childProcess = require('node:child_process');
const BLOCKED = /(?:^|[\\/])(?:codex|claude|kimi|dsh|opencode|gemini|qwen|cursor-agent|cursor|copilot|goose|open|osascript|xdg-open|ChatGPT|Claude|Cursor|Kimi)(?:\.exe|\.cmd)?$/i;
const callerOf = () => (new Error().stack.split('\n').slice(3).find((line) => line.includes(`${path.sep}src${path.sep}`)) || '').trim().replace(ROOT, '');
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function guarded(command, ...rest) {
    if (typeof command === 'string' && BLOCKED.test(command)) {
      note('blockedProcesses', { api: name, command: path.basename(command), caller: callerOf() });
      return original.call(this, path.join(ROOT, 'hidden-check-blocked', path.basename(command)), ...rest);
    }
    return original.call(this, command, ...rest);
  };
}

// Synchronous file and process calls that AgentDesk code makes on this (the
// main) thread while serving the renderer's refresh path: the 8-second
// activity poll and the session list it reloads. Counted per call site; the
// scan worker is another thread and is not counted here.
const { AsyncLocalStorage } = require('node:async_hooks');
const refreshContext = new AsyncLocalStorage();
const REFRESH_CHANNELS = new Set(['activity:all', 'sessions:list', 'remoteInventory:listSessions']);
function countSyncCall(name) {
  if (refreshContext.getStore() !== true) return;
  const line = new Error().stack.split('\n').slice(3).find((frame) => frame.includes(`${path.sep}src${path.sep}`));
  const site = line && line.match(/(src[\\/][^:()]+):(\d+)/);
  if (!site) return;
  const key = `${name} ${site[1].split(path.sep).join('/')}:${site[2]}`;
  record.syncOnRefresh.total += 1;
  record.syncOnRefresh.byCaller[key] = (record.syncOnRefresh.byCaller[key] || 0) + 1;
}
for (const name of Object.keys(fs).filter((key) => key.endsWith('Sync') && typeof fs[key] === 'function')) {
  const original = fs[name];
  fs[name] = Object.assign(function watchedSync(...args) {
    countSyncCall(name);
    return original.apply(this, args);
  }, original);
}
for (const name of ['execSync', 'execFileSync', 'spawnSync']) {
  const original = childProcess[name];
  childProcess[name] = Object.assign(function watchedSync(...args) {
    countSyncCall(name);
    return original.apply(this, args);
  }, original);
}

// Channels that start official clients or their CLIs. The renderer still gets
// a well-formed refusal, so the surrounding UI paths keep running.
const STUBS = {
  'profiles:launch': () => ({ ok: false, reasonCode: 'hidden-check-stub' }),
  'agentDeployments:ensureReady': () => ({ ok: false, state: 'waiting-login', reasonCode: 'hidden-check-stub' }),
  'quota:all': () => [],
  'credentials:status': () => ({ ok: false, reasonCode: 'hidden-check-stub' }),
  'tools:open': () => ({ ok: false, reasonCode: 'hidden-check-stub' }),
  'tools:update': () => ({ ok: false, reasonCode: 'hidden-check-stub' }),
  'updates:install': () => ({ ok: false, reasonCode: 'hidden-check-stub' }),
  'devices:probeTransport': () => ({ ok: false, reasonCode: 'hidden-check-stub' })
};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, STUBS[channel]
  ? (...args) => { note('stubbed', { channel }); return STUBS[channel](...args); }
  : (REFRESH_CHANNELS.has(channel) ? (...args) => refreshContext.run(true, () => listener(...args)) : listener));

// Count scanner calls per profile (a full scan = every profile scanned once).
const apps = require(path.join(ROOT, 'src/apps.js'));
const originalGetApp = apps.getApp;
apps.getApp = (appId) => {
  const app_ = originalGetApp(appId);
  if (!app_ || typeof app_.scan !== 'function') return app_;
  return { ...app_, scan(profile, ...rest) { record.scans.push({ profileId: profile?.id, at: Date.now() - startedAt, where: 'here' }); return app_.scan(profile, ...rest); } };
};

// Scans on the worker thread are counted where they are requested; scans done
// in this process are counted by the getApp() wrapper above.
const scanHostModule = require(path.join(ROOT, 'src/scan-host.js'));
const originalCreateScanHost = scanHostModule.createScanHost;
const scanHosts = [];
scanHostModule.createScanHost = (options = {}) => {
  const host = originalCreateScanHost({
    ...options,
    onScan: (profile, where) => {
      if (where === 'worker') record.scans.push({ profileId: profile?.id, at: Date.now() - startedAt, where: 'worker' });
      options.onScan?.(profile, where);
    }
  });
  // Each worker call's round trip, for hidden-check --lag.
  for (const name of ['scan', 'activityRaw']) {
    const call = host[name].bind(host);
    host[name] = async (...args) => {
      const started = performance.now();
      try {
        return await call(...args);
      } finally {
        record.workerCalls.push({ kind: name, ms: Number((performance.now() - started).toFixed(1)), epoch: Date.now() });
      }
    };
  }
  scanHosts.push(host);
  return host;
};

// hidden-check --lag: how long the main thread's event loop is held, sampled
// every 5 ms (only gaps over 4 ms are kept).
if (process.env.AGENTDESK_HIDDEN_LAG === '1') {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const held = now - last - 5;
    if (held > 4) record.mainLag.push({ ms: Number(held.toFixed(1)), epoch: Date.now() });
    last = now;
  }, 5).unref();
}

if (task === 'probe') {
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => runProbe(window).catch((error) => finish({ error: error.stack || String(error) }, 2)));
  });
  setTimeout(() => finish({ error: 'hidden-check-timeout' }, 3), Number(process.env.AGENTDESK_HIDDEN_TIMEOUT_MS) || 90_000).unref();
}

function finish(result, code = 0) {
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2));
  app.exit(code);
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source, true);
}

async function waitFor(window, condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(window, `Boolean(${condition})`).catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const SHAPE_SOURCE = `
  function shapeOf(value, depth = 0) {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      if (!value.length) return ['empty'];
      const merged = value.map((item) => shapeOf(item, depth + 1));
      if (merged.every((item) => typeof item === 'object' && item && !Array.isArray(item))) {
        const keys = {};
        for (const item of merged) for (const [key, shape] of Object.entries(item)) {
          const text = JSON.stringify(shape);
          keys[key] = keys[key] ? [...new Set([...keys[key], text])] : [text];
        }
        const out = {};
        for (const key of Object.keys(keys).sort()) out[key] = keys[key].length === 1 ? JSON.parse(keys[key][0]) : { anyOf: keys[key].map((text) => JSON.parse(text)) };
        return [out];
      }
      return [...new Set(merged.map((item) => JSON.stringify(item)))].map((text) => JSON.parse(text));
    }
    if (typeof value === 'object') {
      if (depth > 8) return 'object';
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = shapeOf(value[key], depth + 1);
      return out;
    }
    return typeof value;
  }`;

async function runProbe(window) {
  const ready = await waitFor(window, `document.documentElement.dataset.boot === 'done' && typeof AgentDeskInspect !== 'undefined'`, 40_000);
  record.startupReadyAt = Date.now() - startedAt;
  // Let the first activity and catalog refreshes that follow "ready" land.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const shapes = await evaluate(window, `(async () => {
    ${SHAPE_SOURCE}
    const m = window.manager;
    const profiles = await m.listProfiles();
    const first = profiles[0] || null;
    const calls = {
      'apps:list': () => m.listApps(),
      'settings:get': () => m.getSettings(),
      'devices:list': () => m.listDevices({}),
      'profiles:list': () => m.listProfiles(),
      'agentCatalog:list': () => m.listAgentCatalog(),
      'agentSlots:list': () => m.listAgentSlots(),
      'sessions:list': () => m.listSessions(first),
      'remoteInventory:listSessions': () => m.listMeshSessions(),
      'activity:all': () => m.listActivity(),
      'sessionMarks:get': () => m.getSessionMarks(),
      'taskPackages:list': () => m.listTaskPackages(),
      'transfers:list': () => m.listTransfers(),
      'remoteControl:list': () => m.listRemoteControls(),
      'devices:getNetworkConfig': () => m.getDeviceNetworkConfig(),
      'devices:listPairingClaims': () => m.listPairingClaims(),
      'hub:state': () => m.hubState(),
      'diagnostics:get': () => m.getDiagnostics(first)
    };
    const out = {};
    for (const [channel, call] of Object.entries(calls)) {
      try { out[channel] = shapeOf(await call()); }
      catch (error) { out[channel] = { rejected: String(error && error.message || error).replace(/^Error invoking remote method '[^']+': /, '').slice(0, 120) }; }
    }
    return out;
  })()`);
  // One more refresh round once everything has loaded: the activity poll and
  // the session list for every account, as the renderer repeats them.
  const before = { total: record.syncOnRefresh.total, byCaller: { ...record.syncOnRefresh.byCaller } };
  await evaluate(window, `(async () => {
    const m = window.manager;
    await m.listActivity();
    for (const profile of AgentDeskInspect.state.profiles) { try { await m.listSessions(profile); } catch (_error) { /* counted by the shapes */ } }
  })()`);
  record.syncOnRefreshSteady = {
    total: record.syncOnRefresh.total - before.total,
    byCaller: Object.fromEntries(Object.entries(record.syncOnRefresh.byCaller)
      .map(([key, count]) => [key, count - (before.byCaller[key] || 0)])
      .filter(([, count]) => count > 0))
  };
  const profileCount = await evaluate(window, 'AgentDeskInspect.state.profiles.length');
  // Optional extra renderer expression for a phase check (hidden-check --eval).
  // hidden-check --write: one session file gets a new line every few seconds
  // for a while, starting with the expression, as a session that is writing.
  if (process.env.AGENTDESK_HIDDEN_WRITE) {
    const [file, every, span] = process.env.AGENTDESK_HIDDEN_WRITE.split('|');
    const started = Date.now();
    record.writer = { startedEpoch: started, writes: 0 };
    const timer = setInterval(() => {
      if (Date.now() - started >= Number(span)) { clearInterval(timer); record.writer.endedEpoch = Date.now(); return; }
      fs.appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', message: 'hidden-check write' } })}\n`);
      record.writer.writes += 1;
    }, Number(every));
  }
  const extra = process.env.AGENTDESK_HIDDEN_EVAL ? await evaluate(window, process.env.AGENTDESK_HIDDEN_EVAL) : undefined;
  // Whether each scan host is using its worker thread now (false: the in-process fallback).
  record.scanHostsUseWorker = scanHosts.map((host) => host.usesWorker());
  record.packaged = app.isPackaged;
  finish({ ready, shapes, profileCount, extra, ...record });
}

require(path.join(ROOT, 'src/main.js'));
