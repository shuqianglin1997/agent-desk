'use strict';

// AgentDesk — commands whose handlers have not moved into src/commands/ yet.
// Each is still registered where `where` says, with ipcMain.handle(channel).
// The list shrinks as features move; test/command-table.test.js checks that
// every channel here is registered exactly there and nowhere else.
//   [channel, preload method(s), where]

const LEGACY = [
  // apps
  ['apps:list', 'listApps', 'src/main.js'],
  // settings
  ['settings:get', 'getSettings', 'src/main.js'],
  ['settings:update', 'updateSettings', 'src/main.js'],
  // updates
  ['updates:check', 'checkForUpdates', 'src/main.js'],
  ['updates:install', 'installUpdate', 'src/main.js'],
  // tools
  ['tools:scan', 'scanTools', 'src/main.js'],
  ['tools:open', 'openTool', 'src/main.js'],
  ['tools:update', 'updateTool', 'src/main.js'],
  // profiles
  ['profiles:list', 'listProfiles', 'src/main.js'],
  ['profiles:add', 'addProfile', 'src/main.js'],
  ['profiles:update', 'updateProfile', 'src/main.js'],
  ['profiles:remove', 'removeProfile', 'src/main.js'],
  ['profiles:migrateWindowsPath', 'migrateWindowsProfilePath', 'src/main.js'],
  ['profiles:launch', 'launchProfile', 'src/main.js'],
  ['profiles:runtimeStatus', 'getProfileRuntimeStatus', 'src/main.js'],
  ['profiles:stop', 'stopProfile', 'src/main.js'],
  ['profiles:cleanCrashpad', 'cleanProfileCrashpad', 'src/main.js'],
  // recruit
  ['recruit:discover', 'recruitDiscover', 'src/main/ipc/recruit.js'],
  ['recruit:discoverFolder', 'recruitDiscoverFolder', 'src/main/ipc/recruit.js'],
  ['recruit:cancelDiscover', 'recruitCancelDiscover', 'src/main/ipc/recruit.js'],
  ['recruit:createAccount', 'recruitCreateAccount', 'src/main.js'],
  ['recruit:inspectItem', 'inspectRecruitItem', 'src/main.js'],
  ['recruit:pickItem', 'pickRecruitItem', 'src/main.js'],
  ['recruit:importItem', 'importRecruitItem', 'src/main.js'],
  ['recruit:register', 'recruitRegister', 'src/main/ipc/recruit.js'],
  // credentials
  ['credentials:apply', 'applyProfileCredential', 'src/main.js'],
  ['credentials:status', 'getProfileCredentialStatus', 'src/main.js'],
  // sessionMarks
  ['sessionMarks:get', 'getSessionMarks', 'src/main.js'],
  ['sessionMarks:setTag', 'setSessionTag', 'src/main.js'],
  ['sessionMarks:markSeen', 'markSessionsSeen', 'src/main.js'],
  ['sessionMarks:rename', 'renameSessionTag', 'src/main.js'],
  // diagnostics
  ['diagnostics:get', 'getDiagnostics', 'src/main.js'],
  // system
  ['system:pickDirectory', 'pickDirectory', 'src/main.js'],
  ['system:pickFile', 'pickFile', 'src/main.js'],
  ['system:showItem', 'showItem', 'src/main.js'],
  ['system:openPath', 'openPath', 'src/main.js'],
  // clipboard
  ['clipboard:writeText', 'writeClipboard', 'src/main.js'],
  // window
  ['window:lampDone', 'windowLampDone', 'src/main/window-lamp.js'],
  ['window:showing', 'windowShowing', 'src/main/window-lamp.js'],
  // onboarding
  ['onboarding:initializeFirstAgent', 'initializeFirstAgent', 'src/main.js'],
  // devices
  ['devices:list', 'listDevices', 'src/main.js'],
  ['devices:initialize', 'initializeMesh', 'src/main.js'],
  ['devices:rename', 'renameDevice', 'src/main.js'],
  ['devices:resetMesh', 'resetMesh', 'src/main.js'],
  ['devices:probeTransport', 'probeMeshTransport', 'src/main.js'],
  ['devices:createInvite', 'createDeviceInvite', 'src/main.js'],
  ['devices:cancelInvite', 'cancelDeviceInvite', 'src/main.js'],
  ['devices:inspectInvite', 'inspectDeviceInvitation', 'src/main.js'],
  ['devices:join', 'joinDeviceMesh', 'src/main.js'],
  ['devices:listPairingClaims', 'listPairingClaims', 'src/main.js'],
  ['devices:decidePairingClaim', 'decidePairingClaim', 'src/main.js'],
  ['devices:setReachable', 'setDeviceReachable', 'src/main.js'],
  ['devices:connect', 'connectDevice', 'src/main.js'],
  ['devices:disconnect', 'disconnectDevice', 'src/main.js'],
  ['devices:getDiagnostics', 'getDeviceDiagnostics', 'src/main.js'],
  ['devices:getNetworkConfig', 'getDeviceNetworkConfig', 'src/main.js'],
  ['devices:updateNetworkConfig', 'updateDeviceNetworkConfig', 'src/main.js'],
  ['devices:updatePermissions', 'updateDevicePermissions', 'src/main.js'],
  ['devices:revoke', 'revokeDevice', 'src/main.js'],
  // agentCatalog
  ['agentCatalog:list', 'listAgentCatalog', 'src/main.js'],
  ['agentCatalog:get', 'getAgentCatalog', 'src/main.js'],
  ['agentCatalog:create', 'createAgent', 'src/main.js'],
  ['agentCatalog:rename', 'renameAgent', 'src/main.js'],
  ['agentCatalog:merge', 'mergeAgents', 'src/main.js'],
  ['agentCatalog:split', 'splitAccountBinding', 'src/main.js'],
  ['agentCatalog:delete', 'deleteAgent', 'src/main.js'],
  ['agentCatalog:removeBinding', 'removeAccountBinding', 'src/main.js'],
  // agentSlots
  ['agentSlots:list', 'listAgentSlots', 'src/main.js'],
  ['agentSlots:addLocal', 'addLocalAgentSlot', 'src/main.js'],
  ['agentSlots:assign', 'assignAgentSlot', 'src/main.js'],
  ['agentSlots:removeLocal', 'removeLocalAgentSlot', 'src/main.js'],
  // agentDeployments
  ['agentDeployments:ensureReady', 'ensureAgentReady', 'src/main.js'],
  ['agentDeployments:retryPreparation', 'retryAgentPreparation', 'src/main.js'],
  ['agentDeployments:cancelPreparation', 'cancelAgentPreparation', 'src/main.js'],
  // agentActions
  ['agentActions:launchRemote', 'launchRemoteAgent', 'src/main.js'],
  ['agentActions:prepareRemote', 'prepareRemoteAgent', 'src/main.js'],
  // remoteInventory
  ['remoteInventory:listSessions', 'listMeshSessions', 'src/main.js'],
  ['remoteInventory:refresh', 'refreshMeshInventory', 'src/main.js'],
  // remoteControl
  ['remoteControl:open', 'openRemoteControl', 'src/main.js'],
  ['remoteControl:list', 'listRemoteControls', 'src/main.js'],
  ['remoteControl:setSurface', 'setRemoteControlSurface', 'src/main.js'],
  ['remoteControl:return', 'returnRemoteControl', 'src/main.js'],
  ['remoteControl:disconnect', 'disconnectRemoteControl', 'src/main.js'],
  ['remoteControl:stopAll', 'stopAllRemoteControls', 'src/main.js'],
  // transfers
  ['transfers:createSessionPointer', 'createSessionPointerTransfer', 'src/main.js'],
  ['transfers:chooseFiles', 'chooseFileTransfer', 'src/main.js'],
  ['transfers:acceptFile', 'acceptFileTransfer', 'src/main.js'],
  ['transfers:openReceivedFile', 'openReceivedFile', 'src/main.js'],
  ['transfers:list', 'listTransfers', 'src/main.js'],
  ['transfers:cancel', 'cancelTransfer', 'src/main.js'],
  ['transfers:retry', 'retryTransfer', 'src/main.js'],
  // projects
  ['projects:chooseBinding', 'chooseProjectBinding', 'src/main.js'],
  // taskPackages
  ['taskPackages:previewExport', 'previewTaskPackageExport', 'src/main.js'],
  ['taskPackages:export', 'exportTaskPackage', 'src/main.js'],
  ['taskPackages:sendToDevice', 'sendTaskPackageToDevice', 'src/main.js'],
  ['taskPackages:acceptIncoming', 'acceptIncomingTaskPackage', 'src/main.js'],
  ['taskPackages:rejectIncoming', 'rejectIncomingTaskPackage', 'src/main.js'],
  ['taskPackages:prepareIncoming', 'prepareIncomingTaskPackage', 'src/main.js'],
  ['taskPackages:savePortableFallback', 'saveTaskPackageFallback', 'src/main.js'],
  ['taskPackages:chooseImport', 'chooseTaskPackageImport', 'src/main.js'],
  ['taskPackages:inspectImport', 'inspectTaskPackageImport', 'src/main.js'],
  ['taskPackages:commitImport', 'commitTaskPackageImport', 'src/main.js'],
  ['taskPackages:cancelImport', 'cancelTaskPackageImport', 'src/main.js'],
  ['taskPackages:list', 'listTaskPackages', 'src/main.js'],
  ['taskPackages:reveal', 'revealTaskPackage', 'src/main.js'],
  // hub
  ['hub:state', 'hubState', 'src/main.js'],
  ['hub:setAccess', 'hubSetAccess', 'src/main.js'],
  ['hub:addFolder', 'hubAddFolder', 'src/main.js'],
  ['hub:removeFolder', 'hubRemoveFolder', 'src/main.js'],
  ['hub:setMaxConcurrent', 'hubSetMaxConcurrent', 'src/main.js'],
  ['hub:stopRun', 'hubStopRun', 'src/main.js']
];

module.exports = { LEGACY };
