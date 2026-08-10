const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { runWebRtcProbe } = require('../main/webrtc-probe');

app.whenReady().then(async () => {
  try {
    const result = await runWebRtcProbe({
      BrowserWindow,
      ipcMain,
      probeDirectory: __dirname,
      timeoutMs: 15_000
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    app.exit(1);
  }
});
