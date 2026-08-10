const { test } = require('node:test');
const assert = require('node:assert');

const interactions = require('../src/yard/interactions');

test('语义区域只作为拖放命中层，重叠时优先具体设施', () => {
  assert.equal(interactions.zoneAt(50, 52).id, 'workshop');
  assert.equal(interactions.zoneAt(236, 104).id, 'attention');
  assert.equal(interactions.zoneAt(420, 104).id, 'meadow');
  assert.equal(interactions.zoneAt(250, 60), null);
});

test('位置归一化会限界、过滤损坏值并保留未来可识别字段', () => {
  const result = interactions.normalizePositions({
    a: { x: -20, y: 999, zoneId: 'home', updatedAt: 12 },
    b: { x: 'x', y: 80 },
    c: null
  });
  assert.deepEqual(result, {
    a: { x: 10, y: 230, zoneId: 'home', updatedAt: 12 } // y 上限 = 画布高 236 - 6
  });
});

test('投到工作亭只生成需确认的打开意图，不直接执行', () => {
  const intent = interactions.resolveDropIntent('workshop', { activityState: 'rest' });
  assert.equal(intent.action, 'launch-profile');
  assert.equal(intent.enabled, true);
  assert.equal(intent.requiresConfirmation, true);
});

test('庭院只保留账号打开、会话聚焦和位置保存三类核心意图', () => {
  assert.deepEqual(interactions.ZONES.map((zone) => zone.id), ['workshop', 'attention', 'meadow']);
  assert.equal(interactions.resolveDropIntent('attention', { hasSession: false }).enabled, false);
  assert.equal(interactions.resolveDropIntent('attention', { hasSession: true }).action, 'focus-session');
  assert.equal(interactions.resolveDropIntent('meadow').action, 'save-position');
  assert.equal(interactions.resolveDropIntent('unknown').action, 'save-position');
});
