'use strict';

// Qwen Code.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const cliClientSessions = require('./sessions');
const transcript = require('./transcript');
const { suggestedTranscriptName } = require('../transcript');
const { withoutKeys, CLI_WINDOWS_ENTRY } = require('../shared');

const QWEN_ENV_KEYS = Object.freeze(['QWEN_HOME', 'QWEN_RUNTIME_DIR', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY']);

// Qwen Code: QWEN_HOME is the state folder itself (no .qwen under it).
module.exports = {
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
  // How a pasted key or token reaches this client (./credentials.js).
  credentialHandoff: require('./credentials'),
  // How the hub runs this client in the background (./hub.js).
  hub: require('./hub'),
  scan: (profile) => cliClientSessions.scanQwen(profile),
  exportTranscript: (session) => ({
    markdown: transcript.qwenTranscriptMarkdown(session.filePath),
    suggestedName: suggestedTranscriptName(session.title)
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
};
