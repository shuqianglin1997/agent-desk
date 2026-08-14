const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fuseApi = require('@electron/fuses');
const {
  ASAR_FILE_INTEGRITY_BLOCK_SIZE,
  DISABLED_FUSE_STATE,
  ENABLED_FUSE_STATE,
  assertAsarResourceLayout,
  assertMacAsarIntegrity,
  assertRequiredFuses,
  assertWindowsAsarIntegrity,
  computeAsarHeaderHash,
  loadElectronBuilderDependency,
  parseArguments,
  readWindowsAsarIntegrityResource,
  resolvePackagedLayout,
  verifyAsarFileIntegrity
} = require('../scripts/verify-electron-package-integrity');

function fixture(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-electron-package-test-'));
  try {
    return task(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createFileIntegrity(data) {
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += ASAR_FILE_INTEGRITY_BLOCK_SIZE) {
    blocks.push(sha256(data.subarray(offset, offset + ASAR_FILE_INTEGRITY_BLOCK_SIZE)));
  }
  if (data.length % ASAR_FILE_INTEGRITY_BLOCK_SIZE === 0) blocks.push(sha256(Buffer.alloc(0)));
  return {
    algorithm: 'SHA256',
    hash: sha256(data),
    blockSize: ASAR_FILE_INTEGRITY_BLOCK_SIZE,
    blocks
  };
}

function writeRawAsar(filePath, headerObject = { files: {} }, body = Buffer.alloc(0)) {
  const header = Buffer.from(JSON.stringify(headerObject), 'utf8');
  const headerPayloadBytes = Math.ceil((4 + header.length) / 4) * 4;
  const headerPickleBytes = 4 + headerPayloadBytes;
  const archiveHeader = Buffer.alloc(8 + headerPickleBytes);
  archiveHeader.writeUInt32LE(4, 0);
  archiveHeader.writeUInt32LE(headerPickleBytes, 4);
  archiveHeader.writeUInt32LE(headerPayloadBytes, 8);
  archiveHeader.writeUInt32LE(header.length, 12);
  header.copy(archiveHeader, 16);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([archiveHeader, body]));
  return {
    contentOffset: archiveHeader.length,
    hash: sha256(header)
  };
}

function writeAsar(filePath, entries) {
  const header = { files: {} };
  const packed = [];
  let packedOffset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const segments = entry.path.split('/');
    let directory = header;
    for (const segment of segments.slice(0, -1)) {
      directory.files[segment] ||= { files: {} };
      directory = directory.files[segment];
    }
    const node = { size: data.length };
    if (entry.unpacked) {
      node.unpacked = true;
      const unpackedPath = path.join(`${filePath}.unpacked`, ...segments);
      fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
      fs.writeFileSync(unpackedPath, data);
    } else {
      node.offset = String(packedOffset);
      packedOffset += data.length;
      packed.push(data);
    }
    if (entry.includeIntegrity !== false) {
      node.integrity = createFileIntegrity(data);
      if (entry.mutateIntegrity) entry.mutateIntegrity(node.integrity);
    }
    directory.files[segments.at(-1)] = node;
  }
  return writeRawAsar(filePath, header, Buffer.concat(packed));
}

function writeWindowsIntegrityExecutable(filePath, integrityList) {
  const resedit = loadElectronBuilderDependency('resedit');
  const executable = resedit.NtExecutable.createEmpty(false, false);
  const resources = resedit.NtExecutableResource.from(executable);
  resources.entries.push({
    type: 'INTEGRITY',
    id: 'ELECTRONASAR',
    bin: Buffer.from(JSON.stringify(integrityList)),
    lang: 1033,
    codepage: 1200
  });
  resources.outputResource(executable);
  fs.writeFileSync(filePath, Buffer.from(executable.generate()));
  return resedit;
}

test('CLI accepts exactly one explicit packaged artifact', () => {
  assert.deepEqual(
    parseArguments(['--artifact', './release/mac-arm64/AgentDesk.app']),
    { artifact: path.resolve('./release/mac-arm64/AgentDesk.app') }
  );
  assert.throws(() => parseArguments([]), /--artifact is required/);
  assert.throws(() => parseArguments(['--artifact']), /exactly once/);
  assert.throws(() => parseArguments(['--unknown']), /Unknown argument/);
});

test('layout resolver accepts only AgentDesk.app and win-unpacked package roots', () => fixture((root) => {
  const macApp = path.join(root, 'AgentDesk.app');
  touch(path.join(macApp, 'Contents', 'MacOS', 'AgentDesk'));
  touch(path.join(macApp, 'Contents', 'Info.plist'));
  const mac = resolvePackagedLayout(macApp);
  assert.equal(mac.platform, 'darwin');
  assert.equal(mac.executablePath, path.join(mac.artifactPath, 'Contents', 'MacOS', 'AgentDesk'));

  const winUnpacked = path.join(root, 'win-unpacked');
  touch(path.join(winUnpacked, 'AgentDesk.exe'));
  const windows = resolvePackagedLayout(winUnpacked);
  assert.equal(windows.platform, 'win32');
  assert.equal(windows.resourcesPath, path.join(windows.artifactPath, 'resources'));

  const arbitrary = path.join(root, 'windows-output');
  touch(path.join(arbitrary, 'AgentDesk.exe'));
  assert.throws(() => resolvePackagedLayout(arbitrary), /final win-unpacked directory/);
}));

test('resource gate requires app.asar and rejects default_app.asar', () => fixture((root) => {
  assert.throws(() => assertAsarResourceLayout(root), /app\.asar is missing/);
  const appAsarPath = path.join(root, 'app.asar');
  touch(appAsarPath);
  assert.equal(assertAsarResourceLayout(root), appAsarPath);
  touch(path.join(root, 'default_app.asar'));
  assert.throws(() => assertAsarResourceLayout(root), /default_app\.asar is forbidden/);
}));

test('fuse gate fail-closes every required production state through the explicit @electron/fuses API', () => {
  const expected = {
    version: fuseApi.FuseVersion.V1,
    [fuseApi.FuseV1Options.RunAsNode]: ENABLED_FUSE_STATE,
    [fuseApi.FuseV1Options.EnableNodeOptionsEnvironmentVariable]: DISABLED_FUSE_STATE,
    [fuseApi.FuseV1Options.EnableNodeCliInspectArguments]: DISABLED_FUSE_STATE,
    [fuseApi.FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: ENABLED_FUSE_STATE,
    [fuseApi.FuseV1Options.OnlyLoadAppFromAsar]: ENABLED_FUSE_STATE
  };
  assert.doesNotThrow(() => assertRequiredFuses(expected, fuseApi));
  assert.throws(
    () => assertRequiredFuses({ ...expected, [fuseApi.FuseV1Options.RunAsNode]: DISABLED_FUSE_STATE }, fuseApi),
    /RunAsNode must be enabled/
  );
  assert.throws(
    () => assertRequiredFuses({
      ...expected,
      [fuseApi.FuseV1Options.EnableNodeOptionsEnvironmentVariable]: ENABLED_FUSE_STATE
    }, fuseApi),
    /EnableNodeOptionsEnvironmentVariable must be disabled/
  );
  assert.throws(
    () => assertRequiredFuses({
      ...expected,
      [fuseApi.FuseV1Options.EnableNodeCliInspectArguments]: ENABLED_FUSE_STATE
    }, fuseApi),
    /EnableNodeCliInspectArguments must be disabled/
  );
  assert.throws(
    () => assertRequiredFuses({
      ...expected,
      [fuseApi.FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: DISABLED_FUSE_STATE
    }, fuseApi),
    /EnableEmbeddedAsarIntegrityValidation must be enabled/
  );
  assert.throws(
    () => assertRequiredFuses({
      ...expected,
      [fuseApi.FuseV1Options.OnlyLoadAppFromAsar]: DISABLED_FUSE_STATE
    }, fuseApi),
    /OnlyLoadAppFromAsar must be enabled/
  );
  assert.throws(
    () => assertRequiredFuses({ ...expected, version: '999' }, fuseApi),
    /Fuse wire version/
  );
});

test('ASAR bytes, per-file metadata, and native embedded header hashes must all match', () => fixture((root) => {
  const appAsarPath = path.join(root, 'app.asar');
  const packedData = Buffer.alloc(ASAR_FILE_INTEGRITY_BLOCK_SIZE + 17, 0x61);
  const unpackedData = Buffer.from('native fixture');
  const { hash } = writeAsar(appAsarPath, [
    { path: 'src/main.js', data: packedData },
    { path: 'native/addon.node', data: unpackedData, unpacked: true }
  ]);
  assert.equal(computeAsarHeaderHash(appAsarPath), hash);
  assert.deepEqual(verifyAsarFileIntegrity(appAsarPath), {
    headerHash: hash,
    packedFileCount: 1,
    regularFileCount: 2,
    unpackedFileCount: 1
  });

  const plist = {
    ElectronAsarIntegrity: {
      'Resources/app.asar': { algorithm: 'SHA256', hash }
    }
  };
  assert.equal(assertMacAsarIntegrity(plist, appAsarPath), hash);
  assert.throws(
    () => assertMacAsarIntegrity({ ...plist, ElectronAsarIntegrity: {} }, appAsarPath),
    /missing ElectronAsarIntegrity/
  );
  assert.throws(
    () => assertMacAsarIntegrity({
      ElectronAsarIntegrity: {
        'Resources/app.asar': { algorithm: 'SHA256', hash: '0'.repeat(64) }
      }
    }, appAsarPath),
    /does not match the packaged ASAR header/
  );

  const tamperedAsarPath = path.join(root, 'tampered.asar');
  const tampered = writeAsar(tamperedAsarPath, [
    { path: 'package.json', data: Buffer.from('{"name":"fixture"}') }
  ]);
  const tamperedDescriptor = fs.openSync(tamperedAsarPath, 'r+');
  try {
    fs.writeSync(tamperedDescriptor, Buffer.from('X'), 0, 1, tampered.contentOffset);
  } finally {
    fs.closeSync(tamperedDescriptor);
  }
  assert.throws(
    () => verifyAsarFileIntegrity(tamperedAsarPath),
    /file integrity block 0.*does not match/
  );

  const missingMetadataPath = path.join(root, 'missing-metadata.asar');
  writeAsar(missingMetadataPath, [
    { path: 'package.json', data: Buffer.from('{}'), includeIntegrity: false }
  ]);
  assert.throws(
    () => verifyAsarFileIntegrity(missingMetadataPath),
    /regular file is missing integrity metadata/
  );

  const wrongBlockPath = path.join(root, 'wrong-block.asar');
  writeAsar(wrongBlockPath, [{
    path: 'src/main.js',
    data: packedData,
    mutateIntegrity(integrity) {
      integrity.blocks[1] = '0'.repeat(64);
    }
  }]);
  assert.throws(
    () => verifyAsarFileIntegrity(wrongBlockPath),
    /file integrity block 1.*does not match/
  );

  const symbolicLinkPath = path.join(root, 'symbolic-link.asar');
  writeRawAsar(symbolicLinkPath, { files: { escape: { link: '../outside' } } });
  assert.throws(
    () => verifyAsarFileIntegrity(symbolicLinkPath),
    /symbolic-link entries are not allowed/
  );

  const malformedDirectoryPath = path.join(root, 'malformed-directory.asar');
  writeRawAsar(malformedDirectoryPath, { files: [] });
  assert.throws(
    () => verifyAsarFileIntegrity(malformedDirectoryPath),
    /header root must be a directory with a files object/
  );

  const windowsExecutablePath = path.join(root, 'AgentDesk.exe');
  const resedit = writeWindowsIntegrityExecutable(windowsExecutablePath, [{
    file: 'resources\\app.asar',
    alg: 'SHA256',
    value: hash
  }]);
  assert.equal(readWindowsAsarIntegrityResource(windowsExecutablePath, resedit), hash);
  assert.equal(assertWindowsAsarIntegrity(windowsExecutablePath, hash, resedit), hash);
  assert.throws(
    () => assertWindowsAsarIntegrity(windowsExecutablePath, 'f'.repeat(64), resedit),
    /does not match the packaged ASAR header/
  );

  const noIntegrityExecutablePath = path.join(root, 'AgentDesk-no-integrity.exe');
  fs.writeFileSync(
    noIntegrityExecutablePath,
    Buffer.from(resedit.NtExecutable.createEmpty(false, false).generate())
  );
  assert.throws(
    () => readWindowsAsarIntegrityResource(noIntegrityExecutablePath, resedit),
    /exactly one INTEGRITY\/ELECTRONASAR resource; found 0/
  );
}));
