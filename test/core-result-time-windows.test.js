const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const result = require('../src/core/result');
const windows = require('../src/core/time-windows');

test('a result is either a value or a fixed reason code, never an empty stand-in', () => {
  assert.deepEqual(result.ok([], { truncated: true }), { truncated: true, ok: true, value: [] });
  assert.deepEqual(result.fail('sqlite-unavailable', { detail: 1 }), { detail: 1, ok: false, code: 'sqlite-unavailable' });
  assert.throws(() => result.fail('Free text with spaces'), /result-code-invalid/);
  assert.equal(result.isResult(result.ok(0)), true);
  assert.equal(result.isResult({ ok: false }), false);
  assert.equal(result.valueOr(result.fail('x'), 'fallback'), 'fallback');
  assert.deepEqual(result.ok('v', { ok: false, value: 'spoof' }), { ok: true, value: 'v' });
});

test('a fact says how it is known; unknown always carries null', () => {
  assert.deepEqual(result.fact(3, 'inferred', { at: 5, source: 'file-times' }), { value: 3, certainty: 'inferred', at: 5, source: 'file-times' });
  assert.deepEqual(result.fact(false, 'unknown'), { value: null, certainty: 'unknown', at: null, source: null });
  assert.deepEqual(result.unknown({ source: 'no-data-dir-flag' }).value, null);
  assert.throws(() => result.fact(1, 'probably'), /fact-certainty-invalid/);
});

test('the time windows are defined once and read the same in Node and the renderer', () => {
  assert.equal(windows.RUNNING_WINDOW_MS, 90_000);
  assert.equal(windows.ACTIVE_NOW_MS, 300_000);
  assert.equal(windows.QUOTA_FRESH_MS, 900_000);
  assert.ok(Object.isFrozen(windows));
  const context = vm.createContext({});
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core/time-windows.js'), 'utf8'), context);
  assert.equal(context.AgentDeskTimeWindows.RUNNING_WINDOW_MS, windows.RUNNING_WINDOW_MS);
  assert.equal(context.AgentDeskTimeWindows.QUOTA_FRESH_MS, windows.QUOTA_FRESH_MS);
});

test('every consumer uses the shared windows', () => {
  assert.equal(require('../src/yard/cats').WORKING_WINDOW, windows.RUNNING_WINDOW_MS);
  assert.equal(require('../src/activity').WRITING_WINDOW_MS, windows.RUNNING_WINDOW_MS);
  assert.equal(require('../src/yard/energy').DEFAULT_MAX_AGE_MS, windows.QUOTA_FRESH_MS);
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const order = (name) => html.indexOf(`src="./${name}"`);
  assert.ok(order('core/time-windows.js') > 0, 'the renderer loads the shared windows');
  for (const consumer of ['yard/cats.js', 'yard/energy.js', 'quota-overview.js']) assert.ok(order('core/time-windows.js') < order(consumer), consumer);
});
