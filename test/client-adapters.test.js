// Each client has one folder under src/clients/ holding its adapter, and the
// registry (src/apps.js) collects every folder exactly once, in list order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apps = require('../src/apps');

const CLIENTS = path.join(__dirname, '../src/clients');
const ORDER = ['claude', 'claude-cli', 'dsh-cli', 'codex', 'kimi', 'kimi-work', 'opencode', 'gemini-cli', 'qwen-code', 'cursor'];
const REQUIRED = ['id', 'label', 'tagColor', 'appName', 'providerNamespace', 'clientForm', 'profileIsolation', 'windows', 'defaultSessionRoot', 'launchEnv', 'scanAreas', 'diagnosticAreas', 'scan', 'discovery'];
// The checklist in docs/INTERNAL.md §5: a new capability is documented there first.
const OPTIONAL = [
  'mac', 'noLaunch', 'cliDiscoveryId', 'maintenanceToolId', 'cliClearEnvKeys', 'cliArgsForProfile', 'profileDirName', 'cliLauncher',
  'sessionKeyOf', 'sessionAddressOf', 'activityRecord', 'contentActivityAt', 'sessionCounts', 'replyState', 'isInternalRecordFile',
  'activityPreference', 'isArchivedRecordFile', 'exportTranscript', 'attachments', 'taskPackage', 'credentials', 'credentialHandoff',
  'credentialImport', 'accountId', 'defaultIdentityKey', 'managedHome', 'standaloneHome', 'runtimeHome', 'historyUpkeep',
  'sessionsInProfileFolder', 'quota', 'hub', 'hubUnsupported', 'catCoat', 'recruitDefault'
];
// Reserved for the queued account-card and orderly-update plans; not declared yet.
const RESERVED = ['accountCard', 'update'];

test('every adapter folder is registered once, under its own id, in list order', () => {
  const folders = fs.readdirSync(CLIENTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(CLIENTS, entry.name, 'index.js')))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(folders, [...ORDER].sort());
  assert.deepEqual(apps.appIds(), ORDER);
  for (const id of ORDER) {
    const adapter = require(path.join(CLIENTS, id));
    assert.equal(adapter.id, id, `src/clients/${id}/index.js declares id ${adapter.id}`);
    assert.equal(apps.getApp(id), adapter, `${id} is the registry entry itself, not a copy`);
  }
});

test('every adapter declares the fields the generic code relies on', () => {
  for (const id of apps.appIds()) {
    const adapter = apps.getApp(id);
    for (const field of REQUIRED) assert.ok(adapter[field] !== undefined, `${id} declares ${field}`);
    for (const field of ['defaultSessionRoot', 'launchEnv', 'scanAreas', 'diagnosticAreas', 'scan']) {
      assert.equal(typeof adapter[field], 'function', `${id}.${field} is a function`);
    }
  }
});

test('adapters declare only documented fields; the reserved ones are still unused', () => {
  const known = new Set([...REQUIRED, ...OPTIONAL]);
  for (const id of apps.appIds()) {
    for (const field of Object.keys(apps.getApp(id))) assert.ok(known.has(field), `${id}.${field} is not in the checklist`);
    for (const field of RESERVED) assert.equal(apps.getApp(id)[field], undefined, `${id}.${field} is reserved`);
  }
  const doc = fs.readFileSync(path.join(__dirname, '../docs/INTERNAL.md'), 'utf8');
  for (const field of [...REQUIRED, ...OPTIONAL, ...RESERVED]) assert.ok(doc.includes(`\`${field}\``), `docs/INTERNAL.md names ${field}`);
});

test('a client can be called by the hub, or says why not, but not both', () => {
  for (const id of apps.appIds()) {
    const adapter = apps.getApp(id);
    assert.ok(Boolean(adapter.hub) !== (typeof adapter.hubUnsupported === 'string'), id);
  }
});
