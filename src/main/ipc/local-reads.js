'use strict';

// Caller passes the trusted main-window registrar; this module never imports raw Electron IPC.
function registerLocalReadIpc({ ipcMain, loadProfiles, apps, boundedText, revealSessionFile, exportSessionTranscript, listSessionDirectories, openSessionDirectory, probeActivities, sessionMarksFreshContext = () => null, snapshotProcesses, profileIsRunning, quotaService, getVersion }) {
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

  ipcMain.handle('sessions:directories', (_event, input = {}) => listSessionDirectories(input));
  ipcMain.handle('sessions:open-directory', (_event, input = {}) => openSessionDirectory(input));

  ipcMain.handle('activity:all', async () => {
    const profiles = loadProfiles();
    // 进程快照采一次（全应用共用、不阻塞主线程），供所有账号匹配；null 表示探测不可用（上层退回按活跃度）
    const psText = await snapshotProcesses();
    // 带上本机的“看过”记号，探测才能算出哪些会话有新回复（只给条数和会话键，不给正文）。
    return probeActivities(profiles, Date.now(), sessionMarksFreshContext()).map((activity, index) => ({
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
