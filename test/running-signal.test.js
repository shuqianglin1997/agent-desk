// A process snapshot can only say "running" for profiles whose processes carry
// --user-data-dir=<profilePath>. Command-line clients never do, and a desktop
// app on its official default data folder also runs without the flag when it
// is started from the Dock. For those, "not seen" means "unknown", not
// "closed" - otherwise their cats can never show that they are working.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const apps = require('../src/apps');
const processModule = require('../src/process');
const cats = require('../src/yard/cats');

const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const fn = (name) => main.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function profileIsRunning() {
  const context = vm.createContext({
    path, apps, windows: {}, process: { platform: 'darwin' },
    ...processModule,
    pathsEqual: require('../src/core/paths').native.samePath,
    usesWindowsOfficialDefault: () => false
  });
  vm.runInContext(fn('profileIsRunning'), context);
  return context.profileIsRunning;
}

const PS = 'PID COMMAND\n101 /Applications/Codex.app/Contents/MacOS/Codex --user-data-dir=/profiles/work --type=renderer\n202 node /usr/local/bin/claude\n';

test('a command-line client is unknown, never "closed"', () => {
  const isRunning = profileIsRunning();
  const cliClients = apps.listApps().map((app) => app.id).filter((id) => apps.getApp(id).cliDiscoveryId);
  assert.ok(cliClients.includes('claude-cli'));
  for (const appId of cliClients) {
    assert.equal(isRunning(PS, { appId, profilePath: '/home/cli-home', sessionRoot: '/home/cli-home' }), null, appId);
  }
});

test('a desktop profile launched with its own data folder is true when seen and false when not', () => {
  const isRunning = profileIsRunning();
  assert.equal(isRunning(PS, { appId: 'codex', profilePath: '/profiles/work', sessionRoot: '/profiles/work' }), true);
  assert.equal(isRunning(PS, { appId: 'codex', profilePath: '/profiles/other', sessionRoot: '/profiles/other' }), false);
});

test('the official default data folder is unknown when not seen, true when seen', () => {
  const isRunning = profileIsRunning();
  const officialDefault = apps.defaultProfilePathInfo('claude').path;
  assert.equal(isRunning(PS, { appId: 'claude', profilePath: officialDefault, sessionRoot: officialDefault }), null);
  assert.equal(isRunning(`${PS}303 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=${officialDefault}\n`,
    { appId: 'claude', profilePath: officialDefault, sessionRoot: officialDefault }), true);
});

test('with an unknown signal, fresh session content shows the cat working', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const activity = { rootExists: true, rootReadable: true, contentActiveAt: now - 20000, latestMtime: now - 20000 };
  assert.equal(cats.deriveState(now, {}, { ...activity, running: null }), 'working');
  assert.notEqual(cats.deriveState(now, {}, { ...activity, running: false }), 'working');
});
