'use strict';

/*
 * Electron entry that renders film frames without showing anything.
 *
 * It opens one window that is never shown or focused (no Dock icon, no
 * activation), loads render/page.html, hands it a job and exits when the page
 * reports back. It does not load the app (src/main.js), its data folder or
 * its keychain item; it only reads the app's art, fonts and word tables.
 *
 *   electron render/main.js --user-data-dir=<dir> --job=<json file>
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const argument = (name) => { const hit = process.argv.find((value) => value.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : ''; };
const jobFile = argument('job');
if (!jobFile) { process.stderr.write('render: --job=<file> is required\n'); process.exit(2); }
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));

app.setName('CatshelfFilmRender');
if (process.platform === 'darwin' && typeof app.setActivationPolicy === 'function') app.setActivationPolicy('accessory');
for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'use-mock-keychain']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('force-color-profile', 'srgb');
for (const name of ['show', 'showInactive', 'focus', 'moveTop', 'flashFrame']) BrowserWindow.prototype[name] = function hiddenNoop() {};
app.focus = () => {};

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  const window = new BrowserWindow({
    show: false, width: 640, height: 400, focusable: false, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false }
  });
  window.webContents.on('console-message', (_event, _level, message) => process.stdout.write(`${message}\n`));
  window.webContents.on('render-process-gone', (_event, details) => { process.stderr.write(`render: page gone (${details.reason})\n`); app.exit(3); });
  ipcMain.handle('film:job', () => job);
  ipcMain.on('film:done', (_event, result) => {
    if (job.report) fs.writeFileSync(job.report, JSON.stringify(result, null, 2));
    app.exit(result && result.error ? 1 : 0);
  });
  window.loadFile(path.join(__dirname, 'page.html'));
});
app.on('window-all-closed', () => app.exit(0));
