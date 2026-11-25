// Recruit "bring back" with the device mesh (docs/ADD_ACCOUNT_PLAN.md and
// docs/PERSONAL_AGENT_MESH_PLAN.md 10.9 and 17.5). With a mesh, the desk
// shows only the accounts in the account catalog, so a location that is
// registered but owned by no account is not on the desk: the list must let
// the person pick it, and bringing it back reuses its registration, never
// adds a second one and never revives a removed account's id. Without a
// mesh nothing changes. Synthetic folders and a mesh in a temp directory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const discovery = require('../src/account-discovery');
const { createLocationRegistrar } = require('../src/main/profile-registration');
const { createRecruitHandlers } = require('../src/main/recruit-discovery');
const { PathSelectionRegistry } = require('../src/main/ipc/path-selections');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { makeTempDir } = require('./helpers/temp');

const NOW = '2026-11-24T08:00:00.000Z';

// The system key protection; `locked` stands for a keychain read that is
// refused (the person denied access, or the item is locked).
function fakeProtector(keys) {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => {
      if (keys.locked) throw new Error('keychain access denied');
      return Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString();
    }
  };
}

// Two client homes (a Codex home and a Claude CLI home), a Profile store, a
// mesh service reading that store, and the recruit handlers wired the way
// src/main.js wires them.
function setup(t, options = {}) {
  const root = fs.realpathSync.native(makeTempDir(t, 'agentdesk-recruit-desk-'));
  const home = path.join(root, 'home');
  const codexHome = path.join(home, 'work', 'codex-b');
  const claudeHome = path.join(home, 'work', 'claude-b');
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '');
  fs.mkdirSync(path.join(claudeHome, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), '{}');

  const store = { profiles: [] };
  let sequence = 0;
  const registrar = createLocationRegistrar({
    loadProfiles: () => store.profiles.map((profile) => ({ ...profile })),
    saveProfiles: (next) => { store.profiles = next.map((profile) => ({ ...profile })); },
    buildProfile: (_profiles, input, built) => ({
      id: `p${++sequence}`, appId: input.appId, name: input.name || `${input.appId} ${sequence}`,
      profilePath: built.externalLocation.profilePath, sessionRoot: built.externalLocation.sessionRoot,
      cat: { breed: 'tabby' }
    }),
    defaultProfilePath: (appId) => `/nonexistent/${appId}`,
    home
  });

  const keys = { locked: false };
  const service = new MeshService({
    databasePath: path.join(root, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(root, 'mesh-keys.json'), fakeProtector(keys)),
    profilesProvider: () => store.profiles.map((profile) => ({ ...profile })),
    sessionCountProvider: () => 0,
    appVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os',
    hostname: 'Recruit-Test.local',
    now: () => NOW
  });

  const bringCalls = [];
  const handlers = createRecruitHandlers({
    selections: new PathSelectionRegistry({ maxEntries: 64 }),
    loadProfiles: () => store.profiles,
    registerLocations: (inputs) => registrar.registerLocations(inputs),
    deskPlacement: () => service.localProfilesOnDesk(),
    bringToDesk: options.bringToDesk || ((profileIds) => {
      bringCalls.push(profileIds);
      try {
        return { ok: true, overview: service.bringLocalProfilesToDesk(profileIds) };
      } catch (error) {
        return { ok: false, reasonCode: error.message };
      }
    }),
    pickDirectory: async () => null,
    env: {},
    home,
    discovery: {
      ...discovery,
      discoverLocations: async () => ({
        locations: [
          { ...discovery.locationFor('codex', codexHome, { home }), source: 'home-scan' },
          { ...discovery.locationFor('claude-cli', claudeHome, { home }), source: 'home-scan' }
        ],
        hints: [],
        ambiguous: [],
        truncated: false,
        stopReason: 'complete'
      })
    }
  });

  const discover = async () => {
    const result = await handlers.discover({});
    assert.equal(result.ok, true);
    return {
      codex: result.locations.find((item) => item.appId === 'codex'),
      claude: result.locations.find((item) => item.appId === 'claude-cli')
    };
  };
  const register = (...locations) => handlers.register({ selectionIds: locations.map((item) => item.selectionId) });
  const localSlots = (overview) => overview.slots.filter((slot) => slot.deviceId === overview.localDeviceId);
  const accountOf = (overview, profileId) => {
    const slot = localSlots(overview).find((item) => item.profileId === profileId);
    return slot?.assignmentState === 'linked' && slot.accountBindingId ? slot.agentId : null;
  };
  // A new run of the app: the vault has not read the keys yet.
  const relaunchKeys = () => { service.keyVault = new EncryptedKeyVault(path.join(root, 'mesh-keys.json'), fakeProtector(keys)); };
  return { store, service, handlers, registrar, discover, register, localSlots, accountOf, bringCalls, claudeHome, keys, relaunchKeys };
}

test('a location whose account was removed is not "on the desk" and comes back without a second registration', async (t) => {
  const s = setup(t);
  let found = await s.discover();
  assert.equal(found.codex.registeredProfileId, null);
  assert.equal(s.register(found.codex, found.claude).added, 2);
  const [codexId, claudeId] = s.store.profiles.map((profile) => profile.id);
  let overview = s.service.initialize();
  const removedAgentId = s.accountOf(overview, claudeId);
  assert.ok(removedAgentId && s.accountOf(overview, codexId));

  // The person removes the whole account the Claude location belonged to.
  overview = s.service.removeCatalogObject({ scope: 'agent', agentId: removedAgentId });
  assert.equal(overview.agents.length, 1);
  assert.equal(s.accountOf(overview, claudeId), null);

  // Still registered, but no account on the desk owns it: it can be picked.
  found = await s.discover();
  assert.equal(found.codex.registeredProfileId, codexId);
  assert.equal(found.codex.onDesk, true);
  assert.equal(found.claude.registeredProfileId, claudeId);
  assert.equal(found.claude.onDesk, false);

  const result = s.register(found.claude);
  assert.deepEqual(result.results.map(({ ok, profileId, existing, onDesk }) => ({ ok, profileId, existing, onDesk })), [
    { ok: true, profileId: claudeId, existing: true, onDesk: true }
  ]);
  assert.equal(result.added, 0);
  assert.deepEqual(s.bringCalls, [[claudeId]]);

  // Back on the desk as an account, reusing the registration: still two
  // Profiles and two local locations, and the removed id stays removed.
  overview = s.service.getOverview();
  assert.equal(s.store.profiles.length, 2);
  assert.equal(s.localSlots(overview).length, 2);
  const backId = s.accountOf(overview, claudeId);
  assert.ok(backId);
  assert.notEqual(backId, removedAgentId);
  assert.equal(overview.agents.length, 2);
  assert.equal(overview.agents.find((agent) => agent.agentId === backId).displayName, s.store.profiles[1].name);
  assert.equal(s.accountOf(overview, codexId), overview.agents.find((agent) => agent.agentId !== backId).agentId);

  found = await s.discover();
  assert.equal(found.claude.onDesk, true);
  // Registering it again changes nothing.
  assert.equal(s.register(found.claude).results[0].onDesk, true);
  assert.equal(s.service.getOverview().agents.length, 2);
});

test('a location registered while the mesh keys were deferred comes onto the desk when brought back', async (t) => {
  const s = setup(t);
  let found = await s.discover();
  s.register(found.codex);
  s.service.initialize();
  // The packaged ad-hoc build reads the mesh without keys at startup: a
  // location registered then gets no catalog place until a keyed reconcile.
  const registeredLater = s.registrar.registerLocations([{ appId: 'claude-cli', sessionRoot: s.claudeHome }]);
  assert.equal(registeredLater[0].ok, true);
  const claudeId = registeredLater[0].profileId;
  let overview = s.service.getOverview({ deferKeyAccess: true });
  assert.equal(overview.keyState, 'deferred');
  assert.equal(s.localSlots(overview).some((slot) => slot.profileId === claudeId), false);

  found = await s.discover();
  assert.equal(found.claude.registeredProfileId, claudeId);
  assert.equal(found.claude.onDesk, false);

  const result = s.register(found.claude);
  assert.equal(result.results[0].onDesk, true);
  overview = s.service.getOverview({ deferKeyAccess: true });
  assert.ok(s.accountOf(overview, claudeId));
  assert.equal(overview.agents.length, 2);
  assert.equal(s.localSlots(overview).length, 2);
  assert.equal(s.store.profiles.length, 2);
});

test('a removed location whose sign-in is live on another account joins that sign-in', async (t) => {
  const s = setup(t);
  let found = await s.discover();
  s.register(found.claude);
  const claudeId = s.store.profiles[0].id;
  s.store.profiles[0].identityFingerprint = 'same-sign-in';
  let overview = s.service.initialize();
  overview = s.service.removeCatalogObject({ scope: 'agent', agentId: s.accountOf(overview, claudeId) });
  // The same sign-in shows up again in another folder and gets its own account.
  s.store.profiles.push({ id: 'p-other', appId: 'claude-cli', name: 'Other', sessionRoot: '/other', profilePath: '/other', identityFingerprint: 'same-sign-in' });
  overview = s.service.getOverview();
  const liveAgentId = s.accountOf(overview, 'p-other');
  assert.ok(liveAgentId);
  const liveBindingId = s.localSlots(overview).find((slot) => slot.profileId === 'p-other').accountBindingId;

  found = await s.discover();
  assert.equal(found.claude.onDesk, false);
  assert.equal(s.register(found.claude).results[0].onDesk, true);
  overview = s.service.getOverview();
  const back = s.localSlots(overview).find((slot) => slot.profileId === claudeId);
  assert.deepEqual([back.assignmentState, back.agentId, back.accountBindingId], ['linked', liveAgentId, liveBindingId]);
  assert.equal(overview.agents.length, 1);
});

test('when the mesh keys cannot be read the location stays registered and the reason names the keys', async (t) => {
  const s = setup(t);
  let found = await s.discover();
  s.register(found.codex, found.claude);
  const claudeId = s.store.profiles[1].id;
  const overview = s.service.initialize();
  s.service.removeCatalogObject({ scope: 'agent', agentId: s.accountOf(overview, claudeId) });
  s.relaunchKeys();
  s.keys.locked = true;
  found = await s.discover();
  const result = s.register(found.claude);
  assert.equal(result.ok, true);
  assert.equal(result.deskReasonCode, 'mesh-keys-unavailable');
  assert.deepEqual(result.results.map(({ ok, existing, onDesk }) => ({ ok, existing, onDesk })), [{ ok: true, existing: true, onDesk: false }]);
  assert.equal(s.store.profiles.length, 2);
  // Once the keys can be read again, registering it again puts it on the desk.
  s.keys.locked = false;
  found = await s.discover();
  assert.equal(found.claude.onDesk, false);
  assert.equal(s.register(found.claude).results[0].onDesk, true);
});

test('without a device mesh every registered location is on the desk and nothing else runs', async (t) => {
  const s = setup(t);
  assert.equal(s.service.localProfilesOnDesk(), null);
  let found = await s.discover();
  const result = s.register(found.codex);
  assert.equal(result.added, 1);
  assert.equal(result.results[0].onDesk, true);
  assert.equal(result.deskReasonCode, undefined);
  assert.deepEqual(s.bringCalls, []);
  found = await s.discover();
  assert.equal(found.codex.registeredProfileId, s.store.profiles[0].id);
  assert.equal(found.codex.onDesk, true);
  assert.equal(found.claude.onDesk, null);
});
