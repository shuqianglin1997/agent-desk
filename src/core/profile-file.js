'use strict';

// AgentDesk — the one reader of profiles.json. It never repairs, migrates or
// writes; the desktop store (recovery, normalisation, saving), the CLI's
// strict view and `profiles discover` apply their own policies on top.
//   readProfileFile(file) -> ok({ parsed, version, profiles, legacyArray })
//                          | fail(missing | not-a-file | unreadable | invalid-json | invalid-shape)
// Accepted shapes: { version, profiles: [...] } and the pre-versioned bare array.

const { ok } = require('./result');
const { readJsonFile } = require('./json-file');

const PROFILE_FILE = 'profiles.json';

/**
 * @param {string} filePath
 * @returns {import('./result').Result<{ parsed: any, version: number, profiles: any[], legacyArray: boolean }>}
 */
function readProfileFile(filePath) {
  const result = readJsonFile(filePath, {
    validate: (value) => Array.isArray(value) || Boolean(value && typeof value === 'object' && Array.isArray(value.profiles))
  });
  if (!result.ok) return result;
  const parsed = result.value;
  const legacyArray = Array.isArray(parsed);
  return ok({
    parsed,
    version: legacyArray ? 0 : (Number.isInteger(parsed.version) ? parsed.version : 0),
    profiles: legacyArray ? parsed : parsed.profiles,
    legacyArray
  });
}

module.exports = { PROFILE_FILE, readProfileFile };
