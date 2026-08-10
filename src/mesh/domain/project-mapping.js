const path = require('node:path');

function createProjectBinding(input = {}, options = {}) {
  const localRoot = requiredPath(input.localRoot, 'localRoot');
  return normalizeProjectBinding({
    projectId: input.projectId,
    deviceId: input.deviceId,
    localRoot,
    source: input.source || 'user-confirmed',
    verifiedAt: options.now || new Date().toISOString(),
    lastResolvedAt: options.now || new Date().toISOString()
  });
}

function normalizeProjectBinding(value = {}) {
  return {
    projectId: requiredText(value.projectId, 'projectId', 128),
    deviceId: requiredText(value.deviceId, 'deviceId', 128),
    localRoot: requiredPath(value.localRoot, 'localRoot'),
    source: value.source === 'automatic' ? 'automatic' : 'user-confirmed',
    verifiedAt: normalizeIso(value.verifiedAt, 'verifiedAt'),
    lastResolvedAt: normalizeIso(value.lastResolvedAt || value.verifiedAt, 'lastResolvedAt')
  };
}

function resolveProjectPointer(pointer, bindings, options = {}) {
  const projectId = String(pointer?.location?.projectId || '');
  const deviceId = String(options.deviceId || '');
  const binding = (Array.isArray(bindings) ? bindings : []).find((item) => (
    item.projectId === projectId && item.deviceId === deviceId
  ));
  if (!binding) return { mapped: false, reason: 'project-mapping-required', targetPath: null };
  const relative = pointer?.location?.relativePath;
  if (!relative || relative === '.') return { mapped: true, binding, targetPath: binding.localRoot };
  const flavor = pathFlavor(binding.localRoot);
  const targetPath = flavor.resolve(binding.localRoot, ...String(relative).split('/'));
  const root = flavor.resolve(binding.localRoot);
  const prefix = root.endsWith(flavor.sep) ? root : `${root}${flavor.sep}`;
  const comparableTarget = flavor === path.win32 ? targetPath.toLowerCase() : targetPath;
  const comparablePrefix = flavor === path.win32 ? prefix.toLowerCase() : prefix;
  if (!comparableTarget.startsWith(comparablePrefix)) {
    return { mapped: false, reason: 'project-mapping-escape', targetPath: null };
  }
  return { mapped: true, binding, targetPath };
}

function pathFlavor(value) {
  return /^[a-z]:[\\/]/i.test(value) || value.includes('\\') ? path.win32 : path.posix;
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function requiredPath(value, field) {
  const text = String(value || '').trim();
  if (!text || text.includes('\0')) throw new TypeError(`${field} is invalid`);
  const flavor = pathFlavor(text);
  if (!flavor.isAbsolute(text)) throw new TypeError(`${field} must be absolute`);
  return flavor.normalize(text).slice(0, 4096);
}

function normalizeIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${field} is invalid`);
  return new Date(time).toISOString();
}

module.exports = {
  createProjectBinding,
  normalizeProjectBinding,
  resolveProjectPointer
};
