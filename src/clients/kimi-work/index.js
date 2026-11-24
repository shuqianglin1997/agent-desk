'use strict';

// Kimi Work desktop.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const path = require('node:path');
// Kimi Work keeps Kimi Code's session files.
const sessions = require('../kimi/sessions');
const kimiWorkSessions = require('./sessions');
// Kimi Work keeps Kimi Code's transcript and wire formats.
const transcript = require('../kimi/transcript');
const wire = require('../kimi/wire');
const { suggestedTranscriptName } = require('../transcript');
const { OFFICIAL_DEFAULT_ONLY } = require('../shared');

module.exports = {
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
  // A desktop app: it can only open a window, so the hub cannot call it.
  hubUnsupported: 'desktop-only',
  // Kimi Code and Kimi Work are one desktop ecosystem: on one machine they share
  // the sign-in, so their default slots are linked by this identity key once.
  defaultIdentityKey: 'Kimi',
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
    markdown: transcript.kimiTranscriptMarkdown(session.filePath, { title: session.title }),
    suggestedName: suggestedTranscriptName(session.title)
  }),
  // Attachments for export: parts of the messages in the session's wire file.
  attachments: Object.freeze({
    recordFile: (session) => (session.filePath && path.basename(session.filePath) === 'state.json' ? wire.wirePathOf(session.filePath) : null),
    messageOf: wire.messageOf
  })
};
