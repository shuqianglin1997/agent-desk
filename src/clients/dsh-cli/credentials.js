'use strict';

// DSH: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const fs = require('node:fs');
const path = require('node:path');
const { ensurePrivateDirectory, readOptional, writePrivateFile, setYamlRef, readYamlBlockKeys, homeOf, readOptionalQuiet } = require('../credential-files');

function writeDshRefs(profile, refs) {
  const home = homeOf(profile);
  ensurePrivateDirectory(home);
  if (process.platform !== 'win32') fs.chmodSync(home, 0o700);
  const file = path.join(home, '.credentials.yaml');
  let text = readOptional(file);
  for (const [key, value] of Object.entries(refs)) text = setYamlRef(text, key, value);
  writePrivateFile(file, text);
}

module.exports = {
  async setKey(profile, secret) {
    writeDshRefs(profile, { DEEPSEEK_API_KEY: secret });
    return { method: 'api-key', via: 'credentials-file', storedInPlaintext: true };
  },
  async setProvider(profile, secret, provider) {
    writeDshRefs(profile, { DEEPSEEK_API_KEY: secret, DEEPSEEK_BASE_URL: provider.baseUrl });
    return { method: 'provider', via: 'credentials-file', storedInPlaintext: true };
  },
  status(profile) {
    const file = path.join(homeOf(profile), '.credentials.yaml');
    const text = readOptionalQuiet(file);
    if (text === null) return { signedIn: false, method: null };
    if (process.platform !== 'win32') {
      try { if (fs.statSync(file).mode & 0o077) return { signedIn: false, method: null, note: 'credentials-permissions-open' }; } catch (_error) { /* raced */ }
    }
    const refs = readYamlBlockKeys(text, 'refs');
    const records = readYamlBlockKeys(text, 'records');
    if (Object.keys(records).some((key) => key === 'deepseek-account-platform/default')) return { signedIn: true, method: 'subscription' };
    if (refs.DEEPSEEK_API_KEY) return { signedIn: true, method: refs.DEEPSEEK_BASE_URL ? 'provider' : 'api-key' };
    return { signedIn: false, method: null };
  }
};
