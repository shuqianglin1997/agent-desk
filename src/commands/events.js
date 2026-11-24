'use strict';

// AgentDesk — what Main tells the window (webContents.send), each with the
// preload method that subscribes to it. Checked against src/preload.js.
//   [channel, preload method]

const EVENTS = [
  ['updates:progress', 'onUpdateProgress'],
  ['tools:progress', 'onToolProgress'],
  ['profiles:registrationsChanged', 'onProfileRegistrationsChanged'],
  ['profiles:runtimeIncident', 'onProfileRuntimeIncident'],
  ['profiles:quitBlocked', 'onProfileQuitBlocked'],
  ['window:lamp', 'onWindowLamp'],
  ['devices:pairingClaimsChanged', 'onPairingClaimsChanged'],
  ['devices:connectionState', 'onDeviceConnectionState'],
  ['devices:networkState', 'onDeviceNetworkState'],
  ['agentDeployments:changed', 'onAgentDeploymentsChanged'],
  ['agentActions:changed', 'onAgentActionsChanged'],
  ['remoteControl:changed', 'onRemoteControlsChanged'],
  ['remoteControl:returnToWorkspace', 'onRemoteControlReturn'],
  ['transfers:changed', 'onTransfersChanged'],
  ['taskPackages:changed', 'onTaskPackagesChanged'],
  ['hub:changed', 'onHubChanged']
];

module.exports = { EVENTS };
