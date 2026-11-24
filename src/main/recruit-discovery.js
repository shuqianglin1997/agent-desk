'use strict';

/*
 * Recruit (add account): discovery and batch registration of existing
 * client homes, called by the recruit commands (src/commands/recruit.js).
 * One object per app holds the discovery that is running, so a new one or
 * a cancel stops it. The Renderer only receives display paths and one-time
 * selection IDs; Main keeps the real location and re-checks it before
 * registering. No credentials are read for output, copied or moved here.
 */

const os = require('node:os');
const accountDiscovery = require('../account-discovery');

const MAX_BATCH = 64;

// A home-relative path for display ("~/.codex"); the real path stays in Main.
function shortPath(value, home) {
  if (typeof value !== 'string') return '';
  if (home && (value === home || value.startsWith(`${home}/`) || value.startsWith(`${home}\\`))) return `~${value.slice(home.length)}`;
  return value;
}

function publicLocation(location, selections, home = os.homedir()) {
  const shownPath = location.kind === 'desktop' ? location.profilePath : location.sessionRoot;
  const { selectionId, displayPath } = selections.issue({
    kind: 'client-location',
    path: shownPath,
    meta: {
      appId: location.appId,
      kind: location.kind,
      sessionRoot: location.sessionRoot,
      profilePath: location.profilePath,
      isDefault: location.isDefault === true,
      source: location.source
    }
  });
  const identity = location.identity
    ? { method: location.identity.method || null, email: location.identity.email || null, plan: location.identity.plan || null }
    : null;
  return {
    selectionId,
    appId: location.appId,
    displayPath,
    shortPath: shortPath(displayPath, home),
    source: location.source,
    isDefault: location.isDefault === true,
    identity,
    sessionCount: Number.isInteger(location.sessionCount) ? location.sessionCount : null,
    registeredProfileId: location.registeredProfileId || null
  };
}

function createRecruitHandlers(deps) {
  const {
    selections,
    loadProfiles,
    registerLocations,
    pickDirectory,
    env = process.env,
    home = os.homedir(),
    discovery = accountDiscovery
  } = deps;
  let running = null;

  function cancel() {
    running?.abort();
    running = null;
    return { ok: true };
  }

  async function run(options) {
    running?.abort();
    const controller = new AbortController();
    running = controller;
    try {
      const result = await discovery.discoverLocations({ ...options, env, home, signal: controller.signal });
      if (controller.signal.aborted) return { ok: false, reasonCode: 'discovery-canceled' };
      const described = await discovery.describeLocations(result.locations, {
        profiles: loadProfiles(), home, signal: controller.signal
      });
      return {
        ok: true,
        locations: described.map((location) => publicLocation(location, selections, home)),
        hints: result.hints.map((hint) => ({ appId: hint.appId, kind: hint.kind, displayPath: shortPath(hint.path, home) })),
        ambiguousCount: result.ambiguous.length,
        truncated: result.truncated,
        stopReason: result.stopReason
      };
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'discovery-canceled') return { ok: false, reasonCode: 'discovery-canceled' };
      return { ok: false, reasonCode: error?.message === 'discovery-folder-invalid' ? 'discovery-folder-invalid' : 'discovery-failed' };
    } finally {
      if (running === controller) running = null;
    }
  }

  async function discover(input = {}) {
    return run({ deep: input?.deep === true });
  }

  async function discoverFolder() {
    const folder = await pickDirectory();
    if (!folder) return { ok: false, canceled: true };
    const result = await run({ folder, skipDefaults: true });
    return result.ok ? { ...result, folderRecognized: result.locations.length > 0 } : result;
  }

  function register(input = {}) {
    const ids = Array.isArray(input?.selectionIds) ? input.selectionIds : [];
    const unique = [...new Set(ids.map((value) => String(value || '').trim()).filter(Boolean))];
    if (!unique.length || unique.length > MAX_BATCH) return { ok: false, reasonCode: 'selection-invalid' };
    const resolved = unique.map((selectionId) => {
      try {
        const { meta } = selections.resolveEntry(selectionId, 'client-location');
        if (!meta || !discovery.verifyLocation(meta)) return { selectionId, reasonCode: 'location-changed' };
        return { selectionId, meta };
      } catch (error) {
        return { selectionId, reasonCode: error?.message === 'path-selection-expired' ? 'path-selection-expired' : 'selection-invalid' };
      }
    });
    const valid = resolved.filter((item) => item.meta);
    const outcomes = valid.length ? registerLocations(valid.map(({ meta }) => ({
      appId: meta.appId,
      sessionRoot: meta.sessionRoot,
      profilePath: meta.kind === 'desktop' ? meta.profilePath : null
    }))) : [];
    const bySelection = new Map(valid.map((item, index) => [item.selectionId, outcomes[index]]));
    const results = resolved.map((item) => {
      const outcome = bySelection.get(item.selectionId);
      if (!outcome) return { selectionId: item.selectionId, ok: false, reasonCode: item.reasonCode };
      return { selectionId: item.selectionId, ...outcome };
    });
    selections.consume(valid.map((item) => item.selectionId));
    const added = results.filter((item) => item.ok && !item.existing).length;
    return {
      ok: results.some((item) => item.ok),
      added,
      existing: results.filter((item) => item.ok && item.existing).length,
      failed: results.filter((item) => !item.ok).length,
      results
    };
  }

  return { discover, discoverFolder, cancel, register };
}

module.exports = { createRecruitHandlers, publicLocation, shortPath };
