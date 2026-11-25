// The Mesh keys are decrypted once per run (docs/ARCHITECTURE_PLAN.md §5.9):
// the system keychain is asked again only after this vault creates or removes
// the key store; a failed load is never kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { makeTempDir } = require('./helpers/temp');

function countingProtector() {
  const counts = { decrypt: 0 };
  let available = true;
  return {
    counts,
    setAvailable: (value) => { available = value; },
    isAvailable: () => available,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => {
      counts.decrypt += 1;
      return Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString();
    }
  };
}

test('keys are decrypted once, handed out as copies, and read again only after this vault changes them', (t) => {
  const directory = makeTempDir('agentdesk-key-vault-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const protector = countingProtector();
  const vault = new EncryptedKeyVault(path.join(directory, 'mesh-keys.json'), protector);
  const created = vault.create();
  const first = vault.load();
  assert.equal(first.devicePrivateKey, created.devicePrivateKey);
  const decrypts = protector.counts.decrypt;
  assert.equal(decrypts, 3, 'root, device and link keys');
  first.devicePrivateKey = 'changed by a caller';
  for (let index = 0; index < 5; index += 1) assert.equal(vault.load().devicePrivateKey, created.devicePrivateKey);
  assert.equal(protector.counts.decrypt, decrypts, 'no more keychain calls');
  vault.remove();
  assert.throws(() => vault.load(), /mesh-key-store-unreadable/);
  const joined = vault.createJoined({ devicePrivateKey: 'device-2', identityLinkKey: 'link-2', identityLinkKeyVersion: 2 });
  assert.equal(vault.load().devicePrivateKey, joined.devicePrivateKey, 'a new store is read again');
  assert.equal(protector.counts.decrypt, decrypts + 2);
});

test('a keychain that is unavailable is asked again next time', (t) => {
  const directory = makeTempDir('agentdesk-key-vault-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const protector = countingProtector();
  const vault = new EncryptedKeyVault(path.join(directory, 'mesh-keys.json'), protector);
  vault.create();
  protector.setAvailable(false);
  assert.throws(() => vault.load(), /os-key-protection-unavailable/);
  protector.setAvailable(true);
  assert.equal(typeof vault.load().identityLinkKey, 'string');
  protector.setAvailable(false);
  assert.throws(() => vault.load(), /os-key-protection-unavailable/, 'key protection going away still refuses');
});
