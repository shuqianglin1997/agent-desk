/*
 * AgentDesk — 登录身份指纹（同账号自动识别）。
 *
 * 同一个账号常以多种形态出现在本机：桌面 Claude App 与终端里的 Claude CLI、
 * 一个 CODEX_HOME 的多处引用……这里从各客户端的本地配置里取「账号 UUID」，
 * 输出 sha256 前 16 位作为指纹：指纹相同 = 同一登录身份。
 *
 * 安全边界（不可破）：
 * - 读到的文件里可能含 token / 邮箱（config.json 的 oauth:tokenCache、
 *   auth.json 的 access_token、.claude.json 的 emailAddress），本模块
 *   只取账号 ID 一个字段，其余一律不出模块。
 * - 对外只给哈希，renderer 永远见不到原始 UUID。
 * - 任何失败（缺文件 / 坏 JSON / 未登录）→ null，不抛异常。
 *
 * 纯 Node（fs/path/crypto/os），可单测。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function fingerprintOf(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim()) return null;
  return crypto.createHash('sha256').update(accountId.trim()).digest('hex').slice(0, 16);
}

// 桌面 Claude App：<profilePath>/config.json 的 lastKnownAccountUuid
function claudeDesktopAccountId(profile) {
  const json = readJsonSafe(path.join(profile.profilePath || '', 'config.json'));
  return json?.lastKnownAccountUuid ?? null;
}

// 路径比较需容忍尾分隔符与 Windows 大小写差异（路径可能经过用户手填/展开）
function samePath(a, b) {
  const normalize = (value) => {
    let out = path.resolve(String(value || ''));
    if (process.platform === 'win32') out = out.toLowerCase();
    return out;
  };
  return normalize(a) === normalize(b);
}

// Claude Code CLI：配置文件是 <数据目录>/.claude.json；历史默认布局下数据目录
// 是 ~/.claude 而配置在 home 根（~/.claude.json），CLAUDE_CONFIG_DIR 布局则同目录。
function claudeCliAccountId(profile) {
  const root = profile.sessionRoot || '';
  const configPath = samePath(root, path.join(os.homedir(), '.claude'))
    ? path.join(os.homedir(), '.claude.json')
    : path.join(root, '.claude.json');
  const json = readJsonSafe(configPath);
  return json?.oauthAccount?.accountUuid ?? null;
}

// Codex（桌面 App 与 CLI 共用 CODEX_HOME）：<sessionRoot>/auth.json 的 tokens.account_id
function codexAccountId(profile) {
  const json = readJsonSafe(path.join(profile.sessionRoot || '', 'auth.json'));
  return json?.tokens?.account_id ?? null;
}

const ACCOUNT_ID_READERS = {
  claude: claudeDesktopAccountId,
  'claude-cli': claudeCliAccountId,
  codex: codexAccountId
  // kimi / kimi-work：凭据无明文账号 ID（实测），走手动 identityKey 关联
};

function identityFingerprint(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const reader = ACCOUNT_ID_READERS[profile.appId];
  if (!reader) return null;
  try {
    return fingerprintOf(reader(profile));
  } catch (_error) {
    return null;
  }
}

module.exports = { identityFingerprint };
