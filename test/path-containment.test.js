// A child folder whose name merely starts with ".." (such as "..cache") is
// inside its parent; only a real ".." step leaves it. Several copies of the
// containment check got this wrong; each is exercised here as it runs today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { nearestExistingDirectory } = require('../src/path-utils');

function extract(file, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  return source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];
}

test('path-utils: the nearest existing folder inside "..cache" is that folder, not the fallback root', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-dotdot-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '..cache'));
  const result = nearestExistingDirectory(path.join(root, '..cache', 'missing.jsonl'), root);
  assert.equal(result.path, path.join(root, '..cache'));
});

test('main.js isSubpath treats "..cache" as inside and ".." as outside', () => {
  const context = vm.createContext({ path, process: { platform: 'darwin' }, windows: {} });
  vm.runInContext(extract('main.js', 'isSubpath'), context);
  assert.equal(context.isSubpath('/work/..cache/x', '/work'), true);
  assert.equal(context.isSubpath('/work/../other', '/work'), false);
  assert.equal(context.isSubpath('/work/..', '/work'), false);
  assert.equal(context.isSubpath('/work', '/work'), true);
});

test('TaskPackage Codex adapter isWithin treats "..cache" as inside and ".." as outside', () => {
  const context = vm.createContext({ path });
  vm.runInContext(extract('task-package/codex-adapter.js', 'isWithin'), context);
  assert.equal(context.isWithin('/home/sessions/..cache/r.jsonl', '/home/sessions'), true);
  assert.equal(context.isWithin('/home/sessions/../secret', '/home/sessions'), false);
  assert.equal(context.isWithin('/home/sessions', '/home/sessions'), true);
});
