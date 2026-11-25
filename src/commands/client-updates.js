'use strict';

// AgentDesk — orderly client updates (docs/ORDERLY_UPDATE_PLAN.md): whether an
// update is waiting for the accounts AgentDesk opened, restarting all of them
// in order, and reopening the ones that were open after the person updated
// from inside the client. macOS only; every refusal is a fixed reason code.
// AgentDesk never downloads or installs an update and never restarts on its
// own. The status is shared with the command line (clients update-status);
// the two actions are window-only (`windowOnly`): the person starts them in
// the window, and the command line answers window-only (cli-local.js).

const APP_ID = /^[a-z][a-z0-9-]{0,63}$/;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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
    windowOnly: true,
    input: clientInput,
    poll: ({ clientUpdates }, input) => clientUpdates.refusal('restart', input),
    exec: ({ clientUpdates }, input) => clientUpdates.restartAll(input)
  },
  {
    // Open again the accounts that were open before they all closed and the
    // app on disk changed: the ones the person ticked (profileIds, at most 64
    // stable ids; Main keeps only those in its own offer).
    id: 'client.reopenSet',
    channel: 'client:reopenSet',
    preload: ['reopenClientSet'],
    windowOnly: true,
    input: (raw) => ({
      appId: clientInput(raw).appId,
      profileIds: Array.isArray(raw?.profileIds)
        ? raw.profileIds.filter((id) => typeof id === 'string' && PROFILE_ID.test(id)).slice(0, 64)
        : undefined
    }),
    poll: ({ clientUpdates }, input) => clientUpdates.refusal('reopen', input),
    exec: ({ clientUpdates }, input) => clientUpdates.reopenSet(input)
  }
];

module.exports = { COMMANDS, clientInput };
