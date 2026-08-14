const { test } = require('node:test');
const assert = require('node:assert/strict');

const Journey = require('../src/device-journey');

function overview(options = {}) {
  const remote = options.remote === false ? [] : [{
    deviceId: 'device-b',
    name: 'Studio Mac',
    platform: 'darwin',
    appVersion: '0.10.1',
    fingerprint: 'A1B2C3D4',
    pairedAt: '2026-08-14T01:00:00.000Z',
    permissions: ['inventory.read', 'catalog.manage'],
    inventoryRevision: options.inventory ? 4 : 0,
    inventoryGeneratedAt: options.inventory ? '2026-08-14T01:01:00.000Z' : null,
    isLocal: false
  }];
  return {
    devices: [
      { deviceId: 'device-a', name: 'Local', isLocal: true },
      ...remote
    ],
    connections: options.connected ? [{
      deviceId: 'device-b',
      authenticated: true,
      protocolFeatures: options.catalogUnsupported ? [] : ['catalog.events.v1']
    }] : []
  };
}

test('配对、连接、目录、库存和可用性是独立事实', () => {
  let model = Journey.create({
    role: 'host',
    baselineDeviceIds: ['device-a'],
    overview: overview()
  });
  let value = Journey.facts(model, overview());
  assert.equal(value.trusted, true);
  assert.equal(value.connected, false);
  assert.equal(value.catalogReady, false);
  assert.equal(value.inventoryReady, false);
  assert.equal(value.usable, false);

  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true }, overview());
  assert.equal(model.phase, 'connect');
  value = Journey.facts(model, overview({ connected: true, inventory: true }));
  assert.equal(value.connected, true);
  assert.equal(value.inventoryReady, true);
  assert.equal(value.catalogReady, false, 'inventory must not silently impersonate a catalog barrier');

  model = Journey.transition(model, { type: 'connection-result', ok: true }, overview({ connected: true, inventory: true }));
  value = Journey.facts(model, overview({ connected: true, inventory: true }));
  assert.equal(value.catalogReady, true);
  assert.equal(value.usable, true);
  assert.equal(model.phase, 'complete');
});

test('加入方必须先取得 Main 验签预览和 confirmation token 才能确认身份', () => {
  let model = Journey.create({ role: 'join', baselineDeviceIds: [] });
  model = Journey.transition(model, { type: 'code', code: 'AD1.example' });
  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true });
  assert.equal(model.identityConfirmed, false);
  assert.equal(model.errorCode, 'device-identity-confirmation-required');

  model = Journey.transition(model, {
    type: 'preview',
    preview: {
      inviteId: 'invite-a',
      confirmationToken: 'verified-token',
      sourceDeviceName: 'Office Mac',
      sourceFingerprint: '11223344',
      expiresAt: '2026-08-14T01:10:00.000Z',
      rawSecret: 'must-not-survive'
    }
  });
  assert.equal(model.preview.sourceDeviceName, 'Office Mac');
  assert.equal(Object.hasOwn(model.preview, 'rawSecret'), false);
  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true });
  assert.equal(model.identityConfirmed, true);
  assert.equal(model.phase, 'trust');
});

test('邀请方先看见加入设备的身份与指纹，明确批准后才进入等待成员信任', () => {
  let model = Journey.create({
    role: 'host',
    baselineDeviceIds: ['device-a'],
    invitation: {
      inviteId: 'invite-a',
      code: 'AD1.example'
    },
    overview: overview({ remote: false })
  });
  model = Journey.transition(model, {
    type: 'claim',
    claim: {
      approvalId: 'approval-a',
      inviteId: 'invite-a',
      deviceId: 'device-b',
      name: 'Workstation',
      fingerprint: 'SHA256:11223344',
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.10.1-preview.1',
      expiresAt: '2026-08-14T01:10:00.000Z'
    }
  }, overview({ remote: false }));
  assert.equal(model.claim.name, 'Workstation');
  assert.equal(model.identityConfirmed, false);
  assert.equal(model.phase, 'identity');

  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true }, overview({ remote: false }));
  assert.equal(model.identityConfirmed, true);
  assert.equal(model.phase, 'trust');
  model = Journey.transition(model, { type: 'claim-decision', confirmed: true }, overview({ remote: false }));
  assert.equal(model.approvalSubmitted, true);
  assert.equal(model.phase, 'trust');
  assert.equal(Journey.facts(model, overview({ remote: false })).trusted, false);
});

test('catalog-unavailable 不会被写成已可用', () => {
  let model = Journey.create({
    role: 'host',
    baselineDeviceIds: ['device-a'],
    overview: overview({ connected: true, inventory: true, catalogUnsupported: true })
  });
  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true }, overview({ connected: true, inventory: true, catalogUnsupported: true }));
  model = Journey.transition(model, { type: 'connection-result', ok: true }, overview({ connected: true, inventory: true, catalogUnsupported: true }));
  const value = Journey.facts(model, overview({ connected: true, inventory: true, catalogUnsupported: true }));
  assert.equal(value.catalogUnavailable, true);
  assert.equal(value.catalogReady, false);
  assert.equal(value.inventoryReady, true);
  assert.equal(value.usable, false);
  assert.equal(model.phase, 'catalog');
  assert.equal(Journey.stepStates(model, overview({ connected: true, inventory: true, catalogUnsupported: true })).catalog, 'error');
});

test('连接事件分别推进目录和库存，不把 authenticated 当作全部完成', () => {
  let model = Journey.create({
    role: 'host',
    baselineDeviceIds: ['device-a'],
    overview: overview()
  });
  model = Journey.transition(model, { type: 'confirm-identity', confirmed: true }, overview());
  model = Journey.transition(model, {
    type: 'connection-state',
    deviceId: 'device-b',
    state: 'catalog-synced'
  }, overview({ connected: true }));
  let value = Journey.facts(model, overview({ connected: true }));
  assert.equal(value.catalogReady, true);
  assert.equal(value.inventoryReady, false);
  assert.equal(value.usable, false);

  model = Journey.transition(model, {
    type: 'connection-state',
    deviceId: 'device-b',
    state: 'inventory-synced'
  }, overview({ connected: true }));
  value = Journey.facts(model, overview({ connected: true }));
  assert.equal(value.inventoryReady, true);
  assert.equal(value.usable, true);
});

test('重开向导从稳定设备 ID、成员和库存事实恢复，不依赖步骤序号', () => {
  const model = Journey.create({
    role: 'host',
    baselineDeviceIds: ['device-a'],
    targetDeviceId: 'device-b',
    identityConfirmed: true,
    connectionCompleted: true,
    overview: overview({ connected: true, inventory: true })
  });
  const value = Journey.facts(model, overview({ connected: true, inventory: true }));
  assert.equal(model.targetDeviceId, 'device-b');
  assert.equal(model.phase, 'complete');
  assert.equal(value.usable, true);
});
