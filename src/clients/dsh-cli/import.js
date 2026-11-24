'use strict';

// DSH: copying a dropped or chosen sign-in file into a new isolated home
// (see src/credential-import.js for the rules every client follows).

const fs = require('node:fs');
const path = require('node:path');
const { ImportError, readSmallFile, utf8 } = require('../import-files');
const { writePrivateFile, ensurePrivateDirectory } = require('../credential-files');

module.exports = {
  fileNames: Object.freeze(['.credentials.yaml']),
  accepts: (fileName) => fileName === '.credentials.yaml',
  read(filePath) {
    const bytes = readSmallFile(filePath);
    const text = utf8(bytes);
    if (!/^version:\s*1\s*$/m.test(text) || !/^(refs|records):/m.test(text)) throw new ImportError('credential-file-format');
    return { bytes };
  },
  sourceHome: (filePath) => path.dirname(filePath),
  stage(profile, payload) {
    ensurePrivateDirectory(profile.sessionRoot);
    if (process.platform !== 'win32') fs.chmodSync(profile.sessionRoot, 0o700);
    writePrivateFile(path.join(profile.sessionRoot, '.credentials.yaml'), payload.bytes);
  },
  stagedFile: (profile) => path.join(profile.sessionRoot, '.credentials.yaml')
};
