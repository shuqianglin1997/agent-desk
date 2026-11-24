'use strict';

// A new managed Codex home keeps this account's sign-in in its own folder,
// never in the shared keyring: config.toml selects the file credential store.
// An existing config.toml is left alone.

function seedCodexHome(profile, fsImpl, pathImpl) {
  const configPath = pathImpl.join(profile.sessionRoot, 'config.toml');
  try {
    fsImpl.writeFileSync(configPath, 'cli_auth_credentials_store = "file"\n', { flag: 'wx', mode: 0o600 });
    return { seeded: true, appId: 'codex', path: profile.sessionRoot, files: ['config.toml'] };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return { seeded: false, reason: 'config-exists' };
  }
}

module.exports = { seedCodexHome };
