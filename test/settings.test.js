const { test } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_SETTINGS,
  settingsFromPayload,
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
    sessionScope: 'all',
    sessionView: 'detail',
    selectedDeviceLensId: 'device-local',
    selectedAgentIdByDeviceLens: { all: 'agent-peter', 'device-local': 'agent-peter' },
    selectedSlotKeyByAgentAndLens: { 'device-local::agent-peter': 'device-local:profile-peter' },
    remindersOn: false,
    profileQuitBehavior: 'keep',
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
  assert.equal(Object.hasOwn(normalized, 'view'), false);
  assert.equal(normalized.sessionScope, 'all');
  assert.equal(normalized.sessionView, 'detail');
  assert.equal(normalized.selectedDeviceLensId, 'device-local');
  assert.deepEqual(normalized.selectedAgentIdByDeviceLens, {
    all: 'agent-peter',
    'device-local': 'agent-peter'
  });
  assert.deepEqual(normalized.selectedSlotKeyByAgentAndLens, {
    'device-local::agent-peter': 'device-local:profile-peter'
  });
  assert.equal(normalized.profileQuitBehavior, 'keep');
  assert.equal(normalized.welcomed, true);
  assert.deepEqual(normalized.onboarding, { completedVersion: 0, completedAt: null });
  // Retired features' fields are kept untouched under `retired` (settings version 5).
  assert.equal(normalized.retired.view, 'classic');
  assert.equal(normalized.retired.remindersOn, false);
  assert.equal(normalized.retired.atmosTime, 'dusk');
  assert.equal(normalized.retired.atmosWeather, 'rain');
  assert.deepEqual(normalized.retired.ledger.active.a, { start: 10, last: 20 });
});

test('非法设置安全回落默认值；退休字段原样收进 retired，不会阻断启动', () => {
  const normalized = normalizeSettings({
    theme: 'sepia',
    view: 'unknown',
    sessionScope: 'some',
    sessionView: 'cards',
    selectedDeviceLensId: '',
    selectedAgentIdByDeviceLens: ['agent-a'],
    selectedSlotKeyByAgentAndLens: { all: '' },
    remindersOn: 'no',
    atmosTime: 'sunset',
    atmosWeather: 'storm',
    welcomed: 1,
    ledger: { date: 123 }
  });

  const { retired, ...rest } = normalized;
  assert.deepEqual(rest, DEFAULT_SETTINGS);
  assert.deepEqual(retired, { view: 'unknown', remindersOn: 'no', atmosTime: 'sunset', atmosWeather: 'storm', ledger: { date: 123 } });
});

test('局部设置更新不会覆盖其他设置，也不会动收起来的退休字段', () => {
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
  const next = mergeSettings(current, { sessionView: 'detail' });

  assert.equal(next.sessionView, 'detail');
  assert.equal(next.theme, 'dark');
  assert.equal(next.profileQuitBehavior, 'close');
  assert.deepEqual(next.retired, current.retired);
  assert.equal(next.retired.view, 'yard');
  assert.equal(next.retired.atmosTime, 'night');
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
    welcomed: true
  });

  assert.equal(reconciled.theme, 'dark');
  assert.equal(reconciled.welcomed, true);
  assert.equal(reconciled.retired.view, 'yard');
  assert.equal(reconciled.retired.atmosTime, 'day');
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
  assert.equal(normalized.retired.ledger.futureStreak, 7);
});

test('退休的庭院位置原样收进 retired，不再被规整', () => {
  const positions = { catA: { x: 123.45, y: 99.95, zoneId: 'meadow', updatedAt: 42 }, bad: { x: 'left', y: null } };
  const normalized = normalizeSettings({ atmosWeather: 'auto', yardPositions: positions });
  assert.deepEqual(normalized.retired, { atmosWeather: 'auto', yardPositions: positions });
});

test('首次使用完成状态按独立版本保存，旧 welcomed 不会跳过新向导', () => {
  const legacy = normalizeSettings({ welcomed: true });
  assert.equal(legacy.welcomed, true);
  assert.deepEqual(legacy.onboarding, { completedVersion: 0, completedAt: null });

  const completed = normalizeSettings({
    welcomed: true,
    onboarding: {
      completedVersion: 1,
      completedAt: '2026-08-14T00:00:00.000Z'
    }
  });
  assert.deepEqual(completed.onboarding, {
    completedVersion: 1,
    completedAt: '2026-08-14T00:00:00.000Z'
  });

  const damaged = normalizeSettings({
    onboarding: { completedVersion: -8, completedAt: 123 }
  });
  assert.deepEqual(damaged.onboarding, { completedVersion: 0, completedAt: null });
});

test('没有退休字段的设置不会凭空多出 retired', () => {
  const normalized = normalizeSettings({ theme: 'dark' });
  assert.equal(Object.hasOwn(normalized, 'retired'), false);
  assert.equal(Object.hasOwn(normalized, 'atmosWeather'), false);
});

test('设备网络设置只保留 HTTPS/本机信令与 STUN 地址', () => {
  const normalized = normalizeSettings({
    meshSignalingUrls: [
      'https://signal.example.test/',
      'http://127.0.0.1:8787',
      'http://public.example.test',
      'file:///tmp/socket'
    ],
    meshStunUrls: ['stun:stun.example.test:3478', 'https://not-stun.example.test']
  });
  assert.deepEqual(normalized.meshSignalingUrls, [
    'https://signal.example.test',
    'http://127.0.0.1:8787'
  ]);
  assert.deepEqual(normalized.meshStunUrls, ['stun:stun.example.test:3478']);
});

test('Mesh 联网登记保持 boolean/null 三态，首次使用可明确保持离线', () => {
  assert.equal(normalizeSettings({}).meshNetworkEnrollmentEnabled, null);
  assert.equal(normalizeSettings({ meshNetworkEnrollmentEnabled: false }).meshNetworkEnrollmentEnabled, false);
  assert.equal(normalizeSettings({ meshNetworkEnrollmentEnabled: true }).meshNetworkEnrollmentEnabled, true);
  assert.equal(normalizeSettings({ meshNetworkEnrollmentEnabled: 'yes' }).meshNetworkEnrollmentEnabled, null);
});
test('Agent 顺序设置去重、有界，并兼容旧设置与其他偏好', () => {
  assert.deepEqual(normalizeSettings({}).agentOrder, []);
  assert.deepEqual(normalizeSettings({ agentOrder: ['b', 'a', 'b', null, '', ' c '] }).agentOrder, ['b', 'a', 'c']);
  const merged = mergeSettings({ theme: 'dark', agentOrder: ['a', 'b'] }, { agentOrder: ['b', 'a'] });
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.agentOrder, ['b', 'a']);
  assert.equal(normalizeSettings({ agentOrder: Array.from({ length: 1100 }, (_, n) => `agent-${n}`) }).agentOrder.length, 1000);
});
