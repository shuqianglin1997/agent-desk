const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TASK_PACKAGE_SCHEMA_VERSION = 1;
const OUTER_MAGIC = Buffer.from('ADTASK01');
const INNER_MAGIC = Buffer.from('ADINNER1');
const AUTH_TAG_BYTES = 16;
const MAX_OUTER_HEADER_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRY_COUNT = 64;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 1024 * 1024;
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const UNLOCK_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateUnlockCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(20);
  if (!Buffer.isBuffer(bytes) || bytes.length < 20) throw new Error('task-package-random-source');
  const raw = Array.from(bytes.subarray(0, 20), (byte) => UNLOCK_ALPHABET[byte & 31]).join('');
  return raw.match(/.{1,5}/g).join('-');
}

function normalizeUnlockCode(value) {
  const code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 16 || code.length > 64) throw new Error('task-package-unlock-code');
  return code;
}

async function writeEncryptedTaskPackage(input = {}) {
  const destinationPath = requiredPath(input.destinationPath, 'destinationPath');
  const unlockCode = normalizeUnlockCode(input.unlockCode);
  const entries = await describeEntries(input.entries);
  const manifest = normalizeTaskPackageManifest({
    ...input.manifest,
    entries: entries.map((entry) => entry.publicEntry)
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error('task-package-manifest-too-large');

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const outerHeader = {
    format: 'agentdesk-task',
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  };
  const headerBytes = Buffer.from(JSON.stringify(outerHeader), 'utf8');
  const outerPrefix = lengthPrefixed(OUTER_MAGIC, headerBytes, MAX_OUTER_HEADER_BYTES);
  const innerPrefix = lengthPrefixed(INNER_MAGIC, manifestBytes, MAX_MANIFEST_BYTES);
  const key = deriveKey(unlockCode, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(outerPrefix);

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`
  );
  let handle;
  try {
    handle = await fs.promises.open(tempPath, 'wx', 0o600);
    await writeBuffer(handle, outerPrefix);
    await writeCipherChunk(handle, cipher, innerPrefix);
    for (const entry of entries) {
      if (entry.buffer) {
        await writeCipherChunk(handle, cipher, entry.buffer);
        continue;
      }
      for await (const chunk of fs.createReadStream(entry.sourcePath, { highWaterMark: STREAM_CHUNK_BYTES })) {
        await writeCipherChunk(handle, cipher, chunk);
      }
    }
    await writeBuffer(handle, cipher.final());
    await writeBuffer(handle, cipher.getAuthTag());
    await handle.sync();
    await handle.close();
    handle = null;
    replaceFile(tempPath, destinationPath);
    return { manifest, savedPath: destinationPath };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    try { fs.unlinkSync(tempPath); } catch (_unlinkError) { /* best effort */ }
    throw error;
  } finally {
    key.fill(0);
  }
}

async function decryptTaskPackage(input = {}) {
  const packagePath = requiredPath(input.packagePath, 'packagePath');
  const unlockCode = normalizeUnlockCode(input.unlockCode);
  const plainPath = requiredPath(input.plainPath, 'plainPath');
  const source = await fs.promises.open(packagePath, 'r');
  let target;
  let key;
  try {
    const stat = await source.stat();
    if (!stat.isFile() || stat.size < OUTER_MAGIC.length + 4 + AUTH_TAG_BYTES + 1) {
      throw new Error('task-package-file-invalid');
    }
    if (stat.size > MAX_PACKAGE_BYTES + MAX_MANIFEST_BYTES + MAX_OUTER_HEADER_BYTES + 64) {
      throw new Error('task-package-total-size');
    }
    const prefixHead = await readExact(source, OUTER_MAGIC.length + 4, 0);
    if (!prefixHead.subarray(0, OUTER_MAGIC.length).equals(OUTER_MAGIC)) {
      throw new Error('task-package-format');
    }
    const headerLength = prefixHead.readUInt32BE(OUTER_MAGIC.length);
    if (headerLength < 2 || headerLength > MAX_OUTER_HEADER_BYTES) throw new Error('task-package-header-size');
    const headerBytes = await readExact(source, headerLength, prefixHead.length);
    const outerPrefix = Buffer.concat([prefixHead, headerBytes]);
    const outerHeader = normalizeOuterHeader(parseJson(headerBytes, 'task-package-header-json'));
    const ciphertextOffset = outerPrefix.length;
    const ciphertextLength = stat.size - ciphertextOffset - AUTH_TAG_BYTES;
    if (ciphertextLength < INNER_MAGIC.length + 4 + 2) throw new Error('task-package-ciphertext-size');
    const tag = await readExact(source, AUTH_TAG_BYTES, stat.size - AUTH_TAG_BYTES);
    const salt = Buffer.from(outerHeader.salt, 'base64');
    const iv = Buffer.from(outerHeader.iv, 'base64');
    key = deriveKey(unlockCode, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(outerPrefix);
    decipher.setAuthTag(tag);

    fs.mkdirSync(path.dirname(plainPath), { recursive: true });
    target = await fs.promises.open(plainPath, 'wx', 0o600);
    let offset = ciphertextOffset;
    let remaining = ciphertextLength;
    while (remaining > 0) {
      const length = Math.min(STREAM_CHUNK_BYTES, remaining);
      const chunk = await readExact(source, length, offset);
      await writeBuffer(target, decipher.update(chunk));
      offset += length;
      remaining -= length;
    }
    try {
      await writeBuffer(target, decipher.final());
    } catch (_error) {
      throw new Error('task-package-unlock-failed');
    }
    await target.sync();
    await target.close();
    target = null;
    const inspected = await inspectPlainTaskArchive(plainPath);
    return { ...inspected, packagePath, plainPath };
  } catch (error) {
    if (target) await target.close().catch(() => {});
    try { fs.unlinkSync(plainPath); } catch (_unlinkError) { /* best effort */ }
    throw error;
  } finally {
    await source.close().catch(() => {});
    if (key) key.fill(0);
  }
}

async function inspectPlainTaskArchive(plainPath) {
  const handle = await fs.promises.open(plainPath, 'r');
  try {
    const stat = await handle.stat();
    const prefixHead = await readExact(handle, INNER_MAGIC.length + 4, 0);
    if (!prefixHead.subarray(0, INNER_MAGIC.length).equals(INNER_MAGIC)) {
      throw new Error('task-package-inner-format');
    }
    const manifestLength = prefixHead.readUInt32BE(INNER_MAGIC.length);
    if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) throw new Error('task-package-manifest-size');
    const manifestBytes = await readExact(handle, manifestLength, prefixHead.length);
    const manifest = normalizeTaskPackageManifest(parseJson(manifestBytes, 'task-package-manifest-json'));
    let offset = prefixHead.length + manifestLength;
    const entries = [];
    for (const entry of manifest.entries) {
      if (offset + entry.size > stat.size) throw new Error('task-package-entry-truncated');
      const sha256 = await hashRange(handle, offset, entry.size);
      if (sha256 !== entry.sha256) throw new Error('task-package-entry-hash');
      entries.push({ ...entry, offset });
      offset += entry.size;
    }
    if (offset !== stat.size) throw new Error('task-package-trailing-data');
    return { manifest, entries };
  } finally {
    await handle.close();
  }
}

async function extractTaskPackageEntry(input = {}) {
  const plainPath = requiredPath(input.plainPath, 'plainPath');
  const entry = normalizeManifestEntry(input.entry, Number(input.entry?.index || 0));
  const offset = nonNegativeInteger(input.entry?.offset, 'entry.offset');
  const destinationPath = requiredPath(input.destinationPath, 'destinationPath');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  const source = await fs.promises.open(plainPath, 'r');
  let target;
  try {
    target = await fs.promises.open(tempPath, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let remaining = entry.size;
    let position = offset;
    while (remaining > 0) {
      const length = Math.min(STREAM_CHUNK_BYTES, remaining);
      const chunk = await readExact(source, length, position);
      hash.update(chunk);
      await writeBuffer(target, chunk);
      remaining -= length;
      position += length;
    }
    if (hash.digest('hex') !== entry.sha256) throw new Error('task-package-entry-hash');
    await target.sync();
    await target.close();
    target = null;
    replaceFile(tempPath, destinationPath);
    return destinationPath;
  } catch (error) {
    if (target) await target.close().catch(() => {});
    try { fs.unlinkSync(tempPath); } catch (_unlinkError) { /* best effort */ }
    throw error;
  } finally {
    await source.close().catch(() => {});
  }
}

async function describeEntries(entries) {
  const values = Array.isArray(entries) ? entries : [];
  if (!values.length || values.length > MAX_ENTRY_COUNT) throw new Error('task-package-entry-count');
  const seenIds = new Set();
  const described = [];
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] || {};
    const entryId = requiredText(value.entryId, 'entry.entryId', 128);
    if (seenIds.has(entryId)) throw new Error('task-package-entry-duplicate');
    seenIds.add(entryId);
    const name = safeLogicalName(value.name);
    const kind = enumValue(value.kind, new Set([
      'native-session-root',
      'native-session-child',
      'conversation-transcript',
      'git-working-tree',
      'attachment'
    ]), 'task-package-entry-kind');
    const metadata = boundedObject(value.metadata, 16 * 1024);
    let size;
    let sha256;
    let buffer = null;
    let sourcePath = null;
    if (Buffer.isBuffer(value.buffer)) {
      buffer = value.buffer;
      size = buffer.length;
      sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    } else {
      sourcePath = requiredPath(value.sourcePath, 'entry.sourcePath');
      const stat = fs.lstatSync(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('task-package-entry-source');
      size = stat.size;
      sha256 = await hashFile(sourcePath);
    }
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ENTRY_BYTES) throw new Error('task-package-entry-size');
    total += size;
    if (!Number.isSafeInteger(total) || total > MAX_PACKAGE_BYTES) throw new Error('task-package-total-size');
    described.push({
      sourcePath,
      buffer,
      publicEntry: { index, entryId, kind, name, size, sha256, metadata }
    });
  }
  return described;
}

function normalizeTaskPackageManifest(value = {}) {
  if (value.schemaVersion !== TASK_PACKAGE_SCHEMA_VERSION) throw new Error('task-package-schema-version');
  const packageId = requiredText(value.packageId, 'packageId', 128);
  const createdAt = normalizeIso(value.createdAt, 'createdAt');
  const source = normalizeSource(value.source);
  const checkpoint = normalizeCheckpoint(value.checkpoint);
  const session = normalizeSession(value.session);
  const project = value.project ? normalizeProject(value.project) : null;
  const entriesRaw = Array.isArray(value.entries) ? value.entries : [];
  if (!entriesRaw.length || entriesRaw.length > MAX_ENTRY_COUNT) throw new Error('task-package-entry-count');
  const entries = entriesRaw.map(normalizeManifestEntry);
  const ids = new Set();
  const names = new Set();
  let total = 0;
  for (const entry of entries) {
    if (ids.has(entry.entryId)) throw new Error('task-package-entry-duplicate');
    const portableNameKey = entry.name.toLocaleLowerCase('en-US');
    if (names.has(portableNameKey)) throw new Error('task-package-entry-name-duplicate');
    ids.add(entry.entryId);
    names.add(portableNameKey);
    total += entry.size;
    if (!Number.isSafeInteger(total) || total > MAX_PACKAGE_BYTES) throw new Error('task-package-total-size');
  }
  const entriesById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const contentEntry = entriesById.get(session.contentEntryId);
  if (!contentEntry) throw new Error('task-package-session-entry');
  const childEntryIdSet = new Set(session.childEntryIds);
  if (session.mode === 'native') {
    if (contentEntry.kind !== 'native-session-root') throw new Error('task-package-session-entry-kind');
    for (const entryId of session.childEntryIds) {
      if (entriesById.get(entryId)?.kind !== 'native-session-child') {
        throw new Error('task-package-session-child-entry');
      }
    }
  } else if (contentEntry.kind !== 'conversation-transcript' || session.childEntryIds.length) {
    throw new Error('task-package-session-entry-kind');
  }
  if (project?.patchEntryId && entriesById.get(project.patchEntryId)?.kind !== 'git-working-tree') {
    throw new Error('task-package-project-entry');
  }
  for (const entry of entries) {
    if (entry.kind === 'native-session-root' && (
      session.mode !== 'native' || entry.entryId !== session.contentEntryId
    )) throw new Error('task-package-native-entry-unreferenced');
    if (entry.kind === 'native-session-child' && (
      session.mode !== 'native' || !childEntryIdSet.has(entry.entryId)
    )) throw new Error('task-package-native-entry-unreferenced');
    if (entry.kind === 'conversation-transcript' && (
      session.mode !== 'transcript' || entry.entryId !== session.contentEntryId
    )) throw new Error('task-package-transcript-entry-unreferenced');
    if (entry.kind === 'git-working-tree' && (
      !project?.patchEntryId || entry.entryId !== project.patchEntryId
    )) throw new Error('task-package-project-entry-unreferenced');
  }
  return {
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    packageId,
    createdAt,
    kind: 'task-package',
    source,
    checkpoint,
    session,
    project,
    entries,
    bytesTotal: total,
    lineage: {
      parentPackageId: cleanText(value.lineage?.parentPackageId, 128) || null
    }
  };
}

function normalizeSource(value = {}) {
  return {
    senderLabel: cleanText(value.senderLabel, 120) || null,
    deviceId: cleanText(value.deviceId, 128) || null,
    deviceName: cleanText(value.deviceName, 120) || null,
    agentId: cleanText(value.agentId, 128) || null,
    agentName: requiredText(value.agentName, 'source.agentName', 120),
    profileId: cleanText(value.profileId, 128) || null,
    appId: requiredText(value.appId, 'source.appId', 80)
  };
}

function normalizeCheckpoint(value = {}) {
  const objective = cleanMultiline(value.objective, 4000);
  if (!objective) throw new TypeError('checkpoint.objective is required');
  return {
    objective,
    completed: normalizeLines(value.completed, 32, 1000),
    next: normalizeLines(value.next, 32, 1000),
    blockers: normalizeLines(value.blockers, 32, 1000),
    acceptance: normalizeLines(value.acceptance, 32, 1000)
  };
}

function normalizeSession(value = {}) {
  const mode = enumValue(value.mode, new Set(['native', 'transcript']), 'task-package-session-mode');
  const contentEntryId = requiredText(value.contentEntryId, 'session.contentEntryId', 128);
  const childEntryIds = normalizeLines(value.childEntryIds, MAX_ENTRY_COUNT, 128);
  if (new Set(childEntryIds).size !== childEntryIds.length || childEntryIds.includes(contentEntryId)) {
    throw new Error('task-package-session-child-entry');
  }
  return {
    mode,
    adapterId: requiredText(value.adapterId, 'session.adapterId', 80),
    adapterVersion: positiveInteger(value.adapterVersion, 'session.adapterVersion'),
    conversationId: cleanText(value.conversationId, 128) || null,
    sessionId: requiredText(value.sessionId, 'session.sessionId', 128),
    originalTitle: requiredText(value.originalTitle, 'session.originalTitle', 240),
    suggestedTitle: requiredText(value.suggestedTitle, 'session.suggestedTitle', 240),
    contentEntryId,
    childEntryIds
  };
}

function normalizeProject(value = {}) {
  return {
    name: cleanText(value.name, 160) || null,
    remote: cleanText(value.remote, 1000) || null,
    branch: cleanText(value.branch, 240) || null,
    head: /^[a-f0-9]{40,64}$/i.test(String(value.head || '')) ? String(value.head).toLowerCase() : null,
    dirty: value.dirty === true,
    statusSummary: normalizeLines(value.statusSummary, 200, 600),
    patchEntryId: cleanText(value.patchEntryId, 128) || null
  };
}

function normalizeManifestEntry(value = {}, expectedIndex) {
  const index = nonNegativeInteger(value.index, 'entry.index');
  if (expectedIndex !== undefined && index !== expectedIndex) throw new Error('task-package-entry-index');
  const sha256 = String(value.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('task-package-entry-hash');
  const size = nonNegativeInteger(value.size, 'entry.size');
  if (size > MAX_ENTRY_BYTES) throw new Error('task-package-entry-size');
  return {
    index,
    entryId: requiredText(value.entryId, 'entry.entryId', 128),
    kind: enumValue(value.kind, new Set([
      'native-session-root',
      'native-session-child',
      'conversation-transcript',
      'git-working-tree',
      'attachment'
    ]), 'task-package-entry-kind'),
    name: safeLogicalName(value.name),
    size,
    sha256,
    metadata: boundedObject(value.metadata, 16 * 1024)
  };
}

function normalizeOuterHeader(value = {}) {
  const allowedKeys = new Set(['format', 'schemaVersion', 'cipher', 'kdf', 'salt', 'iv', 'n', 'r', 'p']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('task-package-crypto-header');
  if (value.format !== 'agentdesk-task' || value.schemaVersion !== TASK_PACKAGE_SCHEMA_VERSION) {
    throw new Error('task-package-format-version');
  }
  if (value.cipher !== 'aes-256-gcm' || value.kdf !== 'scrypt') throw new Error('task-package-crypto-suite');
  if (value.n !== SCRYPT_N || value.r !== SCRYPT_R || value.p !== SCRYPT_P) throw new Error('task-package-kdf-params');
  const salt = Buffer.from(String(value.salt || ''), 'base64');
  const iv = Buffer.from(String(value.iv || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12) throw new Error('task-package-crypto-header');
  return { ...value, salt: salt.toString('base64'), iv: iv.toString('base64') };
}

function publicTaskPackageManifest(manifest) {
  const value = normalizeTaskPackageManifest(manifest);
  return {
    packageId: value.packageId,
    createdAt: value.createdAt,
    source: value.source,
    checkpoint: value.checkpoint,
    session: value.session,
    project: value.project,
    entries: value.entries.map(({ entryId, kind, name, size, metadata }) => ({
      entryId, kind, name, size, metadata
    })),
    bytesTotal: value.bytesTotal,
    lineage: value.lineage
  };
}

function safeLogicalName(value) {
  const text = String(value || '').normalize('NFC').replace(/\\/g, '/').trim();
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text)) throw new Error('task-package-entry-name');
  const segments = text.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\0-\x1f\x7f<>:"|?*]/.test(segment) || segment.length > 240)) {
    throw new Error('task-package-entry-name');
  }
  if (text.length > 1000) throw new Error('task-package-entry-name');
  return text;
}

function normalizeLines(value, maxItems, itemLimit) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n/);
  return items
    .map((item) => cleanMultiline(item, itemLimit))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanMultiline(value, limit) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, limit);
}

function boundedObject(value, maxBytes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maxBytes) throw new Error('task-package-entry-metadata');
  return JSON.parse(encoded);
}

function deriveKey(unlockCode, salt) {
  return crypto.scryptSync(unlockCode, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
}

function lengthPrefixed(magic, value, limit) {
  if (!Buffer.isBuffer(value) || value.length > limit) throw new Error('task-package-prefix-size');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([magic, length, value]);
}

async function writeCipherChunk(handle, cipher, chunk) {
  if (!chunk || chunk.length === 0) return;
  await writeBuffer(handle, cipher.update(chunk));
}

async function writeBuffer(handle, buffer) {
  if (!buffer || buffer.length === 0) return;
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw new Error('task-package-write');
    offset += bytesWritten;
  }
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('task-package-truncated');
    offset += bytesRead;
  }
  return buffer;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_BYTES })) hash.update(chunk);
  return hash.digest('hex');
}

async function hashRange(handle, offset, size) {
  const hash = crypto.createHash('sha256');
  let remaining = size;
  let position = offset;
  while (remaining > 0) {
    const length = Math.min(STREAM_CHUNK_BYTES, remaining);
    const chunk = await readExact(handle, length, position);
    hash.update(chunk);
    remaining -= length;
    position += length;
  }
  return hash.digest('hex');
}

function replaceFile(source, destination) {
  try {
    fs.renameSync(source, destination);
  } catch (_error) {
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
  try { fs.chmodSync(destination, 0o600); } catch (_error) { /* Windows/best effort */ }
}

function parseJson(buffer, code) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (_error) {
    throw new Error(code);
  }
}

function enumValue(value, allowed, code) {
  const text = String(value || '');
  if (!allowed.has(text)) throw new Error(code);
  return text;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function requiredPath(value, field) {
  const text = String(value || '').trim();
  if (!text || !path.isAbsolute(text) || text.includes('\0')) throw new TypeError(`${field} is invalid`);
  return path.resolve(text);
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} is invalid`);
  return number;
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

module.exports = {
  TASK_PACKAGE_SCHEMA_VERSION,
  MAX_ENTRY_COUNT,
  MAX_ENTRY_BYTES,
  MAX_PACKAGE_BYTES,
  generateUnlockCode,
  normalizeUnlockCode,
  normalizeTaskPackageManifest,
  publicTaskPackageManifest,
  safeLogicalName,
  writeEncryptedTaskPackage,
  decryptTaskPackage,
  inspectPlainTaskArchive,
  extractTaskPackageEntry
};
