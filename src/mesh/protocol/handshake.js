const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');

const CERTIFICATE_SCHEMA_VERSION = 1;
const PROOF_SCHEMA_VERSION = 1;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function createMembershipCertificate(input, rootPrivateKey, options = {}) {
  const now = options.now || new Date().toISOString();
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const payload = {
    schemaVersion: CERTIFICATE_SCHEMA_VERSION,
    serial: input.serial || randomUUID(),
    meshId: requiredText(input.meshId, 'meshId'),
    deviceId: requiredText(input.deviceId, 'deviceId'),
    devicePublicKey: requiredText(input.devicePublicKey, 'devicePublicKey'),
    roles: uniqueStrings(input.roles || ['controller']),
    issuerDeviceId: input.issuerDeviceId ? requiredText(input.issuerDeviceId, 'issuerDeviceId') : null,
    issuerCertificateDigest: input.issuerCertificateDigest
      ? requiredText(input.issuerCertificateDigest, 'issuerCertificateDigest')
      : null,
    issuedAt: normalizeIso(input.issuedAt || now, 'issuedAt'),
    revokedAt: null
  };
  return {
    ...payload,
    signature: signPayload(payload, rootPrivateKey)
  };
}

function createDelegatedMembershipCertificate(input, issuerCertificate, issuerPrivateKey, options = {}) {
  const issuer = membershipPayload(issuerCertificate);
  if (!issuer.deviceId || !Array.isArray(issuer.roles) || !issuer.roles.includes('device.admin')) {
    throw new TypeError('issuer certificate requires device.admin');
  }
  if (String(input.meshId || '') !== issuer.meshId) throw new TypeError('delegated certificate mesh mismatch');
  return createMembershipCertificate({
    ...input,
    issuerDeviceId: issuer.deviceId,
    issuerCertificateDigest: certificateDigest(issuerCertificate)
  }, issuerPrivateKey, options);
}

function verifyMembershipCertificate(certificate, rootPublicKey, options = {}) {
  try {
    const payload = membershipPayload(certificate);
    if (payload.schemaVersion !== CERTIFICATE_SCHEMA_VERSION) return failure('certificate-version');
    if (!payload.meshId || !payload.deviceId || !payload.devicePublicKey) return failure('certificate-fields');
    if (!Array.isArray(payload.roles) || !payload.roles.length) return failure('certificate-roles');
    if (payload.revokedAt) return failure('certificate-revoked');
    const now = options.now ? Date.parse(options.now) : Date.now();
    const issuedAt = Date.parse(payload.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt > now + MAX_CLOCK_SKEW_MS) return failure('certificate-time');
    if (payload.issuerDeviceId || payload.issuerCertificateDigest) {
      return failure('certificate-delegated-requires-chain');
    }
    if (!verifyRootCertificateSignature(certificate, payload, rootPublicKey)) return failure('certificate-signature');
    return { ok: true, payload };
  } catch (_error) {
    return failure('certificate-invalid');
  }
}

function verifyMembershipChain(certificate, chain, rootPublicKey, options = {}) {
  try {
    const certificates = Array.isArray(chain) ? chain.filter(Boolean) : [];
    const seen = new Set();
    const verifyAt = (current, depth) => {
      if (depth > 8) return failure('certificate-chain-too-deep');
      const payload = membershipPayload(current);
      const digest = certificateDigest(current);
      if (seen.has(digest)) return failure('certificate-chain-cycle');
      seen.add(digest);
      const timeCheck = validateCertificatePayload(payload, options);
      if (!timeCheck.ok) return timeCheck;

      if (!payload.issuerDeviceId && !payload.issuerCertificateDigest) {
        if (!verifyRootCertificateSignature(current, payload, rootPublicKey)) return failure('certificate-signature');
        return { ok: true, payload, depth };
      }
      if (!payload.issuerDeviceId || !payload.issuerCertificateDigest) {
        return failure('certificate-issuer-fields');
      }
      const issuer = certificates.find((candidate) => (
        candidate?.deviceId === payload.issuerDeviceId
        && certificateDigest(candidate) === payload.issuerCertificateDigest
      ));
      if (!issuer) return failure('certificate-issuer-missing');
      const verifiedIssuer = verifyAt(issuer, depth + 1);
      if (!verifiedIssuer.ok) return verifiedIssuer;
      if (verifiedIssuer.payload.meshId !== payload.meshId) return failure('certificate-chain-mesh');
      if (!verifiedIssuer.payload.roles.includes('device.admin')) return failure('certificate-issuer-not-admin');
      if (!verifyPayload(payload, current.signature, verifiedIssuer.payload.devicePublicKey)) {
        return failure('certificate-signature');
      }
      return { ok: true, payload, depth };
    };
    return verifyAt(certificate, 0);
  } catch (_error) {
    return failure('certificate-chain-invalid');
  }
}

function validateCertificatePayload(payload, options = {}) {
  if (payload.schemaVersion !== CERTIFICATE_SCHEMA_VERSION) return failure('certificate-version');
  if (!payload.meshId || !payload.deviceId || !payload.devicePublicKey) return failure('certificate-fields');
  if (!Array.isArray(payload.roles) || !payload.roles.length) return failure('certificate-roles');
  if (payload.revokedAt) return failure('certificate-revoked');
  const now = options.now ? Date.parse(options.now) : Date.now();
  const issuedAt = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now + MAX_CLOCK_SKEW_MS) return failure('certificate-time');
  return { ok: true };
}

function createDeviceProof(input, devicePrivateKey, options = {}) {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(5_000, Math.min(options.ttlMs, 5 * 60_000)) : 60_000;
  const payload = {
    schemaVersion: PROOF_SCHEMA_VERSION,
    meshId: requiredText(input.meshId, 'meshId'),
    connectionId: requiredText(input.connectionId, 'connectionId'),
    sourceDeviceId: requiredText(input.sourceDeviceId, 'sourceDeviceId'),
    targetDeviceId: requiredText(input.targetDeviceId, 'targetDeviceId'),
    challenge: requiredText(input.challenge, 'challenge'),
    membershipDigest: certificateDigest(input.membershipCertificate),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
  return { ...payload, signature: signPayload(payload, devicePrivateKey) };
}

function verifyDeviceProof(proof, membershipCertificate, rootPublicKey, expected = {}, options = {}) {
  const cert = Array.isArray(options.membershipChain)
    ? verifyMembershipChain(membershipCertificate, options.membershipChain, rootPublicKey, options)
    : verifyMembershipCertificate(membershipCertificate, rootPublicKey, options);
  if (!cert.ok) return cert;
  try {
    const payload = proofPayload(proof);
    if (payload.schemaVersion !== PROOF_SCHEMA_VERSION) return failure('proof-version');
    if (payload.meshId !== cert.payload.meshId || payload.sourceDeviceId !== cert.payload.deviceId) {
      return failure('proof-member-mismatch');
    }
    if (payload.membershipDigest !== certificateDigest(membershipCertificate)) return failure('proof-certificate-mismatch');
    for (const field of ['meshId', 'connectionId', 'sourceDeviceId', 'targetDeviceId', 'challenge']) {
      if (expected[field] && payload[field] !== expected[field]) return failure(`proof-${field}-mismatch`);
    }
    const now = options.now ? Date.parse(options.now) : Date.now();
    const issuedAt = Date.parse(payload.issuedAt);
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return failure('proof-time');
    if (issuedAt > now + MAX_CLOCK_SKEW_MS || expiresAt < now || expiresAt <= issuedAt) return failure('proof-expired');
    if (!verifyPayload(payload, proof.signature, cert.payload.devicePublicKey)) return failure('proof-signature');
    return { ok: true, payload, membership: cert.payload };
  } catch (_error) {
    return failure('proof-invalid');
  }
}

function membershipPayload(certificate = {}) {
  return {
    schemaVersion: certificate.schemaVersion,
    serial: certificate.serial,
    meshId: certificate.meshId,
    deviceId: certificate.deviceId,
    devicePublicKey: certificate.devicePublicKey,
    roles: certificate.roles,
    issuerDeviceId: certificate.issuerDeviceId || null,
    issuerCertificateDigest: certificate.issuerCertificateDigest || null,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt || null
  };
}

function proofPayload(proof = {}) {
  return {
    schemaVersion: proof.schemaVersion,
    meshId: proof.meshId,
    connectionId: proof.connectionId,
    sourceDeviceId: proof.sourceDeviceId,
    targetDeviceId: proof.targetDeviceId,
    challenge: proof.challenge,
    membershipDigest: proof.membershipDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt
  };
}

function verifyRootCertificateSignature(certificate, payload, rootPublicKey) {
  if (verifyPayload(payload, certificate.signature, rootPublicKey)) return true;
  const hasIssuerFields = Object.prototype.hasOwnProperty.call(certificate, 'issuerDeviceId')
    || Object.prototype.hasOwnProperty.call(certificate, 'issuerCertificateDigest');
  if (hasIssuerFields) return false;
  const legacy = { ...payload };
  delete legacy.issuerDeviceId;
  delete legacy.issuerCertificateDigest;
  return verifyPayload(legacy, certificate.signature, rootPublicKey);
}

function certificateDigest(certificate) {
  return crypto.createHash('sha256').update(canonicalEncode(certificate)).digest('hex');
}

function signPayload(payload, privateKey) {
  return crypto.sign(null, Buffer.from(canonicalEncode(payload)), privateKey).toString('base64');
}

function verifyPayload(payload, signature, publicKey) {
  if (typeof signature !== 'string' || !signature) return false;
  return crypto.verify(
    null,
    Buffer.from(canonicalEncode(payload)),
    publicKey,
    Buffer.from(signature, 'base64')
  );
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  CERTIFICATE_SCHEMA_VERSION,
  PROOF_SCHEMA_VERSION,
  createMembershipCertificate,
  createDelegatedMembershipCertificate,
  verifyMembershipCertificate,
  verifyMembershipChain,
  createDeviceProof,
  verifyDeviceProof,
  certificateDigest
};
