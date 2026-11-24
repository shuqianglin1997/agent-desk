'use strict';

// Codex (desktop app and command line share CODEX_HOME).
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const { parseDate } = require('../scan');
const transcripts = require('../../transcripts');
const { matchJsonl, CHROMIUM_PROFILE_ISOLATION } = require('../shared');

module.exports = {
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
  discovery: Object.freeze({
    kind: 'home',
    envVar: 'CODEX_HOME',
    defaultHome: '.codex',
    homeScan: true,
    markerSets: [['auth.json'], ['config.toml', 'sessions/'], ['.codex-global-state.json'], ['archived_sessions/']],
    exclusive: ['auth.json', '.codex-global-state.json', 'archived_sessions/'],
    // auth.json is a common name; only a Codex-shaped file counts.
    verify: Object.freeze({ 'auth.json': 'codex-auth' }),
    sessionsShape: 'dated'
  }),
  credentials: Object.freeze({
    browser: true,
    key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'official-stdin', plaintext: false }),
    provider: Object.freeze({ fields: Object.freeze(['id', 'baseUrl', 'model']), via: 'config-file', plaintext: true }),
    importFiles: Object.freeze(['auth.json'])
  }),
  scan: (profile, report) => sessions.scanCodex(profile, report),
  activityRecord: (filePath, stat) => {
    const { first, identity } = sessions.codexRecordIdentity(filePath, stat);
    return identity.recordKind === 'internal-child' ? null : {
      key: identity.adapterConversationKey,
      createdAt: parseDate(first?.timestamp)
    };
  },
  sessionAddressOf: (key) => key,
  contentActivityAt: (_profile, filePath) => sessions.codexActivityFromFile(filePath),
  // Who spoke last and whether the turn is done, from the end of the rollout.
  replyState: (filePath) => {
    const { lastRole, lastReplyAt, replyDone } = sessions.codexTailState(filePath);
    return { lastRole, lastReplyAt, replyDone };
  },
  // Among a conversation's rollouts, activity follows the user root.
  activityPreference: (profile) => sessions.createCodexActivityPreference(profile),
  isArchivedRecordFile: (profile, filePath) => path.relative(profile.sessionRoot, filePath).split(path.sep)[0] === 'archived_sessions',
  exportTranscript: (session) => ({
    markdown: transcripts.codexTranscriptMarkdown(session.filePath),
    suggestedName: transcripts.suggestedTranscriptName(session.title)
  })
};
