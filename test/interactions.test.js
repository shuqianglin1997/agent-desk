const { test } = require('node:test');
const assert = require('node:assert');

const interactions = require('../src/yard/interactions');

test('语义区域只作为拖放命中层，重叠时优先具体设施', () => {
  assert.equal(interactions.zoneAt(118, 52).id, 'mailbox');
  assert.equal(interactions.zoneAt(236, 104).id, 'attention');
  assert.equal(interactions.zoneAt(420, 70).id, 'remote');
  assert.equal(interactions.zoneAt(250, 60), null);
});

test('位置归一化会限界、过滤损坏值并保留未来可识别字段', () => {
  const result = interactions.normalizePositions({
    a: { x: -20, y: 999, zoneId: 'home', updatedAt: 12 },
    b: { x: 'x', y: 80 },
    c: null
  });
  assert.deepEqual(result, {
    a: { x: 10, y: 126, zoneId: 'home', updatedAt: 12 }
  });
});

test('投到工作亭只生成需确认的打开意图，不直接执行', () => {
  const intent = interactions.resolveDropIntent('workshop', { activityState: 'rest' });
  assert.equal(intent.action, 'launch-profile');
  assert.equal(intent.enabled, true);
  assert.equal(intent.requiresConfirmation, true);
});

test('交接和远程区域会按真实能力禁用，不伪造成功', () => {
  assert.equal(interactions.resolveDropIntent('mailbox', { hasSession: false }).enabled, false);
  assert.equal(interactions.resolveDropIntent('mailbox', { hasSession: true }).action, 'copy-handoff');
  assert.equal(interactions.resolveDropIntent('remote', { terminalSupported: false }).enabled, false);
});
