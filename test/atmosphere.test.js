const { test } = require('node:test');
const assert = require('node:assert');

const atmosphere = require('../src/yard/atmosphere');

test('自动时段按本地时钟映射白天、黄昏和夜晚', () => {
  assert.equal(atmosphere.timeForDate(new Date(2026, 6, 19, 6, 59)), 'night');
  assert.equal(atmosphere.timeForDate(new Date(2026, 6, 19, 7, 0)), 'day');
  assert.equal(atmosphere.timeForDate(new Date(2026, 6, 19, 17, 29)), 'day');
  assert.equal(atmosphere.timeForDate(new Date(2026, 6, 19, 17, 30)), 'dusk');
  assert.equal(atmosphere.timeForDate(new Date(2026, 6, 19, 19, 30)), 'night');
});

test('自动天气在同一时刻可复现，并维持 20–45 分钟', () => {
  const now = new Date(2026, 6, 19, 12, 34, 0);
  const first = atmosphere.weatherForDate(now, 'profile-seed');
  const second = atmosphere.weatherForDate(now, 'profile-seed');
  assert.deepEqual(first, second);
  assert.ok(atmosphere.WEATHER_KEYS.includes(first.weather));
  assert.ok(first.durationMinutes >= atmosphere.MIN_WEATHER_MINUTES);
  assert.ok(first.durationMinutes <= atmosphere.MAX_WEATHER_MINUTES);
  assert.ok(first.startedAt <= now.getTime());
  assert.ok(first.nextChangeAt > now.getTime());
});

test('自动天气不会依赖刷新次数，越过切换点后才进入下一段', () => {
  const start = new Date(2026, 11, 3, 8, 0, 0);
  const current = atmosphere.weatherForDate(start, 'stable');
  const before = atmosphere.weatherForDate(new Date(current.nextChangeAt - 1), 'stable');
  const after = atmosphere.weatherForDate(new Date(current.nextChangeAt + 1), 'stable');
  assert.equal(before.startedAt, current.startedAt);
  assert.ok(after.startedAt >= current.nextChangeAt);
});
