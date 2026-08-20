const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PERMISSION_PROFILE,
  addManagedCodexDefaults,
  ensureManagedCodexConfig
} = require('../src/codex-managed-config');

function tempProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-config-'));
  const profilePath = path.join(root, 'profile');
  const sessionRoot = path.join(profilePath, 'codex-home');
  return {
    root,
    profilePath,
    sessionRoot,
    profile: {
      appId: 'codex',
      profilePath,
      sessionRoot,
      profilePathMode: 'managed',
      sessionRootMode: 'managed'
    }
  };
}

test('缺失权限项时生成工作区独占策略，并把顶层键放在首个 TOML table 前', () => {
  const source = [
    'model = "gpt-5.6-sol"',
    '',
    '[features]',
    'js_repl = false',
    ''
  ].join('\n');
  const result = addManagedCodexDefaults(source);

  assert.equal(result.changed, true);
  assert.ok(result.text.indexOf(`default_permissions = "${PERMISSION_PROFILE}"`) < result.text.indexOf('[features]'));
  assert.ok(result.text.indexOf('approval_policy = "on-request"') < result.text.indexOf('[features]'));
  assert.ok(result.text.indexOf('approvals_reviewer = "user"') < result.text.indexOf('[features]'));
  assert.match(result.text, new RegExp(`\\[permissions\\.${PERMISSION_PROFILE}\\]`));
  assert.match(result.text, /":root" = "deny"/);
  assert.match(result.text, /":minimal" = "read"/);
  assert.match(result.text, /extends = ":workspace"/);
  assert.match(result.text, /model = "gpt-5\.6-sol"/);
  assert.match(result.text, /\[features\]\njs_repl = false/);
});

test('用户已有的显式权限与审批选择保持原样', () => {
  const source = [
    'default_permissions = ":danger-full-access"',
    'approval_policy = "never"',
    'approvals_reviewer = "auto_review"',
    '',
    '[features]',
    'js_repl = false',
    ''
  ].join('\n');
  const result = addManagedCodexDefaults(source);

  assert.equal(result.changed, false);
  assert.equal(result.text, source);
  assert.doesNotMatch(result.text, /agentdesk-workspace-only/);
});

test('已有部分显式设置时只补缺失键', () => {
  const source = [
    'approval_policy = "untrusted"',
    '',
    '[features]',
    'js_repl = false',
    ''
  ].join('\n');
  const result = addManagedCodexDefaults(source);

  assert.equal(result.changed, true);
  assert.match(result.text, /approval_policy = "untrusted"/);
  assert.doesNotMatch(result.text, /approval_policy = "on-request"/);
  assert.match(result.text, /approvals_reviewer = "user"/);
  assert.match(result.text, new RegExp(`default_permissions = "${PERMISSION_PROFILE}"`));
});

test('用户已有旧 sandbox_mode 时不混入互斥的 permission profile', () => {
  const source = [
    'sandbox_mode = "workspace-write"',
    '',
    '[sandbox_workspace_write]',
    'network_access = false',
    ''
  ].join('\n');
  const result = addManagedCodexDefaults(source);

  assert.equal(result.changed, true);
  assert.match(result.text, /sandbox_mode = "workspace-write"/);
  assert.match(result.text, /approval_policy = "on-request"/);
  assert.match(result.text, /approvals_reviewer = "user"/);
  assert.doesNotMatch(result.text, /default_permissions/);
  assert.doesNotMatch(result.text, /agentdesk-workspace-only/);
});

test('受管 Codex 配置以 0600 原子写入并保留上一版备份', () => {
  const fixture = tempProfile();
  try {
    fs.mkdirSync(fixture.sessionRoot, { recursive: true });
    const configFile = path.join(fixture.sessionRoot, 'config.toml');
    const original = 'model = "gpt-5.6-sol"\n';
    fs.writeFileSync(configFile, original, { mode: 0o644 });

    const result = ensureManagedCodexConfig(fixture.profile);
    assert.equal(result.changed, true);
    assert.equal(fs.readFileSync(`${configFile}.agentdesk.bak`, 'utf8'), original);
    assert.match(fs.readFileSync(configFile, 'utf8'), /":root" = "deny"/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
      assert.equal(fs.statSync(`${configFile}.agentdesk.bak`).mode & 0o777, 0o600);
    }

    const second = ensureManagedCodexConfig(fixture.profile);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(`${configFile}.agentdesk.bak`, 'utf8'), original);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('受管配置拒绝越界 sessionRoot 和符号链接 config.toml', (t) => {
  const fixture = tempProfile();
  try {
    fs.mkdirSync(fixture.sessionRoot, { recursive: true });
    const outside = path.join(fixture.root, 'outside');
    assert.throws(() => ensureManagedCodexConfig({ ...fixture.profile, sessionRoot: outside }), {
      code: 'codex-config-root-outside-profile'
    });

    if (process.platform === 'win32') {
      t.skip('Windows 测试环境不保证允许创建符号链接');
      return;
    }
    const target = path.join(fixture.root, 'target.toml');
    fs.writeFileSync(target, 'model = "x"\n');
    fs.symlinkSync(target, path.join(fixture.sessionRoot, 'config.toml'));
    assert.throws(() => ensureManagedCodexConfig(fixture.profile), {
      code: 'codex-config-file-unsafe'
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('默认或自定义 Codex 路径不被 AgentDesk 修改', () => {
  const fixture = tempProfile();
  try {
    const result = ensureManagedCodexConfig({
      ...fixture.profile,
      sessionRootMode: 'custom'
    });
    assert.deepEqual(result, { ok: true, changed: false, skipped: true });
    assert.equal(fs.existsSync(fixture.profilePath), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('Main 在首次准备和每次直接启动受管 Codex 前都应用安全配置', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /const \{ ensureManagedCodexConfig \} = require\('\.\/codex-managed-config'\)/);
  assert.match(main, /async prepare\(profile\) \{[\s\S]*?ensureManagedCodexConfig\(profile\);[\s\S]*?return \{ ok: true \}/);

  const launchStart = main.indexOf('async function launchProfile(profile)');
  const launchEnd = main.indexOf('\nfunction ', launchStart + 1);
  const launch = main.slice(launchStart, launchEnd);
  const policyIndex = launch.indexOf('ensureManagedCodexConfig(profile)');
  const spawnIndex = launch.indexOf("launchOwned(\n          '/usr/bin/open'");
  assert.ok(policyIndex >= 0);
  assert.ok(spawnIndex > policyIndex);
});
