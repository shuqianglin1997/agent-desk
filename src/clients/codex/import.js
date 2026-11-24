'use strict';

// Codex: a dropped auth.json, read by Codex's own reader (./account-import.js)
// rather than copied byte for byte. A file inside a home that is registered,
// or that discovery would find, registers that home where it is; the same
// sign-in already registered is reused; anything else becomes a new isolated
// home built from this sign-in.

const path = require('node:path');
const { codexProfileAtHome, codexHomeKey, profileWithSameCodexAuth, readCodexAuthFile } = require('./account-import');

function plan(filePath, { profiles, discoverHomes }) {
  const auth = readCodexAuthFile(filePath);
  const sourceHome = path.dirname(filePath);
  const existing = codexProfileAtHome(profiles, sourceHome);
  if (existing) return { action: 'existing', profileId: existing.id };
  const sourceKey = codexHomeKey(sourceHome);
  if (sourceKey && discoverHomes().some(({ directory }) => codexHomeKey(directory) === sourceKey)) {
    return { action: 'register', sourceHome };
  }
  const copied = profileWithSameCodexAuth(profiles, auth);
  if (copied) return { action: 'existing', profileId: copied.id };
  // profileOptions: how Main builds the new profile from this sign-in.
  return { action: 'copy', payload: auth, profileOptions: { codexAuth: auth } };
}

module.exports = { fileNames: Object.freeze(['auth.json']), plan };
