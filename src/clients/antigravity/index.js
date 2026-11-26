'use strict';

// Antigravity (Google's agent desktop app).
// Everything Catshelf knows about this client is declared in this folder;
// src/apps.js only collects the adapters (docs/ARCHITECTURE_PLAN.md §5.3).
//
// One account per computer: Antigravity keeps its sign-in in the system
// keychain, shared by the whole machine, so a second account with its own data
// folder would still use the same sign-in. Only its official default location
// is registered (docs/ADD_ACCOUNT_PLAN.md §8.2); tools that keep sign-in
// tokens and swap them in are against AGENTS.md and are not used.
//
// Its agent data is in ~/.gemini/antigravity (Windows:
// %USERPROFILE%\.gemini\antigravity). ~/.gemini is also Gemini CLI's home;
// neither client recognises the other's folders (test/antigravity.test.js).

const os = require('node:os');
const path = require('node:path');
const sessions = require('./sessions');
const { OFFICIAL_DEFAULT_ONLY } = require('../shared');

const DB_FILES = new Set([sessions.DB_NAME, `${sessions.DB_NAME}-wal`]);

module.exports = {
  id: 'antigravity',
  label: 'Antigravity',
  // Mesh catalog facts, stored and synced in account keys: never change them.
  // Desktop and command-line forms of one sign-in system share a namespace;
  // Antigravity's sign-in is its own, not Gemini CLI's (Mesh plan §33 1.41).
  providerNamespace: 'antigravity',
  clientForm: 'desktop',
  tagColor: '#4a7bd8',
  appName: 'Antigravity', // /Applications/Antigravity.app (com.google.antigravity)
  mac: {
    launchers: [{ bundleName: 'Antigravity', executableName: 'Antigravity', bundleIdentifiers: ['com.google.antigravity'] }]
  },
  // The sign-in is one per computer; no managed second location.
  profileIsolation: OFFICIAL_DEFAULT_ONLY,
  // How the official app updates itself (src/clients/app-update.js): the
  // bundle carries Squirrel.framework and an electron-updater app-update.yml;
  // whether a downloaded update can be seen before install is not verified.
  update: Object.freeze({ mechanism: 'squirrel', windows: 'unknown', waiting: null }),
  // Windows: per-user install in %LOCALAPPDATA%\Programs\Antigravity (or
  // Program Files), app data in %APPDATA%\Antigravity; not checked on Windows.
  windows: {
    executableNames: ['Antigravity.exe'],
    aliases: [],
    legacyInstallDirs: [],
    packageNames: [],
    packageFamilyNames: [],
    packageFamilyPrefixes: [],
    protocol: 'antigravity://',
    profileMarkers: ['Local State', 'app_storage.json', 'Partitions']
  },
  // The agent data does not follow the desktop data folder: it is always
  // ~/.gemini/antigravity. Discovery passes its own home for tests.
  defaultSessionRoot: (_profilePath, _isDefault, options = {}) => path.join(options.home || os.homedir(), '.gemini', 'antigravity'),
  launchEnv: (_profile, baseEnv) => baseEnv,
  // Activity watches the summary database and its write-ahead log.
  scanAreas: (profile) => [
    { dir: profile.sessionRoot, match: (name) => DB_FILES.has(name), maxDepth: 1 }
  ],
  sessionKeyOf: (filePath) => path.join(path.dirname(filePath), sessions.DB_NAME),
  diagnosticAreas: (profile) => [
    { label: 'Antigravity 会话库', path: sessions.dbPath(profile), kind: 'file' },
    { label: 'Antigravity 对话', path: path.join(profile.sessionRoot, 'conversations'), kind: 'directory' },
    { label: 'Antigravity 产物', path: path.join(profile.sessionRoot, 'brain'), kind: 'directory' }
  ],
  discovery: Object.freeze({
    kind: 'desktop',
    defaultOnly: true,
    homeScan: false,
    markerSets: [['Local State', 'app_storage.json']]
  }),
  // A desktop app that only opens a window, and Catshelf does not support its
  // command line (agy) yet, so the hub cannot call it.
  hubUnsupported: 'desktop-only-no-cli',
  // No official quota interface; Catshelf never queries one with the sign-in token.
  quota: Object.freeze({ unsupportedReason: 'quota.reason.antigravity.unsupported' }),
  scan: (profile) => sessions.scanAntigravity(profile),
  // Conversations are database rows: counts and "running" come from the rows.
  sessionCounts: (profile, now) => sessions.sessionCounts(profile, now),
  contentActivityAt: (profile) => sessions.latestActivity(profile)
  // No exportTranscript: the conversation body is protobuf without a public
  // schema (conversations/<id>.pb), so Markdown export is not offered.
};
