const { contextBridge, ipcRenderer } = require('electron');

const prefix = '--agentdesk-remote-host=';
const token = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';

function on(channel, callback) {
  const listener = (_event, envelope = {}) => {
    if (envelope.token === token) callback(envelope);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('remoteHost', {
  bootstrap: () => ipcRenderer.invoke('remote-host:bootstrap', { token }),
  answer: (description, sourceId) => ipcRenderer.invoke('remote-host:answer', {
    token,
    description,
    sourceId
  }),
  reportState: (state, detail = {}) => ipcRenderer.invoke('remote-host:state', {
    token,
    state,
    ...detail
  }),
  stop: (reason) => ipcRenderer.invoke('remote-host:stop', { token, reason }),
  respondControl: (accepted) => ipcRenderer.invoke('remote-host:control-response', { token, accepted }),
  input: (event) => ipcRenderer.invoke('remote-host:input', { token, event }),
  onCommand: (callback) => on('remote-host:command', ({ command }) => callback(command)),
  onControlRequest: (callback) => on('remote-host:control-request', callback),
  onMode: (callback) => on('remote-host:mode', callback),
  onClose: (callback) => on('remote-host:close', callback),
  onAutoAccept: (callback) => on('remote-host:auto-accept', callback)
});
