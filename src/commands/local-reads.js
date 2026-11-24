'use strict';

// AgentDesk — the window's local reads: session lists, locating and exporting
// sessions, activity and quota. Main re-resolves every profile by id; rows
// come from the session index. `deps.refreshProfiles()` returns a promise of
// the profile list the refresh path keeps, re-read only when profiles.json
// changed.

const COMMANDS = [
  {
    id: 'sessions.list',
    channel: 'sessions:list',
    preload: ['listSessions'],
    async exec({ refreshProfiles, listIndexedSessions, boundedText }, input = {}) {
      const profile = (await refreshProfiles()).find((item) => item.id === boundedText(input.profileId, 128));
      if (!profile) return [];
      return listIndexedSessions(profile);
    }
  },
  {
    id: 'sessions.reveal',
    channel: 'sessions:reveal',
    preload: ['revealSession'],
    async exec({ revealSessionFile }, input = {}) {
      return revealSessionFile(input);
    }
  },
  {
    id: 'sessions.export',
    channel: 'sessions:export',
    preload: ['exportSession', 'exportSessions'],
    async exec({ exportSessionTranscript }, input = {}) {
      return exportSessionTranscript(input);
    }
  },
  {
    id: 'sessions.directories',
    channel: 'sessions:directories',
    preload: ['listSessionDirectories'],
    exec: ({ listSessionDirectories }, input = {}) => listSessionDirectories(input)
  },
  {
    id: 'sessions.openDirectory',
    channel: 'sessions:open-directory',
    preload: ['openSessionDirectory'],
    exec: ({ openSessionDirectory }, input = {}) => openSessionDirectory(input)
  },
  {
    id: 'activity.all',
    channel: 'activity:all',
    preload: ['listActivity'],
    async exec({ refreshProfiles, snapshotProcessText, probeActivities, sessionMarksFreshContext = () => null, profileIsRunning }) {
      const profiles = await refreshProfiles();
      // 进程快照采一次（全应用共用、不阻塞主线程），供所有账号匹配；null 表示探测不可用（上层退回按活跃度）
      const psText = await snapshotProcessText();
      // 带上本机的“看过”记号，探测才能算出哪些会话有新回复（只给条数和会话键，不给正文）。
      return (await probeActivities(profiles, Date.now(), sessionMarksFreshContext())).map((activity, index) => ({
        ...activity,
        running: psText === null ? null : profileIsRunning(psText, profiles[index])
      }));
    }
  },
  {
    id: 'quota.all',
    channel: 'quota:all',
    preload: ['listQuotas'],
    async exec({ refreshProfiles, quotaService, appVersion }, options = {}) {
      return quotaService.getAll(await refreshProfiles(), {
        force: options.force === true,
        clientVersion: appVersion()
      });
    }
  }
];

module.exports = { COMMANDS };
