/*
 * AgentDesk — 受管客户端注册表（adapter registry）。
 *
 * 每个受管的 AI 客户端（Claude / Codex / 未来的 Cursor / CodeBuddy …）在这里注册
 * 一份适配器，集中它的全部差异：显示名与配色、可执行文件名、默认数据目录规则、
 * 会话根目录规则、启动环境、会话扫描器与扫描区域、诊断区域。
 *
 * 加一个新工具 = 在 APPS 里加一个条目 + 一个会话扫描器，其余代码（main / activity /
 * renderer / 猫庭院）都通过这张表取信息，不用再散落地写 `appId === 'codex' ? … : …`。
 *
 * 纯 Node（os/path + sessions.js），可单测，不依赖 Electron。
 */

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const cursorSessions = require('./cursor-sessions');
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

const APPS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    tagColor: '#d96f33',
    appName: 'Claude', // /Applications/Claude.app、可执行文件同名
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
    launchEnv: (_profile, baseEnv) => baseEnv,
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
  codex: {
    id: 'codex',
    label: 'Codex',
    tagColor: '#2f9e8f',
    appName: 'Codex',
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
    label: 'Kimi',
    tagColor: '#2f6bff',
    appName: 'Kimi', // /Applications/Kimi.app（桌面客户端）；会话数据来自 Kimi Code CLI / VS Code 插件
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
    // 会话可导出为 Markdown（session.filePath 即 state.json）
    exportTranscript: (session) => ({
      markdown: transcripts.kimiTranscriptMarkdown(session.filePath),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    })
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    tagColor: '#6b7cff',
    appName: 'Cursor', // /Applications/Cursor.app，VSCode 分支，认 --user-data-dir
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
    canExportTranscript: typeof APPS[id].exportTranscript === 'function'
  }));
}

function defaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') {
    return windows.chooseWindowsDefaultProfilePath(app_).path;
  }
  return appSupportDir(app_.appName);
}

function defaultProfilePathInfo(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.chooseWindowsDefaultProfilePath(app_);
  const profilePath = appSupportDir(app_.appName);
  return { path: profilePath, source: '系统默认目录', candidates: [{ path: profilePath, source: '系统默认目录', score: 1 }] };
}

function legacyDefaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.legacyDefaultProfilePath(app_);
  return appSupportDir(app_.appName);
}

module.exports = {
  APPS,
  DEFAULT_APP,
  getApp,
  isKnownApp,
  appIds,
  listApps,
  defaultProfilePath,
  defaultProfilePathInfo,
  legacyDefaultProfilePath,
  appSupportDir
};
