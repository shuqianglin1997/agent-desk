const { contextBridge, ipcRenderer } = require('electron');

const prefix = '--mesh-peer-token=';
const token = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';

contextBridge.exposeInMainWorld('meshPeer', {
  bootstrap: () => ipcRenderer.invoke('mesh-peer:bootstrap', { token }),
  reportSignal: (signal) => ipcRenderer.invoke('mesh-peer:signal', { token, signal }),
  reportState: (state) => ipcRenderer.invoke('mesh-peer:state', { token, state }),
  reportMessage: (message) => ipcRenderer.invoke('mesh-peer:message', { token, message }),
  onRemoteDescription: (callback) => {
    const listener = (_event, envelope = {}) => {
      if (envelope.token === token) callback(envelope.description);
    };
    ipcRenderer.on('mesh-peer:remote-description', listener);
    return () => ipcRenderer.removeListener('mesh-peer:remote-description', listener);
  },
  onSend: (callback) => {
    const listener = (_event, envelope = {}) => {
      if (envelope.token === token) callback(envelope.message);
    };
    ipcRenderer.on('mesh-peer:send', listener);
    return () => ipcRenderer.removeListener('mesh-peer:send', listener);
  },
  onClose: (callback) => {
    const listener = (_event, envelope = {}) => {
      if (envelope.token === token) callback();
    };
    ipcRenderer.on('mesh-peer:close', listener);
    return () => ipcRenderer.removeListener('mesh-peer:close', listener);
  }
});
