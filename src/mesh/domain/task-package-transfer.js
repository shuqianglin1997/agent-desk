const crypto = require('node:crypto');
const path = require('node:path');
const {
  MAX_PACKAGE_BYTES,
  normalizeUnlockCode
} = require('../../task-package/format');
const { canonicalEncode } = require('./identity-link');

const TASK_PACKAGE_TRANSFER_SCHEMA_VERSION = 1;
const TASK_PACKAGE_TRANSFER_TTL_MS = 24 * 60 * 60_000;
const TASK_PACKAGE_TRANSFER_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const TASK_PACKAGE_TRANSFER_FEATURE = 'task.package.transfer.v1';

const TASK_PACKAGE_UNLOCK_ENVELOPE_SCHEMA_VERSION = 1;
const TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM = 'x25519-hkdf-sha256-aes-256-gcm';
const TASK_PACKAGE_UNLOCK_ENVELOPE_INFO = Buffer.from(
  'agentdesk-task-package-unlock-envelope-v1',
  'utf8'
);
const UNLOCK_PLAINTEXT_BYTES = 65;
const X25519_PUBLIC_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const CURVE25519_PRIME = (1n << 255n) - 19n;

function createTaskPackageTransferManifest(input = {}, options = {}) {
  const now = normalizeIso(options.now || new Date().toISOString(), 'now');
  const createdAt = normalizeIso(input.createdAt || now, 'createdAt');
  const defaultExpiry = new Date(Date.parse(createdAt) + TASK_PACKAGE_TRANSFER_TTL_MS).toISOString();
  return normalizeTaskPackageTransferManifest({
    schemaVersion: TASK_PACKAGE_TRANSFER_SCHEMA_VERSION,
    kind: 'task-package',
    transferId: input.transferId,
    packageId: input.packageId,
    packageHash: input.packageHash,
    fileName: input.fileName,
    bytesTotal: input.bytesTotal,
    createdAt,
    expiresAt: input.expiresAt || defaultExpiry,
    summary: input.summary
  }, { now });
}

function normalizeTaskPackageTransferManifest(value = {}, options = {}) {
  if (value.schemaVersion !== TASK_PACKAGE_TRANSFER_SCHEMA_VERSION || value.kind !== 'task-package') {
    throw new Error('task-package-transfer-version');
  }
  const nowMs = normalizeNow(options.now);
  const createdAt = normalizeIso(value.createdAt, 'createdAt');
  const expiresAt = normalizeIso(value.expiresAt, 'expiresAt');
  const createdAtMs = Date.parse(createdAt);
  if (createdAtMs > nowMs + TASK_PACKAGE_TRANSFER_MAX_FUTURE_SKEW_MS) {
    throw new Error('task-package-transfer-future');
  }
  const lifetime = Date.parse(expiresAt) - createdAtMs;
  if (lifetime <= 0 || lifetime > TASK_PACKAGE_TRANSFER_TTL_MS) {
    throw new Error('task-package-transfer-expiry');
  }
  const bytesTotal = positiveInteger(value.bytesTotal, 'bytesTotal');
  if (bytesTotal > MAX_PACKAGE_BYTES + 2 * 1024 * 1024) {
    throw new Error('task-package-transfer-size');
  }
  const fileName = safeTaskPackageName(value.fileName);
  return {
    schemaVersion: TASK_PACKAGE_TRANSFER_SCHEMA_VERSION,
    kind: 'task-package',
    transferId: requiredText(value.transferId, 'transferId', 128),
    packageId: requiredText(value.packageId, 'packageId', 128),
    packageHash: sha256(value.packageHash, 'packageHash'),
    fileName,
    bytesTotal,
    createdAt,
    expiresAt,
    summary: normalizeSummary(value.summary)
  };
}

function sealTaskPackageUnlockCode(input = {}, context = {}) {
  const packageId = requiredText(input.packageId, 'packageId', 128);
  const packageHash = sha256(input.packageHash, 'packageHash');
  const unlockCode = normalizeUnlockCode(input.unlockCode);
  let sharedSecret;
  let key;
  let plaintext;
  let iv;
  try {
    const targetEdPublicKey = importEd25519PublicKey(context.targetDevicePublicKey);
    const metadata = unlockMetadata(context, packageId, packageHash, targetEdPublicKey);
    const authenticatedData = unlockAuthenticatedData(metadata);
    const ephemeral = crypto.generateKeyPairSync('x25519');
    const targetX25519PublicKey = ed25519PublicKeyToX25519(targetEdPublicKey);
    sharedSecret = crypto.diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: targetX25519PublicKey
    });
    key = deriveUnlockEnvelopeKey(sharedSecret, authenticatedData);
    plaintext = encodeUnlockCode(unlockCode);
    iv = crypto.randomBytes(AES_GCM_IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(authenticatedData);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const ephemeralPublicKey = exportX25519PublicRaw(ephemeral.publicKey);
    return {
      schemaVersion: TASK_PACKAGE_UNLOCK_ENVELOPE_SCHEMA_VERSION,
      algorithm: TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM,
      metadata,
      ephemeralPublicKey: ephemeralPublicKey.toString('base64url'),
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url')
    };
  } finally {
    if (plaintext) plaintext.fill(0);
    if (key) key.fill(0);
    if (sharedSecret) sharedSecret.fill(0);
    if (iv) iv.fill(0);
  }
}

function openTaskPackageUnlockCode(envelope, manifest, context = {}) {
  let sharedSecret;
  let key;
  let plaintext;
  try {
    const normalizedManifest = normalizeTaskPackageTransferManifest(manifest, { now: context.now });
    const normalizedEnvelope = normalizeUnlockEnvelope(envelope);
    const targetEdPrivateKey = importEd25519PrivateKey(
      context.targetDevicePrivateKey || context.devicePrivateKey
    );
    const targetEdPublicKey = crypto.createPublicKey(targetEdPrivateKey);
    const expectedMetadata = unlockMetadata(
      context,
      normalizedManifest.packageId,
      normalizedManifest.packageHash,
      targetEdPublicKey
    );
    if (canonicalEncode(normalizedEnvelope.metadata) !== canonicalEncode(expectedMetadata)) {
      throw new Error('metadata');
    }
    const authenticatedData = unlockAuthenticatedData(normalizedEnvelope.metadata);
    const targetX25519PrivateKey = ed25519PrivateKeyToX25519(targetEdPrivateKey);
    const ephemeralPublicKey = importX25519PublicRaw(normalizedEnvelope.ephemeralPublicKey);
    sharedSecret = crypto.diffieHellman({
      privateKey: targetX25519PrivateKey,
      publicKey: ephemeralPublicKey
    });
    key = deriveUnlockEnvelopeKey(sharedSecret, authenticatedData);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, normalizedEnvelope.iv);
    decipher.setAAD(authenticatedData);
    decipher.setAuthTag(normalizedEnvelope.tag);
    plaintext = Buffer.concat([
      decipher.update(normalizedEnvelope.ciphertext),
      decipher.final()
    ]);
    return decodeUnlockCode(plaintext);
  } catch (_error) {
    throw new Error('task-package-unlock-decrypt');
  } finally {
    if (plaintext) plaintext.fill(0);
    if (key) key.fill(0);
    if (sharedSecret) sharedSecret.fill(0);
  }
}

function unlockMetadata(context, packageId, packageHash, targetEdPublicKey) {
  return {
    meshId: requiredText(context.meshId, 'meshId', 128),
    transferId: requiredText(context.transferId, 'transferId', 128),
    sourceDeviceId: requiredText(context.sourceDeviceId, 'sourceDeviceId', 128),
    targetDeviceId: requiredText(context.targetDeviceId, 'targetDeviceId', 128),
    packageId,
    packageHash,
    targetKeyFingerprint: fingerprintEd25519PublicKey(targetEdPublicKey)
  };
}

function unlockAuthenticatedData(metadata) {
  return Buffer.from(canonicalEncode({
    schemaVersion: TASK_PACKAGE_UNLOCK_ENVELOPE_SCHEMA_VERSION,
    algorithm: TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM,
    metadata
  }), 'utf8');
}

function normalizeUnlockEnvelope(value) {
  exactObject(value, [
    'schemaVersion',
    'algorithm',
    'metadata',
    'ephemeralPublicKey',
    'iv',
    'ciphertext',
    'tag'
  ], 'task-package-unlock-envelope');
  if (value.schemaVersion !== TASK_PACKAGE_UNLOCK_ENVELOPE_SCHEMA_VERSION
    || value.algorithm !== TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM) {
    throw new Error('task-package-unlock-version');
  }
  exactObject(value.metadata, [
    'meshId',
    'transferId',
    'sourceDeviceId',
    'targetDeviceId',
    'packageId',
    'packageHash',
    'targetKeyFingerprint'
  ], 'task-package-unlock-metadata');
  const metadata = {
    meshId: requiredText(value.metadata.meshId, 'meshId', 128),
    transferId: requiredText(value.metadata.transferId, 'transferId', 128),
    sourceDeviceId: requiredText(value.metadata.sourceDeviceId, 'sourceDeviceId', 128),
    targetDeviceId: requiredText(value.metadata.targetDeviceId, 'targetDeviceId', 128),
    packageId: requiredText(value.metadata.packageId, 'packageId', 128),
    packageHash: sha256(value.metadata.packageHash, 'packageHash'),
    targetKeyFingerprint: sha256(value.metadata.targetKeyFingerprint, 'targetKeyFingerprint')
  };
  return {
    metadata,
    ephemeralPublicKey: decodeBase64Url(value.ephemeralPublicKey, X25519_PUBLIC_KEY_BYTES, 'ephemeralPublicKey'),
    iv: decodeBase64Url(value.iv, AES_GCM_IV_BYTES, 'iv'),
    ciphertext: decodeBase64Url(value.ciphertext, UNLOCK_PLAINTEXT_BYTES, 'ciphertext'),
    tag: decodeBase64Url(value.tag, AES_GCM_TAG_BYTES, 'tag')
  };
}

function encodeUnlockCode(unlockCode) {
  const code = Buffer.from(unlockCode, 'ascii');
  try {
    if (code.length < 16 || code.length > 64) throw new Error('task-package-unlock-code');
    const plaintext = crypto.randomBytes(UNLOCK_PLAINTEXT_BYTES);
    plaintext[0] = code.length;
    code.copy(plaintext, 1);
    return plaintext;
  } finally {
    code.fill(0);
  }
}

function decodeUnlockCode(plaintext) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length !== UNLOCK_PLAINTEXT_BYTES) {
    throw new Error('task-package-unlock-plaintext');
  }
  const length = plaintext[0];
  if (length < 16 || length > 64) throw new Error('task-package-unlock-plaintext');
  const raw = plaintext.subarray(1, 1 + length);
  const unlockCode = normalizeUnlockCode(raw.toString('ascii'));
  const normalized = Buffer.from(unlockCode, 'ascii');
  try {
    if (unlockCode.length !== length || !crypto.timingSafeEqual(raw, normalized)) {
      throw new Error('task-package-unlock-plaintext');
    }
    return unlockCode;
  } finally {
    normalized.fill(0);
  }
}

function deriveUnlockEnvelopeKey(sharedSecret, authenticatedData) {
  const salt = crypto.createHash('sha256').update(authenticatedData).digest();
  try {
    return Buffer.from(crypto.hkdfSync(
      'sha256',
      sharedSecret,
      salt,
      TASK_PACKAGE_UNLOCK_ENVELOPE_INFO,
      32
    ));
  } finally {
    salt.fill(0);
  }
}

function importEd25519PublicKey(value) {
  try {
    if (value?.type === 'private'
      || (typeof value === 'string' && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value))) {
      throw new Error('private-material');
    }
    const key = crypto.createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('type');
    assertPrefixedKey(
      key.export({ type: 'spki', format: 'der' }),
      ED25519_SPKI_PREFIX,
      32
    );
    return key;
  } catch (_error) {
    throw new Error('task-package-target-public-key');
  }
}

function importEd25519PrivateKey(value) {
  try {
    const key = crypto.createPrivateKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('type');
    const der = key.export({ type: 'pkcs8', format: 'der' });
    try {
      assertPrefixedKey(der, ED25519_PKCS8_PREFIX, 32);
    } finally {
      der.fill(0);
    }
    return key;
  } catch (_error) {
    throw new Error('task-package-target-private-key');
  }
}

function ed25519PublicKeyToX25519(ed25519PublicKey) {
  const der = ed25519PublicKey.export({ type: 'spki', format: 'der' });
  const raw = assertPrefixedKey(der, ED25519_SPKI_PREFIX, 32);
  const yBytes = Buffer.from(raw);
  yBytes[31] &= 0x7f;
  const y = littleEndianToBigInt(yBytes);
  if (y >= CURVE25519_PRIME) throw new Error('task-package-target-public-key');
  const denominator = modCurve25519(1n - y);
  if (denominator === 0n) throw new Error('task-package-target-public-key');
  const u = modCurve25519((1n + y) * modInverseCurve25519(denominator));
  const x25519Raw = bigIntToLittleEndian(u);
  try {
    return importX25519PublicRaw(x25519Raw);
  } finally {
    yBytes.fill(0);
    x25519Raw.fill(0);
  }
}

function ed25519PrivateKeyToX25519(ed25519PrivateKey) {
  const der = ed25519PrivateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = Buffer.from(assertPrefixedKey(der, ED25519_PKCS8_PREFIX, 32));
  const digest = crypto.createHash('sha512').update(seed).digest();
  const scalar = Buffer.from(digest.subarray(0, 32));
  let x25519Der;
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  try {
    x25519Der = Buffer.concat([X25519_PKCS8_PREFIX, scalar]);
    return crypto.createPrivateKey({
      key: x25519Der,
      type: 'pkcs8',
      format: 'der'
    });
  } finally {
    if (x25519Der) x25519Der.fill(0);
    scalar.fill(0);
    digest.fill(0);
    seed.fill(0);
    der.fill(0);
  }
}

function fingerprintEd25519PublicKey(value) {
  const key = value?.asymmetricKeyType === 'ed25519' ? value : importEd25519PublicKey(value);
  const der = key.export({ type: 'spki', format: 'der' });
  assertPrefixedKey(der, ED25519_SPKI_PREFIX, 32);
  return crypto.createHash('sha256').update(der).digest('hex');
}

function exportX25519PublicRaw(key) {
  if (!key || key.asymmetricKeyType !== 'x25519') throw new Error('task-package-ephemeral-key');
  const der = key.export({ type: 'spki', format: 'der' });
  return Buffer.from(assertPrefixedKey(der, X25519_SPKI_PREFIX, X25519_PUBLIC_KEY_BYTES));
}

function importX25519PublicRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== X25519_PUBLIC_KEY_BYTES) {
    throw new Error('task-package-ephemeral-key');
  }
  const key = crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    type: 'spki',
    format: 'der'
  });
  if (key.asymmetricKeyType !== 'x25519') throw new Error('task-package-ephemeral-key');
  return key;
}

function assertPrefixedKey(der, prefix, rawBytes) {
  if (!Buffer.isBuffer(der)
    || der.length !== prefix.length + rawBytes
    || !der.subarray(0, prefix.length).equals(prefix)) {
    throw new Error('task-package-key-encoding');
  }
  return der.subarray(prefix.length);
}

function littleEndianToBigInt(buffer) {
  let value = 0n;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(buffer[index]);
  }
  return value;
}

function bigIntToLittleEndian(value) {
  const buffer = Buffer.alloc(32);
  let remaining = value;
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('task-package-key-encoding');
  return buffer;
}

function modCurve25519(value) {
  const normalized = value % CURVE25519_PRIME;
  return normalized < 0n ? normalized + CURVE25519_PRIME : normalized;
}

function modInverseCurve25519(value) {
  let base = modCurve25519(value);
  let exponent = CURVE25519_PRIME - 2n;
  let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = modCurve25519(result * base);
    base = modCurve25519(base * base);
    exponent >>= 1n;
  }
  return result;
}

function decodeBase64Url(value, expectedBytes, field) {
  const text = String(value || '');
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`${field} is invalid`);
  const decoded = Buffer.from(text, 'base64url');
  if (decoded.length !== expectedBytes || decoded.toString('base64url') !== text) {
    throw new Error(`${field} is invalid`);
  }
  return decoded;
}

function exactObject(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(error);
  }
}

function safeTaskPackageName(value) {
  const base = path.basename(String(value || 'task.agentdesk-task')).normalize('NFC')
    .replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  const name = (base || 'task.agentdesk-task').slice(0, 180);
  return name.toLowerCase().endsWith('.agentdesk-task') ? name : `${name}.agentdesk-task`;
}

function normalizeSummary(value) {
  const summary = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    title: cleanText(summary.title, 240) || null,
    appId: cleanText(summary.appId, 80) || null,
    sourceAgentName: cleanText(summary.sourceAgentName, 120) || null,
    senderLabel: cleanText(summary.senderLabel, 120) || null,
    objective: cleanText(summary.objective, 1000) || null,
    sessionMode: enumValue(summary.sessionMode, new Set(['native', 'transcript']), 'task-package-session-mode'),
    attachmentCount: boundedInteger(summary.attachmentCount, 0, 32, 'attachmentCount')
  };
}

function sha256(value, field) {
  const text = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw new TypeError(`${field} is invalid`);
  return text;
}

function enumValue(value, allowed, error) {
  const text = String(value || '');
  if (!allowed.has(text)) throw new Error(error);
  return text;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text || text.length > limit) throw new TypeError(`${field} is invalid`);
  return text;
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} is invalid`);
  return number;
}

function boundedInteger(value, min, max, field) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${field} is invalid`);
  }
  return number;
}

function normalizeNow(value) {
  if (value === undefined || value === null || value === '') return Date.now();
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError('now is invalid');
  return time;
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

module.exports = {
  TASK_PACKAGE_TRANSFER_SCHEMA_VERSION,
  TASK_PACKAGE_TRANSFER_TTL_MS,
  TASK_PACKAGE_TRANSFER_MAX_FUTURE_SKEW_MS,
  TASK_PACKAGE_TRANSFER_FEATURE,
  TASK_PACKAGE_UNLOCK_ENVELOPE_SCHEMA_VERSION,
  TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM,
  createTaskPackageTransferManifest,
  normalizeTaskPackageTransferManifest,
  sealTaskPackageUnlockCode,
  openTaskPackageUnlockCode,
  safeTaskPackageName
};
