const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manager', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addProfile: (input) => ipcRenderer.invoke('profiles:add', input),
  updateProfile: (input) => ipcRenderer.invoke('profiles:update', input),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  listSessions: (profile) => ipcRenderer.invoke('sessions:list', profile),
  listActivity: () => ipcRenderer.invoke('activity:all'),
  getDiagnostics: (profile) => ipcRenderer.invoke('diagnostics:get', profile),
  pickDirectory: (options) => ipcRenderer.invoke('system:pickDirectory', options),
  showItem: (path) => ipcRenderer.invoke('system:showItem', path),
  openPath: (path) => ipcRenderer.invoke('system:openPath', path),
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:writeText', value)
});
