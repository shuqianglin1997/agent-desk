const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const maintenance = require('../src/tool-maintenance');

test('工具目录覆盖桌面应用、CLI 工具和系统终端，ID 与入口唯一', () => {
  const ids = maintenance.TOOL_CATALOG.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(maintenance.TOOL_CATALOG.some((tool) => tool.kind === 'desktop'));
  assert.ok(maintenance.TOOL_CATALOG.some((tool) => tool.kind === 'cli'));
  assert.ok(maintenance.TOOL_CATALOG.some((tool) => tool.kind === 'terminal'));
  const dsh = maintenance.catalogTool('cli:dsh');
  assert.equal(dsh.discoveryId, 'dsh');
  assert.deepEqual(dsh.npmPackages, ['@deepseek-ai/dsh']);
  for (const tool of maintenance.TOOL_CATALOG) {
    if (tool.officialUrl) assert.match(tool.officialUrl, /^https:\/\//);
  }
});

test('宽松版本比较兼容四段版本、v 前缀和预发布版本', () => {
  assert.equal(maintenance.extractVersion('codex-cli 0.125.0'), '0.125.0');
  assert.equal(maintenance.extractVersion('Claude 1.22209.3.7 (release)'), '1.22209.3.7');
  assert.equal(maintenance.compareVersions('v1.3.0', '1.2.9'), 1);
  assert.equal(maintenance.compareVersions('1.2.0', '1.2'), 0);
  assert.equal(maintenance.compareVersions('1.2.0-beta.2', '1.2.0-beta.10'), -1);
  assert.equal(maintenance.compareVersions('invalid', '1.0.0'), null);
});

test('从 npm 符号链接追到 scoped package，并锁定原安装前缀', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-tool-npm-'));
  const prefix = path.join(root, 'prefix');
  const packageRoot = path.join(prefix, 'lib', 'node_modules', '@openai', 'codex');
  const binDir = path.join(prefix, 'bin');
  fs.mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@openai/codex', version: '0.125.0' })
  );
  fs.writeFileSync(path.join(packageRoot, 'bin', 'codex.js'), '#!/usr/bin/env node\n');
  fs.symlinkSync(path.join('..', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), path.join(binDir, 'codex'));

  const tool = maintenance.catalogTool('cli:codex');
  const result = maintenance.detectNpmInstallation(path.join(binDir, 'codex'), tool);
  assert.equal(result.manager, 'npm');
  assert.equal(result.packageName, '@openai/codex');
  assert.equal(result.version, '0.125.0');
  assert.equal(result.prefix, fs.realpathSync(prefix));
  assert.equal(result.writable, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('识别 Homebrew formula / cask 与 uv tool 安装来源', () => {
  const fakeFs = {
    constants: fs.constants,
    realpathSync(value) {
      if (value === '/opt/homebrew/bin/gemini') {
        return '/opt/homebrew/Cellar/gemini-cli/0.9.1/bin/gemini';
      }
      return '/Users/test/.local/share/uv/tools/kimi-cli/bin/kimi';
    },
    accessSync() {}
  };
  const brew = maintenance.detectBrewInstallation(
    '/opt/homebrew/bin/gemini',
    maintenance.catalogTool('cli:gemini'),
    { fs: fakeFs }
  );
  assert.equal(brew.manager, 'brew');
  assert.equal(brew.packageName, 'gemini-cli');
  assert.equal(brew.version, '0.9.1');

  const uv = maintenance.detectUvInstallation(
    '/Users/test/.local/bin/kimi',
    maintenance.catalogTool('cli:kimi'),
    { fs: fakeFs }
  );
  assert.equal(uv.manager, 'uv');
  assert.equal(uv.packageName, 'kimi-cli');
});

test('远端版本请求跟随真实安装来源，不接受 renderer 提供 URL', () => {
  const tool = maintenance.catalogTool('cli:codex');
  const npmRecord = {
    installed: true,
    kind: 'cli',
    tool,
    installation: { manager: 'npm', packageName: '@openai/codex' }
  };
  assert.deepEqual(maintenance.latestRequestFor(npmRecord), {
    type: 'npm',
    name: '@openai/codex',
    url: 'https://registry.npmjs.org/%40openai%2Fcodex/latest'
  });
  assert.equal(
    maintenance.latestVersionFromPayload(
      maintenance.latestRequestFor(npmRecord),
      { version: '0.130.0' }
    ),
    '0.130.0'
  );
  assert.equal(maintenance.isTrustedLatestRequest(maintenance.latestRequestFor(npmRecord)), true);
  assert.equal(maintenance.isTrustedLatestRequest({
    type: 'npm',
    url: 'https://attacker.example/@openai/codex/latest'
  }), false);
});

test('更新计划只为可写且识别出的来源自动执行，公开记录不泄露路径或命令', () => {
  const tool = maintenance.catalogTool('cli:claude');
  const record = maintenance.applyLatestVersion({
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
    detail: tool.detail,
    tool,
    installed: true,
    installedVersion: '2.1.112',
    source: 'npm',
    sourceKey: 'npmGlobal',
    executablePath: '/secret/bin/claude',
    launcher: { command: '/secret/bin/node', prefixArgs: ['/secret/cli.js'] },
    installation: {
      manager: 'npm',
      packageName: '@anthropic-ai/claude-code',
      prefix: '/secret/prefix',
      writable: true
    }
  }, '2.1.120');
  record.updatePlan = maintenance.updatePlanFor(record);
  assert.deepEqual(record.updatePlan, {
    mode: 'automatic',
    manager: 'npm',
    packageName: '@anthropic-ai/claude-code',
    prefix: '/secret/prefix'
  });
  assert.deepEqual(maintenance.updateArgumentsFor(record.updatePlan), [
    'install',
    '--global',
    '--prefix',
    '/secret/prefix',
    '@anthropic-ai/claude-code@latest',
    '--no-audit',
    '--no-fund'
  ]);
  const publicValue = maintenance.publicRecord(record);
  assert.equal(publicValue.updateAvailable, true);
  assert.equal(publicValue.canAutoUpdate, true);
  assert.equal(publicValue.sourceKey, 'npmGlobal');
  assert.equal(Object.prototype.hasOwnProperty.call(publicValue, 'executablePath'), false);
  assert.equal(JSON.stringify(publicValue).includes('/secret'), false);

  assert.equal(maintenance.updatePlanFor({
    ...record,
    installation: { ...record.installation, writable: false }
  }).mode, 'manual');
});
test('工具中心只有匹配的 CLI 槽位传入账号环境，普通工具不被桌面选择阻断', async () => {
  const vm = require('node:vm');
  const apps = require('../src/apps');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const source = main.slice(main.indexOf('async function openMaintenanceTool('), main.indexOf('async function openMaintenanceOfficialPage('));
  const profiles = [{ id: 'desktop', appId: 'codex' }, { id: 'cli', appId: 'claude-cli', sessionRoot: '/isolated' }];
  const calls = [];
  const tool = maintenance.catalogTool('cli:claude');
  const open = vm.runInNewContext(source + '\nopenMaintenanceTool', {
    toolMaintenance: maintenance, apps, t: key => key,
    maintenanceRecord: async () => ({ installed: true, tool }),
    loadProfiles: () => profiles,
    openMaintenanceCliInTerminal: async (_record, profile, requested) => { calls.push({ profile, requested }); return { ok: true }; }
  });
  assert.equal((await open('cli:claude', 'desktop')).ok, true);
  assert.deepEqual(calls.pop(), { profile: null, requested: false });
  assert.equal((await open('cli:claude', 'cli')).ok, true);
  assert.deepEqual(calls.pop(), { profile: profiles[1], requested: true });
  assert.equal((await open('cli:claude', 'missing')).ok, false);
  assert.equal(calls.length, 0);
});

test('CLI 账号上下文拒绝错配并保留清理后的环境和固定 DSH web 参数', () => {
  const vm = require('node:vm');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const source = main.slice(main.indexOf('function cliMaintenanceProfileContext('), main.indexOf('async function openMaintenanceCliInTerminal('));
  const context = vm.runInNewContext(source + '\ncliMaintenanceProfileContext', {
    apps: require('../src/apps'), t: key => key,
    process: { env: { Path: '/tools', Anthropic_Api_Key: 'synthetic', claude_config_dir: '/wrong' } }
  });
  assert.ok(context({ tool: { discoveryId: 'dsh' } }, { appId: 'claude-cli' }, true).error);
  assert.ok(context({}, null, true).error);
  const claude = context({ tool: { discoveryId: 'claude' } }, { appId: 'claude-cli', sessionRoot: '/isolated' }, true);
  assert.deepEqual(JSON.parse(JSON.stringify(claude.launchEnv)), { Path: '/tools', CLAUDE_CONFIG_DIR: '/isolated' });
  assert.ok(claude.clearEnvKeys.includes('Anthropic_Api_Key'));
  const dsh = context({ tool: { discoveryId: 'dsh' } }, { appId: 'dsh-cli', sessionRoot: '/isolated' }, true);
  assert.deepEqual(Array.from(dsh.args), ['--profile', 'web']);
});
