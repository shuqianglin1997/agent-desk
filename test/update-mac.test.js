'use strict';

// macOS one-click update (src/update-mac.js): every step and every refusal
// with injected fakes. No hdiutil, codesign, ditto or network; the "mount" is
// a folder the fake run fills, the "app" a folder with a real app.asar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { makeTempDir } = require('./helpers/temp');
const updateMac = require('../src/update-mac');

const COMMIT = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const BUNDLE_ID = 'com.hupo.agentdesk';

// A minimal asar archive (layout of scripts/verify-electron-package-integrity.js).
function writeAsar(file, entries) {
  const files = {};
  const blobs = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    files[name] = { size: data.length, offset: String(offset) };
    blobs.push(data);
    offset += data.length;
  }
  const header = Buffer.from(JSON.stringify({ files }));
  const padded = Math.ceil(header.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(header.length, 4);
  header.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...blobs]));
}

function makeApp(root, { commit = COMMIT, executable = true } = {}) {
  const app = path.join(root, 'Catshelf.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist/>');
  if (executable) fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Catshelf'), '');
  writeAsar(path.join(app, 'Contents', 'Resources', 'app.asar'), {
    'package.json': '{"name":"agent-desk"}',
    'build-info.json': JSON.stringify({ schemaVersion: 1, commit, dirty: false })
  });
  return app;
}

// The system tools as fakes. `plist` answers plutil by key; `codesignFails`
// says which paths fail codesign; hdiutil attach "mounts" `source` by copying
// it into the mount point, detach empties it, ditto copies.
function fakeTools({ source = null, plist = {}, codesignFails = () => false, attachFails = false, dittoFails = false, detachFails = false } = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    const tool = path.basename(file);
    if (tool === 'plutil') {
      const key = args[1];
      const value = { CFBundleIdentifier: BUNDLE_ID, CFBundleShortVersionString: '0.10.1-preview.1', ...plist }[key];
      if (value === undefined) throw new Error('no such key');
      return `${value}\n`;
    }
    if (tool === 'codesign') {
      if (codesignFails(args[args.length - 1])) throw new Error('codesign failed');
      return '';
    }
    if (tool === 'hdiutil' && args[0] === 'attach') {
      if (attachFails) throw new Error('attach failed');
      const mountPoint = args[args.indexOf('-mountpoint') + 1];
      if (source) fs.cpSync(source, path.join(mountPoint, 'Catshelf.app'), { recursive: true });
      return '';
    }
    if (tool === 'hdiutil' && args[0] === 'detach') {
      if (detachFails) throw new Error('detach failed');
      const mountPoint = args[args.length - 1];
      for (const name of fs.readdirSync(mountPoint)) fs.rmSync(path.join(mountPoint, name), { recursive: true, force: true });
      return '';
    }
    if (tool === 'ditto') {
      if (dittoFails) throw new Error('ditto failed');
      assert.equal(args[0], '--noqtn');
      fs.cpSync(args[1], args[2], { recursive: true });
      return '';
    }
    throw new Error(`unexpected tool ${file}`);
  };
  return { calls, run };
}

function setup(t, options = {}) {
  const root = makeTempDir(t, 'catshelf-update-mac-');
  const source = makeApp(path.join(root, 'dmg-contents'), options.app);
  const applications = path.join(root, 'Applications');
  fs.mkdirSync(applications);
  const target = path.join(applications, 'Catshelf.app');
  fs.mkdirSync(path.join(target, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Contents', 'old-marker'), 'old');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(workDir);
  const dmgPath = path.join(workDir, 'test-20261127-ccccccc-Catshelf-unsigned-universal.dmg');
  fs.writeFileSync(dmgPath, 'dmg');
  const tools = fakeTools({ source, ...options.tools });
  return { root, source, applications, target, workDir, dmgPath, tools };
}

function prepare(env, expected = { commit: COMMIT, notOlderThan: '0.10.1-preview.1' }) {
  return updateMac.prepareMacUpdate({
    dmgPath: env.dmgPath,
    workDir: env.workDir,
    target: env.target,
    expected,
    deps: { run: env.tools.run, token: 'token1' },
    onStage: (stage) => env.tools.calls.push(['stage', stage])
  });
}

// The installed app is never touched before the updater script runs.
function assertUntouched(env) {
  assert.equal(fs.readFileSync(path.join(env.target, 'Contents', 'old-marker'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(env.applications), ['Catshelf.app']);
  assert.deepEqual(fs.readdirSync(env.workDir).filter((name) => name.startsWith('mount-')), [], 'the mount folder is removed after detaching');
}

test('从 app.asar 里读出包记录的提交号，不运行它', (t) => {
  const root = makeTempDir(t, 'catshelf-asar-');
  const app = makeApp(root);
  assert.deepEqual(updateMac.readAppBuildInfo(app, fs), { commit: COMMIT, dirty: false });
  assert.equal(updateMac.readAsarFile(path.join(app, 'Contents', 'Resources', 'app.asar'), 'package.json', fs).toString(), '{"name":"agent-desk"}');
  assert.throws(() => updateMac.readAsarFile(path.join(app, 'Contents', 'Resources', 'app.asar'), 'missing.json', fs));
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'app.asar'), 'not an archive at all');
  assert.throws(() => updateMac.readAppBuildInfo(app, fs));
});

test('Mac 一键更新：挂载（只读、不显示）→ 校验 app → ditto --noqtn 放成隐藏的新名字 → 再校验 → 卸载；正在用的猫架一点没动', async (t) => {
  const env = setup(t);
  const prepared = await prepare(env);
  const staged = path.join(env.applications, '.Catshelf.update-token1.app');
  assert.equal(prepared.staged, staged);
  assert.equal(prepared.target, env.target);
  assert.deepEqual(prepared.checked, { bundleId: BUNDLE_ID, version: '0.10.1-preview.1', commit: COMMIT });
  assert.ok(fs.existsSync(path.join(staged, 'Contents', 'MacOS', 'Catshelf')));
  assert.equal(fs.readFileSync(path.join(env.target, 'Contents', 'old-marker'), 'utf8'), 'old');

  const mountPoint = path.join(env.workDir, 'mount-token1');
  const steps = env.tools.calls.map((call) => (call[0] === 'plutil' ? `plutil ${call[2]}` : call[0] === 'stage' ? `stage ${call[1]}` : `${call[0]} ${call[1]}`));
  assert.deepEqual(steps, [
    'stage mounting', 'hdiutil attach',
    'stage checking', 'plutil CFBundleIdentifier', 'codesign --verify', 'plutil CFBundleShortVersionString',
    'stage staging', 'ditto --noqtn',
    'plutil CFBundleIdentifier', 'codesign --verify', 'plutil CFBundleShortVersionString',
    'hdiutil detach'
  ]);
  assert.deepEqual(env.tools.calls[1], ['hdiutil', 'attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, env.dmgPath]);
  assert.deepEqual(env.tools.calls.find((call) => call[0] === 'codesign'), ['codesign', '--verify', '--deep', '--strict', path.join(mountPoint, 'Catshelf.app')]);
  assert.deepEqual(env.tools.calls.find((call) => call[0] === 'ditto'), ['ditto', '--noqtn', path.join(mountPoint, 'Catshelf.app'), staged]);
  assert.equal(fs.existsSync(mountPoint), false);
});

test('Mac 一键更新的每一种退路：挂载失败、bundle id 不符、签名不过、提交号对不上、读不出提交、版本更旧、app 不完整、复制失败、复制后校验失败——都不动 /Applications', async (t) => {
  const cases = [
    { code: 'mount-failed', tools: { attachFails: true } },
    { code: 'bundle-id-mismatch', tools: { plist: { CFBundleIdentifier: 'com.example.other' } } },
    { code: 'signature-invalid', tools: { codesignFails: () => true } },
    { code: 'commit-mismatch', app: { commit: OTHER } },
    { code: 'build-info-unreadable', app: { commit: 'not-a-commit' }, expected: { commit: COMMIT } },
    { code: 'version-mismatch', tools: { plist: { CFBundleShortVersionString: '0.9.0' } } },
    { code: 'version-mismatch', tools: { plist: { CFBundleShortVersionString: '0.10.2' } }, expected: { version: '0.10.3' } },
    { code: 'app-missing', app: { executable: false } },
    { code: 'staging-failed', tools: { dittoFails: true } },
    { code: 'signature-invalid', tools: { codesignFails: (file) => path.basename(file).startsWith('.Catshelf.update-') } }
  ];
  for (const item of cases) {
    const env = setup(t, item);
    if (item.code === 'build-info-unreadable') {
      // A record without a commit reads as null; a broken archive is unreadable.
      fs.writeFileSync(path.join(env.source, 'Contents', 'Resources', 'app.asar'), 'broken');
    }
    await assert.rejects(prepare(env, item.expected), (error) => error.code === item.code, `${item.code} ${JSON.stringify(item.tools || item.app || {})}`);
    assertUntouched(env);
    if (item.code !== 'mount-failed') assert.ok(env.tools.calls.some((call) => call[0] === 'hdiutil' && call[1] === 'detach'), `${item.code}: detached`);
    if (['bundle-id-mismatch', 'signature-invalid', 'commit-mismatch', 'version-mismatch', 'app-missing'].includes(item.code) && !item.tools?.codesignFails?.('x/.Catshelf.update-x.app')) {
      assert.equal(env.tools.calls.some((call) => call[0] === 'ditto'), false, `${item.code}: nothing copied`);
    }
  }
});

test('卸载失败时绝不删除挂载点；上次中断留下的隐藏副本会先清掉，别的东西不碰', async (t) => {
  const env = setup(t, { tools: { detachFails: true } });
  fs.mkdirSync(path.join(env.applications, '.Catshelf.update-stale.app'));
  fs.mkdirSync(path.join(env.applications, 'Other.app'));
  await prepare(env);
  assert.ok(fs.existsSync(path.join(env.workDir, 'mount-token1', 'Catshelf.app')), 'a mount point that may still be mounted is left alone');
  assert.deepEqual(fs.readdirSync(env.applications).sort(), ['.Catshelf.update-token1.app', 'Catshelf.app', 'Other.app']);
});

test('只删自己起名的副本', (t) => {
  const root = makeTempDir(t, 'catshelf-staged-');
  const target = path.join(root, 'Catshelf.app');
  const mine = path.join(root, '.Catshelf.update-x.app');
  const other = path.join(root, 'Catshelf copy.app');
  for (const dir of [target, mine, other]) fs.mkdirSync(dir);
  updateMac.removeStaged(fs, other, target);
  updateMac.removeStaged(fs, target, target);
  updateMac.removeStaged(fs, mine, target);
  assert.deepEqual(fs.readdirSync(root).sort(), ['Catshelf copy.app', 'Catshelf.app']);
});

test('替换脚本：等猫架退出、等没有进程从包里运行、校验、先改名再对换、失败放回原来的、重新打开、写结果；不碰 AI 客户端', (t) => {
  const script = updateMac.macUpdaterScript();
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(script), 'ASCII only');
  const order = [
    'while /bin/kill -0 "$PID"',
    'while /usr/bin/pgrep -f "^$TARGET/"',
    'valid "$STAGED" || fail installed-invalid',
    '/bin/mv "$TARGET" "$ROLLBACK"',
    '/bin/mv "$STAGED" "$TARGET"',
    'if ! valid "$TARGET"; then',
    'finish true installed',
    '/usr/bin/open "$TARGET"',
    '/bin/rm -rf "$ROLLBACK"'
  ];
  let at = -1;
  for (const piece of order) {
    const next = script.indexOf(piece, at + 1);
    assert.ok(next > at, `${piece} comes in order`);
    at = next;
  }
  assert.match(script, /\/usr\/bin\/codesign --verify --deep --strict "\$1"/);
  assert.match(script, /CFBundleIdentifier raw -o - "\$1\/Contents\/Info.plist".*= "com\.hupo\.agentdesk"/);
  // fail(): put the old bundle back when the target is gone, drop the copy, reopen.
  assert.match(script, /if \[ ! -e "\$TARGET" \] && \[ -d "\$ROLLBACK" \]; then \/bin\/mv "\$ROLLBACK" "\$TARGET"/);
  assert.match(script, /fail quit-timeout/);
  assert.match(script, /fail bundle-in-use/);
  assert.match(script, /fail swap-failed/);
  assert.doesNotMatch(script, /pkill|killall|kill -9|kill -TERM|osascript/, 'never stops any process');
  for (const line of script.split('\n').filter((item) => /^\s*[a-z]/.test(item) && !/^\s*(?:if|then|fi|do|done|while|finish|valid|fail|i=|PID|STAGED|TARGET|RESULT|ROLLBACK|LOG|printf|\[)/.test(item.trim()))) {
    assert.ok(!/^\s*(?:mv|rm|open|ditto|codesign|plutil|pgrep|kill|sleep|date|dirname)\b/.test(line), `absolute path for: ${line}`);
  }
  if (process.platform !== 'win32') {
    const root = makeTempDir(t, 'catshelf-script-');
    const file = path.join(root, 'apply-update.sh');
    fs.writeFileSync(file, script);
    const parsed = spawnSync('/bin/sh', ['-n', file], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
});

// The download step (src/main/updates.js) with a fake Electron net: the DMG
// whose bytes do not match GitHub's digest is deleted and never mounted.
test('下载的 DMG 和 GitHub 的 SHA-256 摘要对不上时停在下载这一步，文件删掉', async (t) => {
  const root = makeTempDir(t, 'catshelf-download-');
  delete require.cache[require.resolve('../src/main/updates')];
  const updates = require('../src/main/updates');
  const { EventEmitter } = require('node:events');
  updates.bind({
    APP_NAME: 'Catshelf',
    app: { getPath: () => root },
    t: (key) => key,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    net: {
      request() {
        const request = new EventEmitter();
        request.end = () => setImmediate(() => {
          const response = Readable.from([Buffer.from('not the real dmg')]);
          response.statusCode = 200;
          request.emit('response', response);
        });
        request.abort = () => {};
        request.followRedirect = () => {};
        return request;
      }
    }
  });
  const resolved = {
    version: null,
    tag: 'test-20261127-ccccccc',
    asset: {
      name: 'Catshelf-unsigned-universal.dmg',
      url: 'https://github.com/shuqianglin1997/catshelf/releases/download/test-20261127-ccccccc/Catshelf-unsigned-universal.dmg',
      size: Buffer.byteLength('not the real dmg'),
      sha256: 'e'.repeat(64)
    }
  };
  await assert.rejects(updates.downloadReleaseAsset(resolved, null), (error) => error.code === 'digest-mismatch');
  assert.deepEqual(fs.readdirSync(path.join(root, 'AgentDesk-updates')), []);

  resolved.asset.size = 3;
  await assert.rejects(updates.downloadReleaseAsset(resolved, null), (error) => error.code === 'size-mismatch');
});
