'use strict';

// Gemini CLI: copying a dropped or chosen sign-in file into a new isolated home
// (see src/credential-import.js for the rules every client follows).

const path = require('node:path');
const { ImportError, readSmallFile, json, present } = require('../import-files');
const { writePrivateFile, ensurePrivateDirectory } = require('../credential-files');

module.exports = {
  fileNames: Object.freeze(['oauth_creds.json']),
  accepts: (fileName) => fileName === 'oauth_creds.json',
  read(filePath) {
    const bytes = readSmallFile(filePath);
    const value = json(bytes);
    if (!present(value?.refresh_token) && !present(value?.access_token)) throw new ImportError('credential-file-format');
    return { bytes };
  },
  sourceHome: (filePath) => path.dirname(filePath),
  stage(profile, payload) {
    ensurePrivateDirectory(profile.sessionRoot);
    writePrivateFile(path.join(profile.sessionRoot, 'oauth_creds.json'), payload.bytes);
    writePrivateFile(path.join(profile.sessionRoot, 'settings.json'), `${JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }, null, 2)}\n`);
  },
  stagedFile: (profile) => path.join(profile.sessionRoot, 'oauth_creds.json')
};
