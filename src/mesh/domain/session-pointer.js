const crypto = require('node:crypto');
const path = require('node:path');
const { canonicalEncode } = require('./identity-link');

const SESSION_POINTER_SCHEMA_VERSION = 1;
const MAX_SESSION_POINTERS = 50;

function createSessionPointer(input = {}, options = {}) {
  const replica = input.replica || {};
  const transferId = requiredText(input.transferId || crypto.randomUUID(), 'transferId', 128);
  const sourceDeviceId = requiredText(replica.deviceId, 'source.deviceId', 128);
  const sourceProjectPath = cleanPath(replica.projectPathHint || input.projectPath);
  const sourceFilePath = cleanPath(replica.sourceFileHint || input.filePath);
  const stableSessionId = requiredText(
    replica.stableProviderThreadId || replica.adapterConversationKey || input.sessionId,
    'source.sessionId',
    512
  );
  const createdAt = normalizeIso(options.now || new Date().toISOString(), 'createdAt');
  const ttlMs = clampNumber(options.ttlMs, 60_000, 7 * 24 * 60 * 60_000, 7 * 24 * 60 * 60_000);
  const projectId = cleanText(input.projectId, 128) || deriveProjectId({
    linkKey: options.linkKey,
    deviceId: sourceDeviceId,
    projectPath: sourceProjectPath
  });
  return normalizeSessionPointer({
    schemaVersion: SESSION_POINTER_SCHEMA_VERSION,
    transferId,
    source: {
      agentId: replica.agentId,
      accountBindingId: replica.accountBindingId,
      deviceId: sourceDeviceId,
      profileId: replica.profileId,
      sessionId: stableSessionId,
      replicaId: replica.replicaId,
      stableProviderThreadId: replica.stableProviderThreadId || null
    },
    location: {
      projectId,
      sourceProjectPath: sourceProjectPath || null,
      relativePath: safeRelativePath(sourceProjectPath, input.workspaceFilePath),
      workspaceRevision: cleanText(input.workspaceRevision, 160) || null,
      sourceFilePath: sourceFilePath || null,
      coordinate: sourceFilePath ? `${sourceFilePath}#${stableSessionId}` : stableSessionId
    },
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + ttlMs).toISOString()
  });
}

function normalizeSessionPointer(value = {}) {
  if (value.schemaVersion !== SESSION_POINTER_SCHEMA_VERSION) throw new Error('session-pointer-version');
  const createdAt = normalizeIso(value.createdAt, 'createdAt');
  const expiresAt = normalizeIso(value.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(expiresAt) - Date.parse(createdAt) > 7 * 24 * 60 * 60_000) {
    throw new Error('session-pointer-expiry');
  }
  const source = value.source || {};
  const location = value.location || {};
  return {
    schemaVersion: SESSION_POINTER_SCHEMA_VERSION,
    transferId: requiredText(value.transferId, 'transferId', 128),
    source: {
      agentId: requiredText(source.agentId, 'source.agentId', 128),
      accountBindingId: requiredText(source.accountBindingId, 'source.accountBindingId', 128),
      deviceId: requiredText(source.deviceId, 'source.deviceId', 128),
      profileId: requiredText(source.profileId, 'source.profileId', 128),
      sessionId: requiredText(source.sessionId, 'source.sessionId', 512),
      replicaId: requiredText(source.replicaId, 'source.replicaId', 128),
      stableProviderThreadId: cleanText(source.stableProviderThreadId, 512) || null
    },
    location: {
      projectId: cleanText(location.projectId, 128) || null,
      sourceProjectPath: cleanPath(location.sourceProjectPath) || null,
      relativePath: normalizeRelativePath(location.relativePath),
      workspaceRevision: cleanText(location.workspaceRevision, 160) || null,
      sourceFilePath: cleanPath(location.sourceFilePath) || null,
      coordinate: requiredText(location.coordinate, 'location.coordinate', 8192)
    },
    createdAt,
    expiresAt
  };
}

function normalizeSessionPointers(value) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length || list.length > MAX_SESSION_POINTERS) throw new Error('session-pointer-count');
  return list.map(normalizeSessionPointer);
}

function deriveProjectId(input = {}) {
  const projectPath = cleanPath(input.projectPath);
  if (!projectPath) return null;
  const key = Buffer.isBuffer(input.linkKey) ? input.linkKey : Buffer.from(String(input.linkKey || ''), 'base64');
  if (key.length < 16) throw new Error('session-pointer-link-key');
  return crypto.createHmac('sha256', key).update(canonicalEncode({
    kind: 'project-binding-candidate',
    deviceId: requiredText(input.deviceId, 'deviceId', 128),
    projectPath
  })).digest('base64url');
}

function safeRelativePath(root, filePath) {
  const base = cleanPath(root);
  const file = cleanPath(filePath);
  if (!base || !file) return null;
  const flavor = pathFlavor(base);
  const relative = flavor.relative(base, file);
  if (!relative || relative === '.') return '.';
  if (flavor.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${flavor.sep}`)) return null;
  return normalizeRelativePath(relative);
}

function normalizeRelativePath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error('session-pointer-relative-absolute');
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) throw new Error('session-pointer-relative-traversal');
  return parts.length ? parts.join('/') : '.';
}

function pathFlavor(value) {
  return /^[a-z]:[\\/]/i.test(value) || value.includes('\\') ? path.win32 : path.posix;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function cleanText(value, limit) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function cleanPath(value) {
  return String(value || '').trim().slice(0, 4096);
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

module.exports = {
  SESSION_POINTER_SCHEMA_VERSION,
  MAX_SESSION_POINTERS,
  createSessionPointer,
  normalizeSessionPointer,
  normalizeSessionPointers,
  deriveProjectId,
  safeRelativePath,
  normalizeRelativePath
};
