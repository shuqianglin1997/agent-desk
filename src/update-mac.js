'use strict';

/*
 * Catshelf — the macOS half of one-click updates (docs/RELEASING.md, "In-app
 * updates"). Plain Node with every outside effect injected (`run` for the
 * system tools, `fs`), so each step and each refusal is unit-tested without
 * hdiutil, codesign or a network, and scripts/update-dry-run-macos.js runs the
 * same steps on the real Latest against a scratch folder.
 *
 * In the app (src/main/updates.js), once the DMG is on disk and its SHA-256
 * matches GitHub's asset digest:
 *   1. prepareMacUpdate mounts it read-only and hidden in a fresh folder,
 *      checks the Catshelf.app inside (bundle id, `codesign --verify --deep
 *      --strict`, the commit it records = the release's commit, its version),
 *      copies it with `ditto --noqtn` next to /Applications/Catshelf.app under
 *      a hidden new name, checks that copy the same way and unmounts. Nothing
 *      but the new name is written; any failure removes it.
 *   2. Main backs up the configuration, starts macUpdaterScript detached and
 *      quits without closing any AI client.
 *   3. The script waits until no process runs from the bundle, renames the
 *      old bundle aside and the new one into place, checks it, reopens it and
 *      removes the old one. On any failure it puts the old bundle back and
 *      reopens that. It writes a one-line result the next check reports.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { PRODUCT_NAME, BUNDLE_ID } = require('./core/product');
const { UpdateError, compareVersions } = require('./updater');

const STAGING_PREFIX = `.${PRODUCT_NAME}.update-`;
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_ASAR_HEADER = 64 * 1024 * 1024;
const MAX_BUILD_INFO = 64 * 1024;

// Electron's fs treats a path through app.asar as a folder; the bundle is
// handled as plain files (reading the archive, removing a copy).
function rawFs() {
  try {
    return require('original-fs');
  } catch (_error) {
    return require('node:fs');
  }
}

function readExactly(fsImpl, descriptor, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const read = fsImpl.readSync(descriptor, buffer, done, buffer.length - done, position + done);
    if (read <= 0) throw new Error('asar-truncated');
    done += read;
  }
}

/**
 * One top-level packed file from an asar archive (header layout as in
 * scripts/verify-electron-package-integrity.js).
 * @returns {Buffer}
 */
function readAsarFile(asarPath, name, fsImpl = rawFs(), maxBytes = MAX_BUILD_INFO) {
  const descriptor = fsImpl.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    readExactly(fsImpl, descriptor, prefix, 0);
    const headerPickleBytes = prefix.readUInt32LE(4);
    const headerStringBytes = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || headerPickleBytes > MAX_ASAR_HEADER || headerStringBytes + 8 > headerPickleBytes) {
      throw new Error('asar-header-invalid');
    }
    const headerText = Buffer.alloc(headerStringBytes);
    readExactly(fsImpl, descriptor, headerText, 16);
    const entry = JSON.parse(headerText.toString('utf8'))?.files?.[name];
    const size = entry?.size;
    const offset = Number(entry?.offset);
    if (!entry || entry.unpacked || entry.files || !Number.isSafeInteger(size) || size < 0 || size > maxBytes || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('asar-entry-invalid');
    }
    const data = Buffer.alloc(size);
    readExactly(fsImpl, descriptor, data, 8 + headerPickleBytes + offset);
    return data;
  } finally {
    fsImpl.closeSync(descriptor);
  }
}

// The commit the package records (scripts/build-info.js), read from its
// app.asar without running it.
function readAppBuildInfo(appPath, fsImpl = rawFs()) {
  const asar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const record = JSON.parse(readAsarFile(asar, 'build-info.json', fsImpl).toString('utf8'));
  const commit = typeof record?.commit === 'string' && COMMIT.test(record.commit) ? record.commit : null;
  return { commit, dirty: typeof record?.dirty === 'boolean' ? record.dirty : null };
}

async function plistValue(run, plist, key) {
  try {
    return String(await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).trim();
  } catch (_error) {
    return null;
  }
}

/**
 * The checks every copy passes before it may replace the installed app: the
 * one inside the DMG and the staged copy.
 * @param {string} appPath
 * @param {{ commit?: string|null, version?: string|null, notOlderThan?: string|null }} expected
 * @param {{ run: (file: string, args: string[]) => Promise<string>, fs?: any, readBuildInfo?: Function }} deps
 */
async function verifyMacApp(appPath, expected, deps) {
  const fsImpl = deps.fs || rawFs();
  let stat;
  try {
    stat = fsImpl.lstatSync(appPath);
  } catch (_error) {
    throw new UpdateError('app-missing');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !fsImpl.existsSync(path.join(appPath, 'Contents', 'MacOS', PRODUCT_NAME))) {
    throw new UpdateError('app-missing');
  }
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (await plistValue(deps.run, plist, 'CFBundleIdentifier') !== BUNDLE_ID) throw new UpdateError('bundle-id-mismatch');
  try {
    await deps.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  } catch (_error) {
    throw new UpdateError('signature-invalid');
  }
  let info;
  try {
    info = (deps.readBuildInfo || readAppBuildInfo)(appPath, fsImpl);
  } catch (_error) {
    throw new UpdateError('build-info-unreadable');
  }
  if (expected.commit && info.commit !== expected.commit) throw new UpdateError('commit-mismatch');
  const version = await plistValue(deps.run, plist, 'CFBundleShortVersionString');
  if (expected.version && version !== expected.version) throw new UpdateError('version-mismatch');
  if (expected.notOlderThan) {
    const order = compareVersions(version, expected.notOlderThan);
    if (order === null || order < 0) throw new UpdateError('version-mismatch');
  }
  return { bundleId: BUNDLE_ID, version, commit: info.commit };
}

function stagingPath(target, token) {
  return path.join(path.dirname(target), `${STAGING_PREFIX}${token}.app`);
}

// Only a bundle this module named, next to the target, is ever removed.
function removeStaged(fsImpl, staged, target) {
  if (path.dirname(staged) !== path.dirname(target) || !path.basename(staged).startsWith(STAGING_PREFIX)) return;
  try {
    fsImpl.rmSync(staged, { recursive: true, force: true });
  } catch (_error) { /* best effort; the next update removes it */ }
}

// Copies left by an update that was interrupted before the swap.
function removeStaleStaging(fsImpl, target) {
  let names = [];
  try {
    names = fsImpl.readdirSync(path.dirname(target));
  } catch (_error) {
    return;
  }
  for (const name of names) {
    if (name.startsWith(STAGING_PREFIX) && name.endsWith('.app')) removeStaged(fsImpl, path.join(path.dirname(target), name), target);
  }
}

async function detach(run, mountPoint) {
  try {
    await run('/usr/bin/hdiutil', ['detach', mountPoint]);
    return true;
  } catch (_error) {
    try {
      await run('/usr/bin/hdiutil', ['detach', '-force', mountPoint]);
      return true;
    } catch (_forceError) {
      return false;
    }
  }
}

/**
 * Steps 1 of the header: mount, check, stage, check again, unmount. Returns
 * the staged bundle, which only the updater script moves into place.
 * @param {{ dmgPath: string, workDir: string, target: string,
 *   expected: { commit?: string|null, version?: string|null, notOlderThan?: string|null },
 *   deps: { run: (file: string, args: string[]) => Promise<string>, fs?: any, token?: string, readBuildInfo?: Function },
 *   onStage?: (stage: string) => void }} options
 */
async function prepareMacUpdate(options) {
  const { dmgPath, workDir, target, expected, deps } = options;
  const onStage = options.onStage || (() => {});
  const fsImpl = deps.fs || rawFs();
  const token = deps.token || `${process.pid}-${crypto.randomUUID()}`;
  const mountPoint = path.join(workDir, `mount-${token}`);
  const staged = stagingPath(target, token);
  removeStaleStaging(fsImpl, target);
  fsImpl.mkdirSync(mountPoint, { mode: 0o700 });

  onStage('mounting');
  try {
    await deps.run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, dmgPath]);
  } catch (_error) {
    try { fsImpl.rmdirSync(mountPoint); } catch (_cleanup) { /* best effort */ }
    throw new UpdateError('mount-failed');
  }

  try {
    onStage('checking');
    const source = path.join(mountPoint, `${PRODUCT_NAME}.app`);
    const checked = await verifyMacApp(source, expected, { ...deps, fs: fsImpl });
    onStage('staging');
    try {
      await deps.run('/usr/bin/ditto', ['--noqtn', source, staged]);
    } catch (_error) {
      throw new UpdateError('staging-failed');
    }
    await verifyMacApp(staged, expected, { ...deps, fs: fsImpl });
    return { staged, target, checked };
  } catch (error) {
    removeStaged(fsImpl, staged, target);
    throw error;
  } finally {
    // Never remove a folder that may still be a mount point, only an empty one.
    if (await detach(deps.run, mountPoint)) {
      try { fsImpl.rmdirSync(mountPoint); } catch (_cleanup) { /* best effort */ }
    }
  }
}

/**
 * Step 3. ASCII /bin/sh, arguments: Catshelf's pid, the staged bundle, the
 * target bundle, the result file. Every program by absolute path.
 */
function macUpdaterScript() {
  return [
    '#!/bin/sh',
    `# ${PRODUCT_NAME} macOS updater, written by src/update-mac.js. Started detached`,
    `# just before ${PRODUCT_NAME} quits; replaces the bundle only once no process runs from it.`,
    'PID="$1"',
    'STAGED="$2"',
    'TARGET="$3"',
    'RESULT="$4"',
    `ROLLBACK="$(/usr/bin/dirname "$TARGET")/.${PRODUCT_NAME}.rollback-$$.app"`,
    'LOG="$RESULT.log"',
    ': > "$LOG"',
    'finish() {',
    '  printf \'{"schemaVersion":1,"ok":%s,"code":"%s","at":%s}\\n\' "$1" "$2" "$(/bin/date +%s)" > "$RESULT.tmp" && /bin/mv -f "$RESULT.tmp" "$RESULT"',
    '}',
    'valid() {',
    '  /usr/bin/codesign --verify --deep --strict "$1" >>"$LOG" 2>&1 || return 1',
    `  [ "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$1/Contents/Info.plist" 2>>"$LOG")" = "${BUNDLE_ID}" ]`,
    '}',
    'fail() {',
    '  if [ ! -e "$TARGET" ] && [ -d "$ROLLBACK" ]; then /bin/mv "$ROLLBACK" "$TARGET" >>"$LOG" 2>&1; fi',
    '  /bin/rm -rf "$STAGED"',
    '  finish false "$1"',
    '  if [ -d "$TARGET" ] && ! /bin/kill -0 "$PID" 2>/dev/null; then /usr/bin/open "$TARGET"; fi',
    '  /bin/rm -f "$0"',
    '  exit 1',
    '}',
    'i=0',
    'while /bin/kill -0 "$PID" 2>/dev/null; do',
    '  i=$((i + 1)); [ "$i" -gt 300 ] && fail quit-timeout',
    '  /bin/sleep 0.2',
    'done',
    '# Helpers, a --cli run or another user may still run from the bundle.',
    'i=0',
    'while /usr/bin/pgrep -f "^$TARGET/" >/dev/null 2>&1; do',
    '  i=$((i + 1)); [ "$i" -gt 150 ] && fail bundle-in-use',
    '  /bin/sleep 0.2',
    'done',
    'valid "$STAGED" || fail installed-invalid',
    'if [ -e "$TARGET" ]; then /bin/mv "$TARGET" "$ROLLBACK" >>"$LOG" 2>&1 || fail swap-failed; fi',
    '/bin/mv "$STAGED" "$TARGET" >>"$LOG" 2>&1 || fail swap-failed',
    'if ! valid "$TARGET"; then',
    '  /bin/mv "$TARGET" "$STAGED" >>"$LOG" 2>&1 || /bin/rm -rf "$TARGET"',
    '  fail installed-invalid',
    'fi',
    'finish true installed',
    '/usr/bin/open "$TARGET"',
    '/bin/rm -rf "$ROLLBACK"',
    '/bin/rm -f "$0"',
    ''
  ].join('\n');
}

module.exports = {
  STAGING_PREFIX,
  macUpdaterScript,
  prepareMacUpdate,
  rawFs,
  readAppBuildInfo,
  readAsarFile,
  removeStaged,
  stagingPath,
  verifyMacApp
};
