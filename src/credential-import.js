'use strict';

/*
 * Copy a dropped or chosen sign-in file into a new isolated home.
 *
 * Copying a sign-in moves it: most refresh tokens are single use, so the
 * original place may sign out later. Callers must say so before copying.
 * Files are read with a size limit and without following links, checked for
 * the client's shape, and written 0600 in a new 0700 home that AgentDesk just
 * reserved. Nothing is logged; failures use fixed reason codes.
 */

const fs = require('node:fs');
const path = require('node:path');
const apps = require('./apps');
const { ImportError, readSmallFile } = require('./clients/import-files');

// Clients that copy a sign-in file into a new home (src/clients/<id>/import.js).
// Codex reads its own auth.json and plans the import itself.
const importerOf = (appId) => (apps.isKnownApp(appId) ? apps.getApp(appId).credentialImport || null : null);
const IMPORTERS = Object.freeze(Object.fromEntries(apps.appIds()
  .filter((appId) => typeof importerOf(appId)?.stage === 'function')
  .map((appId) => [appId, importerOf(appId)])));

function importerFor(appId, platform = process.platform) {
  const importer = IMPORTERS[appId];
  if (!importer) return null;
  if (importer.platforms && !importer.platforms.includes(platform)) return null;
  return importer;
}

// Which client does a dropped file belong to? Each client names the files it
// takes; where two take the same name (auth.json), the one whose content check
// passes wins, otherwise the one without a check. A .json no client names may
// still be recognised by its content.
function clientForCredentialFile(filePath, platform = process.platform) {
  const name = path.basename(String(filePath || ''));
  let content;
  const readContent = () => {
    if (content === undefined) {
      try { content = JSON.parse(readSmallFile(filePath).toString('utf8')); } catch (_error) { content = null; }
    }
    return content;
  };
  const named = apps.appIds().filter((appId) => importerOf(appId)?.fileNames?.includes(name));
  const appId = named.find((id) => importerOf(id).matchesContent?.(readContent()))
    || named.find((id) => !importerOf(id).matchesContent);
  if (appId) return (typeof importerOf(appId).stage !== 'function' || importerFor(appId, platform)) ? appId : { unsupported: appId };
  if (name.endsWith('.json')) {
    const byContent = apps.appIds().find((id) => importerOf(id)?.matchesAnyJson?.(readContent()));
    if (byContent) return byContent;
  }
  return null;
}

function sameImportedFile(profiles, appId, bytes) {
  const importer = IMPORTERS[appId];
  return profiles.find((profile) => {
    if (profile.appId !== appId || profile.credentialImported !== appId || !profile.sessionRoot) return false;
    try { return fs.readFileSync(importer.stagedFile(profile)).equals(bytes); } catch (_error) { return false; }
  }) || null;
}

// Reserve a brand-new managed home, then stage. Returns a cleanup that removes
// only what was created here.
function stageNewHome(appId, profile, payload) {
  const importer = IMPORTERS[appId];
  fs.mkdirSync(path.dirname(profile.profilePath), { recursive: true });
  fs.mkdirSync(profile.profilePath, { mode: 0o700 });
  const cleanup = () => fs.rmSync(profile.profilePath, { recursive: true, force: true });
  try {
    importer.stage(profile, payload);
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

// Former exports, kept for their callers.
const { isOpenCodeExport } = require('./clients/opencode/import');
const { kimiConfigSection } = require('./clients/kimi/import');

module.exports = { IMPORTERS, ImportError, isOpenCodeExport, clientForCredentialFile, importerFor, kimiConfigSection, sameImportedFile, stageNewHome, readSmallFile };
