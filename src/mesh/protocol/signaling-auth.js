const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');

const SIGNALING_SCHEMA_VERSION = 1;
const MAX_REQUEST_TTL_MS = 60_000;
const ALLOWED_OPERATIONS = new Set([
  'lease',
  'poll',
  'signal.send',
  'pair.claim',
  'pair.respond',
  'turn.credentials'
]);

function createSignalingRequest(operation, fields, privateKey, options = {}) {
  if (!ALLOWED_OPERATIONS.has(operation)) throw new Error('signaling-operation-invalid');
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error('signaling-time-invalid');
  const ttlMs = clampInteger(options.ttlMs, 5_000, MAX_REQUEST_TTL_MS, 30_000);
  const request = {
    ...(fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}),
    schemaVersion: SIGNALING_SCHEMA_VERSION,
    operation,
    requestId: cleanIdentifier(options.requestId || crypto.randomUUID(), 'requestId'),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    nonce: cleanIdentifier(options.nonce || crypto.randomBytes(18).toString('base64url'), 'nonce')
  };
  delete request.signature;
  return {
    ...request,
    signature: crypto.sign(null, Buffer.from(canonicalEncode(request)), privateKey).toString('base64')
  };
}

function verifySignalingRequest(request, publicKey, options = {}) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('signaling-request-invalid');
    if (request.schemaVersion !== SIGNALING_SCHEMA_VERSION) return failure('signaling-version');
    if (!ALLOWED_OPERATIONS.has(request.operation)) return failure('signaling-operation-invalid');
    if (options.operation && request.operation !== options.operation) return failure('signaling-operation-mismatch');
    cleanIdentifier(request.requestId, 'requestId');
    cleanIdentifier(request.nonce, 'nonce');
    const nowMs = options.now ? Date.parse(options.now) : Date.now();
    const issuedAt = Date.parse(request.issuedAt);
    const expiresAt = Date.parse(request.expiresAt);
    if (![nowMs, issuedAt, expiresAt].every(Number.isFinite)) return failure('signaling-time-invalid');
    if (issuedAt > nowMs + 30_000) return failure('signaling-issued-in-future');
    if (expiresAt < nowMs) return failure('signaling-request-expired');
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_REQUEST_TTL_MS) return failure('signaling-request-ttl');
    const signature = Buffer.from(String(request.signature || ''), 'base64');
    if (!signature.length) return failure('signaling-signature');
    if (!crypto.verify(null, Buffer.from(canonicalEncode(signedPayload(request))), publicKey, signature)) {
      return failure('signaling-signature');
    }
    return { ok: true, payload: signedPayload(request) };
  } catch (_error) {
    return failure('signaling-request-invalid');
  }
}

function signedPayload(value = {}) {
  const payload = { ...value };
  delete payload.signature;
  return payload;
}

function normalizeServiceUrls(value, options = {}) {
  const allowInsecure = options.allowInsecure === true;
  const result = [];
  for (const item of Array.isArray(value) ? value : String(value || '').split(',')) {
    try {
      const url = new URL(String(item || '').trim());
      if (url.username || url.password || url.search || url.hash) continue;
      if (url.pathname !== '/' && url.pathname !== '') continue;
      const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || allowInsecure))) continue;
      if (!result.includes(url.origin)) result.push(url.origin);
    } catch (_error) {
      // Invalid user or deployment configuration is ignored and surfaced by diagnostics.
    }
  }
  return result.slice(0, 4);
}

function cleanIdentifier(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 160 || !/^[a-z0-9._:-]+$/i.test(text)) {
    throw new TypeError(`${field} is invalid`);
  }
  return text;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  SIGNALING_SCHEMA_VERSION,
  MAX_REQUEST_TTL_MS,
  ALLOWED_OPERATIONS,
  createSignalingRequest,
  verifySignalingRequest,
  signedPayload,
  normalizeServiceUrls
};
