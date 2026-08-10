/*
 * AgentDesk — managed desktop / terminal tool maintenance helpers.
 *
 * This module is pure Node and deliberately does not execute updates. It owns
 * the allowlisted catalog, installation-source detection, version comparison,
 * remote-version request descriptions, and safe update plans. The Electron
 * main process resolves and runs those plans without accepting arbitrary
 * commands or URLs from the renderer.
 */

const fs = require('node:fs');
const path = require('node:path');

const TOOL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'desktop:claude',
    kind: 'desktop',
    label: 'Claude',
    detail: 'Claude Desktop',
    appIds: Object.freeze(['claude']),
    officialUrl: 'https://claude.com/download'
  }),
  Object.freeze({
    id: 'desktop:codex',
    kind: 'desktop',
    label: 'Codex',
    detail: 'Codex Desktop',
    appIds: Object.freeze(['codex']),
    officialUrl: 'https://openai.com/codex/get-started/'
  }),
  Object.freeze({
    id: 'desktop:cursor',
    kind: 'desktop',
    label: 'Cursor',
    detail: 'Cursor Desktop',
    appIds: Object.freeze(['cursor']),
    officialUrl: 'https://cursor.com/downloads'
  }),
  Object.freeze({
    id: 'desktop:kimi',
    kind: 'desktop',
    label: 'Kimi',
    detail: 'Kimi Work / Desktop',
    appIds: Object.freeze(['kimi-work', 'kimi']),
    officialUrl: 'https://www.kimi.com/products/kimi-work'
  }),
  Object.freeze({
    id: 'cli:claude',
    kind: 'cli',
    label: 'Claude Code',
    detail: 'CLI Tool',
    discoveryId: 'claude',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['@anthropic-ai/claude-code']),
    selfUpdateArgs: Object.freeze(['update']),
    officialUrl: 'https://docs.anthropic.com/en/docs/claude-code/getting-started'
  }),
  Object.freeze({
    id: 'cli:codex',
    kind: 'cli',
    label: 'Codex CLI',
    detail: 'CLI Tool',
    discoveryId: 'codex',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['@openai/codex']),
    brewPackages: Object.freeze(['codex']),
    officialUrl: 'https://github.com/openai/codex'
  }),
  Object.freeze({
    id: 'cli:gemini',
    kind: 'cli',
    label: 'Gemini CLI',
    detail: 'CLI Tool',
    discoveryId: 'gemini',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['@google/gemini-cli']),
    brewPackages: Object.freeze(['gemini-cli']),
    selfUpdateArgs: Object.freeze(['update']),
    officialUrl: 'https://github.com/google-gemini/gemini-cli'
  }),
  Object.freeze({
    id: 'cli:opencode',
    kind: 'cli',
    label: 'OpenCode',
    detail: 'CLI Tool',
    discoveryId: 'opencode',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['opencode-ai']),
    brewPackages: Object.freeze(['opencode']),
    selfUpdateArgs: Object.freeze(['upgrade']),
    githubRepository: 'anomalyco/opencode',
    officialUrl: 'https://opencode.ai/docs'
  }),
  Object.freeze({
    id: 'cli:cursor-agent',
    kind: 'cli',
    label: 'Cursor Agent',
    detail: 'CLI Tool',
    discoveryId: 'cursor-agent',
    versionArgs: Object.freeze(['--version']),
    selfUpdateArgs: Object.freeze(['update']),
    officialUrl: 'https://docs.cursor.com/en/cli/installation'
  }),
  Object.freeze({
    id: 'cli:github-copilot',
    kind: 'cli',
    label: 'GitHub Copilot',
    detail: 'CLI Tool',
    discoveryId: 'github-copilot',
    versionArgs: Object.freeze(['version']),
    npmPackages: Object.freeze(['@github/copilot']),
    brewPackages: Object.freeze(['copilot-cli']),
    selfUpdateArgs: Object.freeze(['update']),
    officialUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli'
  }),
  Object.freeze({
    id: 'cli:goose',
    kind: 'cli',
    label: 'goose',
    detail: 'CLI Tool',
    discoveryId: 'goose',
    versionArgs: Object.freeze(['--version']),
    brewPackages: Object.freeze(['goose']),
    githubRepository: 'aaif-goose/goose',
    officialUrl: 'https://block.github.io/goose/'
  }),
  Object.freeze({
    id: 'cli:kimi',
    kind: 'cli',
    label: 'Kimi Code',
    detail: 'CLI Tool',
    discoveryId: 'kimi',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['@moonshot-ai/kimi-code']),
    uvPackages: Object.freeze(['kimi-cli']),
    officialUrl: 'https://moonshotai.github.io/kimi-code/en/guides/getting-started.html'
  }),
  Object.freeze({
    id: 'cli:qwen-code',
    kind: 'cli',
    label: 'Qwen Code',
    detail: 'CLI Tool',
    discoveryId: 'qwen-code',
    versionArgs: Object.freeze(['--version']),
    npmPackages: Object.freeze(['@qwen-code/qwen-code']),
    brewPackages: Object.freeze(['qwen-code']),
    officialUrl: 'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/'
  }),
  Object.freeze({
    id: 'terminal:shell',
    kind: 'terminal',
    label: 'System Terminal',
    detail: 'Shell',
    discoveryId: 'shell',
    officialUrl: null
  })
]);

const TOOL_BY_ID = new Map(TOOL_CATALOG.map((tool) => [tool.id, tool]));
const MAX_VERSION_LENGTH = 80;

function catalogTool(toolId) {
  return TOOL_BY_ID.get(String(toolId || '')) || null;
}

function extractVersion(value) {
  const input = String(value || '').trim();
  const match = input.match(/(?:^|[^\d])v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)(?=$|[^\d])/);
  return match ? match[1].slice(0, MAX_VERSION_LENGTH) : null;
}

function versionParts(value) {
  const normalized = extractVersion(value);
  if (!normalized) return null;
  const [core, suffix = ''] = normalized.split(/-(.+)/, 2);
  const numbers = core.split('.').map(Number);
  if (numbers.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;
  return {
    text: normalized,
    numbers,
    prerelease: suffix ? suffix.split('.') : []
  };
}

function compareVersions(leftValue, rightValue) {
  const left = versionParts(leftValue);
  const right = versionParts(rightValue);
  if (!left || !right) return null;
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.numbers[index] || 0;
    const rightPart = right.numbers[index] || 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
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

function safeJson(filePath, fs_ = fs) {
  try {
    const value = JSON.parse(fs_.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function safeRealpath(filePath, fs_ = fs) {
  try {
    return fs_.realpathSync(filePath);
  } catch (_error) {
    return filePath;
  }
}

function isWritable(itemPath, fs_ = fs) {
  if (!itemPath) return false;
  try {
    fs_.accessSync(itemPath, fs.constants.W_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function npmPrefixFromPackageRoot(packageRoot, path_ = path) {
  const normalized = String(packageRoot || '').replace(/\\/g, '/');
  const libMarker = '/lib/node_modules/';
  const directMarker = '/node_modules/';
  const libIndex = normalized.lastIndexOf(libMarker);
  if (libIndex >= 0) return path_.normalize(normalized.slice(0, libIndex));
  const directIndex = normalized.lastIndexOf(directMarker);
  if (directIndex >= 0) return path_.normalize(normalized.slice(0, directIndex));
  return null;
}

function packageRootsNearExecutable(executablePath, tool, options = {}) {
  const fs_ = options.fs || fs;
  const path_ = options.path || path;
  const output = [];
  const seen = new Set();

  function add(candidate) {
    if (!candidate) return;
    const normalized = path_.normalize(candidate);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  }

  const visiblePath = path_.resolve(String(executablePath || ''));
  const realPath = path_.resolve(safeRealpath(visiblePath, fs_));
  for (const start of [realPath, visiblePath]) {
    let cursor = path_.dirname(start);
    for (let depth = 0; depth < 14; depth += 1) {
      add(cursor);
      const parent = path_.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  const executableDir = path_.dirname(visiblePath);
  for (const packageName of tool.npmPackages || []) {
    const pieces = packageName.split('/');
    add(path_.join(executableDir, 'node_modules', ...pieces));
    add(path_.join(path_.dirname(executableDir), 'lib', 'node_modules', ...pieces));
    add(path_.join(path_.dirname(executableDir), 'node_modules', ...pieces));
  }
  for (const root of options.npmRoots || []) {
    for (const packageName of tool.npmPackages || []) add(path_.join(root, ...packageName.split('/')));
  }
  return output;
}

function detectNpmInstallation(executablePath, tool, options = {}) {
  const fs_ = options.fs || fs;
  const path_ = options.path || path;
  const allowed = new Set(tool.npmPackages || []);
  if (!allowed.size || !executablePath) return null;

  for (const root of packageRootsNearExecutable(executablePath, tool, options)) {
    const manifest = safeJson(path_.join(root, 'package.json'), fs_);
    if (!manifest || !allowed.has(manifest.name)) continue;
    const prefix = npmPrefixFromPackageRoot(root, path_);
    return {
      manager: 'npm',
      packageName: manifest.name,
      packageRoot: root,
      prefix,
      version: extractVersion(manifest.version),
      writable: isWritable(root, fs_) || isWritable(prefix, fs_)
    };
  }
  return null;
}

function detectBrewInstallation(executablePath, tool, options = {}) {
  const fs_ = options.fs || fs;
  const path_ = options.path || path;
  if (!executablePath) return null;
  const realPath = safeRealpath(executablePath, fs_).replace(/\\/g, '/');
  const match = realPath.match(/\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const packageName = match[2];
  const allowed = new Set(tool.brewPackages || []);
  if (allowed.size && !allowed.has(packageName)) return null;
  const packageRoot = path_.normalize(realPath.slice(0, match.index + match[0].length));
  return {
    manager: 'brew',
    packageName,
    brewKind: match[1] === 'Caskroom' ? 'cask' : 'formula',
    packageRoot,
    prefix: path_.normalize(realPath.slice(0, match.index)),
    version: extractVersion(match[3]),
    writable: isWritable(packageRoot, fs_)
  };
}

function detectUvInstallation(executablePath, tool, options = {}) {
  const fs_ = options.fs || fs;
  if (!executablePath) return null;
  const realPath = safeRealpath(executablePath, fs_).replace(/\\/g, '/');
  const match = realPath.match(/\/uv\/tools\/([^/]+)\//);
  if (!match) return null;
  const packageName = match[1];
  const allowed = new Set(tool.uvPackages || []);
  if (allowed.size && !allowed.has(packageName)) return null;
  return {
    manager: 'uv',
    packageName,
    packageRoot: realPath.slice(0, match.index + match[0].length - 1),
    prefix: null,
    version: null,
    writable: true
  };
}

function detectInstallation(executablePath, tool, options = {}) {
  if (!executablePath || !tool) return null;
  return detectNpmInstallation(executablePath, tool, options) ||
    detectBrewInstallation(executablePath, tool, options) ||
    detectUvInstallation(executablePath, tool, options) || {
      manager: 'standalone',
      packageName: null,
      packageRoot: null,
      prefix: null,
      version: null,
      writable: true
    };
}

function latestRequestFor(record) {
  if (!record?.installed || record.kind === 'desktop' || record.kind === 'terminal') return null;
  const installation = record.installation || {};
  if (installation.manager === 'npm' && installation.packageName) {
    return {
      type: 'npm',
      name: installation.packageName,
      url: `https://registry.npmjs.org/${encodeURIComponent(installation.packageName)}/latest`
    };
  }
  if (installation.manager === 'brew' && installation.packageName) {
    const kind = installation.brewKind === 'cask' ? 'cask' : 'formula';
    return {
      type: 'brew',
      kind,
      name: installation.packageName,
      url: `https://formulae.brew.sh/api/${kind}/${encodeURIComponent(installation.packageName)}.json`
    };
  }
  if (installation.manager === 'uv' && installation.packageName) {
    return {
      type: 'pypi',
      name: installation.packageName,
      url: `https://pypi.org/pypi/${encodeURIComponent(installation.packageName)}/json`
    };
  }
  if (record.tool?.githubRepository) {
    return {
      type: 'github',
      name: record.tool.githubRepository,
      url: `https://api.github.com/repos/${record.tool.githubRepository}/releases/latest`
    };
  }
  const fallbackPackage = record.tool?.npmPackages?.[0];
  if (fallbackPackage) {
    return {
      type: 'npm',
      name: fallbackPackage,
      url: `https://registry.npmjs.org/${encodeURIComponent(fallbackPackage)}/latest`
    };
  }
  return null;
}

function latestVersionFromPayload(request, payload) {
  if (!request || !payload || typeof payload !== 'object') return null;
  if (request.type === 'npm') return extractVersion(payload.version);
  if (request.type === 'pypi') return extractVersion(payload.info?.version);
  if (request.type === 'github') return extractVersion(payload.tag_name || payload.name);
  if (request.type === 'brew') {
    if (request.kind === 'cask') return extractVersion(payload.version);
    const stable = payload.versions?.stable || payload.version;
    return extractVersion(stable);
  }
  return null;
}

function isTrustedLatestRequest(request) {
  if (!request || typeof request !== 'object') return false;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return false;
    const hosts = {
      npm: 'registry.npmjs.org',
      brew: 'formulae.brew.sh',
      pypi: 'pypi.org',
      github: 'api.github.com'
    };
    if (url.hostname.toLowerCase() !== hosts[request.type]) return false;
    if (request.type === 'github') {
      return /^\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(url.pathname);
    }
    if (request.type === 'pypi') return /^\/pypi\/[^/]+\/json$/.test(url.pathname);
    if (request.type === 'brew') return /^\/api\/(?:formula|cask)\/[^/]+\.json$/.test(url.pathname);
    return request.type === 'npm' && url.pathname.endsWith('/latest');
  } catch (_error) {
    return false;
  }
}

function updatePlanFor(record) {
  if (!record?.installed) return { mode: 'manual', reason: 'not-installed' };
  if (record.kind === 'desktop') return { mode: 'manual', reason: 'desktop-managed' };
  if (record.kind === 'terminal') return { mode: 'none', reason: 'system-managed' };
  const installation = record.installation || {};
  if (installation.manager === 'npm' && installation.packageName && installation.writable) {
    return {
      mode: 'automatic',
      manager: 'npm',
      packageName: installation.packageName,
      prefix: installation.prefix || null
    };
  }
  if (installation.manager === 'brew' && installation.packageName && installation.writable) {
    return {
      mode: 'automatic',
      manager: 'brew',
      packageName: installation.packageName,
      brewKind: installation.brewKind || 'formula'
    };
  }
  if (installation.manager === 'uv' && installation.packageName && installation.writable) {
    return {
      mode: 'automatic',
      manager: 'uv',
      packageName: installation.packageName
    };
  }
  if (installation.manager === 'standalone' && record.tool?.selfUpdateArgs?.length) {
    return {
      mode: 'automatic',
      manager: 'self',
      args: [...record.tool.selfUpdateArgs]
    };
  }
  return {
    mode: 'manual',
    reason: installation.writable === false ? 'not-writable' : 'unknown-installer'
  };
}

function updateArgumentsFor(plan) {
  if (!plan || plan.mode !== 'automatic') return null;
  if (plan.manager === 'npm') {
    const args = ['install', '--global'];
    if (plan.prefix) args.push('--prefix', plan.prefix);
    args.push(`${plan.packageName}@latest`, '--no-audit', '--no-fund');
    return args;
  }
  if (plan.manager === 'brew') {
    return ['upgrade', ...(plan.brewKind === 'cask' ? ['--cask'] : []), plan.packageName];
  }
  if (plan.manager === 'uv') return ['tool', 'upgrade', plan.packageName, '--no-cache'];
  if (plan.manager === 'self') return [...(plan.args || [])];
  return null;
}

function applyLatestVersion(record, latestVersion, error = null) {
  const next = { ...record, latestVersion: extractVersion(latestVersion), checkError: error || null };
  const comparison = next.installedVersion && next.latestVersion
    ? compareVersions(next.latestVersion, next.installedVersion)
    : null;
  next.updateAvailable = comparison === null ? null : comparison > 0;
  return next;
}

function publicRecord(record) {
  const plan = record.updatePlan || updatePlanFor(record);
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    detail: record.detail,
    installed: Boolean(record.installed),
    installedVersion: record.installedVersion || null,
    latestVersion: record.latestVersion || null,
    updateAvailable: typeof record.updateAvailable === 'boolean' ? record.updateAvailable : null,
    checkError: record.checkError || null,
    source: record.source || '',
    sourceKey: record.sourceKey || null,
    manager: record.installation?.manager ||
      (record.kind === 'desktop' ? 'desktop' : record.kind === 'terminal' ? 'system' : 'unknown'),
    canOpen: record.canOpen !== false,
    canUpdate: plan.mode === 'automatic' || plan.mode === 'manual',
    canAutoUpdate: plan.mode === 'automatic',
    updateReason: plan.reason || null,
    officialUrl: record.tool?.officialUrl || null
  };
}

module.exports = {
  TOOL_CATALOG,
  applyLatestVersion,
  catalogTool,
  compareVersions,
  detectBrewInstallation,
  detectInstallation,
  detectNpmInstallation,
  detectUvInstallation,
  extractVersion,
  isTrustedLatestRequest,
  latestRequestFor,
  latestVersionFromPayload,
  publicRecord,
  updateArgumentsFor,
  updatePlanFor,
  versionParts
};
