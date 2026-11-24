'use strict';

/*
 * Register existing client homes as local Profiles.
 *
 * A CLI home is its own Profile root; a desktop client keeps its data
 * directory; Codex and Kimi Code get the official desktop directory only for
 * the official home and otherwise a new managed desktop directory. Nothing on
 * disk is created, copied or moved. Several locations are planned against one
 * loaded store and saved once; a known location returns its existing Profile.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const apps = require('../apps');
const { InterfaceError } = require('../automation/service');

function canonicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return null;
  try {
    const resolved = fs.realpathSync.native(directory);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch (_error) {
    return null;
  }
}

function directoryKey(directory) {
  const resolved = canonicalDirectory(directory);
  return resolved && process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requireDirectory(value) {
  const resolved = canonicalDirectory(value);
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new InterfaceError('client-directory-invalid', 'Choose an existing, absolute client directory.', 2);
  }
  return resolved;
}

function bounded(value, max) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

function createLocationRegistrar(deps) {
  const { loadProfiles, saveProfiles, buildProfile, defaultProfilePath, home = os.homedir() } = deps;

  function planExistingLocation(input, profiles) {
    const appId = input.appId;
    if (!apps.isKnownApp(appId)) throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
    const client = apps.getApp(appId);
    const sessionRoot = requireDirectory(input.sessionRoot);
    const officialPath = defaultProfilePath(appId);
    const homeKey = directoryKey(sessionRoot);
    let profilePath;
    let isDefault;
    if (appId === 'codex' && !input.profilePath) {
      profilePath = null;
      isDefault = homeKey === directoryKey(path.join(home, '.codex'));
    } else {
      const officialHomeKey = directoryKey(client.defaultSessionRoot(officialPath, true));
      profilePath = client.cliDiscoveryId ? sessionRoot
        : input.profilePath ? requireDirectory(input.profilePath)
          : (homeKey === officialHomeKey ? canonicalDirectory(officialPath) : null);
      const profileKey = directoryKey(profilePath);
      isDefault = !client.cliDiscoveryId && Boolean(profileKey)
        && profileKey === directoryKey(officialPath) && homeKey === officialHomeKey;
    }
    if (client.profileIsolation?.mode === 'official-default-only' && !isDefault) {
      throw new InterfaceError('client-default-only', 'This client launches from its official desktop directory only.', 5);
    }
    const profileKey = directoryKey(profilePath);
    const existing = profiles.find((profile) => (
      profile.appId === appId && directoryKey(profile.sessionRoot) === homeKey
      && (client.cliDiscoveryId || !profileKey || directoryKey(profile.profilePath) === profileKey)
    ));
    return { appId, name: bounded(input.name, 80), profilePath, sessionRoot, isDefault, existing: existing || null };
  }

  function registerLocations(inputs) {
    const profiles = loadProfiles();
    const results = [];
    let changed = false;
    for (const input of inputs) {
      let plan;
      try {
        plan = planExistingLocation(input, profiles);
      } catch (error) {
        results.push({ ok: false, reasonCode: error instanceof InterfaceError ? error.code : 'location-invalid' });
        continue;
      }
      if (plan.existing) {
        results.push({ ok: true, profileId: plan.existing.id, existing: true });
        continue;
      }
      const profile = buildProfile(profiles, { appId: plan.appId, name: plan.name }, {
        externalLocation: { profilePath: plan.profilePath, sessionRoot: plan.sessionRoot, isDefault: plan.isDefault }
      });
      profiles.push(profile);
      changed = true;
      results.push({ ok: true, profileId: profile.id, existing: false });
    }
    if (changed) saveProfiles(profiles);
    return results;
  }

  return { planExistingLocation, registerLocations };
}

module.exports = { createLocationRegistrar, directoryKey, canonicalDirectory };
