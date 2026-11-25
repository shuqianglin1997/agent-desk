// AgentDesk — Codex 官方额度协议与本地缓存降级单测。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { makeTempDir } = require('./helpers/temp');

const {
  targetTriple,
  codexCliCandidates,
  resolveCodexCli,
  queryCodexAppServer,
  readCodexQuota,
  readCachedCodexQuota
} = require('../src/clients/codex/quota');

function mkTmp() {
  return makeTempDir('agentdesk-codex-quota-');
}

test('CLI 候选覆盖 PATH、npm 原生包和 Windows 应用别名', () => {
  assert.equal(targetTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(targetTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
  const candidates = codexCliCandidates({
    platform: 'win32',
    arch: 'x64',
    home: 'C:\\Users\\tester',
    env: {
      PATH: 'C:\\Tools;C:\\Users\\tester\\AppData\\Roaming\\npm',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
    }
  }).map((item) => item.path.toLowerCase());

  assert.ok(candidates.includes('c:\\tools\\codex.exe'));
  assert.ok(candidates.some((item) => item.includes('codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe')));
  assert.ok(candidates.includes('c:\\users\\tester\\appdata\\local\\microsoft\\windowsapps\\codex.exe'));
});

test('Windows PATH 中带引号的目录仍能发现 Codex', () => {
  const candidates = codexCliCandidates({
    platform: 'win32',
    arch: 'x64',
    home: 'C:\\Users\\tester',
    env: { PATH: '"C:\\Program Files\\Codex Bin"' }
  });
  assert.ok(candidates.some((item) => item.path === 'C:\\Program Files\\Codex Bin\\codex.exe'));
});

test('macOS Finder 精简 PATH 下可发现 ChatGPT.app 内置 Codex', () => {
  const bundledCodex = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const resolved = resolveCodexCli({
    platform: 'darwin',
    arch: 'arm64',
    home: '/Users/tester',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    fs: {
      statSync(filePath) {
        if (filePath !== bundledCodex) throw new Error('ENOENT');
        return { isFile: () => true };
      }
    }
  });

  assert.equal(resolved.path, bundledCodex);
  assert.equal(resolved.source, 'ChatGPT App');
});

test('macOS 新旧 App 名称、系统和用户安装目录均支持新版 CLI 布局', () => {
  const home = '/Users/tester';
  for (const appName of ['ChatGPT.app', 'Codex.app']) {
    for (const applications of ['/Applications', path.posix.join(home, 'Applications')]) {
      const resources = path.posix.join(applications, appName, 'Contents', 'Resources');
      for (const relative of ['codex-cli/CodexCLI.app/Contents/MacOS/codex', 'codex-cli/bin/codex', 'codex']) {
        const executable = path.posix.join(resources, relative);
        const resolved = resolveCodexCli({
          platform: 'darwin', arch: 'arm64', home,
          env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
          fs: { statSync(filePath) {
            if (filePath !== executable) throw new Error('ENOENT');
            return { isFile: () => true };
          } }
        });
        assert.equal(resolved?.command, executable);
        assert.deepEqual(resolved.prefixArgs, []);
        assert.equal(resolved.source, appName === 'ChatGPT.app' ? 'ChatGPT App' : 'Codex App');
      }
    }
  }
});

test('新版内置原生 Codex 优先于 shell 启动器和旧布局，显式路径仍优先', () => {
  const native = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const explicit = '/custom/codex';
  const existing = new Set([native, explicit,
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex']);
  const options = {
    platform: 'darwin', arch: 'arm64', home: '/Users/tester', env: { PATH: '/usr/bin:/bin' },
    fs: { statSync(filePath) {
      if (!existing.has(filePath)) throw new Error('ENOENT');
      return { isFile: () => true };
    } }
  };
  assert.equal(resolveCodexCli(options).command, native);
  assert.equal(resolveCodexCli({ ...options, env: { ...options.env, AGENTDESK_CODEX_CLI: explicit } }).command, explicit);
});

test('CLI 解析选择真实存在的 PATH 程序', () => {
  const root = mkTmp();
  const executable = path.join(root, process.platform === 'win32' ? 'codex.exe' : 'codex');
  fs.writeFileSync(executable, 'placeholder');
  const resolved = resolveCodexCli({
    env: { PATH: root },
    home: path.join(root, 'home'),
    platform: process.platform,
    arch: process.arch
  });
  assert.equal(resolved.path, executable);
  assert.equal(resolved.source, 'PATH');
});

function fakeRpcSpawn(capture, responses = {}) {
  return (command, args, options) => {
    capture.command = command;
    capture.args = args;
    capture.options = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of chunk.toString('utf8').trim().split(/\r?\n/)) {
          if (!line) continue;
          const message = JSON.parse(line);
          capture.messages.push(message);
          if (message.id === 1) {
            setImmediate(() => child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`));
          } else if (message.id === 2) {
            setImmediate(() => child.stdout.write(`${JSON.stringify({
              id: 2,
              result: responses.account || {
                requiresOpenaiAuth: false,
                account: { type: 'chatgpt', email: 'secret@example.com', planType: 'pro' }
              }
            })}\n`));
          } else if (message.id === 3) {
            setImmediate(() => child.stdout.write(`${JSON.stringify({
              id: 3,
              result: responses.rateLimits || {
                rateLimits: {
                  planType: 'pro',
                  primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: 1_800_000_000 }
                }
              }
            })}\n`));
          }
        }
        callback();
      }
    });
    setImmediate(() => child.emit('spawn'));
    return child;
  };
}

test('app-server 握手使用槽位 CODEX_HOME，账号结果会去除邮箱', async () => {
  const capture = { messages: [] };
  const result = await queryCodexAppServer(
    { id: 'p1', sessionRoot: '/profiles/p1/codex-home' },
    {
      launcher: { command: '/bin/codex', prefixArgs: [], extraEnv: {}, source: 'test' },
      spawnImpl: fakeRpcSpawn(capture),
      timeoutMs: 1000,
      clientVersion: '0.2.2'
    }
  );

  assert.equal(capture.options.env.CODEX_HOME, '/profiles/p1/codex-home');
  assert.ok(capture.args.includes('app-server'));
  assert.deepEqual(capture.messages.map((item) => item.method), [
    'initialize',
    'initialized',
    'account/read',
    'account/rateLimits/read'
  ]);
  assert.deepEqual(result.account.account, { type: 'chatgpt', planType: 'pro' });
  assert.equal(JSON.stringify(result).includes('secret@example.com'), false);
});

test('真实 API Key 认证形状不请求订阅额度，不回退成错误或其他会话缓存', async () => {
  const capture = { messages: [] };
  const result = await readCodexQuota({ id: 'api', sessionRoot: '/profiles/api' }, {
    launcher: { command: '/bin/codex' },
    spawnImpl: fakeRpcSpawn(capture, {
      account: { requiresOpenaiAuth: true, account: { type: 'apiKey' } }
    }),
    timeoutMs: 1000
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reasonCode, 'api-key-auth');
  assert.match(result.reason, /API Key/);
  assert.deepEqual(result.windows, []);
  assert.deepEqual(capture.messages.map(item => item.method), ['initialize', 'initialized', 'account/read']);
});

test('account=null 的外部认证仍通过官方额度响应建立可用性', async () => {
  const capture = { messages: [] };
  const result = await readCodexQuota({ id: 'managed', sessionRoot: '/profiles/managed' }, {
    launcher: { command: '/bin/codex' },
    spawnImpl: fakeRpcSpawn(capture, {
      account: { requiresOpenaiAuth: true, account: null }
    }),
    timeoutMs: 1000
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.windows[0].remainingPercent, 73);
  assert.equal(capture.messages.at(-1).method, 'account/rateLimits/read');
});

test('实时结果归一化；未登录和 API Key 账号安全降级', async () => {
  const profile = { id: 'p1', sessionRoot: '/profiles/p1/codex-home' };
  const live = await readCodexQuota(profile, {
    query: async () => ({
      account: { requiresOpenaiAuth: false, account: { type: 'chatgpt', planType: 'plus' } },
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1_900_000_000 }
        }
      }
    })
  });
  assert.equal(live.status, 'ok');
  assert.equal(live.windows[0].label, '每周');
  assert.equal(live.planType, 'plus');

  const managedAuth = await readCodexQuota(profile, {
    query: async () => ({
      account: { requiresOpenaiAuth: true, account: null },
      rateLimits: {
        rateLimits: {
          planType: 'pro',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_900_000_000 }
        }
      }
    })
  });
  assert.equal(managedAuth.status, 'ok');
  assert.equal(managedAuth.windows[0].remainingPercent, 75);

  const signedOut = await readCodexQuota(profile, {
    query: async () => ({ account: { requiresOpenaiAuth: true, account: null }, rateLimits: {} })
  });
  assert.equal(signedOut.status, 'signed_out');

  const apiKey = await readCodexQuota(profile, {
    query: async () => ({ account: { requiresOpenaiAuth: false, account: { type: 'apiKey' } }, rateLimits: {} })
  });
  assert.equal(apiKey.status, 'unsupported');
});

test('本地 rollout 只提取最后一次 rate_limits，并明确标记 stale', () => {
  const root = mkTmp();
  const dir = path.join(root, 'sessions', '2026', '07', '18');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'rollout-test.jsonl');
  fs.writeFileSync(filePath, [
    JSON.stringify({ timestamp: '2026-07-18T10:00:00Z', payload: { type: 'user_message', text: 'private prompt' } }),
    JSON.stringify({ timestamp: '2026-07-18T10:01:00Z', payload: { type: 'token_count', rate_limits: {
      plan_type: 'pro',
      primary: { used_percent: 67, window_minutes: 10080, resets_at: 1_900_000_000 },
      credits: { has_credits: false, unlimited: false, balance: '0' }
    } } })
  ].join('\n'));

  const result = readCachedCodexQuota({ id: 'p1', sessionRoot: root });
  assert.equal(result.status, 'stale');
  assert.equal(result.source, 'codex-session-log');
  assert.equal(result.windows[0].usedPercent, 67);
  assert.deepEqual(result.credits, { hasCredits: false, unlimited: false, balance: '0' });
  assert.equal(JSON.stringify(result).includes('private prompt'), false);
});
