'use strict';

// Kimi Code.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const transcript = require('./transcript');
const wire = require('./wire');
const { suggestedTranscriptName } = require('../transcript');
const { CHROMIUM_PROFILE_ISOLATION } = require('../shared');

module.exports = {
  id: 'kimi',
  label: 'Kimi Code',
  // Mesh catalog facts, stored and synced in account keys: never change them.
  // Desktop and command-line forms of one sign-in system share a namespace.
  providerNamespace: 'kimi',
  clientForm: 'desktop',
  tagColor: '#2f6bff',
  appName: 'Kimi', // /Applications/Kimi.app（桌面客户端）；会话数据来自 Kimi Code CLI / VS Code 插件
  mac: {
    launchers: [{ bundleName: 'Kimi', executableName: 'Kimi' }]
  },
  profileIsolation: CHROMIUM_PROFILE_ISOLATION,
  // How the official app updates itself (src/clients/app-update.js): not known
  // on either system.
  update: Object.freeze({ mechanism: 'unknown', windows: 'unknown', waiting: null }),
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
    // What the recruit dialog tells the person (src/renderer/recruit.js).
    plaintextFile: 'config.toml',
    keyAsksDefaultModel: true,
    browser: true,
    key: Object.freeze({ kinds: Object.freeze(['api-key']), via: 'official-env', catalogProvider: true, plaintext: true }),
    provider: Object.freeze({ fields: Object.freeze(['id', 'baseUrl', 'model']), via: 'config-file', plaintext: true }),
    importFiles: Object.freeze(['credentials/kimi-code.json'])
  }),
  // How a pasted key or token reaches this client (./credentials.js).
  credentialHandoff: require('./credentials'),
  // Which dropped sign-in files belong to this client and how they are copied (./import.js).
  credentialImport: require('./import'),
  // Kimi Code takes the -p prompt only as an argument (no documented stdin), and
  // -p always runs with automatic permission, so there is no read-only run
  // (checked against official docs 2026-11-24).
  hubUnsupported: 'prompt-argument-only',
  // Kimi Code and Kimi Work are one desktop ecosystem: on one machine they share
  // the sign-in, so their default slots are linked by this identity key once.
  defaultIdentityKey: 'Kimi',
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
    markdown: transcript.kimiTranscriptMarkdown(session.filePath),
    suggestedName: suggestedTranscriptName(session.title)
  }),
  // Attachments for export: parts of the messages in the session's wire file.
  attachments: Object.freeze({
    recordFile: (session) => (session.filePath && path.basename(session.filePath) === 'state.json' ? wire.wirePathOf(session.filePath) : null),
    messageOf: wire.messageOf
  })
};
