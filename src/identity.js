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

const crypto = require('node:crypto');
const apps = require('./apps');

function fingerprintOf(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim()) return null;
  return crypto.createHash('sha256').update(accountId.trim()).digest('hex').slice(0, 16);
}

// Each adapter that can read an account ID declares `accountId(profile)`
// (src/clients/<id>/identity.js). Kimi Code and Kimi Work keep no plain account
// ID in their credentials (checked), so they are linked by a manual identityKey.
function identityFingerprint(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const reader = apps.isKnownApp(profile.appId) ? apps.getApp(profile.appId).accountId : null;
  if (typeof reader !== 'function') return null;
  try {
    return fingerprintOf(reader(profile));
  } catch (_error) {
    return null;
  }
}

module.exports = { identityFingerprint };
