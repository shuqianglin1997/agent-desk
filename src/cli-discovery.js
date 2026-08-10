/*
 * AgentDesk — read-only CLI discovery for the local tool maintenance bay.
 *
 * This module only resolves known executables. It never supplies agent-mode
 * arguments, starts a process, creates a session, or stores custom commands.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCodexCli } = require('./codex-quota');

const CLI_DEFINITIONS = Object.freeze({
  claude: Object.freeze({
    names: Object.freeze(['claude']),
    envKeys: Object.freeze(['AGENTDESK_CLAUDE_CLI', 'CLAUDE_CLI_PATH'])
  }),
  gemini: Object.freeze({
    names: Object.freeze(['gemini']),
    envKeys: Object.freeze(['AGENTDESK_GEMINI_CLI', 'GEMINI_CLI_PATH'])
  }),
  opencode: Object.freeze({
    names: Object.freeze(['opencode']),
    envKeys: Object.freeze(['AGENTDESK_OPENCODE_CLI', 'OPENCODE_CLI_PATH'])
  }),
  'cursor-agent': Object.freeze({
    names: Object.freeze(['cursor-agent']),
    envKeys: Object.freeze(['AGENTDESK_CURSOR_AGENT_CLI', 'CURSOR_AGENT_CLI_PATH'])
  }),
  'github-copilot': Object.freeze({
    names: Object.freeze(['copilot']),
    envKeys: Object.freeze(['AGENTDESK_COPILOT_CLI', 'COPILOT_CLI_PATH'])
  }),
  goose: Object.freeze({
    names: Object.freeze(['goose']),
    envKeys: Object.freeze(['AGENTDESK_GOOSE_CLI', 'GOOSE_CLI_PATH'])
  }),
  kimi: Object.freeze({
    names: Object.freeze(['kimi']),
    envKeys: Object.freeze(['AGENTDESK_KIMI_CLI', 'KIMI_CLI_PATH'])
  }),
  'qwen-code': Object.freeze({
    names: Object.freeze(['qwen', 'qwen-code']),
    envKeys: Object.freeze(['AGENTDESK_QWEN_CLI', 'QWEN_CLI_PATH'])
  })
});

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function executableVariants(name, platform) {
  if (platform !== 'win32' || /\.(?:exe|cmd|bat)$/i.test(name)) return [name];
  return [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name];
}

function cliCandidates(names, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const p = platformPath(platform);
  const separator = platform === 'win32' ? ';' : ':';
  const output = [];
  const seen = new Set();

  function add(candidate, source) {
    if (!candidate) return;
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({ path: candidate, source });
  }

  for (const key of options.envKeys || []) {
    if (env[key]) add(p.resolve(String(env[key])), `环境变量 ${key}`);
  }

  const variants = (Array.isArray(names) ? names : [names])
    .filter(Boolean)
    .flatMap((name) => executableVariants(String(name), platform));
  const pathDirectories = String(env.PATH || '')
    .split(separator)
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const commonDirectories = platform === 'win32'
    ? [
        p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'npm'),
        p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Microsoft', 'WindowsApps'),
        p.join(home, '.local', 'bin')
      ]
    : [
        p.join(home, '.local', 'bin'),
        p.join(home, '.npm-global', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin'
      ];

  for (const directory of [...pathDirectories, ...commonDirectories]) {
    for (const executable of variants) {
      add(p.join(directory, executable), pathDirectories.includes(directory) ? 'PATH' : '用户工具目录');
    }
  }
  return output;
}

function resolveExecutableCandidates(candidates, options = {}) {
  const fs_ = options.fs || fs;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  for (const candidate of candidates || []) {
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

function discoverCli(toolId, options = {}) {
  const id = String(toolId || '');
  if (id === 'codex') return resolveCodexCli(options);
  const definition = CLI_DEFINITIONS[id];
  if (!definition) return null;
  return resolveExecutableCandidates(cliCandidates(definition.names, {
    ...options,
    envKeys: definition.envKeys
  }), options);
}

function discoverCliInventory(toolIds, options = {}) {
  return new Map((toolIds || []).map((toolId) => [toolId, discoverCli(toolId, options)]));
}

module.exports = {
  CLI_DEFINITIONS,
  cliCandidates,
  resolveExecutableCandidates,
  discoverCli,
  discoverCliInventory
};
