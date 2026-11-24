const crypto = require('node:crypto');
const fs = require('node:fs');
const { readJsonStore, writeJsonStore } = require('../../json-store');

const KEY_STORE_VERSION = 2;

function createIdentityBundle() {
  const root = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const device = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return {
    rootPublicKey: root.publicKey,
    rootPrivateKey: root.privateKey,
    devicePublicKey: device.publicKey,
    devicePrivateKey: device.privateKey,
    identityLinkKey: crypto.randomBytes(32).toString('base64'),
    identityLinkKeyVersion: 1
  };
}

function createDeviceIdentityBundle() {
  const device = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return {
    rootPrivateKey: null,
    devicePublicKey: device.publicKey,
    devicePrivateKey: device.privateKey,
    identityLinkKey: null,
    identityLinkKeyVersion: 1
  };
}

// The keys are decrypted once per run (docs/ARCHITECTURE_PLAN.md §5.9): Main
// is the key store's only writer, so the decrypted copy is kept until this
// vault creates or removes the store. A failed load is never kept, and an
// unavailable key protection still refuses every load.
class EncryptedKeyVault {
  constructor(filePath, protector) {
    this.filePath = filePath;
    this.protector = protector;
    this.decrypted = null;
  }

  isAvailable() {
    return Boolean(this.protector && this.protector.isAvailable());
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  create(bundle = createIdentityBundle()) {
    if (!this.isAvailable()) throw new Error('os-key-protection-unavailable');
    this.decrypted = null;
    if (this.exists()) throw new Error('mesh-key-store-already-exists');
    const payload = {
      version: KEY_STORE_VERSION,
      rootPrivateKey: bundle.rootPrivateKey ? this.encrypt(bundle.rootPrivateKey) : null,
      devicePrivateKey: this.encrypt(bundle.devicePrivateKey),
      identityLinkKey: this.encrypt(bundle.identityLinkKey),
      identityLinkKeyVersion: bundle.identityLinkKeyVersion
    };
    writeJsonStore(this.filePath, payload, { skipBackup: true });
    try { fs.chmodSync(this.filePath, 0o600); } catch (_error) { /* best effort on Windows */ }
    return bundle;
  }

  load() {
    if (!this.isAvailable()) throw new Error('os-key-protection-unavailable');
    if (this.decrypted) return { ...this.decrypted };
    const loaded = readJsonStore(this.filePath, (value) => (
      value && (value.version === 1 || value.version === KEY_STORE_VERSION)
      && (typeof value.rootPrivateKey === 'string' || value.rootPrivateKey === null)
      && typeof value.devicePrivateKey === 'string'
      && typeof value.identityLinkKey === 'string'
    ));
    if (!loaded) throw new Error('mesh-key-store-unreadable');
    this.decrypted = Object.freeze({
      rootPrivateKey: loaded.parsed.rootPrivateKey ? this.decrypt(loaded.parsed.rootPrivateKey) : null,
      devicePrivateKey: this.decrypt(loaded.parsed.devicePrivateKey),
      identityLinkKey: this.decrypt(loaded.parsed.identityLinkKey),
      identityLinkKeyVersion: Number(loaded.parsed.identityLinkKeyVersion) || 1
    });
    return { ...this.decrypted };
  }


  createJoined(bundle) {
    if (!bundle || !bundle.devicePrivateKey || !bundle.identityLinkKey) {
      throw new TypeError('joined key bundle is incomplete');
    }
    return this.create({ ...bundle, rootPrivateKey: null });
  }

  remove() {
    this.decrypted = null;
    removeFile(this.filePath);
    removeFile(`${this.filePath}.bak`);
  }

  encrypt(value) {
    return this.protector.encryptString(String(value)).toString('base64');
  }

  decrypt(value) {
    return this.protector.decryptString(Buffer.from(value, 'base64'));
  }
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  KEY_STORE_VERSION,
  createIdentityBundle,
  createDeviceIdentityBundle,
  EncryptedKeyVault
};
