const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { MeshService } = require('../main/mesh-service');
const { PeerManager } = require('../main/peer-manager');
const { TransferService } = require('../main/transfer-service');
const { RemoteControlService } = require('../main/remote-control-service');
const { verifyEnvelope } = require('../protocol/envelope');
const { EncryptedKeyVault } = require('../storage/secure-keys');
const { SignalingClient, claimPairingViaSignaling } = require('../network/signaling-client');
const { SignalingGateway } = require('../../../services/signaling/server');

app.whenReady().then(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-peer-e2e-'));
  let leftManager = null;
  let rightManager = null;
  let leftRemote = null;
  let rightRemote = null;
  let leftSignal = null;
  let rightSignal = null;
  let signalingGateway = null;
  try {
    const useSignaling = process.env.AGENTDESK_E2E_SIGNALING === '1';
    let signalUrl = null;
    if (useSignaling) {
      signalingGateway = new SignalingGateway({ host: '127.0.0.1', port: 0, pollTimeoutMs: 1_000 });
      signalUrl = await signalingGateway.start();
    }
    const signalOptions = signalUrl ? { signalingProvider: () => [signalUrl] } : {};
    const left = endpoint(path.join(directory, 'left'), 'Left Mac', 'left-slot', 'darwin', 41001, signalOptions);
    let right;
    left.service.initialize();
    if (useSignaling) {
      leftSignal = signalClient(signalUrl, left.service, {
        onPairClaim: (body) => left.service.claimInvite(body),
        onPeerSignal: (envelope) => leftManager.receiveSignal(envelope)
      });
      await leftSignal.start();
    }
    right = endpoint(path.join(directory, 'right'), 'Right PC', 'right-slot', 'win32', 41002, {
      ...signalOptions,
      pairingTransport: useSignaling
        ? (invite, request, identity) => claimPairingViaSignaling(invite, request, identity, { allowInsecure: true })
        : async (_invite, request) => left.service.claimInvite({ request })
    });
    await right.service.join({ code: left.service.createInvite().code });
    if (useSignaling) {
      rightSignal = signalClient(signalUrl, right.service, {
        onPeerSignal: (envelope) => rightManager.receiveSignal(envelope)
      });
      await rightSignal.start();
    }
    const leftId = left.service.getOverview().localDeviceId;
    const rightId = right.service.getOverview().localDeviceId;
    left.service.updatePermissions({ deviceId: rightId, permissions: { 'file.receive': true, 'screen.view': true } });
    right.service.updatePermissions({ deviceId: leftId, permissions: { 'file.receive': true, 'screen.view': true } });

    const states = [];
    let leftTransfer;
    let rightTransfer;
    leftTransfer = new TransferService({
      databasePath: left.service.databasePath,
      spoolRoot: path.join(directory, 'left', 'spool'),
      meshService: left.service,
      peerManagerProvider: () => leftManager
    });
    rightTransfer = new TransferService({
      databasePath: right.service.databasePath,
      spoolRoot: path.join(directory, 'right', 'spool'),
      meshService: right.service,
      peerManagerProvider: () => rightManager
    });
    leftManager = new PeerManager({
      BrowserWindow,
      ipcMain,
      peerDirectory: __dirname,
      meshService: left.service,
      sendSignal: useSignaling
        ? (remote, envelope) => leftSignal.requestPeerSignal(remote, envelope)
        : (_remote, envelope) => checkedSignal(right.service, rightManager, envelope),
      onState: (value) => states.push({ side: 'left', ...value }),
      onEnvelope: (value) => String(value?.envelope?.messageType || '').startsWith('remote.view.')
        ? leftRemote.handleEnvelope(value)
        : leftTransfer.handleEnvelope(value)
    });
    rightManager = new PeerManager({
      BrowserWindow,
      ipcMain,
      peerDirectory: __dirname,
      meshService: right.service,
      sendSignal: useSignaling
        ? (remote, envelope) => rightSignal.requestPeerSignal(remote, envelope)
        : (_remote, envelope) => checkedSignal(left.service, leftManager, envelope),
      onState: (value) => states.push({ side: 'right', ...value }),
      onEnvelope: (value) => String(value?.envelope?.messageType || '').startsWith('remote.view.')
        ? rightRemote.handleEnvelope(value)
        : rightTransfer.handleEnvelope(value)
    });
    leftRemote = new RemoteControlService({
      BrowserWindow,
      ipcMain,
      remoteDirectory: path.join(__dirname, '..', '..', 'remote'),
      meshService: left.service,
      peerManagerProvider: () => leftManager,
      languageProvider: () => 'en',
      autoAccept: true,
      syntheticCapture: true
    });
    rightRemote = new RemoteControlService({
      BrowserWindow,
      ipcMain,
      remoteDirectory: path.join(__dirname, '..', '..', 'remote'),
      meshService: right.service,
      peerManagerProvider: () => rightManager,
      languageProvider: () => 'en',
      autoAccept: true,
      syntheticCapture: true
    });

    const connection = await leftManager.connect(rightId);
    await waitUntil(() => {
      const leftRows = left.service.getUnifiedSessions();
      const rightRows = right.service.getUnifiedSessions();
      return leftRows.length === 1
        && rightRows.length === 1
        && leftRows[0].replicas.length === 2
        && rightRows[0].replicas.length === 2;
    }, 15_000);

    const leftRows = left.service.getUnifiedSessions();
    const rightRows = right.service.getUnifiedSessions();
    const pointerJob = await leftTransfer.createSessionPointerTransfer({
      targetDeviceId: rightId,
      selections: [{
        conversationId: leftRows[0].conversationId,
        replicaId: leftRows[0]._replicaId
      }]
    });
    await waitUntil(() => pointerJob.state === 'completed' || (
      leftTransfer.list().find((job) => job.transferId === pointerJob.transferId)?.state === 'completed'
    ), 5_000);
    const receivedPointer = rightTransfer.list().find((job) => (
      job.direction === 'incoming' && job.transferId === pointerJob.transferId
    ));
    if (!receivedPointer?.items?.length) throw new Error('peer-e2e-pointer-missing');
    const sourceFile = path.join(directory, 'selected-file.bin');
    const destination = path.join(directory, 'received');
    const expectedFile = Buffer.alloc(180 * 1024 + 13, 'agentdesk-webrtc-file');
    fs.writeFileSync(sourceFile, expectedFile);
    fs.mkdirSync(destination, { recursive: true });
    const fileJob = await leftTransfer.createFileTransfer({
      targetDeviceId: rightId,
      filePaths: [sourceFile]
    });
    await waitUntil(() => rightTransfer.list().some((job) => (
      job.transferId === fileJob.transferId && job.state === 'received'
    )), 5_000);
    await rightTransfer.acceptFileTransfer(fileJob.transferId, destination);
    await waitUntil(() => (
      leftTransfer.list().find((job) => job.transferId === fileJob.transferId)?.state === 'completed'
      && rightTransfer.list().find((job) => job.transferId === fileJob.transferId)?.state === 'completed'
    ), 10_000);
    const receivedFile = fs.readFileSync(path.join(destination, 'selected-file.bin'));
    if (!receivedFile.equals(expectedFile)) throw new Error('peer-e2e-file-content-mismatch');
    const remoteSession = await leftRemote.openDevice(rightId);
    await waitUntil(() => (
      leftRemote.list().find((item) => item.sessionId === remoteSession.sessionId)?.state === 'viewing'
      && rightRemote.list().find((item) => item.sessionId === remoteSession.sessionId)?.state === 'viewing'
    ), 15_000);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      authenticated: connection.authenticated,
      signalingPath: connection.signalingPath,
      transport: connection.transport,
      leftRows: leftRows.length,
      rightRows: rightRows.length,
      leftReplicas: leftRows[0].replicas.length,
      rightReplicas: rightRows[0].replicas.length,
      authenticatedSides: new Set(states.filter((value) => value.state === 'authenticated').map((value) => value.side)).size,
      inventorySides: new Set(states.filter((value) => value.state === 'inventory-synced').map((value) => value.side)).size,
      pointerState: leftTransfer.list().find((job) => job.transferId === pointerJob.transferId)?.state,
      receivedPointers: receivedPointer.items.length,
      fileState: leftTransfer.list().find((job) => job.transferId === fileJob.transferId)?.state,
      receivedFileBytes: receivedFile.length,
      remoteViewState: leftRemote.list().find((item) => item.sessionId === remoteSession.sessionId)?.state,
      remoteDisplay: leftRemote.list().find((item) => item.sessionId === remoteSession.sessionId)?.displayName
    })}\n`);
    await leftRemote.stopAll('e2e-complete');
    await rightRemote.stopAll('e2e-complete');
    leftManager.disconnectAll('e2e-complete');
    rightManager.disconnectAll('e2e-complete');
    await leftSignal?.stop('e2e-complete');
    await rightSignal?.stop('e2e-complete');
    await signalingGateway?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    await leftRemote?.stopAll('e2e-failed');
    await rightRemote?.stopAll('e2e-failed');
    leftManager?.disconnectAll('e2e-failed');
    rightManager?.disconnectAll('e2e-failed');
    await leftSignal?.stop('e2e-failed');
    await rightSignal?.stop('e2e-failed');
    await signalingGateway?.stop();
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_cleanupError) { /* best effort */ }
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});

function endpoint(directory, hostname, profileId, platform, port, extra = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const now = () => new Date().toISOString();
  const profile = {
    id: profileId,
    appId: 'codex',
    name: 'Shared Work Agent',
    identityFingerprint: 'same-real-account',
    profilePathMode: 'managed',
    sessionRootMode: 'managed'
  };
  const session = {
    id: 'shared-provider-thread',
    adapterConversationKey: 'shared-provider-thread',
    appId: 'codex',
    title: 'Shared conversation',
    createdAt: now(),
    updatedAt: now(),
    projectPath: platform === 'win32' ? 'D:\\Projects\\AgentDesk' : '/Users/me/AgentDesk',
    filePath: platform === 'win32' ? 'D:\\Sessions\\thread.jsonl' : '/Users/me/.codex/thread.jsonl',
    source: 'Codex',
    status: 'available'
  };
  const service = new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'keys.json'), fakeProtector()),
    profilesProvider: () => [profile],
    sessionCountProvider: () => 1,
    sessionsProvider: () => [session],
    appVersion: '0.9.1',
    platform,
    arch: platform === 'win32' ? 'x64' : 'arm64',
    osVersion: 'e2e',
    hostname,
    now,
    endpointProvider: () => [`http://127.0.0.1:${port}`],
    ...extra
  });
  return { service };
}

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}

function signalClient(serviceUrl, service, handlers = {}) {
  return new SignalingClient({
    serviceUrls: [serviceUrl],
    allowInsecure: true,
    identityProvider: () => service.getSignalingContext(),
    onPairClaim: handlers.onPairClaim,
    onPeerSignal: handlers.onPeerSignal
  });
}

async function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('peer-e2e-inventory-timeout');
}

function checkedSignal(service, manager, envelope) {
  const peer = service.getPeerContext(envelope.sourceDeviceId);
  const checked = verifyEnvelope(envelope, peer.remote.devicePublicKey, {
    sourceDeviceId: peer.remote.deviceId,
    targetDeviceId: peer.local.deviceId
  });
  if (!checked.ok) {
    throw new Error(`peer-e2e-signal-${checked.reason}-${Buffer.byteLength(JSON.stringify(envelope))}`);
  }
  return manager.receiveSignal(envelope);
}
