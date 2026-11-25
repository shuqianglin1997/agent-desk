// AgentDesk — 额度在窗口与主进程之间怎么走：按行为核对，不比对源码文字。
const { test } = require('node:test');
const assert = require('node:assert');

const { loadPreload, runCommand } = require('./helpers/behaviour');

test('额度有自己的命令：刷新本机位置、只在明确要求时强制刷新、带上客户端版本', async () => {
  const { api, calls } = loadPreload();
  await api.listQuotas({ force: true });
  await api.listQuotas();
  assert.deepEqual(calls, [['invoke', 'quota:all', { force: true }], ['invoke', 'quota:all', {}]]);

  const seen = [];
  const deps = {
    refreshProfiles: async () => [{ id: 'p1' }],
    appVersion: () => '9.9.9',
    quotaService: { getAll: async (profiles, options) => { seen.push([profiles, options]); return { ok: true }; } }
  };
  await runCommand('quota:all', deps, { force: true });
  await runCommand('quota:all', deps, { force: 'yes' });
  await runCommand('quota:all', deps, undefined);
  assert.deepEqual(seen, [
    [[{ id: 'p1' }], { force: true, clientVersion: '9.9.9' }],
    [[{ id: 'p1' }], { force: false, clientVersion: '9.9.9' }],
    [[{ id: 'p1' }], { force: false, clientVersion: '9.9.9' }]
  ]);
});

test('位置的路径改了或位置被移除，它的额度缓存就作废', async () => {
  const invalidated = [];
  const profiles = [{ id: 'p1', profilePath: '/a', sessionRoot: '/a/s' }, { id: 'p2' }];
  let saved = null;
  const deps = {
    boundedText: (value, max) => (typeof value === 'string' ? value.slice(0, max) : ''),
    getProfileRuntimeSupervisor: () => ({ status: () => ({ owned: false }), stopProfile: async () => ({ ok: true }) }),
    loadProfiles: () => profiles,
    normalizeConfiguredPath: (p) => p,
    pathsEqual: (a, b) => a === b,
    pathSelectionRegistry: { resolve: (id) => (id === 'sel-1' ? '/b' : null), consume: () => {} },
    quotaService: { invalidate: (id) => invalidated.push(id) },
    updateStoredProfile: (id, change) => change(profiles.find((p) => p.id === id)),
    saveProfiles: (next) => { saved = next; },
    t: (key) => key
  };
  const updated = await runCommand('profiles:update', deps, { id: 'p1', profilePathSelectionId: 'sel-1' });
  assert.equal(updated.profilePath, '/b');
  assert.deepEqual(invalidated, ['p1']);

  assert.deepEqual(await runCommand('profiles:remove', deps, 'p2'), { ok: true });
  assert.deepEqual(saved.map((p) => p.id), ['p1']);
  assert.deepEqual(invalidated, ['p1', 'p2']);
  assert.equal((await runCommand('profiles:remove', deps, 'missing')).ok, false);
  assert.deepEqual(invalidated, ['p1', 'p2']);
});
