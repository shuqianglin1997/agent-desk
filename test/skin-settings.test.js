const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, mergeSettings, settingsFromPayload } = require('../src/settings');

test('existing installations retain the cat skin in either appearance', () => {
  for (const theme of [null, 'light', 'dark']) {
    const settings = normalizeSettings({ theme, view: 'yard' });
    assert.equal(settings.skin, 'cat');
    assert.equal(settings.theme, theme);
    assert.equal(settings.view, 'yard');
  }
});

test('skin switches round-trip without changing appearance or workspace selections', () => {
  const original = normalizeSettings({
    skin: 'cat', theme: 'dark', view: 'yard', sessionScope: 'all',
    selectedDeviceLensId: 'device-a',
    selectedAgentIdByDeviceLens: { 'device-a': 'agent-b' },
    selectedSlotKeyByAgentAndLens: { 'device-a::agent-b': 'device-a:slot-c' },
    yardPositions: { 'agent-b': { x: 100, y: 100, zoneId: 'meadow', updatedAt: 42 } }
  });
  const switched = mergeSettings(original, { skin: 'vhs' });
  assert.deepEqual(switched, { ...original, skin: 'vhs' });
  const reopened = normalizeSettings(settingsFromPayload(JSON.parse(JSON.stringify({ version: 4, settings: switched }))));
  assert.deepEqual(reopened, switched);
  assert.deepEqual(mergeSettings(reopened, { theme: 'light' }), { ...switched, theme: 'light' });
  assert.deepEqual(mergeSettings(reopened, { skin: 'cat' }), original);
});

test('invalid persisted skins safely recover to the existing visual default', () => {
  for (const skin of [null, 'unknown', '../vhs.css', {}, ['vhs'], 1]) {
    assert.equal(normalizeSettings({ skin }).skin, 'cat');
  }
});

test('local roster order and VHS colors survive unrelated settings and a JSON restart', () => {
  const saved = normalizeSettings({ agentOrder: ['b', 'a', 'b', '', 2], vhsAgentColors: { a: '#Ab12Cd', b: 'red', c: '#12ff33' } });
  assert.deepEqual(saved.agentOrder, ['b', 'a']);
  assert.deepEqual(saved.vhsAgentColors, { a: '#ab12cd', c: '#12ff33' });
  const reopened = normalizeSettings(JSON.parse(JSON.stringify(mergeSettings(saved, { skin: 'cat', theme: 'light' }))));
  assert.deepEqual(reopened.agentOrder, saved.agentOrder);
  assert.deepEqual(reopened.vhsAgentColors, saved.vhsAgentColors);
  assert.deepEqual(normalizeSettings({ agentOrder: {}, vhsAgentColors: [] }).agentOrder, []);
});
