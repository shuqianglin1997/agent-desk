const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeRelativePath, safeRelativePath } = require('../src/mesh/domain/session-pointer');
const { resolveProjectPointer } = require('../src/mesh/domain/project-mapping');
const {
  createFileManifest,
  normalizeFileManifest,
  safeFileName,
  uniqueTargetNames
} = require('../src/mesh/domain/file-transfer');
const { encryptSecurePayload, decryptSecurePayload } = require('../src/mesh/protocol/secure-payload');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshStore } = require('../src/mesh/storage/mesh-store');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { TransferService } = require('../src/mesh/main/transfer-service');

test('纯本地模式查看活动不会提前创建不完整 Mesh 数据库', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-transfer-local-'));
  const databasePath = path.join(directory, 'mesh.db');
  try {
    const service = new TransferService({
      databasePath,
      meshService: {},
      peerManagerProvider: () => null
    });
    assert.deepEqual(service.list(), []);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('安全 payload 绑定 Mesh、传输、来源和目标，篡改后不能解密', () => {
  const context = {
    meshId: 'mesh-a',
    transferId: 'transfer-a',
    type: 'session-pointer',
    sourceDeviceId: 'device-a',
    targetDeviceId: 'device-b',
    linkKey: Buffer.alloc(32, 3).toString('base64')
  };
  const encrypted = encryptSecurePayload({ path: '/private/project' }, context);
  assert.doesNotMatch(JSON.stringify(encrypted), /private\/project/);
  assert.deepEqual(decryptSecurePayload(encrypted, context), { path: '/private/project' });
  assert.throws(() => decryptSecurePayload(encrypted, { ...context, targetDeviceId: 'device-c' }), /decrypt/);
  assert.throws(() => decryptSecurePayload({ ...encrypted, tag: 'bad' }, context), /decrypt/);
});

test('项目相对路径拒绝绝对路径和穿越，映射只解析到确认根目录内', () => {
  assert.equal(safeRelativePath('/work/project', '/work/project/src/main.js'), 'src/main.js');
  assert.equal(safeRelativePath('/work/project', '/work/other/file.js'), null);
  assert.throws(() => normalizeRelativePath('../secret'), /traversal/);
  assert.throws(() => normalizeRelativePath('C:\\secret'), /absolute/);
  const pointer = { location: { projectId: 'project-a', relativePath: 'src/main.js' } };
  const result = resolveProjectPointer(pointer, [{
    projectId: 'project-a',
    deviceId: 'device-b',
    localRoot: 'D:\\Projects\\AgentDesk',
    source: 'user-confirmed',
    verifiedAt: new Date().toISOString(),
    lastResolvedAt: new Date().toISOString()
  }], { deviceId: 'device-b' });
  assert.equal(result.mapped, true);
  assert.equal(result.targetPath, 'D:\\Projects\\AgentDesk\\src\\main.js');
});

test('文件 manifest 拒绝危险名称并稳定避免覆盖同名文件', () => {
  assert.equal(safeFileName('../CON.txt'), '.._CON.txt');
  assert.deepEqual(uniqueTargetNames([{ name: 'report.txt' }, { name: 'report.txt' }], ['Report.txt']), [
    'report (2).txt',
    'report (3).txt'
  ]);
  const manifest = createFileManifest({
    transferId: 'transfer-files',
    files: [{
      index: 0,
      fileId: 'file-a',
      name: 'safe.txt',
      size: 3,
      sha256: 'a'.repeat(64),
      mtimeMs: 1
    }]
  }, { now: '2026-08-10T00:00:00.000Z' });
  assert.equal(normalizeFileManifest(manifest).files[0].name, 'safe.txt');
  assert.throws(() => normalizeFileManifest({
    ...manifest,
    files: [{ ...manifest.files[0], name: '../unsafe.txt' }]
  }), /name/);
});

test('SessionPointer 在线送达、离线密文排队、上线重试和本机项目映射', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-transfer-'));
  const leftDir = path.join(directory, 'left');
  const rightDir = path.join(directory, 'right');
  fs.mkdirSync(leftDir, { recursive: true });
  fs.mkdirSync(rightDir, { recursive: true });
  const now = () => new Date().toISOString();
  let leftTransfer;
  let rightTransfer;
  let connected = true;
  try {
    const left = service(leftDir, 'Left', 'left-slot', 'darwin', now);
    const right = service(rightDir, 'Right', 'right-slot', 'win32', now, {
      pairingTransport: async (_invite, request) => left.claimInvite({ request })
    });
    left.initialize();
    await right.join({ code: left.createInvite().code });
    const leftId = left.getOverview().localDeviceId;
    const rightId = right.getOverview().localDeviceId;

    let leftManager;
    let rightManager;
    leftTransfer = new TransferService({
      databasePath: path.join(leftDir, 'mesh.db'),
      meshService: left,
      peerManagerProvider: () => leftManager,
      now
    });
    rightTransfer = new TransferService({
      databasePath: path.join(rightDir, 'mesh.db'),
      meshService: right,
      peerManagerProvider: () => rightManager,
      now
    });
    leftManager = fakeManager(() => connected, rightId, async (messageType, payload) => {
      return rightTransfer.handleEnvelope({
        context: { peer: right.getPeerContext(leftId) },
        envelope: { messageType, payload }
      });
    });
    rightManager = fakeManager(() => connected, leftId, async (messageType, payload) => {
      return leftTransfer.handleEnvelope({
        context: { peer: left.getPeerContext(rightId) },
        envelope: { messageType, payload }
      });
    });

    const row = left.getUnifiedSessions()[0];
    const delivered = await leftTransfer.createSessionPointerTransfer({
      targetDeviceId: rightId,
      selections: [{ conversationId: row.conversationId, replicaId: row._replicaId }]
    });
    assert.equal(delivered.state, 'completed');
    const incoming = rightTransfer.list().find((job) => job.direction === 'incoming');
    assert.equal(incoming.state, 'received');
    assert.equal(incoming.items.length, 1);
    assert.equal(incoming.items[0].path, '/projects/AgentDesk');
    assert.match(incoming.items[0].coordinate, /thread-shared/);

    const store = new MeshStore(path.join(leftDir, 'mesh.db'));
    const raw = store.readTransferJob(delivered.transferId);
    store.close();
    assert.doesNotMatch(JSON.stringify(raw.encryptedPayload), /projects\/AgentDesk|thread-shared/);

    const binding = rightTransfer.saveProjectBinding({
      projectId: incoming.items[0].projectId,
      sourceDeviceId: leftId,
      localRoot: 'D:\\Projects\\AgentDesk'
    });
    assert.equal(binding.localRoot, 'D:\\Projects\\AgentDesk');
    const mapped = rightTransfer.list().find((job) => job.transferId === incoming.transferId);
    assert.equal(mapped.items[0].mapping.mapped, true);
    assert.equal(mapped.items[0].sourcePath, '/projects/AgentDesk');
    assert.equal(mapped.items[0].path, 'D:\\Projects\\AgentDesk');

    connected = false;
    const queued = await leftTransfer.createSessionPointerTransfer({
      targetDeviceId: rightId,
      selections: [{ conversationId: row.conversationId, replicaId: row._replicaId }]
    });
    assert.equal(queued.state, 'queued');
    connected = true;
    await leftTransfer.flushDevice(rightId);
    assert.equal(leftTransfer.list().find((job) => job.transferId === queued.transferId).state, 'completed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('选定文件经加密分块、逐块确认和哈希验证后保存，已有同名文件不被覆盖', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-file-transfer-'));
  const leftDir = path.join(directory, 'left');
  const rightDir = path.join(directory, 'right');
  const sourceDir = path.join(directory, 'source');
  const destination = path.join(directory, 'destination');
  for (const item of [leftDir, rightDir, sourceDir, destination]) fs.mkdirSync(item, { recursive: true });
  const sourcePath = path.join(sourceDir, 'report.txt');
  const content = Buffer.alloc(240 * 1024 + 17, 'mesh-file-content');
  fs.writeFileSync(sourcePath, content);
  fs.writeFileSync(path.join(destination, 'report.txt'), 'existing');
  const now = () => new Date().toISOString();
  try {
    const left = service(leftDir, 'Left', 'left-slot', 'darwin', now);
    const right = service(rightDir, 'Right', 'right-slot', 'win32', now, {
      pairingTransport: async (_invite, request) => left.claimInvite({ request })
    });
    left.initialize();
    await right.join({ code: left.createInvite().code });
    const leftId = left.getOverview().localDeviceId;
    const rightId = right.getOverview().localDeviceId;
    left.updatePermissions({ deviceId: rightId, permissions: { 'file.receive': true } });
    right.updatePermissions({ deviceId: leftId, permissions: { 'file.receive': true } });

    let leftManager;
    let rightManager;
    let connected = true;
    let deliveredChunks = 0;
    const leftTransfer = new TransferService({
      databasePath: path.join(leftDir, 'mesh.db'),
      spoolRoot: path.join(leftDir, 'spool'),
      meshService: left,
      peerManagerProvider: () => leftManager,
      now
    });
    const rightTransfer = new TransferService({
      databasePath: path.join(rightDir, 'mesh.db'),
      spoolRoot: path.join(rightDir, 'spool'),
      meshService: right,
      peerManagerProvider: () => rightManager,
      now
    });
    leftManager = {
      listConnections: () => connected ? [{ deviceId: rightId, authenticated: true }] : [],
      sendSemantic: async (_deviceId, messageType, _capability, payload) => {
        if (!connected) throw new Error('peer-not-connected');
        const result = await rightTransfer.handleEnvelope({
          context: { peer: right.getPeerContext(leftId) },
          envelope: { messageType, payload }
        });
        if (messageType === 'file.chunk') {
          deliveredChunks += 1;
          if (deliveredChunks === 1) connected = false;
        }
        return result;
      }
    };
    rightManager = fakeManager(() => connected, leftId, async (messageType, payload) => leftTransfer.handleEnvelope({
      context: { peer: left.getPeerContext(rightId) },
      envelope: { messageType, payload }
    }));

    const offered = await leftTransfer.createFileTransfer({ targetDeviceId: rightId, filePaths: [sourcePath] });
    assert.equal(offered.state, 'awaiting-accept');
    assert.equal(offered.files[0].name, 'report.txt');
    const incoming = rightTransfer.list().find((job) => job.type === 'file' && job.direction === 'incoming');
    assert.equal(incoming.acceptRequired, true);
    await rightTransfer.acceptFileTransfer(incoming.transferId, destination);
    await waitUntil(() => leftTransfer.list().find((job) => job.transferId === offered.transferId)?.state === 'failed');
    assert.equal(rightTransfer.list().find((job) => job.transferId === offered.transferId).bytesTransferred, 96 * 1024);
    connected = true;
    await leftTransfer.dispatch(offered.transferId);
    await waitUntil(() => (
      leftTransfer.list().find((job) => job.transferId === offered.transferId)?.state === 'completed'
      && rightTransfer.list().find((job) => job.transferId === offered.transferId)?.state === 'completed'
    ), 8_000, () => ({ left: leftTransfer.list(), right: rightTransfer.list() }));

    const savedPath = path.join(destination, 'report (2).txt');
    assert.deepEqual(fs.readFileSync(savedPath), content);
    assert.equal(fs.readFileSync(path.join(destination, 'report.txt'), 'utf8'), 'existing');
    assert.equal(fs.existsSync(path.join(leftDir, 'spool', 'outgoing')), true);
    await waitUntil(() => fs.readdirSync(path.join(leftDir, 'spool', 'outgoing')).length === 0);
    assert.equal(fs.readdirSync(path.join(leftDir, 'spool', 'outgoing')).length, 0);

    const store = new MeshStore(path.join(leftDir, 'mesh.db'));
    const raw = store.readTransferJob(offered.transferId);
    store.close();
    assert.doesNotMatch(JSON.stringify(raw.encryptedPayload), /report\.txt|mesh-file-content/);
    const localStateText = fs.readFileSync(path.join(
      rightDir,
      'spool',
      'incoming',
      require('node:crypto').createHash('sha256').update(offered.transferId).digest('hex').slice(0, 32),
      'state.json'
    ), 'utf8');
    assert.doesNotMatch(localStateText, /destination|report\.txt/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function waitUntil(predicate, timeoutMs = 8_000, diagnostic = () => null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`file-transfer-test-timeout:${JSON.stringify(diagnostic())}`);
}

function service(directory, hostname, profileId, platform, now, extra = {}) {
  const profile = {
    id: profileId,
    appId: 'codex',
    name: 'Work Agent',
    identityFingerprint: 'same-account',
    profilePathMode: 'managed',
    sessionRootMode: 'managed'
  };
  return new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'keys.json'), fakeProtector()),
    profilesProvider: () => [profile],
    sessionsProvider: () => [{
      id: 'thread-shared',
      adapterConversationKey: 'thread-shared',
      appId: 'codex',
      title: 'Work',
      createdAt: now(),
      updatedAt: now(),
      projectPath: '/projects/AgentDesk',
      filePath: '/sessions/thread-shared.jsonl',
      source: 'Codex'
    }],
    appVersion: '0.9.1', platform, arch: 'test', osVersion: 'test', hostname, now,
    ...extra
  });
}

function fakeManager(isConnected, deviceId, deliver) {
  return {
    listConnections: () => isConnected() ? [{ deviceId, authenticated: true }] : [],
    sendSemantic: async (_deviceId, messageType, _capability, payload) => deliver(messageType, payload)
  };
}

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}
