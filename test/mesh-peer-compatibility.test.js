const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  PeerManager,
  PROTOCOL_FEATURES,
  KNOWN_PROTOCOL_FEATURES
} = require('../src/mesh/main/peer-manager');
const {
  MAX_PROTOCOL_FEATURES,
  normalizeProtocolFeatures,
  negotiateProtocolFeatures
} = require('../src/mesh/protocol/features');

test('协议特性只接受有界精确白名单，未知、重复和畸形值不会被保存', () => {
  const noisy = [
    PROTOCOL_FEATURES.CATALOG_EVENTS_V1,
    PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1,
    PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1,
    'catalog.snapshot.v2',
    42,
    null,
    'x'.repeat(200),
    PROTOCOL_FEATURES.INVENTORY_DEVICE_FACTS_V1,
    PROTOCOL_FEATURES.TASK_PACKAGE_TRANSFER_V1,
    ...Array.from({ length: MAX_PROTOCOL_FEATURES + 10 }, () => 'unknown.feature')
  ];
  assert.deepEqual(normalizeProtocolFeatures(noisy), [...KNOWN_PROTOCOL_FEATURES].sort());
  assert.deepEqual(normalizeProtocolFeatures(null), []);
  assert.deepEqual(negotiateProtocolFeatures(KNOWN_PROTOCOL_FEATURES, [
    PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1,
    'unknown.feature'
  ]), [PROTOCOL_FEATURES.CATALOG_SNAPSHOT_V1]);
});

test('旧端未声明目录特性时只启动库存，不发送未知 catalog 消息', async () => {
  const { manager, context, sent } = harness({ protocolFeatures: [] });
  let inventoryStarts = 0;
  manager.startInventorySync = () => { inventoryStarts += 1; };
  manager.sendDataEnvelope = async (_context, messageType, capability, payload) => {
    sent.push({ messageType, capability, payload });
  };

  manager.updateRemoteProtocolFeatures(context, undefined);
  await manager.startInitialSync(context);
  const catalog = await context.firstCatalog.promise;
  assert.equal(catalog.reason, 'catalog-feature-unavailable');
  assert.equal(inventoryStarts, 1);
  assert.deepEqual(sent, []);
});

test('新端目录权限不对称时显式发送 unavailable，另一端无需等到超时', async () => {
  const denied = harness({ permissions: ['inventory.read'] });
  denied.manager.updateRemoteProtocolFeatures(denied.context, KNOWN_PROTOCOL_FEATURES);
  denied.manager.sendDataEnvelope = async (_context, messageType, capability, payload) => {
    denied.sent.push({ messageType, capability, payload });
  };
  await denied.manager.startCatalogSync(denied.context);
  assert.deepEqual(denied.sent, [{
    messageType: 'connection.catalog-unavailable',
    capability: 'inventory.read',
    payload: { status: 'unavailable', reason: 'catalog-capability-denied' }
  }]);
  assert.equal((await denied.context.firstCatalog.promise).reason, 'catalog-capability-denied');

  const waiting = harness();
  waiting.manager.updateRemoteProtocolFeatures(waiting.context, KNOWN_PROTOCOL_FEATURES);
  waiting.manager.verifyRemoteEnvelope = () => ({
    ok: true,
    payload: {
      messageType: 'connection.catalog-unavailable',
      capability: 'inventory.read',
      payload: { status: 'unavailable', reason: 'catalog-capability-denied' }
    }
  });
  await waiting.manager.receiveDataEnvelope(waiting.context, {});
  assert.equal((await waiting.context.firstCatalog.promise).reason, 'catalog-capability-denied');
});

test('握手先记录协商特性再发布 authenticated 状态，且特性不写入设备权限', async () => {
  const states = [];
  const { manager, context } = harness({ onState: (value) => states.push(value) });
  manager.updateRemoteProtocolFeatures(context, KNOWN_PROTOCOL_FEATURES);
  context.authenticated = false;
  await manager.finishAuthenticated(context);
  assert.deepEqual(states.at(-1).protocolFeatures, [...KNOWN_PROTOCOL_FEATURES].sort());
  assert.deepEqual(context.peer.remote.permissions, ['inventory.read', 'catalog.manage']);
  assert.equal(Object.hasOwn(context.peer.remote, 'protocolFeatures'), false);
});

test('协商新库存特性时发送设备事实模式，旧端连接保留兼容投影', async () => {
  const modern = harness();
  modern.manager.updateRemoteProtocolFeatures(modern.context, KNOWN_PROTOCOL_FEATURES);
  await modern.manager.sendInventory(modern.context);
  assert.deepEqual(modern.snapshotOptions, [{ includeLegacyCatalogProjection: false }]);

  const legacy = harness({ protocolFeatures: [] });
  legacy.manager.updateRemoteProtocolFeatures(legacy.context, []);
  await legacy.manager.sendInventory(legacy.context);
  assert.deepEqual(legacy.snapshotOptions, [{ includeLegacyCatalogProjection: true }]);
});

test('认证握手更新远端运行版本，目录事件连接优先发送增量而不是旧快照', async () => {
  const modern = harness();
  modern.manager.updateRemoteProtocolFeatures(modern.context, KNOWN_PROTOCOL_FEATURES);
  modern.manager.updateRemoteRuntimeMetadata(modern.context, {
    appVersion: '0.9.5',
    protocolVersion: '1.0',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os'
  });
  assert.deepEqual(modern.runtimeMetadata, [{
    deviceId: 'remote-device',
    value: {
      appVersion: '0.9.5',
      protocolVersion: '1.0',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: 'test-os'
    }
  }]);
  await modern.manager.queueCatalogSend(modern.context);
  assert.equal(modern.catalogEventSyncs.length, 1);
  assert.equal(modern.catalogSnapshots, 0);
  assert.equal(modern.sent.some((item) => item.messageType === 'catalog.events.complete'), true);
});

test('TaskPackage 全消息族同时绑定独立 capability 与协商 feature，撤权后下一条消息立即失败', async () => {
  const taskPermission = ['inventory.read', 'catalog.manage', 'task.package.receive'];
  const endpoint = harness({ permissions: taskPermission });
  const send = endpoint.realSendDataEnvelope;

  await assert.rejects(() => send(
    endpoint.context,
    'task.package.offer',
    'file.receive',
    { transferId: 'transfer-a' }
  ), /peer-capability-mismatch/);
  await assert.rejects(() => send(
    endpoint.context,
    'task.package.offer',
    'task.package.receive',
    { transferId: 'transfer-a' }
  ), /peer-protocol-feature-unavailable/);

  endpoint.context.negotiatedProtocolFeatures = [PROTOCOL_FEATURES.TASK_PACKAGE_TRANSFER_V1];
  await send(
    endpoint.context,
    'task.package.chunk',
    'task.package.receive',
    { transferId: 'transfer-a' }
  );
  assert.equal(endpoint.wire.at(-1).payload.message.messageType, 'task.package.chunk');

  endpoint.manager.handlePermissionsChanged('remote-device', ['inventory.read', 'catalog.manage']);
  await assert.rejects(() => send(
    endpoint.context,
    'task.package.chunk.ack',
    'task.package.receive',
    { transferId: 'transfer-a' }
  ), /capability-denied:task\.package\.receive/);
});

function harness(options = {}) {
  const permissions = options.permissions || ['inventory.read', 'catalog.manage'];
  const snapshotOptions = [];
  const sent = [];
  const runtimeMetadata = [];
  const catalogEventSyncs = [];
  const wire = [];
  let catalogSnapshots = 0;
  const peer = {
    mesh: { meshId: 'mesh-compat' },
    local: { deviceId: 'local-device' },
    remote: {
      deviceId: 'remote-device',
      name: 'Remote',
      permissions: [...permissions],
      capabilities: ['inventory.read', 'catalog.manage']
    },
    secrets: { devicePrivateKey: crypto.generateKeyPairSync('ed25519').privateKey }
  };
  const meshService = {
    getPeerContext: () => ({
      ...peer,
      remote: { ...peer.remote, permissions: [...peer.remote.permissions] }
    }),
    setRemoteConnectionState: () => {},
    createCatalogSnapshot: () => {
      catalogSnapshots += 1;
      return { schemaVersion: 1 };
    },
    createCatalogEventSync: (vector) => {
      catalogEventSyncs.push({ ...vector });
      return {
        meshId: 'mesh-compat',
        sourceDeviceId: 'local-device',
        vector: { 'local-device': 1 },
        events: []
      };
    },
    getCatalogEventVector: () => ({ 'local-device': 1 }),
    getLocalRuntimeMetadata: () => ({
      appVersion: '0.9.5', protocolVersion: '1.0', platform: 'darwin', arch: 'arm64', osVersion: 'test-os'
    }),
    updateRemoteRuntimeMetadata: (deviceId, value) => runtimeMetadata.push({ deviceId, value }),
    createInventorySnapshot: (value) => {
      snapshotOptions.push({ ...value });
      return inventory();
    },
    updateRemoteCapabilities: () => {}
  };
  const manager = new PeerManager({
    ipcMain: fakeIpcMain(),
    meshService,
    protocolFeatures: options.protocolFeatures,
    onState: options.onState
  });
  const firstCatalog = manualDeferred();
  const context = {
    connectionId: 'connection-compat',
    role: 'offerer',
    peer,
    window: { isDestroyed: () => false, webContents: { send: (...args) => wire.push({ channel: args[0], payload: args[1] }) } },
    authenticated: true,
    closed: false,
    generation: 0,
    sendSequence: 0,
    catalogStarted: false,
    inventoryStarted: false,
    initialSyncPromise: null,
    firstCatalog,
    firstInventory: manualDeferred(),
    auth: manualDeferred(),
    open: { promise: Promise.resolve(true) },
    remoteProtocolFeatures: [],
    negotiatedProtocolFeatures: [],
    remoteCatalogVector: {},
    incomingCatalogSyncs: new Map(),
    pendingAcks: new Map(),
    pendingInventoryRefreshes: new Map(),
    catalogSendPromise: null,
    catalogSendFollowup: false,
    lastReceivedInventoryRevision: 0,
    inventoryAssembler: { clear: () => {} }
  };
  manager.connectionsById.set(context.connectionId, context);
  manager.connectionsByDevice.set(peer.remote.deviceId, context);
  const realSendDataEnvelope = manager.sendDataEnvelope.bind(manager);
  manager.sendDataEnvelope = async (_context, messageType, capability, payload) => {
    sent.push({ messageType, capability, payload });
    if (messageType === 'inventory.chunk') {
      const key = `${payload.transferId}:${payload.index}`;
      queueMicrotask(() => context.pendingAcks.get(key)?.resolve(true));
    }
    return 'message-id';
  };
  return {
    manager,
    context,
    peer,
    sent,
    snapshotOptions,
    runtimeMetadata,
    catalogEventSyncs,
    realSendDataEnvelope,
    wire,
    get catalogSnapshots() { return catalogSnapshots; }
  };
}

function inventory() {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    deviceId: 'local-device',
    revision: 1,
    generatedAt,
    staleAt: new Date(Date.parse(generatedAt) + 5 * 60_000).toISOString(),
    catalog: { catalogRevision: 0, agents: [], accountBindings: [], slots: [], tombstones: [] },
    sessions: []
  };
}

function manualDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function fakeIpcMain() {
  return { handle: () => {} };
}
