const { contextBridge, ipcRenderer } = require('electron');

const prefix = '--agentdesk-remote-console=';
const token = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';

function on(channel, callback) {
  const listener = (_event, envelope = {}) => {
    if (envelope.token === token) callback(envelope);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('remoteConsole', {
  bootstrap: () => ipcRenderer.invoke('remote-console:bootstrap', { token }),
  reportOffer: (sessionId, description) => ipcRenderer.invoke('remote-console:offer', {
    token,
    sessionId,
    description
  }),
  reportState: (sessionId, state, reason = '') => ipcRenderer.invoke('remote-console:state', {
    token,
    sessionId,
    state,
    reason
  }),
  command: (sessionId, command) => ipcRenderer.invoke('remote-console:command', {
    token,
    sessionId,
    command
  }),
  requestControl: (sessionId) => ipcRenderer.invoke('remote-console:request-control', { token, sessionId }),
  releaseControl: (sessionId) => ipcRenderer.invoke('remote-console:release-control', { token, sessionId }),
  disconnect: (sessionId) => ipcRenderer.invoke('remote-console:disconnect', { token, sessionId }),
  onAddTarget: (callback) => on('remote-console:add-target', callback),
  onActivateTarget: (callback) => on('remote-console:activate-target', callback),
  onAnswer: (callback) => on('remote-console:answer', callback),
  onStatus: (callback) => on('remote-console:status', callback),
  onRemoveTarget: (callback) => on('remote-console:remove-target', callback)
});
