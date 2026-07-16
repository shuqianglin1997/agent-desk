/*
 * AgentDesk — safe filesystem action helpers.
 *
 * Explorer shows a native "Location is not available" dialog when
 * shell.showItemInFolder receives a stale path. Resolve the path first and
 * provide an existing directory fallback instead of delegating failure to the
 * operating system.
 */

const fs = require('node:fs');
const path = require('node:path');

function safeStat(itemPath, options = {}) {
  const stat = options.stat || fs.statSync;
  try {
    return stat(itemPath);
  } catch (_error) {
    return null;
  }
}

function nearestExistingDirectory(itemPath, fallbackPath, options = {}) {
  const pathImpl = options.path || path;
  const candidates = [];
  const exact = safeStat(itemPath, options);

  if (exact?.isDirectory()) {
    return { path: itemPath, exact: true, originalExists: true, originalIsFile: false };
  }
  if (exact?.isFile()) {
    const parent = pathImpl.dirname(itemPath);
    if (safeStat(parent, options)?.isDirectory()) {
      return { path: parent, exact: true, originalExists: true, originalIsFile: true };
    }
  }

  const fallbackIsDirectory = Boolean(fallbackPath && safeStat(fallbackPath, options)?.isDirectory());
  const itemIsInsideFallback = fallbackIsDirectory && isSubpath(itemPath, fallbackPath, pathImpl);

  // If the cached path belongs to an old/migrated root, prefer the current
  // session root over an unrelated existing ancestor such as C:\ or AppData.
  if (fallbackIsDirectory && itemPath && !itemIsInsideFallback) candidates.push(fallbackPath);

  let current = itemPath ? pathImpl.dirname(itemPath) : '';
  while (current) {
    candidates.push(current);
    if (fallbackIsDirectory && pathsEqual(current, fallbackPath, pathImpl)) break;
    const parent = pathImpl.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fallbackIsDirectory) candidates.push(fallbackPath);

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const stat = safeStat(candidate, options);
    if (stat?.isDirectory()) {
      return {
        path: candidate,
        exact: false,
        originalExists: Boolean(exact),
        originalIsFile: Boolean(exact?.isFile())
      };
    }
  }
  return {
    path: null,
    exact: false,
    originalExists: Boolean(exact),
    originalIsFile: Boolean(exact?.isFile())
  };
}

function isSubpath(itemPath, parentPath, pathImpl) {
  if (!itemPath || !parentPath) return false;
  const relative = pathImpl.relative(parentPath, itemPath);
  return relative === '' || (!relative.startsWith('..') && !pathImpl.isAbsolute(relative));
}

function pathsEqual(left, right, pathImpl) {
  if (!left || !right) return false;
  const normalize = (value) => pathImpl.normalize(value);
  if (pathImpl.sep === '\\') {
    return normalize(left).toLowerCase() === normalize(right).toLowerCase();
  }
  return normalize(left) === normalize(right);
}

module.exports = { nearestExistingDirectory, safeStat };
