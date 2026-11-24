'use strict';

// Codex (desktop app and command line share CODEX_HOME).
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const { parseDate } = require('../scan');
const transcript = require('./transcript');
const { suggestedTranscriptName } = require('../transcript');
const codexRollout = require('./rollout');
const { addGeneratedImages } = require('./attachments');
const { matchJsonl, CHROMIUM_PROFILE_ISOLATION } = require('../shared');
const codexQuota = require('./quota');
const codexIdentity = require('./identity');
const { seedCodexHome } = require('./home');
const codexRuntimeHome = require('./runtime-home');
const codexTaskPackage = require('./task-package');
const codexHistory = require('./history-retention');
const { inspectCodexHome } = require('./account-import');

module.exports = {
  id: 'codex',
  label: 'Codex',
  // Mesh catalog facts, stored and synced in account keys: never change them.
  // Desktop and command-line forms of one sign-in system share a namespace.
  providerNamespace: 'codex',
  clientForm: 'desktop',
  // The recruit dialog's first choice when it can be used.
  recruitDefault: true,
  tagColor: '#2f9e8f',
  // New cats of this client wear its coat (src/yard/cat-art.js LOOKS).
  catCoat: 'codex',
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
    // What the recruit dialog tells the person (src/renderer/recruit.js).
    plaintextFile: '.env',
    notes: Object.freeze({ key: 'recruit.note.codexKey' }),
    browser: true,
    key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'official-stdin', plaintext: false }),
    // reservedIds: Codex's own built-in provider ids, which a pasted provider may not reuse.
    provider: Object.freeze({ fields: Object.freeze(['id', 'baseUrl', 'model']), via: 'config-file', plaintext: true,
      reservedIds: Object.freeze(['openai', 'ollama', 'lmstudio', 'oss', 'amazon-bedrock', 'bedrock', 'vertex', 'gcp', 'google']) }),
    importFiles: Object.freeze(['auth.json'])
  }),
  // How a pasted key or token reaches this client (./credentials.js).
  credentialHandoff: require('./credentials'),
  // Which dropped sign-in files belong to this client and how they are copied (./import.js).
  credentialImport: require('./import'),
  // How the hub runs this client in the background (./hub.js).
  hub: require('./hub'),
  // Account ID for recognising the same sign-in (./identity.js).
  accountId: (profile) => codexIdentity.codexAccountId(profile),
  // The Codex CLI is found by Codex's own resolver (./quota.js), also next to the desktop app.
  cliLauncher: Object.freeze({ toolId: 'codex', resolve: (options) => codexQuota.resolveCodexCli(options) }),
  // Quota: the official app-server, with the newest rollout's rate limits as a
  // marked-stale fallback (./quota.js).
  quota: Object.freeze({
    read: (profile, options) => codexQuota.readCodexQuota(profile, options),
    readCached: (profile) => codexQuota.readCachedCodexQuota(profile),
    failureReason: (error) => codexQuota.friendlyCodexFailure(error)
  }),
  // A Codex home stands on its own (no desktop data folder needed); <home>/.codex
  // is the official default. Registering one from the command line requires
  // recognizable Codex state.
  standaloneHome: Object.freeze({
    officialName: '.codex',
    looksValid: (directory) => Boolean(inspectCodexHome(directory)),
    invalid: Object.freeze({ code: 'codex-home-invalid', message: 'The directory has no recognized Codex state.' })
  }),
  // A managed home is seeded with the file credential store. Its session root
  // lies outside AppData, so it is prepared even for the Windows default slot.
  managedHome: Object.freeze({ seed: seedCodexHome, outsideAppData: true }),
  // On macOS a long CODEX_HOME gets a short alias for Codex's local sockets.
  runtimeHome: Object.freeze({
    mayAlias: (profile) => codexRuntimeHome.needsShortRuntimeHome(profile.sessionRoot),
    ensure: (profile) => codexRuntimeHome.ensureCodexRuntimeHome(profile)
  }),
  // Task packages carry Codex conversations natively (root and internal records).
  taskPackage: Object.freeze({
    capture: codexTaskPackage.captureCodexTaskSession,
    import: codexTaskPackage.importCodexTaskSession
  }),
  // Opt-in history upkeep after the client stops (./history-retention.js).
  historyUpkeep: Object.freeze({
    run: codexHistory.runAfterProfileStop,
    policySelected: (sessionRoot) => Boolean(codexHistory.readPolicy(codexHistory.canonicalRoot(sessionRoot)))
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
  replyState: (filePath, stat) => {
    const { lastRole, lastReplyAt, replyDone } = sessions.codexTailState(filePath, stat);
    return { lastRole, lastReplyAt, replyDone };
  },
  // Among a conversation's rollouts, activity follows the user root.
  activityPreference: (profile) => sessions.createCodexActivityPreference(profile),
  isArchivedRecordFile: (profile, filePath) => path.relative(profile.sessionRoot, filePath).split(path.sep)[0] === 'archived_sessions',
  exportTranscript: (session) => ({
    markdown: transcript.codexTranscriptMarkdown(session.filePath),
    suggestedName: suggestedTranscriptName(session.title)
  }),
  // Attachments for export: parts of the rollout's messages, and generated images.
  attachments: Object.freeze({
    recordFile: (session) => session.filePath || null,
    messageOf: codexRollout.responseMessageOf,
    generated: addGeneratedImages
  })
};
