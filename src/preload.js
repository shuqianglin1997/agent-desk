const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manager', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  getSettings: (legacySettings) => ipcRenderer.invoke('settings:get', legacySettings),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updates:progress', listener);
    return () => ipcRenderer.removeListener('updates:progress', listener);
  },
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addProfile: (input) => ipcRenderer.invoke('profiles:add', input),
  updateProfile: (input) => ipcRenderer.invoke('profiles:update', input),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  migrateWindowsProfilePath: (id) => ipcRenderer.invoke('profiles:migrateWindowsPath', id),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  listSessions: (profile) => ipcRenderer.invoke('sessions:list', profile),
  revealSession: (input) => ipcRenderer.invoke('sessions:reveal', input),
  listActivity: () => ipcRenderer.invoke('activity:all'),
  listQuotas: (options = {}) => ipcRenderer.invoke('quota:all', options),
  getDiagnostics: (profile) => ipcRenderer.invoke('diagnostics:get', profile),
  pickDirectory: (options) => ipcRenderer.invoke('system:pickDirectory', options),
  pickFile: (options) => ipcRenderer.invoke('system:pickFile', options),
  showItem: (path) => ipcRenderer.invoke('system:showItem', path),
  openPath: (path) => ipcRenderer.invoke('system:openPath', path),
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:writeText', value)
});
