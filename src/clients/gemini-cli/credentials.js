'use strict';

// Gemini CLI: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const path = require('node:path');
const { ensurePrivateDirectory, readOptional, writePrivateFile, setDotenv, readDotenvValue, homeOf, setSelectedAuthType, readOptionalQuiet, readJson, fileExists } = require('../credential-files');

module.exports = {
  async setKey(profile, secret) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const envFile = path.join(home, '.env');
    writePrivateFile(envFile, setDotenv(readOptional(envFile), 'GEMINI_API_KEY', secret));
    setSelectedAuthType(path.join(home, 'settings.json'), 'gemini-api-key');
    return { method: 'api-key', via: 'config-file', storedInPlaintext: true };
  },
  status(profile) {
    const home = homeOf(profile);
    const oauth = readJson(path.join(home, 'oauth_creds.json'));
    if (typeof oauth?.refresh_token === 'string' && oauth.refresh_token) return { signedIn: true, method: 'oauth' };
    if (readDotenvValue(readOptionalQuiet(path.join(home, '.env')) || '', 'GEMINI_API_KEY')) return { signedIn: true, method: 'api-key' };
    if (fileExists(path.join(home, 'gemini-credentials.json'))) return { signedIn: true, method: 'api-key' };
    return { signedIn: false, method: null };
  }
};
