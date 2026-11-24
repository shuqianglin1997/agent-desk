'use strict';

// Claude desktop.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const path = require('node:path');
const sessions = require('../../sessions');
const { matchLocalJson, CHROMIUM_PROFILE_ISOLATION } = require('../shared');
const { withoutClaudeCodeEnvironment } = require('../claude-cli/environment');

module.exports = {
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
  // Discovery: an Electron user-data directory. Only the default or a folder
  // the user picks is registered in place; nothing is copied.
  discovery: Object.freeze({
    kind: 'desktop',
    homeScan: true,
    markerSets: [['Local State', 'claude-code-sessions/'], ['Local State', 'local-agent-mode-sessions/']]
  }),
  scan: (profile, report) => sessions.scanClaude(profile, report),
  // 会话记录里的最后活跃时间（读 probe 传入的最新文件的 lastActivityAt），驱动干活/在岗判定
  contentActivityAt: (_profile, filePath) => sessions.claudeActivityFromFile(filePath)
};
