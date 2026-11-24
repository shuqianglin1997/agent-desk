'use strict';

const apps = require('../apps');
const { canonicalDirectory, codexHomeKey, discoverCodexHomes } = require('../codex-account-import');
const { InterfaceError } = require('./service');

const HOMES_FROM_ENV = {
  'claude-cli': 'CLAUDE_CONFIG_DIR',
  'dsh-cli': 'DSH_HOME',
  kimi: 'KIMI_CODE_HOME'
};

function discoverLocalProfileLocations(appId, env = process.env) {
  if (appId && !apps.isKnownApp(appId)) {
    throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
  }
  const locations = [];
  for (const id of appId ? [appId] : apps.appIds()) {
    if (id === 'codex') {
      for (const { source, directory } of discoverCodexHomes({ env })) {
        locations.push({ appId: id, sessionRoot: directory, profilePath: null, source });
      }
      continue;
    }

    const client = apps.getApp(id);
    const defaultDesktopPath = apps.defaultProfilePath(id);
    const defaultHome = client.defaultSessionRoot(defaultDesktopPath, true);
    const envName = HOMES_FROM_ENV[id];
    const seen = new Set();
    for (const [source, location] of [['default', defaultHome], ['environment', envName && env[envName]]]) {
      const sessionRoot = canonicalDirectory(location);
      const key = codexHomeKey(sessionRoot);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const profilePath = client.cliDiscoveryId || source === 'environment' ? null : canonicalDirectory(defaultDesktopPath);
      locations.push({ appId: id, sessionRoot, profilePath, source });
    }
  }
  return locations;
}

module.exports = { discoverLocalProfileLocations };
