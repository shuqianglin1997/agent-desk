const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SignalingGateway } = require('../services/signaling/server');
const { createEnvelope } = require('../src/mesh/protocol/envelope');
const { createSignalingRequest, verifySignalingRequest } = require('../src/mesh/protocol/signaling-auth');
const {
  SignalingClient,
  claimPairingViaSignaling,
  postJson,
  publicServiceName
} = require('../src/mesh/network/signaling-client');
const { staticIceServers, mergeIceServers, publicIceDiagnostics } = require('../src/mesh/network/ice-config');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshService } = require('../src/mesh/main/mesh-service');

test('信令签名绑定请求内容、操作与短有效期', () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const now = '2026-08-10T10:00:00.000Z';
  const request = createSignalingRequest('lease', {
    deviceId: 'device-a',
    devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' })
  }, keys.privateKey, { now, requestId: 'request-a', nonce: 'nonce-a', ttlMs: 30_000 });
  assert.equal(verifySignalingRequest(request, keys.publicKey, { operation: 'lease', now }).ok, true);
  assert.equal(verifySignalingRequest({ ...request, deviceId: 'device-b' }, keys.publicKey, { now }).reason, 'signaling-signature');
  assert.equal(verifySignalingRequest(request, keys.publicKey, { operation: 'poll', now }).reason, 'signaling-operation-mismatch');
  assert.equal(verifySignalingRequest(request, keys.publicKey, { now: '2026-08-10T10:01:00.000Z' }).reason, 'signaling-request-expired');
});

test('两个设备经最小信令网关交换签名 WebRTC offer/answer，并取得短期 TURN 凭据', async () => {
  const gateway = new SignalingGateway({
    host: '127.0.0.1',
    port: 0,
    pollTimeoutMs: 1_000,
    turnSecret: 'turn-rest-secret',
    turnUrls: ['turn:relay.example.test:3478?transport=udp', 'turns:relay.example.test:5349?transport=tcp']
  });
  const leftKeys = crypto.generateKeyPairSync('ed25519');
  const rightKeys = crypto.generateKeyPairSync('ed25519');
  const publicKey = (keys) => keys.publicKey.export({ type: 'spki', format: 'pem' });
  let left;
  let right;
  try {
    const serviceUrl = await gateway.start();
    left = new SignalingClient({
      serviceUrls: [serviceUrl],
      allowInsecure: true,
      identityProvider: () => ({
        local: { deviceId: 'device-left', devicePublicKey: publicKey(leftKeys) },
        secrets: { devicePrivateKey: leftKeys.privateKey }
      })
    });
    right = new SignalingClient({
      serviceUrls: [serviceUrl],
      allowInsecure: true,
      identityProvider: () => ({
        local: { deviceId: 'device-right', devicePublicKey: publicKey(rightKeys) },
        secrets: { devicePrivateKey: rightKeys.privateKey }
      }),
      onPeerSignal: async (offer) => createEnvelope({
        messageType: 'webrtc.answer',
        connectionId: offer.connectionId,
        sourceDeviceId: 'device-right',
        targetDeviceId: 'device-left',
        sequence: 1,
        capability: 'inventory.read',
        payload: { description: { type: 'answer', sdp: 'test-answer' } }
      }, rightKeys.privateKey)
    });
    await Promise.all([left.start(), right.start()]);
    const offer = createEnvelope({
      messageType: 'webrtc.offer',
      connectionId: 'connection-a',
      sourceDeviceId: 'device-left',
      targetDeviceId: 'device-right',
      sequence: 1,
      capability: 'inventory.read',
      payload: { description: { type: 'offer', sdp: 'test-offer' } }
    }, leftKeys.privateKey);
    const result = await left.requestPeerSignal({
      deviceId: 'device-right',
      signalUrls: [serviceUrl]
    }, offer);
    assert.equal(result.path, 'signaling');
    assert.equal(result.responseEnvelope.messageType, 'webrtc.answer');
    assert.equal(result.responseEnvelope.connectionId, 'connection-a');
    assert.equal(left.publicStatus().state, 'online');
    assert.equal(left.iceServers()[0].credential.length > 10, true);
    assert.equal(left.publicStatus().turnCredentialSource, 'signaling');
  } finally {
    await Promise.allSettled([left?.stop(), right?.stop()]);
    await gateway.stop();
  }
});

test('信令网关拒绝同一已签名请求重放', async () => {
  const gateway = new SignalingGateway({ host: '127.0.0.1', port: 0 });
  const keys = crypto.generateKeyPairSync('ed25519');
  try {
    const serviceUrl = await gateway.start();
    const request = createSignalingRequest('lease', {
      deviceId: 'device-replay',
      devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' })
    }, keys.privateKey, { requestId: 'same-request', nonce: 'same-nonce' });
    const first = await postJson(fetch, serviceUrl, '/v1/lease', request, 5_000);
    assert.ok(first.lease.expiresAt);
    await assert.rejects(
      () => postJson(fetch, serviceUrl, '/v1/lease', request, 5_000),
      /signaling-request-replay/
    );
  } finally {
    await gateway.stop();
  }
});

test('信令回复只走收到消息的共同服务，不采纳对端提供的任意回复地址', async () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const serviceUrl = 'https://signal.example.test';
  const requestedUrls = [];
  const client = new SignalingClient({
    serviceUrls: [serviceUrl],
    identityProvider: () => ({
      local: {
        deviceId: 'device-right',
        devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' })
      },
      secrets: { devicePrivateKey: keys.privateKey }
    }),
    fetch: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, accepted: true })
      };
    },
    onPeerSignal: async (offer) => createEnvelope({
      messageType: 'webrtc.answer',
      connectionId: offer.connectionId,
      sourceDeviceId: 'device-right',
      targetDeviceId: 'device-left',
      sequence: 1,
      capability: 'inventory.read',
      payload: { description: { type: 'answer', sdp: 'answer' } }
    }, keys.privateKey)
  });
  await client.handleMessage(serviceUrl, {
    kind: 'peer.offer',
    sourceDeviceId: 'device-left',
    targetDeviceId: 'device-right',
    correlationId: 'connection-safe-route',
    replyUrls: ['http://127.0.0.1:1', 'https://attacker.example.test'],
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    payload: {
      messageType: 'webrtc.offer',
      connectionId: 'connection-safe-route'
    }
  });
  assert.deepEqual(requestedUrls, [`${serviceUrl}/v1/signal/send`]);
  assert.equal(publicServiceName('https://203.0.113.9:8443'), 'ip-address');
});

test('不在同一局域网的加入端可经邀请码内的信令地址完成端到端加密配对', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-signal-pairing-'));
  const gateway = new SignalingGateway({ host: '127.0.0.1', port: 0, pollTimeoutMs: 1_000 });
  let hostClient;
  try {
    const serviceUrl = await gateway.start();
    const host = meshService(path.join(directory, 'host'), {
      hostname: 'Host.local',
      signalingProvider: () => [serviceUrl]
    });
    host.initialize();
    hostClient = new SignalingClient({
      serviceUrls: [serviceUrl],
      allowInsecure: true,
      identityProvider: () => host.getSignalingContext(),
      onPairClaim: (body) => host.claimInvite(body)
    });
    await hostClient.start();
    const invitation = host.createInvite();
    assert.equal(invitation.endpoints.length, 0);
    assert.equal(invitation.signalServiceCount, 1);

    const joiner = meshService(path.join(directory, 'joiner'), {
      hostname: 'Joiner.local',
      signalingProvider: () => [],
      pairingTransport: (invite, request, identity) => claimPairingViaSignaling(
        invite,
        request,
        identity,
        { allowInsecure: true }
      )
    });
    const joined = await joiner.join({ code: invitation.code, deviceName: 'Remote computer' });
    assert.equal(joined.devices.length, 2);
    assert.equal(joined.devices.find((item) => item.isLocal).signalServiceCount, 1);
    assert.equal(host.getOverview().devices.find((item) => !item.isLocal).signalServiceCount, 1);
  } finally {
    await hostClient?.stop();
    await gateway.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ICE 配置只在 TURN 用户名和凭据完整时启用中继，公开诊断不含凭据', () => {
  const missing = staticIceServers({
    AGENTDESK_STUN_URLS: 'stun:stun.example.test:3478',
    AGENTDESK_TURN_URLS: 'turn:relay.example.test:3478',
    AGENTDESK_TURN_USERNAME: 'user'
  });
  assert.equal(missing.length, 1);
  const merged = mergeIceServers(missing, [{
    urls: ['turn:relay.example.test:3478?transport=tcp'],
    username: 'temporary',
    credential: 'secret'
  }]);
  const diagnostics = publicIceDiagnostics(merged, {
    source: 'signaling',
    expiresAt: '2026-08-10T11:00:00.000Z'
  });
  assert.equal(diagnostics.stunConfigured, true);
  assert.equal(diagnostics.turnConfigured, true);
  assert.equal(diagnostics.turnCredentialSource, 'signaling');
  assert.equal(JSON.stringify(diagnostics).includes('secret'), false);
  assert.equal(JSON.stringify(diagnostics).includes('temporary'), false);
});

function meshService(directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  return new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'keys.json'), fakeProtector()),
    profilesProvider: () => [],
    sessionCountProvider: () => 0,
    appVersion: '0.9.1',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test',
    ...options
  });
}

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}
