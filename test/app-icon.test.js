const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { appIconPath, applyAppIcon } = require('../src/app-icon');

test('skin icons are bundled PNGs and unknown input cannot select another file', () => {
  for (const skin of ['cat', 'vhs']) {
    assert.equal(fs.readFileSync(appIconPath(skin)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.notEqual(appIconPath('cat'), appIconPath('vhs'));
  assert.equal(appIconPath('../../bad.png'), appIconPath('cat'));
});

test('macOS running icon follows both skin transitions even in packaged builds', () => {
  const changes = [];
  const app = { isPackaged: true, dock: { setIcon: value => changes.push(value) } };
  applyAppIcon(app, null, 'vhs', 'darwin');
  applyAppIcon(app, null, 'cat', 'darwin');
  assert.deepEqual(changes, [appIconPath('vhs'), appIconPath('cat')]);
});

test('other platforms update a live window only', () => {
  const changes = [];
  const window = { isDestroyed: () => false, setIcon: value => changes.push(value) };
  applyAppIcon({}, window, 'vhs', 'win32');
  applyAppIcon({}, { ...window, isDestroyed: () => true }, 'cat', 'win32');
  applyAppIcon({}, null, 'cat', 'win32');
  assert.deepEqual(changes, [appIconPath('vhs')]);
});
