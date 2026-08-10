const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');

const ENVELOPE_SCHEMA_VERSION = 1;
const MAX_ENVELOPE_BYTES = 512 * 1024;
const MAX_TTL_MS = 5 * 60_000;

function createEnvelope(input, privateKey, options = {}) {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError('envelope now is invalid');
  const ttlMs = clampInteger(options.ttlMs, 5_000, MAX_TTL_MS, 60_000);
  const payload = {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    protocolVersion: requiredText(input.protocolVersion || '1.0', 'protocolVersion', 20),
    messageType: requiredText(input.messageType, 'messageType', 80),
    messageId: requiredText(input.messageId || crypto.randomUUID(), 'messageId', 128),
    connectionId: requiredText(input.connectionId, 'connectionId', 128),
    sourceDeviceId: requiredText(input.sourceDeviceId, 'sourceDeviceId', 128),
    targetDeviceId: requiredText(input.targetDeviceId, 'targetDeviceId', 128),
    sequence: positiveInteger(input.sequence, 'sequence'),
    sentAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    capability: requiredText(input.capability, 'capability', 80),
    payload: safePayload(input.payload)
  };
  assertSize(payload);
  return {
    ...payload,
    signature: crypto.sign(null, Buffer.from(canonicalEncode(payload)), privateKey).toString('base64')
  };
}

function verifyEnvelope(envelope, publicKey, expected = {}, options = {}) {
  try {
    const payload = envelopePayload(envelope);
    if (payload.schemaVersion !== ENVELOPE_SCHEMA_VERSION) return failure('envelope-version');
    assertSize(payload);
    for (const field of ['messageType', 'connectionId', 'sourceDeviceId', 'targetDeviceId', 'capability']) {
      if (expected[field] && payload[field] !== expected[field]) return failure(`envelope-${field}-mismatch`);
    }
    const nowMs = options.now ? Date.parse(options.now) : Date.now();
    const sentAt = Date.parse(payload.sentAt);
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(sentAt) || !Number.isFinite(expiresAt)) {
      return failure('envelope-time');
    }
    if (sentAt > nowMs + 5 * 60_000 || expiresAt < nowMs || expiresAt <= sentAt || expiresAt - sentAt > MAX_TTL_MS) {
      return failure('envelope-expired');
    }
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) return failure('envelope-sequence');
    const signature = typeof envelope.signature === 'string' ? Buffer.from(envelope.signature, 'base64') : null;
    if (!signature?.length || !crypto.verify(null, Buffer.from(canonicalEncode(payload)), publicKey, signature)) {
      return failure('envelope-signature');
    }
    if (options.sequenceGuard) {
      const accepted = options.sequenceGuard.accept(payload.sourceDeviceId, payload.connectionId, payload.sequence);
      if (!accepted) return failure('envelope-replay');
    }
    return { ok: true, payload };
  } catch (_error) {
    return failure('envelope-invalid');
  }
}

class SequenceGuard {
  constructor(limit = 1024) {
    this.limit = clampInteger(limit, 16, 10_000, 1024);
    this.entries = new Map();
  }

  accept(sourceDeviceId, connectionId, sequence) {
    const key = `${String(sourceDeviceId)}:${String(connectionId)}`;
    const previous = this.entries.get(key) || 0;
    if (!Number.isSafeInteger(sequence) || sequence <= previous) return false;
    this.entries.delete(key);
    this.entries.set(key, sequence);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    return true;
  }

  clearConnection(connectionId) {
    const suffix = `:${String(connectionId)}`;
    for (const key of this.entries.keys()) if (key.endsWith(suffix)) this.entries.delete(key);
  }
}

function envelopePayload(value = {}) {
  return {
    schemaVersion: value.schemaVersion,
    protocolVersion: value.protocolVersion,
    messageType: value.messageType,
    messageId: value.messageId,
    connectionId: value.connectionId,
    sourceDeviceId: value.sourceDeviceId,
    targetDeviceId: value.targetDeviceId,
    sequence: value.sequence,
    sentAt: value.sentAt,
    expiresAt: value.expiresAt,
    capability: value.capability,
    payload: value.payload
  };
}

function safePayload(value) {
  if (value === undefined) return null;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('payload is not serializable');
  return JSON.parse(encoded);
}

function assertSize(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_ENVELOPE_BYTES) throw new RangeError('envelope-too-large');
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} must be a positive integer`);
  return number;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  ENVELOPE_SCHEMA_VERSION,
  MAX_ENVELOPE_BYTES,
  SequenceGuard,
  createEnvelope,
  verifyEnvelope,
  envelopePayload
};
