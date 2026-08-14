const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const {
  TASK_PACKAGE_TRANSFER_FEATURE,
  TASK_PACKAGE_TRANSFER_MAX_FUTURE_SKEW_MS,
  TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM,
  createTaskPackageTransferManifest,
  normalizeTaskPackageTransferManifest,
  sealTaskPackageUnlockCode,
  openTaskPackageUnlockCode
} = require('../src/mesh/domain/task-package-transfer');
const { canonicalEncode } = require('../src/mesh/domain/identity-link');

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

const BASE_NOW = '2026-08-14T00:00:00.000Z';
const SHARED_MESH_LINK_KEY = Buffer.alloc(32, 9).toString('base64');
const TARGET_DEVICE = createEd25519Identity();
const THIRD_DEVICE = createEd25519Identity();
const SOURCE_DEVICE = createEd25519Identity();

const BASE_CONTEXT = {
  meshId: 'mesh-a',
  transferId: 'transfer-a',
  sourceDeviceId: 'device-a',
  targetDeviceId: 'device-b'
};

function manifest(overrides = {}) {
  return createTaskPackageTransferManifest({
    transferId: BASE_CONTEXT.transferId,
    packageId: 'package-a',
    packageHash: 'a'.repeat(64),
    fileName: '../handoff',
    bytesTotal: 4096,
    summary: {
      title: '继续实现 TaskPackage',
      appId: '  codex  ',
      sourceAgentName: 'Research Agent',
      senderLabel: 'hupo',
      objective: '把既有任务、会话和代码检查点交给目标设备继续。',
      sessionMode: 'native',
      attachmentCount: 2
    },
    ...overrides
  }, { now: BASE_NOW });
}

function sealContext(overrides = {}) {
  return {
    ...BASE_CONTEXT,
    targetDevicePublicKey: TARGET_DEVICE.publicKey,
    // A third paired device can know this Mesh-wide key. The envelope must not
    // derive from it or otherwise make it sufficient to decrypt the code.
    linkKey: SHARED_MESH_LINK_KEY,
    ...overrides
  };
}

function openContext(overrides = {}) {
  return {
    ...BASE_CONTEXT,
    targetDevicePrivateKey: TARGET_DEVICE.privateKey,
    linkKey: SHARED_MESH_LINK_KEY,
    now: BASE_NOW,
    ...overrides
  };
}

function createEd25519Identity() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function mutateBase64Url(value) {
  const bytes = Buffer.from(value, 'base64url');
  bytes[0] ^= 1;
  return bytes.toString('base64url');
}

function decryptEnvelopeBytesWithEd25519PrivateKey(envelope, privateKey) {
  const edDer = crypto.createPrivateKey(privateKey).export({ type: 'pkcs8', format: 'der' });
  const seed = Buffer.from(edDer.subarray(-32));
  const digest = crypto.createHash('sha512').update(seed).digest();
  const scalar = Buffer.from(digest.subarray(0, 32));
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  const x25519PrivateDer = Buffer.concat([X25519_PKCS8_PREFIX, scalar]);
  const ephemeralRaw = Buffer.from(envelope.ephemeralPublicKey, 'base64url');
  const sharedSecret = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey({ key: x25519PrivateDer, type: 'pkcs8', format: 'der' }),
    publicKey: crypto.createPublicKey({
      key: Buffer.concat([X25519_SPKI_PREFIX, ephemeralRaw]),
      type: 'spki',
      format: 'der'
    })
  });
  const authenticatedData = Buffer.from(canonicalEncode({
    schemaVersion: envelope.schemaVersion,
    algorithm: envelope.algorithm,
    metadata: envelope.metadata
  }), 'utf8');
  const salt = crypto.createHash('sha256').update(authenticatedData).digest();
  const key = Buffer.from(crypto.hkdfSync(
    'sha256',
    sharedSecret,
    salt,
    Buffer.from('agentdesk-task-package-unlock-envelope-v1'),
    32
  ));
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAAD(authenticatedData);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final()
    ]);
  } finally {
    key.fill(0);
    salt.fill(0);
    sharedSecret.fill(0);
    x25519PrivateDer.fill(0);
    scalar.fill(0);
    digest.fill(0);
    seed.fill(0);
    edDer.fill(0);
  }
}

test('TaskPackage 直送 manifest 有界、保留 appId，并拒绝超出时钟容差的未来 createdAt', () => {
  const value = manifest();
  assert.equal(TASK_PACKAGE_TRANSFER_FEATURE, 'task.package.transfer.v1');
  assert.equal(TASK_PACKAGE_TRANSFER_MAX_FUTURE_SKEW_MS, 5 * 60_000);
  assert.equal(value.fileName, 'handoff.agentdesk-task');
  assert.equal(value.summary.appId, 'codex');
  assert.equal(value.summary.attachmentCount, 2);
  assert.equal(normalizeTaskPackageTransferManifest(value, { now: BASE_NOW }).packageHash, 'a'.repeat(64));
  assert.equal(normalizeTaskPackageTransferManifest({
    ...value,
    summary: { ...value.summary, appId: 'x'.repeat(81) }
  }, { now: BASE_NOW }).summary.appId.length, 80);
  assert.equal(normalizeTaskPackageTransferManifest({
    ...value,
    summary: { ...value.summary, appId: null }
  }, { now: BASE_NOW }).summary.appId, null);
  assert.throws(() => manifest({ packageHash: 'bad' }), /packageHash/);
  assert.throws(() => manifest({ expiresAt: '2026-08-16T00:00:00.000Z' }), /expiry/);

  const atSkewBoundary = {
    ...value,
    createdAt: '2026-08-14T00:05:00.000Z'
  };
  assert.equal(
    normalizeTaskPackageTransferManifest(atSkewBoundary, { now: BASE_NOW }).createdAt,
    atSkewBoundary.createdAt
  );
  assert.throws(() => normalizeTaskPackageTransferManifest({
    ...value,
    createdAt: '2026-08-14T00:05:00.001Z'
  }, { now: BASE_NOW }), /task-package-transfer-future/);
});

test('解锁码 envelope 只允许目标 Ed25519 私钥解封，不依赖 Mesh 共享 linkKey', () => {
  const value = manifest();
  const unlockCode = 'ABCDE-FGHJK-MNPQR-STUVW';
  const normalizedUnlockCode = unlockCode.replaceAll('-', '');
  const envelope = sealTaskPackageUnlockCode({
    packageId: value.packageId,
    packageHash: value.packageHash,
    unlockCode
  }, sealContext());

  assert.equal(envelope.algorithm, TASK_PACKAGE_UNLOCK_ENVELOPE_ALGORITHM);
  assert.equal(Buffer.from(envelope.ephemeralPublicKey, 'base64url').length, 32);
  assert.equal(Buffer.from(envelope.ciphertext, 'base64url').length, 65);
  assert.doesNotMatch(JSON.stringify(envelope), /ABCDE|FGHJK|MNPQR|STUVW/);
  assert.equal(openTaskPackageUnlockCode(envelope, value, openContext()), normalizedUnlockCode);

  const targetPlaintext = decryptEnvelopeBytesWithEd25519PrivateKey(envelope, TARGET_DEVICE.privateKey);
  try {
    assert.equal(
      targetPlaintext.subarray(1, 1 + targetPlaintext[0]).toString('ascii'),
      normalizedUnlockCode
    );
  } finally {
    targetPlaintext.fill(0);
  }

  // Compatibility alias used by the Main key vault still identifies the same
  // target-only private key; targetDevicePrivateKey remains the preferred API.
  assert.equal(openTaskPackageUnlockCode(envelope, value, {
    ...openContext(),
    targetDevicePrivateKey: undefined,
    devicePrivateKey: TARGET_DEVICE.privateKey
  }), normalizedUnlockCode);

  assert.throws(() => openTaskPackageUnlockCode(envelope, value, {
    ...openContext(),
    targetDevicePrivateKey: THIRD_DEVICE.privateKey,
    // The attacker is another valid device in the same Mesh and therefore has
    // the exact same identity link key. It still cannot derive the envelope key.
    linkKey: SHARED_MESH_LINK_KEY
  }), /task-package-unlock-decrypt/);
  assert.throws(() => decryptEnvelopeBytesWithEd25519PrivateKey(
    envelope,
    THIRD_DEVICE.privateKey
  ));
  assert.throws(() => sealTaskPackageUnlockCode({
    packageId: value.packageId,
    packageHash: value.packageHash,
    unlockCode
  }, {
    ...sealContext(),
    targetDevicePublicKey: SOURCE_DEVICE.privateKey
  }), /task-package-target-public-key/);
});

test('envelope 认证绑定 Mesh、来源、目标、transfer、packageId、包哈希与目标公钥', () => {
  const value = manifest();
  const envelope = sealTaskPackageUnlockCode({
    packageId: value.packageId,
    packageHash: value.packageHash,
    unlockCode: 'ABCDE-FGHJK-MNPQR-STUVW'
  }, sealContext());

  for (const changedContext of [
    { meshId: 'mesh-b' },
    { transferId: 'transfer-b' },
    { sourceDeviceId: 'device-c' },
    { targetDeviceId: 'device-c' }
  ]) {
    assert.throws(() => openTaskPackageUnlockCode(envelope, value, openContext(changedContext)), /decrypt/);
  }
  assert.throws(() => openTaskPackageUnlockCode(envelope, {
    ...value,
    packageHash: 'b'.repeat(64)
  }, openContext()), /decrypt/);
  assert.throws(() => openTaskPackageUnlockCode(envelope, {
    ...value,
    packageId: 'package-b'
  }, openContext()), /decrypt/);

  const envelopeForWrongTargetKey = sealTaskPackageUnlockCode({
    packageId: value.packageId,
    packageHash: value.packageHash,
    unlockCode: 'ABCDE-FGHJK-MNPQR-STUVW'
  }, sealContext({ targetDevicePublicKey: THIRD_DEVICE.publicKey }));
  assert.throws(() => openTaskPackageUnlockCode(
    envelopeForWrongTargetKey,
    value,
    openContext()
  ), /decrypt/);
});

test('envelope 严格拒绝未知字段、非规范编码与任一密文组件篡改', () => {
  const value = manifest();
  const envelope = sealTaskPackageUnlockCode({
    packageId: value.packageId,
    packageHash: value.packageHash,
    unlockCode: 'ABCDE-FGHJK-MNPQR-STUVW'
  }, sealContext());

  const attacks = [
    { ...envelope, unexpected: true },
    { ...envelope, metadata: { ...envelope.metadata, unexpected: true } },
    { ...envelope, ephemeralPublicKey: `${envelope.ephemeralPublicKey}=` },
    { ...envelope, ephemeralPublicKey: mutateBase64Url(envelope.ephemeralPublicKey) },
    { ...envelope, iv: mutateBase64Url(envelope.iv) },
    { ...envelope, ciphertext: mutateBase64Url(envelope.ciphertext) },
    { ...envelope, tag: mutateBase64Url(envelope.tag) },
    { ...envelope, algorithm: 'x25519-aes-256-gcm' },
    { ...envelope, schemaVersion: 2 },
    {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        targetKeyFingerprint: 'f'.repeat(64)
      }
    }
  ];

  for (const attack of attacks) {
    assert.throws(() => openTaskPackageUnlockCode(attack, value, openContext()), /task-package-unlock-decrypt/);
  }
});
