'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STABLE_ALLOWED,
  assertAllowedHttpsUrl,
  assertAnonymousEnvironment,
  assertExpectedChecksums,
  buildPublicAssetUrl,
  configFromArgs,
  exactAssetList,
  expectedAssetNames,
  parseChecksumManifest,
  releaseAssetIdentity,
  runGate,
  validateReleaseMetadata,
  validateVersionPolicy
} = require('../scripts/github-release-gate');

const version = '0.10.1-preview.1';
const tag = `v${version}`;
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);

function releaseFixture(mode = 'public') {
  const names = expectedAssetNames(version);
  return {
    id: 1234,
    tag_name: tag,
    draft: mode === 'draft',
    prerelease: true,
    published_at: mode === 'draft' ? null : '2026-08-14T00:00:00Z',
    assets: exactAssetList(version).map((name, index) => ({
      id: 2000 + index,
      name,
      state: 'uploaded',
      size: name === names.manifest ? 256 : 1024
    }))
  };
}

test('release gate is Preview-only and derives one exact three-file allowlist', () => {
  assert.equal(STABLE_ALLOWED, false);
  assert.equal(validateVersionPolicy(version, tag), version);
  assert.throws(
    () => validateVersionPolicy('0.10.1', 'v0.10.1'),
    /stableAllowed=false/
  );
  assert.throws(
    () => validateVersionPolicy(version, 'v0.10.1-preview.2'),
    /does not exactly match/
  );
  assert.deepEqual(exactAssetList(version), [
    `AgentDesk-${version}-portable-x64.exe`,
    `AgentDesk-${version}-universal.dmg`,
    'SHA256SUMS.txt'
  ]);
});

test('release metadata gate requires exact state, channel, publication state, and asset set', () => {
  const publicRelease = releaseFixture('public');
  const expectedAssetIdentity = releaseAssetIdentity(publicRelease.assets);
  const validated = validateReleaseMetadata(publicRelease, {
    mode: 'public',
    version,
    tag,
    expectedReleaseId: publicRelease.id,
    expectedAssetIdentity
  });
  assert.deepEqual(validated.expectedNames, exactAssetList(version));

  const draftRelease = releaseFixture('draft');
  assert.doesNotThrow(() => validateReleaseMetadata(draftRelease, { mode: 'draft', version, tag }));

  for (const mutate of [
    (release) => { release.draft = true; },
    (release) => { release.prerelease = false; },
    (release) => { release.published_at = null; },
    (release) => { release.assets[0].state = 'new'; },
    (release) => { release.assets.push({ id: 9999, name: 'diagnostics.zip', state: 'uploaded', size: 4 }); }
  ]) {
    const invalid = JSON.parse(JSON.stringify(publicRelease));
    mutate(invalid);
    assert.throws(
      () => validateReleaseMetadata(invalid, { mode: 'public', version, tag }),
      /Release|release|Preview/
    );
  }

  assert.throws(
    () => validateReleaseMetadata(publicRelease, {
      mode: 'public', version, tag, expectedReleaseId: 9999, expectedAssetIdentity
    }),
    /Release id drifted/
  );
  assert.throws(
    () => validateReleaseMetadata(publicRelease, {
      mode: 'public', version, tag, expectedReleaseId: publicRelease.id, expectedAssetIdentity: 'changed'
    }),
    /asset id, byte size, or upload state drifted/
  );
});

test('checksum gate requires two sorted allowlisted lines and matches pre-publication digests', () => {
  const names = expectedAssetNames(version);
  const manifest = `${digestB}  ${names.windows}\n${digestA}  ${names.macos}\n`;
  const entries = parseChecksumManifest(manifest, version);
  assert.doesNotThrow(() => assertExpectedChecksums(entries, names, {
    macos: digestA,
    windows: digestB
  }));

  assert.throws(
    () => parseChecksumManifest(`${digestA}  ${names.macos}\n${digestB}  ${names.windows}\n`, version),
    /sorted/
  );
  assert.throws(
    () => parseChecksumManifest(`${manifest}${digestC}  diagnostics.zip\n`, version),
    /exactly two/
  );
  assert.throws(
    () => assertExpectedChecksums(entries, names, { macos: digestC, windows: digestB }),
    /pre-publication/
  );
});

test('public gate constructs exact anonymous HTTPS URLs and refuses token-bearing environments', () => {
  assert.equal(
    buildPublicAssetUrl('shuqianglin1997/agent-desk', tag, 'SHA256SUMS.txt'),
    `https://github.com/shuqianglin1997/agent-desk/releases/download/${tag}/SHA256SUMS.txt`
  );
  assert.doesNotThrow(() => assertAllowedHttpsUrl('https://release-assets.githubusercontent.com/file'));
  assert.throws(() => assertAllowedHttpsUrl('http://github.com/file'), /HTTPS GitHub asset host/);
  assert.throws(() => assertAllowedHttpsUrl('https://example.com/file'), /host allowlist/);
  assert.doesNotThrow(() => assertAnonymousEnvironment({ GITHUB_TOKEN: '', GH_TOKEN: '' }));
  assert.throws(() => assertAnonymousEnvironment({ GITHUB_TOKEN: 'secret' }), /refuses non-empty/);
});

test('CLI gate keeps diagnostic reports physically outside release downloads', () => {
  const baseArgs = [
    '--mode', 'public',
    '--repository', 'shuqianglin1997/agent-desk',
    '--tag', tag,
    '--version', version,
    '--release-id', '1234',
    '--asset-identity', releaseAssetIdentity(releaseFixture('public').assets),
    '--artifact', 'macos',
    '--output-dir', '/tmp/release-assets',
    '--macos-sha256', digestA,
    '--windows-sha256', digestB,
    '--manifest-sha256', digestC
  ];

  assert.throws(
    () => configFromArgs([...baseArgs, '--report', '/tmp/release-assets/report.json'], {}),
    /physically outside/
  );
  const config = configFromArgs(
    [...baseArgs, '--report', '/tmp/release-diagnostics/report.json'],
    { GITHUB_TOKEN: '', GH_TOKEN: '' }
  );
  assert.equal(config.mode, 'public');
  assert.equal(config.token, '');
  assert.equal(config.expectedReleaseId, 1234);
  assert.equal(config.expectedAssetIdentity, releaseAssetIdentity(releaseFixture('public').assets));

  const releaseIdIndex = baseArgs.indexOf('--release-id');
  const withoutReleaseId = [
    ...baseArgs.slice(0, releaseIdIndex),
    ...baseArgs.slice(releaseIdIndex + 2),
    '--report',
    '/tmp/release-diagnostics/report.json'
  ];
  assert.throws(
    () => configFromArgs(withoutReleaseId, { GITHUB_TOKEN: '', GH_TOKEN: '' }),
    /release-id is required/
  );

  const assetIdentityIndex = baseArgs.indexOf('--asset-identity');
  const withoutAssetIdentity = [
    ...baseArgs.slice(0, assetIdentityIndex),
    ...baseArgs.slice(assetIdentityIndex + 2),
    '--report',
    '/tmp/release-diagnostics/report.json'
  ];
  assert.throws(
    () => configFromArgs(withoutAssetIdentity, { GITHUB_TOKEN: '', GH_TOKEN: '' }),
    /asset-identity is required/
  );
});

test('public gate anonymously downloads exact URLs and verifies all three hash authorities', async (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-release-gate-test-'));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const outputDirectory = path.join(temporaryRoot, 'release-assets');
  const reportPath = path.join(temporaryRoot, 'diagnostics', 'gate.json');
  const names = expectedAssetNames(version);
  const dmgBytes = Buffer.from('signed-notarized-dmg-fixture');
  const windowsBytes = Buffer.from('signed-windows-fixture');
  const macosSha256 = crypto.createHash('sha256').update(dmgBytes).digest('hex');
  const windowsSha256 = crypto.createHash('sha256').update(windowsBytes).digest('hex');
  const manifestBytes = Buffer.from(
    `${windowsSha256}  ${names.windows}\n${macosSha256}  ${names.macos}\n`
  );
  const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  const requests = [];

  const fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization || null });
    if (url.startsWith('https://api.github.com/')) {
      return new Response(JSON.stringify(releaseFixture('public')), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.endsWith('/SHA256SUMS.txt')) return new Response(manifestBytes, { status: 200 });
    if (url.endsWith(`/${names.macos}`)) return new Response(dmgBytes, { status: 200 });
    throw new Error(`Unexpected test URL: ${url}`);
  };

  const report = await runGate({
    mode: 'public',
    artifact: 'macos',
    repository: 'shuqianglin1997/agent-desk',
    tag,
    version,
    outputDirectory,
    reportPath,
    token: '',
    expected: { macos: macosSha256, windows: windowsSha256, manifest: manifestSha256 },
    expectedReleaseId: 1234,
    expectedAssetIdentity: releaseAssetIdentity(releaseFixture('public').assets)
  }, { fetch });

  assert.equal(report.result, 'passed');
  assert.deepEqual(requests.map((request) => request.authorization), [null, null, null]);
  assert.deepEqual(requests.map((request) => request.url), [
    `https://api.github.com/repos/shuqianglin1997/agent-desk/releases/tags/${tag}`,
    `https://github.com/shuqianglin1997/agent-desk/releases/download/${tag}/SHA256SUMS.txt`,
    `https://github.com/shuqianglin1997/agent-desk/releases/download/${tag}/${names.macos}`
  ]);
  assert.deepEqual(fs.readFileSync(path.join(outputDirectory, names.macos)), dmgBytes);
  assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).result, 'passed');
});
