const { test } = require('node:test');
const assert = require('node:assert');

const updater = require('../src/updater');

function asset(name, overrides = {}) {
  return {
    id: 1,
    name,
    state: 'uploaded',
    size: 1024,
    digest: `sha256:${'a'.repeat(64)}`,
    browser_download_url: `https://github.com/shuqianglin1997/agent-desk/releases/download/v0.3.0/${encodeURIComponent(name)}`,
    ...overrides
  };
}

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

test('旧版没有 portable 字样的 exe 仍可作为回退资产', () => {
  const release = { assets: [asset('AgentDesk 0.3.0.exe')] };
  assert.equal(updater.selectReleaseAsset(release, 'win32', 'x64').name, 'AgentDesk 0.3.0.exe');
});

test('Release URL 和下载 URL 被固定在官方仓库', () => {
  assert.equal(
    updater.trustedGitHubUrl(
      'https://github.com/shuqianglin1997/agent-desk/releases/tag/v0.3.0',
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

test('resolveRelease 输出更新信息和 GitHub SHA-256', () => {
  const release = {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/shuqianglin1997/agent-desk/releases/tag/v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-07-16T00:00:00Z',
    assets: [asset('AgentDesk-0.3.0-portable-x64.exe')]
  };
  const result = updater.resolveRelease(release, {
    currentVersion: '0.2.0',
    platform: 'win32',
    arch: 'x64'
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '0.3.0');
  assert.equal(result.asset.sha256, 'a'.repeat(64));
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
