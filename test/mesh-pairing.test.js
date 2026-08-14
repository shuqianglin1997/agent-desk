const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { defaultPairedPermissions, updatePermissions } = require('../src/mesh/domain/capabilities');
const { normalizeDevice } = require('../src/mesh/domain/device');
const { createEnvelope, verifyEnvelope, SequenceGuard } = require('../src/mesh/protocol/envelope');
const { createMembershipCertificate, createDelegatedMembershipCertificate, verifyMembershipChain } = require('../src/mesh/protocol/handshake');
const { LanEndpoint, claimPairing } = require('../src/mesh/network/lan-endpoint');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { MeshService } = require('../src/mesh/main/mesh-service');

const NOW = '2026-08-10T08:00:00.000Z';

test('能力更新只接受已知且受设备支持的权限', () => {
  const defaults = defaultPairedPermissions();
  assert.ok(defaults.includes('inventory.read'));
  assert.equal(defaults.includes('screen.view'), false);
  const updated = updatePermissions(defaults, {
    'screen.view': true,
    'input.control': true,
    'generic.exec': true
  }, ['inventory.read', 'screen.view']);
  assert.deepEqual(updated, ['inventory.read', 'screen.view']);
});

test('签名协议信封拒绝篡改、过期和重放', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const envelope = createEnvelope({
    messageType: 'inventory.snapshot',
    connectionId: 'connection-1',
    sourceDeviceId: 'device-a',
    targetDeviceId: 'device-b',
    sequence: 1,
    capability: 'inventory.read',
    payload: { revision: 2 }
  }, keys.privateKey, { now: NOW, ttlMs: 60_000 });
  const guard = new SequenceGuard();
  assert.equal(verifyEnvelope(envelope, keys.publicKey, {
    targetDeviceId: 'device-b',
    capability: 'inventory.read'
  }, { now: '2026-08-10T08:00:30.000Z', sequenceGuard: guard }).ok, true);
  assert.equal(verifyEnvelope(envelope, keys.publicKey, {}, {
    now: '2026-08-10T08:00:31.000Z', sequenceGuard: guard
  }).reason, 'envelope-replay');
  assert.equal(verifyEnvelope({ ...envelope, payload: { revision: 99 } }, keys.publicKey, {}, {
    now: '2026-08-10T08:00:30.000Z'
  }).reason, 'envelope-signature');
  assert.equal(verifyEnvelope(envelope, keys.publicKey, {}, {
    now: '2026-08-10T08:02:00.000Z'
  }).reason, 'envelope-expired');
});

test('device.admin 可签发可验证的委托成员证书，但非 admin 不可继续签发', () => {
  const root = crypto.generateKeyPairSync('ed25519');
  const admin = crypto.generateKeyPairSync('ed25519');
  const child = crypto.generateKeyPairSync('ed25519');
  const rootCertificate = createMembershipCertificate({
    meshId: 'mesh-a',
    deviceId: 'admin-a',
    devicePublicKey: admin.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['controller', 'device.admin']
  }, root.privateKey, { now: NOW });
  const delegated = createDelegatedMembershipCertificate({
    meshId: 'mesh-a',
    deviceId: 'device-b',
    devicePublicKey: child.publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['controller']
  }, rootCertificate, admin.privateKey, { now: NOW });
  assert.equal(verifyMembershipChain(delegated, [rootCertificate], root.publicKey, { now: NOW }).ok, true);
  assert.throws(() => createDelegatedMembershipCertificate({
    meshId: 'mesh-a',
    deviceId: 'device-c',
    devicePublicKey: child.publicKey.export({ type: 'spki', format: 'pem' })
  }, delegated, child.privateKey, { now: NOW }), /device.admin/);
});

test('设备归一化不会折叠 PEM 公钥换行，存储后的消息签名仍可验证', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const device = normalizeDevice({ deviceId: 'device-a', devicePublicKey: publicKey });
  assert.equal(device.devicePublicKey, publicKey.trim());
  const envelope = createEnvelope({
    messageType: 'inventory.snapshot',
    connectionId: 'connection-a',
    sourceDeviceId: 'device-a',
    targetDeviceId: 'device-b',
    sequence: 1,
    capability: 'inventory.read',
    payload: { revision: 1 }
  }, keys.privateKey);
  assert.equal(verifyEnvelope(envelope, device.devicePublicKey).ok, true);
});

test('两个隔离端点通过一次性加密邀请码配对、跨设备账号去重、授权并撤销', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-pairing-'));
  const hostDir = path.join(directory, 'host');
  const joinDir = path.join(directory, 'join');
  fs.mkdirSync(hostDir, { recursive: true });
  fs.mkdirSync(joinDir, { recursive: true });
  const hostVault = new EncryptedKeyVault(path.join(hostDir, 'keys.json'), fakeProtector());
  const joinVault = new EncryptedKeyVault(path.join(joinDir, 'keys.json'), fakeProtector());
  const profile = (id) => ({
    id,
    appId: 'claude',
    name: 'Work Agent',
    identityFingerprint: 'same-real-account',
    profilePathMode: 'managed',
    sessionRootMode: 'managed'
  });
  let endpoint;
  const host = new MeshService({
    databasePath: path.join(hostDir, 'mesh.db'),
    keyVault: hostVault,
    profilesProvider: () => [profile('host-slot')],
    sessionCountProvider: () => 2,
    appVersion: '0.9.1',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test',
    hostname: 'Studio.local',
    now: () => NOW,
    endpointProvider: () => endpoint?.endpoints() || []
  });
  const joiner = new MeshService({
    databasePath: path.join(joinDir, 'mesh.db'),
    keyVault: joinVault,
    profilesProvider: () => [profile('join-slot')],
    sessionCountProvider: () => 4,
    appVersion: '0.9.1',
    platform: 'win32',
    arch: 'x64',
    osVersion: 'test',
    hostname: 'Workstation.local',
    now: () => NOW,
    pairingTransport: (invite, request) => claimPairing(invite, request)
  });
  let pendingPreview = null;
  let approvePairing;
  const pairingApproval = new Promise((resolve) => { approvePairing = resolve; });

  try {
    host.initialize();
    endpoint = new LanEndpoint({
      host: '127.0.0.1',
      port: 0,
      onPairClaim: async (body) => {
        pendingPreview = host.previewClaimInvite(body);
        await pairingApproval;
        return host.claimInvite(body);
      }
    });
    await endpoint.start();
    const invitation = host.createInvite();
    assert.match(invitation.code, /^AD1\./);
    assert.equal(invitation.shortCode.length, 8);

    const joining = joiner.join({ code: invitation.code, deviceName: 'GPU Workstation' });
    await waitFor(() => pendingPreview);
    assert.equal(pendingPreview.name, 'GPU Workstation');
    assert.match(pendingPreview.fingerprint, /^SHA256:/);
    assert.equal(host.getOverview().devices.length, 1, 'identity preview must not issue a membership certificate');
    approvePairing();
    const joined = await joining;
    assert.equal(joined.devices.length, 2);
    assert.equal(joined.agents.length, 1);
    assert.equal(joined.accountBindings.length, 1);
    assert.equal(joined.slots.length, 2);
    assert.deepEqual(new Set(joined.slots.map((slot) => slot.deviceId)).size, 2);
    assert.equal(joinVault.load().rootPrivateKey, null);

    const hostAfterPair = host.getOverview();
    const remote = hostAfterPair.devices.find((device) => !device.isLocal);
    assert.ok(remote);
    assert.equal(hostAfterPair.mesh.membershipRevision, 1);
    assert.equal(remote.permissions.includes('screen.view'), false);

    const permitted = host.updatePermissions({
      deviceId: remote.deviceId,
      permissions: { 'screen.view': true, 'file.receive': true }
    });
    const permittedRemote = permitted.devices.find((device) => device.deviceId === remote.deviceId);
    assert.ok(permittedRemote.permissions.includes('screen.view'));
    assert.ok(permittedRemote.permissions.includes('file.receive'));
    assert.equal(permitted.mesh.membershipRevision, 2);

    const revoked = host.revoke({ deviceId: remote.deviceId, remove: true });
    assert.equal(revoked.devices.length, 1);
    assert.equal(revoked.mesh.revocationRevision, 3);
    const store = new MeshStore(path.join(hostDir, 'mesh.db'));
    assert.equal(store.isDeviceRevoked(remote.deviceId), true);
    store.close();

    await assert.rejects(
      () => joiner.join({ code: invitation.code }),
      /mesh-already-initialized/
    );
  } finally {
    await endpoint?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('wait-timeout');
    await new Promise((resolve) => setImmediate(resolve));
  }
}
