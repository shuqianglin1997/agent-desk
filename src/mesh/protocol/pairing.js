const crypto = require('node:crypto');
const { canonicalEncode } = require('../domain/identity-link');
const {
  certificateDigest,
  createDelegatedMembershipCertificate,
  verifyMembershipChain
} = require('./handshake');
const { normalizeServiceUrls } = require('./signaling-auth');

const PAIRING_SCHEMA_VERSION = 1;
const INVITE_PREFIX = 'AD1.';
const MAX_INVITE_TTL_MS = 10 * 60_000;
const JOIN_REQUEST_KEYS = new Set([
  'schemaVersion',
  'inviteId',
  'meshId',
  'deviceId',
  'devicePublicKey',
  'name',
  'platform',
  'arch',
  'osVersion',
  'appVersion',
  'protocolVersion',
  'endpoints',
  'signalUrls',
  'exchangePublicKey',
  'nonce',
  'secretProof'
]);

function createPairingInvite(input, identity, options = {}) {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const ttlMs = clampInteger(options.ttlMs, 30_000, MAX_INVITE_TTL_MS, 5 * 60_000);
  const exchange = crypto.generateKeyPairSync('x25519');
  const secret = crypto.randomBytes(32).toString('base64url');
  const payload = {
    schemaVersion: PAIRING_SCHEMA_VERSION,
    inviteId: options.randomUUID ? options.randomUUID() : crypto.randomUUID(),
    meshId: requiredText(input.meshId, 'meshId'),
    rootPublicKey: requiredText(input.rootPublicKey, 'rootPublicKey'),
    sourceDeviceId: requiredText(input.sourceDeviceId, 'sourceDeviceId'),
    sourceDeviceName: cleanText(input.sourceDeviceName, 'AgentDesk device', 80),
    sourcePlatform: cleanText(input.sourcePlatform, 'unknown', 32),
    sourceArch: cleanText(input.sourceArch, 'unknown', 32),
    sourceOsVersion: cleanText(input.sourceOsVersion, 'unknown', 120),
    sourceAppVersion: cleanText(input.sourceAppVersion, 'unknown', 40),
    sourceCertificate: input.sourceCertificate,
    sourceCertificateChain: Array.isArray(input.sourceCertificateChain) ? input.sourceCertificateChain : [],
    exchangePublicKey: exportPublicKey(exchange.publicKey),
    endpoints: normalizeEndpoints(input.endpoints),
    signalUrls: normalizeServiceUrls(input.signalUrls, { allowInsecure: true }),
    secret,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
  const verified = verifyMembershipChain(
    payload.sourceCertificate,
    payload.sourceCertificateChain,
    payload.rootPublicKey,
    { now: payload.issuedAt }
  );
  if (!verified.ok || verified.payload.deviceId !== payload.sourceDeviceId || !verified.payload.roles.includes('device.admin')) {
    throw new Error('pairing-inviter-not-admin');
  }
  const signed = { ...payload, signature: sign(inviteSignedPayload(payload), identity.devicePrivateKey) };
  return {
    invite: signed,
    code: encodeInvitation(signed),
    shortCode: shortCode(secret),
    privateState: {
      exchangePrivateKey: exchange.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      secretDigest: sha256(secret),
      consumed: false
    }
  };
}

function decodeInvitation(code, options = {}) {
  const text = String(code || '').trim();
  if (!text.startsWith(INVITE_PREFIX)) throw new Error('pairing-code-invalid');
  let invite;
  try {
    invite = JSON.parse(Buffer.from(text.slice(INVITE_PREFIX.length), 'base64url').toString('utf8'));
  } catch (_error) {
    throw new Error('pairing-code-invalid');
  }
  const valid = verifyInvite(invite, options);
  if (!valid.ok) throw new Error(valid.reason);
  return invite;
}

function inspectInvitation(code, options = {}) {
  const invite = decodeInvitation(code, options);
  const verified = verifyMembershipChain(
    invite.sourceCertificate,
    invite.sourceCertificateChain,
    invite.rootPublicKey,
    options
  );
  if (!verified.ok) throw new Error(verified.reason);
  return {
    inviteId: invite.inviteId,
    sourceDeviceId: invite.sourceDeviceId,
    sourceDeviceName: invite.sourceDeviceName,
    sourceFingerprint: publicKeyFingerprint(verified.payload.devicePublicKey),
    platform: invite.sourcePlatform || null,
    arch: invite.sourceArch || null,
    osVersion: invite.sourceOsVersion || null,
    appVersion: invite.sourceAppVersion || null,
    expiresAt: invite.expiresAt
  };
}

function verifyInvite(invite, options = {}) {
  try {
    if (invite?.schemaVersion !== PAIRING_SCHEMA_VERSION) return failure('pairing-version');
    const nowMs = options.now ? Date.parse(options.now) : Date.now();
    const issuedAt = Date.parse(invite.issuedAt);
    const expiresAt = Date.parse(invite.expiresAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return failure('pairing-time');
    if (expiresAt < nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_INVITE_TTL_MS) {
      return failure('pairing-expired');
    }
    const cert = verifyMembershipChain(invite.sourceCertificate, invite.sourceCertificateChain, invite.rootPublicKey, options);
    if (!cert.ok) return cert;
    if (cert.payload.meshId !== invite.meshId || cert.payload.deviceId !== invite.sourceDeviceId) {
      return failure('pairing-member-mismatch');
    }
    if (!cert.payload.roles.includes('device.admin')) return failure('pairing-inviter-not-admin');
    if (!verify(inviteSignedPayload(invite), invite.signature, cert.payload.devicePublicKey)) {
      return failure('pairing-signature');
    }
    return { ok: true, membership: cert.payload };
  } catch (_error) {
    return failure('pairing-invalid');
  }
}

function createJoinRequest(invite, device, options = {}) {
  const valid = verifyInvite(invite, options);
  if (!valid.ok) throw new Error(valid.reason);
  const exchange = crypto.generateKeyPairSync('x25519');
  const core = {
    schemaVersion: PAIRING_SCHEMA_VERSION,
    inviteId: invite.inviteId,
    meshId: invite.meshId,
    deviceId: requiredText(device.deviceId, 'deviceId'),
    devicePublicKey: requiredText(device.devicePublicKey, 'devicePublicKey'),
    name: cleanText(device.name, 'AgentDesk device', 80),
    platform: cleanText(device.platform, 'unknown', 32),
    arch: cleanText(device.arch, 'unknown', 32),
    osVersion: cleanText(device.osVersion, 'unknown', 120),
    appVersion: cleanText(device.appVersion, 'unknown', 40),
    protocolVersion: cleanText(device.protocolVersion, '1.0', 20),
    endpoints: normalizeEndpoints(device.endpoints),
    signalUrls: normalizeServiceUrls(device.signalUrls, { allowInsecure: true }),
    exchangePublicKey: exportPublicKey(exchange.publicKey),
    nonce: crypto.randomBytes(24).toString('base64url')
  };
  return {
    request: {
      ...core,
      secretProof: crypto.createHmac('sha256', invite.secret).update(canonicalEncode(core)).digest('base64url')
    },
    privateState: {
      exchangePrivateKey: exchange.privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
  };
}

function acceptJoinRequest(inviteRecord, request, context, options = {}) {
  previewJoinRequest(inviteRecord, request, options);
  const invite = inviteRecord?.invite;
  const privateState = inviteRecord?.privateState;

  const roles = Array.isArray(context.roles) && context.roles.length
    ? context.roles
    : ['controller', 'device.admin', 'catalog.manage'];
  const certificate = createDelegatedMembershipCertificate({
    meshId: invite.meshId,
    deviceId: requiredText(request.deviceId, 'deviceId'),
    devicePublicKey: requiredText(request.devicePublicKey, 'devicePublicKey'),
    roles
  }, invite.sourceCertificate, context.devicePrivateKey, options);
  const plaintext = {
    schemaVersion: PAIRING_SCHEMA_VERSION,
    mesh: {
      meshId: invite.meshId,
      displayName: cleanText(context.displayName, 'Personal Agent Mesh', 80),
      rootPublicKey: invite.rootPublicKey,
      protocolVersion: cleanText(context.protocolVersion, '1.0', 20),
      createdAt: context.createdAt
    },
    membershipCertificate: certificate,
    membershipChain: [invite.sourceCertificate, ...invite.sourceCertificateChain],
    identityLinkKey: requiredText(context.identityLinkKey, 'identityLinkKey'),
    identityLinkKeyVersion: Number(context.identityLinkKeyVersion) || 1,
    devices: Array.isArray(context.devices) ? context.devices : [],
    catalog: context.catalog && typeof context.catalog === 'object' ? context.catalog : {},
    membershipEvents: Array.isArray(context.membershipEvents) ? context.membershipEvents : [],
    inviterCertificateDigest: certificateDigest(invite.sourceCertificate)
  };
  const key = deriveExchangeKey(privateState.exchangePrivateKey, request.exchangePublicKey, invite.inviteId);
  privateState.consumed = true;
  return {
    response: encryptJson(plaintext, key, invite.inviteId),
    membershipCertificate: certificate,
    membershipChain: plaintext.membershipChain
  };
}

function previewJoinRequest(inviteRecord, request, options = {}) {
  const invite = inviteRecord?.invite;
  const privateState = inviteRecord?.privateState;
  const valid = verifyInvite(invite, options);
  if (!valid.ok) throw new Error(valid.reason);
  if (!privateState || privateState.consumed) throw new Error('pairing-consumed');
  if (sha256(invite.secret) !== privateState.secretDigest) throw new Error('pairing-secret-state');
  assertExactObject(request, JOIN_REQUEST_KEYS, 'pairing-request-schema');
  if (request.schemaVersion !== PAIRING_SCHEMA_VERSION || request.inviteId !== invite.inviteId || request.meshId !== invite.meshId) {
    throw new Error('pairing-request-mismatch');
  }
  requiredText(request.deviceId, 'deviceId');
  const devicePublicKey = requiredText(request.devicePublicKey, 'devicePublicKey');
  requiredText(request.exchangePublicKey, 'exchangePublicKey');
  requiredText(request.nonce, 'nonce');
  const core = joinRequestCore(request);
  const expectedProof = crypto.createHmac('sha256', invite.secret).update(canonicalEncode(core)).digest('base64url');
  if (!safeEqual(expectedProof, request.secretProof)) throw new Error('pairing-secret-proof');
  return {
    inviteId: invite.inviteId,
    deviceId: request.deviceId,
    name: cleanText(request.name, 'AgentDesk device', 80),
    fingerprint: publicKeyFingerprint(devicePublicKey),
    platform: cleanText(request.platform, 'unknown', 32),
    arch: cleanText(request.arch, 'unknown', 32),
    osVersion: cleanText(request.osVersion, 'unknown', 120),
    appVersion: cleanText(request.appVersion, 'unknown', 40),
    expiresAt: invite.expiresAt,
    requestDigest: crypto.createHash('sha256').update(canonicalEncode(request)).digest('hex')
  };
}

function decryptJoinResponse(invite, privateState, response, options = {}) {
  const valid = verifyInvite(invite, options);
  if (!valid.ok) throw new Error(valid.reason);
  const key = deriveExchangeKey(privateState.exchangePrivateKey, invite.exchangePublicKey, invite.inviteId);
  const payload = decryptJson(response, key, invite.inviteId);
  const membership = verifyMembershipChain(
    payload.membershipCertificate,
    payload.membershipChain,
    payload.mesh?.rootPublicKey,
    options
  );
  if (!membership.ok || membership.payload.meshId !== invite.meshId) throw new Error('pairing-response-membership');
  return payload;
}

function encodeInvitation(invite) {
  return `${INVITE_PREFIX}${Buffer.from(JSON.stringify(invite)).toString('base64url')}`;
}

function inviteSignedPayload(value = {}) {
  const payload = { ...value };
  delete payload.signature;
  return payload;
}

function joinRequestCore(value = {}) {
  const core = { ...value };
  delete core.secretProof;
  return core;
}

function deriveExchangeKey(privateKey, remotePublicKey, inviteId) {
  const secret = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(privateKey),
    publicKey: importPublicKey(remotePublicKey)
  });
  return crypto.hkdfSync('sha256', secret, Buffer.from(inviteId), Buffer.from('agentdesk-pairing-v1'), 32);
}

function encryptJson(value, key, associatedData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return {
    schemaVersion: PAIRING_SCHEMA_VERSION,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

function decryptJson(value, key, associatedData) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64url')),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (_error) {
    throw new Error('pairing-response-decrypt');
  }
}

function normalizeEndpoints(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => /^https?:\/\/[a-z0-9.:[\]-]+(?::\d+)?$/i.test(item)))]
    .slice(0, 16);
}

function exportPublicKey(key) {
  return key.export({ type: 'spki', format: 'der' }).toString('base64url');
}

function importPublicKey(value) {
  return crypto.createPublicKey({ key: Buffer.from(value, 'base64url'), type: 'spki', format: 'der' });
}

function publicKeyFingerprint(value) {
  let key;
  try {
    key = crypto.createPublicKey(value);
  } catch (_error) {
    throw new Error('pairing-device-public-key');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('pairing-device-public-key');
  const der = key.export({ type: 'spki', format: 'der' });
  return `SHA256:${crypto.createHash('sha256').update(der).digest('base64url')}`;
}

function sign(value, privateKey) {
  return crypto.sign(null, Buffer.from(canonicalEncode(value)), privateKey).toString('base64');
}

function verify(value, signature, publicKey) {
  if (typeof signature !== 'string') return false;
  return crypto.verify(null, Buffer.from(canonicalEncode(value)), publicKey, Buffer.from(signature, 'base64'));
}

function shortCode(secret) {
  return sha256(secret).slice(0, 8).toUpperCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function cleanText(value, fallback, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, limit);
}

function assertExactObject(value, allowed, reason) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(reason);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(reason);
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  PAIRING_SCHEMA_VERSION,
  INVITE_PREFIX,
  createPairingInvite,
  decodeInvitation,
  inspectInvitation,
  verifyInvite,
  createJoinRequest,
  previewJoinRequest,
  acceptJoinRequest,
  decryptJoinResponse,
  encodeInvitation
};
