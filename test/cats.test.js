// AgentDesk — 猫状态机单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { deriveState, defaultCatFor, normalizeCat, BREED_KEYS, COLLAR_COLORS } = require('../src/yard/cats');

const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const MINUTE = 60e3;
const DAY = 24 * 60 * MINUTE;

function activity(overrides = {}) {
  return { rootExists: true, rootReadable: true, latestMtime: null, fileCount: 0, ...overrides };
}
const profile = (lastLaunchedAt = null) => ({ id: 'p1', lastLaunchedAt });

// ── deriveState：优先级从上到下 ───────────────────────
test('迷路：根目录不存在或不可读，压过一切', () => {
  assert.equal(deriveState(NOW, profile(new Date(NOW).toISOString()), activity({ rootExists: false })), 'confused');
  assert.equal(deriveState(NOW, profile(), activity({ rootReadable: false, latestMtime: NOW - MINUTE })), 'confused');
});

test('干活中：最新会话文件 5 分钟内被写过', () => {
  assert.equal(deriveState(NOW, profile(), activity({ latestMtime: NOW - 2 * MINUTE })), 'working');
});

test('开工路上：刚打开账号但还没有写入', () => {
  assert.equal(deriveState(NOW, profile(new Date(NOW - MINUTE).toISOString()), activity({ latestMtime: NOW - DAY / 2 })), 'arriving');
});

test('干活中优先于开工路上', () => {
  const p = profile(new Date(NOW - MINUTE).toISOString());
  assert.equal(deriveState(NOW, p, activity({ latestMtime: NOW - MINUTE })), 'working');
});

test('活跃分档：玩耍 <24h、面包 <3d、打盹 <7d、冬眠 ≥7d', () => {
  assert.equal(deriveState(NOW, profile(), activity({ latestMtime: NOW - 3 * 60 * MINUTE })), 'play');
  assert.equal(deriveState(NOW, profile(), activity({ latestMtime: NOW - 2 * DAY })), 'rest');
  assert.equal(deriveState(NOW, profile(), activity({ latestMtime: NOW - 5 * DAY })), 'nap');
  assert.equal(deriveState(NOW, profile(), activity({ latestMtime: NOW - 20 * DAY })), 'hibernate');
});

test('全新槽位（没会话、没打开过）是面包猫，不进纸箱', () => {
  assert.equal(deriveState(NOW, profile(), activity()), 'rest');
});

test('有过启动记录但很久没会话 → 冬眠', () => {
  assert.equal(deriveState(NOW, profile(new Date(NOW - 30 * DAY).toISOString()), activity()), 'hibernate');
});

test('探测缺失时按面包猫处理，不误报迷路', () => {
  assert.equal(deriveState(NOW, profile(), null), 'rest');
  assert.equal(deriveState(NOW, profile(), undefined), 'rest');
});

// ── 外观 ─────────────────────────────────────────────
test('defaultCatFor：同一 id 稳定，不同 id 大概率不同', () => {
  const a1 = defaultCatFor('id-aaa');
  const a2 = defaultCatFor('id-aaa');
  assert.deepEqual(a1, a2);
  assert.ok(BREED_KEYS.includes(a1.breed));
  assert.ok(COLLAR_COLORS.includes(a1.collar));
});

test('normalizeCat：非法/缺失字段回落确定性默认', () => {
  const fallback = defaultCatFor('seed');
  assert.deepEqual(normalizeCat(null, 'seed'), fallback);
  assert.deepEqual(normalizeCat({ breed: 'dragon', collar: 'red', accessory: '???' }, 'seed'), fallback);
  const kept = normalizeCat({ breed: 'cow', collar: '#123ABC', accessory: 'scarf' }, 'seed');
  assert.deepEqual(kept, { breed: 'cow', collar: '#123ABC', accessory: 'scarf' });
});
