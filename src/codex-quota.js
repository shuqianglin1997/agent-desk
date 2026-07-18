/*
 * AgentDesk — read ChatGPT/Codex rate limits through the official Codex
 * app-server protocol. Every request runs with the profile's own CODEX_HOME,
 * so independent AgentDesk slots never borrow another slot's account.
 *
 * This module never reads auth.json and never returns account e-mail or raw
 * provider payloads. Local rollout logs are only a marked-stale fallback.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeCodexRateLimits, quotaUnavailable } = require('./quota');

const RPC_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BUFFER = 1024 * 1024;
const LOG_TAIL_BYTES = 512 * 1024;
const LOG_WALK_LIMIT = 12_000;
const LOG_FILE_LIMIT = 12;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function targetTriple(platform = process.platform, arch = process.arch) {
  const arches = { x64: 'x86_64', arm64: 'aarch64' };
  const systems = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-musl',
    win32: 'pc-windows-msvc'
  };
  return arches[arch] && systems[platform] ? `${arches[arch]}-${systems[platform]}` : null;
}

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function codexCliCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const p = platformPath(platform);
  const pathSeparator = platform === 'win32' ? ';' : ':';
  const executableName = platform === 'win32' ? 'codex.exe' : 'codex';
  const triple = targetTriple(platform, arch);
  const packageSuffix = `${platform}-${arch}`;
  const results = [];
  const packageRoots = [];
  const seen = new Set();

  function add(filePath, source) {
    if (!filePath) return;
    const key = platform === 'win32' ? filePath.toLowerCase() : filePath;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ path: filePath, source });
  }

  function addPackageRoot(root, source) {
    if (!root || packageRoots.some((item) => item.root === root)) return;
    packageRoots.push({ root, source });
  }

  const explicit = env.AGENTDESK_CODEX_CLI || env.CODEX_CLI_PATH;
  if (explicit) add(p.resolve(explicit), '环境变量');

  const pathDirs = String(env.PATH || '')
    .split(pathSeparator)
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  for (const dir of pathDirs) {
    if (platform === 'win32') {
      add(p.join(dir, 'codex.exe'), 'PATH');
      add(p.join(dir, 'codex.cmd'), 'PATH');
      addPackageRoot(p.join(dir, 'node_modules', '@openai', 'codex'), 'npm');
    } else {
      add(p.join(dir, 'codex'), 'PATH');
      addPackageRoot(p.join(p.dirname(dir), 'lib', 'node_modules', '@openai', 'codex'), 'npm');
    }
  }

  if (platform === 'win32') {
    const appData = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    add(p.join(localAppData, 'Microsoft', 'WindowsApps', 'codex.exe'), 'Windows 应用别名');
    add(p.join(home, '.local', 'bin', 'codex.exe'), '用户工具目录');
    addPackageRoot(p.join(appData, 'npm', 'node_modules', '@openai', 'codex'), 'npm');
    addPackageRoot(p.join(localAppData, 'npm', 'node_modules', '@openai', 'codex'), 'npm');
  } else {
    add(p.join(home, '.local', 'bin', 'codex'), '用户工具目录');
    add(p.join(home, '.npm-global', 'bin', 'codex'), 'npm');
    add('/opt/homebrew/bin/codex', 'Homebrew');
    add('/usr/local/bin/codex', '系统工具目录');
    add('/Applications/Codex.app/Contents/Resources/codex', 'Codex App');
    add(p.join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'), 'Codex App');
    for (const prefix of [p.join(home, '.npm-global'), '/opt/homebrew', '/usr/local']) {
      addPackageRoot(p.join(prefix, 'lib', 'node_modules', '@openai', 'codex'), 'npm');
    }
  }

  if (triple) {
    // Native binaries avoid Windows .cmd shims and Finder's reduced PATH.
    // Put them ahead of wrappers while preserving an explicit native override.
    const native = [];
    for (const item of packageRoots) {
      for (const vendorRoot of [
        p.join(item.root, 'node_modules', '@openai', `codex-${packageSuffix}`, 'vendor'),
        p.join(item.root, 'vendor')
      ]) {
        native.push({
          path: p.join(vendorRoot, triple, 'codex', executableName),
          source: `${item.source} 原生程序`
        });
      }
    }
    const explicitCount = explicit ? 1 : 0;
    results.splice(explicitCount, 0, ...native.filter((item) => {
      const key = platform === 'win32' ? item.path.toLowerCase() : item.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }

  return results;
}

function resolveCodexCli(options = {}) {
  const fs_ = options.fs || fs;
  const candidates = codexCliCandidates(options);
  for (const candidate of candidates) {
    try {
      if (!fs_.statSync(candidate.path).isFile()) continue;
      if (/\.cmd$/i.test(candidate.path)) continue;
      let realPath = candidate.path;
      try { realPath = fs_.realpathSync(candidate.path); } catch (_error) { /* use original */ }
      if (/\.m?js$/i.test(realPath)) {
        return {
          command: options.nodeExecutable || process.execPath,
          prefixArgs: [realPath],
          extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
          source: candidate.source,
          path: candidate.path,
          candidates
        };
      }
      return {
        command: candidate.path,
        prefixArgs: [],
        extraEnv: {},
        source: candidate.source,
        path: candidate.path,
        candidates
      };
    } catch (_error) {
      // Missing/inaccessible candidates are normal; continue discovery.
    }
  }
  return null;
}

function queryCodexAppServer(profile, options = {}) {
  const launcher = options.launcher || resolveCodexCli(options);
  if (!launcher) throw codedError('CODEX_CLI_NOT_FOUND', 'Codex CLI not found');

  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = options.timeoutMs || RPC_TIMEOUT_MS;
  const args = [
    ...(launcher.prefixArgs || []),
    '-c',
    'model_reasoning_effort="high"',
    'app-server',
    '--listen',
    'stdio://'
  ];
  const env = {
    ...process.env,
    ...(options.env || {}),
    ...(launcher.extraEnv || {}),
    CODEX_HOME: profile.sessionRoot
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(launcher.command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (_error) {
      reject(codedError('CODEX_START_FAILED', 'Unable to start Codex app-server'));
      return;
    }

    let settled = false;
    let initialized = false;
    let accountReceived = false;
    let rateLimitsReceived = false;
    let accountResult = null;
    let rateLimitsResult = null;
    let stdoutBuffer = '';

    const timer = setTimeout(() => {
      finish(reject, codedError('CODEX_RPC_TIMEOUT', 'Codex app-server timed out'));
    }, timeoutMs);
    timer.unref?.();

    function stopChild() {
      try { child.stdin.end(); } catch (_error) { /* already closed */ }
      const killTimer = setTimeout(() => {
        try { child.kill(); } catch (_error) { /* already exited */ }
      }, 250);
      killTimer.unref?.();
    }

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopChild();
      callback(value);
    }

    function send(message) {
      if (settled) return;
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (_error) {
        finish(reject, codedError('CODEX_RPC_WRITE_FAILED', 'Codex app-server pipe closed'));
      }
    }

    function requestData() {
      if (initialized || settled) return;
      initialized = true;
      send({ method: 'initialized' });
      send({ id: 2, method: 'account/read', params: { refreshToken: false } });
      send({ id: 3, method: 'account/rateLimits/read', params: null });
    }

    function handleMessage(message) {
      if (!message || typeof message !== 'object') return;
      if (message.id === 1) {
        if (message.error) {
          finish(reject, codedError('CODEX_RPC_UNSUPPORTED', 'Codex app-server initialization failed'));
          return;
        }
        requestData();
        return;
      }
      if (message.id === 2) {
        if (message.error) {
          finish(reject, codedError('CODEX_ACCOUNT_READ_FAILED', 'Codex account read failed'));
          return;
        }
        accountReceived = true;
        const result = message.result || {};
        const account = result.account && typeof result.account === 'object' ? result.account : null;
        // Intentionally omit account.email.
        accountResult = {
          requiresOpenaiAuth: result.requiresOpenaiAuth === true,
          account: account ? {
            type: account.type || null,
            planType: account.planType || null
          } : null
        };
      }
      if (message.id === 3) {
        if (message.error) {
          finish(reject, codedError('CODEX_RATE_LIMITS_FAILED', 'Codex rate limits read failed'));
          return;
        }
        rateLimitsReceived = true;
        rateLimitsResult = message.result || {};
      }
      if (accountReceived && rateLimitsReceived) {
        finish(resolve, { account: accountResult, rateLimits: rateLimitsResult });
      }
    }

    child.once('error', () => {
      finish(reject, codedError('CODEX_START_FAILED', 'Unable to start Codex app-server'));
    });
    child.once('exit', () => {
      if (!settled) finish(reject, codedError('CODEX_RPC_EXITED', 'Codex app-server exited early'));
    });
    child.stdin?.on?.('error', () => {
      if (!settled) finish(reject, codedError('CODEX_RPC_WRITE_FAILED', 'Codex app-server pipe closed'));
    });
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      stdoutBuffer += chunk.toString('utf8');
      if (stdoutBuffer.length > MAX_STDOUT_BUFFER) {
        finish(reject, codedError('CODEX_RPC_OVERSIZE', 'Codex app-server response too large'));
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleMessage(JSON.parse(line)); } catch (_error) { /* ignore non-protocol logs */ }
      }
    });
    // Consume stderr so a verbose CLI cannot block on a full pipe. Never copy
    // its contents into the renderer or logs because it may contain local paths.
    child.stderr.on('data', () => {});
    child.once('spawn', () => {
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'agentdesk',
            title: 'AgentDesk',
            version: options.clientVersion || '0.0.0'
          },
          capabilities: { optOutNotificationMethods: [] }
        }
      });
    });
  });
}

async function readCodexQuota(profile, options = {}) {
  const result = await (options.query || queryCodexAppServer)(profile, options);
  const account = result.account || {};
  const snapshot = normalizeCodexRateLimits(result.rateLimits, {
    profileId: profile.id,
    source: 'codex-app-server',
    observedAt: Date.now()
  });
  // Some managed/external-auth Codex builds return account=null from
  // account/read while the official rate-limit endpoint still succeeds. A
  // concrete quota response is stronger evidence than that optional account
  // metadata; only classify auth mode when no quota was returned.
  if (snapshot.windows.length || snapshot.rateLimitReachedType) {
    if (!snapshot.planType && account.account?.planType) snapshot.planType = account.account.planType;
    return snapshot;
  }
  if (account.requiresOpenaiAuth || !account.account) {
    return quotaUnavailable(profile.id, 'codex', 'signed_out', 'Codex 账号尚未登录或尚未返回额度');
  }
  if (account.account.type !== 'chatgpt') {
    return quotaUnavailable(
      profile.id,
      'codex',
      'unsupported',
      '当前 Codex 使用 API Key 或外部凭据，不适用 ChatGPT 订阅额度'
    );
  }
  return {
    ...quotaUnavailable(profile.id, 'codex', 'unsupported', '当前账号没有返回可展示的订阅额度'),
    planType: snapshot.planType || account.account.planType || null
  };
}

function readFileTail(filePath, maxBytes = LOG_TAIL_BYTES) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(maxBytes, size);
    const buffer = Buffer.alloc(length);
    if (length) fs.readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch (_error) {
    return '';
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_error) { /* already closed */ }
    }
  }
}

function newestCodexRollouts(sessionRoot, options = {}) {
  const roots = [
    path.join(sessionRoot, 'sessions'),
    path.join(sessionRoot, 'archived_sessions')
  ];
  const output = [];
  let scanned = 0;
  for (const root of roots) {
    const pending = [root];
    while (pending.length && scanned < (options.walkLimit || LOG_WALK_LIMIT)) {
      const current = pending.pop();
      let entries = [];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_error) { continue; }
      for (const entry of entries) {
        scanned += 1;
        const filePath = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(filePath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try { output.push({ filePath, mtime: fs.statSync(filePath).mtimeMs }); } catch (_error) { /* moved */ }
        }
        if (scanned >= (options.walkLimit || LOG_WALK_LIMIT)) break;
      }
    }
  }
  return output
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, options.fileLimit || LOG_FILE_LIMIT)
    .map((item) => item.filePath);
}

function rateLimitsFromRollout(filePath) {
  const lines = readFileTail(filePath).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      const payload = value && value.payload;
      const rateLimits = payload && (payload.rate_limits || payload.rateLimits);
      if (payload?.type === 'token_count' && rateLimits && typeof rateLimits === 'object') {
        return { rateLimits, observedAt: value.timestamp || value.ts || null };
      }
    } catch (_error) {
      // The first/last line can be partial because only the file tail is read.
    }
  }
  return null;
}

function readCachedCodexQuota(profile) {
  if (!profile?.sessionRoot) return null;
  for (const filePath of newestCodexRollouts(profile.sessionRoot)) {
    const found = rateLimitsFromRollout(filePath);
    if (!found) continue;
    return {
      ...normalizeCodexRateLimits(found.rateLimits, {
        profileId: profile.id,
        status: 'stale',
        source: 'codex-session-log',
        observedAt: found.observedAt || Date.now()
      }),
      reason: '实时额度暂不可用，显示最近一次本地会话缓存；缓存不会改变猫咪疲劳状态'
    };
  }
  return null;
}

module.exports = {
  RPC_TIMEOUT_MS,
  targetTriple,
  codexCliCandidates,
  resolveCodexCli,
  queryCodexAppServer,
  readCodexQuota,
  readFileTail,
  newestCodexRollouts,
  rateLimitsFromRollout,
  readCachedCodexQuota
};
