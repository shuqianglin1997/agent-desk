'use strict';

// AgentDesk — orderly client updates (docs/ORDERLY_UPDATE_PLAN.md): whether an
// update is waiting for the accounts AgentDesk opened, restarting all of them
// in order, and reopening the ones that were open after the person updated
// from inside the client. macOS only; every refusal is a fixed reason code.
// AgentDesk never downloads or installs an update and never restarts on its
// own: the two actions run only when they are asked for.

const APP_ID = /^[a-z][a-z0-9-]{0,63}$/;

// Only a client id and one explicit choice come from the window.
function clientInput(raw) {
  return {
    appId: typeof raw?.appId === 'string' && APP_ID.test(raw.appId) ? raw.appId : '',
    stopBackgroundRuns: raw?.stopBackgroundRuns === true
  };
}

const COMMANDS = [
  {
    id: 'client.updateStatus',
    channel: 'client:updateStatus',
    preload: ['getClientUpdateStatus'],
    exec: ({ clientUpdates }) => clientUpdates.status()
  },
  {
    // Close every account of this client that AgentDesk opened, wait for the
    // new version, open the same ones again. Background runs on them refuse
    // it unless stopBackgroundRuns is true.
    id: 'client.updateRestartAll',
    channel: 'client:updateRestartAll',
    preload: ['restartClientForUpdate'],
    input: clientInput,
    poll: ({ clientUpdates }, input) => clientUpdates.refusal('restart', input),
    exec: ({ clientUpdates }, input) => clientUpdates.restartAll(input)
  },
  {
    // Open again the accounts that were open before they all closed and the
    // app on disk changed.
    id: 'client.reopenSet',
    channel: 'client:reopenSet',
    preload: ['reopenClientSet'],
    input: (raw) => ({ appId: clientInput(raw).appId }),
    poll: ({ clientUpdates }, input) => clientUpdates.refusal('reopen', input),
    exec: ({ clientUpdates }, input) => clientUpdates.reopenSet(input)
  }
];

module.exports = { COMMANDS, clientInput };
