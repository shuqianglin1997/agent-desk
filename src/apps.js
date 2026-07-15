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
    scan: (profile) => sessions.scanClaude(profile)
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    tagColor: '#2f9e8f',
    appName: 'Codex',
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
    scan: (profile) => sessions.scanCodex(profile)
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    tagColor: '#6b7cff',
    appName: 'Cursor', // /Applications/Cursor.app，VSCode 分支，认 --user-data-dir
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
    sessionCounts: (profile, now) => cursorSessions.sessionCounts(profile, now)
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
  return appIds().map((id) => ({ id, label: APPS[id].label, tagColor: APPS[id].tagColor }));
}

function defaultProfilePath(appId) {
  return appSupportDir(getApp(appId).appName);
}

module.exports = { APPS, DEFAULT_APP, getApp, isKnownApp, appIds, listApps, defaultProfilePath, appSupportDir };
