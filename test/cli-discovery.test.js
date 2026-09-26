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
    'dsh',
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

test('无扩展名 Node shebang CLI 使用 Node 解释器并补齐脚本目录 PATH', () => {
  const launcher = resolveExecutableCandidates([
    { path: '/Users/test/.npm-global/bin/dsh', source: '用户工具目录' }
  ], {
    platform: 'darwin',
    env: { PATH: '/usr/bin' },
    nodeExecutable: '/usr/local/bin/node',
    fs: {
      statSync: () => ({ isFile: () => true }),
      realpathSync: (value) => value,
      openSync: () => 42,
      readSync: (_fd, buffer) => buffer.write('#!/usr/bin/env node\n'),
      closeSync: () => {}
    }
  });
  assert.equal(launcher.command, '/usr/local/bin/node');
  assert.deepEqual(launcher.prefixArgs, ['/Users/test/.npm-global/bin/dsh']);
  assert.equal(launcher.extraEnv.ELECTRON_RUN_AS_NODE, '1');
  assert.match(launcher.extraEnv.PATH, /^\/Users\/test\/\.npm-global\/bin:/);
  assert.match(launcher.extraEnv.PATH, /(?:^|:)\/usr\/bin$/);
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

test('Claude CLI profile 环境清掉 shell 代理，只保留独立配置根', () => {
  const apps = require('../src/apps');
  const env = apps.getApp('claude-cli').launchEnv({ sessionRoot: '/tmp/hupod-claude' }, {
    PATH: '/usr/bin',
    ANTHROPIC_AUTH_TOKEN: 'shell-token',
    ANTHROPIC_OAUTH_TOKEN: 'oauth-token',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_CONFIG_DIR: '/company/claude-config',
    ANTHROPIC_CUSTOM_HEADERS: 'x-company: yes',
    ANTHROPIC_AWS_REGION: 'us-east-1',
    ANTHROPIC_MODEL: 'deepseek-v4-flash[1m]',
    CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth-token',
    CLAUDE_CODE_API_BASE_URL: 'https://proxy.example.test',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_PLUGIN_ROOT: '/company/plugins',
    CLAUDE_CONFIG_DIR: '/wrong'
  });
  assert.deepEqual(env, {
    PATH: '/usr/bin',
    CLAUDE_CONFIG_DIR: '/tmp/hupod-claude'
  });
  const desktop = apps.getApp('claude').launchEnv({ profilePath: '/tmp/slot' }, {
    PATH: '/usr/bin',
    ANTHROPIC_AUTH_TOKEN: 'shell-token',
    CLAUDE_CONFIG_DIR: '/wrong'
  });
  assert.deepEqual(desktop, { PATH: '/usr/bin' });
});

test('shebang 只读取首256字节，关闭文件，不将后续行误认为解释器', () => {
  for (const head of ['#!/usr/bin/env node\n', 'binary header\n#!/usr/bin/env node\n']) {
    let closed = false;
    const launcher = resolveExecutableCandidates([{ path: '/tools/large-cli', source: 'test' }], {
      platform: 'darwin', nodeExecutable: '/tools/node', env: {},
      fs: {
        statSync: () => ({ isFile: () => true }),
        realpathSync: (value) => value,
        openSync: () => 17,
        readSync: (fd, buffer, offset, length, position) => {
          assert.equal(fd, 17);
          assert.equal(length, 256);
          assert.equal(position, 0);
          return buffer.write(head, offset);
        },
        closeSync: (fd) => { assert.equal(fd, 17); closed = true; }
      }
    });
    assert.equal(closed, true);
    assert.equal(launcher.command, head.startsWith('#!') ? '/tools/node' : '/tools/large-cli');
  }
});
