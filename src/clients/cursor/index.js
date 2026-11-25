'use strict';

// Cursor desktop.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const path = require('node:path');
const cursorSessions = require('./sessions');
const { CHROMIUM_PROFILE_ISOLATION } = require('../shared');

module.exports = {
  id: 'cursor',
  label: 'Cursor',
  // Mesh catalog facts, stored and synced in account keys: never change them.
  // Desktop and command-line forms of one sign-in system share a namespace.
  providerNamespace: 'cursor',
  clientForm: 'desktop',
  tagColor: '#6b7cff',
  // New cats of this client wear its coat (src/yard/cat-art.js LOOKS).
  catCoat: 'cursor',
  appName: 'Cursor', // /Applications/Cursor.app，VSCode 分支，认 --user-data-dir
  mac: {
    launchers: [{ bundleName: 'Cursor', executableName: 'Cursor' }]
  },
  profileIsolation: CHROMIUM_PROFILE_ISOLATION,
  // How the official app updates itself (src/clients/app-update.js): a VS Code
  // fork; the macOS updater underneath is not verified, and a downloaded
  // update cannot be seen before it is installed. Windows: not known.
  update: Object.freeze({ mechanism: 'vscode', windows: 'unknown', waiting: null }),
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
  discovery: Object.freeze({
    kind: 'desktop',
    homeScan: true,
    markerSets: [['User/globalStorage/state.vscdb']]
  }),
  // A desktop app: it can only open a window, so the hub cannot call it.
  hubUnsupported: 'desktop-only',
  quota: Object.freeze({ unsupportedReason: 'quota.reason.cursor.unsupported' }),
  scan: (profile) => cursorSessions.scanCursor(profile),
  // 排行榜今日计数走 SQLite 聚合（会话是 db 行不是文件，按文件数会失真）
  sessionCounts: (profile, now) => cursorSessions.sessionCounts(profile, now),
  // 会话是 SQLite 行，最新文件就是 state.vscdb 本身；直接 MAX(lastUpdatedAt)，不用 filePath
  contentActivityAt: (profile) => cursorSessions.latestActivity(profile)
};
