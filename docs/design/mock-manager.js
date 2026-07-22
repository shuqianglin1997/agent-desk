/* 设计评审 harness：把 Electron IPC (window.manager) 换成样例数据，让真 index.html+renderer 在浏览器渲染。
 * 仅供 docs/design-review.html 展示前后效果；产品运行时不加载本文件。参数：?v=yard|classic&t=light|dark */
(function () {
  const now = Date.now();
  const mins = (m) => new Date(now - m * 60000).toISOString();
  const days = (d) => new Date(now - d * 86400000).toISOString();
  const qp = new URLSearchParams(location.search);
  const view = qp.get('v') === 'classic' ? 'classic' : 'yard';
  const theme = qp.get('t') === 'dark' ? 'dark' : 'light';
  const profiles = [
    { id: 'p0', name: '工作号', group: '工作', appId: 'claude', isProtected: true, identityKey: '', note: '', cat: { breed: 'orange', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/Library/Application Support/Claude', sessionRoot: '/Users/hupo/.claude', lastLaunchedAt: mins(48) },
    { id: 'p1', name: '个人号', group: '工作', appId: 'codex', isProtected: false, identityKey: '', note: '', cat: { breed: 'calico', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/Library/Application Support/Codex', sessionRoot: '/Users/hupo/.codex', lastLaunchedAt: mins(12) },
    { id: 'p2', name: '备用号', group: '个人', appId: 'claude', isProtected: false, identityKey: '', note: '', cat: { breed: 'black', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/.../Claude-Alt', sessionRoot: '/Users/hupo/.claude-alt', lastLaunchedAt: days(1) },
    { id: 'p3', name: '研究号', group: '个人', appId: 'codex', isProtected: false, identityKey: '', note: '', cat: { breed: 'white', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/.../Codex-2', sessionRoot: '/Users/hupo/.codex2', lastLaunchedAt: days(2) },
    { id: 'p4', name: '客服号', group: '备用', appId: 'claude', isProtected: false, identityKey: '', note: '', cat: { breed: 'tabby', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/.../Claude-3', sessionRoot: '/Users/hupo/.claude3', lastLaunchedAt: mins(240) },
    { id: 'p5', name: '夜班号', group: '备用', appId: 'codex', isProtected: false, identityKey: '', note: '', cat: { breed: 'siamese', collar: '#8a6bb8', accessory: 'none' }, profilePath: '/Users/hupo/.../Codex-3', sessionRoot: '/Users/hupo/.codex3', lastLaunchedAt: days(5) }
  ];
  const activity = [
    { rootExists: true, rootReadable: true, profileId: 'p0', activeNow: 2, lastActivityAt: mins(1), todayActive: 6, todayCreated: 3 },
    { rootExists: true, rootReadable: true, profileId: 'p1', activeNow: 1, lastActivityAt: mins(3), todayActive: 4, todayCreated: 2 },
    { rootExists: true, rootReadable: true, profileId: 'p2', activeNow: 0, lastActivityAt: mins(35), todayActive: 1, todayCreated: 0 },
    { rootExists: true, rootReadable: true, profileId: 'p3', activeNow: 0, lastActivityAt: mins(8), todayActive: 2, todayCreated: 1 },
    { rootExists: true, rootReadable: true, profileId: 'p4', activeNow: 0, lastActivityAt: mins(240), todayActive: 1, todayCreated: 0 },
    { rootExists: true, rootReadable: true, profileId: 'p5', activeNow: 0, lastActivityAt: days(6), todayActive: 0, todayCreated: 0 }
  ];
  const quotaOf = (pct) => ({
    profileId: '', status: 'ok', provider: 'claude', planType: 'max',
    observedAt: new Date(now - 60000).toISOString(),
    windows: [{ id: 'w5h', label: '5 小时窗', remainingPercent: pct, usedPercent: 100 - pct, windowMinutes: 300, resetsAt: new Date(now + 3 * 3600000).toISOString() }],
    credits: { hasCredits: false, unlimited: false, balance: null }
  });
  const quotas = { p0: { ...quotaOf(72), profileId: 'p0' }, p1: { ...quotaOf(48), profileId: 'p1' }, p2: { ...quotaOf(90), profileId: 'p2' }, p3: { ...quotaOf(22), profileId: 'p3' }, p4: { ...quotaOf(64), profileId: 'p4' }, p5: { ...quotaOf(8), profileId: 'p5' } };
  const rows = [['前端逻辑梳理和布局优化', 'AI-Account-Session-Manager', 2, 163], ['商业化最终执行规划复盘', 'ZE-commerce-console', 80, 310], ['视频四件套交接包整理', 'Books(HupoGitlab)', 1440, 1450], ['foundry C 端上线验收', 'vps-c1-cend-deploy', 600, 700], ['模型对照实验台规划 v1', 'ze-model-bench', 1500, 1520], ['五标准 Web 整备规划', 'ze-five-standard', 1600, 2800], ['批量生图升级收官', 'batch-image-foundry', 2900, 2950], ['去物 8037 keyless 切换', 'scene-object-eraser', 3000, 4400], ['隐物生成六特性验收', 'objgen-v3', 4500, 5900], ['前贴 8109 部署', 'preroll-overlay', 6000, 6100], ['数据审查 8108 验收', 'data-audit-studio', 6200, 7500], ['精灵变形体上线', 'sprite-shapeshifter', 7600, 7700]];
  const sessions = rows.map((r, i) => ({ id: 'local_b986a01a-' + i, title: r[0], projectPath: r[1], updatedAt: mins(r[2]), createdAt: mins(r[3]), source: i % 3 === 2 ? 'Codex' : 'Claude Code', address: 'local_b986a01a-d13e-' + i, filePath: '/Users/hupo/.claude/' + r[1] + '/s' + i + '.jsonl', sizeBytes: 12000 + i * 900 }));
  const noop = () => () => {};
  window.manager = {
    listApps: async () => [{ id: 'claude', label: 'Claude', canLaunch: true }, { id: 'codex', label: 'Codex', canLaunch: true }],
    getSettings: async () => ({ view, theme, agentConsoleOn: false, reminderOn: true, atmosTime: 'day', atmosWeather: 'clear', yardPositions: {}, seenWelcome: true, welcomeSeen: true, firstRun: false }),
    updateSettings: async (p) => p, checkForUpdates: async () => ({ status: 'idle' }), installUpdate: async () => ({}), onUpdateProgress: noop,
    listProfiles: async () => profiles, addProfile: async () => profiles[0], updateProfile: async () => profiles[0], removeProfile: async () => ({ ok: true }), migrateWindowsProfilePath: async () => ({}), launchProfile: async () => ({ ok: true }),
    listSessions: async () => sessions, revealSession: async () => ({ ok: true }), exportSession: async () => ({ ok: true }), listActivity: async () => activity,
    listQuotas: async () => Object.values(quotas),
    getDiagnostics: async () => ({ checks: [] }),
    listTerminalAdapters: async () => [], listTerminalRuntimes: async () => [], listCustomAgents: async () => [], pickAgentExecutable: async () => null, addCustomAgent: async () => ({}), removeCustomAgent: async () => ({}), pickTerminalWorkspace: async () => null, startTerminal: async () => ({}), sendTerminal: async () => ({}), stopTerminal: async () => ({}), onTerminalEvent: noop,
    pickDirectory: async () => null, pickFile: async () => null, showItem: async () => ({}), openPath: async () => ({}), writeClipboard: async () => ({})
  };
  addEventListener('DOMContentLoaded', () => setTimeout(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()), 300));
})();
