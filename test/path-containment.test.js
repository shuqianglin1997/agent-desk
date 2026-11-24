// A child folder whose name merely starts with ".." (such as "..cache") is
// inside its parent; only a real ".." step leaves it. Several copies of the
// containment check got this wrong; each is exercised here as it runs today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nearestExistingDirectory } = require('../src/path-utils');

test('path-utils: the nearest existing folder inside "..cache" is that folder, not the fallback root', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-dotdot-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '..cache'));
  const result = nearestExistingDirectory(path.join(root, '..cache', 'missing.jsonl'), root);
  assert.equal(result.path, path.join(root, '..cache'));
});

test('the desktop app\'s path rules (main.js) treat "..cache" as inside and ".." as outside', () => {
  // main.js binds isSubpath/pathsEqual to src/core/paths.js native rules.
  const { native } = require('../src/core/paths');
  assert.equal(native.isInside('/work/..cache/x', '/work'), true);
  assert.equal(native.isInside('/work/../other', '/work'), false);
  assert.equal(native.isInside('/work/..', '/work'), false);
  assert.equal(native.isInside('/work', '/work'), true);
});
