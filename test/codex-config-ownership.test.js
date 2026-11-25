const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { seedCodexHome } = require('../src/clients/codex/home');
const { makeTempDir } = require('./helpers/temp');

const root = path.join(__dirname, '..');

test('AgentDesk 不修改、不接管 Codex 的 config.toml：只在新建的独立目录里写一行登录存放方式', (t) => {
  const dir = makeTempDir('agentdesk-codex-config-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A new managed home: one line, the file credential store, private to the user.
  const fresh = path.join(dir, 'fresh');
  fs.mkdirSync(fresh);
  assert.deepEqual(seedCodexHome({ sessionRoot: fresh }, fs, path), { seeded: true, appId: 'codex', path: fresh, files: ['config.toml'] });
  assert.equal(fs.readFileSync(path.join(fresh, 'config.toml'), 'utf8'), 'cli_auth_credentials_store = "file"\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(fresh, 'config.toml')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(fresh), ['config.toml']);

  // An existing config.toml (the user's or the official client's) stays byte for byte.
  const existing = path.join(dir, 'existing');
  fs.mkdirSync(existing);
  const original = 'model = "o9"\n[profiles.work]\napproval_policy = "never"\n';
  fs.writeFileSync(path.join(existing, 'config.toml'), original);
  assert.deepEqual(seedCodexHome({ sessionRoot: existing }, fs, path), { seeded: false, reason: 'config-exists' });
  assert.equal(fs.readFileSync(path.join(existing, 'config.toml'), 'utf8'), original);
  // Seeding again changes nothing either.
  assert.deepEqual(seedCodexHome({ sessionRoot: fresh }, fs, path), { seeded: false, reason: 'config-exists' });

  // The retired managed-config module stays gone.
  assert.equal(fs.existsSync(path.join(root, 'src', 'codex-managed-config.js')), false);
});
