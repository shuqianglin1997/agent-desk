// AgentDesk — 猫咪额度疲劳轴单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { constrainingWindow, deriveEnergy } = require('../src/yard/energy');

const NOW = Date.parse('2026-07-18T12:00:00Z');
const snapshot = (remaining, overrides = {}) => ({
  status: 'ok',
  observedAt: new Date(NOW - 60e3).toISOString(),
  windows: [{ id: 'codex:primary:300', remainingPercent: remaining, windowMinutes: 300, resetsAt: new Date(NOW + 60e3).toISOString() }],
  ...overrides
});

test('疲劳阈值只看剩余额度，不改写活动状态', () => {
  assert.equal(deriveEnergy(snapshot(80), NOW), 'fresh');
  assert.equal(deriveEnergy(snapshot(50), NOW), 'steady');
  assert.equal(deriveEnergy(snapshot(20), NOW), 'tired');
  assert.equal(deriveEnergy(snapshot(9), NOW), 'exhausted');
});

test('多个周期取最紧约束窗口', () => {
  const value = snapshot(75, {
    windows: [
      { id: 'weekly', remainingPercent: 75, windowMinutes: 10080, resetsAt: new Date(NOW + 600e3).toISOString() },
      { id: 'short', remainingPercent: 18, windowMinutes: 300, resetsAt: new Date(NOW + 300e3).toISOString() }
    ]
  });
  assert.equal(constrainingWindow(value, NOW).id, 'short');
  assert.equal(deriveEnergy(value, NOW), 'tired');
});

test('过期、旧缓存和非 ok 状态都不能继续驱动猫咪疲劳', () => {
  assert.equal(deriveEnergy(snapshot(2, {
    observedAt: new Date(NOW - 16 * 60e3).toISOString()
  }), NOW), 'unknown');
  assert.equal(deriveEnergy(snapshot(2, {
    windows: [{ remainingPercent: 2, resetsAt: new Date(NOW - 1).toISOString() }]
  }), NOW), 'unknown');
  assert.equal(deriveEnergy(snapshot(2, { status: 'stale' }), NOW), 'unknown');
});

test('服务端明确到限时直接没电；没有可信窗口则未知', () => {
  assert.equal(deriveEnergy(snapshot(90, { rateLimitReachedType: 'rate_limit_reached' }), NOW), 'exhausted');
  assert.equal(deriveEnergy(snapshot(90, { windows: [] }), NOW), 'unknown');
  assert.equal(deriveEnergy(null, NOW), 'unknown');
});
