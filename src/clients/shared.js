'use strict';

// Helpers several client adapters share. Nothing here names a client.

const os = require('node:os');
const path = require('node:path');

// 各平台官方 App 默认数据目录：<用户配置区>/<AppName>
function appSupportDir(appName) {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appName);
}

const matchLocalJson = (name) => /^local_.*\.json$/i.test(name);
const matchJsonl = (name) => name.endsWith('.jsonl');

const CHROMIUM_PROFILE_ISOLATION = Object.freeze({
  mode: 'chromium-user-data-dir'
});

const OFFICIAL_DEFAULT_ONLY = Object.freeze({
  mode: 'official-default-only'
});

function withoutKeys(baseEnv, keys) {
  return Object.fromEntries(Object.entries(baseEnv || {}).filter(([key]) => !keys.includes(key.toUpperCase())));
}

const CLI_WINDOWS_ENTRY = (installDir, markers) => ({
  executableNames: [],
  aliases: [],
  legacyInstallDirs: [installDir],
  packageNames: [],
  packageFamilyNames: [],
  packageFamilyPrefixes: [],
  protocol: null,
  profileMarkers: markers
});

// A Profile owns its sessionRoot. For a managed home the other per-account
// folders sit next to it under the Profile directory.
const isManagedHome = (profile) => profile.sessionRootMode === 'managed' || profile.profilePathMode === 'managed';

module.exports = {
  appSupportDir,
  matchLocalJson,
  matchJsonl,
  CHROMIUM_PROFILE_ISOLATION,
  OFFICIAL_DEFAULT_ONLY,
  withoutKeys,
  CLI_WINDOWS_ENTRY,
  isManagedHome
};
