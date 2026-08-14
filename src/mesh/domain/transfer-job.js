const TRANSFER_TYPES = new Set(['session-pointer', 'file', 'task-package']);
const TRANSFER_DIRECTIONS = new Set(['outgoing', 'incoming']);
const TRANSFER_STATES = new Set([
  'queued',
  'sending',
  'awaiting-accept',
  'receiving',
  'awaiting-ack',
  'received',
  'completed',
  'failed',
  'cancelled',
  'expired'
]);

function normalizeTransferJob(value = {}) {
  const createdAt = normalizeIso(value.createdAt, 'createdAt');
  const updatedAt = normalizeIso(value.updatedAt || value.createdAt, 'updatedAt');
  const expiresAt = normalizeIso(value.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error('transfer-expiry');
  return {
    transferId: requiredText(value.transferId, 'transferId', 128),
    direction: enumValue(value.direction, TRANSFER_DIRECTIONS, 'transfer-direction'),
    type: enumValue(value.type, TRANSFER_TYPES, 'transfer-type'),
    sourceDeviceId: requiredText(value.sourceDeviceId, 'sourceDeviceId', 128),
    targetDeviceId: requiredText(value.targetDeviceId, 'targetDeviceId', 128),
    state: enumValue(value.state, TRANSFER_STATES, 'transfer-state'),
    itemCount: nonNegativeInteger(value.itemCount, 'itemCount'),
    bytesTotal: nonNegativeInteger(value.bytesTotal, 'bytesTotal'),
    bytesTransferred: nonNegativeInteger(value.bytesTransferred, 'bytesTransferred'),
    retryCount: nonNegativeInteger(value.retryCount, 'retryCount'),
    createdAt,
    updatedAt,
    expiresAt,
    lastError: cleanText(value.lastError, 160) || null,
    encryptedPayload: normalizeEncryptedPayload(value.encryptedPayload),
    receivedFromName: cleanText(value.receivedFromName, 80) || null,
    targetName: cleanText(value.targetName, 80) || null
  };
}

function publicTransferJob(value = {}) {
  const job = normalizeTransferJob(value);
  return {
    transferId: job.transferId,
    direction: job.direction,
    type: job.type,
    sourceDeviceId: job.sourceDeviceId,
    targetDeviceId: job.targetDeviceId,
    state: job.state,
    itemCount: job.itemCount,
    bytesTotal: job.bytesTotal,
    bytesTransferred: job.bytesTransferred,
    retryCount: job.retryCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    lastError: job.lastError,
    receivedFromName: job.receivedFromName,
    targetName: job.targetName
  };
}

function normalizeEncryptedPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('transfer-payload-invalid');
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 24 * 1024 * 1024) throw new Error('transfer-payload-too-large');
  return JSON.parse(encoded);
}

function enumValue(value, allowed, error) {
  const text = String(value || '');
  if (!allowed.has(text)) throw new Error(error);
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

function nonNegativeInteger(value, field) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

module.exports = {
  TRANSFER_TYPES,
  TRANSFER_DIRECTIONS,
  TRANSFER_STATES,
  normalizeTransferJob,
  publicTransferJob
};
