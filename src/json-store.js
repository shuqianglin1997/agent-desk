/*
 * Small crash-tolerant JSON store used for profiles and UI settings.
 * Pure Node so the write/backup/recovery behavior can be unit tested.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile, writeJsonAtomic } = require('./core/json-file');

function readJsonStore(filePath, validate = () => true) {
  const result = readJsonFile(filePath, { validate });
  return result.ok ? { filePath, parsed: result.value } : null;
}

// User settings and Mesh key envelopes can contain private local metadata:
// the file is owner-only from its first byte, flushed, the previous version
// copied to the backup, then renamed into place (src/core/json-file.js).
function writeJsonStore(storeFile, payload, options = {}) {
  writeJsonAtomic(storeFile, payload, {
    mode: options.mode || 0o600,
    backupFile: options.skipBackup ? null : (options.backupFile || `${storeFile}.bak`),
    createDirectory: true,
    copyIfRenameFails: true
  });
}

function snapshotFile(sourceFile, targetFile) {
  if (!fs.existsSync(sourceFile)) return false;
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(sourceFile, targetFile);
  return true;
}

module.exports = {
  readJsonStore,
  writeJsonStore,
  snapshotFile
};
