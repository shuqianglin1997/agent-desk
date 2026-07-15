// AgentDesk — 猫状态机单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { deriveState, defaultCatFor, normalizeCat, BREED_KEYS, COLLAR_COLORS } = require('../src/yard/cats');

const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const SECOND = 1000;
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

// ── 干活 vs 在岗：App 在跑时由 CPU 区分，mtime 仅作 CPU 不可得时的回退 ──
test('App 在跑 + CPU 高 → 干活中（真在生成）', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: true, cpu: 90, latestMtime: NOW - 2 * MINUTE })), 'working');
  // 关键：即使会话文件几分钟没动（Claude 桌面版写盘懒惰），CPU 高就是在干活
  assert.equal(deriveState(NOW, profile(), activity({ running: true, cpu: 90, latestMtime: null })), 'working');
});

test('关键修复：App 在跑 + CPU 空闲 → 在岗，哪怕会话文件刚被写过（Codex 后台狂写不算干活）', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: true, cpu: 3, latestMtime: NOW - 3 * SECOND })), 'onduty');
  assert.equal(deriveState(NOW, profile(), activity({ running: true, cpu: 0, latestMtime: null })), 'onduty');
});

test('CPU 不可得（Windows）时回退到会话 25 秒窗口', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: true, latestMtime: NOW - 5 * SECOND })), 'working');
  assert.equal(deriveState(NOW, profile(), activity({ running: true, latestMtime: NOW - 2 * MINUTE })), 'onduty');
  assert.equal(deriveState(NOW, profile(), activity({ running: true, latestMtime: null })), 'onduty');
});

test('进程探测整体不可用(null)：近期写过仍尽力当干活', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: null, latestMtime: NOW - 5 * SECOND })), 'working');
});

test('回归：探测失败(null) + 刚启动 + 正在写入 → 干活优先于开工路上', () => {
  const p = profile(new Date(NOW - 30 * SECOND).toISOString());
  assert.equal(deriveState(NOW, p, activity({ running: null, latestMtime: NOW - 5 * SECOND })), 'working');
});

test('探测失败(null) + 刚启动 + 无近期写入 → 开工路上', () => {
  const p = profile(new Date(NOW - 30 * SECOND).toISOString());
  assert.equal(deriveState(NOW, p, activity({ running: null, latestMtime: NOW - 60 * MINUTE })), 'arriving');
});

test('App 明确没开时，近期写入只是残留 → 不算干活（按活跃度=玩耍）', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: false, latestMtime: NOW - 5 * SECOND })), 'play');
});

test('App 没开、久未活动 → 按年龄玩耍/打盹/冬眠', () => {
  assert.equal(deriveState(NOW, profile(), activity({ running: false, latestMtime: NOW - 2 * MINUTE })), 'play');
  assert.equal(deriveState(NOW, profile(), activity({ running: false, latestMtime: NOW - 5 * DAY })), 'nap');
  assert.equal(deriveState(NOW, profile(), activity({ running: false, latestMtime: NOW - 20 * DAY })), 'hibernate');
});

test('开工路上：刚打开账号、App 还没探测到、也没在活动', () => {
  assert.equal(deriveState(NOW, profile(new Date(NOW - MINUTE).toISOString()), activity({ latestMtime: NOW - DAY / 2 })), 'arriving');
});

test('刚打开但 App 已探测到在跑且空闲 → 直接在岗，不再举牌占书桌', () => {
  const p = profile(new Date(NOW - MINUTE).toISOString());
  assert.equal(deriveState(NOW, p, activity({ running: true, latestMtime: NOW - 10 * MINUTE })), 'onduty');
});

test('干活中优先于开工路上（正在活动就是干活）', () => {
  const p = profile(new Date(NOW - MINUTE).toISOString());
  assert.equal(deriveState(NOW, p, activity({ running: true, latestMtime: NOW - SECOND })), 'working');
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
