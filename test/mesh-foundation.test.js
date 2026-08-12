const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { meshScopedAccountKey } = require('../src/mesh/domain/identity-link');
const {
  reconcileLocalCatalog,
  updateAgentMetadata,
  assignSlot,
  mergeAgents,
  splitAccountBinding,
  removeCatalogObject
} = require('../src/mesh/domain/agent-catalog');
const {
  createMembershipCertificate,
  verifyMembershipCertificate,
  createDeviceProof,
  verifyDeviceProof
} = require('../src/mesh/protocol/handshake');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { MeshService } = require('../src/mesh/main/mesh-service');

const LINK_KEY = Buffer.alloc(32, 7);
const NOW = '2026-08-10T08:00:00.000Z';
const profile = (id, extra = {}) => ({
  id,
  appId: 'claude',
  name: id,
  profilePathMode: 'managed',
  sessionRootMode: 'managed',
  ...extra
});

test('Mesh 范围账号关联键：同 Mesh 稳定、不同 Mesh 不可关联且不含原始标识', () => {
  const first = meshScopedAccountKey(LINK_KEY, 'claude', 'account-uuid-sensitive');
  const again = meshScopedAccountKey(LINK_KEY, 'claude', 'account-uuid-sensitive');
  const otherMesh = meshScopedAccountKey(Buffer.alloc(32, 8), 'claude', 'account-uuid-sensitive');
  assert.equal(first, again);
  assert.notEqual(first, otherMesh);
  assert.equal(first.includes('account-uuid-sensitive'), false);
});

test('设备成员证书和一次性握手证明绑定 Mesh、目标、挑战与有效期', () => {
  const root = crypto.generateKeyPairSync('ed25519');
  const device = crypto.generateKeyPairSync('ed25519');
  const devicePublicKey = device.publicKey.export({ type: 'spki', format: 'pem' });
  const certificate = createMembershipCertificate({
    meshId: 'mesh-1',
    deviceId: 'device-a',
    devicePublicKey,
    roles: ['controller']
  }, root.privateKey, { now: NOW, randomUUID: () => 'serial-1' });
  assert.equal(verifyMembershipCertificate(certificate, root.publicKey, { now: NOW }).ok, true);

  const proof = createDeviceProof({
    meshId: 'mesh-1',
    connectionId: 'connection-1',
    sourceDeviceId: 'device-a',
    targetDeviceId: 'device-b',
    challenge: 'one-time-challenge',
    membershipCertificate: certificate
  }, device.privateKey, { now: NOW, ttlMs: 60_000 });
  const valid = verifyDeviceProof(proof, certificate, root.publicKey, {
    meshId: 'mesh-1',
    connectionId: 'connection-1',
    targetDeviceId: 'device-b',
    challenge: 'one-time-challenge'
  }, { now: '2026-08-10T08:00:30.000Z' });
  assert.equal(valid.ok, true);
  assert.equal(verifyDeviceProof(
    { ...proof, targetDeviceId: 'device-c' },
    certificate,
    root.publicKey,
    {},
    { now: '2026-08-10T08:00:30.000Z' }
  ).ok, false);
  assert.equal(verifyDeviceProof(
    proof,
    certificate,
    root.publicKey,
    {},
    { now: '2026-08-10T08:02:00.000Z' }
  ).reason, 'proof-expired');
});

test('同一账号的桌面/CLI 只形成一个 Agent 和 AccountBinding，但保留两个 Slot', () => {
  const catalog = reconcileLocalCatalog({}, [
    profile('desktop', { name: '工作 Agent', identityFingerprint: 'same-account' }),
    profile('cli', { appId: 'claude-cli', name: 'Claude CLI', identityFingerprint: 'same-account' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.accountBindings.length, 1);
  assert.equal(catalog.slots.length, 2);
  assert.deepEqual(new Set(catalog.slots.map((slot) => slot.agentId)).size, 1);
});

test('同一设备多个实际账号不误合并；跨平台只按显式 identityKey 归入同一 Agent', () => {
  const separate = reconcileLocalCatalog({}, [
    profile('one', { identityFingerprint: 'account-one' }),
    profile('two', { identityFingerprint: 'account-two' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  assert.equal(separate.agents.length, 2);
  assert.equal(separate.accountBindings.length, 2);

  const explicit = reconcileLocalCatalog({}, [
    profile('claude-work', { identityKey: 'Work Agent' }),
    profile('codex-work', { appId: 'codex', identityKey: 'Work Agent' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  assert.equal(explicit.agents.length, 1);
  assert.equal(explicit.accountBindings.length, 2);
  assert.deepEqual(explicit.accountBindings.map((item) => item.providerNamespace).sort(), ['claude', 'codex']);
});

test('换号登录标记 identity-changed；删掉最后 Slot 后目录为空且留下 tombstone', () => {
  const initial = reconcileLocalCatalog({}, [profile('slot', { identityFingerprint: 'old-account' })], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const changed = reconcileLocalCatalog(initial, [profile('slot', { identityFingerprint: 'new-account' })], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T09:00:00.000Z'
  });
  assert.equal(changed.slots[0].assignmentState, 'identity-changed');
  assert.equal(changed.slots[0].agentId, initial.slots[0].agentId);

  const empty = reconcileLocalCatalog(changed, [], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T10:00:00.000Z'
  });
  assert.equal(empty.agents.length, 0);
  assert.equal(empty.accountBindings.length, 0);
  assert.equal(empty.slots.length, 0);
  assert.ok(empty.tombstones.some((item) => item.objectId === initial.agents[0].agentId));
});

test('显式归属可把新 Slot 接到已有登录或已有 Agent，临时目录对象不会残留', () => {
  const first = reconcileLocalCatalog({}, [
    profile('existing', { name: '工作 Agent', identityFingerprint: 'account-a' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const withSecond = reconcileLocalCatalog(first, [
    profile('existing', { name: '工作 Agent', identityFingerprint: 'account-a' }),
    profile('new-slot', { name: '另一个客户端' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T08:10:00.000Z'
  });
  const assigned = assignSlot(withSecond, {
    mode: 'existing-binding',
    deviceId: 'device-a',
    profileId: 'new-slot',
    accountBindingId: first.accountBindings[0].accountBindingId
  }, {
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T08:20:00.000Z'
  });
  assert.equal(assigned.agents.length, 1);
  assert.equal(assigned.accountBindings.length, 1);
  assert.equal(assigned.slots.find((slot) => slot.profileId === 'new-slot').agentId, first.agents[0].agentId);
  assert.equal(new Set(assigned.slots.map((slot) => slot.accountBindingId)).size, 1);

  const withCodex = reconcileLocalCatalog(assigned, [
    profile('existing', { name: '工作 Agent', identityFingerprint: 'account-a' }),
    profile('new-slot', { name: '另一个客户端' }),
    profile('codex-slot', { appId: 'codex', name: 'Codex 工作号' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T08:30:00.000Z'
  });
  const crossPlatform = assignSlot(withCodex, {
    mode: 'existing-agent',
    deviceId: 'device-a',
    profileId: 'codex-slot',
    agentId: first.agents[0].agentId
  }, {
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T08:40:00.000Z'
  });
  assert.equal(crossPlatform.agents.length, 1);
  assert.deepEqual(crossPlatform.accountBindings.map((binding) => binding.providerNamespace).sort(), ['claude', 'codex']);
});

test('换号 Slot 选择全新 Agent 时不会复用旧身份，旧孤儿关系留下 tombstone', () => {
  const initial = reconcileLocalCatalog({}, [
    profile('changed-slot', { name: '原账号', identityFingerprint: 'old-account' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const changed = reconcileLocalCatalog(initial, [
    profile('changed-slot', { name: '新账号', identityFingerprint: 'new-account' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: '2026-08-10T08:10:00.000Z'
  });
  const oldAgentId = changed.slots[0].agentId;
  const oldBindingId = changed.slots[0].accountBindingId;
  const ids = ['new-agent-id', 'new-binding-id'];
  const reassigned = assignSlot(changed, {
    mode: 'new-agent',
    deviceId: 'device-a',
    profileId: 'changed-slot',
    displayName: '全新 Agent'
  }, {
    randomUUID: () => ids.shift(),
    now: '2026-08-10T08:20:00.000Z'
  });

  assert.equal(reassigned.slots[0].agentId, 'new-agent-id');
  assert.equal(reassigned.slots[0].accountBindingId, 'new-binding-id');
  assert.equal(reassigned.agents.some((agent) => agent.agentId === oldAgentId), false);
  assert.equal(reassigned.accountBindings.some((binding) => binding.accountBindingId === oldBindingId), false);
  assert.ok(reassigned.tombstones.some((item) => item.objectType === 'agent' && item.objectId === oldAgentId));
  assert.ok(reassigned.tombstones.some((item) => item.objectType === 'account-binding' && item.objectId === oldBindingId));
});

test('新建本地 Profile 的明确新 Agent 选择只复用唯一临时关系', () => {
  const provisional = reconcileLocalCatalog({}, [profile('new-local', { name: '新 Agent' })], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const originalAgentId = provisional.agents[0].agentId;
  const originalBindingId = provisional.accountBindings[0].accountBindingId;
  const assigned = assignSlot(provisional, {
    mode: 'new-agent',
    deviceId: 'device-a',
    profileId: 'new-local',
    displayName: '明确命名'
  }, {
    randomUUID: () => { throw new Error('must-not-create-another-object'); },
    reuseProvisional: true,
    now: '2026-08-10T08:10:00.000Z'
  });

  assert.equal(assigned.agents.length, 1);
  assert.equal(assigned.agents[0].agentId, originalAgentId);
  assert.equal(assigned.agents[0].displayName, '明确命名');
  assert.equal(assigned.accountBindings[0].accountBindingId, originalBindingId);
});

test('Slot 归属拒绝无效模式、强身份错配和重复强绑定', () => {
  const catalog = reconcileLocalCatalog({}, [
    profile('one', { identityFingerprint: 'account-one' }),
    profile('two', { identityFingerprint: 'account-two' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  assert.throws(() => assignSlot(catalog, {
    mode: 'implicit-default',
    deviceId: 'device-a',
    profileId: 'one'
  }), /slot-assignment-mode-invalid/);

  const firstSlot = catalog.slots.find((slot) => slot.profileId === 'one');
  const secondSlot = catalog.slots.find((slot) => slot.profileId === 'two');
  assert.throws(() => assignSlot(catalog, {
    mode: 'existing-binding',
    deviceId: 'device-a',
    profileId: 'one',
    accountBindingId: secondSlot.accountBindingId
  }), /binding-identity-mismatch/);

  const changed = {
    ...catalog,
    slots: catalog.slots.map((slot) => slot.profileId === 'one'
      ? {
          ...slot,
          observedAccountKey: secondSlot.observedAccountKey,
          assignmentState: 'identity-changed'
        }
      : slot)
  };
  assert.throws(() => assignSlot(changed, {
    mode: 'new-agent',
    deviceId: 'device-a',
    profileId: firstSlot.profileId
  }, { randomUUID: crypto.randomUUID }), /account-binding-conflict/);
});

test('Agent 元数据、合并与账号绑定拆分只改变 Mesh 目录关系', () => {
  const catalog = reconcileLocalCatalog({}, [
    profile('one', { name: 'One', identityFingerprint: 'one' }),
    profile('two', { name: 'Two', identityFingerprint: 'two' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const renamed = updateAgentMetadata(catalog, {
    agentId: catalog.agents[0].agentId,
    displayName: '全局工作 Agent',
    group: '工作',
    note: '只修改目录元数据'
  }, { now: '2026-08-10T09:00:00.000Z' });
  assert.equal(renamed.agents.find((agent) => agent.agentId === catalog.agents[0].agentId).displayName, '全局工作 Agent');

  const merged = mergeAgents(renamed, {
    sourceAgentId: catalog.agents[1].agentId,
    targetAgentId: catalog.agents[0].agentId
  }, { now: '2026-08-10T09:10:00.000Z' });
  assert.equal(merged.agents.length, 1);
  assert.equal(new Set(merged.slots.map((slot) => slot.agentId)).size, 1);
  assert.ok(merged.tombstones.some((item) => item.objectId === catalog.agents[1].agentId));

  const split = splitAccountBinding(merged, {
    accountBindingId: merged.accountBindings[1].accountBindingId,
    displayName: '拆分 Agent'
  }, { randomUUID: crypto.randomUUID, now: '2026-08-10T09:20:00.000Z' });
  assert.equal(split.agents.length, 2);
  const splitBinding = split.accountBindings.find((item) => item.accountBindingId === merged.accountBindings[1].accountBindingId);
  assert.notEqual(splitBinding.agentId, merged.agents[0].agentId);
  assert.ok(split.slots.filter((slot) => slot.accountBindingId === splitBinding.accountBindingId).every((slot) => slot.agentId === splitBinding.agentId));
});

test('合并 Agent 时同一强账号绑定只保留一份并重定向全部 Slot', () => {
  const catalog = reconcileLocalCatalog({}, [
    profile('one', { identityFingerprint: 'one' }),
    profile('two', { identityFingerprint: 'two' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const targetAgentId = catalog.slots.find((slot) => slot.profileId === 'one').agentId;
  const sourceAgentId = catalog.slots.find((slot) => slot.profileId === 'two').agentId;
  const targetBinding = catalog.accountBindings.find((binding) => binding.agentId === targetAgentId);
  const sourceBinding = catalog.accountBindings.find((binding) => binding.agentId === sourceAgentId);
  const inconsistent = {
    ...catalog,
    accountBindings: catalog.accountBindings.map((binding) => binding.accountBindingId === sourceBinding.accountBindingId
      ? { ...binding, meshScopedAccountKey: targetBinding.meshScopedAccountKey }
      : binding)
  };
  const merged = mergeAgents(inconsistent, { sourceAgentId, targetAgentId }, {
    now: '2026-08-10T09:15:00.000Z'
  });

  assert.equal(merged.agents.length, 1);
  assert.equal(merged.accountBindings.length, 1);
  assert.ok(merged.slots.every((slot) => slot.accountBindingId === targetBinding.accountBindingId));
  assert.ok(merged.tombstones.some((item) => (
    item.objectType === 'account-binding' && item.objectId === sourceBinding.accountBindingId
  )));
});

test('拆分 Agent 的唯一账号绑定时不保留空 Agent', () => {
  const catalog = reconcileLocalCatalog({}, [profile('only', { identityFingerprint: 'only-account' })], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const originalAgentId = catalog.agents[0].agentId;
  const split = splitAccountBinding(catalog, {
    accountBindingId: catalog.accountBindings[0].accountBindingId,
    displayName: '新 Agent'
  }, { randomUUID: crypto.randomUUID, now: '2026-08-10T09:30:00.000Z' });
  assert.equal(split.agents.length, 1);
  assert.notEqual(split.agents[0].agentId, originalAgentId);
  assert.ok(split.tombstones.some((item) => item.objectType === 'agent' && item.objectId === originalAgentId));
});

test('移除运行位置、登录账号和 Agent 使用不同作用域并保留 suppressed Slot', () => {
  const catalog = reconcileLocalCatalog({}, [
    profile('desktop', { name: 'Work', identityFingerprint: 'same-account' }),
    profile('cli', { appId: 'claude-cli', name: 'Work CLI', identityFingerprint: 'same-account' })
  ], {
    deviceId: 'device-a',
    linkKey: LINK_KEY,
    randomUUID: crypto.randomUUID,
    now: NOW
  });
  const oneRemoved = removeCatalogObject(catalog, {
    scope: 'slot',
    deviceId: 'device-a',
    profileId: 'desktop'
  }, { now: '2026-08-10T10:00:00.000Z' });
  assert.equal(oneRemoved.agents.length, 1);
  assert.equal(oneRemoved.accountBindings.length, 1);
  assert.equal(oneRemoved.slots.find((slot) => slot.profileId === 'desktop').assignmentState, 'suppressed');
  assert.equal(oneRemoved.slots.find((slot) => slot.profileId === 'cli').assignmentState, 'linked');

  const bindingRemoved = removeCatalogObject(catalog, {
    scope: 'account-binding',
    accountBindingId: catalog.accountBindings[0].accountBindingId
  }, { now: '2026-08-10T10:10:00.000Z' });
  assert.equal(bindingRemoved.agents.length, 0);
  assert.equal(bindingRemoved.accountBindings.length, 0);
  assert.ok(bindingRemoved.slots.every((slot) => slot.assignmentState === 'suppressed'));
  assert.ok(bindingRemoved.tombstones.some((item) => item.objectType === 'account-binding'));
  assert.ok(bindingRemoved.tombstones.some((item) => item.objectType === 'agent'));
  assert.throws(() => removeCatalogObject(catalog, { scope: 'implicit' }), /catalog-remove-scope-invalid/);
});

test('独立 mesh.db + OS 加密密钥文件完成初始化、重命名、同步删到零和重置', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-mesh-'));
  const databasePath = path.join(directory, 'mesh.db');
  const keyPath = path.join(directory, 'mesh-keys.json');
  const protector = fakeProtector();
  const keyVault = new EncryptedKeyVault(keyPath, protector);
  let profiles = [profile('slot-a', { name: 'My Agent', identityFingerprint: 'account-a' })];
  const service = new MeshService({
    databasePath,
    keyVault,
    profilesProvider: () => profiles,
    sessionCountProvider: () => 3,
    appVersion: '0.9.1',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os',
    hostname: 'Studio.local',
    now: () => NOW
  });

  try {
    const before = service.getOverview();
    assert.equal(before.initialized, false);
    assert.equal(before.localPreview.agentCount, 1);

    const initialized = service.initialize();
    assert.equal(initialized.initialized, true);
    assert.equal(initialized.devices.length, 1);
    assert.equal(initialized.devices[0].name, 'Studio');
    assert.equal(initialized.devices[0].agentCount, 1);
    assert.equal(initialized.devices[0].sessionCount, 3);
    assert.equal(initialized.agents.length, 1);
    assert.equal('rootPublicKey' in initialized.mesh, false);
    assert.equal('meshScopedAccountKey' in initialized.accountBindings[0], false);

    const encryptedText = fs.readFileSync(keyPath, 'utf8');
    assert.doesNotMatch(encryptedText, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(encryptedText, /identityLinkKey"\s*:\s*"BwcH/);

    const updatedAgent = service.updateAgent({
      agentId: initialized.agents[0].agentId,
      displayName: 'Global Agent',
      group: 'Work',
      note: 'Catalog metadata',
      baseRevision: initialized.mesh.catalogRevision
    });
    assert.equal(updatedAgent.agents[0].displayName, 'Global Agent');
    assert.equal(updatedAgent.mesh.catalogRevision, initialized.mesh.catalogRevision + 1);
    assert.throws(() => service.updateAgent({
      agentId: updatedAgent.agents[0].agentId,
      displayName: 'Stale edit',
      baseRevision: initialized.mesh.catalogRevision
    }), /catalog-revision-conflict/);
    const auditStore = new MeshStore(databasePath);
    const latestCatalogAudit = auditStore.database.prepare(`
      SELECT event_type, payload_json FROM audit_events
      WHERE event_type = 'catalog.agent-updated'
      ORDER BY event_id DESC LIMIT 1
    `).get();
    auditStore.close();
    assert.equal(latestCatalogAudit.event_type, 'catalog.agent-updated');
    assert.equal(JSON.parse(latestCatalogAudit.payload_json).sourceDeviceId, initialized.localDeviceId);

    const renamed = service.rename({
      deviceId: initialized.localDeviceId,
      name: 'Render Station'
    });
    assert.equal(renamed.devices[0].name, 'Render Station');

    profiles = [];
    const emptied = service.getOverview();
    assert.equal(emptied.agents.length, 0);
    assert.equal(emptied.slots.length, 0);
    const store = new MeshStore(databasePath);
    assert.equal(store.readSnapshot().tombstones.length, 1);
    store.close();

    const reset = service.reset();
    assert.equal(reset.initialized, false);
    assert.equal(fs.existsSync(databasePath), false);
    assert.equal(fs.existsSync(keyPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => {
      const encoded = buffer.toString().replace(/^protected:/, '');
      return Buffer.from(encoded, 'base64').toString();
    }
  };
}
