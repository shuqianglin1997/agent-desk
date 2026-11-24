'use strict';

/*
 * AgentDesk — hand a pasted key or token to the account's own client.
 *
 * AgentDesk never keeps a key, token or password. A pasted value is passed to
 * the official client of that one account — on its standard input, through the
 * one environment variable the client documents for the purpose (only to that
 * child process), or into the client's own documented configuration file
 * inside that account's home — and is then dropped. It never goes into
 * AgentDesk storage, logs, argv, error text or command output.
 *
 * Every write is merge-preserving (other settings stay), atomic (temporary file
 * in the same folder, then rename) and private (0600 files, 0700 folders).
 * Status checks report only whether a sign-in is present and its kind.
 */

const apps = require('./apps');
const credentialFiles = require('./clients/credential-files');
const { CredentialError, PROVIDER_ID, MODEL_ID, serialized, runOfficial, officialEnvironment } = credentialFiles;

// Printable ASCII without quotes, backslash, backtick, dollar or space: safe as
// a literal in .env (single quotes), TOML/JSON strings and YAML single quotes.
const SECRET_PATTERN = /^[\x21\x23\x25\x26\x28-\x5b\x5d-\x5f\x61-\x7e]{8,4096}$/;

function normalizeSecret(value) {
  const text = typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : '';
  if (!SECRET_PATTERN.test(text)) throw new CredentialError('secret-invalid');
  return text;
}

function normalizeProvider(appId, input = {}) {
  const descriptor = credentialDescriptor(appId);
  const required = descriptor?.provider?.fields || [];
  const optional = descriptor?.provider?.optional || [];
  const fields = [...required, ...optional.filter((field) => String(input[field] || '').trim())];
  const provider = {};
  if (fields.includes('id')) {
    const id = String(input.id || '').trim().toLowerCase();
    // Some clients reserve provider ids for their built-in providers.
    if (!PROVIDER_ID.test(id) || (descriptor?.provider?.reservedIds || []).includes(id)) throw new CredentialError('provider-id-invalid');
    provider.id = id;
  }
  if (fields.includes('baseUrl')) {
    let url;
    try { url = new URL(String(input.baseUrl || '').trim()); } catch (_error) { throw new CredentialError('provider-url-invalid'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password
      || url.href.length > 512 || /[\s"'\\`$]/.test(url.href)) {
      throw new CredentialError('provider-url-invalid');
    }
    provider.baseUrl = url.href.replace(/\/$/, '');
  }
  if (fields.includes('model')) {
    const model = String(input.model || '').trim();
    if (!MODEL_ID.test(model)) throw new CredentialError('provider-model-invalid');
    provider.model = model;
  }
  return provider;
}

function credentialDescriptor(appId) {
  return apps.isKnownApp(appId) ? apps.getApp(appId).credentials || null : null;
}

// Copy a client's exported sign-in file into an account by running the
// official import in that account's home (OpenCode's `auth export`). The file
// path is not a secret; its contents are read by the client itself.
async function importOpenCodeExport(profile, filePath, context = {}) {
  const adapter = handoffFor(profile);
  if (!adapter?.importExport) throw new CredentialError('credential-method-unsupported');
  return adapter.importExport(profile, filePath, context);
}

// The client's key hand-off (src/clients/<id>/credentials.js), or null.
function handoffFor(profile) {
  return apps.isKnownApp(profile?.appId) ? apps.getApp(profile.appId).credentialHandoff || null : null;
}

function adapterFor(profile) {
  const adapter = handoffFor(profile);
  if (!adapter) throw new CredentialError('credential-method-unsupported');
  return adapter;
}

/**
 * Hand a pasted secret to the profile's client. `method` is 'key' or
 * 'provider'. The returned object never contains the secret.
 */
async function applySecret(profile, request, context = {}) {
  const descriptor = credentialDescriptor(profile?.appId);
  const method = request?.method === 'provider' ? 'provider' : 'key';
  if (!descriptor?.[method]) throw new CredentialError('credential-method-unsupported');
  const adapter = adapterFor(profile);
  let secret = normalizeSecret(request?.secret);
  const ctx = {
    env: context.env || process.env,
    home: context.home,
    spawnImpl: context.spawnImpl,
    findLauncher: context.findLauncher || (() => null)
  };
  try {
    if (method === 'provider') {
      const provider = normalizeProvider(profile.appId, request.provider);
      return { ...(await adapter.setProvider(profile, secret, provider, ctx)), plaintextWarning: Boolean(descriptor.provider.plaintext) };
    }
    const options = {};
    if (descriptor.key.catalogProvider) {
      options.catalogProviderId = request.catalogProviderId;
      if (request.model) {
        if (!MODEL_ID.test(String(request.model))) throw new CredentialError('provider-model-invalid');
        options.model = String(request.model);
      }
    }
    return { ...(await adapter.setKey(profile, secret, ctx, options)), plaintextWarning: Boolean(descriptor.key.plaintext) };
  } finally {
    secret = null;
  }
}

/**
 * Report whether the account is signed in using each client's success check.
 * `official: true` also runs the client's own status command when it has one.
 */
async function credentialStatus(profile, context = {}) {
  const adapter = handoffFor(profile);
  if (!adapter) return { supported: false, signedIn: null, method: null, verifiedBy: null };
  let result;
  try { result = adapter.status(profile, context); } catch (_error) { result = { signedIn: false, method: null, note: 'home-unreadable' }; }
  const status = { supported: true, signedIn: result.signedIn, method: result.method, verifiedBy: 'files', ...(result.note ? { note: result.note } : {}) };
  const official = adapter.officialStatus;
  if (!context.official || !official) return status;
  const launcher = context.findLauncher?.(official.toolId);
  if (!launcher) return { ...status, officialCheck: 'client-missing' };
  const run = await serialized(profile.appId, () => runOfficial({
    launcher, args: official.args, env: officialEnvironment(profile, context.env || process.env), timeoutMs: 20_000, spawnImpl: context.spawnImpl
  }));
  if (run.code === null) return { ...status, officialCheck: run.reasonCode };
  if (official.parseList) {
    let listed = null;
    try { listed = JSON.parse(run.stdout); } catch (_error) { /* not JSON */ }
    const signedIn = run.code === 0 && Array.isArray(listed) && listed.length > 0;
    return { supported: true, signedIn, method: signedIn ? status.method || 'api-key' : null, verifiedBy: 'official', officialCheck: 'ok' };
  }
  let method = status.method;
  if (official.parseMethod && run.code === 0) {
    try {
      const reported = JSON.parse(run.stdout).authMethod;
      const known = { 'claude.ai': 'subscription', oauth_token: 'oauth-token', api_key: 'api-key', api_key_helper: 'api-key', third_party: 'provider' };
      if (Object.hasOwn(known, reported)) method = known[reported];
    } catch (_error) { /* keep the file result */ }
  }
  return { supported: true, signedIn: run.code === 0, method: run.code === 0 ? method : null, verifiedBy: 'official', officialCheck: 'ok' };
}

// The rest of the former exports, kept for their callers.
const { KIMI_CODE_BASE_URL } = require('./clients/kimi/credentials');

module.exports = {
  CredentialError,
  KIMI_CODE_BASE_URL,
  applySecret,
  importOpenCodeExport,
  credentialDescriptor,
  credentialStatus,
  normalizeProvider,
  normalizeSecret,
  parseTomlSubset: credentialFiles.parseTomlSubset,
  readYamlBlockKeys: credentialFiles.readYamlBlockKeys,
  replaceTomlTable: credentialFiles.replaceTomlTable,
  runOfficial,
  setDotenv: credentialFiles.setDotenv,
  setTomlTopLevel: credentialFiles.setTomlTopLevel,
  setYamlRef: credentialFiles.setYamlRef,
  splitLines: credentialFiles.splitLines,
  writePrivateFile: credentialFiles.writePrivateFile,
  ensurePrivateDirectory: credentialFiles.ensurePrivateDirectory,
  readOptional: credentialFiles.readOptional
};
