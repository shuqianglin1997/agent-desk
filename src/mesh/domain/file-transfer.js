const path = require('node:path');

const FILE_MANIFEST_SCHEMA_VERSION = 1;
const MAX_FILE_COUNT = 32;
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_FILE_TRANSFER_BYTES = 8 * 1024 * 1024 * 1024;
const FILE_CHUNK_BYTES = 96 * 1024;
const FILE_TRANSFER_TTL_MS = 7 * 24 * 60 * 60_000;

function normalizeFileManifest(value = {}) {
  if (value.schemaVersion !== FILE_MANIFEST_SCHEMA_VERSION) throw new Error('file-manifest-version');
  const transferId = requiredText(value.transferId, 'transferId', 128);
  const files = Array.isArray(value.files) ? value.files : [];
  if (!files.length || files.length > MAX_FILE_COUNT) throw new Error('file-manifest-count');
  const normalized = files.map((file, index) => normalizeManifestFile(file, index));
  const bytesTotal = normalized.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(bytesTotal) || bytesTotal > MAX_FILE_TRANSFER_BYTES) {
    throw new Error('file-manifest-total-size');
  }
  if (Number(value.bytesTotal) !== bytesTotal) throw new Error('file-manifest-total-mismatch');
  const createdAt = normalizeIso(value.createdAt, 'createdAt');
  const expiresAt = normalizeIso(value.expiresAt, 'expiresAt');
  const lifetime = Date.parse(expiresAt) - Date.parse(createdAt);
  if (lifetime <= 0 || lifetime > FILE_TRANSFER_TTL_MS) throw new Error('file-manifest-expiry');
  return {
    schemaVersion: FILE_MANIFEST_SCHEMA_VERSION,
    transferId,
    files: normalized,
    bytesTotal,
    createdAt,
    expiresAt
  };
}

function createFileManifest(input = {}, options = {}) {
  const createdAt = normalizeIso(options.now || new Date().toISOString(), 'createdAt');
  return normalizeFileManifest({
    schemaVersion: FILE_MANIFEST_SCHEMA_VERSION,
    transferId: input.transferId,
    files: input.files,
    bytesTotal: (input.files || []).reduce((sum, file) => sum + Number(file.size || 0), 0),
    createdAt,
    expiresAt: options.expiresAt || new Date(Date.parse(createdAt) + FILE_TRANSFER_TTL_MS).toISOString()
  });
}

function normalizeManifestFile(value = {}, expectedIndex) {
  const index = nonNegativeInteger(value.index, 'file.index');
  if (index !== expectedIndex) throw new Error('file-manifest-index');
  const name = safeFileName(value.name);
  if (name !== String(value.name || '').normalize('NFC')) throw new Error('file-manifest-name');
  const size = nonNegativeInteger(value.size, 'file.size');
  if (size > MAX_FILE_BYTES) throw new Error('file-manifest-file-size');
  const sha256 = String(value.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('file-manifest-hash');
  const mtimeMs = Number(value.mtimeMs);
  return {
    index,
    fileId: requiredText(value.fileId, 'file.fileId', 128),
    name,
    size,
    sha256,
    mtimeMs: Number.isFinite(mtimeMs) && mtimeMs >= 0 ? Math.round(mtimeMs) : 0
  };
}

function safeFileName(value) {
  let text = String(value || '').normalize('NFC').trim();
  text = text.replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '');
  if (!text || text === '.' || text === '..') text = 'file';
  const parsed = path.win32.parse(text);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(parsed.name)) text = `_${text}`;
  if (text.length > 240) {
    const extension = parsed.ext.slice(0, 24);
    text = `${parsed.name.slice(0, Math.max(1, 240 - extension.length))}${extension}`;
  }
  return text;
}

function uniqueTargetNames(files, existingNames = []) {
  const used = new Set((Array.isArray(existingNames) ? existingNames : [])
    .map((name) => String(name || '').normalize('NFC').toLocaleLowerCase('en-US')));
  return (Array.isArray(files) ? files : []).map((file) => {
    const base = safeFileName(file?.name);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase('en-US'))) {
      const parsed = path.win32.parse(base);
      const addition = ` (${suffix})`;
      const stem = parsed.name.slice(0, Math.max(1, 240 - parsed.ext.length - addition.length));
      candidate = `${stem}${addition}${parsed.ext}`;
      suffix += 1;
      if (suffix > 10_000) throw new Error('file-target-name-exhausted');
    }
    used.add(candidate.toLocaleLowerCase('en-US'));
    return candidate;
  });
}

function normalizeResumeOffsets(value, manifest) {
  const files = Array.isArray(value) ? value : [];
  const byIndex = new Map(files.map((item) => [Number(item?.index), item]));
  return manifest.files.map((file) => {
    const offset = nonNegativeInteger(byIndex.get(file.index)?.offset || 0, 'file.offset');
    if (offset > file.size) throw new Error('file-resume-offset');
    return { index: file.index, offset };
  });
}

function fileChunkType(index, offset) {
  return `file-chunk:${nonNegativeInteger(index, 'file.index')}:${nonNegativeInteger(offset, 'file.offset')}`;
}

function nonNegativeInteger(value, field) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

module.exports = {
  FILE_MANIFEST_SCHEMA_VERSION,
  MAX_FILE_COUNT,
  MAX_FILE_BYTES,
  MAX_FILE_TRANSFER_BYTES,
  FILE_CHUNK_BYTES,
  FILE_TRANSFER_TTL_MS,
  createFileManifest,
  normalizeFileManifest,
  safeFileName,
  uniqueTargetNames,
  normalizeResumeOffsets,
  fileChunkType
};
