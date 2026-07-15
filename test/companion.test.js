// AgentDesk — 陪伴账本单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { tick, emptyLedger, dayKey } = require('../src/yard/companion');

const T0 = Date.parse('2026-07-14T09:00:00.000Z');
const MIN = 60e3;
const step = (ledger, now, workingIds, remindersOn = true) => tick(ledger, { now, workingIds, remindersOn });

test('emptyLedger 从零开始，按本地日期', () => {
  const l = emptyLedger(T0);
  assert.equal(l.completed, 0);
  assert.equal(l.workedMs, 0);
  assert.equal(l.date, dayKey(T0));
});

test('干活会话逐步累加陪伴时长', () => {
  let l = emptyLedger(T0);
  ({ ledger: l } = step(l, T0, ['a']));                 // 开始
  assert.equal(l.workedMs, 0);
  ({ ledger: l } = step(l, T0 + 5 * MIN, ['a']));       // +5min
  ({ ledger: l } = step(l, T0 + 9 * MIN, ['a']));       // +4min
  assert.equal(Math.round(l.workedMs / MIN), 9);
  assert.equal(l.completed, 0);
});

test('超过宽限期不再写入 → 收工 +1，播报分钟数', () => {
  let l = emptyLedger(T0);
  ({ ledger: l } = step(l, T0, ['a']));
  ({ ledger: l } = step(l, T0 + 8 * MIN, ['a']));       // 干了 8 分钟
  let events;
  ({ ledger: l, events } = step(l, T0 + 8 * MIN + 11 * MIN, [])); // 11 分钟没动静 > 宽限
  assert.equal(l.completed, 1);
  assert.equal(Object.keys(l.active).length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'clockoff');
  assert.equal(events[0].minutes, 8);
});

test('宽限期内的写入间隙不算收工', () => {
  let l = emptyLedger(T0);
  ({ ledger: l } = step(l, T0, ['a']));
  let events;
  ({ ledger: l, events } = step(l, T0 + 6 * MIN, []));  // 才 6 分钟没动静
  assert.equal(l.completed, 0);
  assert.equal(events.length, 0);
  ({ ledger: l } = step(l, T0 + 7 * MIN, ['a']));        // 又开始写了
  assert.equal(Object.keys(l.active).length, 1);
});

test('连续干活超 90 分钟触发伸懒腰，且 90 分钟内不重复', () => {
  let l = emptyLedger(T0);
  const stretches = [];
  const drive = (t) => {
    const { ledger, events } = step(l, T0 + t * MIN, ['a']);
    l = ledger;
    events.filter((e) => e.type === 'stretch').forEach((e) => stretches.push({ t, minutes: e.minutes }));
  };
  // 真实节奏：每 9 分钟一 tick（< 宽限期），从 0 一路到 189 分钟
  drive(0);
  for (let t = 9; t <= 189; t += 9) drive(t);
  // 恰好两次：约 90 分钟一次、约 180 分钟一次（中间 90 分钟冷却压住）
  assert.equal(stretches.length, 2);
  assert.ok(stretches[0].minutes >= 90 && stretches[0].t <= 99);
  assert.ok(stretches[1].t >= 180);
});

test('中断超过宽限期会重置连续工作起点，不虚报伸懒腰', () => {
  let l = emptyLedger(T0);
  let events;
  ({ ledger: l } = step(l, T0, ['a']));                 // 开始
  ({ ledger: l, events } = step(l, T0 + 91 * MIN, ['a'])); // 单跳 91 分钟（中间没在看）
  // 这段没被追踪，应视为新起点，不能凭墙钟就报 91 分钟
  assert.equal(events.filter((e) => e.type === 'stretch').length, 0);
  assert.equal(Math.round(l.workedMs / MIN), 0);
});

test('关闭提醒时不发伸懒腰，但收工仍照记', () => {
  let l = emptyLedger(T0);
  let events;
  ({ ledger: l } = step(l, T0, ['a'], false));
  ({ ledger: l, events } = step(l, T0 + 95 * MIN, ['a'], false));
  assert.equal(events.filter((e) => e.type === 'stretch').length, 0);
  ({ ledger: l, events } = step(l, T0 + 95 * MIN + 11 * MIN, [], false));
  assert.equal(l.completed, 1); // 收工不受提醒开关影响
});

test('跨天清零', () => {
  let l = emptyLedger(T0);
  ({ ledger: l } = step(l, T0, ['a']));
  ({ ledger: l } = step(l, T0 + 30 * MIN, ['a']));
  const nextDay = T0 + 24 * 60 * MIN;
  ({ ledger: l } = step(l, nextDay, []));
  assert.equal(l.completed, 0);
  assert.equal(l.workedMs, 0);
  assert.equal(l.date, dayKey(nextDay));
});
