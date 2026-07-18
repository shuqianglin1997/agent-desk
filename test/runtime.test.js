const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const {
  claudeCliCandidates,
  MAX_RUNTIME_OUTPUT_BYTES,
  parseCodexEvent,
  parseClaudeEvent,
  resolveRuntimeCwd,
  RuntimeService
} = require('../src/runtime');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writable: true,
    writes: [],
    write(value) { this.writes.push(value); },
    end(value) { if (value) this.writes.push(value); this.writable = false; }
  };
  child.kill = () => { child.killed = true; };
  return child;
}

test('Claude CLI 候选覆盖 PATH 和用户安装目录且去重', () => {
  const candidates = claudeCliCandidates({
    platform: 'win32',
    home: 'C:\\Users\\alice',
    env: {
      PATH: 'C:\\Tools;C:\\Tools',
      LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local'
    }
  });
  assert.equal(candidates.filter((item) => item.path === 'C:\\Tools\\claude.exe').length, 1);
  assert.ok(candidates.some((item) => item.path.endsWith('Programs\\claude\\claude.exe')));
});

test('Codex 与 Claude 流事件只提取可展示内容和会话标识', () => {
  assert.deepEqual(parseCodexEvent({ type: 'thread.started', thread_id: 'thread-1' }), {
    conversationId: 'thread-1'
  });
  assert.deepEqual(parseCodexEvent({
    type: 'item.completed',
    item: { type: 'agent_message', text: '完成了' }
  }), { stream: 'agent', text: '完成了\n' });
  assert.deepEqual(parseClaudeEvent({
    type: 'assistant',
    session_id: 'session-1',
    message: { content: [{ type: 'text', text: '我来看看' }] }
  }), { conversationId: 'session-1', stream: 'agent', text: '我来看看\n' });
});

test('渲染层只能选择内置适配器，Codex 使用槽位 CODEX_HOME 和受限沙箱', () => {
  const calls = [];
  const events = [];
  const children = [];
  const service = new RuntimeService({
    platform: 'darwin',
    env: { PATH: '/usr/bin' },
    randomUUID: (() => {
      let index = 0;
      return () => `runtime-${++index}`;
    })(),
    resolveCodex: () => ({
      command: '/tools/codex',
      prefixArgs: [],
      extraEnv: {},
      source: '测试'
    }),
    resolveClaude: () => null,
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: (command, args, options) => {
      const child = fakeChild();
      children.push(child);
      calls.push({ command, args, options });
      return child;
    },
    onEvent: (event) => events.push(event)
  });
  const profile = { id: 'p1', appId: 'codex', sessionRoot: '/profiles/p1/codex-home' };

  assert.throws(() => service.start(profile, {
    adapterId: '/tmp/evil',
    cwd: '/workspace'
  }), /未知的运行适配器/);

  const runtime = service.start(profile, { adapterId: 'codex', cwd: '/workspace' });
  service.send(runtime.id, '检查项目');
  assert.equal(calls[0].command, '/tools/codex');
  assert.deepEqual(calls[0].args, [
    'exec', '--json', '--color', 'never', '--sandbox', 'workspace-write',
    '--skip-git-repo-check', '-C', '/workspace', '-'
  ]);
  assert.equal(calls[0].options.env.CODEX_HOME, '/profiles/p1/codex-home');
  assert.equal(children[0].stdin.writes[0], '检查项目');
  assert.equal(calls[0].args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.ok(events.some((event) => event.stream === 'input'));
});

test('运行实例不再归属当前账号，可跨身份同时管理多个 Agent', () => {
  const children = [fakeChild(), fakeChild()];
  const service = new RuntimeService({
    platform: 'linux',
    randomUUID: (() => {
      let index = 0;
      return () => `runtime-${++index}`;
    })(),
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: () => children.shift()
  });
  const owner = { id: 'p1', appId: 'cursor', sessionRoot: '/profiles/p1' };
  const other = { id: 'p2', appId: 'cursor', sessionRoot: '/profiles/p2' };
  const first = service.start(owner, { adapterId: 'shell', cwd: '/workspace/one' });
  const second = service.start(other, { adapterId: 'shell', cwd: '/workspace/two' });

  assert.equal(service.list().length, 2);
  assert.doesNotThrow(() => service.send(first.id, 'whoami'));
  assert.doesNotThrow(() => service.stop(second.id));
  assert.deepEqual(service.list().map((item) => item.id), [first.id]);
});

test('所有内置 Agent 都能在没有客户端槽位时被发现', () => {
  const service = new RuntimeService({
    platform: 'darwin',
    resolveCodex: () => ({ command: '/tools/codex', prefixArgs: [], extraEnv: {}, source: '测试' }),
    resolveClaude: () => ({ command: '/tools/claude', prefixArgs: [], extraEnv: {}, source: '测试' }),
    shellSpec: () => ({ command: '/bin/zsh', prefixArgs: [], extraEnv: {}, source: '测试' })
  });
  const adapters = service.listAdapters(null);

  assert.deepEqual(adapters.slice(0, 3).map((item) => item.id), ['shell', 'codex', 'claude']);
  assert.ok(adapters.some((item) => item.id === 'opencode' && item.protocol === 'acp'));
  assert.ok(adapters.every((item) => item.supportsMultiple));
});

test('ACP Agent 使用长驻连接、多实例会话和流式事件', async () => {
  const child = fakeChild();
  const events = [];
  let closed = false;
  const service = new RuntimeService({
    platform: 'linux',
    randomUUID: () => 'runtime-acp',
    resolveCodex: () => null,
    resolveClaude: () => null,
    resolveExecutable: (candidates) => (
      candidates.some((item) => item.path.endsWith('/opencode'))
        ? { command: '/tools/opencode', prefixArgs: [], extraEnv: {}, source: '测试' }
        : null
    ),
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: () => child,
    connectAcp: async () => ({
      session: { sessionId: 'acp-session-1' },
      initializeResult: { agentInfo: { name: 'OpenCode Test' } },
      prompt: async (_text, onUpdate) => {
        onUpdate({ stream: 'agent', text: '已处理' });
        return { stopReason: 'end_turn' };
      },
      cancel: async () => {},
      close: () => { closed = true; }
    }),
    onEvent: (event) => events.push(event)
  });

  const runtime = service.start(null, { adapterId: 'opencode', cwd: '/workspace' });
  assert.equal(runtime.status, 'starting');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.list()[0].status, 'ready');
  assert.equal(service.list()[0].conversationId, 'acp-session-1');

  service.send(runtime.id, '检查项目');
  assert.equal(service.list()[0].status, 'running');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.list()[0].status, 'ready');
  assert.ok(events.some((event) => event.stream === 'agent' && event.text === '已处理'));

  service.stop(runtime.id);
  assert.equal(closed, true);
  assert.equal(child.killed, true);
});

test('ACP 握手完成前拒绝输入，避免消息丢进未建立的会话', () => {
  const child = fakeChild();
  const service = new RuntimeService({
    platform: 'linux',
    randomUUID: () => 'runtime-starting',
    resolveCodex: () => null,
    resolveClaude: () => null,
    resolveExecutable: (candidates) => (
      candidates.some((item) => item.path.endsWith('/opencode'))
        ? { command: '/tools/opencode', prefixArgs: [], extraEnv: {}, source: '测试' }
        : null
    ),
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: () => child,
    connectAcp: () => new Promise(() => {})
  });

  const runtime = service.start(null, { adapterId: 'opencode', cwd: '/workspace' });
  assert.throws(
    () => service.send(runtime.id, '不能提前发送'),
    (error) => error.code === 'RUNTIME_NOT_READY'
  );
  service.stop(runtime.id);
});

test('工作目录只能由已索引会话选择，失效项目会回退到账号会话目录', () => {
  const directories = new Set(['/profiles/p1', '/workspace/known']);
  const stat = (candidate) => {
    if (!directories.has(candidate)) throw new Error('missing');
    return { isDirectory: () => true, isFile: () => false };
  };
  const profile = { id: 'p1', profilePath: '/profiles/p1', sessionRoot: '/profiles/p1' };
  const sessions = [
    { id: 'known', projectPath: '/workspace/known' },
    { id: 'stale', projectPath: '/workspace/gone' }
  ];

  assert.deepEqual(resolveRuntimeCwd(profile, sessions, 'known', { stat, home: '/home/test' }), {
    path: '/workspace/known',
    source: 'session-project',
    sessionId: 'known',
    requestedPath: '/workspace/known',
    exact: true
  });
  assert.equal(resolveRuntimeCwd(profile, sessions, 'stale', { stat, home: '/home/test' }).path, '/profiles/p1');
  assert.equal(resolveRuntimeCwd(profile, sessions, '../../not-indexed', { stat, home: '/home/test' }).path, '/profiles/p1');
});

test('Shell 输入先写入子进程，再广播 UI 回显，事件重入停止也不会空指针', () => {
  const child = fakeChild();
  let runtime;
  const profile = { id: 'p1', appId: 'cursor', sessionRoot: '/profiles/p1' };
  let service;
  service = new RuntimeService({
    platform: 'linux',
    randomUUID: () => 'runtime-reentrant',
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: () => child,
    onEvent: (event) => {
      if (event.stream === 'input') service.stop(runtime.id);
    }
  });
  runtime = service.start(profile, { adapterId: 'shell', cwd: '/workspace' });

  assert.doesNotThrow(() => service.send(runtime.id, 'echo ok'));
  assert.equal(child.stdin.writes[0], 'echo ok\n');
});

test('输出超过上限会停止子进程，避免隐藏输出后继续无限占用 CPU', () => {
  const child = fakeChild();
  const events = [];
  const service = new RuntimeService({
    platform: 'linux',
    randomUUID: () => 'runtime-output-limit',
    shellSpec: () => ({ command: '/bin/sh', prefixArgs: [], extraEnv: {}, source: '测试' }),
    spawnImpl: () => child,
    onEvent: (event) => events.push(event)
  });
  const profile = { id: 'p1', appId: 'cursor', sessionRoot: '/profiles/p1' };
  service.start(profile, { adapterId: 'shell', cwd: '/workspace' });
  child.stdout.emit('data', 'x'.repeat(MAX_RUNTIME_OUTPUT_BYTES + 100));

  assert.equal(child.killed, true);
  assert.ok(events.some((event) => event.code === 'RUNTIME_OUTPUT_LIMIT' && event.status === 'error'));
  assert.ok(events.some((event) => event.text?.includes('进程已停止')));
});
