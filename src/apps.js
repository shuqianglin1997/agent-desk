/*
 * AgentDesk — 受管客户端目录。
 *
 * 每个受管的 AI 客户端在这里注册一个条目，集中它的全部差异：
 * 显示名与配色、可执行文件名、默认数据目录规则、
 * 会话根目录规则、启动环境、会话扫描器与扫描区域、诊断区域。
 *
 * 加一个新会话来源 = 在 APPS 里加一个条目 + 一个会话扫描器，其余代码（main / activity /
 * renderer / 猫庭院）都通过这张表取信息，不用再散落地写 `appId === 'codex' ? … : …`。
 *
 * 纯 Node（os/path + sessions.js），可单测，不依赖 Electron。
 */

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const cursorSessions = require('./cursor-sessions');
const kimiWorkSessions = require('./kimi-work-sessions');
const transcripts = require('./transcripts');
const windows = require('./windows');

// 各平台官方 App 默认数据目录：<用户配置区>/<AppName>
function appSupportDir(appName) {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appName);
}

const matchLocalJson = (name) => /^local_.*\.json$/i.test(name);
const matchJsonl = (name) => name.endsWith('.jsonl');

const CHROMIUM_PROFILE_ISOLATION = Object.freeze({
  mode: 'chromium-user-data-dir'
});
const OFFICIAL_DEFAULT_ONLY = Object.freeze({
  mode: 'official-default-only'
});

// Claude Code reads these variables before its per-profile files. A Claude
// Desktop launch must not inherit a shell-level CLI proxy or config root.
const CLAUDE_CODE_ENV_KEYS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_BASE_URL',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_AWS_REGION',
  'ANTHROPIC_AWS_ACCESS_KEY_ID',
  'ANTHROPIC_AWS_SECRET_ACCESS_KEY',
  'ANTHROPIC_AWS_SESSION_TOKEN',
  'ANTHROPIC_BEDROCK_REGION',
  'ANTHROPIC_FOUNDRY_REGION',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_BASE_URL',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_PLUGIN_ROOT'
]);

const DSH_ENV_KEYS = Object.freeze(['DSH_HOME']);

function withoutClaudeCodeEnvironment(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (
      CLAUDE_CODE_ENV_KEYS.includes(key) ||
      /^ANTHROPIC_(?:DEFAULT_|MODEL|SMALL_FAST_MODEL|CUSTOM_HEADERS|API_BASE_URL|BASE_URL|CONFIG_DIR|OAUTH_TOKEN|AUTH_TOKEN|API_KEY|AWS_|BEDROCK_|FOUNDRY_|VERTEX_|UNIX_SOCKET)/.test(key) ||
      /^CLAUDE_CODE_(?:OAUTH_TOKEN|API_BASE_URL|API_KEY_|USE_(?:BEDROCK|FOUNDRY|VERTEX)|PLUGIN_)/.test(key)
    ) delete env[key];
  }
  return env;
}

const APPS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    tagColor: '#d96f33',
    appName: 'Claude', // /Applications/Claude.app、可执行文件同名
    mac: {
      launchers: [{ bundleName: 'Claude', executableName: 'Claude' }]
    },
    profileIsolation: CHROMIUM_PROFILE_ISOLATION,
    windows: {
      executableNames: ['Claude.exe'],
      aliases: ['Claude.exe'],
      legacyInstallDirs: ['AnthropicClaude', 'Claude'],
      packageNames: ['Claude'],
      packageFamilyNames: ['Claude_pzs8sxrjxfjjc'],
      packageFamilyPrefixes: ['Claude_', 'Anthropic.Claude_'],
      protocol: 'claude://',
      profileMarkers: ['claude-code-sessions', 'local-agent-mode-sessions', 'Local State', 'logs']
    },
    defaultSessionRoot: (profilePath) => profilePath,
    launchEnv: (_profile, baseEnv) => withoutClaudeCodeEnvironment(baseEnv),
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'claude-code-sessions'), match: matchLocalJson },
      { dir: path.join(profile.sessionRoot, 'local-agent-mode-sessions'), match: matchLocalJson }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Claude Code', path: path.join(profile.sessionRoot, 'claude-code-sessions'), kind: 'directory' },
      { label: 'Claude 本地', path: path.join(profile.sessionRoot, 'local-agent-mode-sessions'), kind: 'directory' }
    ],
    scan: (profile) => sessions.scanClaude(profile),
    // 会话记录里的最后活跃时间（读 probe 传入的最新文件的 lastActivityAt），驱动干活/在岗判定
    contentActivityAt: (_profile, filePath) => sessions.claudeActivityFromFile(filePath)
  },
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude CLI',
    tagColor: '#b0713f',
    appName: 'Claude',
    // 没有桌面 App。独立槽位用 CLAUDE_CONFIG_DIR 打开终端里的 claude，
    // 并识别、索引与导出该配置根下的会话。
    noLaunch: true,
    cliDiscoveryId: 'claude',
    maintenanceToolId: 'cli:claude',
    cliClearEnvKeys: CLAUDE_CODE_ENV_KEYS,
    profileIsolation: Object.freeze({ mode: 'external-only' }),
    windows: {
      executableNames: [],
      aliases: [],
      legacyInstallDirs: ['claude'],
      packageNames: [],
      packageFamilyNames: [],
      packageFamilyPrefixes: [],
      protocol: null,
      profileMarkers: ['projects', 'history.jsonl']
    },
    // CLI 数据目录按 CLAUDE_CONFIG_DIR 解析，缺省 ~/.claude
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.claude') : path.join(profilePath, 'claude-cli-home')
    ),
    launchEnv: (profile, baseEnv) => ({
      ...withoutClaudeCodeEnvironment(baseEnv),
      CLAUDE_CONFIG_DIR: profile.sessionRoot
    }),
    // 会话事件逐行追加；只盯 projects 两层（memory/<uuid> 等子目录不算会话）
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'projects'), match: (name) => name.endsWith('.jsonl'), maxDepth: 2 }
    ],
    diagnosticAreas: (profile) => [
      { label: 'CLI 会话', path: path.join(profile.sessionRoot, 'projects'), kind: 'directory' },
      { label: 'CLI 历史', path: path.join(profile.sessionRoot, 'history.jsonl'), kind: 'file' }
    ],
    scan: (profile) => sessions.scanClaudeCli(profile),
    contentActivityAt: (_profile, filePath) => sessions.lastEventTimestamp(filePath),
    exportTranscript: (session) => ({
      markdown: transcripts.claudeCliTranscriptMarkdown(session.filePath, { title: session.title }),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    })
  },
  'dsh-cli': {
    id: 'dsh-cli',
    label: 'DSH',
    tagColor: '#3d6aa8',
    appName: 'DeepSeek Harness',
    // DSH is a terminal launcher. Its home is the account boundary; the
    // selected profile inside that home is kept stable. DSH itself owns setup;
    // AgentDesk does not copy configuration from another account.
    noLaunch: true,
    cliDiscoveryId: 'dsh',
    maintenanceToolId: 'cli:dsh',
    cliClearEnvKeys: DSH_ENV_KEYS,
    cliArgsForProfile: (profile) => ['--profile', profile.dshProfile || 'desktop'],
    profileIsolation: Object.freeze({ mode: 'external-only' }),
    windows: {
      executableNames: [],
      aliases: [],
      legacyInstallDirs: ['dsh'],
      packageNames: [],
      packageFamilyNames: [],
      packageFamilyPrefixes: [],
      protocol: null,
      profileMarkers: ['profiles', 'settings.yaml']
    },
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.dsh') : path.join(profilePath, 'dsh-home')
    ),
    launchEnv: (profile, baseEnv) => ({
      ...baseEnv,
      DSH_HOME: profile.sessionRoot
    }),
    scanAreas: () => [],
    diagnosticAreas: (profile) => [
      { label: 'DSH 主目录', path: profile.sessionRoot, kind: 'directory' }
    ],
    scan: () => [],
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    tagColor: '#2f9e8f',
    appName: 'Codex',
    // 2026 年官方 macOS 客户端的产品名仍显示 Codex，但包名和可执行文件
    // 已经是 ChatGPT。启动器身份不能继续由 UI 标签猜测；保留 Codex.app
    // 仅用于兼容旧版官方包，并用官方 bundle id 阻止同名冒充。
    mac: {
      launchers: [
        {
          bundleName: 'ChatGPT',
          executableName: 'ChatGPT',
          bundleIdentifiers: ['com.openai.codex']
        },
        {
          bundleName: 'Codex',
          executableName: 'Codex',
          bundleIdentifiers: ['com.openai.codex']
        }
      ]
    },
    profileIsolation: CHROMIUM_PROFILE_ISOLATION,
    windows: {
      executableNames: ['Codex.exe'],
      aliases: ['Codex.exe'],
      legacyInstallDirs: ['Codex', 'OpenAI.Codex'],
      packageNames: ['OpenAI.Codex'],
      packageFamilyNames: ['OpenAI.Codex_2p2nqsd0c76g0'],
      packageFamilyPrefixes: ['OpenAI.Codex_', 'Codex_'],
      protocol: 'codex://',
      profileMarkers: ['Local State', 'web', 'logs']
    },
    // Codex 的会话默认在 ~/.codex，与数据目录分开；独立槽位放在 profilePath/codex-home
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.codex') : path.join(profilePath, 'codex-home')
    ),
    launchEnv: (profile, baseEnv) => ({ ...baseEnv, CODEX_HOME: profile.sessionRoot }),
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'sessions'), match: matchJsonl },
      { dir: path.join(profile.sessionRoot, 'archived_sessions'), match: matchJsonl }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Codex 索引', path: path.join(profile.sessionRoot, 'session_index.jsonl'), kind: 'file' },
      { label: 'Codex 会话', path: path.join(profile.sessionRoot, 'sessions'), kind: 'directory' },
      { label: 'Codex 归档', path: path.join(profile.sessionRoot, 'archived_sessions'), kind: 'directory' }
    ],
    scan: (profile) => sessions.scanCodex(profile),
    contentActivityAt: (_profile, filePath) => sessions.codexActivityFromFile(filePath)
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi Code',
    tagColor: '#2f6bff',
    appName: 'Kimi', // /Applications/Kimi.app（桌面客户端）；会话数据来自 Kimi Code CLI / VS Code 插件
    mac: {
      launchers: [{ bundleName: 'Kimi', executableName: 'Kimi' }]
    },
    profileIsolation: CHROMIUM_PROFILE_ISOLATION,
    windows: {
      executableNames: ['Kimi.exe'],
      aliases: ['Kimi.exe'],
      legacyInstallDirs: ['Kimi', 'kimi-desktop'],
      packageNames: ['Kimi'],
      packageFamilyNames: [],
      packageFamilyPrefixes: ['Kimi_', 'Moonshot.Kimi_'],
      protocol: 'kimi://',
      profileMarkers: ['Local State', 'Cache']
    },
    // Kimi Code 的数据目录按 KIMI_CODE_HOME 解析，缺省 ~/.kimi-code（官方文档口径）。
    // 默认槽位直接读本机现成会话；独立槽位放在 profilePath/kimi-code-home。
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.kimi-code') : path.join(profilePath, 'kimi-code-home')
    ),
    launchEnv: (profile, baseEnv) => ({ ...baseEnv, KIMI_CODE_HOME: profile.sessionRoot }),
    // state.json 每轮更新 updatedAt；wire.jsonl 生成时逐事件追加（毫秒 time）
    scanAreas: (profile) => [
      {
        dir: path.join(profile.sessionRoot, 'sessions'),
        match: (name) => name === 'state.json' || name === 'wire.jsonl'
      }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Kimi 索引', path: path.join(profile.sessionRoot, 'session_index.jsonl'), kind: 'file' },
      { label: 'Kimi 会话', path: path.join(profile.sessionRoot, 'sessions'), kind: 'directory' },
      { label: 'Kimi 工作区', path: path.join(profile.sessionRoot, 'workspaces.json'), kind: 'file' }
    ],
    scan: (profile) => sessions.scanKimi(profile),
    contentActivityAt: (_profile, filePath) => sessions.kimiActivityFromFile(filePath),
    // 一个会话目录含 state.json + agents/*/wire.jsonl，活跃计数按会话目录去重
    sessionKeyOf: (filePath) => (
      filePath.endsWith('state.json')
        ? path.dirname(filePath)
        : path.dirname(path.dirname(path.dirname(filePath)))
    ),
    // 会话可导出为 Markdown（session.filePath 即 state.json）
    exportTranscript: (session) => ({
      markdown: transcripts.kimiTranscriptMarkdown(session.filePath),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    })
  },
  'kimi-work': {
    id: 'kimi-work',
    label: 'Kimi Work',
    tagColor: '#8a63d2',
    appName: 'Kimi', // 与 Kimi Code 同一个桌面 App（com.moonshot.kimichat），open -a Kimi
    mac: {
      launchers: [{ bundleName: 'Kimi', executableName: 'Kimi' }]
    },
    // Kimi Work 当前会忽略 --user-data-dir。只允许官方默认槽位启动，
    // 不能把多个受管 Profile 假装成隔离账号。
    profileIsolation: OFFICIAL_DEFAULT_ONLY,
    // Electron userData 目录叫 kimi-desktop，与 App 显示名不同
    profileDirName: 'kimi-desktop',
    windows: {
      executableNames: ['Kimi.exe'],
      aliases: ['Kimi.exe'],
      legacyInstallDirs: ['kimi-desktop', 'Kimi'],
      packageNames: ['Kimi'],
      packageFamilyNames: [],
      packageFamilyPrefixes: ['Kimi_', 'Moonshot.Kimi_'],
      protocol: 'kimi://',
      profileMarkers: ['daimon-share', 'kimi-agent', 'Local State']
    },
    // 会话数据在桌面 App 的 daimon 数据根；App 不认自定义数据目录参数，
    // 独立槽位仅作占位（用户可手动把会话根指到任何 daimon 目录）。
    defaultSessionRoot: (profilePath) => path.join(profilePath, 'daimon-share', 'daimon'),
    launchEnv: (_profile, baseEnv) => baseEnv,
    // 内嵌 kimi-code 内核逐事件写 wire.jsonl，state.json 每轮更新 updatedAt
    scanAreas: (profile) => [
      {
        dir: path.join(profile.sessionRoot, 'runtime', 'kimi-code', 'home', 'sessions'),
        match: (name) => name === 'state.json' || name === 'wire.jsonl'
      }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Kimi Work 索引', path: kimiWorkSessions.kimiWorkDbPath(profile), kind: 'file' },
      { label: 'Kimi Work 记录', path: path.join(profile.sessionRoot, 'runtime', 'kimi-code', 'home', 'sessions'), kind: 'directory' }
    ],
    scan: (profile) => kimiWorkSessions.scanKimiWork(profile),
    // 正文与 Kimi Code 同构，活跃判定直接复用
    contentActivityAt: (_profile, filePath) => sessions.kimiActivityFromFile(filePath),
    sessionKeyOf: (filePath) => (
      filePath.endsWith('state.json')
        ? path.dirname(filePath)
        : path.dirname(path.dirname(path.dirname(filePath)))
    ),
    // filePath 是 kernel state.json（缺失时是 db，解析层会给出明确报错）；
    // 标题用索引层的 generated 标题，比 state.json 的首条消息干净
    exportTranscript: (session) => ({
      markdown: transcripts.kimiTranscriptMarkdown(session.filePath, { title: session.title }),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    })
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    tagColor: '#6b7cff',
    appName: 'Cursor', // /Applications/Cursor.app，VSCode 分支，认 --user-data-dir
    mac: {
      launchers: [{ bundleName: 'Cursor', executableName: 'Cursor' }]
    },
    profileIsolation: CHROMIUM_PROFILE_ISOLATION,
    windows: {
      executableNames: ['Cursor.exe'],
      aliases: ['Cursor.exe'],
      legacyInstallDirs: ['Cursor'],
      packageNames: [],
      packageFamilyNames: [],
      packageFamilyPrefixes: ['Anysphere.Cursor_', 'Cursor_'],
      protocol: 'cursor://',
      profileMarkers: ['User', 'Local State']
    },
    // 会话根目录 = 数据目录；对话库在 <root>/User/globalStorage/state.vscdb
    defaultSessionRoot: (profilePath) => profilePath,
    launchEnv: (_profile, baseEnv) => baseEnv,
    // 活跃度只需盯住 state.vscdb 的 mtime（Cursor 在用就会写它）
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'User', 'globalStorage'), match: (name) => name === 'state.vscdb' }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Cursor 会话库', path: path.join(profile.sessionRoot, 'User', 'globalStorage', 'state.vscdb'), kind: 'file' }
    ],
    scan: (profile) => cursorSessions.scanCursor(profile),
    // 排行榜今日计数走 SQLite 聚合（会话是 db 行不是文件，按文件数会失真）
    sessionCounts: (profile, now) => cursorSessions.sessionCounts(profile, now),
    // 会话是 SQLite 行，最新文件就是 state.vscdb 本身；直接 MAX(lastUpdatedAt)，不用 filePath
    contentActivityAt: (profile) => cursorSessions.latestActivity(profile)
  }
};

const DEFAULT_APP = 'claude';

function getApp(appId) {
  return APPS[appId] || APPS[DEFAULT_APP];
}

function isKnownApp(appId) {
  return Object.prototype.hasOwnProperty.call(APPS, appId);
}

function appIds() {
  return Object.keys(APPS);
}

// 给渲染进程用的精简元数据（不含函数/路径逻辑）
function listApps() {
  return appIds().map((id) => ({
    id,
    label: APPS[id].label,
    tagColor: APPS[id].tagColor,
    canExportTranscript: typeof APPS[id].exportTranscript === 'function',
    taskPackageMode: id === 'codex'
      ? 'native'
      : (typeof APPS[id].exportTranscript === 'function' ? 'transcript' : 'unsupported'),
    canLaunch: APPS[id].noLaunch !== true || Boolean(APPS[id].cliDiscoveryId),
    supportsManagedProfiles: APPS[id].profileIsolation?.mode === 'chromium-user-data-dir'
  }));
}

function macLauncherCandidates(appId, options = {}) {
  const app_ = getApp(appId);
  const home = options.home || os.homedir();
  const roots = options.applicationRoots || [
    '/Applications',
    path.join(home, 'Applications')
  ];
  const launchers = app_.mac?.launchers || [{
    bundleName: app_.appName,
    executableName: app_.appName
  }];
  const candidates = [];
  for (const launcher of launchers) {
    for (const root of roots) {
      const bundlePath = path.join(root, `${launcher.bundleName}.app`);
      candidates.push({
        bundleName: launcher.bundleName,
        executableName: launcher.executableName,
        bundlePath,
        path: path.join(bundlePath, 'Contents', 'MacOS', launcher.executableName),
        bundleIdentifiers: [...(launcher.bundleIdentifiers || [])]
      });
    }
  }
  return candidates;
}

function macLaunchAppName(appId) {
  return getApp(appId).mac?.launchers?.[0]?.bundleName || getApp(appId).appName;
}

function profileLaunchPlan(profile = {}, options = {}) {
  const app_ = getApp(profile.appId);
  if (app_.noLaunch === true) {
    return { ok: false, reasonCode: 'client-form-unsupported', args: [] };
  }
  if (options.useOfficialDefault === true) {
    return { ok: true, isolated: false, args: [] };
  }
  const mode = app_.profileIsolation?.mode;
  if (mode === 'chromium-user-data-dir') {
    const profilePath = String(profile.profilePath || '').trim();
    if (!profilePath) {
      return { ok: false, reasonCode: 'profile-path-required', args: [] };
    }
    return {
      ok: true,
      isolated: true,
      args: [`--user-data-dir=${profilePath}`]
    };
  }
  if (mode === 'official-default-only') {
    const officialDefault = profile.isProtected === true && profile.profilePathMode === 'auto';
    return officialDefault
      ? { ok: true, isolated: false, args: [] }
      : { ok: false, reasonCode: 'profile-isolation-unsupported', args: [] };
  }
  return { ok: false, reasonCode: 'profile-isolation-unsupported', args: [] };
}

// 数据目录名默认与 App 显示名一致；Electron App 的 userData 可能不同（如 Kimi → kimi-desktop）
function profileDirName(app_) {
  return app_.profileDirName || app_.appName;
}

function defaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') {
    return windows.chooseWindowsDefaultProfilePath(app_).path;
  }
  return appSupportDir(profileDirName(app_));
}

function defaultProfilePathInfo(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.chooseWindowsDefaultProfilePath(app_);
  const profilePath = appSupportDir(profileDirName(app_));
  return { path: profilePath, source: '系统默认目录', candidates: [{ path: profilePath, source: '系统默认目录', score: 1 }] };
}

function legacyDefaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.legacyDefaultProfilePath(app_);
  return appSupportDir(profileDirName(app_));
}

module.exports = {
  APPS,
  DEFAULT_APP,
  CLAUDE_CODE_ENV_KEYS,
  DSH_ENV_KEYS,
  getApp,
  isKnownApp,
  appIds,
  listApps,
  macLauncherCandidates,
  macLaunchAppName,
  profileLaunchPlan,
  defaultProfilePath,
  defaultProfilePathInfo,
  legacyDefaultProfilePath,
  appSupportDir,
  withoutClaudeCodeEnvironment
};
