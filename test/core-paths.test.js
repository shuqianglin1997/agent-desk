// src/core/paths.js is the one place that decides "same path" and "inside".
// Each former copy is now a set of options; these tests pin those options.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../src/core/paths');

test('only a real ".." step leaves a folder', () => {
  assert.equal(paths.isInside('/a/..cache/x', '/a', { platform: 'darwin' }), true);
  assert.equal(paths.isInside('/a/../b', '/a', { platform: 'darwin' }), false);
  assert.equal(paths.isInside('/a', '/a', { platform: 'darwin' }), true);
  assert.equal(paths.isInside('', '/a'), false);
  assert.equal(paths.relativeStaysInside('', path.posix), true);
  assert.equal(paths.relativeStaysInside('..', path.posix), false);
  assert.equal(paths.relativeStaysInside('..x/y', path.posix), true);
  assert.equal(paths.relativeStaysInside('/abs', path.posix), false);
});

test('Windows rules fold case, trim, strip \\\\?\\ prefixes and keep UNC roots', () => {
  const W = paths.WINDOWS;
  assert.equal(paths.samePath('C:\\Users\\Me\\Work ', 'c:\\users\\me\\work', W), true);
  assert.equal(paths.samePath('\\\\?\\C:\\Users\\Me', 'C:\\Users\\Me', W), true);
  // As before: Windows rules compare as given, so a trailing backslash still differs.
  assert.equal(paths.samePath('C:\\Users\\Me', 'C:\\Users\\Me\\', W), false);
  assert.equal(paths.samePath('\\\\?\\UNC\\server\\share\\x', '\\\\server\\share\\x', W), true);
  assert.equal(paths.isInside('C:\\USERS\\me\\..cache\\x', 'c:\\Users\\Me', W), true);
  assert.equal(paths.isInside('C:\\Users\\Other', 'C:\\Users\\Me', W), false);
});

test('POSIX comparison is case-sensitive; resolve:false compares as given', () => {
  assert.equal(paths.samePath('/A/b', '/a/b', { platform: 'darwin' }), false);
  assert.equal(paths.samePath('/a/b/', '/a/b', { platform: 'darwin' }), true);
  assert.equal(paths.samePath('/a/./b', '/a/b', { platform: 'darwin', resolve: false }), true);
  assert.equal(paths.isInside('relative/x', 'relative', { platform: 'darwin', resolve: false }), true);
});

test('samePathReal follows symbolic links of paths that exist', (t) => {
  if (process.platform === 'win32') return t.skip('symbolic links need extra rights on Windows');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-core-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'real'));
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'));
  assert.equal(paths.samePathReal(path.join(root, 'link'), path.join(root, 'real')), true);
  assert.equal(paths.samePath(path.join(root, 'link'), path.join(root, 'real')), false);
  assert.equal(paths.samePathReal(path.join(root, 'missing'), path.join(root, 'missing')), true);
});

test('the former copies now come from core', () => {
  const sources = ['main.js', 'windows.js', 'path-utils.js', 'profile-runtime.js', 'hub/roster.js', 'automation/service.js',
    'clients/codex/history-retention.js', 'clients/claude-cli/identity.js', 'profile-home.js', 'clients/credential-files.js', 'clients/codex/task-package.js'];
  for (const file of sources) {
    const text = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    assert.match(text, /require\('(?:\.\.?\/)+core\/paths'\)/, file);
  }
  const metrics = require('../scripts/arch-metrics').collect();
  assert.deepEqual(metrics.pathEqualityOrContainmentHelpers.sites.map((site) => site.file).filter((file) => file !== 'src/core/paths.js'), []);
});
