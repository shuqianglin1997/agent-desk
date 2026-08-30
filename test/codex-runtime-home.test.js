const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAC_SUN_PATH_BYTES,
  socketPathBytes,
  needsShortRuntimeHome,
  ensureCodexRuntimeHome
} = require('../src/codex-runtime-home');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-home-'));
  const aliasRoot = path.join('/tmp', `adch-${path.basename(root).slice(-8)}`);
  const sessionRoot = path.join(
    root,
    'Profiles',
    'Codex',
    'employee-0349c3bb',
    'a-very-long-managed-session-root-that-exceeds-the-macos-unix-socket-boundary',
    'codex-home'
  );
  return { root, aliasRoot, sessionRoot };
}

test('macOS 长 CODEX_HOME 使用稳定短别名且数据仍写入原目录', () => {
  const { aliasRoot, sessionRoot } = fixture();
  const profile = { id: '0349c3bb-65c0-45e7-a85f-2d510be5a28a', sessionRoot };
  assert.equal(needsShortRuntimeHome(sessionRoot, 'darwin'), true);
  assert.equal(socketPathBytes(sessionRoot) >= MAC_SUN_PATH_BYTES, true);

  const first = ensureCodexRuntimeHome(profile, { platform: 'darwin', aliasRoot });
  assert.equal(first.aliased, true);
  assert.equal(first.canonicalSessionRoot, path.resolve(sessionRoot));
  assert.equal(first.socketPathBytes < MAC_SUN_PATH_BYTES, true);
  assert.equal(fs.lstatSync(first.sessionRoot).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(first.sessionRoot), fs.realpathSync(sessionRoot));

  fs.writeFileSync(path.join(first.sessionRoot, 'auth.json'), '{"account":"1997"}');
  assert.equal(fs.readFileSync(path.join(sessionRoot, 'auth.json'), 'utf8'), '{"account":"1997"}');
  assert.equal(ensureCodexRuntimeHome(profile, {
    platform: 'darwin',
    aliasRoot
  }).sessionRoot, first.sessionRoot);
});

test('短路径和非 macOS 保持原 CODEX_HOME，不创建别名', () => {
  const { aliasRoot } = fixture();
  const shortRoot = path.join(os.tmpdir(), 'codex-short-home');
  const darwin = ensureCodexRuntimeHome({ id: 'short', sessionRoot: shortRoot }, {
    platform: 'darwin',
    aliasRoot
  });
  const linux = ensureCodexRuntimeHome({ id: 'linux', sessionRoot: '/a/very/long/path'.repeat(12) }, {
    platform: 'linux',
    aliasRoot
  });
  assert.equal(darwin.aliased, false);
  assert.equal(darwin.sessionRoot, path.resolve(shortRoot));
  assert.equal(linux.aliased, false);
  assert.equal(fs.existsSync(aliasRoot), false);
});

test('短别名冲突时拒绝覆盖普通文件，sessionRoot 变更时只重定向受管符号链接', () => {
  const { root, aliasRoot, sessionRoot } = fixture();
  const profile = { id: 'stable-profile-id', sessionRoot };
  const first = ensureCodexRuntimeHome(profile, { platform: 'darwin', aliasRoot });
  const replacement = path.join(root, 'replacement', 'another-long-session-root'.repeat(5));
  const second = ensureCodexRuntimeHome({ ...profile, sessionRoot: replacement }, {
    platform: 'darwin',
    aliasRoot
  });
  assert.equal(second.sessionRoot, first.sessionRoot);
  assert.equal(fs.realpathSync(second.sessionRoot), fs.realpathSync(replacement));

  fs.unlinkSync(second.sessionRoot);
  fs.writeFileSync(second.sessionRoot, 'do-not-overwrite');
  assert.throws(() => ensureCodexRuntimeHome({ ...profile, sessionRoot }, {
    platform: 'darwin',
    aliasRoot
  }), /codex-runtime-home-alias-conflict/);
  assert.equal(fs.readFileSync(second.sessionRoot, 'utf8'), 'do-not-overwrite');
});
