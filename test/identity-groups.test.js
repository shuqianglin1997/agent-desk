// AgentDesk — 账号身份分组（一个登录账号的多个客户端槽位归拢为一组）。
const { test } = require('node:test');
const assert = require('node:assert');

const { groupProfilesByIdentity, mergeActivity } = require('../src/identity-groups');

const P = (id, extra = {}) => ({ id, name: id, appId: 'claude', createdAt: '2026-07-01T00:00:00.000Z', ...extra });

test('无关联字段时每个槽位自成一组，顺序保持', () => {
  const groups = groupProfilesByIdentity([P('a'), P('b'), P('c')]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.primary.id), ['a', 'b', 'c']);
  assert.ok(groups.every((g) => g.members.length === 1));
});

test('identityKey 相同归为一组；identityFingerprint 相同也归为一组', () => {
  const groups = groupProfilesByIdentity([
    P('kimi-code', { identityKey: 'Kimi' }),
    P('desktop', { identityFingerprint: 'fp-1' }),
    P('kimi-work', { identityKey: 'Kimi' }),
    P('cli', { identityFingerprint: 'fp-1' }),
    P('other')
  ]);
  assert.equal(groups.length, 3);
  const byPrimary = Object.fromEntries(groups.map((g) => [g.primary.id, g]));
  assert.deepEqual(byPrimary['kimi-code'].members.map((m) => m.id).sort(), ['kimi-code', 'kimi-work']);
  assert.deepEqual(byPrimary.desktop.members.map((m) => m.id).sort(), ['cli', 'desktop']);
});

test('key 与指纹形成的关联可传递（A-B 靠 key，B-C 靠指纹 → 一组）', () => {
  const groups = groupProfilesByIdentity([
    P('a', { identityKey: 'K' }),
    P('b', { identityKey: 'K', identityFingerprint: 'fp' }),
    P('c', { identityFingerprint: 'fp' })
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
});

test('空 key / 空指纹不构成关联', () => {
  const groups = groupProfilesByIdentity([
    P('a', { identityKey: null, identityFingerprint: null }),
    P('b', { identityKey: null, identityFingerprint: null })
  ]);
  assert.equal(groups.length, 2);
});

test('primary 优先用户命名的槽位（名字不以「默认」开头），再按创建时间', () => {
  const groups = groupProfilesByIdentity([
    P('cli', { name: '默认 Claude CLI', identityFingerprint: 'fp', createdAt: '2026-07-01T00:00:00.000Z' }),
    P('lsq', { name: 'LSQ', identityFingerprint: 'fp', createdAt: '2026-07-10T00:00:00.000Z' })
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, 'lsq');

  const bothDefault = groupProfilesByIdentity([
    P('work', { name: '默认 Kimi Work', identityKey: 'Kimi', createdAt: '2026-07-20T00:00:00.000Z' }),
    P('code', { name: '默认 Kimi Code', identityKey: 'Kimi', createdAt: '2026-07-18T00:00:00.000Z' })
  ]);
  assert.equal(bothDefault[0].primary.id, 'code');
});

test('mergeActivity：计数求和、时间取最大、存在性取或', () => {
  const merged = mergeActivity([
    { profileId: 'a', rootExists: true, rootReadable: true, latestMtime: 100, contentActiveAt: 90, fileCount: 3, activeToday: 2, createdToday: 1, activeNow: 1 },
    { profileId: 'b', rootExists: false, rootReadable: false, latestMtime: 200, contentActiveAt: 250, fileCount: 5, activeToday: 1, createdToday: 0, activeNow: 2 }
  ]);
  assert.equal(merged.rootExists, true);
  assert.equal(merged.rootReadable, true);
  assert.equal(merged.latestMtime, 200);
  assert.equal(merged.contentActiveAt, 250);
  assert.equal(merged.fileCount, 8);
  assert.equal(merged.activeToday, 3);
  assert.equal(merged.createdToday, 1);
  assert.equal(merged.activeNow, 3);
});

test('mergeActivity：空 / 缺项安全', () => {
  assert.equal(mergeActivity([]), null);
  const merged = mergeActivity([undefined, { profileId: 'a', activeNow: 1 }]);
  assert.equal(merged.activeNow, 1);
  assert.equal(merged.latestMtime, null);
});

test('mergeActivity：running 三态聚合（任一开着=true / 全关=false / 有未知=null）', () => {
  assert.equal(mergeActivity([{ profileId: 'a', running: true }, { profileId: 'b', running: false }]).running, true);
  assert.equal(mergeActivity([{ profileId: 'a', running: false }, { profileId: 'b', running: false }]).running, false);
  assert.equal(mergeActivity([{ profileId: 'a', running: false }, { profileId: 'b', running: null }]).running, null);
});

test('回归：merged activity 穿透 deriveState 后「在岗 onduty」不丢失', () => {
  // 0.7.0 前的 bug：mergeActivity 丢 running 字段，App 开着但闲置的账号
  // 从 onduty 退化成 play。这里把聚合结果直接喂给真实的 deriveState 验证。
  const { deriveState } = require('../src/yard/cats');
  const now = Date.now();
  const profile = { id: 'a', appId: 'claude' };
  const idle = {
    profileId: 'a',
    rootExists: true,
    rootReadable: true,
    running: true,
    latestMtime: now - 5 * 60_000,
    contentActiveAt: now - 5 * 60_000,
    fileCount: 2,
    activeToday: 1,
    createdToday: 0,
    activeNow: 0
  };
  const direct = deriveState(now, profile, idle);
  const merged = deriveState(now, profile, mergeActivity([idle]));
  assert.equal(merged, direct);
  assert.equal(merged, 'onduty');
});
