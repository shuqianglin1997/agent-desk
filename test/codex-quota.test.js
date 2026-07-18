// AgentDesk — Codex 官方额度协议与本地缓存降级单测。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

const {
  targetTriple,
  codexCliCandidates,
  resolveCodexCli,
  queryCodexAppServer,
  readCodexQuota,
  readCachedCodexQuota
} = require('../src/codex-quota');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-quota-'));
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

function fakeRpcSpawn(capture) {
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
              result: {
                requiresOpenaiAuth: false,
                account: { type: 'chatgpt', email: 'secret@example.com', planType: 'pro' }
              }
            })}\n`));
          } else if (message.id === 3) {
            setImmediate(() => child.stdout.write(`${JSON.stringify({
              id: 3,
              result: {
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
