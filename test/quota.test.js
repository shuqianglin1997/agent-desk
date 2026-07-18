// AgentDesk — 额度统一模型单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const {
  clampPercent,
  timestampToIso,
  durationLabel,
  normalizeCodexRateLimits,
  quotaUnavailable
} = require('../src/quota');

test('百分比和时间戳归一化安全且有边界', () => {
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent('42'), 42);
  assert.equal(clampPercent(104), 100);
  assert.equal(clampPercent('oops'), null);
  assert.equal(timestampToIso(1_721_000_000), '2024-07-14T23:33:20.000Z');
  assert.equal(timestampToIso('2026-07-18T12:00:00Z'), '2026-07-18T12:00:00.000Z');
});

test('窗口名称按服务端真实时长生成，不假设 primary 一定是 5 小时', () => {
  assert.equal(durationLabel(300), '5 小时');
  assert.equal(durationLabel(1440), '每天');
  assert.equal(durationLabel(10080), '每周');
  assert.equal(durationLabel(43200), '30 天');
});

test('Codex 多桶响应优先于兼容桶，并保留额度最小必要字段', () => {
  const result = normalizeCodexRateLimits({
    rateLimits: {
      planType: 'plus',
      primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_000 }
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        limitName: 'Codex',
        planType: 'pro',
        primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_700_000_000 },
        credits: { hasCredits: true, unlimited: false, balance: '12.50' }
      }
    },
    account: { email: 'must-not-leak@example.com' }
  }, { profileId: 'p-codex', observedAt: '2026-07-18T12:00:00Z' });

  assert.equal(result.profileId, 'p-codex');
  assert.equal(result.planType, 'pro');
  assert.deepEqual(result.windows.map((item) => [item.label, item.usedPercent, item.remainingPercent]), [
    ['每周', 35, 65],
    ['5 小时', 12, 88]
  ]);
  assert.deepEqual(result.credits, { hasCredits: true, unlimited: false, balance: '12.50' });
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});

test('兼容旧版 snake_case token_count 额度结构', () => {
  const result = normalizeCodexRateLimits({
    plan_type: 'team',
    primary: { used_percent: 82, window_minutes: 300, resets_at: 1_800_000_000 },
    rate_limit_reached_type: null
  }, { status: 'stale', source: 'session-log' });

  assert.equal(result.status, 'stale');
  assert.equal(result.source, 'session-log');
  assert.equal(result.planType, 'team');
  assert.equal(result.windows[0].remainingPercent, 18);
});

test('不支持的 provider 也返回稳定结构', () => {
  assert.deepEqual(
    quotaUnavailable('p1', 'claude', 'unsupported', '没有公开个人额度 API', 1_721_000_000_000),
    {
      profileId: 'p1',
      provider: 'claude',
      status: 'unsupported',
      planType: null,
      windows: [],
      credits: null,
      rateLimitReachedType: null,
      source: 'agentdesk',
      observedAt: '2024-07-14T23:33:20.000Z',
      reason: '没有公开个人额度 API'
    }
  );
});
