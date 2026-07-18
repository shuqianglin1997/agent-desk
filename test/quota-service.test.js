// AgentDesk — 额度缓存、并发限制和 provider 降级单测。
const { test } = require('node:test');
const assert = require('node:assert');

const {
  SUCCESS_TTL_MS,
  fetchProfileQuota,
  mapWithConcurrency,
  QuotaService
} = require('../src/quota-service');

const profile = (id = 'p1', appId = 'codex') => ({ id, appId, sessionRoot: `/profiles/${id}` });
const snapshot = (id, status = 'ok') => ({ profileId: id, provider: 'codex', status, windows: [] });

test('同槽位并发请求合并，五分钟缓存，force 可绕过缓存', async () => {
  let now = 1_000_000;
  let calls = 0;
  const service = new QuotaService({
    now: () => now,
    fetchQuota: async (item) => {
      calls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return snapshot(item.id);
    }
  });

  const [first, second] = await Promise.all([service.get(profile()), service.get(profile())]);
  assert.equal(first, second);
  assert.equal(calls, 1);
  await service.get(profile());
  assert.equal(calls, 1);
  await service.get(profile(), { force: true });
  assert.equal(calls, 2);
  now += SUCCESS_TTL_MS + 1;
  await service.get(profile());
  assert.equal(calls, 3);
});

test('槽位 sessionRoot 改变会自动失效，不复用其他账号的额度', async () => {
  let calls = 0;
  const service = new QuotaService({ fetchQuota: async (item) => {
    calls += 1;
    return snapshot(item.id);
  } });
  await service.get(profile());
  await service.get({ ...profile(), sessionRoot: '/profiles/p1-new' });
  assert.equal(calls, 2);
});

test('批量查询最多并发两个后台任务并保持原顺序', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
});

test('Claude/Cursor 明确标记不支持，不尝试读取 Cookie', async () => {
  const claude = await fetchProfileQuota(profile('c1', 'claude'));
  const cursor = await fetchProfileQuota(profile('u1', 'cursor'));
  assert.equal(claude.status, 'unsupported');
  assert.match(claude.reason, /不读取浏览器 Cookie/);
  assert.equal(cursor.status, 'unsupported');
  assert.match(cursor.reason, /团队版/);
});

test('实时查询失败时优先返回 stale 本地缓存；无缓存才报 error', async () => {
  const failure = Object.assign(new Error('network detail'), { code: 'CODEX_RATE_LIMITS_FAILED' });
  const stale = await fetchProfileQuota(profile(), {
    readCodexQuota: async () => { throw failure; },
    readCachedCodexQuota: () => ({ ...snapshot('p1', 'stale'), reason: '本地缓存' })
  });
  assert.equal(stale.status, 'stale');
  assert.match(stale.reason, /无法连接 Codex/);

  const unavailable = await fetchProfileQuota(profile(), {
    readCodexQuota: async () => { throw failure; },
    readCachedCodexQuota: () => null
  });
  assert.equal(unavailable.status, 'error');
  assert.doesNotMatch(unavailable.reason, /network detail/);
});
