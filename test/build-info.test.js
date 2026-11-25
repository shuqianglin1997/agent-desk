'use strict';

// Which source a package was built from (docs/FIX_AND_REBUILD.md). Just
// before electron-builder packs the app, scripts/build-info.js writes the
// commit into build-info.json, which goes into app.asar. A copy running from
// a package reports it (the CLI's capabilities and the macOS About panel), so
// whoever fixes a problem for that person can fetch exactly that source. A
// source checkout reports packaged: false and leaves the commit to git.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempDir } = require('./helpers/temp');
const { writeBuildInfo, readGitState } = require('../scripts/build-info');
const product = require('../src/core/product');
const packageJson = require('../package.json');

const COMMIT = 'a'.repeat(40);

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('the build records the commit, and whether the packed files differ from it', (t) => {
  const root = makeTempDir(t, 'agentdesk-build-info-');
  git(root, 'init', '-q');
  write(path.join(root, 'package.json'), '{}\n');
  write(path.join(root, 'src', 'main.js'), '1\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  const head = git(root, 'rev-parse', 'HEAD');

  assert.deepEqual(writeBuildInfo(root), { schemaVersion: 1, commit: head, dirty: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')), { schemaVersion: 1, commit: head, dirty: false });
  // Files that are not packed (here a film folder, and build-info.json itself) do not count.
  write(path.join(root, 'media', 'film.txt'), 'x\n');
  assert.equal(writeBuildInfo(root).dirty, false);
  // A changed or new packed file does.
  write(path.join(root, 'src', 'main.js'), '2\n');
  assert.equal(writeBuildInfo(root).dirty, true);
  git(root, 'checkout', '-q', '--', 'src/main.js');
  write(path.join(root, 'src', 'new.js'), '3\n');
  assert.equal(writeBuildInfo(root).dirty, true);
});

test('without git (a source download) the commit is unknown, not guessed', (t) => {
  const root = makeTempDir(t, 'agentdesk-build-info-');
  const noGit = () => ({ status: 128, stdout: '', stderr: 'not a git repository' });
  assert.deepEqual(readGitState(root, noGit), { commit: null, dirty: null });
  assert.deepEqual(writeBuildInfo(root, { run: noGit }), { schemaVersion: 1, commit: null, dirty: null });
});

test('a packaged copy reports its build; a source checkout does not trust a stale build-info.json', (t) => {
  const base = makeTempDir(t, 'agentdesk-build-info-');
  const repository = 'https://github.com/shuqianglin1997/catshelf';
  const asar = path.join(base, 'Catshelf.app', 'Contents', 'Resources', 'app.asar');
  write(path.join(asar, 'package.json'), JSON.stringify(packageJson));
  write(path.join(asar, 'build-info.json'), JSON.stringify({ schemaVersion: 1, commit: COMMIT, dirty: true }));
  assert.deepEqual(product.buildInfo(asar), { version: packageJson.version, packaged: true, commit: COMMIT, dirty: true, repository });

  const checkout = path.join(base, 'agent-desk');
  write(path.join(checkout, 'package.json'), JSON.stringify(packageJson));
  write(path.join(checkout, 'build-info.json'), JSON.stringify({ schemaVersion: 1, commit: COMMIT, dirty: false }));
  assert.deepEqual(product.buildInfo(checkout), { version: packageJson.version, packaged: false, commit: null, dirty: null, repository });

  // A package without a readable record says so instead of inventing one.
  fs.writeFileSync(path.join(asar, 'build-info.json'), '{"commit":"not-a-commit"}');
  assert.deepEqual(product.buildInfo(asar), { version: packageJson.version, packaged: true, commit: null, dirty: null, repository });
  fs.rmSync(path.join(asar, 'build-info.json'));
  assert.equal(product.buildInfo(asar).commit, null);
});

test('the macOS About panel names the version, the short commit and where the source is', () => {
  const repository = 'https://github.com/shuqianglin1997/catshelf';
  assert.deepEqual(product.aboutPanelOptions({ version: '0.10.1-preview.1', packaged: true, commit: COMMIT, dirty: false, repository }), {
    applicationVersion: '0.10.1-preview.1',
    version: 'aaaaaaa',
    credits: `${repository}\ncommit ${COMMIT}`
  });
  assert.deepEqual(product.aboutPanelOptions({ version: '0.10.1-preview.1', packaged: true, commit: COMMIT, dirty: true, repository }), {
    applicationVersion: '0.10.1-preview.1',
    version: 'aaaaaaa+',
    credits: `${repository}\ncommit ${COMMIT} + uncommitted changes`
  });
  assert.deepEqual(product.aboutPanelOptions({ version: '0.10.1-preview.1', packaged: false, commit: null, dirty: null, repository }), {
    applicationVersion: '0.10.1-preview.1',
    version: 'source',
    credits: repository
  });
});

test('the CLI capabilities report the build, and the package carries build-info.json from the beforePack hook', async () => {
  const { execute } = require('../src/automation/service');
  const { build } = execute('capabilities');
  assert.deepEqual(build, product.buildInfo());
  assert.equal(build.packaged, false);
  assert.ok(packageJson.build.files.includes('build-info.json'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^\/build-info\.json$/m);
  // The hook writes the record before it builds the native helpers.
  const { _internals } = require('../scripts/build-native-helpers');
  const calls = [];
  await _internals.prepareForPack({ writeInfo: () => calls.push('info'), buildHelpers: () => { calls.push('helpers'); return []; } });
  assert.deepEqual(calls, ['info', 'helpers']);
});
