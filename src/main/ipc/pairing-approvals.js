const crypto = require('node:crypto');

const DEFAULT_APPROVAL_TTL_MS = 3 * 60_000;
const MAX_PENDING_APPROVALS = 8;
const MAX_INSPECTIONS = 32;

class InvitationInspectionRegistry {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.entries = new Map();
  }

  issue(code, preview = {}) {
    this.prune();
    if (this.entries.size >= MAX_INSPECTIONS) throw new Error('pairing-inspection-limit');
    const inviteId = requiredText(preview.inviteId, 'inviteId', 128);
    const expiresAt = normalizeFutureIso(preview.expiresAt, this.now(), 'pairing-expired');
    const confirmationToken = this.randomUUID();
    this.entries.set(confirmationToken, {
      confirmationToken,
      inviteId,
      codeDigest: digestCode(code),
      expiresAt
    });
    return {
      ...publicInvitationPreview(preview),
      confirmationToken
    };
  }

  consume(input = {}) {
    this.prune();
    const confirmationToken = requiredText(input.confirmationToken, 'confirmationToken', 256);
    const entry = this.entries.get(confirmationToken);
    if (!entry) throw new Error('pairing-inspection-required');
    this.entries.delete(confirmationToken);
    if (entry.inviteId !== requiredText(input.inviteId, 'inviteId', 128)) {
      throw new Error('pairing-inspection-mismatch');
    }
    const actual = digestCode(input.code);
    if (!safeEqual(actual, entry.codeDigest)) throw new Error('pairing-inspection-mismatch');
    return true;
  }

  prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (Date.parse(entry.expiresAt) <= now) this.entries.delete(token);
    }
  }

  clear() {
    this.entries.clear();
  }
}

class PairingApprovalRegistry {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.ttlMs = finiteTtl(options.ttlMs);
    this.onChange = options.onChange || (() => {});
    this.pending = new Map();
    this.byClaimKey = new Map();
  }

  request(preview = {}) {
    this.prune();
    const publicPreview = publicPairingClaimPreview(preview);
    const key = `${publicPreview.inviteId}:${publicPreview.deviceId}`;
    const requestDigest = requiredDigest(preview.requestDigest);
    const existingId = this.byClaimKey.get(key);
    if (existingId && this.pending.has(existingId)) {
      const existing = this.pending.get(existingId);
      if (existing.requestDigest !== requestDigest) throw new Error('pairing-claim-conflict');
      return existing.promise;
    }
    if (this.pending.size >= MAX_PENDING_APPROVALS) throw new Error('pairing-approval-limit');

    const approvalId = this.randomUUID();
    const expiresAtMs = Math.min(
      Date.parse(publicPreview.expiresAt),
      this.now() + this.ttlMs
    );
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) throw new Error('pairing-expired');
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      this.finish(approvalId, false, 'pairing-approval-expired');
    }, Math.max(1, expiresAtMs - this.now()));
    timer.unref?.();
    this.pending.set(approvalId, {
      approvalId,
      key,
      preview: publicPreview,
      requestDigest,
      expiresAt: new Date(expiresAtMs).toISOString(),
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer
    });
    this.byClaimKey.set(key, approvalId);
    this.changed();
    return promise;
  }

  decide(input = {}) {
    const approvalId = requiredText(input.approvalId, 'approvalId', 256);
    const confirmed = input.confirmed === true;
    if (!this.pending.has(approvalId)) throw new Error('pairing-approval-not-found');
    this.finish(approvalId, confirmed, confirmed ? null : 'pairing-user-declined');
    return true;
  }

  list() {
    this.prune();
    return [...this.pending.values()].map((entry) => ({
      approvalId: entry.approvalId,
      expiresAt: entry.expiresAt,
      ...entry.preview
    }));
  }

  prune() {
    const now = this.now();
    for (const entry of [...this.pending.values()]) {
      if (Date.parse(entry.expiresAt) <= now) {
        this.finish(entry.approvalId, false, 'pairing-approval-expired');
      }
    }
  }

  stop(reason = 'pairing-approval-stopped') {
    for (const entry of [...this.pending.values()]) {
      this.finish(entry.approvalId, false, reason);
    }
  }

  finish(approvalId, confirmed, reason) {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    this.byClaimKey.delete(entry.key);
    clearTimeout(entry.timer);
    if (confirmed) entry.resolve({ requestDigest: entry.requestDigest });
    else entry.reject(new Error(reason || 'pairing-user-declined'));
    this.changed();
    return true;
  }

  cancelInvite(inviteId, reason = 'pairing-invite-cancelled') {
    const target = requiredText(inviteId, 'inviteId', 128);
    for (const entry of [...this.pending.values()]) {
      if (entry.preview.inviteId === target) this.finish(entry.approvalId, false, reason);
    }
  }

  changed() {
    try { this.onChange(this.list()); } catch (_error) { /* UI notification cannot alter trust. */ }
  }
}

function publicInvitationPreview(value = {}) {
  return {
    inviteId: requiredText(value.inviteId, 'inviteId', 128),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'sourceDeviceId', 128),
    sourceDeviceName: cleanText(value.sourceDeviceName, 80) || 'Device',
    sourceFingerprint: requiredText(value.sourceFingerprint, 'sourceFingerprint', 128),
    platform: cleanText(value.platform, 40) || null,
    arch: cleanText(value.arch, 40) || null,
    appVersion: cleanText(value.appVersion, 40) || null,
    expiresAt: normalizeIso(value.expiresAt, 'expiresAt')
  };
}

function publicPairingClaimPreview(value = {}) {
  return {
    inviteId: requiredText(value.inviteId, 'inviteId', 128),
    deviceId: requiredText(value.deviceId, 'deviceId', 128),
    name: cleanText(value.name, 80) || 'Device',
    fingerprint: requiredText(value.fingerprint, 'fingerprint', 128),
    platform: cleanText(value.platform, 40) || null,
    arch: cleanText(value.arch, 40) || null,
    osVersion: cleanText(value.osVersion, 120) || null,
    appVersion: cleanText(value.appVersion, 40) || null,
    expiresAt: normalizeIso(value.expiresAt, 'expiresAt')
  };
}

function normalizeInvitationInspectionInput(value = {}) {
  assertExactKeys(value, new Set(['code']));
  return { code: requiredText(value.code, 'code', 64 * 1024) };
}

function normalizeConfirmedJoinInput(value = {}) {
  assertExactKeys(value, new Set(['code', 'inviteId', 'confirmationToken']));
  return {
    code: requiredText(value.code, 'code', 64 * 1024),
    inviteId: requiredText(value.inviteId, 'inviteId', 128),
    confirmationToken: requiredText(value.confirmationToken, 'confirmationToken', 256)
  };
}

function normalizePairingDecisionInput(value = {}) {
  assertExactKeys(value, new Set(['approvalId', 'confirmed']));
  if (typeof value.confirmed !== 'boolean') throw new Error('confirmed-invalid');
  return {
    approvalId: requiredText(value.approvalId, 'approvalId', 256),
    confirmed: value.confirmed
  };
}

function digestCode(value) {
  const code = requiredText(value, 'code', 64 * 1024);
  return crypto.createHash('sha256').update(code).digest();
}

function safeEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right)
    && left.length === right.length
    && crypto.timingSafeEqual(left, right);
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text || text.length > limit) throw new Error(`${field}-invalid`);
  return text;
}

function assertExactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('pairing-input-invalid');
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error('pairing-input-invalid');
  }
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field}-invalid`);
  return new Date(time).toISOString();
}

function normalizeFutureIso(value, now, reason) {
  const iso = normalizeIso(value, 'expiresAt');
  if (Date.parse(iso) <= now) throw new Error(reason);
  return iso;
}

function finiteTtl(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_APPROVAL_TTL_MS;
  return Math.max(10_000, Math.min(number, 10 * 60_000));
}

function requiredDigest(value) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('pairing-request-digest-invalid');
  return digest;
}

module.exports = {
  DEFAULT_APPROVAL_TTL_MS,
  MAX_PENDING_APPROVALS,
  InvitationInspectionRegistry,
  PairingApprovalRegistry,
  publicInvitationPreview,
  publicPairingClaimPreview,
  normalizeInvitationInspectionInput,
  normalizeConfirmedJoinInput,
  normalizePairingDecisionInput
};
