'use strict';

// OpenCode command line.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const cliClientSessions = require('./sessions');
const transcripts = require('../../transcripts');
const { withoutKeys, CLI_WINDOWS_ENTRY, isManagedHome } = require('../shared');

const OPENCODE_ENV_KEYS = Object.freeze(['OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_DB', 'XDG_DATA_HOME', 'XDG_STATE_HOME']);

// OpenCode: sessionRoot is its data folder (…/opencode, holding opencode.db).
// XDG_DATA_HOME points at the folder above it; a managed account also gets
// its own config and state folders, and every launch passes --standalone so
// accounts do not share the background service on a fixed port.
module.exports = {
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
};
