const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  INVENTORY_REFRESH_MIN_INTERVAL_MS,
  INVENTORY_RESYNC_INTERVAL_MS,
  MAX_PENDING_INVENTORY_REFRESH_REQUESTS,
  PeerManager
} = require('../src/mesh/main/peer-manager');
const { createEnvelope } = require('../src/mesh/protocol/envelope');
const { encodeInventoryChunks } = require('../src/mesh/protocol/inventory');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('已认证设备再次 connect 会请求新库存，并等待匹配的完成响应', async () => {
  const harness = await peerHarness();
  const { manager, context } = harness;
  let releaseRefresh;
  let requestedDeviceId = null;
  manager.requestRemoteInventory = async (candidate) => {
    requestedDeviceId = candidate.peer.remote.deviceId;
    await new Promise((resolve) => { releaseRefresh = resolve; });
  };

  let settled = false;
  const pending = manager.connect('remote-device').then((value) => {
    settled = true;
    return value;
  });
  await flush();

  assert.equal(requestedDeviceId, 'remote-device');
  assert.equal(settled, false, 'connect must not expose stale cache before refresh completes');
  releaseRefresh();
  const connection = await pending;
  assert.equal(connection.deviceId, context.peer.remote.deviceId);
  assert.equal(connection.authenticated, true);
  manager.closeContext(context, 'test-complete');
});

test('refreshInventory 发送固定请求，忽略未知 requestId，只等待匹配完成响应', async () => {
  const { manager, context, remotePrivateKey } = await peerHarness();
  const sent = [];
  manager.sendDataEnvelope = async (_context, messageType, capability, payload) => {
    sent.push({ messageType, capability, payload });
    return `message-${sent.length}`;
  };

  let settled = false;
  const pending = manager.refreshInventory('remote-device').then((value) => {
    settled = true;
    return value;
  });
  await flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageType, 'inventory.refresh.request');
  assert.equal(sent[0].capability, 'inventory.read');
  assert.match(sent[0].payload.requestId, /^[A-Za-z0-9-]{8,128}$/);

  await manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
    messageType: 'inventory.refresh.complete',
    payload: { requestId: 'unknown-request', revision: 8 }
  }));
  await flush();
  assert.equal(settled, false, 'an unrelated completion cannot satisfy this refresh');

  const [chunk] = encodeInventoryChunks(inventory(9), { transferId: 'refresh-snapshot' });
  await manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 2, {
    messageType: 'inventory.chunk',
    payload: chunk
  }));
  await manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 3, {
    messageType: 'inventory.refresh.complete',
    payload: { requestId: sent[0].payload.requestId, revision: 9 }
  }));
  const result = await pending;
  assert.equal(settled, true);
  assert.equal(result.deviceId, 'remote-device');
  assert.equal(result.authenticated, true);
  manager.closeContext(context, 'test-complete');
});

test('首份完整库存先落库再释放 firstInventory，connect 明确等待该屏障', async () => {
  const { manager, context, applied, remotePrivateKey } = await peerHarness();
  assert.ok(context.firstInventory?.promise, 'peer context must expose its first-inventory barrier');

  let released = false;
  const firstInventory = context.firstInventory.promise.then((value) => {
    released = true;
    assert.equal(applied.length, 1, 'inventory must be persisted before the barrier resolves');
    return value;
  });
  const [chunk] = encodeInventoryChunks(inventory(4), { transferId: 'first-snapshot' });
  await manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
    messageType: 'inventory.chunk',
    payload: chunk
  }));
  await firstInventory;

  assert.equal(released, true);
  assert.equal(applied[0].deviceId, 'remote-device');
  assert.equal(applied[0].inventory.revision, 4);
  assert.match(
    read('src/mesh/main/peer-manager.js'),
    /await context\.firstInventory\.promise/,
    'new connect must wait until its first remote inventory has been applied'
  );
  manager.closeContext(context, 'test-complete');
});

test('匹配的 refresh.complete 也不能越过未落库的库存 revision', async () => {
  const { manager, context, remotePrivateKey } = await peerHarness();
  let requestId = null;
  manager.sendDataEnvelope = async (_context, messageType, _capability, payload) => {
    if (messageType === 'inventory.refresh.request') requestId = payload.requestId;
    return 'message-id';
  };
  const pending = manager.refreshInventory('remote-device');
  await flush();

  await manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
    messageType: 'inventory.refresh.complete',
    payload: { requestId, revision: 1 }
  }));
  await assert.rejects(pending, /inventory-refresh-not-applied/);
  manager.closeContext(context, 'test-complete');
});

test('旧 revision 库存不能覆盖或冒充首份新快照', async () => {
  const { manager, context, remotePrivateKey, applied } = await peerHarness();
  context.lastReceivedInventoryRevision = 4;
  const [chunk] = encodeInventoryChunks(inventory(3), { transferId: 'stale-snapshot' });
  await assert.rejects(
    manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
      messageType: 'inventory.chunk',
      payload: chunk
    })),
    /inventory-revision-stale/
  );
  assert.equal(applied.length, 0);
  manager.closeContext(context, 'test-complete');
});

test('未知已签名消息不会降级为通用命令或被静默执行', async () => {
  const { manager, context, remotePrivateKey } = await peerHarness();
  await assert.rejects(
    manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
      messageType: 'inventory.arbitrary-command',
      payload: { command: 'do-anything' }
    })),
    /peer-message-type-unknown/
  );
  manager.closeContext(context, 'test-complete');
});

test('现有连接每次库存收发重读当前权限，撤销 inventory.read 后立即拒绝并关闭', async () => {
  const { manager, context, remotePrivateKey, setPermissions } = await peerHarness();
  setPermissions([]);

  await assert.rejects(
    manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
      messageType: 'inventory.refresh.request',
      payload: { requestId: 'revoked-request' }
    })),
    /capability-denied:inventory\.read/
  );
  await assert.rejects(
    Promise.resolve().then(() => manager.requestRemoteInventory(context)),
    /capability-denied:inventory\.read/
  );

  assert.equal(manager.handlePermissionsChanged('remote-device', []), false);
  assert.equal(context.closed, true, 'the active transport is torn down synchronously on revocation');
  assert.equal(manager.connectionsByDevice.has('remote-device'), false);
  assert.match(
    read('src/main.js'),
    /devices:updatePermissions[\s\S]*?peerManager\?\.handlePermissionsChanged\(device\.deviceId, device\.permissions\)/
  );
});

test('并发 refresh.request 每连接单飞并限制等待者，不会重复触发全量扫描', async () => {
  assert.ok(INVENTORY_REFRESH_MIN_INTERVAL_MS > 0);
  assert.ok(MAX_PENDING_INVENTORY_REFRESH_REQUESTS >= 1);

  const { manager, context, remotePrivateKey } = await peerHarness();
  let scans = 0;
  let releaseScan;
  const scanGate = new Promise((resolve) => { releaseScan = resolve; });
  manager.sendInventory = async () => {
    scans += 1;
    await scanGate;
    return 7;
  };
  const completed = [];
  manager.sendDataEnvelope = async (_context, messageType, _capability, payload) => {
    if (messageType === 'inventory.refresh.complete') completed.push(payload);
    return 'message-id';
  };

  const requests = Array.from({ length: MAX_PENDING_INVENTORY_REFRESH_REQUESTS }, (_value, index) => (
    manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, index + 1, {
      messageType: 'inventory.refresh.request',
      payload: { requestId: `coalesced-${index}` }
    }))
  ));
  await flush();
  assert.equal(scans, 1);

  await assert.rejects(
    manager.receiveDataEnvelope(context, remoteEnvelope(
      context,
      remotePrivateKey,
      MAX_PENDING_INVENTORY_REFRESH_REQUESTS + 1,
      {
        messageType: 'inventory.refresh.request',
        payload: { requestId: 'over-limit' }
      }
    )),
    /inventory-refresh-rate-limited/
  );

  releaseScan();
  await Promise.all(requests);
  assert.equal(scans, 1);
  assert.equal(completed.length, MAX_PENDING_INVENTORY_REFRESH_REQUESTS);
  assert.deepEqual(new Set(completed.map((item) => item.revision)), new Set([7]));
  manager.closeContext(context, 'test-complete');
});

test('显式刷新撞上在途周期快照时仍会生成更新 revision', async () => {
  const { manager, context, remotePrivateKey } = await peerHarness();
  let scans = 0;
  let releaseFirst;
  manager.sendInventory = async () => {
    scans += 1;
    if (scans === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    return scans;
  };
  const completed = [];
  manager.sendDataEnvelope = async (_context, messageType, _capability, payload) => {
    if (messageType === 'inventory.refresh.complete') completed.push(payload);
    return 'message-id';
  };

  const periodic = manager.queueInventorySend(context);
  await flush();
  const refresh = manager.receiveDataEnvelope(context, remoteEnvelope(context, remotePrivateKey, 1, {
    messageType: 'inventory.refresh.request',
    payload: { requestId: 'refresh-during-periodic' }
  }));
  await flush();
  assert.equal(scans, 1, 'the refresh waits for the in-flight snapshot instead of duplicating it');

  releaseFirst();
  await Promise.all([periodic, refresh]);
  assert.equal(scans, 2, 'the refresh then creates one newer bounded snapshot');
  assert.deepEqual(completed, [{ requestId: 'refresh-during-periodic', revision: 2 }]);
  manager.closeContext(context, 'test-complete');
});

test('close/generation 取消冷却中的刷新，排队扫描与 ACK 都不会泄漏', async () => {
  const { manager, context } = await peerHarness();
  let scans = 0;
  manager.sendInventory = async () => { scans += 1; return 2; };
  context.lastInventorySnapshotStartedAt = Date.now();

  const queued = manager.handleInventoryRefreshRequest(context, 'queued-before-close');
  await flush();
  assert.ok(context.inventoryRefreshDelay, 'a recent snapshot must enforce the minimum interval');
  manager.closeContext(context, 'test-close');
  await assert.rejects(queued, /test-close|peer-closed/);
  assert.equal(scans, 0, 'closing during cooldown prevents the queued filesystem scan');
  assert.equal(context.incomingInventoryRefreshWaiters, 0);
  assert.equal(context.activeIncomingInventoryRefreshIds.size, 0);
  assert.equal(context.pendingAcks.size, 0);

  const second = await peerHarness();
  second.manager.sendDataEnvelope = async () => { throw new Error('send-failed'); };
  await assert.rejects(second.manager.sendInventory(second.context), /send-failed/);
  assert.equal(second.context.pendingAcks.size, 0, 'failed sends remove and settle their ACK waiter');
  second.manager.closeContext(second.context, 'test-complete');
});

test('认证后低频重复发布库存，关闭连接会清理定时器', async () => {
  assert.ok(Number.isFinite(INVENTORY_RESYNC_INTERVAL_MS));
  assert.ok(INVENTORY_RESYNC_INTERVAL_MS >= 60_000, 'inventory publication must remain low frequency');
  assert.ok(INVENTORY_RESYNC_INTERVAL_MS < 5 * 60_000, 'publication must beat the default staleAt window');

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let interval = null;
  const cleared = [];
  global.setInterval = (callback, delay) => {
    interval = { callback, delay, handle: { inventoryTimer: true } };
    return interval.handle;
  };
  global.clearInterval = (handle) => cleared.push(handle);

  try {
    const { manager, context } = await peerHarness();
    let snapshots = 0;
    manager.sendInventory = async () => { snapshots += 1; return snapshots; };
    manager.startInventorySync(context);
    await flush();

    assert.equal(snapshots, 1, 'authentication sends the initial snapshot immediately');
    assert.equal(interval.delay, INVENTORY_RESYNC_INTERVAL_MS);
    await interval.callback();
    await flush();
    assert.equal(snapshots, 2, 'the authenticated connection republishes a bounded snapshot');

    manager.closeContext(context, 'test-complete');
    assert.deepEqual(cleared, [interval.handle]);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('目录变更可立即向所有已认证连接发布新库存', async () => {
  const { manager, context } = await peerHarness();
  let snapshots = 0;
  manager.sendInventory = async () => { snapshots += 1; return snapshots; };

  const published = await manager.broadcastInventory();
  assert.equal(published, 1);
  assert.equal(snapshots, 1);
  manager.closeContext(context, 'test-complete');

  assert.match(read('src/main.js'), /function catalogMeshCall\(callback\)[\s\S]*?broadcastInventory\(\)/);
});

test('扫描中发生的多次目录广播最多合并为一个后继快照且不会丢失', async () => {
  const { manager, context } = await peerHarness();
  let snapshots = 0;
  let releaseFirst;
  manager.sendInventory = async () => {
    snapshots += 1;
    if (snapshots === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    return snapshots;
  };

  const first = manager.queueInventorySend(context);
  await flush();
  const broadcasts = [
    manager.broadcastInventory(),
    manager.broadcastInventory(),
    manager.broadcastInventory()
  ];
  await flush();
  assert.equal(snapshots, 1);
  releaseFirst();
  await Promise.all([first, ...broadcasts]);
  assert.equal(snapshots, 2, 'catalog changes retain one bounded fresh follow-up scan');
  manager.closeContext(context, 'test-complete');
});

test('远程重扫通过固定 remoteInventory:refresh IPC/Preload 暴露，不提供通用通道', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const renderer = read('src/renderer.js');
  assert.match(main, /ipcMain\.handle\('remoteInventory:refresh'/);
  assert.match(main, /getPeerManager\(\)\.refreshInventory\(/);
  assert.match(
    preload,
    /refreshMeshInventory:\s*\(deviceId\)\s*=>\s*ipcRenderer\.invoke\('remoteInventory:refresh',\s*\{ deviceId \}\)/
  );
  assert.match(renderer, /profile\?\._remote === true && window\.manager\.refreshMeshInventory/);
  assert.match(renderer, /refreshRemoteInventoryForDevice\(profile\._meshDeviceId\)/);
  assert.match(renderer, /function refreshRemoteInventoryForDevice[\s\S]*?refreshMeshInventory\(deviceId\)/);
  assert.match(renderer, /els\.refreshBtn\.disabled = disabled \|\| \(remote && !window\.manager\.refreshMeshInventory\)/);
  assert.doesNotMatch(preload, /remoteInventory:(command|exec|invoke)|remoteCommand|generic\.exec/i);
});

test('远端 Lens 与设备会话入口先显示缓存再按需刷新，本机和全部设备不扇出连接', () => {
  const renderer = read('src/renderer.js');
  const helper = sourceFunction(renderer, 'refreshRemoteInventoryForDevice', 'viewDeviceSessions');
  const viewDevice = sourceFunction(renderer, 'viewDeviceSessions', 'viewDeviceAgentSessions');
  const viewAgent = sourceFunction(renderer, 'viewDeviceAgentSessions', 'renderSelectedDeviceActions');
  const selectLens = sourceFunction(renderer, 'selectDeviceLens', 'selectedDeviceLensLabel');

  assert.match(helper, /if \(!device \|\| device\.isLocal \|\| !window\.manager\.refreshMeshInventory\) return Promise\.resolve\(null\)/);
  assert.match(helper, /remoteInventoryRefreshes\.get\(deviceId\)[\s\S]*?if \(existing\) return existing/);
  assert.match(helper, /remoteInventoryRefreshes\.set\(deviceId, operation\)/);
  assert.match(helper, /refreshMeshInventory\(deviceId\)/);
  assert.match(helper, /if \(!result\?\.ok\)[\s\S]*?remoteInventoryRefreshFailureText\(result\?\.reasonCode, deviceName\)[\s\S]*?return null/);
  assert.match(renderer, /function remoteInventoryRefreshFailureText[\s\S]*?status\.refreshRemoteNoRoute[\s\S]*?status\.refreshRemoteTimeout/);
  assert.doesNotMatch(helper, /state\.sessions\s*=\s*\[\]/, 'refresh failure must preserve the rendered cache');
  assert.match(helper, /state\.mesh\.overview = result\.overview[\s\S]*?loadMeshSessions\(result\.sessions\)/);

  assert.match(viewDevice, /await loadSessions\(\);[\s\S]*?await refreshRemoteInventoryForDevice\(device\)/);
  assert.match(viewAgent, /await loadSessions\(\);[\s\S]*?await refreshRemoteInventoryForDevice\(device\)/);
  assert.match(selectLens, /await loadSessions\(\);[\s\S]*?await refreshRemoteInventoryForDevice\(lensId\)/);
  assert.doesNotMatch(viewDevice, /selectDeviceLens\(/, 'device-center navigation must not launch a second Lens refresh');
  assert.doesNotMatch(viewAgent, /selectDeviceLens\(/, 'Agent navigation must not launch a second Lens refresh');
});

test('inventory-synced 撞上 Mesh 忙碌状态时会合并并在释放后补载', () => {
  const renderer = read('src/renderer.js');
  const eventBlock = renderer.slice(
    renderer.indexOf('if (window.manager.onDeviceConnectionState)'),
    renderer.indexOf('if (window.manager.onDeviceNetworkState)')
  );
  const request = sourceFunction(renderer, 'requestDeviceOverviewReload', 'flushPendingDeviceOverviewReload');
  const flush = sourceFunction(renderer, 'flushPendingDeviceOverviewReload', 'loadDeviceOverview');
  const render = sourceFunction(renderer, 'renderDeviceCenter', 'renderMeshPreview');

  assert.match(eventBlock, /inventory-synced[\s\S]*?requestDeviceOverviewReload\(\)/);
  assert.match(request, /pendingDeviceOverviewReload = true[\s\S]*?flushPendingDeviceOverviewReload\(\)/);
  assert.match(flush, /pendingDeviceOverviewReload[\s\S]*?state\.mesh\.loading[\s\S]*?deviceOverviewReloadPromise/);
  assert.match(flush, /loadDeviceOverview\(\{ silent: true \}\)/);
  assert.match(render, /flushPendingDeviceOverviewReload\(\)/, 'the common post-loading render drains the pending reload');
});

function sourceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} missing`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

async function peerHarness() {
  const remoteKeys = crypto.generateKeyPairSync('ed25519');
  const localKeys = crypto.generateKeyPairSync('ed25519');
  const applied = [];
  let permissions = ['inventory.read'];
  const meshService = {
    createInventorySnapshot: () => inventory(1, 'local-device'),
    applyRemoteInventory: (value) => applied.push(value),
    setRemoteConnectionState: () => {},
    getPeerContext: () => contextPeer(localKeys.privateKey, remoteKeys.publicKey, permissions)
  };
  const manager = new PeerManager({
    BrowserWindow: FakeBrowserWindow,
    ipcMain: fakeIpcMain(),
    peerDirectory: path.join(ROOT, 'src', 'mesh', 'peer'),
    meshService,
    sendSignal: async () => { throw new Error('unexpected-signal'); }
  });
  const context = await manager.spawnPeer({
    role: 'offerer',
    connectionId: 'connection-refresh-test',
    peer: contextPeer(localKeys.privateKey, remoteKeys.publicKey),
    localChallenge: 'local-challenge'
  });
  context.authenticated = true;
  context.signal.resolve({ description: { type: 'offer', sdp: 'test' } });
  context.open.resolve({ channel: 'control.reliable' });
  context.auth.resolve(true);
  manager.sendDataEnvelope = async () => 'message-id';
  return {
    manager,
    context,
    applied,
    remotePrivateKey: remoteKeys.privateKey,
    setPermissions(value) { permissions = Array.isArray(value) ? [...value] : []; }
  };
}

function contextPeer(localPrivateKey, remotePublicKey, permissions = ['inventory.read']) {
  return {
    mesh: { meshId: 'mesh-test', rootPublicKey: remotePublicKey },
    local: { deviceId: 'local-device' },
    remote: {
      deviceId: 'remote-device',
      name: 'Remote Device',
      status: 'online',
      permissions,
      endpoints: ['http://127.0.0.1:49999'],
      devicePublicKey: remotePublicKey
    },
    secrets: { devicePrivateKey: localPrivateKey }
  };
}

function remoteEnvelope(context, privateKey, sequence, input) {
  return createEnvelope({
    protocolVersion: '1.0',
    messageType: input.messageType,
    connectionId: context.connectionId,
    sourceDeviceId: context.peer.remote.deviceId,
    targetDeviceId: context.peer.local.deviceId,
    sequence,
    capability: 'inventory.read',
    payload: input.payload
  }, privateKey);
}

function inventory(revision, deviceId = 'remote-device') {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    deviceId,
    revision,
    generatedAt,
    staleAt: new Date(Date.parse(generatedAt) + 5 * 60_000).toISOString(),
    catalog: { catalogRevision: 0, agents: [], accountBindings: [], slots: [], tombstones: [] },
    sessions: []
  };
}

function fakeIpcMain() {
  return {
    handlers: new Map(),
    handle(channel, callback) { this.handlers.set(channel, callback); }
  };
}

class FakeBrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.id = Math.floor(Math.random() * 1_000_000) + 1;
    this.webContents.messages = [];
    this.webContents.send = (channel, payload) => this.webContents.messages.push({ channel, payload });
  }

  async loadFile() {}

  isDestroyed() { return this.destroyed; }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
