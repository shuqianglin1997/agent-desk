/*
 * AgentDesk — 受管客户端目录。
 *
 * 每个受管的 AI 客户端在 src/clients/<id>/ 里有一个适配器，集中它的全部差异：
 * 显示名与配色、可执行文件名、默认数据目录规则、会话根目录规则、启动环境、
 * 会话扫描器与扫描区域、诊断区域、发现特征、密钥交接方式。这里只按固定顺序
 * 收集它们，并提供与具体客户端无关的通用函数（启动计划、默认目录、给界面的
 * 精简元数据）。
 *
 * 加一个客户端 = 加一个 src/clients/<id>/ 目录并在 ADAPTERS 里登记；其余代码
 * 只问适配器“会不会、结果是什么”，不写 `appId === 'codex' ? … : …`。
 *
 * 纯 Node，可单测，不依赖 Electron。
 */

const { ok, fail } = require('./core/result');
const os = require('node:os');
const path = require('node:path');
const windows = require('./windows');
const { appSupportDir } = require('./clients/shared');
const { CLAUDE_CODE_ENV_KEYS, withoutClaudeCodeEnvironment } = require('./clients/claude-cli/environment');

// The order is the order clients appear in lists.
const ADAPTERS = [
  require('./clients/claude'),
  require('./clients/claude-cli'),
  require('./clients/dsh-cli'),
  require('./clients/codex'),
  require('./clients/kimi'),
  require('./clients/kimi-work'),
  require('./clients/opencode'),
  require('./clients/gemini-cli'),
  require('./clients/qwen-code'),
  require('./clients/cursor')
];

const APPS = Object.fromEntries(ADAPTERS.map((adapter) => [adapter.id, adapter]));
const DSH_ENV_KEYS = APPS['dsh-cli'].cliClearEnvKeys;

const DEFAULT_APP = 'claude';

function getApp(appId) {
  return APPS[appId] || APPS[DEFAULT_APP];
}

function isKnownApp(appId) {
  return Object.prototype.hasOwnProperty.call(APPS, appId);
}

function appIds() {
  return Object.keys(APPS);
}

// 给渲染进程用的精简元数据（不含函数/路径逻辑）
function listApps() {
  return appIds().map((id) => ({
    id,
    label: APPS[id].label,
    tagColor: APPS[id].tagColor,
    canExportTranscript: typeof APPS[id].exportTranscript === 'function',
    taskPackageMode: APPS[id].taskPackage
      ? 'native'
      : (typeof APPS[id].exportTranscript === 'function' ? 'transcript' : 'unsupported'),
    canLaunch: APPS[id].noLaunch !== true || Boolean(APPS[id].cliDiscoveryId),
    supportsManagedProfiles: APPS[id].profileIsolation?.mode === 'chromium-user-data-dir',
    signIn: signInMethods(APPS[id]),
    discoveryKind: APPS[id].discovery?.kind || null,
    defaultOnly: APPS[id].profileIsolation?.mode === 'official-default-only'
  }));
}

// Which ways of signing in a new account the recruit dialog may offer.
function signInMethods(app_) {
  const credentials = app_.credentials;
  return {
    browser: app_.profileIsolation?.mode !== 'official-default-only',
    key: Boolean(credentials?.key),
    keyKinds: [...(credentials?.key?.kinds || [])],
    keyNeedsCatalogProvider: credentials?.key?.catalogProvider === true,
    keyCatalogDefault: credentials?.key?.catalogDefault || (credentials?.key?.catalogProvider ? 'kimi-for-coding' : null),
    provider: Boolean(credentials?.provider),
    providerFields: [...(credentials?.provider?.fields || [])],
    providerOptionalFields: [...(credentials?.provider?.optional || [])],
    storesInPlaintext: Boolean(credentials?.key?.plaintext || credentials?.provider?.plaintext),
    importFiles: [...(credentials?.importFiles || [])]
  };
}

function macLauncherCandidates(appId, options = {}) {
  const app_ = getApp(appId);
  const home = options.home || os.homedir();
  const roots = options.applicationRoots || [
    '/Applications',
    path.join(home, 'Applications')
  ];
  const launchers = app_.mac?.launchers || [{
    bundleName: app_.appName,
    executableName: app_.appName
  }];
  const candidates = [];
  for (const launcher of launchers) {
    for (const root of roots) {
      const bundlePath = path.join(root, `${launcher.bundleName}.app`);
      candidates.push({
        bundleName: launcher.bundleName,
        executableName: launcher.executableName,
        bundlePath,
        path: path.join(bundlePath, 'Contents', 'MacOS', launcher.executableName),
        bundleIdentifiers: [...(launcher.bundleIdentifiers || [])]
      });
    }
  }
  return candidates;
}

function macLaunchAppName(appId) {
  return getApp(appId).mac?.launchers?.[0]?.bundleName || getApp(appId).appName;
}

function profileLaunchPlan(profile = {}, options = {}) {
  const app_ = getApp(profile.appId);
  // CLI entry points use an explicit config root, not Chromium profile args.
  // Mesh readiness consumes this same capability plan as desktop slots.
  if (app_.cliDiscoveryId) {
    if (!String(profile.sessionRoot || '').trim()) {
      return { ok: false, reasonCode: 'session-root-required', args: [] };
    }
    return {
      ok: true,
      isolated: profile.isProtected !== true && profile.sessionRootMode !== 'auto',
      args: app_.cliArgsForProfile ? app_.cliArgsForProfile(profile) : []
    };
  }
  if (app_.noLaunch === true) {
    return { ok: false, reasonCode: 'client-form-unsupported', args: [] };
  }
  if (options.useOfficialDefault === true) {
    return { ok: true, isolated: false, args: [] };
  }
  const mode = app_.profileIsolation?.mode;
  if (mode === 'chromium-user-data-dir') {
    const profilePath = String(profile.profilePath || '').trim();
    if (!profilePath) {
      return { ok: false, reasonCode: 'profile-path-required', args: [] };
    }
    return {
      ok: true,
      isolated: true,
      args: [`--user-data-dir=${profilePath}`]
    };
  }
  if (mode === 'official-default-only') {
    const officialDefault = profile.isProtected === true && profile.profilePathMode === 'auto';
    return officialDefault
      ? { ok: true, isolated: false, args: [] }
      : { ok: false, reasonCode: 'profile-isolation-unsupported', args: [] };
  }
  return { ok: false, reasonCode: 'profile-isolation-unsupported', args: [] };
}

// 数据目录名默认与 App 显示名一致；Electron App 的 userData 可能不同（如 Kimi → kimi-desktop）
function profileDirName(app_) {
  return app_.profileDirName || app_.appName;
}

function defaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') {
    return windows.chooseWindowsDefaultProfilePath(app_).path;
  }
  return appSupportDir(profileDirName(app_));
}

function defaultProfilePathInfo(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.chooseWindowsDefaultProfilePath(app_);
  const profilePath = appSupportDir(profileDirName(app_));
  return { path: profilePath, source: '系统默认目录', candidates: [{ path: profilePath, source: '系统默认目录', score: 1 }] };
}

function legacyDefaultProfilePath(appId) {
  const app_ = getApp(appId);
  if (process.platform === 'win32') return windows.legacyDefaultProfilePath(app_);
  return appSupportDir(profileDirName(app_));
}

// A scan as a result (src/core/result.js): ok(rows, { truncated }) or
// fail(code) when the client's store exists but cannot be read. `scan()`
// keeps returning rows and throwing, for the callers that already handle it.
function scanResult(profile) {
  const report = {};
  try {
    const rows = getApp(profile.appId).scan(profile, report);
    return ok(Array.isArray(rows) ? rows : [], { truncated: report.truncated === true });
  } catch (error) {
    return fail(/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(error?.code || '')) ? error.code : 'session-scan-failed');
  }
}

module.exports = {
  APPS,
  scanResult,
  DEFAULT_APP,
  CLAUDE_CODE_ENV_KEYS,
  DSH_ENV_KEYS,
  getApp,
  isKnownApp,
  appIds,
  listApps,
  macLauncherCandidates,
  macLaunchAppName,
  profileLaunchPlan,
  defaultProfilePath,
  defaultProfilePathInfo,
  legacyDefaultProfilePath,
  appSupportDir,
  withoutClaudeCodeEnvironment
};
