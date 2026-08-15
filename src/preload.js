const { contextBridge, ipcRenderer } = require('electron');

const knownProfiles = new Map();
const pathSelections = new Map();

function rememberProfiles(profiles) {
  knownProfiles.clear();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (profile?.id) knownProfiles.set(String(profile.id), { ...profile });
  }
  return profiles;
}

function profilePickerContext(options = {}, kind = 'directory') {
  const defaultPath = String(options?.defaultPath || '');
  for (const profile of knownProfiles.values()) {
    if (kind === 'executable' && defaultPath && defaultPath === profile.executablePath) {
      return { profileId: profile.id };
    }
    if (kind === 'directory' && defaultPath && defaultPath === profile.sessionRoot) {
      return { profileId: profile.id, field: 'sessionRoot' };
    }
    if (kind === 'directory' && defaultPath && defaultPath === profile.profilePath) {
      return { profileId: profile.id, field: 'profilePath' };
    }
  }
  return {};
}

function rememberPathSelection(kind, result) {
  if (!result?.selectionId || !result?.displayPath) return null;
  pathSelections.set(`${kind}:${result.displayPath}`, String(result.selectionId));
  return result.displayPath;
}

function selectionId(kind, displayPath) {
  return pathSelections.get(`${kind}:${String(displayPath || '')}`) || null;
}

async function listProfiles() {
  return rememberProfiles(await ipcRenderer.invoke('profiles:list'));
}

async function updateProfile(input = {}) {
  const id = String(input?.id || '');
  const current = knownProfiles.get(id);
  const payload = { id };
  for (const key of ['name', 'group', 'note', 'identityKey', 'cat']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) payload[key] = input[key];
  }

  const usedSelections = [];
  for (const [field, tokenField] of [
    ['profilePath', 'profilePathSelectionId'],
    ['sessionRoot', 'sessionRootSelectionId']
  ]) {
    if (typeof input[field] !== 'string' || input[field] === current?.[field]) continue;
    const token = selectionId('profile-directory', input[field]);
    if (!token) throw new Error('profile-path-requires-system-picker');
    payload[tokenField] = token;
    usedSelections.push(`profile-directory:${input[field]}`);
  }

  if (typeof input.executablePath === 'string' && input.executablePath !== (current?.executablePath || '')) {
    if (!input.executablePath) {
      payload.clearExecutablePath = true;
    } else {
      const token = selectionId('profile-executable', input.executablePath);
      if (!token) throw new Error('profile-executable-requires-system-picker');
      payload.executableSelectionId = token;
      usedSelections.push(`profile-executable:${input.executablePath}`);
    }
  }

  const updated = await ipcRenderer.invoke('profiles:update', payload);
  for (const key of usedSelections) pathSelections.delete(key);
  if (updated?.id) knownProfiles.set(String(updated.id), { ...updated });
  return updated;
}

async function pickProfileDirectory(options = {}) {
  const result = await ipcRenderer.invoke('system:pickDirectory', {
    purpose: 'profile-directory',
    ...profilePickerContext(options, 'directory')
  });
  return rememberPathSelection('profile-directory', result);
}

async function pickProfileExecutable(options = {}) {
  const result = await ipcRenderer.invoke('system:pickFile', {
    purpose: 'profile-executable',
    ...profilePickerContext(options, 'executable')
  });
  return rememberPathSelection('profile-executable', result);
}

function knownProfilePath(displayPath) {
  const value = String(displayPath || '');
  for (const profile of knownProfiles.values()) {
    if (value && value === profile.profilePath) {
      return { kind: 'profile-directory', profileId: profile.id, field: 'profilePath' };
    }
    if (value && value === profile.sessionRoot) {
      return { kind: 'profile-directory', profileId: profile.id, field: 'sessionRoot' };
    }
  }
  return null;
}

function showKnownItem(displayPath) {
  const target = knownProfilePath(displayPath);
  if (!target) return Promise.resolve({ ok: false, reason: 'known-path-required' });
  return ipcRenderer.invoke('system:showItem', target);
}

function openKnownPath(displayPath) {
  const target = knownProfilePath(displayPath);
  if (!target) return Promise.resolve({ ok: false, reason: 'known-path-required' });
  return ipcRenderer.invoke('system:openPath', target);
}

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
  listProfiles,
  listDevices: (options = {}) => ipcRenderer.invoke('devices:list', {
    requestSecureAccess: options.requestSecureAccess === true
  }),
  initializeMesh: (input = {}) => ipcRenderer.invoke('devices:initialize', input),
  initializeFirstAgent: (input = {}) => ipcRenderer.invoke('onboarding:initializeFirstAgent', input),
  renameDevice: (input) => ipcRenderer.invoke('devices:rename', input),
  listAgentCatalog: () => ipcRenderer.invoke('agentCatalog:list'),
  getAgentCatalog: (agentId) => ipcRenderer.invoke('agentCatalog:get', { agentId }),
  createAgent: (input) => ipcRenderer.invoke('agentCatalog:create', input),
  renameAgent: (input) => ipcRenderer.invoke('agentCatalog:rename', input),
  mergeAgents: (input) => ipcRenderer.invoke('agentCatalog:merge', input),
  splitAccountBinding: (input) => ipcRenderer.invoke('agentCatalog:split', input),
  deleteAgent: (input) => ipcRenderer.invoke('agentCatalog:delete', input),
  removeAccountBinding: (input) => ipcRenderer.invoke('agentCatalog:removeBinding', input),
  listAgentSlots: () => ipcRenderer.invoke('agentSlots:list'),
  addLocalAgentSlot: (input) => ipcRenderer.invoke('agentSlots:addLocal', input),
  assignAgentSlot: (input) => ipcRenderer.invoke('agentSlots:assign', input),
  removeLocalAgentSlot: (input) => ipcRenderer.invoke('agentSlots:removeLocal', input),
  ensureAgentReady: (input) => ipcRenderer.invoke('agentDeployments:ensureReady', input),
  retryAgentPreparation: (input) => ipcRenderer.invoke('agentDeployments:retryPreparation', input),
  cancelAgentPreparation: (jobId) => ipcRenderer.invoke('agentDeployments:cancelPreparation', { jobId }),
  launchRemoteAgent: (input) => ipcRenderer.invoke('agentActions:launchRemote', input),
  prepareRemoteAgent: (input) => ipcRenderer.invoke('agentActions:prepareRemote', input),
  onAgentActionsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('agentActions:changed', listener);
    return () => ipcRenderer.removeListener('agentActions:changed', listener);
  },
  onAgentDeploymentsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('agentDeployments:changed', listener);
    return () => ipcRenderer.removeListener('agentDeployments:changed', listener);
  },
  resetMesh: () => ipcRenderer.invoke('devices:resetMesh'),
  probeMeshTransport: () => ipcRenderer.invoke('devices:probeTransport'),
  createDeviceInvite: () => ipcRenderer.invoke('devices:createInvite'),
  cancelDeviceInvite: (inviteId) => ipcRenderer.invoke('devices:cancelInvite', { inviteId }),
  inspectDeviceInvitation: (input) => ipcRenderer.invoke('devices:inspectInvite', input),
  joinDeviceMesh: (input) => ipcRenderer.invoke('devices:join', input),
  listPairingClaims: () => ipcRenderer.invoke('devices:listPairingClaims'),
  decidePairingClaim: (input) => ipcRenderer.invoke('devices:decidePairingClaim', input),
  onPairingClaimsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('devices:pairingClaimsChanged', listener);
    return () => ipcRenderer.removeListener('devices:pairingClaimsChanged', listener);
  },
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
  refreshMeshInventory: (deviceId) => ipcRenderer.invoke('remoteInventory:refresh', { deviceId }),
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
  previewTaskPackageExport: (input) => ipcRenderer.invoke('taskPackages:previewExport', input),
  exportTaskPackage: (input) => ipcRenderer.invoke('taskPackages:export', input),
  sendTaskPackageToDevice: (input) => ipcRenderer.invoke('taskPackages:sendToDevice', input),
  acceptIncomingTaskPackage: (transferId) => ipcRenderer.invoke('taskPackages:acceptIncoming', { transferId }),
  rejectIncomingTaskPackage: (transferId) => ipcRenderer.invoke('taskPackages:rejectIncoming', { transferId }),
  prepareIncomingTaskPackage: (transferId) => ipcRenderer.invoke('taskPackages:prepareIncoming', { transferId }),
  saveTaskPackageFallback: (transferId) => ipcRenderer.invoke('taskPackages:savePortableFallback', { transferId }),
  chooseTaskPackageImport: () => ipcRenderer.invoke('taskPackages:chooseImport'),
  inspectTaskPackageImport: (input) => ipcRenderer.invoke('taskPackages:inspectImport', input),
  commitTaskPackageImport: (input) => ipcRenderer.invoke('taskPackages:commitImport', input),
  cancelTaskPackageImport: (token) => ipcRenderer.invoke('taskPackages:cancelImport', { token }),
  listTaskPackages: () => ipcRenderer.invoke('taskPackages:list'),
  revealTaskPackage: (input) => ipcRenderer.invoke('taskPackages:reveal', input),
  onTaskPackagesChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('taskPackages:changed', listener);
    return () => ipcRenderer.removeListener('taskPackages:changed', listener);
  },
  addProfile: (input = {}) => ipcRenderer.invoke('profiles:add', {
    appId: input.appId,
    name: input.name,
    group: input.group,
    note: input.note
  }),
  updateProfile,
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  migrateWindowsProfilePath: (id) => ipcRenderer.invoke('profiles:migrateWindowsPath', id),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  getProfileRuntimeStatus: (id) => ipcRenderer.invoke('profiles:runtimeStatus', id),
  stopProfile: (id) => ipcRenderer.invoke('profiles:stop', id),
  cleanProfileCrashpad: (id) => ipcRenderer.invoke('profiles:cleanCrashpad', id),
  onProfileRuntimeIncident: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('profiles:runtimeIncident', listener);
    return () => ipcRenderer.removeListener('profiles:runtimeIncident', listener);
  },
  onProfileQuitBlocked: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('profiles:quitBlocked', listener);
    return () => ipcRenderer.removeListener('profiles:quitBlocked', listener);
  },
  listSessions: (profile) => ipcRenderer.invoke('sessions:list', { profileId: profile?.id }),
  revealSession: (input) => ipcRenderer.invoke('sessions:reveal', {
    profileId: input?.profileId,
    sessionId: input?.sessionId
  }),
  exportSession: (input) => ipcRenderer.invoke('sessions:export', {
    profileId: input?.profileId,
    sessionId: input?.sessionId
  }),
  listActivity: () => ipcRenderer.invoke('activity:all'),
  listQuotas: (options = {}) => ipcRenderer.invoke('quota:all', options),
  getDiagnostics: (profile) => ipcRenderer.invoke('diagnostics:get', { profileId: profile?.id }),
  pickDirectory: pickProfileDirectory,
  pickFile: pickProfileExecutable,
  showItem: showKnownItem,
  openPath: openKnownPath,
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:writeText', value)
});
