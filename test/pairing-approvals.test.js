const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  InvitationInspectionRegistry,
  PairingApprovalRegistry
} = require('../src/main/ipc/pairing-approvals');

const NOW = Date.parse('2026-08-14T03:00:00.000Z');

test('邀请码验签确认 token 绑定原始 code，公开预览不含邀请码或秘密', () => {
  const registry = new InvitationInspectionRegistry({
    now: () => NOW,
    randomUUID: () => 'inspection-token'
  });
  const preview = registry.issue('AD1.secret-code', {
    inviteId: 'invite-a',
    sourceDeviceId: 'device-a',
    sourceDeviceName: 'Studio',
    sourceFingerprint: 'A1B2C3D4',
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '0.10.1-preview.1',
    expiresAt: '2026-08-14T03:10:00.000Z',
    secret: 'must-not-leak'
  });
  assert.equal(preview.confirmationToken, 'inspection-token');
  assert.equal(JSON.stringify(preview).includes('secret-code'), false);
  assert.equal(JSON.stringify(preview).includes('must-not-leak'), false);
  assert.throws(() => registry.consume({
    confirmationToken: 'inspection-token',
    inviteId: 'invite-a',
    code: 'AD1.changed'
  }), /pairing-inspection-mismatch/);
});

test('同一个待加入设备复用一次邀请方确认，确认前 Promise 不会完成', async () => {
  const changes = [];
  const registry = new PairingApprovalRegistry({
    now: () => NOW,
    randomUUID: () => 'approval-a',
    onChange: (value) => changes.push(value)
  });
  const preview = {
    inviteId: 'invite-a',
    deviceId: 'device-b',
    name: 'Workstation',
    fingerprint: '11223344',
    platform: 'win32',
    arch: 'x64',
    osVersion: 'test',
    appVersion: '0.10.1-preview.1',
    expiresAt: '2026-08-14T03:10:00.000Z',
    requestDigest: 'a'.repeat(64)
  };
  const first = registry.request(preview);
  const second = registry.request(preview);
  assert.equal(first, second);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].approvalId, 'approval-a');
  assert.equal(JSON.stringify(registry.list()).includes('device-b'), true);
  registry.decide({ approvalId: 'approval-a', confirmed: true });
  assert.deepEqual(await first, { requestDigest: 'a'.repeat(64) });
  assert.equal(registry.list().length, 0);
  assert.equal(changes.at(-1).length, 0);
});

test('邀请方拒绝会让等待中的证书签发请求失败', async () => {
  const registry = new PairingApprovalRegistry({
    now: () => NOW,
    randomUUID: () => 'approval-denied'
  });
  const pending = registry.request({
    inviteId: 'invite-a',
    deviceId: 'device-b',
    name: 'Unknown',
    fingerprint: '99887766',
    expiresAt: '2026-08-14T03:10:00.000Z',
    requestDigest: 'b'.repeat(64)
  });
  registry.decide({ approvalId: 'approval-denied', confirmed: false });
  await assert.rejects(pending, /pairing-user-declined/);
});

test('同一设备更换公钥或请求内容后不能复用已展示指纹的确认', async () => {
  const registry = new PairingApprovalRegistry({
    now: () => NOW,
    randomUUID: () => 'approval-bound'
  });
  const base = {
    inviteId: 'invite-a',
    deviceId: 'device-b',
    name: 'Workstation',
    fingerprint: '11223344',
    expiresAt: '2026-08-14T03:10:00.000Z'
  };
  const pending = registry.request({ ...base, requestDigest: 'c'.repeat(64) });
  assert.throws(
    () => registry.request({ ...base, fingerprint: '55667788', requestDigest: 'd'.repeat(64) }),
    /pairing-claim-conflict/
  );
  registry.decide({ approvalId: 'approval-bound', confirmed: false });
  await assert.rejects(pending, /pairing-user-declined/);
});
