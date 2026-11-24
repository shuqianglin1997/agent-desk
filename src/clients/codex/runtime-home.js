/*
 * Codex desktop creates a Unix-domain socket below CODEX_HOME/ipc. macOS
 * limits sockaddr_un.sun_path to 104 bytes including the trailing NUL, while
 * AgentDesk's descriptive managed Profile paths can legitimately be longer.
 *
 * Keep the canonical session root exactly where the user expects it and pass
 * Codex a stable, short symlink under a private AgentDesk runtime directory.
 * Reads, writes, sessions and authentication still resolve to the canonical
 * directory; only the pathname used by Codex at runtime becomes short enough.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAC_SUN_PATH_BYTES = 104;
const CODEX_IPC_SUFFIX = path.join('ipc', 'ipc.sock');

function ipcSocketPath(sessionRoot) {
  return path.join(path.resolve(String(sessionRoot || '')), CODEX_IPC_SUFFIX);
}

function socketPathBytes(sessionRoot) {
  return Buffer.byteLength(ipcSocketPath(sessionRoot), 'utf8');
}

function needsShortRuntimeHome(sessionRoot, platform = process.platform) {
  if (platform !== 'darwin' || !sessionRoot) return false;
  // sun_path must also contain a terminating NUL, so 104 bytes is already too
  // long for a pathname socket on macOS.
  return socketPathBytes(sessionRoot) >= MAC_SUN_PATH_BYTES;
}

function aliasName(profile) {
  const identity = String(profile?.id || path.resolve(String(profile?.sessionRoot || '')));
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function resolvedLinkTarget(aliasPath, linkValue) {
  return path.resolve(path.dirname(aliasPath), linkValue);
}

function defaultAliasRoot() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join('/tmp', `agentdesk-codex-${uid}`);
}

function ensurePrivateAliasRoot(aliasRoot, fsImpl) {
  fsImpl.mkdirSync(aliasRoot, { recursive: true, mode: 0o700 });
  const stat = fsImpl.lstatSync(aliasRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('codex-runtime-home-root-unsafe');
  if (typeof process.getuid === 'function' && Number.isInteger(stat.uid) && stat.uid !== process.getuid()) {
    throw new Error('codex-runtime-home-root-owner-mismatch');
  }
  try { fsImpl.chmodSync(aliasRoot, 0o700); } catch (_error) { /* best effort */ }
}

function ensureCodexRuntimeHome(profile, options = {}) {
  const platform = options.platform || process.platform;
  const fsImpl = options.fs || fs;
  const sessionRoot = path.resolve(String(profile?.sessionRoot || ''));
  if (!profile?.sessionRoot || !needsShortRuntimeHome(sessionRoot, platform)) {
    return {
      sessionRoot,
      canonicalSessionRoot: sessionRoot,
      aliased: false,
      socketPathBytes: socketPathBytes(sessionRoot)
    };
  }

  const aliasRoot = path.resolve(String(options.aliasRoot || defaultAliasRoot()));
  if (aliasRoot === path.parse(aliasRoot).root) {
    throw new Error('codex-runtime-home-root-invalid');
  }
  const aliasPath = path.join(aliasRoot, aliasName(profile));
  fsImpl.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  ensurePrivateAliasRoot(aliasRoot, fsImpl);

  if (fsImpl.existsSync(aliasPath) || (() => {
    try { fsImpl.lstatSync(aliasPath); return true; } catch (_error) { return false; }
  })()) {
    const stat = fsImpl.lstatSync(aliasPath);
    if (!stat.isSymbolicLink()) throw new Error('codex-runtime-home-alias-conflict');
    const currentTarget = resolvedLinkTarget(aliasPath, fsImpl.readlinkSync(aliasPath));
    if (currentTarget !== sessionRoot) fsImpl.unlinkSync(aliasPath);
  }

  if (!fsImpl.existsSync(aliasPath)) fsImpl.symlinkSync(sessionRoot, aliasPath, 'dir');
  const bytes = socketPathBytes(aliasPath);
  if (bytes >= MAC_SUN_PATH_BYTES) throw new Error('codex-runtime-home-alias-too-long');
  return {
    sessionRoot: aliasPath,
    canonicalSessionRoot: sessionRoot,
    aliased: true,
    socketPathBytes: bytes
  };
}

module.exports = {
  MAC_SUN_PATH_BYTES,
  CODEX_IPC_SUFFIX,
  ipcSocketPath,
  socketPathBytes,
  needsShortRuntimeHome,
  ensureCodexRuntimeHome
};
