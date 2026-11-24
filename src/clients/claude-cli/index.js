'use strict';

// Claude Code (the claude command line).
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const { lastEventTimestamp } = require('../scan');
const transcript = require('./transcript');
const records = require('./records');
const { suggestedTranscriptName } = require('../transcript');
const { CLAUDE_CODE_ENV_KEYS, withoutClaudeCodeEnvironment } = require('./environment');

module.exports = {
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
  discovery: Object.freeze({
    kind: 'home',
    envVar: 'CLAUDE_CONFIG_DIR',
    defaultHome: '.claude',
    homeScan: true,
    markerSets: [
      ['.claude.json'], ['projects/', 'settings.json'], ['projects/', 'history.jsonl'],
      ['projects/', 'shell-snapshots/'], ['projects/', 'todos/'], ['projects/', 'statsig/'],
      ['projects/', 'file-history/'], ['.credentials.json', 'settings.json']
    ],
    exclusive: ['.claude.json', '.credentials.json', 'shell-snapshots/', 'statsig/'],
    // Gemini CLI / Qwen Code homes also carry settings.json.
    excludedBy: ['oauth_creds.json', 'google_accounts.json', 'subscription_credentials.json'],
    verify: Object.freeze({ 'projects/': 'claude-projects' })
  }),
  // A pasted setup-token or API key goes into this home's settings.json
  // `env` (documented by Claude Code), which stores it in plain text.
  credentials: Object.freeze({
    browser: true,
    key: Object.freeze({ kinds: Object.freeze(['oauth-token', 'api-key']), via: 'settings-file', plaintext: true }),
    provider: Object.freeze({ fields: Object.freeze(['baseUrl']), optional: Object.freeze(['model']), via: 'settings-file', plaintext: true }),
    importFiles: process.platform === 'darwin' ? Object.freeze([]) : Object.freeze(['.credentials.json'])
  }),
  // How a pasted key or token reaches this client (./credentials.js).
  credentialHandoff: require('./credentials'),
  // Which dropped sign-in files belong to this client and how they are copied (./import.js).
  credentialImport: require('./import'),
  scan: (profile) => sessions.scanClaudeCli(profile),
  // 活动探测的会话键（文件路径）→ 列表里这条会话的地址（文件名里的会话 ID）
  sessionAddressOf: (key) => path.basename(key, '.jsonl'),
  contentActivityAt: (_profile, filePath) => lastEventTimestamp(filePath),
  // Who spoke last and whether the turn is done, from the end of the file.
  replyState: (filePath) => sessions.claudeCliTailState(filePath),
  // Subagent sessions are separate files whose events carry isSidechain.
  isInternalRecordFile: (filePath) => sessions.claudeCliIsSidechain(filePath),
  exportTranscript: (session) => ({
    markdown: transcript.claudeCliTranscriptMarkdown(session.filePath, { title: session.title }),
    suggestedName: suggestedTranscriptName(session.title)
  }),
  // Attachments for export: parts of the session's user and assistant messages.
  attachments: Object.freeze({
    recordFile: (session) => session.filePath || null,
    messageOf: records.messageOf
  })
};
