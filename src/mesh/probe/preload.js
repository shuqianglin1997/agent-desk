const { contextBridge, ipcRenderer } = require('electron');

const tokenArg = process.argv.find((value) => value.startsWith('--mesh-probe-token='));
const token = tokenArg ? tokenArg.slice('--mesh-probe-token='.length) : '';
let reported = false;

contextBridge.exposeInMainWorld('meshProbe', {
  report: (result) => {
    if (reported || !token) return false;
    reported = true;
    ipcRenderer.send('mesh-probe:result', { token, result });
    return true;
  }
});
