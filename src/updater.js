/*
 * AgentDesk — GitHub Releases update helpers.
 *
 * Pure Node module so release parsing, asset selection, URL trust boundaries,
 * version comparison, and the Windows portable replacement script can be
 * unit-tested without Electron or network access.
 */

const path = require('node:path');

const REPOSITORY = Object.freeze({
  owner: 'shuqianglin1997',
  name: 'agent-desk'
});

const REPOSITORY_PATH = `/${REPOSITORY.owner}/${REPOSITORY.name}`;
const RELEASES_URL = `https://github.com${REPOSITORY_PATH}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/releases/latest`;
const GITHUB_API_VERSION = '2026-03-10';

function parseVersion(value) {
  const input = String(value || '').trim().replace(/^v/i, '');
  const match = input.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    text: input,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart, 'en', { sensitivity: 'base' }) > 0 ? 1 : -1;
  }
  return 0;
}

function trustedGitHubUrl(value, kind) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return false;
    const pathname = url.pathname.toLowerCase();
    const repositoryPath = REPOSITORY_PATH.toLowerCase();
    if (kind === 'asset') return pathname.startsWith(`${repositoryPath}/releases/download/`);
    return pathname === `${repositoryPath}/releases` ||
      pathname.startsWith(`${repositoryPath}/releases/`);
  } catch (_error) {
    return false;
  }
}

function isTrustedDownloadResponseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return [
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com'
    ].includes(url.hostname.toLowerCase());
  } catch (_error) {
    return false;
  }
}

function sha256FromDigest(value) {
  const match = String(value || '').trim().match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function releaseAssets(release) {
  if (!Array.isArray(release?.assets)) return [];
  return release.assets.filter((asset) => (
    asset &&
    asset.state === 'uploaded' &&
    Number(asset.size) > 0 &&
    trustedGitHubUrl(asset.browser_download_url, 'asset')
  ));
}

function explicitAssetArchitecture(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/x86[-_]?64/g, 'x64')
    .replace(/amd64/g, 'x64')
    .replace(/aarch64/g, 'arm64')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes('arm64')) return 'arm64';
  if (tokens.includes('x64')) return 'x64';
  if (tokens.includes('ia32') || tokens.includes('x86')) return 'ia32';
  return null;
}

function selectReleaseAsset(release, platform, arch) {
  const assets = releaseAssets(release);
  const score = (asset) => {
    const name = String(asset.name || '').toLowerCase();
    if (!name.includes('agentdesk')) return -1;
    const namedArch = explicitAssetArchitecture(name);
    if (namedArch && namedArch !== arch) return -1;

    if (platform === 'win32') {
      if (!name.endsWith('.exe') || name.includes('setup') || name.includes('installer')) return -1;
      let value = 10;
      if (name.includes('portable')) value += 100;
      if (name.includes(arch)) value += 30;
      return value;
    }

    if (platform === 'darwin') {
      if (!name.endsWith('.dmg')) return -1;
      let value = 10;
      if (name.includes('universal')) value += 100;
      if (name.includes(arch)) value += 30;
      return value;
    }

    return -1;
  };

  return assets
    .map((asset) => ({ asset, score: score(asset) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.asset || null;
}

function resolveRelease(release, options = {}) {
  const current = parseVersion(options.currentVersion);
  const latest = parseVersion(release?.tag_name);
  if (!current) throw new Error(`当前版本号无效：${options.currentVersion || '-'}`);
  if (!latest) throw new Error(`GitHub Release 版本号无效：${release?.tag_name || '-'}`);
  if (release?.draft || release?.prerelease) {
    throw new Error('GitHub 返回的不是正式发布版本。');
  }

  const comparison = compareVersions(latest.text, current.text);
  const releaseUrl = trustedGitHubUrl(release?.html_url, 'release')
    ? release.html_url
    : RELEASES_URL;
  const asset = selectReleaseAsset(release, options.platform, options.arch);

  return {
    currentVersion: current.text,
    latestVersion: latest.text,
    updateAvailable: comparison > 0,
    releaseUrl,
    publishedAt: release?.published_at || null,
    notes: String(release?.body || '').slice(0, 4000),
    asset: asset ? {
      id: asset.id,
      name: asset.name,
      url: asset.browser_download_url,
      size: Number(asset.size),
      sha256: sha256FromDigest(asset.digest)
    } : null
  };
}

function portableExecutablePath(env = process.env) {
  const raw = String(env.PORTABLE_EXECUTABLE_FILE || '').trim().replace(/^"(.*)"$/, '$1');
  if (!raw || !path.win32.isAbsolute(raw) || path.win32.extname(raw).toLowerCase() !== '.exe') {
    return null;
  }
  return path.win32.normalize(raw);
}

function windowsUpdaterScript() {
  // ASCII-only for Windows PowerShell 5.1 compatibility without a BOM.
  return [
    'param(',
    '  [Parameter(Mandatory=$true)][int]$ProcessId,',
    '  [Parameter(Mandatory=$true)][string]$Source,',
    '  [Parameter(Mandatory=$true)][string]$Target,',
    '  [Parameter(Mandatory=$true)][string]$LogPath',
    ')',
    '$ErrorActionPreference = "Stop"',
    '$Backup = "$Target.old"',
    '$Staged = "$Target.update"',
    'try { if (Test-Path -LiteralPath $LogPath) { Remove-Item -LiteralPath $LogPath -Force } } catch {}',
    'function Start-CurrentTarget {',
    '  if (Test-Path -LiteralPath $Target) { Start-Process -FilePath $Target }',
    '}',
    'try {',
    '  for ($i = 0; $i -lt 300; $i++) {',
    '    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }',
    '    Start-Sleep -Milliseconds 200',
    '  }',
    '  if (Test-Path -LiteralPath $Staged) { Remove-Item -LiteralPath $Staged -Force }',
    '  Copy-Item -LiteralPath $Source -Destination $Staged -Force',
    '  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }',
    '  $Moved = $false',
    '  for ($i = 0; $i -lt 120; $i++) {',
    '    try {',
    '      Move-Item -LiteralPath $Target -Destination $Backup -Force',
    '      $Moved = $true',
    '      break',
    '    } catch {',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '  }',
    '  if (-not $Moved) { throw "Timed out waiting for the portable executable to unlock." }',
    '  try {',
    '    Move-Item -LiteralPath $Staged -Destination $Target -Force',
    '  } catch {',
    '    if (Test-Path -LiteralPath $Backup) { Move-Item -LiteralPath $Backup -Destination $Target -Force }',
    '    throw',
    '  }',
    '  Start-Process -FilePath $Target',
    '  Start-Sleep -Seconds 2',
    '  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }',
    '  if (Test-Path -LiteralPath $Source) { Remove-Item -LiteralPath $Source -Force }',
    '} catch {',
    '  $_ | Out-File -LiteralPath $LogPath -Encoding utf8',
    '  if ((-not (Test-Path -LiteralPath $Target)) -and (Test-Path -LiteralPath $Backup)) {',
    '    Move-Item -LiteralPath $Backup -Destination $Target -Force',
    '  }',
    '  Start-CurrentTarget',
    '}',
    'try { if (Test-Path -LiteralPath $Staged) { Remove-Item -LiteralPath $Staged -Force } } catch {}',
    'try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force } catch {}'
  ].join('\r\n');
}

module.exports = {
  GITHUB_API_VERSION,
  LATEST_RELEASE_API,
  RELEASES_URL,
  REPOSITORY,
  compareVersions,
  isTrustedDownloadResponseUrl,
  parseVersion,
  portableExecutablePath,
  resolveRelease,
  selectReleaseAsset,
  sha256FromDigest,
  trustedGitHubUrl,
  windowsUpdaterScript
};
