'use strict';

// AgentDesk — what a person does with chosen sessions: show a session file, open
// its folder, export it, after a fresh scan on the worker thread. Main
// re-resolves every session by id; the window never sends paths. Moved out of
// src/main.js unchanged; Main's services come through `main`.

const apps = require('../apps');
const path = require('node:path');
const { nearestExistingDirectory } = require('../path-utils');
const { prepareSessionExport } = require('../session-export');
const { resolveLocalSessions, sessionDirectories } = require('./session-actions');
const { writeFileAtomicAsync } = require('../core/json-file');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

async function refreshForAction(profileIds) {
  const wanted = new Set((profileIds || []).filter((id) => typeof id === 'string' && id && id.length <= 128));
  const profiles = main.loadProfiles().filter((profile) => wanted.has(String(profile.id)));
  await main.sessionIndex.refresh(profiles, { maxAgeMs: 0 }).catch(() => null);
}

function selectionProfileIds(input) {
  const refs = Array.isArray(input?.selections) ? input.selections : [input];
  return refs.slice(0, 500).map((ref) => ref?.profileId);
}

async function listSessionDirectories(input) {
  try {
    await refreshForAction(selectionProfileIds(input));
    const records = resolveLocalSessions(input, main.loadProfiles(), apps.getApp, main.actionRowsOf);
    return { ok: true, directories: sessionDirectories(records) };
  } catch (_error) {
    return { ok: false, reason: main.t('main.sessionActions.directoryUnavailable') };
  }
}

async function openSessionDirectory(input) {
  const result = await listSessionDirectories({ profileId: input?.profileId, sessionId: input?.sessionId });
  const directory = result.directories?.[0]?.path;
  // The UI may send the directory it offered as a check only. The actual open
  // target always comes from the current session record and never from IPC.
  if (!directory || typeof input?.expectedPath !== 'string' || !main.pathsEqual(directory, input.expectedPath)) {
    return { ok: false, reason: main.t('main.sessionActions.directoryUnavailable') };
  }
  try {
    if (await main.shell.openPath(directory)) return { ok: false, reason: main.t('main.sessionActions.directoryUnavailable') };
    return { ok: true };
  } catch (_error) {
    return { ok: false, reason: main.t('main.sessionActions.directoryUnavailable') };
  }
}

async function exportSessionTranscript(input) {
  let exported;
  try {
    await refreshForAction(selectionProfileIds(input));
    const records = resolveLocalSessions(input, main.loadProfiles(), apps.getApp, main.actionRowsOf);
    const unsupported = records.find(({ client }) => typeof client.exportTranscript !== 'function');
    if (unsupported) return { ok: false, reason: main.t('main.exp.notSupported', { label: unsupported.client.label }) };
    exported = await prepareSessionExport(records, { attachmentsHeading: main.t('main.sessionActions.attachments') });
  } catch (error) {
    const message = error.message === 'session-export-too-large' ? 'main.sessionActions.exportTooLarge'
      : error.message === 'session-not-found' ? 'main.exp.sessionNotFound' : 'main.sessionActions.exportUnavailable';
    return { ok: false, reason: main.t(message) };
  }

  const result = await main.dialog.showSaveDialog(main.mainWindow, {
    title: main.t('main.sessionActions.saveTitle'),
    defaultPath: path.join(main.app.getPath('desktop'), exported.suggestedName),
    filters: [{ name: exported.format === 'zip' ? 'ZIP' : 'Markdown', extensions: [exported.format] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true, reason: main.t('main.exp.cancelled') };

  try {
    // A complete file next to the target, renamed into place (as before, without fsync).
    await writeFileAtomicAsync(result.filePath, exported.data, { fsync: false });
  } catch (_error) {
    return { ok: false, reason: main.t('main.sessionActions.writeUnavailable') };
  }
  return {
    ok: true,
    savedPath: result.filePath,
    format: exported.format,
    attachmentCount: exported.attachmentCount,
    message: main.t('main.exp.done', { path: result.filePath })
  };
}

async function revealSessionFile(input) {
  const profiles = main.loadProfiles();
  const profile = profiles.find((item) => item.id === main.boundedText(input?.profileId, 128));
  if (!profile) return { ok: false, reason: main.t('main.err.slotNotFoundDot') };

  const refreshed = await main.sessionIndex.find(profile, main.boundedText(input?.sessionId, 256), { key: 'id', maxAgeMs: 0 });
  const itemPath = refreshed?.filePath || null;
  const result = await revealPath(itemPath, profile.sessionRoot);
  if (!refreshed && result.ok) {
    return {
      ...result,
      exact: false,
      message: main.t('main.rev.movedOpenedRecent')
    };
  }
  return result;
}

async function revealPath(itemPath, fallbackPath = null) {
  if (!itemPath && !fallbackPath) return { ok: false, reason: main.t('main.rev.noPath') };
  const resolved = nearestExistingDirectory(itemPath, fallbackPath);
  if (!resolved.path) return { ok: false, reason: main.t('main.rev.nothingExists') };

  if (resolved.exact && resolved.originalIsFile && process.platform !== 'win32' && itemPath.length < 240) {
    main.shell.showItemInFolder(itemPath);
    return { ok: true, exact: true, openedPath: resolved.path, message: main.t('main.rev.locatedInFiler') };
  }

  const opened = await openDirectoryWithFallback(resolved.path);
  if (!opened.ok) return opened;
  if (opened.degraded) {
    return {
      ok: true,
      exact: false,
      openedPath: opened.openedPath,
      message: main.t('main.rev.cannotOpenReturned')
    };
  }
  if (resolved.exact && resolved.originalIsFile) {
    return {
      ok: true,
      exact: true,
      openedPath: opened.openedPath,
      message: main.t('main.rev.openedContaining', { name: path.basename(itemPath) })
    };
  }
  if (resolved.exact) {
    return { ok: true, exact: true, openedPath: opened.openedPath, message: main.t('main.rev.openedDir') };
  }
  return {
    ok: true,
    exact: false,
    openedPath: opened.openedPath,
    message: main.t('main.rev.movedOpenedParent')
  };
}

async function openPathSafely(itemPath) {
  return revealPath(itemPath);
}

async function openDirectoryWithFallback(directoryPath) {
  let current = directoryPath;
  let lastError = '';
  while (current) {
    const error = await main.shell.openPath(current);
    if (!error) return { ok: true, openedPath: current, degraded: !main.pathsEqual(current, directoryPath) };
    lastError = error;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { ok: false, reason: lastError || main.t('main.rev.filerCannotOpen') };
}

module.exports = { bind, refreshForAction, selectionProfileIds, listSessionDirectories, openSessionDirectory, exportSessionTranscript, revealSessionFile, revealPath, openPathSafely, openDirectoryWithFallback };
