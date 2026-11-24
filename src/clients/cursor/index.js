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
  discovery: Object.freeze({
    kind: 'desktop',
    homeScan: true,
    markerSets: [['User/globalStorage/state.vscdb']]
  }),
  scan: (profile) => cursorSessions.scanCursor(profile),
  // 排行榜今日计数走 SQLite 聚合（会话是 db 行不是文件，按文件数会失真）
  sessionCounts: (profile, now) => cursorSessions.sessionCounts(profile, now),
  // 会话是 SQLite 行，最新文件就是 state.vscdb 本身；直接 MAX(lastUpdatedAt)，不用 filePath
  contentActivityAt: (profile) => cursorSessions.latestActivity(profile)
};
