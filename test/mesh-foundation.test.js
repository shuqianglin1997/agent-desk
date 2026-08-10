const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { meshScopedAccountKey } = require('../src/mesh/domain/identity-link');
const { reconcileLocalCatalog } = require('../src/mesh/domain/agent-catalog');
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
