const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { nearestExistingDirectory } = require('../src/path-utils');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-path-'));
}

test('存在的文件返回其父目录并标记为精确命中', () => {
  const root = mkTmp();
  const filePath = path.join(root, 'session.json');
  fs.writeFileSync(filePath, '{}');
  const result = nearestExistingDirectory(filePath);
  assert.equal(result.path, root);
  assert.equal(result.exact, true);
  assert.equal(result.originalExists, true);
  assert.equal(result.originalIsFile, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('失效文件路径回退到最近存在的上级目录', () => {
  const root = mkTmp();
  const existing = path.join(root, 'sessions');
  fs.mkdirSync(existing);
  const missing = path.join(existing, 'gone', 'session.json');
  const result = nearestExistingDirectory(missing);
  assert.equal(result.path, existing);
  assert.equal(result.exact, false);
  assert.equal(result.originalExists, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('原路径完全不可用时使用显式 fallback', () => {
  const root = mkTmp();
  const result = nearestExistingDirectory('', root);
  assert.equal(result.path, root);
  assert.equal(result.exact, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('缓存路径属于旧根目录时优先打开当前 fallback，而不是无关上级', () => {
  const root = mkTmp();
  const oldRoot = path.join(root, 'old-profile');
  const currentRoot = path.join(root, 'current-profile');
  fs.mkdirSync(currentRoot);
  const stale = path.join(oldRoot, 'sessions', 'gone.json');
  const result = nearestExistingDirectory(stale, currentRoot);
  assert.equal(result.path, currentRoot);
  assert.equal(result.exact, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('缓存路径仍在当前根目录内时保留最近存在上级', () => {
  const root = mkTmp();
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  const stale = path.join(sessions, 'gone', 'session.json');
  const result = nearestExistingDirectory(stale, root);
  assert.equal(result.path, sessions);
  fs.rmSync(root, { recursive: true, force: true });
});
