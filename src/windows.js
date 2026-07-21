/*
 * AgentDesk — Windows path / launcher compatibility helpers.
 *
 * Kept outside Electron so the tricky parts can be unit-tested on macOS/Linux:
 * - Store/MSIX execution aliases and package paths
 * - legacy Squirrel app-* directories
 * - MSIX AppData virtualization
 * - stable managed-profile locations outside AppData
 */

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const path = nodePath.win32;
const MSIX_REPOSITORY_PACKAGES_KEY =
  'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';

function context(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  return {
    env,
    home,
    local: env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    roaming: env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    programFiles: env.ProgramFiles || 'C:\\Program Files',
    programFilesX86: env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  };
}

function listDirectories(root, options = {}) {
  const readDirectories = options.listDirectories;
  if (readDirectories) return readDirectories(root) || [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (_error) {
    return [];
  }
}

function pathExists(itemPath, options = {}) {
  const exists = options.exists || fs.existsSync;
  try {
    return Boolean(itemPath && exists(itemPath));
  } catch (_error) {
    return false;
  }
}

// 数据目录名默认与 App 显示名一致；Electron userData 可能不同（如 Kimi → kimi-desktop）。
// 只影响数据目录定位，可执行文件查找仍按 appName。
function profileDirName(app_) {
  return app_.profileDirName || app_.appName;
}

function metadata(app_) {
  return {
    executableNames: app_.windows?.executableNames || [`${app_.appName}.exe`],
    aliases: app_.windows?.aliases || [`${app_.appName}.exe`],
    legacyInstallDirs: app_.windows?.legacyInstallDirs || [app_.appName],
    packageNames: app_.windows?.packageNames || [],
    packageFamilyNames: app_.windows?.packageFamilyNames || [],
    packageFamilyPrefixes: app_.windows?.packageFamilyPrefixes || [],
    protocol: app_.windows?.protocol || `${app_.appName.toLowerCase()}://`,
    profileMarkers: app_.windows?.profileMarkers || ['Local State', 'Default']
  };
}

function powershellArray(values) {
  return `@(${values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(',')})`;
}

function appxExecutableDiscoveryScript(app_) {
  const meta = metadata(app_);
  if (
    (
      !meta.packageNames.length &&
      !meta.packageFamilyNames.length &&
      !meta.packageFamilyPrefixes.length
    ) ||
    !meta.executableNames.length
  ) return null;

  const relativePaths = meta.executableNames.flatMap((name) => [`app\\${name}`, name]);
  return [
    `$packageNames = ${powershellArray(meta.packageNames)}`,
    `$packageFamilyNames = ${powershellArray(meta.packageFamilyNames)}`,
    `$packageFamilyPrefixes = ${powershellArray(meta.packageFamilyPrefixes)}`,
    `$relativePaths = ${powershellArray(relativePaths)}`,
    'Get-AppxPackage |',
    '  Where-Object {',
    '    $family = $_.PackageFamilyName',
    '    ($packageNames -contains $_.Name) -or',
    '    ($packageFamilyNames -contains $family) -or',
    '    (@($packageFamilyPrefixes | Where-Object { $family.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0)',
    '  } |',
    '  Sort-Object Version -Descending |',
    '  ForEach-Object {',
    '    $package = $_',
    '    $root = $package.InstallLocation',
    '    $manifestPaths = @()',
    '    try {',
    '      $manifest = Get-AppxPackageManifest -Package $package.PackageFullName',
    '      $manifestPaths = @($manifest.Package.Applications.Application | ForEach-Object { $_.Executable })',
    '    } catch {}',
    '    $paths = @($manifestPaths + $relativePaths) | Select-Object -Unique',
    '    foreach ($relative in $paths) {',
    '      if (-not $relative) { continue }',
    '      $candidate = Join-Path $root $relative',
    '      if (Test-Path -LiteralPath $candidate) { $candidate }',
    '    }',
    '  }'
  ].join('\r\n');
}

function packageIdentityNames(app_) {
  const meta = metadata(app_);
  const names = new Set([app_.appName, ...meta.packageNames]);

  for (const familyName of meta.packageFamilyNames) {
    const separator = String(familyName).lastIndexOf('_');
    if (separator > 0) names.add(String(familyName).slice(0, separator));
  }
  for (const prefix of meta.packageFamilyPrefixes) {
    const name = String(prefix).replace(/_+$/, '');
    if (name) names.add(name);
  }

  return [...names].filter(Boolean);
}

function parseMsixPackageFullName(value) {
  const key = String(value || '').trim();
  const fullName = path.basename(key);
  const match = fullName.match(/^([^_]+)_([0-9]+(?:\.[0-9]+){3})_([^_]+)_([^_]*)_([^_]+)$/);
  if (!match) return null;
  return {
    key,
    fullName,
    name: match[1],
    version: match[2],
    architecture: match[3].toLowerCase(),
    resourceId: match[4],
    publisherId: match[5]
  };
}

function compareDotQuad(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number(part) || 0);
  const rightParts = String(right || '').split('.').map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 4);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function packageArchitectureRank(candidate, target) {
  const architecture = String(candidate || '').toLowerCase();
  const requested = String(target || '').toLowerCase().replace(/^ia32$/, 'x86');
  if (architecture === requested) return 4;
  if (architecture === 'neutral') return 3;
  if (requested === 'arm64' && ['x64', 'x86a64'].includes(architecture)) return 2;
  if (requested === 'x64' && architecture === 'x86') return 1;
  return 0;
}

// `reg query <...Repository\Packages>` returns one direct subkey per package.
// Parse only main packages (empty ResourceId), then prefer the current
// architecture and compare the four-part version numerically.
function msixRepositoryPackageKeys(app_, registryOutput, options = {}) {
  const names = new Set(packageIdentityNames(app_).map((name) => name.toLowerCase()));
  const seen = new Set();
  const packages = [];

  for (const line of String(registryOutput || '').split(/\r?\n/)) {
    if (!line.toLowerCase().includes('\\appmodel\\repository\\packages\\')) continue;
    const parsed = parseMsixPackageFullName(line);
    if (!parsed || parsed.resourceId || !names.has(parsed.name.toLowerCase())) continue;
    const normalized = parsed.key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    packages.push(parsed);
  }

  const architecture = options.arch || process.arch;
  return packages
    .sort((left, right) => (
      packageArchitectureRank(right.architecture, architecture) -
        packageArchitectureRank(left.architecture, architecture) ||
      compareDotQuad(right.version, left.version) ||
      right.fullName.localeCompare(left.fullName, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    ))
    .map((item) => item.key);
}

function registryValueFromQuery(registryOutput, valueName) {
  const escaped = String(valueName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return null;
  const match = String(registryOutput || '').match(
    new RegExp(`^\\s*${escaped}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, 'mi')
  );
  return match ? match[1].trim() : null;
}

function msixExecutablePaths(app_, packageRoots) {
  const meta = metadata(app_);
  const output = [];
  for (const packageRoot of packageRoots || []) {
    const root = normalizeWindowsPath(String(packageRoot || '').replace(/^"(.*)"$/, '$1'));
    if (!root) continue;
    for (const executableName of meta.executableNames) {
      output.push(
        path.join(root, 'app', executableName),
        path.join(root, executableName)
      );
    }
  }
  return [...new Set(output.map((item) => item.toLowerCase()))]
    .map((normalized) => output.find((item) => item.toLowerCase() === normalized));
}

function candidate(path_, source, options = {}) {
  return {
    path: path_,
    source,
    assumed: Boolean(options.assumed),
    manual: Boolean(options.manual)
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((item) => {
    if (!item?.path) return false;
    const key = normalizeWindowsPath(item.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function windowsExecutableCandidates(app_, options = {}) {
  const ctx = context(options);
  const meta = metadata(app_);
  const candidates = [];

  if (options.explicitPath) {
    candidates.push(candidate(
      expandWindowsPath(options.explicitPath, ctx),
      '手动指定',
      { manual: true }
    ));
  }

  for (const alias of meta.aliases) {
    candidates.push(candidate(
      path.join(ctx.local, 'Microsoft', 'WindowsApps', alias),
      'Microsoft Store 执行别名'
    ));
  }

  for (const executableName of meta.executableNames) {
    candidates.push(
      candidate(path.join(ctx.local, 'Programs', app_.appName, executableName), '用户安装目录'),
      candidate(path.join(ctx.local, 'Programs', app_.appName.toLowerCase(), executableName), '用户安装目录'),
      candidate(path.join(ctx.local, 'Programs', `@${app_.appName.toLowerCase()}`, executableName), '用户安装目录'),
      candidate(path.join(ctx.local, app_.appName, executableName), 'LocalAppData'),
      candidate(path.join(ctx.roaming, app_.appName, executableName), 'Roaming AppData'),
      candidate(path.join(ctx.programFiles, app_.appName, executableName), 'Program Files'),
      candidate(path.join(ctx.programFiles, 'OpenAI', app_.appName, executableName), 'Program Files'),
      candidate(path.join(ctx.programFiles, 'Anthropic', app_.appName, executableName), 'Program Files'),
      candidate(path.join(ctx.programFilesX86, app_.appName, executableName), 'Program Files (x86)'),
      candidate(path.join(ctx.programFilesX86, 'OpenAI', app_.appName, executableName), 'Program Files (x86)'),
      candidate(path.join(ctx.programFilesX86, 'Anthropic', app_.appName, executableName), 'Program Files (x86)')
    );
  }

  for (const installDir of meta.legacyInstallDirs) {
    const root = path.join(ctx.local, installDir);
    for (const executableName of meta.executableNames) {
      candidates.push(candidate(path.join(root, executableName), '旧版安装目录'));
    }
    const versionDirs = listDirectories(root, options)
      .filter((name) => /^app[-.]/i.test(name))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
    for (const versionDir of versionDirs) {
      for (const executableName of meta.executableNames) {
        candidates.push(candidate(
          path.join(root, versionDir, executableName),
          '旧版自动更新目录'
        ));
      }
    }
  }

  for (const registryPath of options.registryExecutablePaths || []) {
    if (!looksLikeCliShim(registryPath)) {
      candidates.push(candidate(registryPath, 'Windows App Paths 注册表'));
    }
  }

  // These paths are produced by Get-AppxPackage + Test-Path. The calling side
  // already verified them inside PowerShell, which can inspect WindowsApps even
  // when a normal fs.existsSync call is denied by package ACLs.
  for (const appxPath of options.appxExecutablePaths || []) {
    candidates.push(candidate(appxPath, 'Microsoft Store / MSIX 包', { assumed: true }));
  }

  // The per-user AppModel repository is readable even when WindowsApps itself
  // cannot be listed. Keep this after the supported AppX query as an independent
  // fallback. Exact package paths are checked with fs.existsSync before use.
  for (const registryPath of options.msixRegistryExecutablePaths || []) {
    candidates.push(candidate(registryPath, 'Microsoft Store / MSIX 包仓库注册表'));
  }

  return dedupeCandidates(candidates);
}

function resolveWindowsLauncher(app_, options = {}) {
  const candidates = windowsExecutableCandidates(app_, options);
  const evaluated = candidates.map((item) => ({
    ...item,
    exists: item.assumed || pathExists(item.path, options)
  }));
  const executable = evaluated.find((item) => item.exists);
  return {
    found: Boolean(executable),
    path: executable?.path || null,
    source: executable?.source || null,
    manual: Boolean(executable?.manual),
    candidates: evaluated.map((item) => item.path),
    candidateDetails: evaluated,
    explicitMissing: Boolean(options.explicitPath && !evaluated.find((item) => item.manual)?.exists)
  };
}

function packageFamilyDirectories(app_, options = {}) {
  const ctx = context(options);
  const meta = metadata(app_);
  const packageRoot = path.join(ctx.local, 'Packages');
  const names = new Set(meta.packageFamilyNames);

  for (const name of listDirectories(packageRoot, options)) {
    if (meta.packageFamilyPrefixes.some((prefix) => name.toLowerCase().startsWith(prefix.toLowerCase()))) {
      names.add(name);
    }
  }

  return [...names].map((name) => path.join(packageRoot, name));
}

function legacyDefaultProfilePath(app_, options = {}) {
  const ctx = context(options);
  return path.join(ctx.roaming, profileDirName(app_));
}

function windowsDefaultProfileCandidates(app_, options = {}) {
  const ctx = context(options);
  const dirName = profileDirName(app_);
  const output = [
    { path: legacyDefaultProfilePath(app_, options), source: '传统 Roaming 目录' },
    { path: path.join(ctx.local, dirName), source: '传统 Local 目录' }
  ];

  for (const packageDir of packageFamilyDirectories(app_, options)) {
    output.push(
      {
        path: path.join(packageDir, 'LocalCache', 'Roaming', dirName),
        source: 'MSIX 虚拟化 Roaming 目录'
      },
      {
        path: path.join(packageDir, 'LocalCache', 'Local', dirName),
        source: 'MSIX 虚拟化 Local 目录'
      }
    );
  }

  return dedupeCandidates(output);
}

function directoryScore(item, app_, options = {}) {
  if (!pathExists(item.path, options)) return -1;
  const meta = metadata(app_);
  // Prefer a live MSIX location when candidates contain comparable data, but
  // never let an empty package directory outrank a legacy directory that still
  // contains the user's sessions/login state.
  let score = item.source?.includes('MSIX') ? 5 : 1;
  if (item.source?.includes('Roaming')) score += 2;

  for (const marker of meta.profileMarkers) {
    if (!pathExists(path.join(item.path, marker), options)) continue;
    if (/session|archive/i.test(marker)) score += 100;
    else if (marker === 'Local State') score += 30;
    else score += 10;
  }

  try {
    const entries = options.listEntries
      ? options.listEntries(item.path)
      : fs.readdirSync(item.path);
    score += Math.min(Array.isArray(entries) ? entries.length : 0, 20);
  } catch (_error) {
    // Existence and marker checks are enough.
  }
  return score;
}

function chooseWindowsDefaultProfilePath(app_, options = {}) {
  const candidates = windowsDefaultProfileCandidates(app_, options)
    .map((item) => ({ ...item, score: directoryScore(item, app_, options) }))
    .sort((left, right) => right.score - left.score);
  const selected = candidates.find((item) => item.score >= 0);
  return {
    path: selected?.path || legacyDefaultProfilePath(app_, options),
    source: selected?.source || '传统 Roaming 目录',
    candidates
  };
}

function windowsVirtualizedPathCandidates(itemPath, app_, options = {}) {
  const ctx = context(options);
  const expanded = expandWindowsPath(itemPath, ctx);
  const output = [{ path: expanded, source: '配置中的路径' }];
  const inRoaming = isSubpath(expanded, ctx.roaming);
  const inLocal = isSubpath(expanded, ctx.local);
  if (!inRoaming && !inLocal) return output;

  const base = inRoaming ? ctx.roaming : ctx.local;
  const cacheArea = inRoaming ? 'Roaming' : 'Local';
  const relative = path.relative(base, expanded);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return output;
  for (const packageDir of packageFamilyDirectories(app_, options)) {
    output.push({
      path: path.join(packageDir, 'LocalCache', cacheArea, relative),
      source: 'MSIX 实际重定向路径'
    });
  }
  return dedupeCandidates(output);
}

function chooseWindowsMigrationSource(itemPath, app_, options = {}) {
  const candidates = windowsVirtualizedPathCandidates(itemPath, app_, options)
    .map((item) => ({ ...item, score: directoryScore(item, app_, options) }))
    .sort((left, right) => right.score - left.score);
  return {
    path: candidates.find((item) => item.score >= 0)?.path || null,
    candidates
  };
}

function managedProfilesRoot(options = {}) {
  return path.join(context(options).home, '.agentdesk', 'profiles');
}

function managedProfilePath(appName, id, options = {}) {
  const safeApp = String(appName || 'app')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'app';
  const safeId = String(id || 'account')
    .replace(/[^a-z0-9_-]+/gi, '')
    .slice(0, 64) || 'account';
  return path.join(managedProfilesRoot(options), safeApp, safeId);
}

function isPathInsideWindowsAppData(itemPath, options = {}) {
  const ctx = context(options);
  const expanded = expandWindowsPath(itemPath, ctx);
  return isSubpath(expanded, ctx.roaming) || isSubpath(expanded, ctx.local);
}

function isSubpath(itemPath, parentPath) {
  if (!itemPath || !parentPath) return false;
  const relative = path.relative(normalizeWindowsPath(parentPath), normalizeWindowsPath(itemPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsEqual(left, right) {
  if (!left || !right) return false;
  return normalizeWindowsPath(left).toLowerCase() === normalizeWindowsPath(right).toLowerCase();
}

function normalizeWindowsPath(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  const withoutExtendedPrefix = trimmed
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '');
  return path.normalize(withoutExtendedPrefix);
}

function looksLikeCliShim(itemPath) {
  const normalized = normalizeWindowsPath(itemPath).toLowerCase();
  return [
    '\\appdata\\roaming\\npm\\',
    '\\microsoft\\winget\\links\\',
    '\\node_modules\\',
    '\\.local\\bin\\'
  ].some((fragment) => normalized.includes(fragment));
}

function expandWindowsPath(value, options = {}) {
  if (!value) return '';
  const ctx = options.home ? options : context(options);
  let expanded = String(value).trim().replace(/^"(.*)"$/, '$1');
  expanded = expanded.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(ctx.env).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? ctx.env[key] : match;
  });
  if (/^~([\\/]|$)/.test(expanded)) {
    expanded = path.join(ctx.home, expanded.slice(1));
  }
  if (!path.isAbsolute(expanded)) expanded = path.resolve(ctx.home, expanded);
  return normalizeWindowsPath(expanded);
}

module.exports = {
  MSIX_REPOSITORY_PACKAGES_KEY,
  appxExecutableDiscoveryScript,
  chooseWindowsDefaultProfilePath,
  chooseWindowsMigrationSource,
  context,
  expandWindowsPath,
  isPathInsideWindowsAppData,
  isSubpath,
  legacyDefaultProfilePath,
  managedProfilePath,
  managedProfilesRoot,
  metadata,
  msixExecutablePaths,
  msixRepositoryPackageKeys,
  packageFamilyDirectories,
  pathsEqual,
  registryValueFromQuery,
  resolveWindowsLauncher,
  windowsDefaultProfileCandidates,
  windowsExecutableCandidates,
  windowsVirtualizedPathCandidates
};
