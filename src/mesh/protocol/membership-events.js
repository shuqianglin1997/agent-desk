const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');
const { certificateDigest, verifyMembershipChain } = require('./handshake');

const MEMBERSHIP_EVENT_SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set(['device.joined', 'device.permissions', 'device.revoked']);

function createMembershipEvent(input, signer, options = {}) {
  const eventType = String(input.eventType || '').trim();
  if (!EVENT_TYPES.has(eventType)) throw new TypeError('membership-event-type');
  const payload = {
    schemaVersion: MEMBERSHIP_EVENT_SCHEMA_VERSION,
    eventId: String(input.eventId || (options.randomUUID ? options.randomUUID() : crypto.randomUUID())),
    sequence: positiveInteger(input.sequence, 'sequence'),
    meshId: requiredText(input.meshId, 'meshId'),
    eventType,
    subjectDeviceId: requiredText(input.subjectDeviceId, 'subjectDeviceId'),
    sourceDeviceId: requiredText(input.sourceDeviceId, 'sourceDeviceId'),
    permissions: normalizeStrings(input.permissions),
    reason: cleanText(input.reason, 160) || null,
    createdAt: normalizeIso(input.createdAt || options.now || new Date().toISOString()),
    signerCertificateDigest: certificateDigest(signer.membershipCertificate)
  };
  return {
    ...payload,
    signerCertificate: signer.membershipCertificate,
    signerCertificateChain: Array.isArray(signer.membershipChain) ? signer.membershipChain : [],
    signature: crypto.sign(null, Buffer.from(canonicalEncode(payload)), signer.devicePrivateKey).toString('base64')
  };
}

function verifyMembershipEvent(event, rootPublicKey, options = {}) {
  try {
    const payload = eventPayload(event);
    if (payload.schemaVersion !== MEMBERSHIP_EVENT_SCHEMA_VERSION) return failure('membership-event-version');
    if (!EVENT_TYPES.has(payload.eventType)) return failure('membership-event-type');
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) return failure('membership-event-sequence');
    const certificate = verifyMembershipChain(
      event.signerCertificate,
      event.signerCertificateChain,
      rootPublicKey,
      options
    );
    if (!certificate.ok) return certificate;
    if (certificate.payload.meshId !== payload.meshId || certificate.payload.deviceId !== payload.sourceDeviceId) {
      return failure('membership-event-signer');
    }
    if (!certificate.payload.roles.includes('device.admin')) return failure('membership-event-not-admin');
    if (payload.signerCertificateDigest !== certificateDigest(event.signerCertificate)) {
      return failure('membership-event-certificate');
    }
    const signature = Buffer.from(String(event.signature || ''), 'base64');
    if (!signature.length || !crypto.verify(
      null,
      Buffer.from(canonicalEncode(payload)),
      certificate.payload.devicePublicKey,
      signature
    )) return failure('membership-event-signature');
    const now = options.now ? Date.parse(options.now) : Date.now();
    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > now + 5 * 60_000) return failure('membership-event-time');
    return { ok: true, payload, signer: certificate.payload };
  } catch (_error) {
    return failure('membership-event-invalid');
  }
}

function eventPayload(value = {}) {
  return {
    schemaVersion: value.schemaVersion,
    eventId: value.eventId,
    sequence: value.sequence,
    meshId: value.meshId,
    eventType: value.eventType,
    subjectDeviceId: value.subjectDeviceId,
    sourceDeviceId: value.sourceDeviceId,
    permissions: value.permissions,
    reason: value.reason || null,
    createdAt: value.createdAt,
    signerCertificateDigest: value.signerCertificateDigest
  };
}

function normalizeStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))].sort();
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function normalizeIso(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError('membership event time');
  return new Date(time).toISOString();
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} must be positive`);
  return number;
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  MEMBERSHIP_EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  createMembershipEvent,
  verifyMembershipEvent,
  eventPayload
};
