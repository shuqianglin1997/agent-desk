'use strict';

// AgentDesk — remote control in the isolated Remote Surface, and other devices'
// session inventory. Media, SDP and capture sources never reach this window;
// only stable ids and bounded enums cross. Bodies moved from main.js
// registerIpc unchanged.

const COMMANDS = [
  {
    id: 'remoteControl.open',
    channel: 'remoteControl:open',
    preload: ['openRemoteControl'],
    async exec(deps, input = {}) {
      const { boundedText, getRemoteControlService } = deps;
      try {
        const session = await getRemoteControlService().openDevice(boundedText(input.deviceId, 128));
        return { ok: true, session, sessions: getRemoteControlService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-open-failed', 160) };
      }
    }
  },
  {
    id: 'remoteControl.list',
    channel: 'remoteControl:list',
    preload: ['listRemoteControls'],
    exec(deps) {
      const { boundedText, getRemoteControlService } = deps;
      try {
        return { ok: true, sessions: getRemoteControlService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-list-failed', 160) };
      }
    }
  },
  {
    id: 'remoteControl.setSurface',
    channel: 'remoteControl:setSurface',
    preload: ['setRemoteControlSurface'],
    exec(deps, input = {}, context = {}) {
      const { boundedText, getRemoteControlService, mainWindow } = deps;
      const event = context.event;
      try {
        if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
          throw new Error('remote-surface-source-invalid');
        }
        const surface = getRemoteControlService().setConsoleSurface({
          visible: input.visible === true,
          bounds: input.bounds
        });
        return { ok: true, surface };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-surface-failed', 160) };
      }
    }
  },
  {
    id: 'remoteControl.return',
    channel: 'remoteControl:return',
    preload: ['returnRemoteControl'],
    async exec(deps, input = {}) {
      const { boundedText, getRemoteControlService } = deps;
      try {
        const result = await getRemoteControlService().returnToWorkspace(boundedText(input.sessionId, 128));
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-return-failed', 160) };
      }
    }
  },
  {
    id: 'remoteControl.disconnect',
    channel: 'remoteControl:disconnect',
    preload: ['disconnectRemoteControl'],
    async exec(deps, input = {}) {
      const { boundedText, getRemoteControlService } = deps;
      try {
        await getRemoteControlService().disconnect(boundedText(input.sessionId, 128));
        return { ok: true, sessions: getRemoteControlService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-disconnect-failed', 160) };
      }
    }
  },
  {
    id: 'remoteControl.stopAll',
    channel: 'remoteControl:stopAll',
    preload: ['stopAllRemoteControls'],
    async exec(deps) {
      const { boundedText, getRemoteControlService } = deps;
      try {
        await getRemoteControlService().stopAll('emergency-stop');
        return { ok: true, sessions: [] };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-stop-failed', 160) };
      }
    }
  },
  {
    id: 'remoteInventory.listSessions',
    channel: 'remoteInventory:listSessions',
    preload: ['listMeshSessions'],
    async exec(deps) {
      const { getMeshService, loadProfiles, meshCall, sessionIndex } = deps;
      // Local rows come from the index; refresh it once, then the inventory reads them.
      await sessionIndex.refresh(loadProfiles()).catch(() => null);
      return meshCall(() => getMeshService().getUnifiedSessions(), 'sessions');
    }
  },
  {
    id: 'remoteInventory.refresh',
    channel: 'remoteInventory:refresh',
    preload: ['refreshMeshInventory'],
    async exec(deps, input = {}) {
      const { boundedText, ensureSignalingOnline, getMeshService, getPeerManager, setMeshNetworkEnrollmentEnabled, withMeshRuntime } = deps;
      try {
        setMeshNetworkEnrollmentEnabled(true);
        try { await ensureSignalingOnline(); } catch (_error) { /* LAN is still attempted first. */ }
        const connection = await getPeerManager().refreshInventory(boundedText(input.deviceId, 128));
        return {
          ok: true,
          connection,
          sessions: getMeshService().getUnifiedSessions(),
          overview: withMeshRuntime(getMeshService().getOverview())
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'inventory-refresh-failed', 160) };
      }
    }
  }
];

module.exports = { COMMANDS };
