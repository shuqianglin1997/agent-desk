const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windowChromeOptions, windowsControls } = require('../src/main/window-chrome');

test('window toolbar keeps native controls in their platform-specific positions', () => {
  assert.deepEqual(windowChromeOptions('darwin'), {
    titleBarStyle: 'hidden', trafficLightPosition: { x: 15, y: 22 }
  });
  assert.deepEqual(windowChromeOptions('win32', 'light', true), {
    titleBarStyle: 'hidden', autoHideMenuBar: true,
    titleBarOverlay: { height: 58, color: '#fffefa', symbolColor: '#262723' }
  });
  assert.deepEqual(windowChromeOptions('linux'), {});
});

test('Windows caption uses the active theme and falls back to the system preference', () => {
  assert.deepEqual(windowsControls('dark', false), { height: 58, color: '#252624', symbolColor: '#f3f1eb' });
  assert.deepEqual(windowsControls(null, true), windowsControls('dark', false));
  assert.deepEqual(windowsControls(null, false), windowsControls('light', true));
});
