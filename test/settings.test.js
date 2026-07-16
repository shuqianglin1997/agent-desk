const { test } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_SETTINGS,
  settingsFromPayload,
  normalizeLedger,
  normalizeSettings,
  mergeSettings
} = require('../src/settings');

test('设置载荷区分合法包装、旧版裸对象和损坏包装', () => {
  assert.deepEqual(settingsFromPayload({
    version: 1,
    settings: { theme: 'dark' }
  }), { theme: 'dark' });
  assert.deepEqual(settingsFromPayload({ theme: 'light' }), { theme: 'light' });
  assert.equal(settingsFromPayload({ version: 1, settings: null }), null);
  assert.equal(settingsFromPayload({ version: 1 }), null);
});

test('旧 localStorage 设置会被完整归一化到稳定设置结构', () => {
  const normalized = normalizeSettings({
    theme: 'dark',
    view: 'classic',
    remindersOn: false,
    atmosTime: 'dusk',
    atmosWeather: 'rain',
    welcomed: true,
    ledger: {
      date: '2026-7-16',
      completed: 3,
      workedMs: 120000,
      active: { a: { start: 10, last: 20 } },
      lastStretchAt: 30
    }
  });

  assert.equal(normalized.theme, 'dark');
  assert.equal(normalized.view, 'classic');
  assert.equal(normalized.remindersOn, false);
  assert.equal(normalized.atmosTime, 'dusk');
  assert.equal(normalized.atmosWeather, 'rain');
  assert.equal(normalized.welcomed, true);
  assert.deepEqual(normalized.ledger.active.a, { start: 10, last: 20 });
});

test('非法设置安全回落默认值，损坏账本不会阻断启动', () => {
  const normalized = normalizeSettings({
    theme: 'sepia',
    view: 'unknown',
    remindersOn: 'no',
    atmosTime: 'sunset',
    atmosWeather: 'storm',
    welcomed: 1,
    ledger: { date: 123 }
  });

  assert.deepEqual(normalized, DEFAULT_SETTINGS);
  assert.equal(normalizeLedger(null), null);
});

test('局部设置更新不会覆盖其他颜色、视图和账本设置', () => {
  const current = normalizeSettings({
    theme: 'dark',
    view: 'yard',
    remindersOn: false,
    atmosTime: 'night',
    atmosWeather: 'snow',
    welcomed: true,
    ledger: {
      date: '2026-7-16',
      completed: 2,
      workedMs: 60000,
      active: {},
      lastStretchAt: 0
    }
  });
  const next = mergeSettings(current, { view: 'classic' });

  assert.equal(next.view, 'classic');
  assert.equal(next.theme, 'dark');
  assert.equal(next.atmosTime, 'night');
  assert.equal(next.atmosWeather, 'snow');
  assert.equal(next.remindersOn, false);
  assert.deepEqual(next.ledger, current.ledger);
});

test('localStorage 镜像可覆盖较旧的稳定设置，同时保留未修改字段', () => {
  const stored = normalizeSettings({
    theme: 'light',
    view: 'yard',
    remindersOn: true,
    atmosTime: 'day',
    atmosWeather: 'clear',
    welcomed: true
  });
  const reconciled = mergeSettings(stored, {
    theme: 'dark',
    atmosWeather: 'rain'
  });

  assert.equal(reconciled.theme, 'dark');
  assert.equal(reconciled.atmosWeather, 'rain');
  assert.equal(reconciled.view, 'yard');
  assert.equal(reconciled.atmosTime, 'day');
  assert.equal(reconciled.welcomed, true);
});

test('未来版本新增的设置字段会保留，不被旧归一化流程删除', () => {
  const normalized = normalizeSettings({
    futureAccent: '#123456',
    ledger: {
      date: '2026-7-16',
      completed: 1,
      workedMs: 1000,
      active: {},
      lastStretchAt: 0,
      futureStreak: 7
    }
  });
  assert.equal(normalized.futureAccent, '#123456');
  assert.equal(normalized.ledger.futureStreak, 7);
});
