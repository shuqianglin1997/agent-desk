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

const { ok, fail } = require('./core/result');
const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const cursorSessions = require('./cursor-sessions');
const kimiWorkSessions = require('./kimi-work-sessions');
const cliClientSessions = require('./cli-client-sessions');
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
const OPENCODE_ENV_KEYS = Object.freeze(['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_DB', 'XDG_DATA_HOME', 'XDG_STATE_HOME']);
const GEMINI_ENV_KEYS = Object.freeze(['GEMINI_CLI_HOME', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GEMINI_FORCE_FILE_STORAGE']);
const QWEN_ENV_KEYS = Object.freeze(['QWEN_HOME', 'QWEN_RUNTIME_DIR', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY']);

function withoutKeys(baseEnv, keys) {
  return Object.fromEntries(Object.entries(baseEnv || {}).filter(([key]) => !keys.includes(key.toUpperCase())));
}

const CLI_WINDOWS_ENTRY = (installDir, markers) => ({
  executableNames: [],
  aliases: [],
  legacyInstallDirs: [installDir],
  packageNames: [],
  packageFamilyNames: [],
  packageFamilyPrefixes: [],
  protocol: null,
  profileMarkers: markers
});

// A Profile owns its sessionRoot. For a managed home the other per-account
// folders sit next to it under the Profile directory.
const isManagedHome = (profile) => profile.sessionRootMode === 'managed' || profile.profilePathMode === 'managed';

function withoutClaudeCodeEnvironment(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    const canonicalKey = key.toUpperCase();
    if (
      CLAUDE_CODE_ENV_KEYS.includes(canonicalKey) ||
      /^ANTHROPIC_(?:DEFAULT_|MODEL|SMALL_FAST_MODEL|CUSTOM_HEADERS|API_BASE_URL|BASE_URL|CONFIG_DIR|OAUTH_TOKEN|AUTH_TOKEN|API_KEY|AWS_|BEDROCK_|FOUNDRY_|VERTEX_|UNIX_SOCKET)/.test(canonicalKey) ||
      /^CLAUDE_CODE_(?:OAUTH_TOKEN|API_BASE_URL|API_KEY_|USE_(?:BEDROCK|FOUNDRY|VERTEX)|PLUGIN_)/.test(canonicalKey)
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
    scan: (profile) => sessions.scanClaudeCli(profile),
    // 活动探测的会话键（文件路径）→ 列表里这条会话的地址（文件名里的会话 ID）
    sessionAddressOf: (key) => path.basename(key, '.jsonl'),
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
    cliArgsForProfile: () => ['--profile', 'web'],
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
      ...Object.fromEntries(Object.entries(baseEnv || {}).filter(([key]) => key.toUpperCase() !== 'DSH_HOME')),
      DSH_HOME: profile.sessionRoot
    }),
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'sessions'), match: (name) => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name), maxDepth: 3 }
    ],
    diagnosticAreas: (profile) => [
      { label: 'DSH 主目录', path: profile.sessionRoot, kind: 'directory' },
      { label: 'DSH 会话', path: path.join(profile.sessionRoot, 'sessions'), kind: 'directory' }
    ],
    discovery: Object.freeze({
      kind: 'home',
      envVar: 'DSH_HOME',
      defaultHome: '.dsh',
      homeScan: true,
      markerSets: [
        ['.credentials.yaml'], ['profiles/', 'cordis.patch.yml'], ['profiles/', '.anonymous-user-id'],
        ['settings.yaml', 'profiles/'], ['settings.yaml.imported']
      ],
      exclusive: ['.credentials.yaml', 'cordis.patch.yml', '.anonymous-user-id', 'settings.yaml.imported']
    }),
    // DSH has no key command; its documented credential file is the write path.
    credentials: Object.freeze({
      browser: true,
      key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'credentials-file', plaintext: true }),
      provider: Object.freeze({ fields: Object.freeze(['baseUrl']), via: 'credentials-file', plaintext: true }),
      importFiles: Object.freeze(['.credentials.yaml'])
    }),
    // One row per root session: a header line plus durable events per session folder.
    scan: (profile) => cliClientSessions.scanDsh(profile),
    sessionKeyOf: (filePath) => path.dirname(filePath),
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
        createdAt: sessions.parseDate(first?.timestamp)
      };
    },
    sessionAddressOf: (key) => key,
    contentActivityAt: (_profile, filePath) => sessions.codexActivityFromFile(filePath),
    exportTranscript: (session) => ({
      markdown: transcripts.codexTranscriptMarkdown(session.filePath),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    })
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
    discovery: Object.freeze({
      kind: 'home',
      envVar: 'KIMI_CODE_HOME',
      defaultHome: '.kimi-code',
      homeScan: true,
      markerSets: [
        ['credentials/kimi-code.json'], ['credentials/', 'config.toml'], ['config.toml', 'user-history/'],
        ['config.toml', 'sessions/'], ['session_index.jsonl', 'projects.json'], ['session_index.jsonl', 'workspaces.json']
      ],
      exclusive: ['credentials/', 'user-history/', 'projects.json', 'workspaces.json'],
      sessionsShape: 'state-dirs',
      // The legacy ~/.kimi home is reported, never migrated or registered.
      legacyHomes: ['.kimi']
    }),
    // `kimi provider catalog add` takes the key from KIMI_REGISTRY_API_KEY
    // (never argv here); custom endpoints go into config.toml.
    credentials: Object.freeze({
      browser: true,
      key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'official-env', catalogProvider: true, plaintext: true }),
      provider: Object.freeze({ fields: Object.freeze(['id', 'baseUrl', 'model']), via: 'config-file', plaintext: true }),
      importFiles: Object.freeze(['credentials/kimi-code.json'])
    }),
    scan: (profile, report) => sessions.scanKimi(profile, report),
    contentActivityAt: (_profile, filePath) => sessions.kimiActivityFromFile(filePath),
    sessionAddressOf: (key) => path.basename(key),
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
    discovery: Object.freeze({
      kind: 'desktop',
      defaultOnly: true,
      homeScan: false,
      markerSets: [['daimon-share/daimon/']]
    }),
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
  // OpenCode: sessionRoot is its data folder (…/opencode, holding opencode.db).
  // XDG_DATA_HOME points at the folder above it; a managed account also gets
  // its own config and state folders, and every launch passes --standalone so
  // accounts do not share the background service on a fixed port.
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    tagColor: '#4f6b3a',
    appName: 'OpenCode',
    noLaunch: true,
    cliDiscoveryId: 'opencode',
    maintenanceToolId: 'cli:opencode',
    cliClearEnvKeys: OPENCODE_ENV_KEYS,
    cliArgsForProfile: () => ['--standalone'],
    profileIsolation: Object.freeze({ mode: 'external-only' }),
    windows: CLI_WINDOWS_ENTRY('opencode', ['opencode.db', 'storage']),
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.local', 'share', 'opencode') : path.join(profilePath, 'opencode-data', 'opencode')
    ),
    launchEnv: (profile, baseEnv) => {
      const env = withoutKeys(baseEnv, OPENCODE_ENV_KEYS);
      if (path.basename(profile.sessionRoot || '') === 'opencode') env.XDG_DATA_HOME = path.dirname(profile.sessionRoot);
      if (isManagedHome(profile) && profile.profilePath) {
        env.OPENCODE_CONFIG_DIR = path.join(profile.profilePath, 'opencode-config');
        env.XDG_STATE_HOME = path.join(profile.profilePath, 'opencode-state');
      }
      return env;
    },
    scanAreas: (profile) => [
      { dir: profile.sessionRoot, match: (name) => /^opencode(?:-[\w.-]+)?\.db(?:-wal)?$/.test(name), maxDepth: 1 }
    ],
    diagnosticAreas: (profile) => [
      { label: 'OpenCode 数据库', path: path.join(profile.sessionRoot, 'opencode.db'), kind: 'file' },
      { label: 'OpenCode 旧会话', path: path.join(profile.sessionRoot, 'storage', 'session'), kind: 'directory' }
    ],
    scan: (profile) => cliClientSessions.scanOpenCode(profile),
    exportTranscript: (session) => ({
      markdown: transcripts.openCodeTranscriptMarkdown(session),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    }),
    discovery: Object.freeze({
      kind: 'home',
      envVar: 'XDG_DATA_HOME',
      envSubdir: 'opencode',
      defaultHome: path.join('.local', 'share', 'opencode'),
      homeScan: true,
      markerSets: [['opencode.db'], ['storage/session/'], ['auth.json', 'storage/']],
      exclusive: ['opencode.db', 'storage/session/']
    }),
    // Keys reach OpenCode through `opencode auth import` on standard input
    // (`auth login --method key` needs a terminal); it stores them in opencode.db.
    credentials: Object.freeze({
      browser: true,
      key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'official-stdin', catalogProvider: true, catalogDefault: 'anthropic', plaintext: true }),
      importFiles: Object.freeze(['auth.json'])
    })
  },
  // Gemini CLI: sessionRoot is the .gemini folder; GEMINI_CLI_HOME is the folder
  // above it. Managed accounts keep pasted keys in their own folder instead of
  // the shared system keychain (GEMINI_FORCE_FILE_STORAGE).
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    tagColor: '#3c6fd6',
    appName: 'Gemini',
    noLaunch: true,
    cliDiscoveryId: 'gemini',
    maintenanceToolId: 'cli:gemini',
    cliClearEnvKeys: GEMINI_ENV_KEYS,
    profileIsolation: Object.freeze({ mode: 'external-only' }),
    windows: CLI_WINDOWS_ENTRY('gemini', ['settings.json', 'tmp']),
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.gemini') : path.join(profilePath, 'gemini-home', '.gemini')
    ),
    launchEnv: (profile, baseEnv) => {
      const env = withoutKeys(baseEnv, GEMINI_ENV_KEYS);
      const home = path.basename(profile.sessionRoot || '') === '.gemini' ? path.dirname(profile.sessionRoot) : profile.sessionRoot;
      if (home && path.resolve(home) !== path.resolve(os.homedir())) env.GEMINI_CLI_HOME = home;
      if (isManagedHome(profile)) env.GEMINI_FORCE_FILE_STORAGE = 'true';
      return env;
    },
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'tmp'), match: (name) => /^session-.*\.jsonl?$/.test(name), maxDepth: 3 }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Gemini 会话', path: path.join(profile.sessionRoot, 'tmp'), kind: 'directory' },
      { label: 'Gemini 设置', path: path.join(profile.sessionRoot, 'settings.json'), kind: 'file' }
    ],
    scan: (profile) => cliClientSessions.scanGemini(profile),
    exportTranscript: (session) => ({
      markdown: transcripts.geminiTranscriptMarkdown(session.filePath),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    }),
    discovery: Object.freeze({
      kind: 'home',
      envVar: 'GEMINI_CLI_HOME',
      envSubdir: '.gemini',
      defaultHome: '.gemini',
      homeScan: true,
      markerSets: [['google_accounts.json'], ['projects.json', 'tmp/'], ['settings.json', 'tmp/'], ['oauth_creds.json', 'settings.json'], ['installation_id', 'settings.json']],
      exclusive: ['google_accounts.json', 'projects.json', 'history/']
    }),
    credentials: Object.freeze({
      browser: true,
      key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'config-file', plaintext: true }),
      importFiles: Object.freeze(['oauth_creds.json'])
    })
  },
  // Qwen Code: QWEN_HOME is the state folder itself (no .qwen under it).
  'qwen-code': {
    id: 'qwen-code',
    label: 'Qwen Code',
    tagColor: '#6a4fd0',
    appName: 'Qwen',
    noLaunch: true,
    cliDiscoveryId: 'qwen-code',
    maintenanceToolId: 'cli:qwen-code',
    cliClearEnvKeys: QWEN_ENV_KEYS,
    profileIsolation: Object.freeze({ mode: 'external-only' }),
    windows: CLI_WINDOWS_ENTRY('qwen', ['settings.json', 'projects']),
    defaultSessionRoot: (profilePath, isDefault) => (
      isDefault ? path.join(os.homedir(), '.qwen') : path.join(profilePath, 'qwen-home')
    ),
    launchEnv: (profile, baseEnv) => {
      const env = withoutKeys(baseEnv, QWEN_ENV_KEYS);
      if (profile.sessionRoot && path.resolve(profile.sessionRoot) !== path.resolve(os.homedir(), '.qwen')) env.QWEN_HOME = profile.sessionRoot;
      return env;
    },
    scanAreas: (profile) => [
      { dir: path.join(profile.sessionRoot, 'projects'), match: (name) => name.endsWith('.jsonl'), maxDepth: 4 }
    ],
    diagnosticAreas: (profile) => [
      { label: 'Qwen 会话', path: path.join(profile.sessionRoot, 'projects'), kind: 'directory' },
      { label: 'Qwen 设置', path: path.join(profile.sessionRoot, 'settings.json'), kind: 'file' }
    ],
    scan: (profile) => cliClientSessions.scanQwen(profile),
    exportTranscript: (session) => ({
      markdown: transcripts.qwenTranscriptMarkdown(session.filePath),
      suggestedName: transcripts.suggestedTranscriptName(session.title)
    }),
    discovery: Object.freeze({
      kind: 'home',
      envVar: 'QWEN_HOME',
      defaultHome: '.qwen',
      homeScan: true,
      markerSets: [['subscription_credentials.json'], ['oauth_creds.json', 'settings.json'], ['settings.json', 'projects/']],
      exclusive: ['subscription_credentials.json'],
      verify: Object.freeze({ 'projects/': 'qwen-projects' })
    }),
    credentials: Object.freeze({
      browser: true,
      provider: Object.freeze({ fields: Object.freeze(['baseUrl', 'model']), via: 'config-file', plaintext: true })
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
    supportsManagedProfiles: APPS[id].profileIsolation?.mode === 'chromium-user-data-dir',
    signIn: signInMethods(APPS[id]),
    discoveryKind: APPS[id].discovery?.kind || null,
    defaultOnly: APPS[id].profileIsolation?.mode === 'official-default-only'
  }));
}

// Which ways of signing in a new account the recruit dialog may offer.
function signInMethods(app_) {
  const credentials = app_.credentials;
  return {
    browser: app_.profileIsolation?.mode !== 'official-default-only',
    key: Boolean(credentials?.key),
    keyKinds: [...(credentials?.key?.kinds || [])],
    keyNeedsCatalogProvider: credentials?.key?.catalogProvider === true,
    keyCatalogDefault: credentials?.key?.catalogDefault || (credentials?.key?.catalogProvider ? 'kimi-for-coding' : null),
    provider: Boolean(credentials?.provider),
    providerFields: [...(credentials?.provider?.fields || [])],
    providerOptionalFields: [...(credentials?.provider?.optional || [])],
    storesInPlaintext: Boolean(credentials?.key?.plaintext || credentials?.provider?.plaintext),
    importFiles: [...(credentials?.importFiles || [])]
  };
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
  // CLI entry points use an explicit config root, not Chromium profile args.
  // Mesh readiness consumes this same capability plan as desktop slots.
  if (app_.cliDiscoveryId) {
    if (!String(profile.sessionRoot || '').trim()) {
      return { ok: false, reasonCode: 'session-root-required', args: [] };
    }
    return {
      ok: true,
      isolated: profile.isProtected !== true && profile.sessionRootMode !== 'auto',
      args: app_.cliArgsForProfile ? app_.cliArgsForProfile(profile) : []
    };
  }
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

// A scan as a result (src/core/result.js): ok(rows, { truncated }) or
// fail(code) when the client's store exists but cannot be read. `scan()`
// keeps returning rows and throwing, for the callers that already handle it.
function scanResult(profile) {
  const report = {};
  try {
    const rows = getApp(profile.appId).scan(profile, report);
    return ok(Array.isArray(rows) ? rows : [], { truncated: report.truncated === true });
  } catch (error) {
    return fail(/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(error?.code || '')) ? error.code : 'session-scan-failed');
  }
}

module.exports = {
  APPS,
  scanResult,
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
