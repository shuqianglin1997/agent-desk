'use strict';

// Kimi Code: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const path = require('node:path');
const { CredentialError, PROVIDER_ID, ensurePrivateDirectory, readOptional, writePrivateFile, tomlString, splitLines, setTomlTopLevel, replaceTomlTable, parseTomlSubset, serialized, officialEnvironment, runOfficial, homeOf, tightenFile, readOptionalQuiet, readJson } = require('../credential-files');

const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/v1';

module.exports = {
  async setKey(profile, secret, context, options = {}) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const catalogId = String(options.catalogProviderId || '').trim().toLowerCase();
    if (!PROVIDER_ID.test(catalogId)) throw new CredentialError('provider-id-invalid');
    const launcher = context.findLauncher('kimi');
    if (!launcher) throw new CredentialError('official-client-missing');
    // `kimi provider catalog add` accepts the key only as --api-key or this
    // documented variable; it goes to this one child, never to argv.
    const result = await serialized('kimi', () => runOfficial({
      launcher,
      args: ['provider', 'catalog', 'add', catalogId, ...(options.model ? ['--default-model', options.model] : [])],
      env: officialEnvironment(profile, context.env, { KIMI_REGISTRY_API_KEY: secret }),
      spawnImpl: context.spawnImpl
    }));
    if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
    tightenFile(path.join(home, 'config.toml'));
    return { method: 'api-key', via: 'official-env', storedInPlaintext: true };
  },
  async setProvider(profile, secret, provider) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const file = path.join(home, 'config.toml');
    const text = readOptional(file);
    const alias = `${provider.id}/${provider.model}`;
    let lines = splitLines(text);
    lines = setTomlTopLevel(lines, 'default_model', tomlString(alias));
    lines = replaceTomlTable(lines, ['providers', provider.id], [
      `type = ${tomlString('openai')}`,
      `base_url = ${tomlString(provider.baseUrl)}`,
      `api_key = ${tomlString(secret)}`
    ]);
    lines = replaceTomlTable(lines, ['models', alias], [
      `provider = ${tomlString(provider.id)}`,
      `model = ${tomlString(provider.model)}`
    ]);
    writePrivateFile(file, `${lines.join('\n')}\n`);
    return { method: 'provider', via: 'config-file', storedInPlaintext: true };
  },
  status(profile) {
    const home = homeOf(profile);
    const config = parseTomlSubset(readOptionalQuiet(path.join(home, 'config.toml')) || '');
    const providers = config.providers && typeof config.providers === 'object' ? config.providers : {};
    const credentialsDirectory = path.join(home, 'credentials');
    let tokenRevoked = false;
    for (const [id, provider] of Object.entries(providers)) {
      const key = provider?.oauth?.key;
      if (typeof key !== 'string' || !key.startsWith('oauth/')) continue;
      const credentials = readJson(path.join(credentialsDirectory, `${key.slice('oauth/'.length).replace(/[^A-Za-z0-9._-]/g, '')}.json`));
      if (!credentials) continue;
      if (typeof credentials.access_token === 'string' && credentials.access_token.length > 0) {
        return { signedIn: true, method: id.startsWith('managed:') ? 'subscription' : 'oauth' };
      }
      tokenRevoked = true;
    }
    const modelAlias = typeof config.default_model === 'string' ? config.default_model : null;
    const providerId = modelAlias ? config.models?.[modelAlias]?.provider : null;
    const selected = providerId ? providers[providerId] : null;
    if (selected && ((typeof selected.api_key === 'string' && selected.api_key) || selected.api_key_env)) {
      return { signedIn: true, method: 'provider' };
    }
    return { signedIn: false, method: null, ...(tokenRevoked ? { note: 'token-revoked' } : {}) };
  },
  KIMI_CODE_BASE_URL
};
