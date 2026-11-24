// Registering an existing Codex home used its own path (registerCodexHome ->
// createStoredProfile({ codexHome })) beside the generic location registrar
// (src/main/profile-registration.js -> buildStoredProfile({ externalLocation })).
// These tests pin that both describe the same Profile, so recruiting and the
// CLI can use the registrar alone once the old Codex import is removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const apps = require('../src/apps');
const { codexHomeKey } = require('../src/clients/codex/account-import');
const { createLocationRegistrar } = require('../src/main/profile-registration');

const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const fn = (name) => main.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function builder(home) {
  let n = 0;
  const context = vm.createContext({
    apps, path, codexHomeKey,
    os: { homedir: () => home },
    crypto: { randomUUID: () => `id-${++n}` },
    normalizeProfile: (profile) => profile,
    defaultProfilePath: (appId) => `/official/${appId}`,
    makeIsolatedProfilePath: (appId, name, id) => `/managed/${appId}/${id}`,
    defaultSessionRoot: (appId, profilePath) => `${profilePath}/sessions`,
    defaultCatForClient: (appId, id) => ({ coat: appId, id }),
    Date: class extends Date { toISOString() { return '2026-11-24T12:00:00.000Z'; } }
  });
  vm.runInContext(`${fn('uniqueProfileName')}\n${fn('buildStoredProfile')}`, context);
  return { build: context.buildStoredProfile, reset: () => { n = 0; } };
}

function homes(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-registration-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const user = path.join(root, 'user');
  const work = path.join(root, 'work-codex');
  for (const dir of [path.join(user, '.codex', 'sessions'), path.join(work, 'sessions')]) fs.mkdirSync(dir, { recursive: true });
  return { user, official: path.join(user, '.codex'), work };
}

test('a Codex home builds the same Profile through the old and the generic path', (t) => {
  const { user, official, work } = homes(t);
  const { build, reset } = builder(user);
  const existing = [{ id: 'x', appId: 'codex', name: 'Codex' }];
  for (const [home, isDefault] of [[work, false], [official, true]]) {
    reset();
    const viaCodexHome = build(existing, { appId: 'codex', name: '' }, { codexHome: home });
    reset();
    const viaRegistrar = build(existing, { appId: 'codex', name: '' }, { externalLocation: { profilePath: null, sessionRoot: home, isDefault } });
    assert.deepEqual(JSON.parse(JSON.stringify(viaRegistrar)), JSON.parse(JSON.stringify(viaCodexHome)), home);
    assert.equal(viaRegistrar.isProtected, isDefault);
    assert.equal(viaRegistrar.sessionRoot, home);
    assert.equal(viaRegistrar.name, 'Codex 2', 'a second Codex account gets the next free name');
  }
});

test('the registrar finds the same existing Codex Profile and the same default home', (t) => {
  const { user, official, work } = homes(t);
  const registrar = createLocationRegistrar({ loadProfiles: () => [], saveProfiles() {}, buildProfile() {}, defaultProfilePath: (appId) => `/official/${appId}`, home: user });
  const known = [{ id: 'known', appId: 'codex', sessionRoot: work, profilePath: '/managed/codex/known' }];
  assert.equal(registrar.planExistingLocation({ appId: 'codex', sessionRoot: work }, known).existing.id, 'known');
  assert.equal(registrar.planExistingLocation({ appId: 'codex', sessionRoot: official }, known).isDefault, true);
  assert.equal(registrar.planExistingLocation({ appId: 'codex', sessionRoot: work }, []).isDefault, false);
  assert.equal(codexHomeKey(work), registrar.planExistingLocation({ appId: 'codex', sessionRoot: work }, []).sessionRoot);
});
