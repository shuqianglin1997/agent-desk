'use strict';

// DSH (DeepSeek Harness command line).
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const cliClientSessions = require('./sessions');

const DSH_ENV_KEYS = Object.freeze(['DSH_HOME']);

module.exports = {
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
};
