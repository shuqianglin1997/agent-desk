// AgentDesk — tests leave nothing in the temp folder: the shared helper
// removes what it makes, and npm test (scripts/run-tests.js) fails when a test
// file leaves something behind.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { makeTempDir } = require('./helpers/temp');

const ROOT = path.join(__dirname, '..');
let fromFirstTest = null;

test('makeTempDir(t) 的目录在这个测试结束时删掉', (t) => {
  fromFirstTest = makeTempDir(t, 'agentdesk-temp-helper-');
  fs.writeFileSync(path.join(fromFirstTest, 'x.txt'), 'x');
  assert.ok(fs.existsSync(fromFirstTest));
});

test('上一个测试的目录已经不在了；不带测试上下文的目录在进程退出时删掉', (t) => {
  assert.ok(fromFirstTest && !fs.existsSync(fromFirstTest));
  const outer = makeTempDir(t, 'agentdesk-temp-exit-');
  const script = `const { makeTempDir } = require(${JSON.stringify(path.join(ROOT, 'test', 'helpers', 'temp.js'))}); makeTempDir('agentdesk-exit-');`;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TMPDIR: outer, TMP: outer, TEMP: outer }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(outer), []);
});

test('npm test 的运行器：测试留下的东西让这次运行失败并列出来，运行用的临时目录本身不留', (t) => {
  const outer = makeTempDir(t, 'agentdesk-temp-runner-');
  const fixtures = makeTempDir(t, 'agentdesk-temp-fixtures-');
  const leaky = path.join(fixtures, 'leaky.test.js');
  fs.writeFileSync(leaky, "const { test } = require('node:test'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');\n"
    + "test('leaks', () => { fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-leak-')); });\n");
  const clean = path.join(fixtures, 'clean.test.js');
  fs.writeFileSync(clean, `const { test } = require('node:test'); const { makeTempDir } = require(${JSON.stringify(path.join(ROOT, 'test', 'helpers', 'temp.js'))});\n`
    + "test('cleans', (t) => { makeTempDir(t, 'agentdesk-clean-'); });\n");
  // A fresh top-level run: without the parent's test-runner context.
  const env = { ...process.env, TMPDIR: outer, TMP: outer, TEMP: outer };
  delete env.NODE_TEST_CONTEXT;
  const run = (file) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js'), file], { env, encoding: 'utf8' });

  const leaked = run(leaky);
  assert.equal(leaked.status, 1);
  assert.match(leaked.stderr, /left 1 item\(s\) in the temp folder[\s\S]*agentdesk-leak-/);
  assert.deepEqual(fs.readdirSync(outer), [], 'the run removed its own temp folder');

  const passed = run(clean);
  assert.equal(passed.status, 0, passed.stderr);
  assert.deepEqual(fs.readdirSync(outer), []);
});

test('隐藏验收停下 Electron 后，只删它的 user data 指向的那个 Chromium scoped_dir', (t) => {
  const { removeChromiumSingletonDir } = require('../scripts/ui-acceptance');
  const root = makeTempDir(t, 'agentdesk-temp-singleton-');
  const scoped = path.join(root, 'scoped_dirAbC123');
  const other = path.join(root, 'not-chromium');
  fs.mkdirSync(scoped); fs.mkdirSync(other);
  fs.writeFileSync(path.join(scoped, 'SingletonSocket'), '');
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(userData);
  fs.symlinkSync(path.join(scoped, 'SingletonSocket'), path.join(userData, 'SingletonSocket'));
  removeChromiumSingletonDir(userData);
  assert.equal(fs.existsSync(scoped), false);
  // A link that does not point into a scoped_dir, or no link at all, removes nothing.
  const otherData = path.join(root, 'other-data');
  fs.mkdirSync(otherData);
  fs.symlinkSync(path.join(other, 'SingletonSocket'), path.join(otherData, 'SingletonSocket'));
  removeChromiumSingletonDir(otherData);
  removeChromiumSingletonDir(path.join(root, 'missing'));
  removeChromiumSingletonDir(null);
  assert.equal(fs.existsSync(other), true);
});
