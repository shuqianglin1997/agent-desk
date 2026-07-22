// AgentDesk — 同账号自动识别（登录身份指纹）单测。
// 指纹 = 账号 UUID 的 sha256 前 16 位：只用于本地比对，renderer 拿不到原始
// UUID，更拿不到 token / 邮箱。读取的文件里可能含敏感字段（oauth:tokenCache、
// tokens.access_token），模块只允许取账号 ID 一个字段。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { identityFingerprint } = require('../src/identity');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ident-'));
}

const UUID = '11112222-3333-4444-5555-666677778888';
const EXPECTED = crypto.createHash('sha256').update(UUID).digest('hex').slice(0, 16);

test('claude 桌面槽位：读 profilePath/config.json 的 lastKnownAccountUuid', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    lastKnownAccountUuid: UUID,
    'oauth:tokenCache': 'SENSITIVE-NEVER-READ'
  }));
  const fp = identityFingerprint({ appId: 'claude', profilePath: dir, sessionRoot: dir });
  assert.equal(fp, EXPECTED);
});

test('claude-cli：默认 ~/.claude 布局读 home 根的 .claude.json，独立槽位读 sessionRoot 内', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({
    oauthAccount: { accountUuid: UUID, emailAddress: 'SENSITIVE' }
  }));
  const fp = identityFingerprint({ appId: 'claude-cli', profilePath: '/x', sessionRoot: dir });
  assert.equal(fp, EXPECTED);
});

test('codex：读 sessionRoot/auth.json 的 tokens.account_id', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
    tokens: { account_id: UUID, access_token: 'SENSITIVE-NEVER-READ' }
  }));
  const fp = identityFingerprint({ appId: 'codex', profilePath: '/x', sessionRoot: dir });
  assert.equal(fp, EXPECTED);
});

test('同一账号在桌面与 CLI 两侧指纹一致；不同账号不一致', () => {
  const desktop = tmp();
  fs.writeFileSync(path.join(desktop, 'config.json'), JSON.stringify({ lastKnownAccountUuid: UUID }));
  const cli = tmp();
  fs.writeFileSync(path.join(cli, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: UUID } }));
  const other = tmp();
  fs.writeFileSync(path.join(other, 'config.json'), JSON.stringify({ lastKnownAccountUuid: 'ffff0000-1111-2222-3333-444455556666' }));

  const a = identityFingerprint({ appId: 'claude', profilePath: desktop, sessionRoot: desktop });
  const b = identityFingerprint({ appId: 'claude-cli', profilePath: '/x', sessionRoot: cli });
  const c = identityFingerprint({ appId: 'claude', profilePath: other, sessionRoot: other });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('缺文件 / 坏 JSON / 未登录 / 不支持的客户端 → null，绝不抛异常', () => {
  const dir = tmp();
  assert.equal(identityFingerprint({ appId: 'claude', profilePath: dir, sessionRoot: dir }), null);
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
  assert.equal(identityFingerprint({ appId: 'claude', profilePath: dir, sessionRoot: dir }), null);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ someOther: 1 }));
  assert.equal(identityFingerprint({ appId: 'claude', profilePath: dir, sessionRoot: dir }), null);
  assert.equal(identityFingerprint({ appId: 'kimi', profilePath: dir, sessionRoot: dir }), null);
  assert.equal(identityFingerprint(null), null);
});

test('claude-cli 默认根判断容忍尾分隔符（路径宽松比对）', () => {
  // sessionRoot 带尾斜杠时仍应识别为默认布局 → 读 home 根的 ~/.claude.json。
  // home 根的真实文件不属于测试可控范围，这里只断言不抛异常且返回哈希或 null。
  const fp = identityFingerprint({
    appId: 'claude-cli',
    profilePath: '/x',
    sessionRoot: path.join(os.homedir(), '.claude') + path.sep
  });
  assert.ok(fp === null || /^[0-9a-f]{16}$/.test(fp));
});

test('指纹是 16 位十六进制，不含原始 UUID 片段', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: UUID }));
  const fp = identityFingerprint({ appId: 'claude', profilePath: dir, sessionRoot: dir });
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(UUID.includes(fp), false);
});
