// Settings version 5 moves the fields of retired features (yard scene,
// reminders, completion ledger) under `retired`, untouched. Nothing is lost,
// every other field is kept, and an older build that reads the new file does
// not crash. The older build's normaliser is kept as a fixture (settings.js
// and yard/interactions.js as of the last version-4 build).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const settings = require('../src/settings');

const FIXTURE = path.join(__dirname, 'fixtures', 'settings-v4');

function loadVersion4() {
  const run = (file, requireFn) => {
    const module = { exports: {} };
    const wrapper = new Function('require', 'module', 'exports', fs.readFileSync(path.join(FIXTURE, file), 'utf8'));
    wrapper.call({}, requireFn, module, module.exports);
    return module.exports;
  };
  const interactions = run('interactions.source', require);
  return run('settings.source', (id) => (id === './yard/interactions' ? interactions : require(path.join(__dirname, '../src', id))));
}

const VERSION_4_FILE = {
  version: 4,
  settings: {
    theme: 'dark', lang: 'ja', sessionScope: 'all', soundLevel: 'all', soundVolume: 30,
    agentOrder: ['a', 'b'], welcomed: true, onboarding: { completedVersion: 1, completedAt: '2026-11-01T00:00:00.000Z' },
    view: 'yard', remindersOn: false, atmosTime: 'night', atmosWeather: 'rain',
    ledger: { date: '2026-11-20', completed: 4, workedMs: 9000, active: {}, lastStretchAt: 0 },
    yardPositions: { cat: { x: 10, y: 20 } },
    futureField: 'kept'
  }
};

test('version 5 moves the retired fields under `retired` and keeps everything else', () => {
  assert.equal(settings.SETTINGS_VERSION, 5);
  const migrated = settings.normalizeSettings(settings.settingsFromPayload(VERSION_4_FILE));
  for (const key of settings.RETIRED_FIELDS) assert.equal(Object.hasOwn(migrated, key), false, key);
  assert.deepEqual(migrated.retired, {
    view: 'yard', remindersOn: false, atmosTime: 'night', atmosWeather: 'rain',
    ledger: VERSION_4_FILE.settings.ledger, yardPositions: { cat: { x: 10, y: 20 } }
  });
  assert.equal(migrated.theme, 'dark');
  assert.equal(migrated.lang, 'ja');
  assert.equal(migrated.sessionScope, 'all');
  assert.equal(migrated.soundVolume, 30);
  assert.deepEqual(migrated.agentOrder, ['a', 'b']);
  assert.deepEqual(migrated.onboarding, VERSION_4_FILE.settings.onboarding);
  assert.equal(migrated.futureField, 'kept');
  assert.deepEqual(settings.normalizeSettings(migrated), migrated, 'running it again changes nothing');
});

test('an older build reads the version 5 file without crashing and keeps the other fields', () => {
  const old = loadVersion4();
  const migrated = settings.normalizeSettings(settings.settingsFromPayload(VERSION_4_FILE));
  const file = { version: settings.SETTINGS_VERSION, settings: migrated };
  const seenByOld = old.normalizeSettings(old.settingsFromPayload(JSON.parse(JSON.stringify(file))));
  assert.equal(seenByOld.theme, 'dark');
  assert.equal(seenByOld.lang, 'ja');
  assert.equal(seenByOld.soundVolume, 30);
  assert.deepEqual(seenByOld.retired, migrated.retired, 'the retired block survives an older build');
  // The older build fills its own defaults for the fields it still knows...
  assert.equal(seenByOld.view, 'classic');
  assert.equal(seenByOld.ledger, null);
  // ...and when this build reads that file again, the kept values win.
  const back = settings.normalizeSettings(settings.settingsFromPayload({ version: 4, settings: seenByOld }));
  assert.deepEqual(back.retired, migrated.retired);
  assert.equal(Object.hasOwn(back, 'view'), false);
});

test('a malformed retired block is dropped instead of kept', () => {
  assert.equal(Object.hasOwn(settings.normalizeSettings({ retired: 'oops' }), 'retired'), false);
  assert.deepEqual(settings.normalizeSettings({ remindersOn: true, retired: 'oops' }).retired, { remindersOn: true });
});
