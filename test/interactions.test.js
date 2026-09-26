const { test } = require('node:test');
const assert = require('node:assert');

const interactions = require('../src/yard/interactions');

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
