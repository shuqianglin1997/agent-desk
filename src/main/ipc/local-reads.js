'use strict';

// Caller passes the trusted main-window registrar; this module never imports raw Electron IPC.
function registerLocalReadIpc({ ipcMain, loadProfiles, apps, boundedText, revealSessionFile, exportSessionTranscript, probeActivities, snapshotProcesses, profileIsRunning, quotaService, getVersion }) {
  ipcMain.handle('sessions:list', (_event, input = {}) => {
    const profile = loadProfiles().find((item) => item.id === boundedText(input.profileId, 128));
    if (!profile) return [];
    return apps.getApp(profile.appId).scan(profile);
  });

  ipcMain.handle('sessions:reveal', async (_event, input = {}) => {
    return revealSessionFile(input);
  });

  ipcMain.handle('sessions:export', async (_event, input = {}) => {
    return exportSessionTranscript(input);
  });

  ipcMain.handle('activity:all', () => {
    const profiles = loadProfiles();
    // 进程快照采一次，供所有账号匹配；null 表示探测不可用（上层退回按活跃度）
    const psText = snapshotProcesses();
    return probeActivities(profiles).map((activity, index) => ({
      ...activity,
      running: psText === null ? null : profileIsRunning(psText, profiles[index])
    }));
  });

  ipcMain.handle('quota:all', async (_event, options = {}) => {
    return quotaService.getAll(loadProfiles(), {
      force: options.force === true,
      clientVersion: getVersion()
    });
  });

}

module.exports = { registerLocalReadIpc };
