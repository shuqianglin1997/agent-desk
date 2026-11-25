const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp');

const { spawnSync } = require('node:child_process');
const {
  DEFAULT_TARGET,
  LEGACY_TARGET,
  DEFAULT_SETTINGS,
  COMMAND_MARKER,
  parseLsofProcesses,
  temporarilyKeepManagedClients,
  removeLegacyBundle,
  writeCommandLaunchers,
  installLocalMacApp,
  validateInstallPaths
} = require('../scripts/install-local-macos');

test('lsof 解析使用真实映射路径识别临时目录中的旧 AgentDesk bundle', () => {
  const parsed = parseLsofProcesses([
    'p42666',
    'cAgentDesk',
    'n/private/tmp/AgentDesk.app.before-permission-fix/Contents/MacOS/AgentDesk',
    'n/usr/lib/dyld',
    'p42676',
    'cAgentDesk Helper',
    'n/private/tmp/AgentDesk.app.before-permission-fix/Contents/Frameworks/AgentDesk Helper.app/Contents/MacOS/AgentDesk Helper',
    ''
  ].join('\n'));

  assert.deepEqual(parsed.map((entry) => entry.pid), [42666, 42676]);
  assert.match(parsed[0].paths[0], /AgentDesk\.app\.before-permission-fix/);
});

test('临时保留客户端后会逐字节恢复原 settings.json', () => {
  const root = makeTempDir('agentdesk-local-install-settings-');
  try {
    const settingsFile = path.join(root, 'settings.json');
    const original = '{\n  "version": 4,\n  "settings": {\n    "profileQuitBehavior": "close",\n    "lang": "zh"\n  }\n}\n';
    fs.writeFileSync(settingsFile, original, { mode: 0o600 });
    const restore = temporarilyKeepManagedClients(settingsFile, {});
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).settings.profileQuitBehavior, 'keep');
    restore();
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('安装器在任何目标变更前再次确认没有活跃 bundle 映射', async () => {
  const root = makeTempDir('agentdesk-local-install-order-');
  try {
    const source = path.join(root, 'source', 'Catshelf.app');
    const target = path.join(root, 'Applications', 'Catshelf.app');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const calls = [];
    let processChecks = 0;

    await installLocalMacApp({
      source,
      target,
      allowNonDarwin: true,
      allowCustomTarget: true,
      writeCommands: false,
      launchTimeoutMs: 100
    }, {
      verifyBundle: () => calls.push('verify'),
      bundleIdentifier: () => 'com.hupo.agentdesk',
      listProcesses: () => {
        processChecks += 1;
        calls.push(`process-check-${processChecks}`);
        if (processChecks >= 3) {
          return [{
            pid: 99999,
            command: 'Catshelf',
            paths: [path.join(target, 'Contents', 'MacOS', 'Catshelf')]
          }];
        }
        return [];
      },
      copyBundle: (_from, to) => {
        calls.push('copy');
        fs.mkdirSync(to, { recursive: true });
      },
      launchBundle: () => calls.push('launch'),
      sleep: async () => {}
    });

    assert.ok(calls.indexOf('process-check-2') < calls.indexOf('copy'));
    assert.ok(calls.indexOf('copy') < calls.indexOf('launch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('有运行中的旧 AgentDesk 且未选择保留客户端时拒绝触碰目标', async () => {
  const root = makeTempDir('agentdesk-local-install-running-');
  try {
    const source = path.join(root, 'source', 'Catshelf.app');
    const target = path.join(root, 'Applications', 'Catshelf.app');
    fs.mkdirSync(source, { recursive: true });
    let copied = false;
    await assert.rejects(installLocalMacApp({
      source,
      target,
      allowNonDarwin: true,
      allowCustomTarget: true
    }, {
      verifyBundle: () => {},
      bundleIdentifier: () => 'com.hupo.agentdesk',
      listProcesses: () => [{ pid: 42, command: 'AgentDesk', paths: ['/Applications/AgentDesk.app/Contents/MacOS/AgentDesk'] }],
      copyBundle: () => { copied = true; }
    }), { code: 'agentdesk-running' });
    assert.equal(copied, false);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('启动后若仍有进程映射新 bundle，回滚前必须先终止并复核', async () => {
  const root = makeTempDir('agentdesk-local-install-rollback-');
  try {
    const source = path.join(root, 'source', 'Catshelf.app');
    const target = path.join(root, 'Applications', 'Catshelf.app');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    const calls = [];
    let launched = false;
    let terminated = false;
    const targetProcess = {
      pid: 73,
      command: 'Catshelf',
      paths: [path.join(target, 'Contents', 'MacOS', 'Catshelf')]
    };

    await assert.rejects(installLocalMacApp({
      source,
      target,
      allowNonDarwin: true,
      allowCustomTarget: true,
      launchTimeoutMs: 50,
      quitTimeoutMs: 50
    }, {
      verifyBundle: () => {},
      bundleIdentifier: () => 'com.hupo.agentdesk',
      listProcesses: () => (launched && !terminated ? [targetProcess] : []),
      terminateProcesses: () => {
        calls.push('terminate-before-rollback');
        terminated = true;
      },
      copyBundle: (_from, to) => fs.mkdirSync(to, { recursive: true }),
      launchBundle: () => {
        launched = true;
        throw Object.assign(new Error('launch-reported-failure'), { code: 'launch-reported-failure' });
      },
      sleep: async () => {}
    }), { code: 'launch-reported-failure' });

    assert.deepEqual(calls, ['terminate-before-rollback']);
    assert.equal(fs.existsSync(target), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('改名：装 /Applications/Catshelf.app，删的是 /Applications/AgentDesk.app，设置仍在旧数据目录', () => {
  assert.equal(DEFAULT_TARGET, '/Applications/Catshelf.app');
  assert.equal(LEGACY_TARGET, '/Applications/AgentDesk.app');
  assert.equal(DEFAULT_SETTINGS, path.join(os.homedir(), 'Library', 'Application Support', 'AgentDesk', 'settings.json'));
  assert.throws(() => validateInstallPaths('/tmp/release/AgentDesk.app', DEFAULT_TARGET, {}), { code: 'source-bundle-name-invalid' });
  assert.throws(() => validateInstallPaths('/tmp/release/Catshelf.app', LEGACY_TARGET, { allowCustomTarget: true }), { code: 'target-bundle-name-invalid' });
  const parsed = parseLsofProcesses(['p7', 'cCatshelf Helper', 'n/Applications/Catshelf.app/Contents/Frameworks/Catshelf Helper.app/Contents/MacOS/Catshelf Helper', ''].join('\n'));
  assert.equal(parsed[0].command, 'Catshelf Helper');
});

function successfulInstallDeps(target, extra = {}) {
  let launched = false;
  return {
    verifyBundle: () => {},
    bundleIdentifier: () => 'com.hupo.agentdesk',
    listProcesses: () => (launched ? [{ pid: 7, command: 'Catshelf', paths: [path.join(target, 'Contents', 'MacOS', 'Catshelf')] }] : []),
    copyBundle: (_from, to) => fs.mkdirSync(path.join(to, 'Contents'), { recursive: true }),
    launchBundle: () => { launched = true; },
    sleep: async () => {},
    ...extra
  };
}

test('新版本启动以后才删旧的 AgentDesk.app，并写 catshelf 与 agentdesk 两个命令', async (t) => {
  const root = makeTempDir(t, 'agentdesk-local-install-rename-');
  const source = path.join(root, 'source', 'Catshelf.app');
  const target = path.join(root, 'Applications', 'Catshelf.app');
  const legacy = path.join(root, 'Applications', 'AgentDesk.app');
  const commands = path.join(root, 'bin');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Contents', 'MacOS', 'AgentDesk'), 'old');
  const result = await installLocalMacApp({
    source, target, legacyTarget: legacy, commandDirectory: commands, allowNonDarwin: true, allowCustomTarget: true, launchTimeoutMs: 100
  }, successfulInstallDeps(target));
  assert.deepEqual(result.legacy, { path: legacy, removed: true, reason: null });
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(target), true);
  assert.deepEqual(result.commands.map((entry) => [entry.name, entry.written]), [['catshelf', true], ['agentdesk', true]]);
  for (const name of ['catshelf', 'agentdesk']) {
    const body = fs.readFileSync(path.join(commands, name), 'utf8');
    assert.ok(body.includes(COMMAND_MARKER));
    assert.ok(body.includes(`exec '${path.join(target, 'Contents', 'MacOS', 'Catshelf')}' --cli "$@"`));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(commands, name)).mode & 0o777, 0o755);
  }
});

test('旧应用不是同一个程序包、正被进程使用或根本不是文件夹时，留着它并说明原因', (t) => {
  const root = makeTempDir(t, 'agentdesk-local-install-legacy-');
  const legacy = path.join(root, 'AgentDesk.app');
  fs.mkdirSync(path.join(legacy, 'Contents'), { recursive: true });
  const base = { bundleIdentifier: () => 'com.hupo.agentdesk', listProcesses: () => [] };
  assert.equal(removeLegacyBundle(legacy, { ...base, bundleIdentifier: () => 'com.example.other' }).reason, 'other-app');
  assert.equal(removeLegacyBundle(legacy, { ...base, bundleIdentifier: () => { throw new Error('no plist'); } }).reason, 'unreadable');
  const inUse = { ...base, listProcesses: () => [{ pid: 9, command: 'AgentDesk', paths: [path.join(legacy, 'Contents', 'MacOS', 'AgentDesk')] }] };
  assert.equal(removeLegacyBundle(legacy, inUse).reason, 'in-use');
  assert.equal(fs.existsSync(legacy), true);
  const link = path.join(root, 'Linked.app');
  fs.symlinkSync(legacy, link);
  assert.equal(removeLegacyBundle(link, base).reason, 'not-a-bundle');
  assert.equal(removeLegacyBundle(path.join(root, 'Missing.app'), base).reason, 'absent');
  assert.equal(removeLegacyBundle(null, base).reason, 'not-checked');
  assert.equal(fs.existsSync(legacy), true);
});

test('不是安装脚本写的同名命令不覆盖；自己写的会更新', (t) => {
  const root = makeTempDir(t, 'agentdesk-local-install-commands-');
  fs.writeFileSync(path.join(root, 'agentdesk'), '#!/bin/sh\necho someone else\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'catshelf'), `#!/bin/sh\n${COMMAND_MARKER}\nexec /old/path --cli "$@"\n`, { mode: 0o755 });
  const results = writeCommandLaunchers(root, '/Applications/Catshelf.app/Contents/MacOS/Catshelf');
  assert.deepEqual(results.map((entry) => [entry.name, entry.written, entry.reason]), [['catshelf', true, null], ['agentdesk', false, 'not-ours']]);
  assert.equal(fs.readFileSync(path.join(root, 'agentdesk'), 'utf8'), '#!/bin/sh\necho someone else\n');
  assert.ok(fs.readFileSync(path.join(root, 'catshelf'), 'utf8').includes("exec '/Applications/Catshelf.app/Contents/MacOS/Catshelf' --cli"));
  assert.deepEqual(fs.readdirSync(root).sort(), ['agentdesk', 'catshelf'], 'no temporary file left');
});

test('两个命令都转给应用的 --cli；开头多写的 --cli 被忽略', { skip: process.platform === 'win32' }, (t) => {
  const root = makeTempDir(t, 'agentdesk-local-install-run-');
  const fakeApp = path.join(root, 'Fake App');
  fs.writeFileSync(fakeApp, '#!/bin/sh\nfor a in "$@"; do printf "[%s]" "$a"; done\n', { mode: 0o755 });
  const bin = path.join(root, 'bin');
  writeCommandLaunchers(bin, fakeApp);
  const run = (name, args) => spawnSync('/bin/sh', [path.join(bin, name), ...args], { encoding: 'utf8' }).stdout;
  assert.equal(run('catshelf', ['capabilities']), '[--cli][capabilities]');
  assert.equal(run('agentdesk', ['--cli', 'agents', 'list']), '[--cli][agents][list]');
  assert.equal(run('catshelf', ['run', '--title', 'a b']), '[--cli][run][--title][a b]');
});
