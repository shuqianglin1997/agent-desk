#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const MAX_ASAR_HEADER_BYTES = 64 * 1024 * 1024;
const MAX_ASAR_ENTRIES = 1_000_000;
const MAX_ASAR_DEPTH = 256;
const ASAR_FILE_INTEGRITY_ALGORITHM = 'SHA256';
const ASAR_FILE_INTEGRITY_BLOCK_SIZE = 4 * 1024 * 1024;
const ASAR_READ_BUFFER_BYTES = 1024 * 1024;
const UINT32_MAX = 2 ** 32 - 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENABLED_FUSE_STATE = '1'.charCodeAt(0);
const DISABLED_FUSE_STATE = '0'.charCodeAt(0);

function parseArguments(argv) {
  let artifact = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact') {
      if (artifact !== null || index + 1 >= argv.length) {
        throw new Error('--artifact must be provided exactly once with a path.');
      }
      artifact = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!artifact) throw new Error('--artifact is required.');
  return { artifact: path.resolve(artifact) };
}

function assertRegularFile(filePath, label) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`${label} is missing: ${filePath}`);
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink: ${filePath}`);
  }
}

function resolvePackagedLayout(artifactPath) {
  const resolvedArtifact = fs.realpathSync(artifactPath);
  const stats = fs.statSync(resolvedArtifact);
  if (!stats.isDirectory()) {
    throw new Error('Artifact must be an AgentDesk.app bundle or a win-unpacked directory.');
  }

  if (resolvedArtifact.endsWith('.app')) {
    const executablePath = path.join(resolvedArtifact, 'Contents', 'MacOS', 'AgentDesk');
    const resourcesPath = path.join(resolvedArtifact, 'Contents', 'Resources');
    const infoPlistPath = path.join(resolvedArtifact, 'Contents', 'Info.plist');
    assertRegularFile(executablePath, 'packaged macOS Electron executable');
    assertRegularFile(infoPlistPath, 'packaged macOS Info.plist');
    return {
      artifactPath: resolvedArtifact,
      platform: 'darwin',
      executablePath,
      resourcesPath,
      infoPlistPath
    };
  }

  const executablePath = path.join(resolvedArtifact, 'AgentDesk.exe');
  const resourcesPath = path.join(resolvedArtifact, 'resources');
  if (path.basename(resolvedArtifact).toLowerCase() !== 'win-unpacked') {
    throw new Error('Windows package integrity must be checked against the final win-unpacked directory.');
  }
  assertRegularFile(executablePath, 'packaged Windows Electron executable');
  return {
    artifactPath: resolvedArtifact,
    platform: 'win32',
    executablePath,
    resourcesPath,
    infoPlistPath: null
  };
}

function assertAsarResourceLayout(resourcesPath) {
  const appAsarPath = path.join(resourcesPath, 'app.asar');
  const defaultAppAsarPath = path.join(resourcesPath, 'default_app.asar');
  assertRegularFile(appAsarPath, 'packaged app.asar');
  if (fs.existsSync(defaultAppAsarPath)) {
    throw new Error(`default_app.asar is forbidden in a packaged AgentDesk artifact: ${defaultAppAsarPath}`);
  }
  return appAsarPath;
}

function readExactly(fileDescriptor, buffer, position, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = fs.readSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.length - offset,
      position + offset
    );
    if (bytesRead === 0) throw new Error(`Unexpected end of ${label}.`);
    offset += bytesRead;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertExactKeys(record, allowedKeys, label) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new Error(`${label} contains unsupported metadata key: ${key}`);
  }
}

function alignToFour(value) {
  return (value + 3) & ~3;
}

function readAsarHeader(appAsarPath) {
  assertRegularFile(appAsarPath, 'packaged app.asar');
  const fileDescriptor = fs.openSync(appAsarPath, 'r');
  try {
    const archiveStats = fs.fstatSync(fileDescriptor, { bigint: true });
    if (archiveStats.size < 16n || archiveStats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('app.asar has an invalid or unsupported archive size.');
    }
    const prefix = Buffer.alloc(16);
    readExactly(fileDescriptor, prefix, 0, 'app.asar header prefix');

    const sizePicklePayloadBytes = prefix.readUInt32LE(0);
    const headerPickleBytes = prefix.readUInt32LE(4);
    const headerPayloadBytes = prefix.readUInt32LE(8);
    const headerStringBytes = prefix.readUInt32LE(12);
    if (sizePicklePayloadBytes !== 4) throw new Error('app.asar has an invalid size pickle.');
    const expectedHeaderPickleBytes = 8 + alignToFour(headerStringBytes);
    if (
      headerPickleBytes < 8 ||
      headerPickleBytes > MAX_ASAR_HEADER_BYTES ||
      headerPayloadBytes !== headerPickleBytes - 4 ||
      headerPickleBytes !== expectedHeaderPickleBytes ||
      BigInt(8 + headerPickleBytes) > archiveStats.size
    ) {
      throw new Error('app.asar has an invalid or unbounded header.');
    }

    const headerPickle = Buffer.alloc(headerPickleBytes);
    readExactly(fileDescriptor, headerPickle, 8, 'app.asar header pickle');
    if (
      headerPickle.readUInt32LE(0) !== headerPayloadBytes ||
      headerPickle.readUInt32LE(4) !== headerStringBytes
    ) {
      throw new Error('app.asar header pickle length fields are inconsistent.');
    }
    const headerBytes = headerPickle.subarray(8, 8 + headerStringBytes);
    const padding = headerPickle.subarray(8 + headerStringBytes);
    if (padding.some((byte) => byte !== 0)) {
      throw new Error('app.asar header pickle has non-zero padding.');
    }

    let headerText;
    try {
      headerText = new TextDecoder('utf-8', { fatal: true }).decode(headerBytes);
    } catch {
      throw new Error('app.asar header is not valid UTF-8.');
    }
    let header;
    try {
      header = JSON.parse(headerText);
    } catch (error) {
      throw new Error(`app.asar header is not valid JSON: ${error.message}`);
    }
    if (!isRecord(header) || !isRecord(header.files)) {
      throw new Error('app.asar header root must be a directory with a files object.');
    }

    return {
      archiveSize: Number(archiveStats.size),
      contentOffset: 8 + headerPickleBytes,
      header,
      headerHash: crypto.createHash('sha256').update(headerBytes).digest('hex'),
      headerString: headerText
    };
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function computeAsarHeaderHash(appAsarPath) {
  return readAsarHeader(appAsarPath).headerHash;
}

function assertArchiveName(name, parentPath) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error(`app.asar contains an unsafe entry name under ${parentPath || '/'}: ${String(name)}`);
  }
}

function assertAsarFileIntegrityMetadata(node, archivePath) {
  if (!hasOwn(node, 'integrity')) {
    throw new Error(`app.asar regular file is missing integrity metadata: ${archivePath}`);
  }
  const integrity = node.integrity;
  if (!isRecord(integrity)) {
    throw new Error(`app.asar file integrity metadata must be an object: ${archivePath}`);
  }
  assertExactKeys(
    integrity,
    new Set(['algorithm', 'hash', 'blockSize', 'blocks']),
    `app.asar file integrity metadata for ${archivePath}`
  );
  if (integrity.algorithm !== ASAR_FILE_INTEGRITY_ALGORITHM) {
    throw new Error(`app.asar file integrity algorithm must be SHA256: ${archivePath}`);
  }
  if (typeof integrity.hash !== 'string' || !SHA256_PATTERN.test(integrity.hash)) {
    throw new Error(`app.asar file integrity hash must be a lowercase SHA-256 value: ${archivePath}`);
  }
  if (integrity.blockSize !== ASAR_FILE_INTEGRITY_BLOCK_SIZE) {
    throw new Error(
      `app.asar file integrity blockSize must match @electron/asar's 4 MiB format: ${archivePath}`
    );
  }
  if (!Array.isArray(integrity.blocks)) {
    throw new Error(`app.asar file integrity blocks must be an array: ${archivePath}`);
  }
  const expectedBlockCount = Math.floor(node.size / integrity.blockSize) + 1;
  if (integrity.blocks.length !== expectedBlockCount) {
    throw new Error(
      `app.asar file integrity block count is invalid for ${archivePath}: expected ${expectedBlockCount}, found ${integrity.blocks.length}.`
    );
  }
  for (const [index, blockHash] of integrity.blocks.entries()) {
    if (typeof blockHash !== 'string' || !SHA256_PATTERN.test(blockHash)) {
      throw new Error(
        `app.asar file integrity block ${index} must be a lowercase SHA-256 value: ${archivePath}`
      );
    }
  }
  return integrity;
}

function collectAsarEntries(header) {
  const regularFiles = [];
  const stack = [{ node: header, archivePath: '', depth: 0, root: true }];
  let entryCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const { node, archivePath, depth, root } = current;
    if (!isRecord(node)) {
      throw new Error(`app.asar entry metadata must be an object: ${archivePath || '/'}`);
    }
    if (depth > MAX_ASAR_DEPTH) throw new Error('app.asar directory nesting is unbounded.');

    const isDirectory = hasOwn(node, 'files');
    const isLink = hasOwn(node, 'link');
    const isFile = hasOwn(node, 'size');
    if (Number(isDirectory) + Number(isLink) + Number(isFile) !== 1) {
      throw new Error(`app.asar entry has an ambiguous or unknown type: ${archivePath || '/'}`);
    }

    if (isDirectory) {
      assertExactKeys(node, new Set(['files', 'unpacked']), `app.asar directory ${archivePath || '/'}`);
      if (!isRecord(node.files)) {
        throw new Error(`app.asar directory files metadata must be an object: ${archivePath || '/'}`);
      }
      if (hasOwn(node, 'unpacked') && node.unpacked !== true) {
        throw new Error(`app.asar directory unpacked marker must be true when present: ${archivePath || '/'}`);
      }
      if (root && archivePath !== '') throw new Error('app.asar root metadata is invalid.');
      const children = Object.entries(node.files);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const [name, child] = children[index];
        assertArchiveName(name, archivePath);
        entryCount += 1;
        if (entryCount > MAX_ASAR_ENTRIES) throw new Error('app.asar contains too many entries.');
        stack.push({
          node: child,
          archivePath: archivePath ? `${archivePath}/${name}` : name,
          depth: depth + 1,
          root: false
        });
      }
      continue;
    }

    if (isLink) {
      assertExactKeys(node, new Set(['link', 'unpacked']), `app.asar symbolic link ${archivePath}`);
      if (typeof node.link !== 'string' || node.link.length === 0) {
        throw new Error(`app.asar symbolic-link target is invalid: ${archivePath}`);
      }
      if (hasOwn(node, 'unpacked') && node.unpacked !== true) {
        throw new Error(`app.asar symbolic-link unpacked marker must be true when present: ${archivePath}`);
      }
      throw new Error(`app.asar symbolic-link entries are not allowed in AgentDesk packages: ${archivePath}`);
    }

    assertExactKeys(
      node,
      new Set(['size', 'offset', 'integrity', 'unpacked', 'executable']),
      `app.asar regular file ${archivePath}`
    );
    if (!Number.isSafeInteger(node.size) || node.size < 0 || node.size > UINT32_MAX) {
      throw new Error(`app.asar regular file has an invalid size: ${archivePath}`);
    }
    if (hasOwn(node, 'executable') && node.executable !== true) {
      throw new Error(`app.asar executable marker must be true when present: ${archivePath}`);
    }
    const unpacked = hasOwn(node, 'unpacked');
    if (unpacked && node.unpacked !== true) {
      throw new Error(`app.asar unpacked marker must be true when present: ${archivePath}`);
    }
    let offset = null;
    if (unpacked) {
      if (hasOwn(node, 'offset')) {
        throw new Error(`app.asar unpacked regular file must not contain a packed offset: ${archivePath}`);
      }
    } else {
      if (typeof node.offset !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(node.offset)) {
        throw new Error(`app.asar packed regular file has an invalid canonical offset: ${archivePath}`);
      }
      offset = BigInt(node.offset);
    }
    regularFiles.push({
      archivePath,
      integrity: assertAsarFileIntegrityMetadata(node, archivePath),
      node,
      offset,
      unpacked
    });
  }

  return regularFiles;
}

function assertPackedAsarLayout(regularFiles, bodySize) {
  const groups = new Map();
  for (const file of regularFiles) {
    if (file.unpacked) continue;
    const offsetKey = file.offset.toString();
    const group = groups.get(offsetKey) || [];
    group.push(file);
    groups.set(offsetKey, group);
  }
  const sortedGroups = [...groups.entries()]
    .map(([offset, files]) => ({ offset: BigInt(offset), files }))
    .sort((left, right) => (left.offset < right.offset ? -1 : left.offset > right.offset ? 1 : 0));

  let cursor = 0n;
  for (const group of sortedGroups) {
    if (group.offset !== cursor) {
      throw new Error(
        `app.asar packed file ranges contain a gap or overlap at body offset ${group.offset.toString()}.`
      );
    }
    const nonEmptyFiles = group.files.filter((file) => file.node.size > 0);
    if (nonEmptyFiles.length > 1) {
      throw new Error(`app.asar packed file ranges overlap at body offset ${group.offset.toString()}.`);
    }
    if (nonEmptyFiles.length === 1) cursor += BigInt(nonEmptyFiles[0].node.size);
  }
  if (cursor !== BigInt(bodySize)) {
    throw new Error(
      `app.asar body length does not match its packed file table: expected ${cursor.toString()}, found ${bodySize}.`
    );
  }
}

function assertDigest(expected, actual, label) {
  if (actual !== expected) throw new Error(`${label} does not match: expected ${expected}, found ${actual}.`);
}

function verifyDescriptorIntegrity(fileDescriptor, position, size, integrity, archivePath) {
  const fileHash = crypto.createHash('sha256');
  const readBuffer = Buffer.allocUnsafe(Math.min(ASAR_READ_BUFFER_BYTES, integrity.blockSize));
  let remaining = size;
  let currentPosition = position;

  for (let blockIndex = 0; blockIndex < integrity.blocks.length; blockIndex += 1) {
    let blockRemaining = Math.min(integrity.blockSize, remaining);
    const blockHash = crypto.createHash('sha256');
    while (blockRemaining > 0) {
      const bytesToRead = Math.min(readBuffer.length, blockRemaining);
      const buffer = readBuffer.subarray(0, bytesToRead);
      readExactly(fileDescriptor, buffer, currentPosition, `app.asar file ${archivePath}`);
      fileHash.update(buffer);
      blockHash.update(buffer);
      currentPosition += bytesToRead;
      remaining -= bytesToRead;
      blockRemaining -= bytesToRead;
    }
    assertDigest(
      integrity.blocks[blockIndex],
      blockHash.digest('hex'),
      `app.asar file integrity block ${blockIndex} for ${archivePath}`
    );
  }
  if (remaining !== 0) throw new Error(`app.asar file integrity metadata ended early: ${archivePath}`);
  assertDigest(integrity.hash, fileHash.digest('hex'), `app.asar whole-file integrity hash for ${archivePath}`);
}

function openUnpackedRegularFile(appAsarPath, archivePath, expectedSize) {
  const unpackedRoot = `${appAsarPath}.unpacked`;
  const rootStats = fs.lstatSync(unpackedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`app.asar.unpacked must be a real directory: ${unpackedRoot}`);
  }
  const segments = archivePath.split('/');
  let currentPath = unpackedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    const stats = fs.lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`app.asar.unpacked paths must not contain symbolic links: ${archivePath}`);
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error(`app.asar.unpacked ancestor is not a directory: ${archivePath}`);
    }
    if (index === segments.length - 1 && !stats.isFile()) {
      throw new Error(`app.asar.unpacked entry must be a regular file: ${archivePath}`);
    }
  }
  const fileDescriptor = fs.openSync(currentPath, 'r');
  const stats = fs.fstatSync(fileDescriptor);
  if (!stats.isFile() || stats.size !== expectedSize) {
    fs.closeSync(fileDescriptor);
    throw new Error(
      `app.asar.unpacked file size does not match its header for ${archivePath}: expected ${expectedSize}, found ${stats.size}.`
    );
  }
  return fileDescriptor;
}

function verifyAsarFileIntegrity(appAsarPath) {
  const parsed = readAsarHeader(appAsarPath);
  const regularFiles = collectAsarEntries(parsed.header);
  const bodySize = parsed.archiveSize - parsed.contentOffset;
  assertPackedAsarLayout(regularFiles, bodySize);

  const archiveDescriptor = fs.openSync(appAsarPath, 'r');
  try {
    for (const file of regularFiles) {
      if (file.unpacked) {
        const unpackedDescriptor = openUnpackedRegularFile(appAsarPath, file.archivePath, file.node.size);
        try {
          verifyDescriptorIntegrity(
            unpackedDescriptor,
            0,
            file.node.size,
            file.integrity,
            file.archivePath
          );
        } finally {
          fs.closeSync(unpackedDescriptor);
        }
      } else {
        verifyDescriptorIntegrity(
          archiveDescriptor,
          parsed.contentOffset + Number(file.offset),
          file.node.size,
          file.integrity,
          file.archivePath
        );
      }
    }
  } finally {
    fs.closeSync(archiveDescriptor);
  }

  return {
    headerHash: parsed.headerHash,
    packedFileCount: regularFiles.filter((file) => !file.unpacked).length,
    regularFileCount: regularFiles.length,
    unpackedFileCount: regularFiles.filter((file) => file.unpacked).length
  };
}

function readMacInfoPlist(infoPlistPath) {
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', infoPlistPath],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`plutil could not read the packaged Info.plist: ${String(result.stderr).trim()}`);
  }
  return JSON.parse(result.stdout);
}

function assertMacAsarIntegrity(infoPlist, appAsarPath, verifiedHeaderHash = null) {
  const integrityMap = infoPlist && infoPlist.ElectronAsarIntegrity;
  const integrity = integrityMap && integrityMap['Resources/app.asar'];
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
    throw new Error('Info.plist is missing ElectronAsarIntegrity for Resources/app.asar.');
  }
  if (integrity.algorithm !== 'SHA256') {
    throw new Error('Info.plist Resources/app.asar integrity must use SHA256.');
  }
  if (typeof integrity.hash !== 'string' || !SHA256_PATTERN.test(integrity.hash)) {
    throw new Error('Info.plist Resources/app.asar integrity hash must be a lowercase SHA-256 value.');
  }
  const actualHash = verifiedHeaderHash || computeAsarHeaderHash(appAsarPath);
  if (integrity.hash !== actualHash) {
    throw new Error(
      `Info.plist Resources/app.asar integrity hash does not match the packaged ASAR header: expected ${actualHash}, found ${integrity.hash}.`
    );
  }
  return actualHash;
}

function loadElectronBuilderDependency(specifier) {
  let electronBuilderPackagePath;
  try {
    electronBuilderPackagePath = require.resolve('electron-builder/package.json');
  } catch (error) {
    throw new Error(`electron-builder is required to verify packaged Windows resources: ${error.message}`);
  }
  try {
    return createRequire(electronBuilderPackagePath)(specifier);
  } catch (error) {
    throw new Error(`electron-builder dependency ${specifier} is unavailable: ${error.message}`);
  }
}

function readWindowsAsarIntegrityResource(executablePath, reseditApi = null) {
  const resedit = reseditApi || loadElectronBuilderDependency('resedit');
  let executable;
  let resources;
  try {
    executable = resedit.NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
    resources = resedit.NtExecutableResource.from(executable);
  } catch (error) {
    throw new Error(`Could not parse the packaged Windows executable resources: ${error.message}`);
  }
  const entries = resources.entries.filter(
    (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR'
  );
  if (entries.length !== 1) {
    throw new Error(
      `Windows executable must contain exactly one INTEGRITY/ELECTRONASAR resource; found ${entries.length}.`
    );
  }

  let resourceText;
  try {
    resourceText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(entries[0].bin));
  } catch {
    throw new Error('Windows INTEGRITY/ELECTRONASAR resource is not valid UTF-8.');
  }
  let integrityList;
  try {
    integrityList = JSON.parse(resourceText);
  } catch (error) {
    throw new Error(`Windows INTEGRITY/ELECTRONASAR resource is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(integrityList) || integrityList.length !== 1 || !isRecord(integrityList[0])) {
    throw new Error('Windows INTEGRITY/ELECTRONASAR resource must contain exactly one ASAR record.');
  }
  const integrity = integrityList[0];
  assertExactKeys(
    integrity,
    new Set(['file', 'alg', 'value']),
    'Windows INTEGRITY/ELECTRONASAR record'
  );
  if (integrity.file !== 'resources\\app.asar') {
    throw new Error('Windows INTEGRITY/ELECTRONASAR record must target resources\\app.asar.');
  }
  if (integrity.alg !== 'SHA256') {
    throw new Error('Windows INTEGRITY/ELECTRONASAR record must use SHA256.');
  }
  if (typeof integrity.value !== 'string' || !SHA256_PATTERN.test(integrity.value)) {
    throw new Error('Windows INTEGRITY/ELECTRONASAR value must be a lowercase SHA-256 hash.');
  }
  return integrity.value;
}

function assertWindowsAsarIntegrity(executablePath, expectedHeaderHash, reseditApi = null) {
  const embeddedHeaderHash = readWindowsAsarIntegrityResource(executablePath, reseditApi);
  if (embeddedHeaderHash !== expectedHeaderHash) {
    throw new Error(
      `Windows INTEGRITY/ELECTRONASAR hash does not match the packaged ASAR header: expected ${expectedHeaderHash}, found ${embeddedHeaderHash}.`
    );
  }
  return embeddedHeaderHash;
}

function assertRequiredFuses(fuseConfig, fuseApi) {
  const { FuseV1Options, FuseVersion } = fuseApi;
  if (!fuseConfig || fuseConfig.version !== FuseVersion.V1) {
    throw new Error(`Expected Electron Fuse wire version ${FuseVersion.V1}.`);
  }
  for (const [name, option, expectedState, expectedLabel] of [
    ['RunAsNode', FuseV1Options.RunAsNode, ENABLED_FUSE_STATE, 'enabled'],
    [
      'EnableNodeOptionsEnvironmentVariable',
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      DISABLED_FUSE_STATE,
      'disabled'
    ],
    [
      'EnableNodeCliInspectArguments',
      FuseV1Options.EnableNodeCliInspectArguments,
      DISABLED_FUSE_STATE,
      'disabled'
    ],
    [
      'EnableEmbeddedAsarIntegrityValidation',
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      ENABLED_FUSE_STATE,
      'enabled'
    ],
    ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, ENABLED_FUSE_STATE, 'enabled']
  ]) {
    if (fuseConfig[option] !== expectedState) {
      throw new Error(`Electron fuse ${name} must be ${expectedLabel} in the final executable.`);
    }
  }
}

async function verifyElectronPackage(artifactPath, dependencies = {}) {
  const layout = resolvePackagedLayout(artifactPath);
  const appAsarPath = assertAsarResourceLayout(layout.resourcesPath);
  const fuseApi = dependencies.fuseApi || require('@electron/fuses');
  const fuseConfig = await fuseApi.getCurrentFuseWire(layout.executablePath);
  assertRequiredFuses(fuseConfig, fuseApi);

  const asarIntegrity = verifyAsarFileIntegrity(appAsarPath);
  if (layout.platform === 'darwin') {
    const readInfoPlist = dependencies.readInfoPlist || readMacInfoPlist;
    assertMacAsarIntegrity(
      readInfoPlist(layout.infoPlistPath),
      appAsarPath,
      asarIntegrity.headerHash
    );
  } else {
    assertWindowsAsarIntegrity(
      layout.executablePath,
      asarIntegrity.headerHash,
      dependencies.reseditApi || null
    );
  }
  return { ...layout, appAsarPath, asarHeaderHash: asarIntegrity.headerHash, ...asarIntegrity };
}

async function main() {
  const { artifact } = parseArguments(process.argv.slice(2));
  const result = await verifyElectronPackage(artifact);
  console.log(`Electron package integrity passed for ${result.artifactPath}`);
  console.log('  RunAsNode: enabled (required by fixed known-CLI launchers)');
  console.log('  EnableNodeOptionsEnvironmentVariable: disabled');
  console.log('  EnableNodeCliInspectArguments: disabled');
  console.log('  EnableEmbeddedAsarIntegrityValidation: enabled');
  console.log('  OnlyLoadAppFromAsar: enabled');
  console.log(`  app.asar: ${result.appAsarPath}`);
  console.log(
    `  ASAR regular files verified: ${result.regularFileCount} (${result.packedFileCount} packed, ${result.unpackedFileCount} unpacked)`
  );
  console.log(
    `  ${result.platform === 'darwin' ? 'macOS Info.plist' : 'Windows INTEGRITY/ELECTRONASAR'} header SHA-256: ${result.asarHeaderHash}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Electron package integrity failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
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
  readMacInfoPlist,
  readWindowsAsarIntegrityResource,
  resolvePackagedLayout,
  verifyAsarFileIntegrity,
  verifyElectronPackage
};
