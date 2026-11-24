// AgentDesk — Main's change notifications in the window (docs/ARCHITECTURE_PLAN.md
// phase 6, section 5.6). Each event Main sends (src/commands/events.js) enters
// the renderer's store as the topic 'main:<preload method>'; the views
// subscribe to the topics they show. The lamp events stay with
// src/pixel/boot.js, which listens to them itself.

import { store } from './shared.js';

const MAIN_EVENT_METHODS = [
  'onUpdateProgress',
  'onToolProgress',
  'onProfileRegistrationsChanged',
  'onProfileRuntimeIncident',
  'onProfileQuitBlocked',
  'onPairingClaimsChanged',
  'onDeviceConnectionState',
  'onDeviceNetworkState',
  'onAgentDeploymentsChanged',
  'onAgentActionsChanged',
  'onRemoteControlsChanged',
  'onRemoteControlReturn',
  'onTransfersChanged',
  'onTaskPackagesChanged',
  'onHubChanged'
];

// Subscribes once to every event this preload offers.
function bindMainEvents() {
  for (const method of MAIN_EVENT_METHODS) {
    if (typeof window.manager[method] !== 'function') continue;
    window.manager[method]((payload) => store.notify(`main:${method}`, payload));
  }
}

// Whether this preload offers the event (the views subscribe only then).
function offersMainEvent(method) {
  return typeof window.manager[method] === 'function';
}

// A view's handler for one event, given the payload Main sent.
function onMainEvent(method, handler) {
  return store.subscribe(`main:${method}`, ({ detail }) => handler(detail));
}

export { MAIN_EVENT_METHODS, bindMainEvents, offersMainEvent, onMainEvent };
