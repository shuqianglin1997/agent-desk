// AgentDesk — 工作量评分单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { accountScore, rankAccounts, W_WORKING } = require('../src/yard/workload');

const s = (a, c) => Math.round(10 * Math.sqrt(a) + 6 * Math.sqrt(c));

test('accountScore：平方根阻尼 + 干活×15', () => {
  assert.equal(accountScore({ activeToday: 4, createdToday: 4, working: false }), s(4, 4)); // 10*2+6*2=32
  assert.equal(accountScore({ activeToday: 4, createdToday: 4, working: true }), s(4, 4) + W_WORKING);
  assert.equal(accountScore({}), 0);
  assert.equal(accountScore(null), 0);
});

test('平方根阻尼：会话数拉大后分差被压缩（跨工具更公平）', () => {
  // 100 场 vs 4 场：线性是 25 倍，平方根后约 5 倍
  const many = accountScore({ activeToday: 100, createdToday: 0, working: false }); // 100
  const few = accountScore({ activeToday: 4, createdToday: 0, working: false });    // 20
  assert.ok(many / few < 6, `倍数应被压到 6 以内，实际 ${many / few}`);
});

test('rankAccounts：按分降序，正在干活的靠前', () => {
  const ranked = rankAccounts([
    { name: 'A', activeToday: 1, createdToday: 0, working: false }, // 10
    { name: 'B', activeToday: 1, createdToday: 0, working: true },  // 10+15=25
    { name: 'C', activeToday: 9, createdToday: 0, working: false }  // 30
  ]);
  assert.deepEqual(ranked.map((r) => r.name), ['C', 'B', 'A']);
  assert.equal(ranked[0].score, 30);
});

test('rankAccounts：同分按今日活跃再按名称稳定排序', () => {
  const ranked = rankAccounts([
    { name: '乙', activeToday: 0, createdToday: 5, working: false }, // 30
    { name: '甲', activeToday: 3, createdToday: 0, working: false }, // 30
    { name: '丙', activeToday: 0, createdToday: 5, working: false }  // 30
  ]);
  // 甲 活跃更多排最前；乙丙同分同活跃按名称
  assert.equal(ranked[0].name, '甲');
  assert.deepEqual(ranked.slice(1).map((r) => r.name), ['丙', '乙']);
});
