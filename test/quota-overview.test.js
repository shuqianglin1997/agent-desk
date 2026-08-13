// AgentDesk — 跨账号额度总览聚合单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { buildQuotaOverview, selectTrustedAccountQuota } = require('../src/quota-overview');

const NOW = Date.parse('2026-07-20T12:00:00Z');
const FUTURE = '2026-07-20T18:00:00Z';

function okQuota(profileId, remaining, opts = {}) {
  return {
    profileId,
    provider: 'codex',
    status: 'ok',
    planType: opts.planType || 'pro',
    windows: [{
      id: 'codex:primary:300',
      label: opts.label || '5 小时',
      remainingPercent: remaining,
      usedPercent: 100 - remaining,
      windowMinutes: opts.windowMinutes || 300,
      resetsAt: opts.resetsAt === undefined ? FUTURE : opts.resetsAt
    }],
    source: opts.source || 'codex-app-server',
    observedAt: '2026-07-20T11:59:00Z'
  };
}

const member = (id, bindingId = 'binding-a', alias = '工作账号') => ({
  id,
  appId: 'codex',
  _remote: false,
  _accountBindingId: bindingId,
  _accountBindingAlias: alias
});

test('空账号列表返回空总览', () => {
  assert.deepEqual(buildQuotaOverview([], {}, NOW), []);
});

test('有真实额度的账号按最紧窗口剩余升序排列（最紧在前）', () => {
  const profiles = [
    { id: 'a', name: '工作 Codex', appId: 'codex' },
    { id: 'b', name: '个人 Codex', appId: 'codex' },
    { id: 'c', name: '备用 Codex', appId: 'codex' }
  ];
  const quotas = { a: okQuota('a', 70), b: okQuota('b', 8), c: okQuota('c', 40) };

  const rows = buildQuotaOverview(profiles, quotas, NOW);

  assert.deepEqual(rows.map((r) => r.profileId), ['b', 'c', 'a']);
  assert.equal(rows[0].tightest.remainingPercent, 8);
  assert.equal(rows[0].hasQuota, true);
  assert.equal(rows[0].name, '个人 Codex');
  assert.equal(rows[0].planType, 'pro');
});

test('unsupported 账号排在有额度账号之后，且不伪造为 0', () => {
  const profiles = [
    { id: 'claude', name: '个人 Claude', appId: 'claude' },
    { id: 'codex', name: '工作 Codex', appId: 'codex' }
  ];
  const quotas = {
    claude: {
      profileId: 'claude',
      provider: 'claude',
      status: 'unsupported',
      windows: [],
      reason: 'Claude 无公开额度 API',
      planType: null
    },
    codex: okQuota('codex', 55)
  };

  const rows = buildQuotaOverview(profiles, quotas, NOW);

  assert.deepEqual(rows.map((r) => r.profileId), ['codex', 'claude']);
  const claudeRow = rows.find((r) => r.profileId === 'claude');
  assert.equal(claudeRow.hasQuota, false);
  assert.equal(claudeRow.tightest, null);
  assert.equal(claudeRow.status, 'unsupported');
  assert.match(claudeRow.reason, /Claude/);
});

test('尚未查询到额度的账号计为 loading 并排在最后', () => {
  const profiles = [
    { id: 'a', name: 'A', appId: 'codex' },
    { id: 'b', name: 'B', appId: 'codex' }
  ];
  const quotas = { a: okQuota('a', 30) };

  const rows = buildQuotaOverview(profiles, quotas, NOW);

  assert.deepEqual(rows.map((r) => r.profileId), ['a', 'b']);
  assert.equal(rows[1].status, 'loading');
  assert.equal(rows[1].hasQuota, false);
});

test('已过重置边界的窗口不再算作最紧，账号归入无额度组', () => {
  const profiles = [{ id: 'a', name: 'A', appId: 'codex' }];
  const past = '2026-07-20T06:00:00Z';
  const quotas = { a: okQuota('a', 5, { resetsAt: past }) };

  const rows = buildQuotaOverview(profiles, quotas, NOW);

  assert.equal(rows[0].hasQuota, false);
  assert.equal(rows[0].tightest, null);
});

test('总览行不携带账号邮箱等敏感字段', () => {
  const profiles = [{ id: 'a', name: 'A', appId: 'codex' }];
  const quotas = { a: { ...okQuota('a', 50), account: { email: 'leak@example.com' } } };

  const rows = buildQuotaOverview(profiles, quotas, NOW);

  assert.equal(JSON.stringify(rows).includes('leak@example.com'), false);
});

test('无效输入安全降级为空数组', () => {
  assert.deepEqual(buildQuotaOverview(null, null, NOW), []);
  assert.deepEqual(buildQuotaOverview(undefined, undefined), []);
});

test('卡片额度只接受本机、新鲜、未过重置点且 provider/source 匹配的快照', () => {
  const group = { key: 'agent-a', members: [member('a')] };
  const good = okQuota('a', 42);
  assert.equal(selectTrustedAccountQuota(group, { a: good }, NOW).status, 'ok');

  const rejected = [
    [{ a: good }, { quotaError: 'network failed' }],
    [{ a: { ...good, observedAt: '2026-07-20T12:01:00Z' } }, {}],
    [{ a: { ...good, observedAt: '2026-07-20T11:30:00Z' } }, {}],
    [{ a: { ...good, provider: 'claude' } }, {}],
    [{ a: { ...good, source: 'codex-session-log' } }, {}],
    [{ a: okQuota('a', 42, { resetsAt: '2026-07-20T11:00:00Z' }) }, {}]
  ];
  for (const [quotas, options] of rejected) {
    assert.equal(selectTrustedAccountQuota(group, quotas, NOW, options).status, 'unknown');
  }
  assert.equal(selectTrustedAccountQuota({ ...group, members: [{ ...member('a'), _remote: true }] }, { a: good }, NOW).status, 'unknown');
});

test('同一 AccountBinding 的近同时完整窗口冲突明确返回 conflict', () => {
  const base = okQuota('a', 20);
  const weekly = (remaining) => ({
    id: 'codex:secondary:10080',
    limitId: 'codex',
    kind: 'secondary',
    label: '每周',
    remainingPercent: remaining,
    usedPercent: 100 - remaining,
    windowMinutes: 10080,
    resetsAt: FUTURE
  });
  const group = { key: 'agent-a', members: [member('a'), member('b')] };
  const quotas = {
    a: { ...base, windows: [...base.windows, weekly(80)] },
    b: { ...okQuota('b', 20), observedAt: '2026-07-20T11:58:30Z', windows: [...base.windows, weekly(40)] }
  };
  const result = selectTrustedAccountQuota(group, quotas, NOW);
  assert.equal(result.status, 'conflict');
  assert.equal(result.bindingKey, 'binding-a');
});

test('同一 binding 取最新可信来源；多个 binding 再取最紧额度并保留可区分 alias', () => {
  const sameBinding = { key: 'agent-a', members: [member('old'), member('new')] };
  const newest = selectTrustedAccountQuota(sameBinding, {
    old: { ...okQuota('old', 10), observedAt: '2026-07-20T11:54:00Z' },
    new: { ...okQuota('new', 70), observedAt: '2026-07-20T11:59:00Z' }
  }, NOW);
  assert.equal(newest.status, 'ok');
  assert.equal(newest.member.id, 'new');

  const twoBindings = {
    key: 'agent-a',
    members: [member('work', 'binding-work', '工作账号'), member('personal', 'binding-personal', '个人账号')]
  };
  const tightest = selectTrustedAccountQuota(twoBindings, {
    work: okQuota('work', 65),
    personal: okQuota('personal', 12)
  }, NOW);
  assert.equal(tightest.status, 'ok');
  assert.equal(tightest.bindingKey, 'binding-personal');
  assert.equal(tightest.member._accountBindingAlias, '个人账号');
  assert.equal(tightest.tightest.remainingPercent, 12);
});
