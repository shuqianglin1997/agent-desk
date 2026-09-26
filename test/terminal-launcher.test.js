const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { terminalLauncherScript } = require('../src/terminal-launcher');
const { getApp, CLAUDE_CODE_ENV_KEYS } = require('../src/apps');

function execute(t, options, env) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'launch.command');
  fs.writeFileSync(file, terminalLauncherScript({ home: root, platform: process.platform, ...options }));
  const result = spawnSync('/bin/sh', [file], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(file), false, 'launcher removes itself');
  return JSON.parse(result.stdout);
}

test('执行账号启动脚本后已清理凭据保持缺失，配置根及启动参数保留', { skip: process.platform === 'win32' }, (t) => {
  const baseEnv = { PATH: '/usr/bin:/bin', ANTHROPIC_AUTH_TOKEN: 'synthetic-token', ANTHROPIC_BASE_URL: 'https://example.invalid', CLAUDE_CONFIG_DIR: '/wrong' };
  const sessionRoot = "/tmp/account with spaces and 'quotes' $(false)";
  const result = execute(t, {
    command: process.execPath,
    prefixArgs: ['-e', 'console.log(JSON.stringify({env:process.env,args:process.argv.slice(1)}))', '--'],
    args: ["literal 'quote' $(false)", ''],
    baseEnv,
    launchEnv: getApp('claude-cli').launchEnv({ sessionRoot }, baseEnv),
    clearEnvKeys: CLAUDE_CODE_ENV_KEYS
  }, baseEnv);
  assert.equal(result.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(result.env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(result.env.CLAUDE_CONFIG_DIR, sessionRoot);
  assert.deepEqual(result.args, ["literal 'quote' $(false)", '']);
});

test('完整目标环境的删除与启动器覆盖生效，未指定目标环境保留原值', { skip: process.platform === 'win32' }, (t) => {
  const baseEnv = { PATH: '/usr/bin:/bin', SYNTHETIC_OLD_CONFIG: 'old' };
  const common = { command: process.execPath, prefixArgs: ['-e', 'console.log(JSON.stringify(process.env))'], baseEnv };
  const isolated = execute(t, { ...common, launchEnv: { PATH: baseEnv.PATH }, extraEnv: { SYNTHETIC_LAUNCHER: 'enabled' } }, baseEnv);
  assert.equal(isolated.SYNTHETIC_OLD_CONFIG, undefined);
  assert.equal(isolated.SYNTHETIC_LAUNCHER, 'enabled');
  const inherited = execute(t, common, baseEnv);
  assert.equal(inherited.SYNTHETIC_OLD_CONFIG, 'old');
});

test('Windows脚本同样不写回已清理的认证变量', () => {
  const script = terminalLauncherScript({
    platform: 'win32', home: 'C:\\Users\\test', command: 'C:\\Tools\\claude.exe',
    baseEnv: { ANTHROPIC_AUTH_TOKEN: 'synthetic-secret' }, launchEnv: {},
    clearEnvKeys: ['ANTHROPIC_AUTH_TOKEN']
  });
  assert.match(script, /set "ANTHROPIC_AUTH_TOKEN="/);
  assert.equal(script.includes('synthetic-secret'), false);
});
