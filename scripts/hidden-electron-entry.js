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
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = electron;

const ROOT = path.resolve(__dirname, '..');
const startedAt = Date.now();
const record = { stubbed: [], scans: [], clipboard: [], startupReadyAt: null };

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

// Native dialogs would appear on screen: answer them as cancelled.
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
dialog.showMessageBox = async (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && !(arg instanceof BrowserWindow)) || {};
  return { response: Number.isInteger(options.cancelId) ? options.cancelId : 0, checkboxChecked: false };
};
dialog.showOpenDialogSync = () => undefined;
dialog.showSaveDialogSync = () => undefined;
dialog.showMessageBoxSync = (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && !(arg instanceof BrowserWindow)) || {};
  return Number.isInteger(options.cancelId) ? options.cancelId : 0;
};
dialog.showErrorBox = () => {};
shell.openPath = async (target) => { record.stubbed.push({ api: 'shell.openPath', target: String(target).length }); return ''; };
shell.showItemInFolder = (target) => { record.stubbed.push({ api: 'shell.showItemInFolder', target: String(target).length }); };
shell.openExternal = async () => { record.stubbed.push({ api: 'shell.openExternal' }); };
clipboard.writeText = (value) => { record.clipboard.push(String(value).length); };
// No network from a hidden check (update and tool version lookups fail as offline).
globalThis.fetch = async () => { throw new Error('hidden-check-offline'); };

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
  ? (...args) => { record.stubbed.push({ channel }); return STUBS[channel](...args); }
  : listener);

// Count scanner calls per profile (a full scan = every profile scanned once).
const apps = require(path.join(ROOT, 'src/apps.js'));
const originalGetApp = apps.getApp;
apps.getApp = (appId) => {
  const app_ = originalGetApp(appId);
  if (!app_ || typeof app_.scan !== 'function') return app_;
  return { ...app_, scan(profile, ...rest) { record.scans.push({ profileId: profile?.id, at: Date.now() - startedAt }); return app_.scan(profile, ...rest); } };
};

const task = process.env.AGENTDESK_HIDDEN_TASK || '';
const output = process.env.AGENTDESK_HIDDEN_OUTPUT || '';

if (task === 'probe') {
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => runProbe(window).catch((error) => finish({ error: error.stack || String(error) }, 2)));
  });
  setTimeout(() => finish({ error: 'hidden-check-timeout' }, 3), 90_000).unref();
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
  const ready = await waitFor(window, `document.documentElement.dataset.boot === 'done' && typeof state !== 'undefined'`, 40_000);
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
  const profileCount = await evaluate(window, 'state.profiles.length');
  finish({ ready, shapes, profileCount, ...record });
}

require(path.join(ROOT, 'src/main.js'));
