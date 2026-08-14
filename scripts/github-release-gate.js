#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

const STABLE_ALLOWED = false;
const DEFAULT_RETRIES = 8;
const MAX_REDIRECTS = 10;
const RETRYABLE_STATUS = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class GateError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GateError';
    this.retryable = options.retryable === true;
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GateError(`${label} is required.`);
  }
  return value.trim();
}

function normalizeSha256(value, label) {
  const normalized = requireString(value, label).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new GateError(`${label} must be exactly 64 hexadecimal characters.`);
  }
  return normalized;
}

function validateRepository(repository) {
  const value = requireString(repository, 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new GateError('repository must be an exact owner/name pair.');
  }
  return value;
}

function validateVersionPolicy(version, tag) {
  const normalizedVersion = requireString(version, 'version');
  const normalizedTag = requireString(tag, 'tag');
  const previewPattern = /^\d+\.\d+\.\d+-preview\.[0-9A-Za-z][0-9A-Za-z.-]*$/;

  if (!STABLE_ALLOWED && !previewPattern.test(normalizedVersion)) {
    throw new GateError(
      `Stable releases are disabled (stableAllowed=false); ${normalizedVersion} is not a Preview version.`
    );
  }
  if (normalizedTag !== `v${normalizedVersion}`) {
    throw new GateError(`Tag ${normalizedTag} does not exactly match version ${normalizedVersion}.`);
  }

  return normalizedVersion;
}

function expectedAssetNames(version) {
  return Object.freeze({
    macos: `AgentDesk-${version}-universal.dmg`,
    windows: `AgentDesk-${version}-portable-x64.exe`,
    manifest: 'SHA256SUMS.txt'
  });
}

function exactAssetList(version) {
  const names = expectedAssetNames(version);
  return [names.macos, names.windows, names.manifest].sort((left, right) =>
    left.localeCompare(right, 'en')
  );
}

function releaseAssetIdentity(assets) {
  return [...assets]
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .map((asset) => `${asset.name}:${asset.id}:${asset.size}:${asset.state}`)
    .join('|');
}

function validateReleaseMetadata(release, options) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new GateError('GitHub release metadata is not an object.');
  }

  const expectedDraft = options.mode === 'draft';
  if (release.tag_name !== options.tag) {
    throw new GateError(`Release tag is ${release.tag_name}; expected ${options.tag}.`);
  }
  if (release.draft !== expectedDraft) {
    throw new GateError(`Release draft=${release.draft}; expected draft=${expectedDraft}.`);
  }
  if (release.prerelease !== true) {
    throw new GateError('Preview release must have prerelease=true.');
  }
  if (expectedDraft && release.published_at !== null) {
    throw new GateError('Draft release unexpectedly has a published_at timestamp.');
  }
  if (!expectedDraft && (typeof release.published_at !== 'string' || release.published_at === '')) {
    throw new GateError('Published release is missing published_at.');
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new GateError('Release metadata has no valid numeric id.');
  }
  if (options.expectedReleaseId && release.id !== options.expectedReleaseId) {
    throw new GateError(
      `Release id drifted from ${options.expectedReleaseId} to ${release.id}; this candidate is no longer the verified release.`
    );
  }
  if (!Array.isArray(release.assets)) {
    throw new GateError('Release metadata has no asset array.');
  }

  const expectedNames = exactAssetList(options.version);
  const actualNames = [];
  const assetsByName = new Map();
  for (const asset of release.assets) {
    if (!asset || typeof asset !== 'object') {
      throw new GateError('Release contains malformed asset metadata.');
    }
    const name = requireString(asset.name, 'release asset name');
    if (assetsByName.has(name)) {
      throw new GateError(`Release contains duplicate asset ${name}.`);
    }
    if (asset.state !== 'uploaded') {
      throw new GateError(`Release asset ${name} is not in uploaded state.`);
    }
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0) {
      throw new GateError(`Release asset ${name} has no valid numeric id.`);
    }
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new GateError(`Release asset ${name} is empty or has an invalid size.`);
    }
    actualNames.push(name);
    assetsByName.set(name, asset);
  }

  actualNames.sort((left, right) => left.localeCompare(right, 'en'));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new GateError(
      `Release asset allowlist mismatch. Expected ${expectedNames.join(', ')}; found ${actualNames.join(', ')}.`
    );
  }

  const assetIdentity = releaseAssetIdentity(release.assets);
  if (options.expectedAssetIdentity && assetIdentity !== options.expectedAssetIdentity) {
    throw new GateError('Release asset id, byte size, or upload state drifted from the created draft.');
  }

  return { assetIdentity, assetsByName, expectedNames };
}

function parseChecksumManifest(contents, version) {
  if (typeof contents !== 'string' || contents.includes('\r')) {
    throw new GateError('SHA256SUMS.txt must be UTF-8 text with LF line endings.');
  }
  if (!contents.endsWith('\n')) {
    throw new GateError('SHA256SUMS.txt must end with exactly one LF newline.');
  }

  const lines = contents.slice(0, -1).split('\n');
  if (lines.length !== 2 || lines.some((line) => line === '')) {
    throw new GateError('SHA256SUMS.txt must contain exactly two checksum lines.');
  }

  const entries = new Map();
  const orderedNames = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match) {
      throw new GateError('SHA256SUMS.txt contains a malformed checksum line.');
    }
    const [, digest, name] = match;
    if (entries.has(name)) {
      throw new GateError(`SHA256SUMS.txt contains duplicate entry ${name}.`);
    }
    entries.set(name, digest);
    orderedNames.push(name);
  }

  const expectedNames = exactAssetList(version).filter((name) => name !== 'SHA256SUMS.txt');
  const actualNames = [...orderedNames].sort((left, right) => left.localeCompare(right, 'en'));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new GateError(
      `SHA256SUMS.txt allowlist mismatch. Expected ${expectedNames.join(', ')}; found ${actualNames.join(', ')}.`
    );
  }
  if (JSON.stringify(orderedNames) !== JSON.stringify(expectedNames)) {
    throw new GateError('SHA256SUMS.txt entries must be sorted by exact asset name.');
  }

  return entries;
}

function assertExpectedChecksums(entries, names, expected) {
  const expectedMac = normalizeSha256(expected.macos, 'expected macOS SHA-256');
  const expectedWindows = normalizeSha256(expected.windows, 'expected Windows SHA-256');
  if (entries.get(names.macos) !== expectedMac) {
    throw new GateError('SHA256SUMS.txt macOS checksum differs from the pre-publication digest.');
  }
  if (entries.get(names.windows) !== expectedWindows) {
    throw new GateError('SHA256SUMS.txt Windows checksum differs from the pre-publication digest.');
  }
}

function buildApiReleaseUrl(repository, tag) {
  return `https://api.github.com/repos/${validateRepository(repository)}/releases/tags/${encodeURIComponent(tag)}`;
}

function buildDraftAssetUrl(repository, assetId) {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) {
    throw new GateError('Draft asset id must be a positive integer.');
  }
  return `https://api.github.com/repos/${validateRepository(repository)}/releases/assets/${assetId}`;
}

function buildPublicAssetUrl(repository, tag, assetName) {
  const validatedRepository = validateRepository(repository);
  return `https://github.com/${validatedRepository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

function assertAllowedHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new GateError('GitHub returned an invalid download redirect URL.');
  }
  const allowedHost =
    parsed.hostname === 'github.com' ||
    parsed.hostname === 'api.github.com' ||
    parsed.hostname.endsWith('.githubusercontent.com');
  if (parsed.protocol !== 'https:' || !allowedHost || parsed.username || parsed.password) {
    throw new GateError('GitHub download URL left the HTTPS GitHub asset host allowlist.');
  }
  return parsed.toString();
}

function assertAnonymousEnvironment(environment = process.env) {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'RELEASE_GATE_TOKEN']) {
    if (typeof environment[name] === 'string' && environment[name].trim() !== '') {
      throw new GateError(`Anonymous release verification refuses non-empty ${name}.`);
    }
  }
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': 'agentdesk-release-gate',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function responseError(label, response) {
  return new GateError(`${label} returned HTTP ${response.status}.`, {
    retryable: RETRYABLE_STATUS.has(response.status)
  });
}

async function withRetries(operation, options = {}) {
  const retries = options.retries || DEFAULT_RETRIES;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error && (error.retryable === true || error.name === 'TypeError');
      if (!retryable || attempt === retries) {
        throw error;
      }
      await delay(Math.min(5000, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function fetchReleaseMetadata(url, headers, fetchImpl = globalThis.fetch) {
  return withRetries(async () => {
    const response = await fetchImpl(assertAllowedHttpsUrl(url), {
      method: 'GET',
      headers,
      redirect: 'error'
    });
    if (!response.ok) {
      throw responseError('GitHub release metadata', response);
    }
    let metadata;
    try {
      metadata = await response.json();
    } catch {
      throw new GateError('GitHub release metadata was not valid JSON.', { retryable: true });
    }
    return metadata;
  });
}

async function openDownload(url, initialHeaders, fetchImpl) {
  let currentUrl = assertAllowedHttpsUrl(url);
  let headers = initialHeaders;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      method: 'GET',
      headers,
      redirect: 'manual'
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) {
        throw new GateError('GitHub release asset exceeded the redirect limit.');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new GateError('GitHub release asset redirect had no Location header.');
      }
      currentUrl = assertAllowedHttpsUrl(new URL(location, currentUrl).toString());
      // The API bearer token is intentionally removed before following any
      // redirect to the binary CDN. Public mode never has this header at all.
      headers = githubHeaders('', 'application/octet-stream');
      continue;
    }
    if (!response.ok) {
      throw responseError('GitHub release asset download', response);
    }
    if (!response.body) {
      throw new GateError('GitHub release asset download returned an empty response body.', {
        retryable: true
      });
    }
    return response;
  }
  throw new GateError('GitHub release asset redirect handling failed.');
}

async function downloadToFile(url, destination, headers, fetchImpl = globalThis.fetch) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  return withRetries(async (attempt) => {
    const temporary = `${destination}.attempt-${process.pid}-${attempt}`;
    await fsp.rm(temporary, { force: true });
    try {
      const response = await openDownload(url, headers, fetchImpl);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'wx' }));
      const stats = await fsp.stat(temporary);
      if (!stats.isFile() || stats.size <= 0) {
        throw new GateError('Downloaded release asset is empty.', { retryable: true });
      }
      await fsp.rename(temporary, destination);
      return stats.size;
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
  });
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), digest);
  return digest.digest('hex');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new GateError(`Unexpected argument ${argument}.`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new GateError(`Missing value for --${key}.`);
    }
    if (Object.hasOwn(parsed, key)) {
      throw new GateError(`Duplicate argument --${key}.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function configFromArgs(argv, environment = process.env) {
  const args = parseArgs(argv);
  const mode = requireString(args.mode, 'mode');
  if (!['draft', 'public'].includes(mode)) {
    throw new GateError('mode must be draft or public.');
  }
  const artifact = args.artifact || 'none';
  if (!['none', 'macos', 'windows'].includes(artifact)) {
    throw new GateError('artifact must be none, macos, or windows.');
  }

  const repository = validateRepository(args.repository);
  const tag = requireString(args.tag, 'tag');
  const version = validateVersionPolicy(args.version, tag);
  const releaseIdText = requireString(args['release-id'], 'release-id');
  if (!/^[1-9][0-9]*$/.test(releaseIdText)) {
    throw new GateError('release-id must be a positive integer.');
  }
  const expectedReleaseId = Number(releaseIdText);
  if (!Number.isSafeInteger(expectedReleaseId)) {
    throw new GateError('release-id exceeds the safe integer range.');
  }
  const expectedAssetIdentity = requireString(args['asset-identity'], 'asset-identity');
  if (/[\r\n]/.test(expectedAssetIdentity)) {
    throw new GateError('asset-identity must be one bounded line.');
  }
  const outputDirectory = artifact === 'none' ? null : path.resolve(requireString(args['output-dir'], 'output-dir'));
  const reportPath = path.resolve(requireString(args.report, 'report'));

  if (outputDirectory) {
    const reportRelative = path.relative(outputDirectory, reportPath);
    if (reportRelative === '' || (!reportRelative.startsWith('..') && !path.isAbsolute(reportRelative))) {
      throw new GateError('Diagnostic report must be physically outside the downloaded release asset directory.');
    }
  }

  let token = '';
  if (mode === 'public') {
    assertAnonymousEnvironment(environment);
    if (args['token-env']) {
      throw new GateError('Public release verification does not accept --token-env.');
    }
  } else {
    const tokenEnvironmentName = requireString(args['token-env'], 'token-env');
    if (!/^[A-Z][A-Z0-9_]*$/.test(tokenEnvironmentName)) {
      throw new GateError('token-env must name an uppercase environment variable.');
    }
    token = requireString(environment[tokenEnvironmentName], tokenEnvironmentName);
  }

  const expected = artifact === 'none' ? null : {
    macos: normalizeSha256(args['macos-sha256'], 'macos-sha256'),
    windows: normalizeSha256(args['windows-sha256'], 'windows-sha256'),
    manifest: normalizeSha256(args['manifest-sha256'], 'manifest-sha256')
  };

  return {
    mode,
    artifact,
    repository,
    tag,
    version,
    expectedReleaseId,
    expectedAssetIdentity,
    outputDirectory,
    reportPath,
    token,
    expected
  };
}

async function prepareEmptyDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const entries = await fsp.readdir(directory);
  if (entries.length !== 0) {
    throw new GateError('Release download directory must be empty before verification.');
  }
}

async function writeReport(reportPath, report) {
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  const safeReport = `${reportPath}.tmp-${process.pid}`;
  await fsp.writeFile(safeReport, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fsp.rename(safeReport, reportPath);
}

async function runGate(config, dependencies = {}) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const names = expectedAssetNames(config.version);
  const metadataHeaders = githubHeaders(config.token);
  const metadataUrl = buildApiReleaseUrl(config.repository, config.tag);
  const release = await fetchReleaseMetadata(metadataUrl, metadataHeaders, fetchImpl);
  const validated = validateReleaseMetadata(release, config);

  const report = {
    schemaVersion: 1,
    result: 'passed',
    mode: config.mode,
    repository: config.repository,
    tag: config.tag,
    releaseId: release.id,
    draft: release.draft,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    assetNames: validated.expectedNames,
    assetIdentity: validated.assetIdentity,
    downloaded: []
  };

  if (config.artifact === 'none') {
    await writeReport(config.reportPath, report);
    return report;
  }

  await prepareEmptyDirectory(config.outputDirectory);
  const selectedName = names[config.artifact];
  const downloadNames = [names.manifest, selectedName];
  for (const name of downloadNames) {
    const asset = validated.assetsByName.get(name);
    const url = config.mode === 'draft'
      ? buildDraftAssetUrl(config.repository, asset.id)
      : buildPublicAssetUrl(config.repository, config.tag, name);
    const headers = config.mode === 'draft'
      ? githubHeaders(config.token, 'application/octet-stream')
      : githubHeaders('', 'application/octet-stream');
    const destination = path.join(config.outputDirectory, name);
    const size = await downloadToFile(url, destination, headers, fetchImpl);
    const digest = await sha256File(destination);
    report.downloaded.push({ name, size, sha256: digest });
  }

  const manifestPath = path.join(config.outputDirectory, names.manifest);
  const manifestDigest = await sha256File(manifestPath);
  if (manifestDigest !== config.expected.manifest) {
    throw new GateError('Downloaded SHA256SUMS.txt differs from its pre-publication digest.');
  }
  const manifest = parseChecksumManifest(await fsp.readFile(manifestPath, 'utf8'), config.version);
  assertExpectedChecksums(manifest, names, config.expected);

  const selectedPath = path.join(config.outputDirectory, selectedName);
  const selectedDigest = await sha256File(selectedPath);
  if (selectedDigest !== config.expected[config.artifact]) {
    throw new GateError(`Downloaded ${selectedName} differs from its pre-publication digest.`);
  }
  if (selectedDigest !== manifest.get(selectedName)) {
    throw new GateError(`Downloaded ${selectedName} differs from public SHA256SUMS.txt.`);
  }

  await writeReport(config.reportPath, report);
  return report;
}

async function main() {
  let config;
  try {
    config = configFromArgs(process.argv.slice(2));
    const report = await runGate(config);
    process.stdout.write(
      `Verified ${config.mode} GitHub release ${config.tag} (${config.artifact}); exact asset allowlist and hashes passed.\n`
    );
    return report;
  } catch (error) {
    if (config && config.reportPath) {
      try {
        await writeReport(config.reportPath, {
          schemaVersion: 1,
          result: 'failed',
          mode: config.mode,
          repository: config.repository,
          tag: config.tag,
          artifact: config.artifact,
          error: error instanceof Error ? error.message : String(error)
        });
      } catch (reportError) {
        process.stderr.write(`Could not write release-gate diagnostic report: ${reportError.message}\n`);
      }
    }
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  GateError,
  STABLE_ALLOWED,
  assertAllowedHttpsUrl,
  assertAnonymousEnvironment,
  assertExpectedChecksums,
  buildApiReleaseUrl,
  buildDraftAssetUrl,
  buildPublicAssetUrl,
  configFromArgs,
  exactAssetList,
  expectedAssetNames,
  normalizeSha256,
  parseChecksumManifest,
  releaseAssetIdentity,
  runGate,
  validateReleaseMetadata,
  validateRepository,
  validateVersionPolicy
};
