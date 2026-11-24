'use strict';

// Gemini CLI.
// Everything AgentDesk knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).

const os = require('node:os');
const path = require('node:path');
const cliClientSessions = require('./sessions');
const transcripts = require('../../transcripts');
const { withoutKeys, CLI_WINDOWS_ENTRY, isManagedHome } = require('../shared');

const GEMINI_ENV_KEYS = Object.freeze(['GEMINI_CLI_HOME', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GEMINI_FORCE_FILE_STORAGE']);

// Gemini CLI: sessionRoot is the .gemini folder; GEMINI_CLI_HOME is the folder
// above it. Managed accounts keep pasted keys in their own folder instead of
// the shared system keychain (GEMINI_FORCE_FILE_STORAGE).
module.exports = {
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
};
