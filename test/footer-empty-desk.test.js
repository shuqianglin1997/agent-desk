// The footer's "no cats on the desk yet" line belongs to the empty desk only
// (docs/ARCHITECTURE_PLAN.md 9.1, phase 6 close). Start-up drew the empty
// roster before the profiles arrived, so a desk full of cats kept saying it
// had none. Once cards are drawn, a line that is still the empty-desk one goes
// back to the footer's starting state; any other message stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { rendererFunction } = require('./helpers/renderer-source');

function footer() {
  const parent = { dataset: {} };
  const statusText = {
    parentElement: parent,
    dataset: { i18n: 'status.ready' },
    textContent: '就绪',
    removeAttribute(name) { if (name === 'data-i18n') delete this.dataset.i18n; }
  };
  const words = { 'status.ready': '就绪', 'roster.empty.status': '台面上还没有猫。从“招募第一只猫”开始。' };
  const ctx = vm.createContext({ els: { statusText }, tr: (key) => words[key] });
  vm.runInContext(`${rendererFunction('setStatus')}\n${rendererFunction('showEmptyDeskStatus')}\n${rendererFunction('clearEmptyDeskStatus')}`, ctx);
  return { ctx, statusText, parent, words };
}

test('cards replace a still-showing empty-desk line with the starting footer', () => {
  const { ctx, statusText, parent, words } = footer();
  ctx.showEmptyDeskStatus();
  assert.equal(statusText.textContent, words['roster.empty.status']);
  ctx.clearEmptyDeskStatus();
  assert.equal(statusText.textContent, '就绪');
  assert.equal(statusText.dataset.i18n, 'status.ready', 'it follows the language again, as on start-up');
  assert.equal(parent.dataset.tone, undefined);
  assert.equal(statusText.dataset.emptyDesk, undefined);
});

test('the empty-desk line only replaces the starting footer, and a later message is kept', () => {
  const { ctx, statusText } = footer();
  ctx.setStatus('导出完成');
  ctx.showEmptyDeskStatus();
  assert.equal(statusText.textContent, '导出完成', 'a real message is not replaced');
  const fresh = footer();
  fresh.ctx.showEmptyDeskStatus();
  fresh.ctx.setStatus('正在读取会话');
  fresh.ctx.clearEmptyDeskStatus();
  assert.equal(fresh.statusText.textContent, '正在读取会话', 'cards arriving do not wipe a newer message');
});
