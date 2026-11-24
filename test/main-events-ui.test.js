// Main's change notifications reach the window's views through the store
// (docs/ARCHITECTURE_PLAN.md 5.6, phase 6): each event Main sends becomes the
// store topic 'main:<preload method>', and the views subscribe to topics.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UiContext = require('../src/ui-context');
const { EVENTS } = require('../src/commands/events');
const { rendererFiles, rendererFunction, rendererSource } = require('./helpers/renderer-source');

const methodsOf = () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'main-events.js'), 'utf8');
  return [...source.match(/const MAIN_EVENT_METHODS = \[([\s\S]*?)\];/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
};

test('every event Main sends to the window is a store topic, except the lamp that boot.js hears itself', () => {
  const expected = EVENTS.map(([, method]) => method).filter((method) => method !== 'onWindowLamp').sort();
  assert.deepEqual(methodsOf().sort(), expected);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'pixel', 'boot.js'), 'utf8'), /root\.manager\.onWindowLamp\(receive\)/);
});

test('an event Main sends reaches the subscribed view with its payload; an absent event is not subscribed', () => {
  const registered = {};
  const store = UiContext.createStore(() => ({}));
  const manager = Object.fromEntries(methodsOf().filter((m) => m !== 'onHubChanged').map((method) => [method, (callback) => { registered[method] = callback; }]));
  const ctx = vm.createContext({ window: { manager }, store });
  vm.runInContext(`const MAIN_EVENT_METHODS = ${JSON.stringify(methodsOf())};\n${rendererFunction('bindMainEvents')}\n${rendererFunction('offersMainEvent')}\n${rendererFunction('onMainEvent')}`, ctx);
  ctx.bindMainEvents();
  assert.equal(Object.keys(registered).length, methodsOf().length - 1);
  assert.equal(ctx.offersMainEvent('onHubChanged'), false);
  const seen = [];
  ctx.onMainEvent('onTransfersChanged', (value) => seen.push(['transfers', value]));
  ctx.onMainEvent('onUpdateProgress', (value) => seen.push(['update', value]));
  registered.onTransfersChanged([{ transferId: 't1' }]);
  registered.onUpdateProgress({ percent: 40 });
  assert.deepEqual(seen, [['transfers', [{ transferId: 't1' }]], ['update', { percent: 40 }]]);
});

test('no view subscribes to Main directly; bindEvents starts the bridge first', () => {
  for (const file of rendererFiles()) {
    if (file.endsWith(path.join('views', 'main-events.js'))) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /window\.manager\.on[A-Z]\w*\s*(?:\?\.)?\(/, path.basename(file));
  }
  assert.match(rendererFunction('bindEvents'), /^function bindEvents\(\) \{\n[^\n]*\n\s*bindMainEvents\(\);/);
  assert.equal((rendererSource().match(/onMainEvent\('/g) || []).length, 15);
});
