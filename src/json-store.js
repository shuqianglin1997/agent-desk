/*
 * Small crash-tolerant JSON store used for profiles and UI settings.
 * Pure Node so the write/backup/recovery behavior can be unit tested.
 */

const fs = require('node:fs');
const path = require('node:path');

function readJsonStore(filePath, validate = () => true) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!validate(parsed)) return null;
    return { filePath, parsed };
  } catch (_error) {
    return null;
  }
}

function writeJsonStore(storeFile, payload, options = {}) {
  const backupFile = options.backupFile || `${storeFile}.bak`;
  const tempFile = `${storeFile}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const descriptor = fs.openSync(tempFile, 'wx');
  try {
    fs.writeFileSync(descriptor, JSON.stringify(payload, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }

  if (!options.skipBackup && fs.existsSync(storeFile)) {
    try {
      fs.copyFileSync(storeFile, backupFile);
    } catch (_error) {
      // Best effort: the fully-written temp file still protects this write.
    }
  }

  try {
    fs.renameSync(tempFile, storeFile);
  } catch (_error) {
    // Windows commonly rejects rename-over-existing. The source is already
    // complete and fsynced, while backup recovery covers an interrupted copy.
    fs.copyFileSync(tempFile, storeFile);
    try { fs.unlinkSync(tempFile); } catch (_unlinkError) { /* best effort */ }
  }
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
