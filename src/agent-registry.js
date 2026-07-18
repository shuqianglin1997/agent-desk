/*
 * AgentDesk — terminal Agent adapter registry.
 *
 * Direct Codex / Claude adapters remain in runtime.js. This registry describes
 * ACP-capable CLIs that can be discovered locally plus user-approved custom
 * ACP executables. Nothing here downloads or executes packages automatically.
 */

const os = require('node:os');
const path = require('node:path');

const ACP_PRESETS = Object.freeze([
  {
    id: 'gemini',
    label: 'Gemini CLI',
    names: ['gemini'],
    args: ['--acp'],
    envKeys: ['AGENTDESK_GEMINI_CLI', 'GEMINI_CLI_PATH'],
    detail: 'Google Gemini CLI 的 ACP 模式'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    names: ['opencode'],
    args: ['acp'],
    envKeys: ['AGENTDESK_OPENCODE_CLI', 'OPENCODE_CLI_PATH'],
    detail: 'OpenCode 原生 ACP Agent'
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent',
    names: ['cursor-agent'],
    args: ['acp'],
    envKeys: ['AGENTDESK_CURSOR_AGENT_CLI', 'CURSOR_AGENT_CLI_PATH'],
    detail: 'Cursor 命令行 Agent 的 ACP 模式'
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    names: ['copilot'],
    args: ['--acp', '--stdio'],
    envKeys: ['AGENTDESK_COPILOT_CLI', 'COPILOT_CLI_PATH'],
    detail: 'GitHub Copilot CLI 的 ACP 服务'
  },
  {
    id: 'goose',
    label: 'goose',
    names: ['goose'],
    args: ['acp'],
    envKeys: ['AGENTDESK_GOOSE_CLI', 'GOOSE_CLI_PATH'],
    detail: 'Block goose 的 ACP 模式'
  },
  {
    id: 'kimi',
    label: 'Kimi CLI',
    names: ['kimi'],
    args: ['acp'],
    envKeys: ['AGENTDESK_KIMI_CLI', 'KIMI_CLI_PATH'],
    detail: 'Kimi CLI 的 ACP 模式'
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    names: ['qwen', 'qwen-code'],
    args: ['--acp', '--experimental-skills'],
    envKeys: ['AGENTDESK_QWEN_CLI', 'QWEN_CLI_PATH'],
    detail: 'Qwen Code 的 ACP 模式'
  }
]);

const MAX_CUSTOM_ARGS = 32;
const MAX_CUSTOM_ARG_LENGTH = 512;

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
    for (const executable of variants) add(p.join(directory, executable), pathDirectories.includes(directory) ? 'PATH' : '用户工具目录');
  }
  return output;
}

function normalizeCustomAgent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim().slice(0, 60);
  const executable = String(value.executable || '').trim();
  const args = (Array.isArray(value.args) ? value.args : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_ARGS);
  if (!id || !name || !path.isAbsolute(executable)) return null;
  if (args.some((arg) => arg.length > MAX_CUSTOM_ARG_LENGTH || arg.includes('\u0000') || /[\r\n]/.test(arg))) return null;
  return {
    id,
    name,
    executable,
    args,
    protocol: 'acp',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

function normalizeCustomAgentList(values) {
  const output = [];
  const ids = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = normalizeCustomAgent(value);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    output.push(item);
  }
  return output.slice(0, 32);
}

function parseArgumentLines(value) {
  const args = String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (args.length > MAX_CUSTOM_ARGS) throw new Error(`启动参数最多 ${MAX_CUSTOM_ARGS} 行`);
  if (args.some((arg) => arg.length > MAX_CUSTOM_ARG_LENGTH || arg.includes('\u0000'))) {
    throw new Error('启动参数过长或包含非法字符');
  }
  return args;
}

module.exports = {
  ACP_PRESETS,
  MAX_CUSTOM_ARGS,
  cliCandidates,
  normalizeCustomAgent,
  normalizeCustomAgentList,
  parseArgumentLines
};
