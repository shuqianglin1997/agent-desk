'use strict';

// AgentDesk — creating and registering local accounts: a new isolated
// environment, registering an existing client home, inspecting a dropped item,
// handing a pasted key to the account's own client and its sign-in status, and
// removing a registration. Secrets pass through once and are never stored.
// Moved out of src/main.js unchanged; Main's services come through `main`.

const accountCredentials = require('../account-credentials');
const apps = require('../apps');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InterfaceError } = require('../automation/service');
const { canonicalDirectory, codexHomeKey, stageCodexAuthHome } = require('../clients/codex/account-import');
const { launchProfile } = require('./profile-launch');
const { prepareManagedProfileHome } = require('../profile-home');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

// Fixed reason codes for every import, sign-in and creation failure. Error
// text never includes a path, key or file content.
const ACCOUNT_REASON_CODES = new Set([
  'codex-auth-filename', 'codex-auth-format', 'codex-auth-size', 'codex-auth-unreadable', 'codex-home-invalid',
  'path-selection-expired', 'credential-file-unreadable', 'credential-file-format', 'credential-file-size',
  'credential-import-unsupported', 'credential-import-unsupported-platform', 'credential-file-unrecognized',
  'secret-invalid', 'provider-id-invalid', 'provider-url-invalid', 'provider-model-invalid',
  'credential-method-unsupported', 'official-client-missing', 'official-command-failed', 'official-command-timeout',
  'config-unreadable', 'config-too-large', 'config-format-unsupported', 'config-write-failed',
  'credentials-format-unsupported', 'home-invalid', 'unknown-client', 'client-default-only', 'profile-not-found',
  'client-directory-invalid', 'location-unrecognized', 'location-ambiguous', 'location-changed', 'location-invalid',
  'client-default-missing'
]);

function accountReasonCode(error, fallback) {
  const code = error?.code || error?.message;
  return ACCOUNT_REASON_CODES.has(code) ? code : fallback;
}

async function accountResult(operation, fallback) {
  try {
    const result = await operation();
    return result ? { ok: true, ...result } : { ok: false, canceled: true };
  } catch (error) {
    return { ok: false, reasonCode: accountReasonCode(error, fallback) };
  }
}

function publicRecruitItem(planned) {
  const selection = planned.action === 'existing' ? null : main.recruitSelectionRegistry.issue({
    kind: 'recruit-item',
    path: planned.itemPath,
    meta: { action: planned.action }
  });
  return {
    selectionId: selection?.selectionId || null,
    kind: planned.kind,
    appId: planned.appId,
    fileName: planned.fileName,
    action: planned.action,
    profileId: planned.profileId || null
  };
}

async function inspectRecruitItem(itemPath) {
  const planned = await main.planRecruitItem(itemPath);
  return publicRecruitItem({ ...planned, itemPath });
}

// A new isolated environment for one client (the "new account" path).
function createLocalAccount(input = {}) {
  const appId = main.boundedText(input.appId, 80);
  if (!apps.isKnownApp(appId)) throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
  if (apps.getApp(appId).profileIsolation?.mode === 'official-default-only') {
    throw new InterfaceError('client-default-only', 'This client launches from its official desktop directory only.', 5);
  }
  const name = main.boundedText(input.name, 80) || uniqueProfileName(main.loadProfiles(), appId);
  const profile = createStoredProfile({ appId, name });
  return { profileId: profile.id, profilePath: profile.profilePath, sessionRoot: profile.sessionRoot };
}

// Remove a Profile that this flow created moments ago, with the managed
// folders AgentDesk made for it. Registered (custom) homes are never deleted.
function discardCreatedProfile(profileId) {
  const profile = main.loadProfiles().find((item) => item.id === profileId);
  if (!profile) return;
  removeStoredProfileRegistration(profileId);
  if (profile.profilePathMode === 'managed' && main.isManagedProfilePath(profile.profilePath)) {
    try { fs.rmSync(profile.profilePath, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
    // The per-client folder above it was made for this Profile too; rmdir only
    // succeeds while it is empty.
    const parent = path.dirname(profile.profilePath);
    if (main.isManagedProfilePath(parent)) try { fs.rmdirSync(parent); } catch (_error) { /* not empty */ }
  }
}

function credentialRequest(input = {}) {
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  return {
    method: input.method === 'provider' ? 'provider' : 'key',
    secret: typeof input.secret === 'string' ? input.secret.slice(0, 4200) : '',
    provider: {
      id: main.boundedText(provider.id, 40),
      baseUrl: main.boundedText(provider.baseUrl, 600),
      model: main.boundedText(provider.model, 160)
    },
    catalogProviderId: main.boundedText(input.catalogProviderId, 40),
    model: main.boundedText(input.model, 160)
  };
}

async function applyProfileSecret(profileId, input) {
  const profile = main.loadProfiles().find((item) => item.id === profileId);
  if (!profile) throw new Error('profile-not-found');
  const applied = await accountCredentials.applySecret(profile, credentialRequest(input), main.credentialContext());
  const status = await accountCredentials.credentialStatus(profile, main.credentialContext());
  return { profileId, method: applied.method, via: applied.via, plaintextWarning: applied.plaintextWarning, status };
}

async function profileCredentialStatus(profileId, official) {
  const profile = main.loadProfiles().find((item) => item.id === profileId);
  if (!profile) throw new Error('profile-not-found');
  return { profileId, appId: profile.appId, ...(await accountCredentials.credentialStatus(profile, main.credentialContext(official === true))) };
}

// New account signed in with a pasted key: create, hand over, roll back on failure.
async function createAccountWithSecret(input) {
  const created = createLocalAccount(input);
  try {
    return { ...(await applyProfileSecret(created.profileId, input)), created: true };
  } catch (error) {
    discardCreatedProfile(created.profileId);
    throw error;
  }
}

function uniqueProfileName(profiles, appId) {
  const label = apps.getApp(appId).label;
  const names = new Set(profiles.filter((profile) => profile.appId === appId).map((profile) => profile.name));
  let name = label;
  for (let index = 2; names.has(name); index += 1) name = `${label} ${index}`;
  return name;
}

// Build a normalized Profile without saving it. Batch registration builds
// several against one loaded store and saves once.
function buildStoredProfile(profiles, input = {}, options = {}) {
  const appId = apps.isKnownApp(input.appId) ? input.appId : apps.DEFAULT_APP;
  const { codexAuth, codexHome, externalLocation, credentialImport } = options;
  let name = String(input.name || '').trim();
  if (!name && (codexAuth || codexHome || externalLocation || credentialImport)) name = uniqueProfileName(profiles, appId);
  name ||= `${apps.getApp(appId).label} 账号`;
  const id = crypto.randomUUID();
  const isDefaultCodexHome = Boolean(codexHome && codexHomeKey(codexHome) === codexHomeKey(path.join(os.homedir(), '.codex')));
  const isDefault = isDefaultCodexHome || externalLocation?.isDefault === true;
  const profilePath = externalLocation?.profilePath
    || (isDefault ? main.defaultProfilePath(appId) : main.makeIsolatedProfilePath(appId, name, id));
  const existingRoot = codexHome || externalLocation?.sessionRoot;
  return main.normalizeProfile({
    id,
    appId,
    name,
    profilePath,
    sessionRoot: existingRoot || main.defaultSessionRoot(appId, profilePath, false),
    profilePathMode: isDefault ? 'auto' : (externalLocation?.profilePath ? 'custom' : 'managed'),
    sessionRootMode: existingRoot ? 'custom' : 'managed',
    isProtected: isDefault,
    // 新招募的猫默认穿它那个客户端的毛色（有的话）；已有的猫不经过这里，外观不变。
    cat: main.defaultCatForClient(appId, id),
    ...(codexAuth ? { codexAuthImported: true } : {}),
    ...(credentialImport ? { credentialImported: credentialImport } : {}),
    createdAt: new Date().toISOString(),
    lastLaunchedAt: null,
    group: input.group,
    note: input.note
  });
}

function createStoredProfile(input = {}, options = {}) {
  const profiles = main.loadProfiles();
  const profile = buildStoredProfile(profiles, input, options);
  const { codexAuth, codexHome, externalLocation, stage } = options;
  const existingRoot = codexHome || externalLocation?.sessionRoot;
  const cleanupAuth = codexAuth ? stageCodexAuthHome(profile, codexAuth) : (stage ? stage(profile) : null);
  if (!existingRoot && !codexAuth && !stage) prepareManagedProfileHome(profile);
  try {
    profiles.push(profile);
    main.saveProfiles(profiles);
  } catch (error) {
    cleanupAuth?.();
    throw error;
  }
  return profile;
}

function requireCliDirectory(value) {
  const resolved = canonicalDirectory(value);
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new InterfaceError('client-directory-invalid', 'Choose an existing, absolute client directory.', 2);
  }
  return resolved;
}

function registerExistingProfileFromCli(input) {
  const appId = input.app;
  if (!apps.isKnownApp(appId)) throw new InterfaceError('unknown-client', 'Choose a client ID from apps.', 2);
  const sessionRoot = requireCliDirectory(input['session-root']);
  const name = main.boundedText(input.name, 80);
  // A standalone home (Codex) must look like one; it is then registered like any other location.
  const standalone = apps.getApp(appId).standaloneHome;
  if (standalone?.looksValid && !input['profile-path'] && !standalone.looksValid(sessionRoot)) {
    throw new InterfaceError(standalone.invalid.code, standalone.invalid.message, 2);
  }
  main.locationRegistrar.planExistingLocation({ appId, sessionRoot, profilePath: input['profile-path'], name }, main.loadProfiles());
  const [result] = main.registerLocations([{ appId, sessionRoot, profilePath: input['profile-path'], name }]);
  if (!result.ok) throw new InterfaceError(result.reasonCode, 'The location could not be registered.', 2);
  return { profileId: result.profileId, ...(result.existing ? { existing: true } : {}) };
}

async function launchStoredProfile(id) {
  const profile = main.loadProfiles().find((item) => item.id === id);
  if (!profile) return { ok: false, reasonCode: 'profile-not-found', reason: main.t('main.err.slotNotFound') };
  const result = await launchProfile(profile);
  if (result.ok) {
    // Reload after launch discovery so concurrent edits are preserved.
    main.updateStoredProfile(id, (current) => ({ ...current, lastLaunchedAt: new Date().toISOString() }));
  }
  return result;
}

function removeStoredProfileRegistration(id) {
  const profiles = main.loadProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  if (next.length === profiles.length) return false;
  main.saveProfiles(next);
  main.quotaService.invalidate(id);
  return true;
}

module.exports = { bind, accountReasonCode, accountResult, publicRecruitItem, inspectRecruitItem, createLocalAccount, discardCreatedProfile, credentialRequest, applyProfileSecret, profileCredentialStatus, createAccountWithSecret, uniqueProfileName, buildStoredProfile, createStoredProfile, requireCliDirectory, registerExistingProfileFromCli, launchStoredProfile, removeStoredProfileRegistration };
