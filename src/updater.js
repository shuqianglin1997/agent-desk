/*
 * Catshelf — GitHub Releases update helpers.
 *
 * Pure Node module so release parsing, asset selection, URL trust boundaries,
 * the new-or-not decision (version for v* releases, commit for test builds),
 * whether this copy can replace itself, and the Windows portable replacement
 * script can be unit-tested without Electron or network access. The macOS
 * install steps are in ./update-mac.js.
 */

const path = require('node:path');

// From package.json's `repository`, the one place to change when the
// repository is renamed (docs/RENAME_PLAN.md).
const { REPOSITORY, PRODUCT_NAME } = require('./core/product');
// Release files carry the product name; releases from before the rename
// carried the old one.
const ASSET_NAMES = ['catshelf', 'agentdesk'];

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
    if (!ASSET_NAMES.some((product) => name.includes(product))) return -1;
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

// Until a signed release exists, the newest unsigned test build (tag test-…)
// is GitHub's Latest so the README's download links reach it
// (docs/RELEASING.md). Owner decision 2026-11-26 (docs/PERSONAL_AGENT_MESH_PLAN.md
// 1.42): a test build counts as an update too. All test builds carry the same
// package version, so they are ordered by commit, never by version.
function isTestBuildRelease(release) {
  return /^test-/i.test(String(release?.tag_name || ''));
}

const COMMIT = /^[0-9a-f]{40}$/;
const API_ROOT = `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}`;

// A fixed reason code; the window and the command line turn it into a sentence.
class UpdateError extends Error {
  /** @param {string} code @param {Record<string, unknown>} [details] */
  constructor(code, details = {}) {
    super(code);
    this.name = 'UpdateError';
    this.code = code;
    this.details = details;
  }
}

function commitOrNull(value) {
  const text = String(value || '').trim().toLowerCase();
  return COMMIT.test(text) ? text : null;
}

// target_commitish is a commit only when the release was created with one;
// `gh release create <existing tag>` stores the branch name instead.
function releaseTargetCommit(release) {
  return commitOrNull(release?.target_commitish);
}

// test-YYYYMMDD-<short commit>: a hint the resolved commit must agree with.
// A tag of another shape gives no hint.
function tagCommitHint(tag) {
  const match = /^test-\d{8}-([0-9a-f]{7,40})$/i.exec(String(tag || ''));
  return match ? match[1].toLowerCase() : null;
}

function tagCommitUrl(tag) {
  return `${API_ROOT}/commits/refs/tags/${encodeURIComponent(String(tag))}`;
}

// The second page of one commit carries the status and both counts without
// the changed-file list, which can be megabytes.
function compareUrl(base, head) {
  return `${API_ROOT}/compare/${base}...${head}?per_page=1&page=2`;
}

// The commit the tag resolves to on GitHub is the authority; target_commitish
// (when it is a commit) and the tag's short commit must agree with it. The
// release notes are never read for this.
function confirmReleaseCommit(release, resolved) {
  const commit = commitOrNull(resolved);
  if (!commit) throw new UpdateError('release-commit-unknown');
  const target = releaseTargetCommit(release);
  const hint = tagCommitHint(release?.tag_name);
  if ((target && target !== commit) || (hint && !commit.startsWith(hint))) {
    throw new UpdateError('release-commit-mismatch');
  }
  return commit;
}

// GitHub compare base...head: "ahead" means head has commits base lacks and
// none the other way. Counts that contradict the status are not trusted.
function parseComparison(value) {
  const status = value?.status;
  const ahead = value?.ahead_by;
  const behind = value?.behind_by;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) return null;
  if (status === 'identical' && ahead === 0 && behind === 0) return 'identical';
  if (status === 'ahead' && ahead > 0 && behind === 0) return 'ahead';
  if (status === 'behind' && behind > 0 && ahead === 0) return 'behind';
  if (status === 'diverged' && ahead > 0 && behind > 0) return 'diverged';
  return null;
}

/**
 * What GitHub's Latest is, without deciding anything: a test build (ordered
 * by commit) or a v* release (ordered by version), and this system's file.
 */
function describeRelease(release, options = {}) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) {
    throw new UpdateError('release-invalid');
  }
  const tag = String(release.tag_name || '');
  const kind = isTestBuildRelease(release) ? 'test' : 'version';
  const version = kind === 'version' ? parseVersion(tag)?.text || null : null;
  if (!/^[0-9A-Za-z._-]{1,100}$/.test(tag) || (kind === 'version' && !version)) {
    throw new UpdateError('release-invalid');
  }
  const asset = selectReleaseAsset(release, options.platform, options.arch);
  return {
    kind,
    tag,
    version,
    releaseUrl: trustedGitHubUrl(release.html_url, 'release') ? release.html_url : RELEASES_URL,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    notes: String(release.body || '').slice(0, 4000),
    asset: asset ? {
      id: asset.id,
      name: asset.name,
      url: asset.browser_download_url,
      size: Number(asset.size),
      sha256: sha256FromDigest(asset.digest)
    } : null
  };
}

/**
 * newer: offer it. current, older, diverged: never offered (no downgrade, no
 * sideways move). unknown: say so and point at the release page.
 * @param {{ kind: string, current: { version?: string|null, commit?: string|null },
 *   latest: { version?: string|null, commit?: string|null }, comparison?: string|null }} input
 */
function decideUpdate({ kind, current, latest, comparison }) {
  if (kind === 'version') {
    const order = compareVersions(latest.version, current.version);
    if (order === null) return { state: 'unknown', reasonCode: 'version-unreadable' };
    return { state: order > 0 ? 'newer' : order < 0 ? 'older' : 'current', reasonCode: null };
  }
  const own = commitOrNull(current.commit);
  if (!own) return { state: 'unknown', reasonCode: 'current-commit-unknown' };
  if (!latest.commit) return { state: 'unknown', reasonCode: 'release-commit-unknown' };
  if (own === latest.commit) return { state: 'current', reasonCode: null };
  if (comparison === 'ahead') return { state: 'newer', reasonCode: null };
  if (comparison === 'behind') return { state: 'older', reasonCode: null };
  if (comparison === 'diverged') return { state: 'diverged', reasonCode: null };
  if (comparison === 'identical') return { state: 'current', reasonCode: null };
  if (comparison === 'not-found') return { state: 'unknown', reasonCode: 'current-commit-not-on-github' };
  return { state: 'unknown', reasonCode: 'comparison-unavailable' };
}

function failedResponse(response) {
  const status = Number(response?.status);
  const remaining = response?.headers?.get?.('x-ratelimit-remaining');
  if ((status === 403 || status === 429) && (remaining === '0' || status === 429)) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    return new UpdateError('rate-limited', { resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null });
  }
  return new UpdateError('query-failed', { status: Number.isInteger(status) ? status : null });
}

function parseResponseJson(text) {
  try {
    return JSON.parse(String(text));
  } catch (_error) {
    throw new UpdateError('unparsable');
  }
}

/**
 * The whole check, network through `request(url, accept)`, which resolves to
 * { status, headers: { get(name) }, text }. At most three GitHub API calls
 * (Latest, the tag's commit, one comparison); `memo` keeps the tag's commit
 * and each comparison for the life of the process, so a repeated check with
 * the same Latest costs one call. GitHub allows 60 unauthenticated calls an
 * hour.
 * @param {{ current: { version: string, commit: string|null, dirty?: boolean|null },
 *   platform: string, arch: string,
 *   request: (url: string, accept: string) => Promise<{ status: number, headers: { get(name: string): string|null }, text: string }>,
 *   memo?: { tags: Map<string, string>, comparisons: Map<string, string> } }} options
 */
async function checkLatestRelease(options) {
  const { current, platform, arch, request } = options;
  const memo = options.memo || { tags: new Map(), comparisons: new Map() };
  const latestResponse = await request(LATEST_RELEASE_API, 'application/vnd.github+json');
  if (latestResponse.status === 404) throw new UpdateError('no-release');
  if (latestResponse.status < 200 || latestResponse.status >= 300) throw failedResponse(latestResponse);
  const release = parseResponseJson(latestResponse.text);
  const described = describeRelease(release, { platform, arch });

  let commit = null;
  let comparison = null;
  if (described.kind === 'test') {
    commit = memo.tags.get(described.tag) || null;
    if (!commit) {
      const response = await request(tagCommitUrl(described.tag), 'application/vnd.github.sha');
      if (response.status === 404 || response.status === 422) throw new UpdateError('release-commit-unknown');
      if (response.status < 200 || response.status >= 300) throw failedResponse(response);
      commit = confirmReleaseCommit(release, response.text);
      memo.tags.set(described.tag, commit);
    }
    const own = commitOrNull(current.commit);
    if (own && own !== commit) {
      const key = `${own}...${commit}`;
      comparison = memo.comparisons.get(key) || null;
      if (!comparison) {
        const response = await request(compareUrl(own, commit), 'application/vnd.github+json');
        if (response.status === 404 || response.status === 422) comparison = 'not-found';
        else if (response.status < 200 || response.status >= 300) throw failedResponse(response);
        else comparison = parseComparison(parseResponseJson(response.text)) || 'invalid';
        if (comparison !== 'invalid') memo.comparisons.set(key, comparison);
      }
    }
  }

  const decision = decideUpdate({
    kind: described.kind,
    current,
    latest: { version: described.version, commit },
    comparison
  });
  return {
    ...described,
    commit,
    current: {
      version: String(current.version || ''),
      commit: commitOrNull(current.commit),
      dirty: typeof current.dirty === 'boolean' ? current.dirty : null
    },
    state: decision.state,
    reasonCode: decision.reasonCode,
    updateAvailable: decision.state === 'newer'
  };
}

function portableExecutablePath(env = process.env) {
  const raw = String(env.PORTABLE_EXECUTABLE_FILE || '').trim().replace(/^"(.*)"$/, '$1');
  if (!raw || !path.win32.isAbsolute(raw) || path.win32.extname(raw).toLowerCase() !== '.exe') {
    return null;
  }
  return path.win32.normalize(raw);
}

// The only macOS location the app replaces by itself. A copy run from the
// DMG, Downloads or App Translocation (a quarantined app moved by Gatekeeper
// into a random read-only folder) is left alone.
const MAC_APPLICATIONS_BUNDLE = `/Applications/${PRODUCT_NAME}.app`;

function macBundleLocation(execPath) {
  const value = String(execPath || '');
  if (value.includes('/AppTranslocation/')) return { target: null, reasonCode: 'app-translocation' };
  const macos = path.posix.dirname(value);
  const contents = path.posix.dirname(macos);
  const bundle = path.posix.dirname(contents);
  if (path.posix.basename(macos) !== 'MacOS' || path.posix.basename(contents) !== 'Contents' || bundle !== MAC_APPLICATIONS_BUNDLE) {
    return { target: null, reasonCode: 'not-in-applications' };
  }
  return { target: bundle, reasonCode: null };
}

/**
 * Whether this copy can download and replace itself, or why the person gets
 * the release page instead. `writable(path)` and `exists(path)` are injected.
 * @param {{ updateAvailable: boolean, asset: { sha256: string|null }|null }} resolved
 * @param {{ platform: string, packaged: boolean, execPath?: string, env?: Record<string, string|undefined>,
 *   exists: (file: string) => boolean, writable: (file: string) => boolean }} host
 */
function installCapability(resolved, host) {
  const page = (reasonCode) => ({ installSupported: false, mode: 'release-page', reasonCode, targetPath: null });
  if (!resolved?.updateAvailable) return { installSupported: false, mode: 'none', reasonCode: null, targetPath: null };
  if (!resolved.asset) return page('no-asset');
  if (!resolved.asset.sha256) return page('no-digest');
  if (host.platform === 'win32') {
    if (!host.packaged) return page('dev-mode');
    const target = portableExecutablePath(host.env || {});
    if (!target || !host.exists(target)) return page('not-portable');
    if (!host.writable(path.win32.dirname(target)) || !host.writable(target)) return page('not-writable');
    return { installSupported: true, mode: 'windows-portable', reasonCode: null, targetPath: target };
  }
  if (host.platform === 'darwin') {
    if (!host.packaged) return page('dev-mode');
    const located = macBundleLocation(host.execPath);
    if (!located.target) return page(located.reasonCode);
    if (!host.writable(path.posix.dirname(located.target)) || !host.writable(located.target)) return page('not-writable');
    return { installSupported: true, mode: 'macos-app', reasonCode: null, targetPath: located.target };
  }
  return page('unsupported-platform');
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
  MAC_APPLICATIONS_BUNDLE,
  RELEASES_URL,
  REPOSITORY,
  UpdateError,
  checkLatestRelease,
  compareUrl,
  compareVersions,
  confirmReleaseCommit,
  decideUpdate,
  describeRelease,
  installCapability,
  isTestBuildRelease,
  isTrustedDownloadResponseUrl,
  macBundleLocation,
  parseComparison,
  parseVersion,
  portableExecutablePath,
  releaseTargetCommit,
  selectReleaseAsset,
  sha256FromDigest,
  tagCommitHint,
  tagCommitUrl,
  trustedGitHubUrl,
  windowsUpdaterScript
};
