const SEND_KEYS = new Set([
  'targetDeviceId',
  'profileId',
  'sessionId',
  'conversationId',
  'senderLabel',
  'checkpoint',
  'includeProject',
  'includeAttachments'
]);

const TRANSFER_KEYS = new Set(['transferId']);

function normalizeTaskPackageSendInput(input = {}) {
  assertRecord(input, 'task-package-send-input-invalid');
  assertKeys(input, SEND_KEYS, 'task-package-send-field-forbidden');
  const checkpoint = normalizeTaskCheckpoint(input.checkpoint);
  if (!checkpoint.objective) throw new Error('task-package-objective-required');
  return {
    targetDeviceId: requiredText(input.targetDeviceId, 'targetDeviceId', 128),
    profileId: requiredText(input.profileId, 'profileId', 128),
    sessionId: requiredText(input.sessionId, 'sessionId', 128),
    conversationId: cleanText(input.conversationId, 128) || null,
    senderLabel: cleanText(input.senderLabel, 120) || null,
    checkpoint,
    includeProject: input.includeProject !== false,
    includeAttachments: input.includeAttachments === true
  };
}

function normalizeTaskPackageTransferInput(input = {}) {
  assertRecord(input, 'task-package-transfer-input-invalid');
  assertKeys(input, TRANSFER_KEYS, 'task-package-transfer-field-forbidden');
  return {
    transferId: requiredText(input.transferId, 'transferId', 128)
  };
}

function normalizeTaskCheckpoint(value = {}) {
  assertRecord(value, 'task-package-checkpoint-invalid');
  const allowed = new Set(['objective', 'completed', 'next', 'blockers', 'acceptance']);
  assertKeys(value, allowed, 'task-package-checkpoint-field-forbidden');
  return {
    objective: cleanMultiline(value.objective, 4000),
    completed: normalizeLines(value.completed),
    next: normalizeLines(value.next),
    blockers: normalizeLines(value.blockers),
    acceptance: normalizeLines(value.acceptance)
  };
}

function normalizeLines(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return source
    .slice(0, 32)
    .map((item) => cleanText(item, 1000))
    .filter(Boolean);
}

function cleanMultiline(value, limit) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, limit);
}

function cleanText(value, limit) {
  return String(value || '').replace(/\0/g, '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function requiredText(value, field, limit) {
  const text = cleanText(value, limit + 1);
  if (!text || text.length > limit) throw new Error(`${field}-invalid`);
  return text;
}

function assertRecord(value, errorCode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(errorCode);
}

function assertKeys(value, allowed, errorCode) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(errorCode);
  }
}

module.exports = {
  SEND_KEYS,
  TRANSFER_KEYS,
  normalizeTaskPackageSendInput,
  normalizeTaskPackageTransferInput,
  normalizeTaskCheckpoint
};
