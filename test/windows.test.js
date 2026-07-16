const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path').win32;

const updater = require('../src/updater');
const windows = require('../src/windows');

const CLAUDE = {
  id: 'claude',
  appName: 'Claude',
  windows: {
    executableNames: ['Claude.exe'],
    aliases: ['Claude.exe'],
    legacyInstallDirs: ['AnthropicClaude', 'Claude'],
    packageNames: ['Claude'],
    packageFamilyNames: ['Claude_pzs8sxrjxfjjc'],
    packageFamilyPrefixes: ['Claude_'],
    protocol: 'claude://',
    profileMarkers: ['claude-code-sessions', 'Local State']
  }
};

const CODEX = {
  id: 'codex',
  appName: 'Codex',
  windows: {
    executableNames: ['Codex.exe'],
    aliases: ['Codex.exe'],
    legacyInstallDirs: ['Codex', 'OpenAI.Codex'],
    packageNames: ['OpenAI.Codex'],
    packageFamilyNames: ['OpenAI.Codex_2p2nqsd0c76g0'],
    packageFamilyPrefixes: ['OpenAI.Codex_', 'Codex_'],
    protocol: 'codex://',
    profileMarkers: ['Local State']
  }
};

const ENV = {
  USERPROFILE: 'C:\\Users\\alice',
  LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
  APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)'
};

const BASE = { env: ENV, home: ENV.USERPROFILE };

test('Windows 启动器覆盖 Store 别名与旧版 app-* 更新目录', () => {
  const legacyRoot = path.join(ENV.LOCALAPPDATA, 'AnthropicClaude');
  const candidates = windows.windowsExecutableCandidates(CLAUDE, {
    ...BASE,
    listDirectories: (root) => root === legacyRoot ? ['app-0.9.0', 'app-1.10.0'] : []
  });

  assert.equal(
    candidates[0].path,
    path.join(ENV.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'Claude.exe')
  );
  const versioned = candidates.filter((item) => item.source === '旧版自动更新目录');
  assert.equal(versioned[0].path, path.join(legacyRoot, 'app-1.10.0', 'Claude.exe'));
  assert.equal(versioned[1].path, path.join(legacyRoot, 'app-0.9.0', 'Claude.exe'));
});

test('手动路径失效时自动回退到 Store 执行别名', () => {
  const alias = path.join(ENV.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'Claude.exe');
  const result = windows.resolveWindowsLauncher(CLAUDE, {
    ...BASE,
    explicitPath: 'D:\\Old\\Claude.exe',
    exists: (candidate) => candidate.toLowerCase() === alias.toLowerCase()
  });

  assert.equal(result.found, true);
  assert.equal(result.path, alias);
  assert.equal(result.source, 'Microsoft Store 执行别名');
  assert.equal(result.explicitMissing, true);
});

test('PowerShell 已确认的 AppX 可执行文件即使普通 fs 无权 stat 也可作为候选', () => {
  const appx = 'C:\\Program Files\\WindowsApps\\Claude_1.2.3.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe';
  const result = windows.resolveWindowsLauncher(CLAUDE, {
    ...BASE,
    appxExecutablePaths: [appx],
    exists: () => false
  });
  assert.equal(result.found, true);
  assert.equal(result.path, appx);
  assert.equal(result.source, 'Microsoft Store / MSIX 包');
});

test('MSIX 包仓库注册表候选可启动真机反馈中的 Store Claude 路径', () => {
  const executable =
    'C:\\Program Files\\WindowsApps\\Claude_1.21459.1.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe';
  const result = windows.resolveWindowsLauncher(CLAUDE, {
    ...BASE,
    msixRegistryExecutablePaths: [executable],
    exists: (candidate) => candidate.toLowerCase() === executable.toLowerCase()
  });

  assert.equal(result.found, true);
  assert.equal(result.path, executable);
  assert.equal(result.source, 'Microsoft Store / MSIX 包仓库注册表');
});

test('MSIX 包仓库按四段版本数值排序，并排除资源包和相似包名', () => {
  const root =
    'HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';
  const latest = `${root}\\Claude_1.21459.1.0_x64__pzs8sxrjxfjjc`;
  const output = [
    `${root}\\Claude_1.99.0.0_x64__pzs8sxrjxfjjc`,
    latest,
    `${root}\\Claude_1.21459.1.0_neutral_zh-cn_pzs8sxrjxfjjc`,
    `${root}\\ClaudeBeta_9.0.0.0_x64__pzs8sxrjxfjjc`
  ].join('\r\n');

  assert.deepEqual(
    windows.msixRepositoryPackageKeys(CLAUDE, output, { arch: 'x64' }),
    [
      latest,
      `${root}\\Claude_1.99.0.0_x64__pzs8sxrjxfjjc`
    ]
  );
});

test('MSIX 包仓库使用注册的包身份名，不假设包名等于 appName', () => {
  const root =
    'HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';
  const packageKey = `${root}\\OpenAI.Codex_2.3.4.5_x64__2p2nqsd0c76g0`;
  const output = [
    packageKey,
    `${root}\\CodexCLI_9.0.0.0_x64__2p2nqsd0c76g0`
  ].join('\r\n');

  assert.deepEqual(
    windows.msixRepositoryPackageKeys(CODEX, output, { arch: 'x64' }),
    [packageKey]
  );
});

test('能从 reg.exe 输出读取 PackageRootFolder 并生成常见 exe 路径', () => {
  const packageRoot =
    'C:\\Program Files\\WindowsApps\\Claude_1.21459.1.0_x64__pzs8sxrjxfjjc';
  const output = [
    '',
    'HKEY_CURRENT_USER\\...\\Claude_1.21459.1.0_x64__pzs8sxrjxfjjc',
    `    PackageRootFolder    REG_SZ    ${packageRoot}`,
    ''
  ].join('\r\n');
  const parsedRoot = windows.registryValueFromQuery(output, 'PackageRootFolder');

  assert.equal(parsedRoot, packageRoot);
  assert.deepEqual(windows.msixExecutablePaths(CLAUDE, [parsedRoot]), [
    path.join(packageRoot, 'app', 'Claude.exe'),
    path.join(packageRoot, 'Claude.exe')
  ]);
});

test('AppX 发现脚本按行分隔语句，并覆盖包族前缀', () => {
  const script = windows.appxExecutableDiscoveryScript(CLAUDE);
  assert.match(script, /\$package = \$_\r\n    \$root = \$package\.InstallLocation/);
  assert.match(script, /\$packageFamilyPrefixes = @\('Claude_'\)/);
  assert.match(script, /\$family\.StartsWith\(\$_, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
});

test('Windows PowerShell 能解析发现脚本和 portable 替换脚本', {
  skip: process.platform !== 'win32'
}, () => {
  const parser = [
    '$source = [Console]::In.ReadToEnd()',
    '$tokens = $null',
    '$errors = $null',
    '[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }'
  ].join('; ');
  for (const script of [
    windows.appxExecutableDiscoveryScript(CLAUDE),
    updater.windowsUpdaterScript()
  ]) {
    execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      parser
    ], {
      input: script,
      encoding: 'utf8',
      windowsHide: true
    });
  }
});

test('自动发现会排除 npm / WinGet Links 中同名的 CLI shim', () => {
  const candidates = windows.windowsExecutableCandidates(CLAUDE, {
    ...BASE,
    registryExecutablePaths: [
      'C:\\Users\\alice\\AppData\\Roaming\\npm\\claude.exe',
      'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe'
    ]
  });
  assert.equal(candidates.some((item) => item.source === 'Windows App Paths 注册表'), false);
});

test('默认数据目录优先选择真正含会话的 MSIX LocalCache', () => {
  const legacy = path.join(ENV.APPDATA, 'Claude');
  const packaged = path.join(
    ENV.LOCALAPPDATA,
    'Packages',
    'Claude_pzs8sxrjxfjjc',
    'LocalCache',
    'Roaming',
    'Claude'
  );
  const existing = new Set([
    legacy.toLowerCase(),
    packaged.toLowerCase(),
    path.join(packaged, 'claude-code-sessions').toLowerCase()
  ]);
  const result = windows.chooseWindowsDefaultProfilePath(CLAUDE, {
    ...BASE,
    exists: (candidate) => existing.has(candidate.toLowerCase()),
    listDirectories: () => [],
    listEntries: () => []
  });

  assert.equal(result.path, packaged);
  assert.equal(result.source, 'MSIX 虚拟化 Roaming 目录');
});

test('空 MSIX 目录不会压过仍含会话的传统目录', () => {
  const legacy = path.join(ENV.APPDATA, 'Claude');
  const packaged = path.join(
    ENV.LOCALAPPDATA,
    'Packages',
    'Claude_pzs8sxrjxfjjc',
    'LocalCache',
    'Roaming',
    'Claude'
  );
  const existing = new Set([
    legacy.toLowerCase(),
    packaged.toLowerCase(),
    path.join(legacy, 'claude-code-sessions').toLowerCase()
  ]);
  const result = windows.chooseWindowsDefaultProfilePath(CLAUDE, {
    ...BASE,
    exists: (candidate) => existing.has(candidate.toLowerCase()),
    listDirectories: () => [],
    listEntries: () => []
  });

  assert.equal(result.path, legacy);
  assert.equal(result.source, '传统 Roaming 目录');
});

test('能把 Roaming 逻辑路径映射到 MSIX 实际重定向路径', () => {
  const configured = path.join(ENV.APPDATA, 'AgentDesk', 'Profiles', 'Claude', 'work');
  const candidates = windows.windowsVirtualizedPathCandidates(configured, CLAUDE, {
    ...BASE,
    listDirectories: () => []
  });
  assert.deepEqual(candidates.map((item) => item.path), [
    configured,
    path.join(
      ENV.LOCALAPPDATA,
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache',
      'Roaming',
      'AgentDesk',
      'Profiles',
      'Claude',
      'work'
    )
  ]);
});

test('LocalAppData 下的自定义路径也映射到 LocalCache Local', () => {
  const configured = path.join(ENV.LOCALAPPDATA, 'AgentDeskProfiles', 'work');
  const candidates = windows.windowsVirtualizedPathCandidates(configured, CLAUDE, {
    ...BASE,
    listDirectories: () => []
  });
  assert.equal(
    candidates[1].path,
    path.join(
      ENV.LOCALAPPDATA,
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache',
      'Local',
      'AgentDeskProfiles',
      'work'
    )
  );
});

test('新独立账号根目录位于用户主目录而不是 AppData', () => {
  const root = windows.managedProfilesRoot(BASE);
  assert.equal(root, 'C:\\Users\\alice\\.agentdesk\\profiles');
  assert.equal(windows.isPathInsideWindowsAppData(root, BASE), false);
});

test('新独立账号目录使用稳定 ASCII ID，不把中文显示名写进路径', () => {
  const profilePath = windows.managedProfilePath('Claude', '3b7444f0-示例-4e29', BASE);
  assert.equal(
    profilePath,
    'C:\\Users\\alice\\.agentdesk\\profiles\\Claude\\3b7444f0--4e29'
  );
  assert.equal(/[^\x00-\x7f]/.test(path.relative(ENV.USERPROFILE, profilePath)), false);
});

test('Windows 路径输入支持环境变量、波浪号和引号', () => {
  assert.equal(
    windows.expandWindowsPath('"%APPDATA%\\Claude"', BASE),
    'C:\\Users\\alice\\AppData\\Roaming\\Claude'
  );
  assert.equal(
    windows.expandWindowsPath('~\\.agentdesk\\profiles', BASE),
    'C:\\Users\\alice\\.agentdesk\\profiles'
  );
});

test('扩展长度 UNC 前缀会恢复成普通 UNC 路径', () => {
  assert.equal(
    windows.expandWindowsPath('\\\\?\\UNC\\server\\share\\Claude', BASE),
    '\\\\server\\share\\Claude'
  );
});
