'use strict';

// Qwen Code: how a pasted key or token reaches this client (see
// src/account-credentials.js for the rules every client follows).

const path = require('node:path');
const { ensurePrivateDirectory, readOptional, writePrivateFile, setDotenv, readDotenvValue, homeOf, setSelectedAuthType, readOptionalQuiet, readJson } = require('../credential-files');

module.exports = {
  async setProvider(profile, secret, provider) {
    const home = homeOf(profile);
    ensurePrivateDirectory(home);
    const envFile = path.join(home, '.env');
    let text = readOptional(envFile);
    text = setDotenv(text, 'OPENAI_API_KEY', secret);
    text = setDotenv(text, 'OPENAI_BASE_URL', provider.baseUrl);
    text = setDotenv(text, 'OPENAI_MODEL', provider.model);
    writePrivateFile(envFile, text);
    setSelectedAuthType(path.join(home, 'settings.json'), 'openai');
    return { method: 'provider', via: 'config-file', storedInPlaintext: true };
  },
  status(profile) {
    const home = homeOf(profile);
    const subscription = readJson(path.join(home, 'subscription_credentials.json'));
    if (subscription?.tokens && typeof subscription.tokens === 'object') return { signedIn: true, method: 'subscription' };
    const oauth = readJson(path.join(home, 'oauth_creds.json'));
    if (typeof oauth?.refresh_token === 'string' && oauth.refresh_token) return { signedIn: true, method: 'oauth' };
    const settings = readJson(path.join(home, 'settings.json'));
    const selected = settings?.security?.auth?.selectedType;
    const dotenv = readOptionalQuiet(path.join(home, '.env')) || '';
    const hasKey = Boolean(settings?.security?.auth?.apiKey || settings?.env?.OPENAI_API_KEY || readDotenvValue(dotenv, 'OPENAI_API_KEY'));
    if (selected && selected !== 'qwen-oauth' && selected !== 'qwen-subscription' && hasKey) return { signedIn: true, method: 'provider' };
    return { signedIn: false, method: null };
  }
};
