const { test } = require('node:test');
const assert = require('node:assert');

const {
  CLI_DEFINITIONS,
  cliCandidates,
  resolveExecutableCandidates,
  discoverCli
} = require('../src/cli-discovery');

test('工具发现清单覆盖所有受维护的 Agent CLI，但不携带运行参数', () => {
  assert.deepEqual(Object.keys(CLI_DEFINITIONS), [
    'claude',
    'gemini',
    'opencode',
    'cursor-agent',
    'github-copilot',
    'goose',
    'kimi',
    'qwen-code'
  ]);
  assert.ok(Object.values(CLI_DEFINITIONS).every((item) => item.names.length));
  assert.ok(Object.values(CLI_DEFINITIONS).every((item) => !Object.hasOwn(item, 'args')));
});

test('Windows CLI 发现同时覆盖 exe、cmd 和应用别名', () => {
  const candidates = cliCandidates(['opencode'], {
    platform: 'win32',
    home: 'C:\\Users\\alice',
    env: { PATH: 'C:\\Tools', APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }
  });
  assert.ok(candidates.some((item) => item.path === 'C:\\Tools\\opencode.exe'));
  assert.ok(candidates.some((item) => item.path === 'C:\\Tools\\opencode.cmd'));
  assert.ok(candidates.some((item) => item.path.endsWith('Microsoft\\WindowsApps\\opencode.exe')));
});

test('Windows cmd 工具通过 cmd.exe 参数数组启动，不开启 shell 字符串拼接', () => {
  const launcher = resolveExecutableCandidates([
    { path: 'C:\\Tools\\agent.cmd', source: 'test' }
  ], {
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    fs: {
      statSync: () => ({ isFile: () => true }),
      realpathSync: (value) => value
    }
  });
  assert.equal(launcher.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(launcher.prefixArgs, ['/D', '/S', '/C', 'C:\\Tools\\agent.cmd']);
});

test('发现结果只返回本地启动器，不附加协议或会话参数', () => {
  const launcher = discoverCli('gemini', {
    platform: 'darwin',
    env: { PATH: '/tools' },
    home: '/Users/test',
    fs: {
      statSync: (value) => ({ isFile: () => value === '/tools/gemini' }),
      realpathSync: (value) => value
    }
  });
  assert.equal(launcher.command, '/tools/gemini');
  assert.deepEqual(launcher.prefixArgs, []);
});
