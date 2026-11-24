'use strict';

// OpenCode: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CredentialError, PROVIDER_ID, ensurePrivateDirectory, serialized, officialEnvironment, runOfficial, homeOf, readJson } = require('../credential-files');

function openCodeCredentialTypes(dataDirectory) {
  const types = [];
  for (const entry of (() => { try { return fs.readdirSync(dataDirectory); } catch (_error) { return []; } })()) {
    if (!/^opencode(?:-[\w.-]+)?\.db$/.test(entry)) continue;
    let db;
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(path.join(dataDirectory, entry), { readOnly: true });
      // Only the credential kind is read; the value column never leaves SQLite.
      const rows = db.prepare("SELECT json_extract(value, '$.type') AS type FROM credential WHERE active = 1").all();
      types.push(...rows.map((row) => row.type));
    } catch (_error) {
      // No credential table yet, or an older layout.
    } finally {
      try { db?.close(); } catch (_error) { /* closed */ }
    }
  }
  return types;
}

function credentialId() {
  return `cred_${Date.now().toString(16).padStart(12, '0')}${crypto.randomBytes(8).toString('hex')}`;
}

// Copy an `opencode auth export` file into an account by running the
// official import in that account's home. The file path is not a secret; the
// export's contents are read by OpenCode itself.
async function importExport(profile, filePath, context = {}) {
  ensurePrivateDirectory(homeOf(profile));
  const launcher = context.findLauncher?.('opencode');
  if (!launcher) throw new CredentialError('official-client-missing');
  const result = await serialized('opencode', () => runOfficial({
    launcher, args: ['--standalone', 'auth', 'import', filePath], env: officialEnvironment(profile, context.env || process.env), spawnImpl: context.spawnImpl
  }));
  if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
  return { method: 'api-key', via: 'official-file' };
}

module.exports = {
  async setKey(profile, secret, context, options = {}) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const integration = String(options.catalogProviderId || '').trim().toLowerCase();
    if (!PROVIDER_ID.test(integration)) throw new CredentialError('provider-id-invalid');
    const launcher = context.findLauncher('opencode');
    if (!launcher) throw new CredentialError('official-client-missing');
    // `auth import` reads an export-shaped array from standard input.
    const payload = JSON.stringify([{ id: credentialId(), integrationID: integration, label: 'AgentDesk', active: true, value: { type: 'key', key: secret } }]);
    const result = await serialized('opencode', () => runOfficial({
      launcher, args: ['--standalone', 'auth', 'import'], env: officialEnvironment(profile, context.env), input: payload, spawnImpl: context.spawnImpl
    }));
    if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
    return { method: 'api-key', via: 'official-stdin', storedInPlaintext: true };
  },
  status(profile) {
    const home = homeOf(profile);
    const types = openCodeCredentialTypes(home);
    if (types.length) return { signedIn: true, method: types.includes('oauth') ? 'oauth' : 'api-key' };
    const legacy = readJson(path.join(home, 'auth.json'));
    const entries = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? Object.values(legacy) : [];
    if (entries.some((entry) => entry && typeof entry === 'object' && entry.type)) {
      return { signedIn: true, method: entries.some((entry) => entry.type === 'oauth') ? 'oauth' : 'api-key' };
    }
    return { signedIn: false, method: null };
  },
  officialStatus: { toolId: 'opencode', args: ['--standalone', 'auth', 'list', '--format', 'json'], parseList: true },
  importExport
};
