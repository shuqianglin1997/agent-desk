const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseLsofProcesses,
  temporarilyKeepManagedClients,
  installLocalMacApp
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-local-install-settings-'));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-local-install-order-'));
  try {
    const source = path.join(root, 'source', 'AgentDesk.app');
    const target = path.join(root, 'Applications', 'AgentDesk.app');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const calls = [];
    let processChecks = 0;

    await installLocalMacApp({
      source,
      target,
      allowNonDarwin: true,
      allowCustomTarget: true,
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
            command: 'AgentDesk',
            paths: [path.join(target, 'Contents', 'MacOS', 'AgentDesk')]
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

test('有运行中的 AgentDesk 且未选择保留客户端时拒绝触碰目标', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-local-install-running-'));
  try {
    const source = path.join(root, 'source', 'AgentDesk.app');
    const target = path.join(root, 'Applications', 'AgentDesk.app');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-local-install-rollback-'));
  try {
    const source = path.join(root, 'source', 'AgentDesk.app');
    const target = path.join(root, 'Applications', 'AgentDesk.app');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    const calls = [];
    let launched = false;
    let terminated = false;
    const targetProcess = {
      pid: 73,
      command: 'AgentDesk',
      paths: [path.join(target, 'Contents', 'MacOS', 'AgentDesk')]
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
