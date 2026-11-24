'use strict';

/*
 * What a dropped or chosen folder or sign-in file does, decided before
 * anything is written:
 *   - a folder that is some client's home is registered where it is;
 *   - a sign-in file inside an already registered home, or inside the default
 *     or environment home, registers that home where it is;
 *   - the same file already imported reuses that Profile;
 *   - any other recognised sign-in file is copied into a new isolated home,
 *     which the Renderer shows as a move and asks to confirm first.
 * Execution re-plans and refuses when the action changed since inspection.
 */

const fs = require('node:fs');
const path = require('node:path');
const accountDiscovery = require('../account-discovery');
const credentialImport = require('../credential-import');
const { codexProfileAtHome, codexHomeKey, profileWithSameCodexAuth, readCodexAuthFile } = require('../codex-account-import');

class RecruitItemError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function createRecruitItems(deps) {
  const {
    loadProfiles,
    registerLocations,
    planExistingLocation,
    registerCodexHome,
    createStoredProfile,
    discoverCodexHomes,
    discoverLocations = (options) => accountDiscovery.discoverLocations(options),
    importOpenCodeExport = async () => { throw new RecruitItemError('official-client-missing'); },
    discardProfile = () => {},
    env = process.env,
    platform = process.platform
  } = deps;

  async function planCredentialFile(appId, filePath) {
    const profiles = loadProfiles();
    if (appId === 'codex') {
      const auth = readCodexAuthFile(filePath);
      const sourceHome = path.dirname(filePath);
      const existing = codexProfileAtHome(profiles, sourceHome);
      if (existing) return { action: 'existing', profileId: existing.id };
      const sourceKey = codexHomeKey(sourceHome);
      if (sourceKey && discoverCodexHomes().some(({ directory }) => codexHomeKey(directory) === sourceKey)) {
        return { action: 'register', sourceHome };
      }
      const copied = profileWithSameCodexAuth(profiles, auth);
      if (copied) return { action: 'existing', profileId: copied.id };
      return { action: 'copy', payload: auth };
    }
    const importer = credentialImport.importerFor(appId, platform);
    if (!importer) {
      throw new RecruitItemError(credentialImport.IMPORTERS[appId] ? 'credential-import-unsupported-platform' : 'credential-import-unsupported');
    }
    if (!importer.accepts(path.basename(String(filePath || '')))) throw new RecruitItemError('credential-file-unrecognized');
    const payload = importer.read(filePath);
    const sourceHome = importer.sourceHome(filePath);
    const sourceKey = codexHomeKey(sourceHome);
    if (sourceKey) {
      const existing = profiles.find((profile) => profile.appId === appId && codexHomeKey(profile.sessionRoot) === sourceKey);
      if (existing) return { action: 'existing', profileId: existing.id };
      const { locations } = await discoverLocations({ appId, env });
      if (locations.some((location) => codexHomeKey(location.sessionRoot) === sourceKey)) return { action: 'register', sourceHome };
    }
    const copied = credentialImport.sameImportedFile(profiles, appId, payload.bytes);
    if (copied) return { action: 'existing', profileId: copied.id };
    return { action: 'copy', payload };
  }

  async function executeCredentialPlan(appId, plan) {
    if (plan.action === 'existing') return { profileId: plan.profileId, existing: true };
    if (plan.action === 'register') {
      if (appId === 'codex') return { ...registerCodexHome(plan.sourceHome), inPlace: true };
      const [registered] = registerLocations([{ appId, sessionRoot: plan.sourceHome }]);
      if (!registered.ok) throw new RecruitItemError(registered.reasonCode);
      return { profileId: registered.profileId, existing: registered.existing, inPlace: true };
    }
    if (appId === 'codex') {
      return { profileId: createStoredProfile({ appId: 'codex' }, { codexAuth: plan.payload }).id, copied: true };
    }
    if (appId === 'opencode' && plan.payload.export) {
      // A new home first, then OpenCode's own import; undo the home if that fails.
      const profile = createStoredProfile({ appId }, {
        credentialImport: appId,
        stage: (created) => {
          fs.mkdirSync(created.sessionRoot, { recursive: true, mode: 0o700 });
          return () => fs.rmSync(created.profilePath, { recursive: true, force: true });
        }
      });
      try {
        await importOpenCodeExport(profile, plan.payload.filePath);
      } catch (error) {
        discardProfile(profile.id);
        throw new RecruitItemError(error?.code || 'official-command-failed');
      }
      return { profileId: profile.id, copied: true };
    }
    const profile = createStoredProfile({ appId }, {
      credentialImport: appId,
      stage: (created) => credentialImport.stageNewHome(appId, created, plan.payload)
    });
    return {
      profileId: profile.id,
      copied: true,
      ...(appId === 'kimi' && plan.payload.config?.complete === false ? { warnings: ['kimi-config-minimal'] } : {})
    };
  }

  async function importCredentialFile(appId, filePath) {
    return executeCredentialPlan(appId, await planCredentialFile(appId, filePath));
  }

  async function planItem(itemPath) {
    if (typeof itemPath !== 'string' || !path.isAbsolute(itemPath) || itemPath.includes('\0')) throw new RecruitItemError('credential-file-unreadable');
    let stat;
    try { stat = fs.lstatSync(itemPath); } catch (_error) { throw new RecruitItemError('credential-file-unreadable'); }
    const fileName = path.basename(itemPath).slice(0, 120);
    if (stat.isDirectory()) {
      const directory = accountDiscovery.realDirectory(itemPath);
      if (!directory) throw new RecruitItemError('client-directory-invalid');
      const { entries } = accountDiscovery.listDirectorySync(directory);
      const match = accountDiscovery.recognize(directory, entries);
      if (match?.ambiguous) throw new RecruitItemError('location-ambiguous');
      if (!match?.appId) throw new RecruitItemError('location-unrecognized');
      const location = accountDiscovery.locationFor(match.appId, directory);
      const input = {
        appId: location.appId,
        sessionRoot: location.sessionRoot,
        profilePath: location.kind === 'desktop' ? location.profilePath : null
      };
      let plan;
      try { plan = planExistingLocation(input, loadProfiles()); } catch (error) { throw new RecruitItemError(error?.code || 'location-invalid'); }
      return { kind: 'folder', appId: location.appId, fileName, action: plan.existing ? 'existing' : 'register', profileId: plan.existing?.id || null, input };
    }
    if (!stat.isFile()) throw new RecruitItemError('credential-file-unreadable');
    const client = credentialImport.clientForCredentialFile(itemPath, platform);
    if (!client) throw new RecruitItemError('credential-file-unrecognized');
    if (typeof client === 'object') throw new RecruitItemError('credential-import-unsupported-platform');
    const plan = await planCredentialFile(client, itemPath);
    return { kind: 'file', appId: client, fileName, action: plan.action, profileId: plan.profileId || null, plan };
  }

  async function executeItem(itemPath, expectedAction) {
    const planned = await planItem(itemPath);
    if (planned.action !== expectedAction) throw new RecruitItemError('location-changed');
    if (planned.kind === 'folder') {
      if (planned.action === 'existing') return { appId: planned.appId, profileId: planned.profileId, existing: true, inPlace: true };
      const [registered] = registerLocations([planned.input]);
      if (!registered.ok) throw new RecruitItemError(registered.reasonCode);
      return { appId: planned.appId, profileId: registered.profileId, existing: registered.existing, inPlace: true };
    }
    return { appId: planned.appId, ...(await executeCredentialPlan(planned.appId, planned.plan)) };
  }

  return { planCredentialFile, executeCredentialPlan, importCredentialFile, planItem, executeItem };
}

module.exports = { createRecruitItems, RecruitItemError };
