const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('AgentDesk 不创建、修改或接管 Codex 的 config.toml', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  assert.equal(fs.existsSync(path.join(root, 'src', 'codex-managed-config.js')), false);
  assert.doesNotMatch(main, /codex-managed-config|ensureManagedCodexConfig/);
  assert.doesNotMatch(packageJson, /codex-managed-config/);
});
