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
  scanTools: (options = {}) => ipcRenderer.invoke('tools:scan', options),
  openTool: (input) => ipcRenderer.invoke('tools:open', input),
  updateTool: (toolId) => ipcRenderer.invoke('tools:update', { toolId }),
  updateAllTools: () => ipcRenderer.invoke('tools:updateAll'),
  onToolProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('tools:progress', listener);
    return () => ipcRenderer.removeListener('tools:progress', listener);
  },
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  initializeMesh: (input = {}) => ipcRenderer.invoke('devices:initialize', input),
  renameDevice: (input) => ipcRenderer.invoke('devices:rename', input),
  resetMesh: () => ipcRenderer.invoke('devices:resetMesh'),
  probeMeshTransport: () => ipcRenderer.invoke('devices:probeTransport'),
  createDeviceInvite: () => ipcRenderer.invoke('devices:createInvite'),
  cancelDeviceInvite: (inviteId) => ipcRenderer.invoke('devices:cancelInvite', { inviteId }),
  joinDeviceMesh: (input) => ipcRenderer.invoke('devices:join', input),
  setDeviceReachable: (enabled) => ipcRenderer.invoke('devices:setReachable', { enabled }),
  connectDevice: (deviceId) => ipcRenderer.invoke('devices:connect', { deviceId }),
  disconnectDevice: (deviceId) => ipcRenderer.invoke('devices:disconnect', { deviceId }),
  getDeviceDiagnostics: (deviceId) => ipcRenderer.invoke('devices:getDiagnostics', { deviceId }),
  getDeviceNetworkConfig: () => ipcRenderer.invoke('devices:getNetworkConfig'),
  updateDeviceNetworkConfig: (input) => ipcRenderer.invoke('devices:updateNetworkConfig', input),
  onDeviceConnectionState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('devices:connectionState', listener);
    return () => ipcRenderer.removeListener('devices:connectionState', listener);
  },
  onDeviceNetworkState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('devices:networkState', listener);
    return () => ipcRenderer.removeListener('devices:networkState', listener);
  },
  updateDevicePermissions: (input) => ipcRenderer.invoke('devices:updatePermissions', input),
  revokeDevice: (input) => ipcRenderer.invoke('devices:revoke', input),
  openRemoteControl: (deviceId) => ipcRenderer.invoke('remoteControl:open', { deviceId }),
  listRemoteControls: () => ipcRenderer.invoke('remoteControl:list'),
  setRemoteControlSurface: (input = {}) => ipcRenderer.invoke('remoteControl:setSurface', input),
  returnRemoteControl: (sessionId) => ipcRenderer.invoke('remoteControl:return', { sessionId }),
  disconnectRemoteControl: (sessionId) => ipcRenderer.invoke('remoteControl:disconnect', { sessionId }),
  stopAllRemoteControls: () => ipcRenderer.invoke('remoteControl:stopAll'),
  onRemoteControlsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('remoteControl:changed', listener);
    return () => ipcRenderer.removeListener('remoteControl:changed', listener);
  },
  onRemoteControlReturn: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('remoteControl:returnToWorkspace', listener);
    return () => ipcRenderer.removeListener('remoteControl:returnToWorkspace', listener);
  },
  listMeshSessions: () => ipcRenderer.invoke('remoteInventory:listSessions'),
  createSessionPointerTransfer: (input) => ipcRenderer.invoke('transfers:createSessionPointer', input),
  chooseFileTransfer: (input) => ipcRenderer.invoke('transfers:chooseFiles', input),
  acceptFileTransfer: (transferId) => ipcRenderer.invoke('transfers:acceptFile', { transferId }),
  openReceivedFile: (transferId) => ipcRenderer.invoke('transfers:openReceivedFile', { transferId }),
  listTransfers: () => ipcRenderer.invoke('transfers:list'),
  cancelTransfer: (transferId) => ipcRenderer.invoke('transfers:cancel', { transferId }),
  retryTransfer: (transferId) => ipcRenderer.invoke('transfers:retry', { transferId }),
  chooseProjectBinding: (input) => ipcRenderer.invoke('projects:chooseBinding', input),
  onTransfersChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('transfers:changed', listener);
    return () => ipcRenderer.removeListener('transfers:changed', listener);
  },
  addProfile: (input) => ipcRenderer.invoke('profiles:add', input),
  updateProfile: (input) => ipcRenderer.invoke('profiles:update', input),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  migrateWindowsProfilePath: (id) => ipcRenderer.invoke('profiles:migrateWindowsPath', id),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  listSessions: (profile) => ipcRenderer.invoke('sessions:list', profile),
  revealSession: (input) => ipcRenderer.invoke('sessions:reveal', input),
  exportSession: (input) => ipcRenderer.invoke('sessions:export', input),
  listActivity: () => ipcRenderer.invoke('activity:all'),
  listQuotas: (options = {}) => ipcRenderer.invoke('quota:all', options),
  getDiagnostics: (profile) => ipcRenderer.invoke('diagnostics:get', profile),
  pickDirectory: (options) => ipcRenderer.invoke('system:pickDirectory', options),
  pickFile: (options) => ipcRenderer.invoke('system:pickFile', options),
  showItem: (path) => ipcRenderer.invoke('system:showItem', path),
  openPath: (path) => ipcRenderer.invoke('system:openPath', path),
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:writeText', value)
});
