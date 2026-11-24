// The Mesh-mode session list (docs/ARCHITECTURE_PLAN.md 9.1, phase 5
// follow-up). It remembers each conversation key it derives: a key is an HMAC
// of (identity link key, canonical input), so it is remembered per link key,
// and a new key version or different key bytes drop the whole table. And it
// reuses the whole list while its inputs are unchanged: the store data it
// reads, this device's session rows (by content), the link key, and which
// inventories are stale now. After every kind of write that changes the
// list, the list from a long-lived service must equal, field by field, the
// list from a fresh service on the same store (nothing remembered), so the
// receiver's canonical projection (PERSONAL_AGENT_MESH_PLAN.md 17.2) is what
// it was.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');

const NOW = '2026-08-13T09:00:00.000Z';

function protector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`p:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().slice(2), 'base64').toString()
  };
}

// A vault whose link key the test can replace, as a re-created key store would.
class SwappableVault extends EncryptedKeyVault {
  constructor(...args) { super(...args); this.override = null; }
  load() { return { ...super.load(), ...(this.override || {}) }; }
}

function profile(id, fingerprint) {
  return { id, appId: 'codex', name: id, identityFingerprint: fingerprint, profilePathMode: 'managed', sessionRootMode: 'managed' };
}

function session(prefix, i, { strong = true, title } = {}) {
  return {
    id: `${prefix}-${i}`,
    address: `${prefix}-${i}`,
    ...(strong ? { adapterConversationKey: `${prefix}-${i}` } : {}),
    appId: 'codex',
    title: title || `Session ${i} of ${prefix}`,
    createdAt: NOW,
    updatedAt: `2026-08-13T0${i % 9}:00:00.000Z`,
    projectPath: `/project/${i % 3}`,
    filePath: `/${prefix}/s${i}.jsonl`,
    source: 'Codex',
    status: '可用'
  };
}

function hmacCount(run) {
  const original = crypto.createHmac;
  let count = 0;
  crypto.createHmac = function counted(...args) { count += 1; return original.apply(crypto, args); };
  try { run(); } finally { crypto.createHmac = original; }
  return count;
}

function setup(t, serviceOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-mesh-memo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'h'));
  fs.mkdirSync(path.join(dir, 'j'));
  const state = {
    hostProfiles: [profile('hp1', 'acct-shared'), profile('hp2', 'acct-host-only')],
    hostSessions: {
      hp1: [session('shared', 1), session('shared', 2), session('hp1-weak', 1, { strong: false })],
      hp2: [session('hp2', 1), session('hp2-weak', 1, { strong: false })]
    },
    joinProfiles: [profile('jp1', 'acct-shared'), profile('jp2', 'acct-join-only')],
    joinSessions: {
      jp1: [session('shared', 1), session('jp1', 1), session('jp1-weak', 1, { strong: false })],
      jp2: [session('jp2', 1), session('jp2', 2), session('jp2-weak', 1, { strong: false })]
    }
  };
  const hostVault = new SwappableVault(path.join(dir, 'h', 'k.json'), protector());
  const hostOptions = {
    databasePath: path.join(dir, 'h', 'mesh.db'),
    keyVault: hostVault,
    profilesProvider: () => state.hostProfiles,
    sessionsProvider: (p) => state.hostSessions[p.id] || [],
    appVersion: '1', platform: 'darwin', arch: 'arm64', osVersion: 't', hostname: 'H', now: () => NOW,
    ...serviceOptions
  };
  const host = new MeshService(hostOptions);
  const joiner = new MeshService({
    databasePath: path.join(dir, 'j', 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(dir, 'j', 'k.json'), protector()),
    profilesProvider: () => state.joinProfiles,
    sessionsProvider: (p) => state.joinSessions[p.id] || [],
    appVersion: '1', platform: 'darwin', arch: 'arm64', osVersion: 't', hostname: 'J', now: () => NOW,
    pairingTransport: async (_invite, request) => host.claimInvite({ request })
  });
  // A service on the same store and vault with an empty memo: the uncached answer.
  const fresh = () => new MeshService({ ...hostOptions, conversationKeyMemoLimit: undefined }).getUnifiedSessions();
  const land = () => {
    joiner.getOverview();
    host.applyRemoteInventory({
      deviceId: joiner.getOverview().localDeviceId,
      inventory: joiner.createInventorySnapshot(),
      allowLegacyCatalogProjection: true
    });
  };
  // Another writer changes one stored inventory row and nothing else.
  const rewriteStoredInventory = (change) => {
    const store = new MeshStore(hostOptions.databasePath);
    try {
      const row = store.database.prepare('SELECT device_id, payload_json FROM remote_inventory').get();
      const payload = JSON.parse(row.payload_json);
      change(payload);
      store.database.prepare('UPDATE remote_inventory SET payload_json = ? WHERE device_id = ?')
        .run(JSON.stringify(payload), row.device_id);
    } finally {
      store.close();
    }
  };
  return { state, host, joiner, hostVault, fresh, land, rewriteStoredInventory };
}

function same(host, fresh, label) {
  const cached = host.getUnifiedSessions();
  assert.deepEqual(cached, fresh(), `${label}: cached list equals the uncached list`);
  return cached;
}

const conversationIds = (rows) => rows.map((row) => row.conversationId).sort();
const total = (rows) => rows.reduce((sum, row) => sum + row.replicas.length, 0);

test('a warm list derives no conversation key twice, and equals the uncached list', async (t) => {
  const { host, joiner, fresh, land } = setup(t);
  host.initialize();
  host.getOverview();
  await joiner.join({ code: host.createInvite().code });
  land();
  const first = same(host, fresh, 'after the first inventory');
  assert.ok(first.length >= 8, 'the fixture has local and remote rows');
  const shared = first.find((row) => row.title === 'Session 1 of shared');
  assert.equal(shared.replicas.length, 2, 'a strong conversation on two devices is one row with two replicas');
  assert.ok(first.some((row) => row._remote && row.replicas.length === 1 && !row.replicas[0].stableProviderThreadId), 'weak remote rows stay device-scoped');

  const cold = hmacCount(() => fresh());
  const warmFirst = hmacCount(() => host.getUnifiedSessions());
  const warm = hmacCount(() => host.getUnifiedSessions());
  assert.ok(cold >= total(first), `a cold list derives a key per replica (${cold})`);
  assert.equal(warm, warmFirst, 'a warm list stays warm');
  assert.ok(warm < total(first) / 2, `a warm list derives no key per replica (${warm} of ${cold})`);
});

test('after each kind of write the cached list equals the uncached list', async (t) => {
  const { state, host, joiner, hostVault, fresh, land, rewriteStoredInventory } = setup(t);
  host.initialize();
  host.getOverview();
  await joiner.join({ code: host.createInvite().code });
  land();
  const before = same(host, fresh, 'start');

  // A remote inventory lands: a renamed, a new and a removed session.
  state.joinSessions.jp2 = [session('jp2', 1, { title: 'Renamed remotely' }), session('jp2', 3), session('jp2-weak', 1, { strong: false })];
  land();
  const remote = same(host, fresh, 'remote inventory');
  assert.ok(remote.some((row) => row.title === 'Renamed remotely'));
  assert.ok(!remote.some((row) => row.title === 'Session 2 of jp2'));

  // Only the stored inventory row changes (no device or catalog write).
  rewriteStoredInventory((payload) => { payload.sessions[0].title = 'Rewritten in the store'; });
  const rewritten = same(host, fresh, 'stored inventory rewritten');
  assert.ok(rewritten.some((row) => row.replicas.some((replica) => replica.title === 'Rewritten in the store')));

  // The local session index has a new generation.
  state.hostSessions.hp1 = [session('shared', 1, { title: 'Renamed locally' }), session('shared', 2), session('hp1', 9), session('hp1-weak', 1, { strong: false })];
  const local = same(host, fresh, 'local index');
  assert.ok(local.some((row) => row.title === 'Session 9 of hp1'));

  // A local profile is added and another removed.
  state.hostProfiles = [profile('hp1', 'acct-shared'), profile('hp3', 'acct-host-three')];
  state.hostSessions.hp3 = [session('hp3', 1), session('hp3-weak', 1, { strong: false })];
  host.getOverview();
  const profiles = same(host, fresh, 'local profiles');
  assert.ok(profiles.some((row) => row.title === 'Session 1 of hp3'));
  assert.ok(!profiles.some((row) => row.title === 'Session 1 of hp2'));

  // Catalog events: the shared binding is split off into a new Agent, which
  // changes the strong conversations' canonical key; then merged back.
  let overview = host.getOverview();
  const sharedSlot = overview.slots.find((slot) => slot.profileId === 'hp1');
  const split = host.splitAccountBinding({
    accountBindingId: sharedSlot.accountBindingId,
    displayName: 'Split off',
    baseRevision: overview.mesh.catalogRevision
  });
  const splitRows = same(host, fresh, 'binding split');
  const splitAgent = split.agents.find((agent) => agent.displayName === 'Split off');
  assert.ok(splitAgent, 'the split made a new Agent');
  assert.ok(splitRows.some((row) => row._agentId === splitAgent.agentId), 'its sessions moved with it');
  overview = host.getOverview();
  const other = overview.agents.find((agent) => agent.agentId !== splitAgent.agentId && overview.slots.some((slot) => slot.agentId === agent.agentId && slot.profileId === 'hp3'));
  host.mergeAgents({ sourceAgentId: splitAgent.agentId, targetAgentId: other.agentId, baseRevision: overview.mesh.catalogRevision });
  const merged = same(host, fresh, 'agents merged');
  assert.ok(!merged.some((row) => row._agentId === splitAgent.agentId));

  // A tombstone: deleting the joiner-only Agent removes its sessions.
  overview = host.getOverview();
  const joinOnly = overview.slots.find((slot) => slot.profileId === 'jp2' && slot.deviceId !== overview.localDeviceId);
  host.removeCatalogObject({ scope: 'agent', agentId: joinOnly.agentId, baseRevision: overview.mesh.catalogRevision });
  const removed = same(host, fresh, 'agent tombstone');
  assert.ok(!removed.some((row) => row.title === 'Renamed remotely'), 'no session of a deleted Agent is left');

  // The link key changes (a re-created key store): every conversation key changes.
  hostVault.override = { identityLinkKey: crypto.randomBytes(32).toString('base64') };
  const rekeyed = same(host, fresh, 'new key bytes');
  assert.notDeepEqual(conversationIds(rekeyed), conversationIds(removed), 'the keys follow the new link key');
  // Only the version changes: the result is the same and the table is dropped.
  hostVault.override = { ...hostVault.override, identityLinkKeyVersion: 7 };
  const recomputed = hmacCount(() => host.getUnifiedSessions());
  assert.ok(recomputed >= total(rekeyed), `a new key version derives every key again (${recomputed})`);
  same(host, fresh, 'new key version');
  // The table is rebuilt for the current key: a later change that makes the
  // list be computed again derives only what is new.
  state.hostSessions.hp1 = [...state.hostSessions.hp1, session('hp1', 10)];
  const afterRekey = hmacCount(() => host.getUnifiedSessions());
  assert.ok(afterRekey < total(rekeyed) / 2, `the memo works under the new key (${afterRekey})`);
  same(host, fresh, 'after the memo was rebuilt');
  assert.ok(before.length > 0);
});

test('a small memo limit changes nothing but the work', async (t) => {
  const { host, joiner, fresh, land } = setup(t, { conversationKeyMemoLimit: 3 });
  host.initialize();
  host.getOverview();
  await joiner.join({ code: host.createInvite().code });
  land();
  same(host, fresh, 'limit 3, first');
  same(host, fresh, 'limit 3, second');
});

test('an unchanged list is reused as a private copy; rows are compared by content', async (t) => {
  const { state, host, joiner, fresh, land } = setup(t);
  host.initialize();
  host.getOverview();
  await joiner.join({ code: host.createInvite().code });
  land();
  const first = same(host, fresh, 'first');
  const { hits } = host.unifiedSessionsStats;
  const second = same(host, fresh, 'second');
  assert.equal(host.unifiedSessionsStats.hits, hits + 1, 'the second list is reused');
  second[0].title = 'changed by a caller';
  second[0].replicas[0].title = 'changed by a caller';
  const third = same(host, fresh, 'after a caller changed its copy');
  assert.equal(third[0].title, first[0].title);

  // Rows are compared by content: a provider handing back the same array
  // with a changed row is a change.
  state.hostSessions.hp2[0].title = 'Changed in place';
  const misses = host.unifiedSessionsStats.misses;
  const inPlace = same(host, fresh, 'a row changed in place');
  assert.equal(host.unifiedSessionsStats.misses, misses + 1);
  assert.ok(inPlace.some((row) => row.title === 'Changed in place'));
  // A rescan that finds the same rows (a new array) is not a change.
  state.hostSessions.hp2 = state.hostSessions.hp2.map((row) => ({ ...row }));
  same(host, fresh, 'same rows, new array');
  assert.equal(host.unifiedSessionsStats.misses, misses + 1);

  // A failing read keeps the last good rows.
  const failing = state.hostSessions.hp2;
  Object.defineProperty(state.hostSessions, 'hp2', { configurable: true, get() { throw new Error('scan failed'); } });
  const kept = host.getUnifiedSessions();
  assert.ok(kept.some((row) => row.title === 'Changed in place'), 'the last good rows stay');
  Object.defineProperty(state.hostSessions, 'hp2', { configurable: true, writable: true, value: failing });
});

test('an inventory turning stale changes the list, and the reused list follows it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const { host, joiner, fresh, land } = setup(t);
  host.initialize();
  host.getOverview();
  await joiner.join({ code: host.createInvite().code });
  land();
  const live = same(host, fresh, 'fresh inventories');
  assert.ok(live.every((row) => row.replicas.every((replica) => replica.stale === false)));
  same(host, fresh, 'fresh inventories, reused');
  t.mock.timers.tick(6 * 60_000);
  const later = same(host, fresh, 'six minutes later');
  assert.ok(later.some((row) => row.replicas.some((replica) => replica._remote !== false && replica.stale === true)), 'the stale flags moved');
});

