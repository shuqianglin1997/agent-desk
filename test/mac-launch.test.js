const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  macApplicationBundlePath,
  changedLaunchEnvironment,
  macLaunchServicesArgs
} = require('../src/mac-launch');

test('macOS 受管桌面客户端通过 LaunchServices 启动并保留 Profile 环境', () => {
  const executable = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  assert.equal(macApplicationBundlePath(executable), '/Applications/ChatGPT.app');
  assert.equal(macApplicationBundlePath('/usr/local/bin/chatgpt'), null);

  const baseEnv = { PATH: '/usr/bin', CODEX_HOME: '/old/codex' };
  const launchEnv = { PATH: '/usr/bin', CODEX_HOME: '/new/codex' };
  assert.deepEqual(changedLaunchEnvironment(launchEnv, baseEnv), ['CODEX_HOME=/new/codex']);
  assert.deepEqual(macLaunchServicesArgs(
    '/Applications/ChatGPT.app',
    ['--user-data-dir=/Profiles/Codex'],
    launchEnv,
    baseEnv
  ), [
    '-n',
    '-a',
    '/Applications/ChatGPT.app',
    '--env',
    'CODEX_HOME=/new/codex',
    '--args',
    '--user-data-dir=/Profiles/Codex'
  ]);

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /macLaunchServicesArgs\(bundlePath, args, env, process\.env\)/);
  assert.doesNotMatch(main, /if \(launcher\.found\) \{\s*await launchOwned\(launcher\.path, args, env\)/);
});

test('macOS LaunchServices 参数拒绝畸形应用和环境变量', () => {
  assert.throws(() => macLaunchServicesArgs('', []), /application-invalid/);
  assert.throws(() => changedLaunchEnvironment({ 'BAD-NAME': 'x' }, {}), /env-name-invalid/);
  assert.throws(() => changedLaunchEnvironment({ SAFE_NAME: 'x\0y' }, {}), /env-value-invalid/);
});
