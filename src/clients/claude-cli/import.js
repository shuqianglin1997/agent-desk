'use strict';

// Claude Code: copying a dropped or chosen sign-in file into a new isolated home
// (see src/credential-import.js for the rules every client follows).

const path = require('node:path');
const { ImportError, readSmallFile, json, present } = require('../import-files');
const { writePrivateFile, ensurePrivateDirectory } = require('../credential-files');

module.exports = {
  fileNames: Object.freeze(['.credentials.json']),
  // macOS keeps Claude Code's sign-in in the Keychain; there is no file.
  platforms: ['linux', 'win32'],
  accepts: (fileName) => fileName === '.credentials.json',
  read(filePath) {
    const bytes = readSmallFile(filePath);
    const value = json(bytes);
    const oauth = value?.claudeAiOauth;
    if (!oauth || typeof oauth !== 'object' || !(present(oauth.refreshToken) || present(oauth.accessToken))) throw new ImportError('credential-file-format');
    return { bytes };
  },
  sourceHome: (filePath) => path.dirname(filePath),
  stage(profile, payload) {
    ensurePrivateDirectory(path.join(profile.sessionRoot, 'projects'));
    writePrivateFile(path.join(profile.sessionRoot, '.credentials.json'), payload.bytes);
  },
  stagedFile: (profile) => path.join(profile.sessionRoot, '.credentials.json')
};
