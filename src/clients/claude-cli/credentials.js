'use strict';

// Claude Code: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const os = require('node:os');
const path = require('node:path');
const { CredentialError, ensurePrivateDirectory, readOptional, writePrivateFile, homeOf, readJson, fileExists, samePath } = require('../credential-files');

function claudeSettingsPath(profile, home = os.homedir()) {
  return path.join(homeOf(profile), 'settings.json');
}

function updateClaudeEnv(profile, mutate) {
  const file = claudeSettingsPath(profile);
  const text = readOptional(file);
  let settings = {};
  if (text !== null && text.trim()) {
    try { settings = JSON.parse(text); } catch (_error) { throw new CredentialError('config-format-unsupported'); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new CredentialError('config-format-unsupported');
  }
  const env = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env) ? { ...settings.env } : {};
  // One sign-in at a time: an older key would otherwise outrank a new token.
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL']) delete env[key];
  mutate(env);
  writePrivateFile(file, `${JSON.stringify({ ...settings, env }, null, 2)}\n`);
}

module.exports = {
  async setKey(profile, secret) {
    ensurePrivateDirectory(homeOf(profile));
    const isOAuthToken = /^sk-ant-oat/i.test(secret);
    updateClaudeEnv(profile, (env) => {
      env[isOAuthToken ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = secret;
    });
    return { method: isOAuthToken ? 'oauth-token' : 'api-key', via: 'settings-file', storedInPlaintext: true };
  },
  async setProvider(profile, secret, provider) {
    ensurePrivateDirectory(homeOf(profile));
    updateClaudeEnv(profile, (env) => {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
      env.ANTHROPIC_AUTH_TOKEN = secret;
      if (provider.model) env.ANTHROPIC_MODEL = provider.model;
    });
    return { method: 'provider', via: 'settings-file', storedInPlaintext: true };
  },
  status(profile, context) {
    const home = homeOf(profile);
    const settings = readJson(path.join(home, 'settings.json'));
    const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
    const present = (key) => typeof env[key] === 'string' && env[key].trim().length > 0;
    if (present('ANTHROPIC_BASE_URL') && present('ANTHROPIC_AUTH_TOKEN')) return { signedIn: true, method: 'provider' };
    if (present('ANTHROPIC_AUTH_TOKEN') || present('ANTHROPIC_API_KEY')) return { signedIn: true, method: 'api-key' };
    if (present('CLAUDE_CODE_OAUTH_TOKEN')) return { signedIn: true, method: 'oauth-token' };
    if (fileExists(path.join(home, '.credentials.json'))) return { signedIn: true, method: 'subscription' };
    const officialHome = path.join(context.home || os.homedir(), '.claude');
    const configFile = samePath(home, officialHome) ? path.join(context.home || os.homedir(), '.claude.json') : path.join(home, '.claude.json');
    const config = readJson(configFile, 8 * 1024 * 1024);
    // On macOS the subscription token sits in the Keychain; the account
    // record here is a hint that only the official check can confirm.
    if (config?.oauthAccount && typeof config.oauthAccount === 'object') return { signedIn: null, method: 'subscription', note: 'confirm-with-official-check' };
    return { signedIn: false, method: null };
  },
  officialStatus: { toolId: 'claude', args: ['auth', 'status'], parseMethod: true }
};
