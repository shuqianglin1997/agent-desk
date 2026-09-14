const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  defaultMacApplicationActivatorPath,
  validateActivator,
  activateMacProfileApplication
} = require('../src/mac-application-activator');

const profilePath = '/Users/alice/Library/Application Support/AgentDesk/Profiles/Codex/work';
const profile = { id: 'work', profilePath };

function safeFs(overrides = {}) {
  return {
    lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o100755 }),
    ...overrides
  };
}

test('macOS 激活器路径固定在应用原生资源目录', () => {
  assert.equal(defaultMacApplicationActivatorPath({
    isPackaged: true,
    resourcesPath: '/Applications/AgentDesk.app/Contents/Resources'
  }), '/Applications/AgentDesk.app/Contents/Resources/native/AgentDeskAppActivator');
  assert.equal(defaultMacApplicationActivatorPath({
    isPackaged: false,
    appPath: '/repo/AgentDesk'
  }), '/repo/AgentDesk/native/bin/AgentDeskAppActivator');
  assert.equal(defaultMacApplicationActivatorPath({ isPackaged: true, resourcesPath: 'relative' }), '');
});

test('按精确 Profile 根 PID 调用固定 helper，不经 shell且不触碰其他账号', async () => {
  const calls = [];
  const result = await activateMacProfileApplication(profile, {
    platform: 'darwin',
    helperPath: '/fixed/AgentDeskAppActivator',
    fs: safeFs(),
    records: [
      { pid: 41, ppid: 1, command: `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=${profilePath}` },
      { pid: 42, ppid: 41, command: `Codex Renderer --type=renderer --user-data-dir=${profilePath}` },
      { pid: 91, ppid: 1, command: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/Profiles/other' }
    ],
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null, '', '');
    }
  });
  assert.deepEqual(result, { ok: true, pid: 41 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/fixed/AgentDeskAppActivator');
  assert.deepEqual(calls[0].args, ['--pid', '41']);
  assert.equal(calls[0].options.shell, false);
});

test('进程快照和 helper 路径异常时失败关闭，不退化为全局 bundle 激活', async () => {
  assert.deepEqual(await activateMacProfileApplication(profile, {
    platform: 'darwin', records: null, helperPath: '/fixed/helper', fs: safeFs()
  }), { ok: false, reasonCode: 'profile-activation-process-snapshot-unavailable' });
  assert.deepEqual(await activateMacProfileApplication(profile, {
    platform: 'darwin', records: [], helperPath: '/fixed/helper', fs: safeFs()
  }), { ok: false, reasonCode: 'profile-activation-main-process-not-found' });
  assert.deepEqual(validateActivator('/fixed/helper', safeFs({
    lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true, mode: 0o100755 })
  })), { ok: false, reasonCode: 'profile-activation-helper-unsafe' });
});

test('原生激活器只使用 NSRunningApplication，不声明隐私敏感控制 API', () => {
  const root = path.join(__dirname, '..');
  const swift = fs.readFileSync(path.join(root, 'native', 'macos', 'AgentDeskAppActivator.swift'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(swift, /NSRunningApplication/);
  assert.match(swift, /activateAllWindows/);
  assert.doesNotMatch(swift, /AXIsProcessTrusted|CGEvent|AppleScript|NSAppleScript|AEDesc|System Events/);
  assert.match(main, /preflight\.alreadyRunning[\s\S]*activateMacProfileApplication/);
  assert.match(main, /main\.launch\.activated/);
});
