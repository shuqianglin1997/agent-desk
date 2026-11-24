'use strict';

// OpenCode: copying a dropped or chosen sign-in file into a new isolated home
// (see src/credential-import.js for the rules every client follows).

const path = require('node:path');
const { ImportError, readSmallFile, json } = require('../import-files');
const { writePrivateFile, ensurePrivateDirectory } = require('../credential-files');

// OpenCode (before 2.1) kept { <provider>: { type: api | oauth | wellknown } }
// in <data>/auth.json; Codex's auth.json has a different shape.
function isOpenCodeAuth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => entry && typeof entry === 'object' && ['api', 'oauth', 'wellknown'].includes(entry.type));
}

// `opencode auth export` prints [{ id, integrationID, label, active, value }].
function isOpenCodeExport(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => (
    entry && typeof entry === 'object' && typeof entry.integrationID === 'string'
    && entry.value && typeof entry.value === 'object' && ['oauth', 'key', 'external'].includes(entry.value.type)
  ));
}

module.exports = {
  // Its legacy auth.json shares Codex's file name; the content decides. Any
  // other .json may be an `opencode auth export` file.
  fileNames: Object.freeze(['auth.json']),
  matchesContent: isOpenCodeAuth,
  matchesAnyJson: isOpenCodeExport,
  // Legacy auth.json, or an export file under any .json name (found by content).
  accepts: (fileName) => fileName.endsWith('.json'),
  read(filePath) {
    const bytes = readSmallFile(filePath);
    const value = json(bytes);
    if (isOpenCodeAuth(value)) return { bytes };
    // An export is handed to `opencode auth import` in the new home, not copied as a file.
    if (isOpenCodeExport(value)) return { bytes, export: true, filePath };
    throw new ImportError('credential-file-format');
  },
  sourceHome: (filePath) => path.dirname(filePath),
  // OpenCode 2.x imports a legacy auth.json into opencode.db when it starts.
  stage(profile, payload) {
    ensurePrivateDirectory(profile.sessionRoot);
    writePrivateFile(path.join(profile.sessionRoot, 'auth.json'), payload.bytes);
  },
  stagedFile: (profile) => path.join(profile.sessionRoot, 'auth.json'),
  isOpenCodeAuth,
  isOpenCodeExport
};
