'use strict';

// Codex: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const path = require('node:path');
const { CredentialError, ensurePrivateDirectory, readOptional, writePrivateFile, backupOnce, tomlString, splitLines, setTomlTopLevel, replaceTomlTable, parseTomlSubset, setDotenv, readDotenvValue, serialized, officialEnvironment, runOfficial, homeOf, readOptionalQuiet, readJson } = require('../credential-files');

function codexEnvKey(id) {
  return `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

function ensureCodexFileStore(home) {
  const file = path.join(home, 'config.toml');
  const text = readOptional(file);
  const config = parseTomlSubset(text || '');
  if (config.cli_auth_credentials_store === 'file') return;
  backupOnce(file, text);
  const lines = setTomlTopLevel(splitLines(text), 'cli_auth_credentials_store', tomlString('file'));
  writePrivateFile(file, `${lines.join('\n')}\n`);
}

module.exports = {
  async setKey(profile, secret, context) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    ensureCodexFileStore(home);
    const launcher = context.findLauncher('codex');
    if (!launcher) throw new CredentialError('official-client-missing');
    const result = await serialized('codex', () => runOfficial({
      launcher, args: ['login', '--with-api-key'], env: officialEnvironment(profile, context.env), input: secret, spawnImpl: context.spawnImpl
    }));
    if (result.code !== 0) throw new CredentialError(result.reasonCode || 'official-command-failed');
    return { method: 'api-key', via: 'official-stdin', storedInPlaintext: false };
  },
  async setProvider(profile, secret, provider) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const envKey = codexEnvKey(provider.id);
    const configFile = path.join(home, 'config.toml');
    const text = readOptional(configFile);
    backupOnce(configFile, text);
    let lines = splitLines(text);
    lines = setTomlTopLevel(lines, 'cli_auth_credentials_store', tomlString('file'));
    lines = setTomlTopLevel(lines, 'model_provider', tomlString(provider.id));
    lines = setTomlTopLevel(lines, 'model', tomlString(provider.model));
    lines = replaceTomlTable(lines, ['model_providers', provider.id], [
      `name = ${tomlString(provider.id)}`,
      `base_url = ${tomlString(provider.baseUrl)}`,
      `env_key = ${tomlString(envKey)}`,
      `wire_api = ${tomlString('responses')}`
    ]);
    const envFile = path.join(home, '.env');
    const envText = setDotenv(readOptional(envFile), envKey, secret);
    writePrivateFile(envFile, envText);
    writePrivateFile(configFile, `${lines.join('\n')}\n`);
    return { method: 'provider', via: 'config-file', storedInPlaintext: true };
  },
  status(profile) {
    const home = homeOf(profile);
    const auth = readJson(path.join(home, 'auth.json'));
    const present = (value) => typeof value === 'string' && value.trim().length > 0;
    if (auth && present(auth.tokens?.refresh_token) && (auth.auth_mode == null || auth.auth_mode === 'chatgpt')) return { signedIn: true, method: 'chatgpt' };
    if (auth && present(auth.OPENAI_API_KEY)) return { signedIn: true, method: 'api-key' };
    const config = parseTomlSubset(readOptionalQuiet(path.join(home, 'config.toml')) || '');
    const providerId = typeof config.model_provider === 'string' ? config.model_provider : null;
    const envKey = providerId && config.model_providers?.[providerId]?.env_key;
    if (envKey && readDotenvValue(readOptionalQuiet(path.join(home, '.env')) || '', envKey)) return { signedIn: true, method: 'provider' };
    return { signedIn: false, method: null, ...(config.cli_auth_credentials_store && config.cli_auth_credentials_store !== 'file' ? { note: 'credentials-store-not-file' } : {}) };
  },
  officialStatus: { toolId: 'codex', args: ['login', 'status'] }
};
