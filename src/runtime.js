/*
 * AgentDesk — local Agent fleet runtime.
 *
 * Adapters, identities, workspaces and running instances are deliberately
 * separate concepts. A desktop account profile may provide an identity home,
 * but an Agent runtime never belongs to the currently selected account. This
 * lets one AgentDesk window supervise several Codex / Claude / Shell instances
 * at the same time.
 *
 * The renderer can select a known adapter and send text, but it can never
 * provide an executable or argv list. Those security-sensitive values are
 * resolved in the main process from the trusted adapter registry.
 *
 * This is intentionally a pipe-based MVP, not a pseudo-terminal emulator.
 * Shell commands run line-by-line and agent adapters use their documented
 * non-interactive streaming modes. A future node-pty adapter can implement the
 * same public service contract without changing the UI.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveCodexCli } = require('./codex-quota');
const { nearestExistingDirectory, safeStat } = require('./path-utils');
const { connectAcpChild } = require('./acp-client');
const {
  ACP_PRESETS,
  cliCandidates,
  normalizeCustomAgentList
} = require('./agent-registry');

const MAX_RUNTIME_SESSIONS = 12;
const MAX_RUNTIME_INPUT_BYTES = 32 * 1024;
const MAX_RUNTIME_OUTPUT_BYTES = 1024 * 1024;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function claudeCliCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const p = platformPath(platform);
  const separator = platform === 'win32' ? ';' : ':';
  const executable = platform === 'win32' ? 'claude.exe' : 'claude';
  const output = [];
  const seen = new Set();

  function add(candidate, source) {
    if (!candidate) return;
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({ path: candidate, source });
  }

  const explicit = env.AGENTDESK_CLAUDE_CLI || env.CLAUDE_CLI_PATH;
  if (explicit) add(p.resolve(explicit), '环境变量');
  for (const dir of String(env.PATH || '').split(separator)) {
    const clean = dir.trim().replace(/^"(.*)"$/, '$1');
    if (clean) add(p.join(clean, executable), 'PATH');
  }

  if (platform === 'win32') {
    add(p.join(home, '.local', 'bin', 'claude.exe'), '用户工具目录');
    add(p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Programs', 'claude', 'claude.exe'), '用户安装目录');
  } else {
    add(p.join(home, '.local', 'bin', 'claude'), '用户工具目录');
    add(p.join(home, '.npm-global', 'bin', 'claude'), 'npm');
    add('/opt/homebrew/bin/claude', 'Homebrew');
    add('/usr/local/bin/claude', '系统工具目录');
  }
  return output;
}

function resolveExecutableCandidates(candidates, options = {}) {
  const fs_ = options.fs || fs;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  for (const candidate of candidates) {
    try {
      if (!fs_.statSync(candidate.path).isFile()) continue;
      let realPath = candidate.path;
      try { realPath = fs_.realpathSync(candidate.path); } catch (_error) { /* use visible path */ }
      if (/\.m?js$/i.test(realPath)) {
        return {
          command: options.nodeExecutable || process.execPath,
          prefixArgs: [realPath],
          extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
          path: candidate.path,
          source: candidate.source
        };
      }
      if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(candidate.path)) {
        return {
          command: env.ComSpec || env.COMSPEC || 'cmd.exe',
          prefixArgs: ['/D', '/S', '/C', candidate.path],
          extraEnv: {},
          path: candidate.path,
          source: candidate.source
        };
      }
      return {
        command: candidate.path,
        prefixArgs: [],
        extraEnv: {},
        path: candidate.path,
        source: candidate.source
      };
    } catch (_error) {
      // Optional CLI candidates are expected to be missing on many machines.
    }
  }
  return null;
}

function resolveClaudeCli(options = {}) {
  return resolveExecutableCandidates(claudeCliCandidates(options), options);
}

function shellLaunchSpec(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fs_ = options.fs || fs;
  if (platform === 'win32') {
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      prefixArgs: ['/Q'],
      extraEnv: {},
      source: 'Windows 命令解释器'
    };
  }

  const candidates = [env.SHELL, platform === 'darwin' ? '/bin/zsh' : null, '/bin/bash', '/bin/sh']
    .filter(Boolean);
  const command = candidates.find((candidate) => {
    try { return fs_.statSync(candidate).isFile(); } catch (_error) { return false; }
  }) || '/bin/sh';
  return {
    command,
    prefixArgs: ['-l'],
    extraEnv: {},
    source: '系统登录 Shell'
  };
}

function resolveRuntimeCwd(profile, sessions, requestedSessionId, options = {}) {
  const stat = options.stat || fs.statSync;
  const pathImpl = options.path || path;
  const home = options.home || os.homedir();
  const records = Array.isArray(sessions) ? sessions : [];
  const selected = requestedSessionId
    ? records.find((item) => item?.id === requestedSessionId)
    : null;
  const roots = [profile?.sessionRoot, profile?.profilePath, home].filter(Boolean);
  const fallback = roots.find((candidate) => safeStat(candidate, { stat })?.isDirectory()) || home;
  const requested = typeof selected?.projectPath === 'string' && selected.projectPath.trim()
    ? selected.projectPath
    : profile?.sessionRoot;
  const resolved = nearestExistingDirectory(requested, fallback, { stat, path: pathImpl });
  return {
    path: resolved.path || fallback,
    source: selected?.projectPath && resolved.exact ? 'session-project' : 'profile-fallback',
    sessionId: selected?.id || null,
    requestedPath: requested || null,
    exact: resolved.exact
  };
}

function publicAdapter(adapter) {
  return {
    id: adapter.id,
    label: adapter.label,
    mode: adapter.mode,
    available: adapter.available,
    detail: adapter.detail,
    caution: adapter.caution || '',
    source: adapter.source || '',
    identityAppId: adapter.identityAppId || null,
    protocol: adapter.transport || adapter.mode,
    custom: Boolean(adapter.custom),
    supportsMultiple: true
  };
}

function parseCodexEvent(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'thread.started' && value.thread_id) {
    return { conversationId: value.thread_id };
  }
  if (value.type === 'item.completed' && value.item) {
    const item = value.item;
    if (item.type === 'agent_message' && item.text) {
      return { stream: 'agent', text: `${item.text}\n` };
    }
    if (item.type === 'command_execution') {
      const command = item.command ? `\n$ ${item.command}\n` : '';
      const output = item.aggregated_output || '';
      const exit = Number.isInteger(item.exit_code) && item.exit_code !== 0
        ? `\n[退出码 ${item.exit_code}]\n`
        : '';
      return command || output || exit
        ? { stream: item.exit_code ? 'stderr' : 'tool', text: `${command}${output}${exit}` }
        : null;
    }
  }
  if (value.type === 'turn.failed' || value.type === 'error') {
    const message = value.error?.message || value.message || 'Codex 运行失败';
    return { stream: 'stderr', text: `${message}\n`, failed: true };
  }
  return null;
}

function parseClaudeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const conversationId = value.session_id || value.sessionId || null;
  if (value.type === 'assistant') {
    const content = Array.isArray(value.message?.content) ? value.message.content : [];
    const text = content
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n');
    if (text) return { conversationId, stream: 'agent', text: `${text}\n` };
  }
  if (value.type === 'result') {
    if (value.is_error || value.subtype === 'error') {
      return {
        conversationId,
        stream: 'stderr',
        text: `${value.result || value.error || 'Claude Code 运行失败'}\n`,
        failed: true
      };
    }
    return { conversationId, completed: true, fallbackText: value.result || '' };
  }
  return conversationId ? { conversationId } : null;
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

class RuntimeService {
  constructor(options = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.resolveCodex = options.resolveCodex || resolveCodexCli;
    this.resolveClaude = options.resolveClaude || resolveClaudeCli;
    this.resolveExecutable = options.resolveExecutable || resolveExecutableCandidates;
    this.shellSpec = options.shellSpec || shellLaunchSpec;
    this.getCustomAgents = options.getCustomAgents || (() => []);
    this.connectAcp = options.connectAcp || connectAcpChild;
    this.loadAcpSdk = options.loadAcpSdk;
    this.requestPermission = options.requestPermission || (async () => ({ outcome: { outcome: 'cancelled' } }));
    this.getClientVersion = options.getClientVersion || (() => '0.0.0');
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.now = options.now || Date.now;
    this.onEvent = options.onEvent || (() => {});
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.sessions = new Map();
  }

  adapters(profile = null) {
    const shell = this.shellSpec({ platform: this.platform, env: this.env });
    const output = [{
      id: 'shell',
      label: this.platform === 'win32' ? '本机终端' : 'Shell',
      mode: 'shell',
      available: true,
      detail: '逐行执行本机命令；适合脚本、Git 与开发工具',
      caution: '命令会直接在本机执行，请只粘贴你理解并信任的内容。',
      source: shell.source,
      identityAppId: null,
      transport: 'shell',
      launcher: shell
    }];

    const codexLauncher = this.resolveCodex();
    output.push({
      id: 'codex',
      label: 'Codex',
      mode: 'agent',
      identityAppId: 'codex',
      transport: 'direct',
      available: Boolean(codexLauncher),
      detail: codexLauncher
        ? (profile?.appId === 'codex'
          ? `使用「${profile.name || 'Codex 槽位'}」的登录身份，可同时开启多个实例`
          : '使用本机 Codex 登录；也可以绑定任意 Codex 身份槽位')
        : '没有找到 Codex CLI',
      caution: 'Agent 在 workspace-write 沙箱内工作；高风险操作不会绕过审批。',
      source: codexLauncher?.source || '',
      launcher: codexLauncher
    });

    const claudeLauncher = this.resolveClaude();
    output.push({
      id: 'claude',
      label: 'Claude Code',
      mode: 'agent',
      identityAppId: 'claude',
      transport: 'direct',
      available: Boolean(claudeLauncher),
      detail: claudeLauncher
        ? (profile?.appId === 'claude'
          ? `绑定「${profile.name || 'Claude 槽位'}」；可同时开启多个实例`
          : '使用本机 Claude Code 登录；也可以绑定 Claude 身份槽位')
        : '没有找到 Claude Code CLI',
      caution: 'Claude Code CLI 与 Claude 桌面 App 的登录态可能彼此独立。',
      source: claudeLauncher?.source || '',
      launcher: claudeLauncher
    });

    for (const preset of ACP_PRESETS) {
      const launcher = this.resolveExecutable(cliCandidates(preset.names, {
        platform: this.platform,
        env: this.env,
        envKeys: preset.envKeys
      }), {
        platform: this.platform,
        env: this.env
      });
      output.push({
        id: preset.id,
        label: preset.label,
        mode: 'agent',
        transport: 'acp',
        identityAppId: null,
        available: Boolean(launcher),
        detail: launcher
          ? `${preset.detail}；支持独立工作区和多个并行实例`
          : `没有找到 ${preset.label} CLI`,
        caution: '通过 Agent Client Protocol 连接；文件修改和命令权限会单独询问。',
        source: launcher?.source || 'ACP 官方注册表',
        launcher: launcher ? {
          ...launcher,
          prefixArgs: [...(launcher.prefixArgs || []), ...preset.args]
        } : null
      });
    }

    for (const definition of normalizeCustomAgentList(this.getCustomAgents())) {
      const launcher = this.resolveExecutable([{ path: definition.executable, source: '用户接入' }], {
        platform: this.platform,
        env: this.env
      });
      output.push({
        id: `custom:${definition.id}`,
        label: definition.name,
        mode: 'agent',
        transport: 'acp',
        identityAppId: null,
        custom: true,
        available: Boolean(launcher),
        detail: launcher ? '用户接入的 ACP Agent' : '自定义 Agent 可执行文件已失效',
        caution: '这是用户自行接入的本机程序；请确认来源可信。',
        source: definition.executable,
        launcher: launcher ? {
          ...launcher,
          prefixArgs: [...(launcher.prefixArgs || []), ...definition.args]
        } : null
      });
    }
    return output;
  }

  listAdapters(profile) {
    return this.adapters(profile).map(publicAdapter);
  }

  start(profile = null, input = {}) {
    if (this.sessions.size >= MAX_RUNTIME_SESSIONS) {
      throw codedError('RUNTIME_LIMIT', `最多同时保留 ${MAX_RUNTIME_SESSIONS} 个 Agent 实例`);
    }
    const adapter = this.adapters(profile).find((item) => item.id === input.adapterId);
    if (!adapter) throw codedError('RUNTIME_ADAPTER_UNKNOWN', '未知的运行适配器');
    if (!adapter.available || !adapter.launcher) {
      throw codedError('RUNTIME_ADAPTER_MISSING', adapter.detail || '运行适配器不可用');
    }

    const identity = adapter.identityAppId && profile?.appId === adapter.identityAppId
      ? profile
      : null;
    const runtime = {
      id: this.randomUUID(),
      profileId: identity?.id || null,
      identity: identity ? {
        id: identity.id,
        name: identity.name || adapter.label,
        appId: identity.appId,
        sessionRoot: identity.sessionRoot
      } : null,
      adapterId: adapter.id,
      adapterLabel: adapter.label,
      mode: adapter.mode,
      transport: adapter.transport || adapter.mode,
      launcher: adapter.launcher,
      cwd: input.cwd,
      workspaceProfileId: input.workspaceProfileId || null,
      workspaceName: input.workspaceName || null,
      workspaceSource: input.workspaceSource || null,
      title: String(input.title || '').trim() || `${adapter.label} · ${path.basename(input.cwd || '') || 'Agent'}`,
      status: adapter.transport === 'acp' || adapter.mode === 'shell' ? 'starting' : 'ready',
      startedAt: this.now(),
      child: null,
      acp: null,
      conversationId: null,
      stdoutBuffer: '',
      stderrBuffer: '',
      emittedBytes: 0,
      outputCapped: false,
      turnAgentMessages: 0
    };
    this.sessions.set(runtime.id, runtime);

    this.emit(runtime, {
      type: 'output',
      stream: 'system',
      text: `${adapter.label} · ${runtime.cwd}\n`
    });
    if (runtime.transport === 'shell') this.startShell(runtime);
    else if (runtime.transport === 'acp') void this.startAcp(runtime);
    else this.emitState(runtime);
    return this.publicRuntime(runtime);
  }

  send(runtimeId, value) {
    const runtime = this.runtime(runtimeId);
    const text = String(value || '').trim();
    if (!text) throw codedError('RUNTIME_INPUT_EMPTY', '请输入内容');
    if (Buffer.byteLength(text, 'utf8') > MAX_RUNTIME_INPUT_BYTES) {
      throw codedError('RUNTIME_INPUT_TOO_LARGE', '单次输入不能超过 32 KB');
    }

    if (runtime.transport === 'shell') {
      if (runtime.status !== 'running' || !runtime.child?.stdin?.writable) {
        throw codedError('RUNTIME_NOT_RUNNING', '终端尚未运行或已经退出');
      }
      const child = runtime.child;
      child.stdin.write(`${text}\n`);
      this.emit(runtime, { type: 'output', stream: 'input', text: `❯ ${text}\n` });
      return this.publicRuntime(runtime);
    }

    if (runtime.status === 'running') {
      throw codedError('RUNTIME_BUSY', 'Agent 正在处理上一条消息');
    }
    if (runtime.status === 'stopped') {
      throw codedError('RUNTIME_STOPPED', '这个运行环境已经停止');
    }
    if (runtime.status !== 'ready') {
      throw codedError('RUNTIME_NOT_READY', 'Agent 尚未准备好，请等待连接完成');
    }
    this.emit(runtime, { type: 'output', stream: 'input', text: `你：${text}\n` });
    if (runtime.transport === 'acp') this.startAcpTurn(runtime, text);
    else this.startAgentTurn(runtime, text);
    return this.publicRuntime(runtime);
  }

  stop(runtimeId) {
    const runtime = this.runtime(runtimeId);
    this.stopRuntime(runtime, 'stopped');
    return this.publicRuntime(runtime);
  }

  stopProfile(profileId) {
    for (const runtime of this.sessions.values()) {
      if (runtime.profileId === profileId) this.stopRuntime(runtime, 'stopped');
    }
  }

  stopAll() {
    for (const runtime of this.sessions.values()) this.stopRuntime(runtime, 'stopped');
  }

  runtime(runtimeId) {
    const runtime = this.sessions.get(String(runtimeId || ''));
    if (!runtime) throw codedError('RUNTIME_NOT_FOUND', '找不到这个 Agent 实例');
    return runtime;
  }

  list() {
    return [...this.sessions.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .map((runtime) => this.publicRuntime(runtime));
  }

  startShell(runtime) {
    const env = this.runtimeEnv(runtime, {
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CLICOLOR: '0'
    });
    let child;
    try {
      child = this.spawnImpl(runtime.launcher.command, runtime.launcher.prefixArgs || [], {
        cwd: runtime.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      this.failStart(runtime, error);
      return;
    }
    runtime.child = child;
    runtime.status = 'running';
    this.bindChild(runtime, child, { structured: false, persistent: true });
    this.emitState(runtime);
  }

  async startAcp(runtime) {
    let child;
    try {
      child = this.spawnImpl(runtime.launcher.command, runtime.launcher.prefixArgs || [], {
        cwd: runtime.cwd,
        env: this.runtimeEnv(runtime),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      this.failStart(runtime, error);
      return;
    }
    runtime.child = child;
    this.bindAcpChild(runtime, child);
    this.emitState(runtime);
    try {
      const acp = await this.connectAcp(child, {
        cwd: runtime.cwd,
        loadSdk: this.loadAcpSdk,
        clientVersion: this.getClientVersion(),
        requestPermission: (params) => this.requestPermission(runtime, params)
      });
      if (runtime.child !== child || !this.sessions.has(runtime.id)) {
        try { acp.close(); } catch (_error) { /* runtime was stopped during handshake */ }
        return;
      }
      runtime.acp = acp;
      runtime.conversationId = acp.session.sessionId;
      runtime.agentInfo = acp.initializeResult?.agentInfo || null;
      runtime.status = 'ready';
      this.emit(runtime, {
        type: 'output',
        stream: 'system',
        text: `[ACP 已连接${runtime.agentInfo?.name ? `：${runtime.agentInfo.name}` : ''}]\n`
      });
      this.emitState(runtime);
    } catch (error) {
      if (runtime.child === child && this.sessions.has(runtime.id)) this.failStart(runtime, error);
    }
  }

  bindAcpChild(runtime, child) {
    child.stderr?.on('data', (chunk) => {
      if (runtime.child !== child) return;
      this.emit(runtime, { type: 'output', stream: 'stderr', text: stripAnsi(chunk) });
    });
    child.once('error', (error) => {
      if (runtime.child === child && this.sessions.has(runtime.id)) this.failStart(runtime, error);
    });
    child.once('close', (code, signal) => {
      if (runtime.child !== child) return;
      runtime.child = null;
      try { runtime.acp?.close(); } catch (_error) { /* connection already closed */ }
      runtime.acp = null;
      if (runtime.status === 'stopped') return;
      runtime.status = code === 0 ? 'exited' : 'error';
      if (code !== 0) {
        this.emit(runtime, {
          type: 'output',
          stream: 'stderr',
          text: `\n[ACP 进程退出：${code ?? signal ?? '未知'}]\n`
        });
      }
      this.emitState(runtime, { exitCode: code, signal });
      this.sessions.delete(runtime.id);
    });
  }

  startAcpTurn(runtime, prompt) {
    if (!runtime.acp) throw codedError('RUNTIME_NOT_READY', 'ACP Agent 尚未连接');
    runtime.status = 'running';
    runtime.turnAgentMessages = 0;
    this.emitState(runtime);
    runtime.acp.prompt(prompt, (event) => this.consumeAcpEvent(runtime, event))
      .then((response) => {
        if (!this.sessions.has(runtime.id) || runtime.status === 'stopped') return;
        if (runtime.turnAgentMessages > 0) {
          this.emit(runtime, { type: 'output', stream: 'agent', text: '\n' });
        }
        if (response?.stopReason && response.stopReason !== 'end_turn') {
          this.emit(runtime, {
            type: 'output',
            stream: 'system',
            text: `[本轮结束：${response.stopReason}]\n`
          });
        }
        runtime.status = 'ready';
        this.emitState(runtime, { stopReason: response?.stopReason || null });
      })
      .catch((error) => {
        if (!this.sessions.has(runtime.id) || runtime.status === 'stopped') return;
        this.emit(runtime, {
          type: 'output',
          stream: 'stderr',
          text: `${error?.message || 'ACP Agent 本轮执行失败'}\n`
        });
        // A failed turn does not necessarily invalidate the ACP process. Keep
        // the instance available so the user can retry or inspect it.
        runtime.status = runtime.child ? 'ready' : 'error';
        this.emitState(runtime, { code: error?.code || 'ACP_TURN_FAILED' });
      });
  }

  consumeAcpEvent(runtime, event) {
    if (!event || !this.sessions.has(runtime.id)) return;
    if (event.type === 'title' && event.title) {
      runtime.title = event.title;
      this.emitState(runtime);
      return;
    }
    if (event.type === 'usage') {
      runtime.usage = event.usage;
      this.emitState(runtime, { usage: event.usage });
      return;
    }
    if (event.stream && event.text) {
      if (event.stream === 'agent') runtime.turnAgentMessages += 1;
      this.emit(runtime, { type: 'output', stream: event.stream, text: event.text });
    }
  }

  startAgentTurn(runtime, prompt) {
    runtime.status = 'running';
    runtime.turnAgentMessages = 0;
    runtime.stdoutBuffer = '';
    runtime.stderrBuffer = '';
    const invocation = runtime.adapterId === 'codex'
      ? this.codexInvocation(runtime)
      : this.claudeInvocation(runtime);
    let child;
    try {
      child = this.spawnImpl(invocation.command, invocation.args, {
        cwd: runtime.cwd,
        env: this.runtimeEnv(runtime, invocation.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      this.failStart(runtime, error);
      return;
    }
    runtime.child = child;
    this.bindChild(runtime, child, { structured: true, persistent: false });
    this.emitState(runtime);
    child.stdin.end(prompt);
  }

  codexInvocation(runtime) {
    const prefix = runtime.launcher.prefixArgs || [];
    if (runtime.conversationId) {
      return {
        command: runtime.launcher.command,
        args: [
          ...prefix,
          'exec', 'resume', '--json', '--skip-git-repo-check',
          runtime.conversationId, '-'
        ],
        env: {
          ...(runtime.launcher.extraEnv || {}),
          ...(runtime.identity?.sessionRoot ? { CODEX_HOME: runtime.identity.sessionRoot } : {})
        }
      };
    }
    return {
      command: runtime.launcher.command,
      args: [
        ...prefix,
        'exec', '--json', '--color', 'never', '--sandbox', 'workspace-write',
        '--skip-git-repo-check', '-C', runtime.cwd, '-'
      ],
      env: {
        ...(runtime.launcher.extraEnv || {}),
        ...(runtime.identity?.sessionRoot ? { CODEX_HOME: runtime.identity.sessionRoot } : {})
      }
    };
  }

  claudeInvocation(runtime) {
    const args = [
      ...(runtime.launcher.prefixArgs || []),
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default'
    ];
    if (runtime.conversationId) args.push('--resume', runtime.conversationId);
    else {
      runtime.conversationId = this.randomUUID();
      args.push('--session-id', runtime.conversationId);
    }
    return {
      command: runtime.launcher.command,
      args,
      env: runtime.launcher.extraEnv || {}
    };
  }

  runtimeEnv(runtime, extra = {}) {
    return {
      ...this.env,
      ...(runtime.launcher.extraEnv || {}),
      ...extra,
      AGENTDESK_RUNTIME: '1'
    };
  }

  bindChild(runtime, child, options) {
    child.stdout?.on('data', (chunk) => {
      if (options.structured) this.consumeStructured(runtime, 'stdout', chunk);
      else this.emit(runtime, { type: 'output', stream: 'stdout', text: stripAnsi(chunk) });
    });
    child.stderr?.on('data', (chunk) => {
      if (options.structured) this.consumeStructured(runtime, 'stderr', chunk);
      else this.emit(runtime, { type: 'output', stream: 'stderr', text: stripAnsi(chunk) });
    });
    child.once('error', (error) => this.failStart(runtime, error));
    child.once('close', (code, signal) => {
      if (runtime.child !== child) return;
      if (options.structured) {
        this.flushStructured(runtime, 'stdout');
        this.flushStructured(runtime, 'stderr');
      }
      runtime.child = null;
      if (runtime.status === 'stopped') return;
      if (options.persistent) runtime.status = code === 0 ? 'exited' : 'error';
      else runtime.status = code === 0 ? 'ready' : 'error';
      if (code !== 0) {
        this.emit(runtime, {
          type: 'output',
          stream: 'stderr',
          text: `\n[进程退出：${code ?? signal ?? '未知'}]\n`
        });
      }
      this.emitState(runtime, { exitCode: code, signal });
      if (options.persistent || code !== 0) this.sessions.delete(runtime.id);
    });
  }

  consumeStructured(runtime, stream, chunk) {
    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    runtime[key] += String(chunk || '');
    const lines = runtime[key].split(/\r?\n/);
    runtime[key] = lines.pop() || '';
    for (const line of lines) this.consumeStructuredLine(runtime, stream, line);
  }

  flushStructured(runtime, stream) {
    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const line = runtime[key];
    runtime[key] = '';
    if (line) this.consumeStructuredLine(runtime, stream, line);
  }

  consumeStructuredLine(runtime, stream, line) {
    if (!line.trim()) return;
    if (stream === 'stderr') {
      this.emit(runtime, { type: 'output', stream: 'stderr', text: `${stripAnsi(line)}\n` });
      return;
    }
    let value;
    try { value = JSON.parse(line); } catch (_error) {
      this.emit(runtime, { type: 'output', stream: 'stdout', text: `${stripAnsi(line)}\n` });
      return;
    }
    const parsed = runtime.adapterId === 'codex'
      ? parseCodexEvent(value)
      : parseClaudeEvent(value);
    if (!parsed) return;
    if (parsed.conversationId) runtime.conversationId = parsed.conversationId;
    if (parsed.stream && parsed.text) {
      if (parsed.stream === 'agent') runtime.turnAgentMessages += 1;
      this.emit(runtime, { type: 'output', stream: parsed.stream, text: parsed.text });
    }
    if (parsed.completed && parsed.fallbackText && runtime.turnAgentMessages === 0) {
      this.emit(runtime, { type: 'output', stream: 'agent', text: `${parsed.fallbackText}\n` });
      runtime.turnAgentMessages += 1;
    }
  }

  failStart(runtime, error) {
    const child = runtime.child;
    runtime.child = null;
    try { runtime.acp?.close(); } catch (_error) { /* connection may be half-open */ }
    runtime.acp = null;
    try { child?.stdin?.end(); } catch (_error) { /* already closed */ }
    try { child?.kill(); } catch (_error) { /* already exited */ }
    runtime.status = 'error';
    this.emit(runtime, {
      type: 'output',
      stream: 'stderr',
      text: `${error?.message || '无法启动运行环境'}\n`
    });
    this.emitState(runtime, { code: error?.code || 'RUNTIME_START_FAILED' });
    this.sessions.delete(runtime.id);
  }

  stopRuntime(runtime, status) {
    runtime.status = status;
    const child = runtime.child;
    runtime.child = null;
    if (runtime.acp) {
      try {
        Promise.resolve(runtime.acp.cancel()).catch(() => {});
      } catch (_error) { /* Agent may already have closed synchronously */ }
      try { runtime.acp.close(); } catch (_error) { /* connection already closed */ }
      runtime.acp = null;
    }
    if (child) {
      try { child.stdin?.end(); } catch (_error) { /* already closed */ }
      try { child.kill(); } catch (_error) { /* already exited */ }
    }
    this.emit(runtime, { type: 'output', stream: 'system', text: '\n[已停止]\n' });
    this.emitState(runtime);
    this.sessions.delete(runtime.id);
  }

  emitState(runtime, extra = {}) {
    this.emit(runtime, { type: 'state', status: runtime.status, ...extra });
  }

  emit(runtime, event) {
    const payload = {
      runtimeId: runtime.id,
      profileId: runtime.profileId,
      title: runtime.title,
      identityName: runtime.identity?.name || null,
      adapterId: runtime.adapterId,
      at: this.now(),
      ...event
    };
    if (payload.type === 'output') {
      let text = String(payload.text || '');
      const remaining = MAX_RUNTIME_OUTPUT_BYTES - runtime.emittedBytes;
      if (remaining <= 0) {
        this.stopForOutputLimit(runtime, payload);
        return;
      }
      const bytes = Buffer.from(text, 'utf8');
      const exceeded = bytes.length > remaining;
      if (exceeded) text = bytes.subarray(0, remaining).toString('utf8');
      runtime.emittedBytes += Buffer.byteLength(text, 'utf8');
      payload.text = text;
      if (exceeded) {
        if (text) this.onEvent(payload);
        this.stopForOutputLimit(runtime, payload);
        return;
      }
    }
    this.onEvent(payload);
  }

  stopForOutputLimit(runtime, payload) {
    if (runtime.outputCapped) return;
    runtime.outputCapped = true;
    this.onEvent({
      ...payload,
      type: 'output',
      stream: 'stderr',
      text: '\n[输出超过 1 MB，进程已停止。]\n'
    });
    const child = runtime.child;
    runtime.child = null;
    runtime.status = 'error';
    if (runtime.acp) {
      try { runtime.acp.close(); } catch (_error) { /* connection already closed */ }
      runtime.acp = null;
    }
    try { child?.stdin?.end(); } catch (_error) { /* already closed */ }
    try { child?.kill(); } catch (_error) { /* already exited */ }
    this.sessions.delete(runtime.id);
    this.onEvent({
      runtimeId: runtime.id,
      profileId: runtime.profileId,
      title: runtime.title,
      identityName: runtime.identity?.name || null,
      adapterId: runtime.adapterId,
      at: this.now(),
      type: 'state',
      status: 'error',
      code: 'RUNTIME_OUTPUT_LIMIT'
    });
  }

  publicRuntime(runtime) {
    return {
      ok: true,
      id: runtime.id,
      profileId: runtime.profileId,
      identityName: runtime.identity?.name || null,
      adapterId: runtime.adapterId,
      adapterLabel: runtime.adapterLabel,
      mode: runtime.mode,
      protocol: runtime.transport,
      title: runtime.title,
      cwd: runtime.cwd,
      workspaceProfileId: runtime.workspaceProfileId,
      workspaceName: runtime.workspaceName,
      workspaceSource: runtime.workspaceSource,
      status: runtime.status,
      conversationId: runtime.conversationId,
      agentInfo: runtime.agentInfo || null,
      startedAt: runtime.startedAt
    };
  }
}

module.exports = {
  MAX_RUNTIME_SESSIONS,
  MAX_RUNTIME_INPUT_BYTES,
  MAX_RUNTIME_OUTPUT_BYTES,
  claudeCliCandidates,
  resolveExecutableCandidates,
  resolveClaudeCli,
  shellLaunchSpec,
  resolveRuntimeCwd,
  parseCodexEvent,
  parseClaudeEvent,
  stripAnsi,
  RuntimeService
};
