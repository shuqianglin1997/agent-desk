'use strict';

// AgentDesk — the hub (调度中枢) settings the person controls: which accounts can
// be called, allowed folders, the limit, and stopping a run (docs/AGENT_HUB_PLAN.md).
// Bodies moved from main.js registerIpc unchanged.

const fs = require('node:fs');
const os = require('node:os');

const COMMANDS = [
  {
    id: 'hub.state',
    channel: 'hub:state',
    preload: ['hubState'],
    exec(deps) {
      const { hubPublicState } = deps;
      return hubPublicState();
    }
  },
  {
    id: 'hub.setAccess',
    channel: 'hub:setAccess',
    preload: ['hubSetAccess'],
    exec(deps, input = {}) {
      const { setHubAccess } = deps;
      return setHubAccess(input);
    }
  },
  {
    id: 'hub.addFolder',
    channel: 'hub:addFolder',
    preload: ['hubAddFolder'],
    async exec(deps) {
      const { dialog, getAgentHub, hubPublicState, mainWindow, notifyHubChanged, t } = deps;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: t('main.picker.hubFolder'),
        defaultPath: os.homedir(),
        properties: ['openDirectory', 'createDirectory']
      });
      const picked = result.canceled ? null : result.filePaths[0] || null;
      if (!picked) return { ok: false, reasonCode: 'cancelled' };
      let real;
      try { real = fs.realpathSync.native(picked); } catch (_error) { return { ok: false, reasonCode: 'folder-invalid' }; }
      const added = getAgentHub().store.addFolder(real);
      notifyHubChanged();
      return added.ok ? { ok: true, existing: added.existing === true, state: hubPublicState() } : { ok: false, reasonCode: added.reasonCode };
    }
  },
  {
    id: 'hub.removeFolder',
    channel: 'hub:removeFolder',
    preload: ['hubRemoveFolder'],
    exec(deps, input = {}) {
      const { boundedText, getAgentHub, hubPublicState, notifyHubChanged } = deps;
      const removed = getAgentHub().store.removeFolder(boundedText(input.id, 64));
      notifyHubChanged();
      return { ok: removed, state: hubPublicState() };
    }
  },
  {
    id: 'hub.setMaxConcurrent',
    channel: 'hub:setMaxConcurrent',
    preload: ['hubSetMaxConcurrent'],
    exec(deps, input = {}) {
      const { getAgentHub, hubPublicState, notifyHubChanged } = deps;
      getAgentHub().store.setMaxConcurrent(Number(input.value));
      notifyHubChanged();
      return { ok: true, state: hubPublicState() };
    }
  },
  {
    id: 'hub.stopRun',
    channel: 'hub:stopRun',
    preload: ['hubStopRun'],
    async exec(deps, input = {}) {
      const { HubError, boundedText, getAgentHub } = deps;
      try {
        const run = await getAgentHub().stop(boundedText(input.id, 64));
        return { ok: true, run: { ...run, cwd: undefined } };
      } catch (error) {
        return { ok: false, reasonCode: error instanceof HubError ? error.code : 'hub-stop-failed' };
      }
    }
  }
];

module.exports = { COMMANDS };
