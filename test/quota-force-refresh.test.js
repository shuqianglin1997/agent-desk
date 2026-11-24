// "Refresh now" must fetch again even when an ordinary quota request is
// already running: it waits for that one, then asks once more with force.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { QuotaService } = require('../src/quota-service');
const { rendererSource } = require('./helpers/renderer-source');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('QuotaService: a forced request during an ordinary one fetches again after it', async () => {
  const calls = [];
  const pending = [];
  const service = new QuotaService({
    fetchQuota: (profile, options) => {
      calls.push(options.force === true);
      const step = deferred();
      pending.push(step);
      return step.promise;
    }
  });
  const profile = { id: 'p', appId: 'codex', sessionRoot: '/x' };
  const ordinary = service.get(profile);
  const forced = service.get(profile, { force: true });
  const again = service.get(profile, { force: true });
  await new Promise((resolve) => setImmediate(resolve));
  pending[0].resolve({ status: 'ok', value: 'old' });
  assert.deepEqual(await ordinary, { status: 'ok', value: 'old' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2, 'the forced request started its own fetch');
  pending[1].resolve({ status: 'ok', value: 'new' });
  assert.deepEqual(await forced, { status: 'ok', value: 'new' });
  assert.deepEqual(await again, { status: 'ok', value: 'new' }, 'a second forced call joins the queued one');
  assert.deepEqual(calls, [false, true]);
});

test('renderer loadQuotas(true) during a running request asks Main again with force', async () => {
  const renderer = rendererSource();
  const fn = (name) => renderer.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];
  const requests = [];
  const pending = [];
  const context = vm.createContext({
    state: {},
    tr: (key) => key,
    renderQuotaSummary() {}, renderAccountHeader() {}, renderAttentionInbox() {},
    window: { manager: { listQuotas: (options) => { requests.push(options); const step = deferred(); pending.push(step); return step.promise; } } }
  });
  // Every top-level quota* variable the function relies on, taken from the source.
  const declarations = (renderer.match(/^let quota\w+ = [^\n]*$/gm) || []).join('\n');
  vm.runInContext(`${declarations}\n${fn('loadQuotas')}`, context);
  const first = context.loadQuotas();
  const forced = context.loadQuotas(true);
  pending[0].resolve([{ profileId: 'p', value: 'old' }]);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2, 'a second request was sent');
  assert.deepEqual(requests.map((options) => options.force), [false, true]);
  pending[1].resolve([{ profileId: 'p', value: 'new' }]);
  await forced;
  assert.equal(context.state.quotas.p.value, 'new');
});
