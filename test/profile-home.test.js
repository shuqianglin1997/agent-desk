const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  prepareManagedProfileHome
} = require('../src/profile-home');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-profile-home-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { root, home };
}

test('Claude CLI 独立槽位只建配置根和 projects，不复制账号、代理或会话', () => {
  const { root, home } = fixture();
  const official = path.join(home, '.claude');
  fs.mkdirSync(path.join(official, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(official, 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_BASE_URL: 'https://proxy.example' }
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    oauthAccount: { accountUuid: 'acct-1', emailAddress: 'secret@example.com' }
  }));

  const sessionRoot = path.join(root, 'Profiles', 'Claude', 'work-1', 'claude-cli-home');
  const result = prepareManagedProfileHome({
    appId: 'claude-cli',
    sessionRoot,
    profilePath: path.join(root, 'Profiles', 'Claude', 'work-1'),
    sessionRootMode: 'managed'
  }, { home });

  assert.equal(result.seeded, true);
  assert.equal(fs.existsSync(path.join(sessionRoot, 'projects')), true);
  assert.equal(fs.existsSync(path.join(sessionRoot, 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(sessionRoot, '.claude.json')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude.json')), true);
});

test('DSH 独立槽位只建空目录，不复制配置或改写已有文件', () => {
  const { root, home } = fixture();
  const sourceProfile = path.join(home, '.dsh', 'profiles', 'desktop');
  fs.mkdirSync(sourceProfile, { recursive: true });
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml', '.credentials.yaml']) {
    fs.writeFileSync(path.join(sourceProfile, name), 'inline-private-config');
  }
  const sessionRoot = path.join(root, 'slot', 'dsh-home');
  const profile = { appId: 'dsh-cli', sessionRoot, sessionRootMode: 'managed' };
  assert.deepEqual(prepareManagedProfileHome(profile, { home }), {
    seeded: false, reason: 'configuration-required'
  });
  assert.deepEqual(fs.readdirSync(sessionRoot), []);
  fs.writeFileSync(path.join(sessionRoot, 'settings.yaml'), 'keep-user-config');
  prepareManagedProfileHome(profile, { home });
  assert.equal(fs.readFileSync(path.join(sessionRoot, 'settings.yaml'), 'utf8'), 'keep-user-config');
  assert.deepEqual(fs.readdirSync(sessionRoot), ['settings.yaml']);
});

test('官方默认 ~/.claude 与 ~/.dsh 不会被播种改写', () => {
  const { home } = fixture();
  const claudeHome = path.join(home, '.claude');
  const dshHome = path.join(home, '.dsh');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), '{"keep":true}');

  assert.deepEqual(prepareManagedProfileHome({
    appId: 'claude-cli',
    sessionRoot: claudeHome,
    sessionRootMode: 'managed'
  }, { home }), { seeded: false, reason: 'official-default' });
  assert.deepEqual(prepareManagedProfileHome({
    appId: 'dsh-cli',
    sessionRoot: dshHome,
    isProtected: true
  }, { home }), { seeded: false, reason: 'official-default' });
  assert.equal(fs.readFileSync(path.join(claudeHome, 'settings.json'), 'utf8'), '{"keep":true}');
  assert.equal(fs.existsSync(path.join(dshHome, 'profiles')), false);
});

test('main 在创建、准备和 CLI 启动时播种独立配置根', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /prepareManagedProfileHome\(profile\)/);
  assert.match(main, /if \(app_\.cliDiscoveryId\)/);
  assert.match(main, /function createStoredProfile[\s\S]*prepareManagedProfileHome\(profile\)/);
  assert.match(main, /terminalLauncherScript\(/);
  assert.match(main, /ANTHROPIC_\|CLAUDE_CODE_\|CLAUDE_CONFIG_DIR\$\|DSH_HOME\$/);
});
