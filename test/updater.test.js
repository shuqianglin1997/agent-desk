const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const updater = require('../src/updater');

// The three files every unsigned test build publishes (.github/workflows/test-build.yml).
const TEST_BUILD_FILES = ['Catshelf-unsigned-universal.dmg', 'Catshelf-unsigned-portable-x64.exe', 'SHA256SUMS.txt'];
const OWN = 'a'.repeat(40);
const LATEST = `bcdef12${'0'.repeat(33)}`;
const TAG = 'test-20261127-bcdef12';

function asset(name, overrides = {}) {
  return {
    id: 1,
    name,
    state: 'uploaded',
    size: 1024,
    digest: `sha256:${'a'.repeat(64)}`,
    browser_download_url: `https://github.com/shuqianglin1997/catshelf/releases/download/v0.3.0/${encodeURIComponent(name)}`,
    ...overrides
  };
}

function testRelease(overrides = {}) {
  return {
    tag_name: TAG,
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    published_at: '2026-11-27T01:00:00Z',
    html_url: `https://github.com/shuqianglin1997/catshelf/releases/tag/${TAG}`,
    assets: TEST_BUILD_FILES.map((name) => asset(name)),
    ...overrides
  };
}

// A fake GitHub: answers by URL, records every call. No network.
function fakeGitHub(routes) {
  const calls = [];
  const request = async (url, accept) => {
    calls.push({ url, accept });
    for (const [match, answer] of routes) {
      if (url.includes(match)) {
        const value = typeof answer === 'function' ? answer(url) : answer;
        return {
          status: value.status ?? 200,
          headers: { get: (name) => (value.headers || {})[name.toLowerCase()] ?? null },
          text: typeof value.body === 'string' ? value.body : JSON.stringify(value.body)
        };
      }
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { calls, request };
}

const comparison = (status, ahead, behind) => ({ body: { status, ahead_by: ahead, behind_by: behind, total_commits: ahead, commits: [] } });

test('版本比较支持 v 前缀、补丁版本和 prerelease', () => {
  assert.equal(updater.compareVersions('v0.3.0', '0.2.9'), 1);
  assert.equal(updater.compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(updater.compareVersions('0.3.0-beta.2', '0.3.0-beta.1'), 1);
  assert.equal(updater.compareVersions('0.3.0', '0.3.0-beta.9'), 1);
  assert.equal(updater.compareVersions('bad', '0.3.0'), null);
});

test('Windows 优先选择 portable x64，不会误选安装器', () => {
  const release = {
    assets: [
      asset('AgentDesk-0.3.0-Setup.exe'),
      asset('AgentDesk-0.3.0-portable-arm64.exe'),
      asset('AgentDesk 0.3.0.exe'),
      asset('AgentDesk-0.3.0-portable-x64.exe')
    ]
  };
  assert.equal(
    updater.selectReleaseAsset(release, 'win32', 'x64').name,
    'AgentDesk-0.3.0-portable-x64.exe'
  );
});

test('不会把其他架构的 portable 当成当前 Windows 更新包', () => {
  const release = {
    assets: [
      asset('AgentDesk-0.3.0-portable-arm64.exe')
    ]
  };
  assert.equal(updater.selectReleaseAsset(release, 'win32', 'x64'), null);
});

test('改名后的发布文件（Catshelf-…）和改名前的（AgentDesk-…）都认，别的名字不认', () => {
  assert.equal(updater.selectReleaseAsset({ assets: [asset('Catshelf-0.3.0-portable-x64.exe')] }, 'win32', 'x64').name, 'Catshelf-0.3.0-portable-x64.exe');
  assert.equal(updater.selectReleaseAsset({ assets: [asset('Catshelf-0.3.0-universal.dmg')] }, 'darwin', 'arm64').name, 'Catshelf-0.3.0-universal.dmg');
  assert.equal(updater.selectReleaseAsset({ assets: [asset('AgentDesk-0.3.0-universal.dmg')] }, 'darwin', 'arm64').name, 'AgentDesk-0.3.0-universal.dmg');
  assert.equal(updater.selectReleaseAsset({ assets: [asset('Other-0.3.0-universal.dmg')] }, 'darwin', 'arm64'), null);
});

test('测试版的三个真实文件名：Mac 两种芯片都选通用 DMG，Windows x64 选便携版，校验和文件从不当安装包', () => {
  const release = { assets: TEST_BUILD_FILES.map((name) => asset(name)) };
  assert.equal(updater.selectReleaseAsset(release, 'darwin', 'arm64').name, 'Catshelf-unsigned-universal.dmg');
  assert.equal(updater.selectReleaseAsset(release, 'darwin', 'x64').name, 'Catshelf-unsigned-universal.dmg');
  assert.equal(updater.selectReleaseAsset(release, 'win32', 'x64').name, 'Catshelf-unsigned-portable-x64.exe');
  assert.equal(updater.selectReleaseAsset(release, 'win32', 'arm64'), null, 'an x64 portable is not offered to Windows on Arm');
  assert.equal(updater.selectReleaseAsset(release, 'linux', 'x64'), null);
  assert.equal(updater.selectReleaseAsset({ assets: [asset('SHA256SUMS.txt')] }, 'darwin', 'arm64'), null);
});

test('旧版没有 portable 字样的 exe 仍可作为回退资产', () => {
  const release = { assets: [asset('AgentDesk 0.3.0.exe')] };
  assert.equal(updater.selectReleaseAsset(release, 'win32', 'x64').name, 'AgentDesk 0.3.0.exe');
});

test('Release URL 和下载 URL 被固定在官方仓库', () => {
  assert.equal(
    updater.trustedGitHubUrl(
      'https://github.com/shuqianglin1997/catshelf/releases/tag/v0.3.0',
      'release'
    ),
    true
  );
  assert.equal(
    updater.trustedGitHubUrl(
      'https://github.com/attacker/agent-desk/releases/download/v0.3.0/AgentDesk.exe',
      'asset'
    ),
    false
  );
  assert.equal(
    updater.isTrustedDownloadResponseUrl(
      'https://release-assets.githubusercontent.com/github-production-release-asset/file.exe'
    ),
    true
  );
  assert.equal(
    updater.isTrustedDownloadResponseUrl('https://downloads.example.com/AgentDesk.exe'),
    false
  );
});

test('describeRelease：v* 版本带版本号和 GitHub SHA-256；测试版没有版本号；草稿、预发布和认不出的标签都拒绝', () => {
  const formal = updater.describeRelease({
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/shuqianglin1997/catshelf/releases/tag/v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-07-16T00:00:00Z',
    assets: [asset('AgentDesk-0.3.0-portable-x64.exe')]
  }, { platform: 'win32', arch: 'x64' });
  assert.equal(formal.kind, 'version');
  assert.equal(formal.version, '0.3.0');
  assert.equal(formal.asset.sha256, 'a'.repeat(64));

  const test = updater.describeRelease(testRelease(), { platform: 'darwin', arch: 'arm64' });
  assert.equal(test.kind, 'test');
  assert.equal(test.version, null);
  assert.equal(test.tag, TAG);
  assert.equal(test.asset.name, 'Catshelf-unsigned-universal.dmg');

  for (const bad of [{ ...testRelease(), draft: true }, { ...testRelease(), prerelease: true }, { ...testRelease(), tag_name: 'nightly' }, null]) {
    assert.throws(() => updater.describeRelease(bad, {}), (error) => error.code === 'release-invalid');
  }
});

test('新旧判断：测试版按提交（相同、更新、更旧、分叉、不知道自己的提交），正式版按版本号，两者混用也不会降级', () => {
  const decide = (input) => updater.decideUpdate(input);
  const own = { version: '0.10.1-preview.1', commit: OWN };
  // Test builds: by commit through GitHub's comparison own...latest.
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: OWN } }), { state: 'current', reasonCode: null });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'ahead' }), { state: 'newer', reasonCode: null });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'behind' }), { state: 'older', reasonCode: null });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'diverged' }), { state: 'diverged', reasonCode: null });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'identical' }), { state: 'current', reasonCode: null });
  assert.deepEqual(decide({ kind: 'test', current: { version: '0.10.1-preview.1', commit: null }, latest: { commit: LATEST } }), { state: 'unknown', reasonCode: 'current-commit-unknown' });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'not-found' }), { state: 'unknown', reasonCode: 'current-commit-not-on-github' });
  assert.deepEqual(decide({ kind: 'test', current: own, latest: { commit: LATEST }, comparison: 'invalid' }), { state: 'unknown', reasonCode: 'comparison-unavailable' });
  // The same package version never decides between test builds.
  assert.equal(decide({ kind: 'test', current: { version: '9.9.9', commit: OWN }, latest: { version: null, commit: LATEST }, comparison: 'ahead' }).state, 'newer');

  // v* releases: by version, as before.
  assert.equal(decide({ kind: 'version', current: own, latest: { version: '0.10.1-preview.2' } }).state, 'newer');
  assert.equal(decide({ kind: 'version', current: own, latest: { version: '0.10.1-preview.1' } }).state, 'current', 'a test build of the same version is not downgraded or reinstalled');
  assert.equal(decide({ kind: 'version', current: { version: '0.11.0', commit: OWN }, latest: { version: '0.10.1' } }).state, 'older');
  assert.deepEqual(decide({ kind: 'version', current: { version: 'source', commit: null }, latest: { version: '0.11.0' } }), { state: 'unknown', reasonCode: 'version-unreadable' });
  // A v* copy meeting a test build as Latest is ordered by commit, so an
  // older test build is never offered to it.
  assert.equal(decide({ kind: 'test', current: { version: '0.11.0', commit: OWN }, latest: { commit: LATEST }, comparison: 'behind' }).state, 'older');
});

test('GitHub 的比较结果只在状态和计数一致时才算数', () => {
  assert.equal(updater.parseComparison({ status: 'ahead', ahead_by: 3, behind_by: 0 }), 'ahead');
  assert.equal(updater.parseComparison({ status: 'behind', ahead_by: 0, behind_by: 2 }), 'behind');
  assert.equal(updater.parseComparison({ status: 'diverged', ahead_by: 1, behind_by: 1 }), 'diverged');
  assert.equal(updater.parseComparison({ status: 'identical', ahead_by: 0, behind_by: 0 }), 'identical');
  assert.equal(updater.parseComparison({ status: 'ahead', ahead_by: 3, behind_by: 1 }), null);
  assert.equal(updater.parseComparison({ status: 'ahead', ahead_by: '3', behind_by: 0 }), null);
  assert.equal(updater.parseComparison({ status: 'weird', ahead_by: 0, behind_by: 0 }), null);
  assert.equal(updater.parseComparison(null), null);
});

test('测试版的提交以 GitHub 解析标签的结果为准，target_commitish 和标签名里的短提交号只能印证不能改写', () => {
  assert.equal(updater.confirmReleaseCommit(testRelease(), LATEST), LATEST, 'a branch name in target_commitish is ignored');
  assert.equal(updater.confirmReleaseCommit(testRelease({ target_commitish: LATEST }), `${LATEST}\n`), LATEST);
  assert.throws(() => updater.confirmReleaseCommit(testRelease({ target_commitish: OWN }), LATEST), (error) => error.code === 'release-commit-mismatch');
  assert.throws(() => updater.confirmReleaseCommit(testRelease({ tag_name: 'test-20261127-1234567' }), LATEST), (error) => error.code === 'release-commit-mismatch');
  assert.throws(() => updater.confirmReleaseCommit(testRelease(), 'not-a-commit'), (error) => error.code === 'release-commit-unknown');
  assert.equal(updater.tagCommitHint('test-20261127-bcdef12'), 'bcdef12');
  assert.equal(updater.tagCommitHint('v0.3.0'), null);
  assert.equal(updater.tagCommitHint('test-20261127'), null, 'a date alone is not a commit');
  assert.equal(updater.tagCommitHint('test-20261127-rc-bcdef12'), null);
  assert.match(updater.tagCommitUrl(TAG), /\/repos\/shuqianglin1997\/catshelf\/commits\/refs\/tags\/test-20261127-bcdef12$/);
  assert.match(updater.compareUrl(OWN, LATEST), new RegExp(`/compare/${OWN}\\.\\.\\.${LATEST}\\?per_page=1&page=2$`));
});

test('一次检查：Latest、标签的提交、一次比较；比较说更新才提示，结果里有标签、日期、提交和 DMG 的摘要', async () => {
  const github = fakeGitHub([
    ['/releases/latest', { body: testRelease() }],
    ['/commits/refs/tags/', { body: `${LATEST}\n` }],
    ['/compare/', comparison('ahead', 4, 0)]
  ]);
  const memo = { tags: new Map(), comparisons: new Map() };
  const result = await updater.checkLatestRelease({
    current: { version: '0.10.1-preview.1', commit: OWN, dirty: false },
    platform: 'darwin',
    arch: 'arm64',
    request: github.request,
    memo
  });
  assert.equal(result.state, 'newer');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.kind, 'test');
  assert.equal(result.tag, TAG);
  assert.equal(result.commit, LATEST);
  assert.equal(result.publishedAt, '2026-11-27T01:00:00Z');
  assert.equal(result.asset.name, 'Catshelf-unsigned-universal.dmg');
  assert.equal(result.asset.sha256, 'a'.repeat(64));
  assert.deepEqual(result.current, { version: '0.10.1-preview.1', commit: OWN, dirty: false });
  assert.deepEqual(github.calls.map((call) => call.accept), ['application/vnd.github+json', 'application/vnd.github.sha', 'application/vnd.github+json']);
  assert.ok(github.calls[2].url.includes(`/compare/${OWN}...${LATEST}?per_page=1&page=2`));

  // The tag's commit and the comparison are kept: the next check is one call.
  await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', request: github.request, memo });
  assert.equal(github.calls.length, 4);
  assert.ok(github.calls[3].url.endsWith('/releases/latest'));
});

test('一次检查：自己就是 Latest 时不做比较；不知道自己的提交时老实说无法判断；提交不在 GitHub 上也说无法判断', async () => {
  let github = fakeGitHub([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: LATEST }]]);
  let result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: LATEST }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'current');
  assert.equal(result.updateAvailable, false);
  assert.equal(github.calls.length, 2);

  github = fakeGitHub([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: LATEST }]]);
  result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: null }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reasonCode, 'current-commit-unknown');
  assert.equal(result.releaseUrl, `https://github.com/shuqianglin1997/catshelf/releases/tag/${TAG}`);
  assert.equal(github.calls.length, 2);

  github = fakeGitHub([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: LATEST }], ['/compare/', { status: 404, body: { message: 'Not Found' } }]]);
  result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reasonCode, 'current-commit-not-on-github');

  github = fakeGitHub([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: LATEST }], ['/compare/', comparison('behind', 0, 2)]]);
  result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'older');
  assert.equal(result.updateAvailable, false);

  github = fakeGitHub([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: LATEST }], ['/compare/', comparison('diverged', 1, 3)]]);
  result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'diverged');
  assert.equal(result.updateAvailable, false);
});

test('一次检查：正式版 Latest 按版本号比，不去查提交', async () => {
  const github = fakeGitHub([['/releases/latest', { body: {
    tag_name: 'v0.10.2', draft: false, prerelease: false,
    html_url: 'https://github.com/shuqianglin1997/catshelf/releases/tag/v0.10.2',
    assets: [asset('Catshelf-0.10.2-universal.dmg'), asset('Catshelf-0.10.2-portable-x64.exe')]
  } }]]);
  const result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'win32', arch: 'x64', request: github.request });
  assert.equal(result.state, 'newer');
  assert.equal(result.version, '0.10.2');
  assert.equal(result.asset.name, 'Catshelf-0.10.2-portable-x64.exe');
  assert.equal(github.calls.length, 1);
});

test('一次检查的失败都是固定原因码：没有发布、查询次数用完（带恢复时间）、标签对不上、查询失败', async () => {
  const run = (routes) => updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', request: fakeGitHub(routes).request });
  await assert.rejects(run([['/releases/latest', { status: 404, body: {} }]]), (error) => error.code === 'no-release');
  await assert.rejects(run([['/releases/latest', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' }, body: {} }]]),
    (error) => error.code === 'rate-limited' && error.details.resetAt === 1900000000 * 1000);
  await assert.rejects(run([['/releases/latest', { status: 500, body: {} }]]), (error) => error.code === 'query-failed' && error.details.status === 500);
  await assert.rejects(run([['/releases/latest', { body: 'not json' }]]), (error) => error.code === 'unparsable');
  await assert.rejects(run([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { body: OWN }]]), (error) => error.code === 'release-commit-mismatch');
  await assert.rejects(run([['/releases/latest', { body: testRelease() }], ['/commits/refs/tags/', { status: 404, body: {} }]]), (error) => error.code === 'release-commit-unknown');
});

test('能不能自己替换：Windows 便携版认测试版；Mac 只替换 /Applications 里的猫架，翻译位置、别处、没有写权限、开发模式都退回发布页', () => {
  const newer = { updateAvailable: true, asset: { sha256: 'a'.repeat(64) } };
  const portable = path.win32.join('D:\\', 'Tools', 'Catshelf.exe');
  const win = (overrides = {}) => updater.installCapability(newer, {
    platform: 'win32', packaged: true, env: { PORTABLE_EXECUTABLE_FILE: portable }, exists: () => true, writable: () => true, ...overrides
  });
  assert.deepEqual(win(), { installSupported: true, mode: 'windows-portable', reasonCode: null, targetPath: portable });
  assert.equal(win({ env: {} }).reasonCode, 'not-portable');
  assert.equal(win({ writable: () => false }).reasonCode, 'not-writable');
  assert.equal(win({ packaged: false }).reasonCode, 'dev-mode');

  const bundle = path.posix.join('/Applications', 'Catshelf.app');
  const executable = path.posix.join(bundle, 'Contents', 'MacOS', 'Catshelf');
  const writableHere = new Set([path.posix.dirname(bundle), bundle]);
  const mac = (overrides = {}) => updater.installCapability(newer, {
    platform: 'darwin', packaged: true, execPath: executable, exists: () => true, writable: (file) => writableHere.has(file), ...overrides
  });
  assert.deepEqual(mac(), { installSupported: true, mode: 'macos-app', reasonCode: null, targetPath: bundle });
  assert.equal(mac({ execPath: path.posix.join('/private/var/folders/xy/T/AppTranslocation/1A2B/d', 'Catshelf.app', 'Contents', 'MacOS', 'Catshelf') }).reasonCode, 'app-translocation');
  assert.equal(mac({ execPath: path.posix.join('/Users/me/Downloads', 'Catshelf.app', 'Contents', 'MacOS', 'Catshelf') }).reasonCode, 'not-in-applications');
  assert.equal(mac({ execPath: path.posix.join('/Volumes/Catshelf', 'Catshelf.app', 'Contents', 'MacOS', 'Catshelf') }).reasonCode, 'not-in-applications');
  assert.equal(mac({ writable: () => false }).reasonCode, 'not-writable');
  assert.equal(mac({ writable: (file) => file === bundle }).reasonCode, 'not-writable', '/Applications itself must be writable to rename the bundle');
  assert.equal(mac({ packaged: false }).reasonCode, 'dev-mode');
  for (const capability of [mac(), win()]) assert.equal(capability.installSupported, true);
  // Every fallback is the release page.
  for (const capability of [mac({ packaged: false }), win({ env: {} })]) assert.equal(capability.mode, 'release-page');

  assert.equal(updater.installCapability({ updateAvailable: true, asset: null }, { platform: 'darwin' }).reasonCode, 'no-asset');
  assert.equal(updater.installCapability({ updateAvailable: true, asset: { sha256: null } }, { platform: 'darwin' }).reasonCode, 'no-digest');
  assert.equal(updater.installCapability(newer, { platform: 'linux', packaged: true }).reasonCode, 'unsupported-platform');
  assert.deepEqual(updater.installCapability({ updateAvailable: false, asset: null }, { platform: 'darwin' }), { installSupported: false, mode: 'none', reasonCode: null, targetPath: null });
});

function bindUpdates(release, overrides = {}) {
  delete require.cache[require.resolve('../src/main/updates')];
  const updates = require('../src/main/updates');
  const opened = [];
  updates.bind({
    APP_NAME: 'Catshelf',
    app: { getVersion: () => '0.10.1-preview.1', isPackaged: false, getPath: () => path.join(__dirname, 'no-such-folder') },
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    // Latest without update-manifest.json unless a test gives one.
    net: {
      ...(overrides.net || {}),
      fetch: overrides.net?.fetch || (async (url) => {
        if (url.includes('/releases/latest')) return { status: 200, headers: new Map(), text: async () => JSON.stringify(release) };
        if (url.includes('/commits/refs/tags/')) return { status: 200, headers: new Map(), text: async () => LATEST };
        throw new Error(`unexpected ${url}`);
      }),
      request: overrides.net?.request || manifestNet(null).request
    },
    shell: { openExternal: async (url) => { opened.push(url); } },
    agentHub: { activeCount: () => 0 },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'net'))
  });
  return { updates, opened };
}

// Electron's net.request for the manifest: GitHub's redirect to its download
// host, then the file (404 when `manifest` is null).
function manifestNet(manifest, seen = []) {
  const { Readable } = require('node:stream');
  return fakeNet((request) => {
    seen.push(request.options.url);
    if (manifest === null) {
      request.emit('response', Object.assign(Readable.from([]), { statusCode: 404 }));
      return;
    }
    request.emit('redirect', 302, 'GET', `https://github.com/shuqianglin1997/catshelf/releases/download/${TAG}/update-manifest.json`);
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/github-production-release-asset/2?sig=x');
    const text = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    request.emit('response', Object.assign(Readable.from([Buffer.from(text)]), { statusCode: 200 }));
  });
}

// A source checkout records no commit (scripts/build-info.js), so a test build
// as Latest is "cannot tell", with the release page, never an install.
test('窗口里的检查：Latest 是测试版也算；源码运行不知道自己的提交，显示无法判断，按钮打开发布页', async () => {
  const { updates, opened } = bindUpdates(testRelease());
  const result = await updates.checkForUpdates({ force: true });
  assert.equal(result.ok, true);
  assert.equal(result.testBuild, true);
  assert.equal(result.state, 'unknown');
  assert.equal(result.reasonCode, 'current-commit-unknown');
  assert.match(result.reason, /^main\.upd\.code\.current-commit-unknown/);
  assert.equal(result.latestLabel, TAG);
  assert.equal(result.latest.commit, LATEST);
  assert.equal(result.current.commit, null);
  assert.equal(result.updateAvailable, false);
  assert.equal(result.activeHubRuns, 0);

  const installed = await updates.installLatestUpdate(null, {});
  assert.equal(installed.ok, true);
  assert.equal(installed.manual, true);
  assert.equal(installed.reasonCode, 'current-commit-unknown');
  assert.deepEqual(opened, [`https://github.com/shuqianglin1997/catshelf/releases/tag/${TAG}`]);
});

test('窗口里的检查失败时带固定原因码和一句话，并报出自己的版本', async () => {
  const { updates } = bindUpdates(null, {
    net: { fetch: async () => ({ status: 403, headers: new Map([['x-ratelimit-remaining', '0']]), text: async () => '{}' }) }
  });
  const result = await updates.checkForUpdates({ force: true });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'rate-limited');
  assert.match(result.reason, /^main\.upd\.code\.rate-limited/);
  assert.equal(result.current.version, '0.10.1-preview.1');
  // Waited out: no second request until GitHub's reset time.
  const again = await updates.checkForUpdates({ force: true });
  assert.equal(again.reasonCode, 'rate-limited');
});

test('每个固定原因码在中英日三种语言里都有一句话', () => {
  const fs = require('node:fs');
  const sources = ['src/updater.js', 'src/update-mac.js', 'src/main/updates.js']
    .map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  const codes = new Set(['replace-failed', 'update-failed', 'github-timeout']);
  for (const pattern of [/UpdateError\('([a-z-]+)'/g, /page\('([a-z-]+)'\)/g, /failure\('([a-z-]+)'\)/g, /reasonCode: '([a-z-]+)'/g]) {
    for (const match of sources.matchAll(pattern)) codes.add(match[1]);
  }
  // The macOS script's own codes, reported by the next check.
  for (const match of require('../src/update-mac').macUpdaterScript().matchAll(/\bfail ([a-z-]+)/g)) codes.add(match[1]);
  assert.ok(codes.size >= 45, `found ${codes.size} codes`);
  for (const lang of ['zh', 'en', 'ja']) {
    const table = require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang];
    for (const code of codes) assert.ok(table[`main.upd.code.${code}`], `${lang} has no sentence for ${code}`);
    const known = Object.keys(table).filter((key) => key.startsWith('main.upd.code.'));
    assert.equal(known.length, codes.size, `${lang}: a sentence for a code nothing reports`);
  }
});

test('portable executable 只接受绝对 exe 路径', () => {
  assert.equal(
    updater.portableExecutablePath({ PORTABLE_EXECUTABLE_FILE: '"D:\\Apps\\AgentDesk.exe"' }),
    'D:\\Apps\\AgentDesk.exe'
  );
  assert.equal(updater.portableExecutablePath({ PORTABLE_EXECUTABLE_FILE: 'AgentDesk.exe' }), null);
  assert.equal(updater.portableExecutablePath({}), null);
});

test('PowerShell 替换器包含等待、备份、回滚与重启', () => {
  const script = updater.windowsUpdaterScript();
  assert.match(script, /Get-Process -Id \$ProcessId/);
  assert.match(script, /Move-Item -LiteralPath \$Target -Destination \$Backup/);
  assert.match(script, /Move-Item -LiteralPath \$Backup -Destination \$Target/);
  assert.match(script, /Start-Process -FilePath \$Target/);
});

// Electron 43's ClientRequest emits 'finish' and 'close' as soon as the
// request is sent, before 'redirect' and 'response' (seen on a real download
// on 2026-11-26). An early 'close' is not an interruption.
function fakeNet(script) {
  const { EventEmitter } = require('node:events');
  return {
    request: (options) => {
      const request = new EventEmitter();
      request.options = options;
      request.followRedirect = () => { request.followed = (request.followed || 0) + 1; };
      request.abort = () => { request.aborted = true; request.emit('abort'); };
      request.end = () => {
        request.emit('finish');
        request.emit('close');
        setImmediate(() => script(request));
      };
      return request;
    }
  };
}

test('下载请求：Electron 先发 close 再跳转、再响应，照样下载；跳到不信任的主机就拒绝', async () => {
  const { Readable } = require('node:stream');
  const assetUrl = `https://github.com/shuqianglin1997/catshelf/releases/download/${TAG}/Catshelf-unsigned-universal.dmg`;
  const { updates } = bindUpdates(testRelease(), {
    net: fakeNet((request) => {
      request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x');
      request.emit('response', Object.assign(Readable.from([Buffer.from('dmg')]), { statusCode: 200 }));
    })
  });
  const download = updates.createTrustedDownloadRequest(assetUrl, {});
  const { response, finalUrl } = await download.response;
  assert.equal(response.statusCode, 200);
  assert.equal(new URL(finalUrl).hostname, 'release-assets.githubusercontent.com');
  assert.equal(download.request.followed, 1);
  assert.equal(download.request.options.redirect, 'manual');
  assert.equal(download.request.options.credentials, 'omit');

  const { updates: untrusted } = bindUpdates(testRelease(), {
    net: fakeNet((request) => request.emit('redirect', 302, 'GET', 'https://example.com/file.dmg'))
  });
  const refused = untrusted.createTrustedDownloadRequest(assetUrl, {});
  await assert.rejects(refused.response, (error) => error.code === 'download-untrusted' || /download-untrusted/.test(String(error.reasonCode || error.message)));
  assert.equal(refused.request.aborted, true);
});

// Slow is fine, stuck is not: a download that keeps bringing data runs past
// the old 30-minute limit (about 100 KB/s from GitHub was seen on 2026-11-27);
// two minutes without any data stop it with download-timeout.
function streamingDownload(t) {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const { Readable } = require('node:stream');
  const { makeTempDir } = require('./helpers/temp');
  const temp = makeTempDir(t, 'agentdesk-update-download-');
  const body = new Readable({ read() {} });
  let request;
  const { updates } = bindUpdates(testRelease(), {
    app: { getVersion: () => '0.10.1-preview.1', isPackaged: true, getPath: () => temp },
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    net: fakeNet((r) => {
      request = r;
      r.abort = () => { r.aborted = true; body.destroy(new Error('aborted')); r.emit('abort'); };
      r.emit('response', Object.assign(body, { statusCode: 200 }));
    })
  });
  const chunks = Array.from({ length: 41 }, (_, i) => Buffer.from(`chunk-${i};`));
  const all = Buffer.concat(chunks);
  const resolved = {
    tag: TAG,
    version: null,
    asset: { name: 'Catshelf-unsigned-universal.dmg', url: `https://github.com/shuqianglin1997/catshelf/releases/download/${TAG}/Catshelf-unsigned-universal.dmg`, size: all.length, sha256: crypto.createHash('sha256').update(all).digest('hex') }
  };
  return { updates, body, chunks, resolved, aborted: () => Boolean(request?.aborted) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('下载很慢但一直有数据，超过 30 分钟也照样下完；停两分钟没有数据才算超时', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slow = streamingDownload(t);
  const done = slow.updates.downloadReleaseAsset(slow.resolved, null);
  await settle();
  for (const chunk of slow.chunks.slice(0, -1)) {
    slow.body.push(chunk);
    await settle();
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(slow.aborted(), false, 'forty minutes of steady data is not a timeout');
  slow.body.push(slow.chunks.at(-1));
  slow.body.push(null);
  const file = await done;
  assert.equal(require('node:fs').readFileSync(file).length, slow.resolved.asset.size);

  const stuck = streamingDownload(t);
  const failing = stuck.updates.downloadReleaseAsset(stuck.resolved, null);
  await settle();
  stuck.body.push(stuck.chunks[0]);
  await settle();
  t.mock.timers.tick(119_000);
  await settle();
  assert.equal(stuck.aborted(), false);
  t.mock.timers.tick(2_000);
  await assert.rejects(failing, (error) => error.code === 'download-timeout' || /download-timeout/.test(String(error.reasonCode || error.message)));
  assert.equal(stuck.aborted(), true);
});

// update-manifest.json (written by .github/workflows/test-build.yml): the check
// reads it with an ordinary download instead of GitHub's 60 anonymous API calls
// an hour. Same rules as before: never a downgrade, another line of commits is
// not newer, an unknown own commit is "cannot tell".
const DMG_SHA = 'd'.repeat(64);
const EXE_SHA = 'e'.repeat(64);
const PARENT = `9${'1'.repeat(39)}`;

function manifest(overrides = {}) {
  return {
    schema: 1,
    repository: 'shuqianglin1997/catshelf',
    tag: TAG,
    kind: 'test',
    commit: LATEST,
    version: '0.10.1-preview.1',
    publishedAt: '2026-11-27T03:40:00Z',
    assets: [
      { name: 'Catshelf-unsigned-universal.dmg', size: 219210590, sha256: DMG_SHA },
      { name: 'Catshelf-unsigned-portable-x64.exe', size: 98765432, sha256: EXE_SHA }
    ],
    history: [LATEST, PARENT, OWN],
    ...overrides
  };
}

const served = (value, status = 200) => async () => ({ status, text: typeof value === 'string' ? value : JSON.stringify(value) });

test('更新清单：格式不对就拒绝；不认识的新格式交给 API；标签里的短提交号必须对得上', () => {
  const parsed = updater.parseManifest(JSON.stringify(manifest()));
  assert.equal(parsed.kind, 'test');
  assert.equal(parsed.commit, LATEST);
  assert.deepEqual(parsed.history, [LATEST, PARENT, OWN]);
  assert.equal(updater.parseManifest(JSON.stringify(manifest({ schema: 2, anything: true }))), null);
  const invalid = (value) => assert.throws(() => updater.parseManifest(typeof value === 'string' ? value : JSON.stringify(value)), (error) => error.code === 'manifest-invalid');
  invalid('not json');
  invalid('[]');
  invalid(manifest({ repository: 'someone/else' }));
  invalid(manifest({ kind: 'version' }));
  invalid(manifest({ commit: 'abc' }));
  invalid(manifest({ version: 'soon' }));
  invalid(manifest({ history: [PARENT, LATEST] }));
  invalid(manifest({ history: [LATEST, 'not-a-commit'] }));
  invalid(manifest({ history: Array.from({ length: 1001 }, () => LATEST) }));
  invalid(manifest({ assets: [] }));
  invalid(manifest({ assets: [{ name: '../Catshelf.dmg', size: 1, sha256: DMG_SHA }] }));
  invalid(manifest({ assets: [{ name: 'Catshelf-unsigned-universal.dmg', size: 0, sha256: DMG_SHA }] }));
  invalid(manifest({ assets: [{ name: 'Catshelf-unsigned-universal.dmg', size: 1, sha256: 'sha256:abc' }] }));
  invalid(manifest({ assets: [manifest().assets[0], manifest().assets[0]] }));
  invalid(`{"schema":1,"pad":"${'x'.repeat(updater.MANIFEST_MAX_BYTES)}"}`);
  assert.throws(() => updater.parseManifest(JSON.stringify(manifest({ tag: 'test-20261127-abcdef1' }))), (error) => error.code === 'release-commit-mismatch');
});

test('更新清单：相同提交是最新、自己的提交在 Latest 的历史里就是新版，都不花一次 API；文件和摘要来自清单', async () => {
  for (const [platform, arch, name, sha] of [['darwin', 'arm64', 'Catshelf-unsigned-universal.dmg', DMG_SHA], ['darwin', 'x64', 'Catshelf-unsigned-universal.dmg', DMG_SHA], ['win32', 'x64', 'Catshelf-unsigned-portable-x64.exe', EXE_SHA]]) {
    const github = fakeGitHub([]);
    const newer = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform, arch, fetchManifest: served(manifest()), request: github.request });
    assert.equal(newer.source, 'manifest');
    assert.equal(newer.state, 'newer');
    assert.equal(newer.updateAvailable, true);
    assert.equal(newer.tag, TAG);
    assert.equal(newer.commit, LATEST);
    assert.equal(newer.publishedAt, '2026-11-27T03:40:00Z');
    assert.equal(newer.releaseUrl, `https://github.com/shuqianglin1997/catshelf/releases/tag/${TAG}`);
    assert.equal(newer.asset.name, name);
    assert.equal(newer.asset.sha256, sha);
    assert.equal(newer.asset.url, `https://github.com/shuqianglin1997/catshelf/releases/download/${TAG}/${name}`);
    assert.ok(updater.trustedGitHubUrl(newer.asset.url, 'asset'));
    assert.deepEqual(github.calls, []);
  }
  const github = fakeGitHub([]);
  const same = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: LATEST }, platform: 'darwin', arch: 'arm64', fetchManifest: served(manifest()), request: github.request });
  assert.equal(same.state, 'current');
  assert.equal(same.updateAvailable, false);
  const unknown = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: null }, platform: 'darwin', arch: 'arm64', fetchManifest: served(manifest()), request: github.request });
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.reasonCode, 'current-commit-unknown');
  assert.deepEqual(github.calls, []);
});

test('更新清单：自己的提交不在历史里时只问一次比较；更旧不降级、分叉不算新、问不到就如实说无法判断', async () => {
  const ahead = 'f'.repeat(40);
  const ask = async (answer) => {
    const github = fakeGitHub([['/compare/', answer]]);
    const memo = { tags: new Map(), comparisons: new Map() };
    const result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: ahead }, platform: 'darwin', arch: 'arm64', fetchManifest: served(manifest()), request: github.request, memo });
    return { result, github };
  };
  const older = await ask(comparison('behind', 0, 3));
  assert.equal(older.result.state, 'older');
  assert.equal(older.result.updateAvailable, false);
  assert.equal(older.github.calls.length, 1);
  assert.match(older.github.calls[0].url, new RegExp(`/compare/${ahead}\\.\\.\\.${LATEST}\\?per_page=1&page=2$`));
  assert.equal((await ask(comparison('diverged', 2, 3))).result.state, 'diverged');
  assert.equal((await ask(comparison('ahead', 4, 0))).result.state, 'newer');
  const notOnGitHub = await ask({ status: 404, body: {} });
  assert.equal(notOnGitHub.result.reasonCode, 'current-commit-not-on-github');
  const limited = await ask({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' }, body: {} });
  assert.equal(limited.result.state, 'unknown');
  assert.equal(limited.result.reasonCode, 'rate-limited');
  assert.equal(limited.result.reasonDetails.resetAt, 1900000000 * 1000);
  const failed = await ask({ status: 500, body: {} });
  assert.equal(failed.result.state, 'unknown');
  assert.equal(failed.result.reasonCode, 'comparison-unavailable');
});

test('更新清单：没有清单（404）或格式更新的旧 release 照旧走 API；清单读失败带原因码；正式版的清单按版本号比', async () => {
  const routes = [
    ['/releases/latest', { body: testRelease() }],
    ['/commits/refs/tags/', { body: LATEST }],
    ['/compare/', comparison('ahead', 1, 0)]
  ];
  for (const fetchManifest of [served('', 404), served(manifest({ schema: 2 }))]) {
    const github = fakeGitHub(routes);
    const result = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', fetchManifest, request: github.request });
    assert.equal(result.source, 'api');
    assert.equal(result.state, 'newer');
    assert.equal(github.calls.length, 3);
  }
  await assert.rejects(
    updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', fetchManifest: served('', 500), request: fakeGitHub([]).request }),
    (error) => error.code === 'manifest-failed' && error.details.status === 500
  );
  await assert.rejects(
    updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', fetchManifest: served('{"schema":1}'), request: fakeGitHub([]).request }),
    (error) => error.code === 'manifest-invalid'
  );
  const formal = manifest({ tag: 'v0.10.1', kind: 'version', version: '0.10.1', commit: null, history: [] });
  const upgrade = await updater.checkLatestRelease({ current: { version: '0.10.1-preview.1', commit: OWN }, platform: 'darwin', arch: 'arm64', fetchManifest: served(formal), request: fakeGitHub([]).request });
  assert.equal(upgrade.kind, 'version');
  assert.equal(upgrade.state, 'newer');
  const downgrade = await updater.checkLatestRelease({ current: { version: '0.11.0', commit: OWN }, platform: 'darwin', arch: 'arm64', fetchManifest: served(formal), request: fakeGitHub([]).request });
  assert.equal(downgrade.state, 'older');
});

test('更新清单的下载只跟着 GitHub 自己的跳转走，最多五次', async () => {
  const hops = (locations) => {
    const seen = [];
    const get = async (url) => {
      seen.push(url);
      const next = locations.shift();
      return next ? { status: 302, headers: { get: (name) => (name === 'location' ? next : null) }, text: '' } : { status: 200, headers: { get: () => null }, text: '{}' };
    };
    return { seen, get };
  };
  const good = hops([`https://github.com/shuqianglin1997/catshelf/releases/download/${TAG}/update-manifest.json`, 'https://release-assets.githubusercontent.com/x?sig=1']);
  const response = await updater.fetchWithTrustedRedirects(good.get, updater.LATEST_MANIFEST_URL);
  assert.equal(response.status, 200);
  assert.equal(good.seen.length, 3);
  assert.equal(good.seen[0], 'https://github.com/shuqianglin1997/catshelf/releases/latest/download/update-manifest.json');
  const away = hops(['https://example.com/update-manifest.json']);
  await assert.rejects(updater.fetchWithTrustedRedirects(away.get, updater.LATEST_MANIFEST_URL), (error) => error.code === 'download-untrusted');
  assert.equal(away.seen.length, 1);
  const loop = hops(Array.from({ length: 6 }, () => 'https://github.com/shuqianglin1997/catshelf/releases/latest/download/update-manifest.json'));
  await assert.rejects(updater.fetchWithTrustedRedirects(loop.get, updater.LATEST_MANIFEST_URL), (error) => error.code === 'download-untrusted');
});

test('窗口里的检查读清单：不调 GitHub API；之前被限流也不挡清单；按钮和自动检查的缓存规则不变', async () => {
  const seen = [];
  const apiCalls = [];
  const { updates } = bindUpdates(testRelease(), {
    net: {
      request: manifestNet(manifest(), seen).request,
      fetch: async (url) => { apiCalls.push(url); return { status: 403, headers: new Map([['x-ratelimit-remaining', '0']]), text: async () => '{}' }; }
    }
  });
  const result = await updates.checkForUpdates({ force: true });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'manifest');
  assert.equal(result.latest.commit, LATEST);
  // A source checkout knows no commit of its own: cannot tell, honestly.
  assert.equal(result.reasonCode, 'current-commit-unknown');
  assert.deepEqual(apiCalls, []);
  assert.deepEqual(seen, ['https://github.com/shuqianglin1997/catshelf/releases/latest/download/update-manifest.json']);
  // The cached result is reused (ten minutes; the button one minute).
  await updates.checkForUpdates({ force: false });
  await updates.checkForUpdates({ force: true });
  assert.equal(seen.length, 1);

  // Rate-limited earlier by the API (a release without a manifest), the next
  // manifest read still goes through.
  const limitedSeen = [];
  const { updates: limited } = bindUpdates(testRelease(), {
    net: {
      request: (options) => (limitedSeen.length === 0 ? manifestNet(null, limitedSeen) : manifestNet(manifest(), limitedSeen)).request(options),
      fetch: async () => ({ status: 403, headers: new Map([['x-ratelimit-remaining', '0'], ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)]]), text: async () => '{}' })
    }
  });
  assert.equal((await limited.checkForUpdates({ force: true })).reasonCode, 'rate-limited');
  const after = await limited.checkForUpdates({ force: true });
  assert.equal(after.ok, true);
  assert.equal(after.source, 'manifest');
  assert.equal(after.latest.tag, TAG);
  assert.equal(limitedSeen.length, 2);
});

test('按钮总是重新查一次（一分钟内的结果除外）；窗口自己的自动检查用十分钟内的结果', () => {
  const { COMMANDS } = require('../src/commands/settings');
  const check = COMMANDS.find((command) => command.id === 'updates.check');
  assert.deepEqual(check.input(undefined), { force: true });
  assert.deepEqual(check.input({}), { force: true });
  assert.deepEqual(check.input({ automatic: true }), { force: false });
});

test('开始下载前清掉以前的下载：.partial、用过的安装包、旧脚本和空的挂载目录；只留上次的结果和日志', (t) => {
  const fs = require('node:fs');
  const { makeTempDir } = require('./helpers/temp');
  const updates = require('../src/main/updates');
  const directory = makeTempDir(t, 'catshelf-update-dir-');
  const files = [
    'test-20261126-51d795b-Catshelf-unsigned-universal.dmg.partial',
    'test-20261127-e56c8aa-Catshelf-unsigned-universal.dmg',
    '0.10.1-Catshelf-unsigned-portable-x64.exe',
    'apply-update-1764200000000.sh',
    'mac-update-result.json',
    'mac-update-result.json.log',
    'update-error.log'
  ];
  for (const name of files) fs.writeFileSync(path.join(directory, name), 'x');
  fs.mkdirSync(path.join(directory, 'mount-1-empty'));
  fs.mkdirSync(path.join(directory, 'mount-2-busy'));
  fs.writeFileSync(path.join(directory, 'mount-2-busy', 'Catshelf.app'), 'still mounted');
  fs.mkdirSync(path.join(directory, 'something-else'));

  const removed = updates.clearUpdateDirectory(directory).sort();
  assert.deepEqual(removed, [
    '0.10.1-Catshelf-unsigned-portable-x64.exe',
    'apply-update-1764200000000.sh',
    'mount-1-empty',
    'test-20261126-51d795b-Catshelf-unsigned-universal.dmg.partial',
    'test-20261127-e56c8aa-Catshelf-unsigned-universal.dmg'
  ]);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['mac-update-result.json', 'mac-update-result.json.log', 'mount-2-busy', 'something-else', 'update-error.log']);
  assert.ok(fs.existsSync(path.join(directory, 'mount-2-busy', 'Catshelf.app')));
  assert.deepEqual(updates.clearUpdateDirectory(path.join(directory, 'missing')), []);
});

test('窗口：检查更新在设置最上面，有新版的标记和“系统”上的点；确认框是窗口自己的对话框，按钮跟着界面语言', async () => {
  const fs = require('node:fs');
  const { page, loadPreload, runCommand, declared } = require('./helpers/behaviour');
  const doc = page();
  const settings = doc.byId('systemSettings');
  const lines = doc.all((el) => el.tag === 'div' && /\bsystem-setting-line\b/.test(el.attrs.class || '') && doc.within(el, settings));
  assert.ok(doc.within(doc.byId('updateBtn'), lines[0]), 'the update line is the first setting');
  assert.ok(doc.within(doc.byId('updateAvailableBadge'), lines[0]));
  assert.ok('hidden' in doc.byId('updateAvailableBadge').attrs);
  assert.equal(doc.byId('updateAvailableBadge').attrs['data-i18n'], 'update.badge.available');

  const dialog = doc.byId('updateConfirmDialog');
  assert.equal(dialog.tag, 'dialog');
  const buttons = doc.all((el) => el.tag === 'button' && doc.within(el, dialog));
  assert.deepEqual(buttons.map((el) => el.attrs.value), ['cancel', 'confirm'], 'Cancel comes first, so Enter is no');
  assert.equal(buttons[0].attrs['data-i18n'], 'dialog.cancel');
  assert.equal(buttons[1].attrs.id, 'updateConfirmBtn');

  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'updates.js'), 'utf8');
  assert.doesNotMatch(view, /window\.confirm\(/);
  assert.match(view, /toLocaleDateString\(dateLocale\(\)\)/);
  assert.ok(declared('.topbar-actions .topbar-nav-button.has-update::after', 'background'));
  for (const lang of ['zh', 'en', 'ja']) {
    const table = require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang];
    for (const key of ['dialog.cancel', 'update.confirm.title', 'update.confirm.unknownTitle', 'update.confirm.hubRunsTitle', 'update.confirm.restart', 'update.confirm.openPage', 'update.confirm.restartAnyway', 'update.badge.available', 'topbar.system.titleUpdate']) {
      assert.ok(table[key], `${lang} has ${key}`);
    }
  }

  // The window's own check passes { automatic: true } through the preload.
  const { api, calls } = loadPreload();
  await api.checkForUpdates({ automatic: true });
  assert.deepEqual(calls.at(-1), ['invoke', 'updates:check', { automatic: true }]);
  const forced = [];
  await runCommand('updates:check', { checkForUpdates: async (options) => { forced.push(options); return { ok: true }; } }, { automatic: true });
  await runCommand('updates:check', { checkForUpdates: async (options) => { forced.push(options); return { ok: true }; } }, undefined);
  assert.deepEqual(forced, [{ force: false }, { force: true }]);
});
