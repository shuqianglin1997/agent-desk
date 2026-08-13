const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const { buildLocalInventory } = require('../src/mesh/domain/inventory');
const { createEnvelope } = require('../src/mesh/protocol/envelope');
const {
  DEFAULT_CHUNK_BYTES,
  MAX_CHUNK_BYTES,
  MAX_CHUNKS,
  MAX_TOTAL_BYTES,
  encodeInventoryChunks,
  InventoryAssembler
} = require('../src/mesh/protocol/inventory');
const { LanEndpoint, sendPeerSignal, normalizeEndpoint } = require('../src/mesh/network/lan-endpoint');

const NOW = '2026-08-10T08:00:00.000Z';
const LINK_KEY = Buffer.alloc(32, 7).toString('base64');
const SAFE_DATA_CHANNEL_ENVELOPE_BYTES = 192 * 1024;

function inventory(sessionCount = 120) {
  const deviceId = 'device-a';
  const profileId = 'slot-a';
  return buildLocalInventory({
    deviceId,
    revision: 9,
    linkKey: LINK_KEY,
    catalog: {
      catalogRevision: 4,
      agents: [{ agentId: 'agent-a', displayName: 'Agent A', lifecycleState: 'active' }],
      accountBindings: [{
        accountBindingId: 'binding-a',
        agentId: 'agent-a',
        providerNamespace: 'codex',
        meshScopedAccountKey: 'strong-account-key'
      }],
      slots: [{
        deviceId,
        profileId,
        agentId: 'agent-a',
        accountBindingId: 'binding-a',
        appId: 'codex',
        assignmentState: 'linked'
      }]
    },
    sessionsByProfile: {
      [profileId]: Array.from({ length: sessionCount }, (_, index) => ({
        id: `thread-${index}`,
        adapterConversationKey: `thread-${index}`,
        title: `Conversation ${index} ${'x'.repeat(300)}`,
        createdAt: NOW,
        updatedAt: NOW,
        projectPath: `/projects/p-${index}`,
        filePath: `/sessions/thread-${index}.jsonl`,
        source: 'Codex'
      }))
    }
  }, { now: NOW });
}

test('库存快照可分块、乱序重组并校验完整摘要', () => {
  const source = inventory();
  const chunks = encodeInventoryChunks(source, { chunkBytes: 32 * 1024, transferId: 'transfer-a' });
  assert.ok(chunks.length > 1);
  const assembler = new InventoryAssembler();
  let result;
  for (const chunk of [...chunks].reverse()) result = assembler.accept(chunk);
  assert.equal(result.complete, true);
  assert.equal(result.inventory.deviceId, source.deviceId);
  assert.equal(result.inventory.revision, source.revision);
  assert.equal(result.inventory.sessions.length, source.sessions.length);
});

test('库存分块拒绝跨传输元数据混入和内容篡改', () => {
  const chunks = encodeInventoryChunks(inventory(), { chunkBytes: 32 * 1024, transferId: 'transfer-b' });
  const assembler = new InventoryAssembler();
  assembler.accept(chunks[0]);
  assert.throws(() => assembler.accept({ ...chunks[1], checksum: 'different' }), /metadata-mismatch/);

  const corrupted = chunks.map((chunk) => ({ ...chunk }));
  corrupted[0].data = `${corrupted[0].data.slice(0, -1)}${corrupted[0].data.endsWith('A') ? 'B' : 'A'}`;
  const second = new InventoryAssembler();
  assert.throws(() => {
    for (const chunk of corrupted) second.accept(chunk);
  }, /inventory-chunk-(checksum|size|payload)/);
});

test('库存块的完整签名信封保留真实 DataChannel 单消息余量', () => {
  const source = inventory(500);
  const chunks = encodeInventoryChunks(source, {
    chunkBytes: 256 * 1024,
    transferId: 'transfer-envelope-budget'
  });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');

  assert.ok(chunks.length > 1);
  assert.ok(Math.ceil(MAX_TOTAL_BYTES / DEFAULT_CHUNK_BYTES) <= MAX_CHUNKS);
  for (const [index, chunk] of chunks.entries()) {
    assert.ok(Buffer.from(chunk.data, 'base64url').length <= MAX_CHUNK_BYTES);
    const envelope = createEnvelope({
      protocolVersion: '1.0',
      messageType: 'inventory.chunk',
      messageId: 'm'.repeat(128),
      connectionId: 'c'.repeat(128),
      sourceDeviceId: 's'.repeat(128),
      targetDeviceId: 't'.repeat(128),
      sequence: index + 1,
      capability: 'inventory.read',
      payload: chunk
    }, privateKey, { now: NOW });
    const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope));
    assert.ok(
      envelopeBytes < SAFE_DATA_CHANNEL_ENVELOPE_BYTES,
      `signed inventory envelope is ${envelopeBytes} bytes`
    );
  }
});

test('局域网信令只向规范 HTTP 端点发送并返回对端响应', async () => {
  let received = null;
  const endpoint = new LanEndpoint({
    host: '127.0.0.1',
    port: 0,
    onSignal: async (value) => {
      received = value;
      return { type: 'answer', accepted: true };
    }
  });
  try {
    const endpoints = await endpoint.start();
    const response = await sendPeerSignal(endpoints, { type: 'offer', nonce: 'n-1' });
    assert.deepEqual(received, { type: 'offer', nonce: 'n-1' });
    assert.deepEqual(response, { type: 'answer', accepted: true });
    assert.equal(normalizeEndpoint(`${endpoints[0]}/`), endpoints[0]);
    assert.throws(() => normalizeEndpoint('file:///tmp/socket'), /protocol/);
    assert.throws(() => normalizeEndpoint(`${endpoints[0]}/hidden`), /path/);
  } finally {
    await endpoint.stop();
  }
});
