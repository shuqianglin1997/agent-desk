'use strict';

// `profiles discover` for the packaged CLI. It uses the same discovery module
// as the desktop recruit dialog, so both list the same homes for the same
// inputs. Read-only: it never registers, copies or prints credentials.
const path = require('node:path');
const apps = require('../apps');
const discovery = require('../account-discovery');
const { InterfaceError, readProfiles, getProfile } = require('./service');
const { credentialStatus } = require('../account-credentials');
const { discoverCli } = require('../cli-discovery');

const SCAN_MODES = new Set(['defaults', 'home']);

function readRegisteredProfiles(userData) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) return { profiles: [], state: 'unknown' };
  try {
    const payload = JSON.parse(require('node:fs').readFileSync(path.join(userData, 'profiles.json'), 'utf8'));
    const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
    return { profiles: profiles.filter((item) => item && typeof item.sessionRoot === 'string'), state: 'present' };
  } catch (error) {
    return { profiles: [], state: error?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

function registerArguments(location) {
  const args = ['profiles', 'register', '--app', location.appId, '--session-root', location.sessionRoot];
  if (location.kind === 'desktop') args.push('--profile-path', location.profilePath);
  return args;
}

async function discoverLocalProfileLocations(input = {}, options = {}) {
  const query = typeof input === 'string' ? { app: input } : (input || {});
  if (query.app && !apps.isKnownApp(query.app)) {
    throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
  }
  const scan = query.scan || 'defaults';
  if (!SCAN_MODES.has(scan)) throw new InterfaceError('invalid-arguments', 'Use --scan defaults or --scan home.', 2);
  let folder = null;
  if (query.folder) {
    folder = discovery.realDirectory(query.folder);
    if (!path.isAbsolute(query.folder) || !folder) {
      throw new InterfaceError('discovery-folder-invalid', 'Use an existing absolute folder for --folder.', 2);
    }
  }
  const result = await discovery.discoverLocations({
    appId: query.app || null,
    deep: scan === 'home',
    folder,
    env: options.env || process.env,
    home: options.home
  });
  const store = readRegisteredProfiles(options.userData);
  const described = await discovery.describeLocations(result.locations, { profiles: store.profiles, home: options.home });
  const warnings = [];
  if (store.state === 'unreadable') warnings.push('profiles.json could not be read; registeredProfileId is unknown for every location.');
  if (result.truncated) warnings.push('The scan stopped at a limit; run it on a narrower --folder to see more.');
  return {
    locations: described.map((location) => ({
      appId: location.appId,
      sessionRoot: location.sessionRoot,
      profilePath: location.profilePath,
      source: location.source,
      isDefault: location.isDefault === true,
      identity: location.identity,
      sessionCount: location.sessionCount,
      registeredProfileId: location.registeredProfileId,
      registerArguments: location.registeredProfileId ? null : registerArguments(location)
    })),
    hints: result.hints.map((hint) => ({ appId: hint.appId, kind: hint.kind, path: hint.path })),
    scan: { mode: scan, folder, layers: result.layers, truncated: result.truncated, stopReason: result.stopReason, ambiguousCount: result.ambiguous.length },
    warnings
  };
}

// `profiles status`: the client's success check for one exact Profile. Only
// the sign-in kind is reported; no value is read into the output.
async function profileSignInStatus(input = {}, options = {}) {
  const store = readProfiles(options.userData);
  const profile = getProfile(store, input.profile);
  const status = await credentialStatus(profile, {
    env: options.env || process.env,
    official: input.official === true,
    findLauncher: options.findLauncher || ((toolId) => discoverCli(toolId))
  });
  return {
    profileId: profile.id,
    appId: profile.appId,
    ...status,
    warnings: status.signedIn === null ? ['Only the client\'s own status check can confirm this sign-in. Run with --check official.'] : []
  };
}

module.exports = { discoverLocalProfileLocations, profileSignInStatus, SCAN_MODES };
