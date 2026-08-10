const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');

const SECURE_PAYLOAD_SCHEMA_VERSION = 1;
const MAX_SECURE_PAYLOAD_BYTES = 16 * 1024 * 1024;

function encryptSecurePayload(value, context = {}) {
  const metadata = normalizeMetadata(context);
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > MAX_SECURE_PAYLOAD_BYTES) throw new Error('secure-payload-too-large');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(context, metadata), iv);
  cipher.setAAD(Buffer.from(canonicalEncode(metadata)));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    schemaVersion: SECURE_PAYLOAD_SCHEMA_VERSION,
    metadata,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

function decryptSecurePayload(value = {}, context = {}) {
  try {
    if (value.schemaVersion !== SECURE_PAYLOAD_SCHEMA_VERSION) throw new Error('version');
    const metadata = normalizeMetadata(value.metadata);
    const expected = normalizeMetadata(context);
    if (canonicalEncode(metadata) !== canonicalEncode(expected)) throw new Error('metadata');
    const ciphertext = Buffer.from(String(value.ciphertext || ''), 'base64url');
    if (ciphertext.length > MAX_SECURE_PAYLOAD_BYTES) throw new Error('size');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(context, metadata), Buffer.from(value.iv, 'base64url'));
    decipher.setAAD(Buffer.from(canonicalEncode(metadata)));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (_error) {
    throw new Error('secure-payload-decrypt');
  }
}

function deriveKey(context, metadata) {
  const source = Buffer.isBuffer(context.linkKey)
    ? context.linkKey
    : Buffer.from(String(context.linkKey || ''), 'base64');
  if (source.length < 16) throw new Error('secure-payload-key');
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    source,
    Buffer.from(metadata.meshId),
    Buffer.from(`agentdesk-transfer-v1:${metadata.targetDeviceId}`),
    32
  ));
}

function normalizeMetadata(value = {}) {
  return {
    meshId: requiredText(value.meshId, 'meshId', 128),
    transferId: requiredText(value.transferId, 'transferId', 128),
    type: requiredText(value.type, 'type', 80),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'sourceDeviceId', 128),
    targetDeviceId: requiredText(value.targetDeviceId, 'targetDeviceId', 128)
  };
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

module.exports = {
  SECURE_PAYLOAD_SCHEMA_VERSION,
  MAX_SECURE_PAYLOAD_BYTES,
  encryptSecurePayload,
  decryptSecurePayload,
  normalizeMetadata
};
