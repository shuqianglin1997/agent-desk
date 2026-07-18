const { test } = require('node:test');
const assert = require('node:assert');

const {
  ACP_PRESETS,
  cliCandidates,
  normalizeCustomAgentList,
  parseArgumentLines
} = require('../src/agent-registry');
const { resolveExecutableCandidates } = require('../src/runtime');

test('常用 ACP Agent 注册表覆盖主流 CLI 且每个都有明确启动参数', () => {
  assert.deepEqual(
    ACP_PRESETS.map((item) => item.id),
    ['gemini', 'opencode', 'cursor-agent', 'github-copilot', 'goose', 'kimi', 'qwen-code']
  );
  assert.ok(ACP_PRESETS.every((item) => item.names.length && item.args.length));
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

test('Windows cmd Agent 通过 cmd.exe 参数数组启动，不开启 shell 字符串拼接', () => {
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

test('自定义 Agent 参数按行解析并过滤损坏或重复定义', () => {
  assert.deepEqual(parseArgumentLines('acp\n--profile\nwork'), ['acp', '--profile', 'work']);
  const values = normalizeCustomAgentList([
    { id: 'one', name: '内部 Agent', executable: '/tools/agent', args: ['acp'] },
    { id: 'one', name: '重复', executable: '/tools/other', args: [] },
    { id: 'bad', name: '', executable: 'relative/path', args: [] }
  ]);
  assert.equal(values.length, 1);
  assert.equal(values[0].name, '内部 Agent');
});
