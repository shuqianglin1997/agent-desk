/*
 * Least-privilege defaults for Codex profiles created and owned by AgentDesk.
 *
 * Codex's built-in :workspace profile limits writes but can still allow broad
 * reads. The profile below follows the official workspace-only example: deny
 * the filesystem root, restore only the minimal runtime paths, and inherit the
 * active workspace roots from :workspace. Access outside those roots must then
 * go through an explicit user-reviewed sandbox escalation.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_CONFIG_BYTES = 1024 * 1024;
const PERMISSION_PROFILE = 'agentdesk-workspace-only-v1';
const MANAGED_PROFILE_MARKER = '# AgentDesk managed Codex permission profile v1';

function ensureManagedCodexConfig(profile) {
  if (!isManagedCodexProfile(profile)) {
    return { ok: true, changed: false, skipped: true };
  }

  const profilePath = path.resolve(profile.profilePath);
  const sessionRoot = path.resolve(profile.sessionRoot);
  if (!isSubpath(sessionRoot, profilePath)) {
    throw configError('codex-config-root-outside-profile');
  }

  ensureRealDirectory(profilePath, 'codex-profile-path-unsafe');
  ensureRealDirectory(sessionRoot, 'codex-config-root-unsafe');

  const configFile = path.join(sessionRoot, 'config.toml');
  const backupFile = `${configFile}.agentdesk.bak`;
  const current = readRegularConfig(configFile);
  const prepared = addManagedCodexDefaults(current);
  if (!prepared.changed) {
    tightenMode(configFile);
    return { ok: true, changed: false, configFile };
  }

  if (current !== null) {
    assertSafeDestination(backupFile, 'codex-config-backup-unsafe');
    writePrivateAtomic(backupFile, current);
  }
  writePrivateAtomic(configFile, prepared.text);
  return {
    ok: true,
    changed: true,
    configFile,
    backupFile: current === null ? null : backupFile,
    added: prepared.added
  };
}

function isManagedCodexProfile(profile) {
  return Boolean(
    profile
    && profile.appId === 'codex'
    && profile.profilePathMode === 'managed'
    && profile.sessionRootMode === 'managed'
    && typeof profile.profilePath === 'string'
    && typeof profile.sessionRoot === 'string'
  );
}

function addManagedCodexDefaults(source) {
  const original = source === null || source === undefined ? '' : String(source);
  const tableIndex = firstTomlTableIndex(original);
  const preamble = original.slice(0, tableIndex);
  const remainder = original.slice(tableIndex);
  const additions = [];
  let needsPermissionProfile = false;
  const usesLegacySandbox = hasTopLevelAssignment(preamble, 'sandbox_mode')
    || hasTomlTable(original, 'sandbox_workspace_write');

  if (!usesLegacySandbox && !hasTopLevelAssignment(preamble, 'default_permissions')) {
    additions.push(`default_permissions = "${PERMISSION_PROFILE}"`);
    needsPermissionProfile = true;
  }
  if (!hasTopLevelAssignment(preamble, 'approval_policy')) {
    additions.push('approval_policy = "on-request"');
  }
  if (!hasTopLevelAssignment(preamble, 'approvals_reviewer')) {
    additions.push('approvals_reviewer = "user"');
  }

  const profileExists = hasTomlTable(original, `permissions.${PERMISSION_PROFILE}`);
  if (!additions.length && (!needsPermissionProfile || profileExists)) {
    return { changed: false, text: original, added: [] };
  }

  let next = original;
  if (additions.length) {
    const selectionBlock = [
      '# AgentDesk safety defaults: workspace-only access; explicit user review outside it.',
      ...additions
    ].join('\n');
    next = `${trimTrailingBlankLines(preamble)}${preamble.trim() ? '\n\n' : ''}${selectionBlock}\n\n${remainder.replace(/^\s*/, '')}`;
  }

  if (needsPermissionProfile && !profileExists) {
    const permissionBlock = [
      MANAGED_PROFILE_MARKER,
      `[permissions.${PERMISSION_PROFILE}]`,
      'description = "AgentDesk managed workspace-only access"',
      'extends = ":workspace"',
      '',
      `[permissions.${PERMISSION_PROFILE}.filesystem]`,
      '":root" = "deny"',
      '":minimal" = "read"',
      '":tmpdir" = "deny"',
      '":slash_tmp" = "deny"'
    ].join('\n');
    next = `${trimTrailingBlankLines(next)}\n\n${permissionBlock}\n`;
  } else if (next && !next.endsWith('\n')) {
    next += '\n';
  }

  return { changed: next !== original, text: next, added: additions.map(assignmentKey) };
}

function firstTomlTableIndex(text) {
  const match = /^[ \t]*\[{1,2}[^\r\n]+\]{1,2}[ \t]*(?:#.*)?$/m.exec(text);
  return match ? match.index : text.length;
}

function hasTopLevelAssignment(preamble, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*(?:${escaped}|"${escaped}")[ \\t]*=`, 'm').test(preamble);
}

function hasTomlTable(text, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*\\[${escaped}\\][ \\t]*(?:#.*)?$`, 'm').test(text);
}

function assignmentKey(line) {
  return String(line).split('=', 1)[0].trim();
}

function trimTrailingBlankLines(text) {
  return String(text).replace(/[ \t]*(?:\r?\n[ \t]*)*$/, '');
}

function readRegularConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw configError('codex-config-file-unsafe');
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw configError('codex-config-file-too-large');
  }
  return fs.readFileSync(filePath, 'utf8');
}

function ensureRealDirectory(directoryPath, reasonCode) {
  if (fs.existsSync(directoryPath)) {
    const stat = fs.lstatSync(directoryPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw configError(reasonCode);
    return;
  }
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw configError(reasonCode);
}

function assertSafeDestination(filePath, reasonCode) {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw configError(reasonCode);
}

function writePrivateAtomic(filePath, contents) {
  assertSafeDestination(filePath, 'codex-config-destination-unsafe');
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      fs.renameSync(temporary, filePath);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      fs.copyFileSync(temporary, filePath);
      fs.unlinkSync(temporary);
    }
    tightenMode(filePath);
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (_error) { /* already published */ }
  }
}

function tightenMode(filePath) {
  if (!fs.existsSync(filePath) || process.platform === 'win32') return;
  fs.chmodSync(filePath, 0o600);
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (_error) {
    // Some filesystems do not support fsync on directories. The file itself
    // has already been fsynced before the rename.
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function isSubpath(itemPath, parentPath) {
  const relative = path.relative(parentPath, itemPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function configError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = {
  MAX_CONFIG_BYTES,
  PERMISSION_PROFILE,
  MANAGED_PROFILE_MARKER,
  isManagedCodexProfile,
  addManagedCodexDefaults,
  ensureManagedCodexConfig
};
