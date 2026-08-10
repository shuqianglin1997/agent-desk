const DEVICE_STATUSES = new Set([
  'online',
  'offline',
  'sleeping',
  'connecting',
  'revoked'
]);

const { normalizeServiceUrls } = require('../protocol/signaling-auth');

function cleanText(value, fallback = '', maxLength = 160) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, maxLength);
}

function normalizeDevice(input = {}) {
  const status = DEVICE_STATUSES.has(input.status) ? input.status : 'offline';
  return {
    deviceId: cleanText(input.deviceId, '', 128),
    // PEM/DER text is cryptographic material: preserve embedded newlines exactly.
    devicePublicKey: cleanOpaque(input.devicePublicKey, 16_384),
    membershipCertificate: input.membershipCertificate && typeof input.membershipCertificate === 'object'
      ? input.membershipCertificate
      : null,
    membershipChain: Array.isArray(input.membershipChain)
      ? input.membershipChain.filter((item) => item && typeof item === 'object').slice(0, 8)
      : [],
    name: cleanText(input.name, 'AgentDesk device', 80),
    platform: cleanText(input.platform, 'unknown', 32),
    arch: cleanText(input.arch, 'unknown', 32),
    osVersion: cleanText(input.osVersion, 'unknown', 120),
    appVersion: cleanText(input.appVersion, 'unknown', 40),
    protocolVersion: cleanText(input.protocolVersion, '1.0', 20),
    status,
    capabilities: uniqueStrings(input.capabilities),
    permissions: uniqueStrings(input.permissions),
    pairedAt: isoOrNull(input.pairedAt),
    lastSeenAt: isoOrNull(input.lastSeenAt),
    revokedAt: isoOrNull(input.revokedAt),
    inventoryRevision: finiteRevision(input.inventoryRevision),
    endpoints: uniqueEndpoints(input.endpoints),
    signalUrls: normalizeServiceUrls(input.signalUrls, { allowInsecure: true }),
    isLocal: input.isLocal === true
  };
}

function createLocalDevice(input = {}, options = {}) {
  const randomUUID = options.randomUUID;
  const now = options.now || new Date().toISOString();
  if (typeof randomUUID !== 'function') throw new TypeError('randomUUID is required');
  const device = normalizeDevice({
    ...input,
    deviceId: input.deviceId || randomUUID(),
    status: 'online',
    capabilities: input.capabilities || ['inventory.read', 'catalog.manage', 'device.admin'],
    permissions: input.permissions || ['inventory.read', 'catalog.manage', 'device.admin'],
    pairedAt: input.pairedAt || now,
    lastSeenAt: input.lastSeenAt || now,
    inventoryRevision: 1,
    isLocal: true
  });
  if (!device.deviceId || !device.devicePublicKey) {
    throw new TypeError('local device requires an id and public key');
  }
  return device;
}

function renameDevice(device, name) {
  const nextName = cleanText(name, '', 80);
  if (!nextName) throw new TypeError('device name is required');
  return normalizeDevice({ ...device, name: nextName });
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, '', 80)).filter(Boolean))];
}

function cleanOpaque(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function uniqueEndpoints(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => (
    /^https?:\/\/[a-z0-9.:[\]-]+(?::\d+)?$/i.test(item)
  )))].slice(0, 16);
}

function isoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function finiteRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

module.exports = {
  DEVICE_STATUSES,
  normalizeDevice,
  createLocalDevice,
  renameDevice
};
