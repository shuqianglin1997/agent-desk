const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererFunction } = require('./helpers/renderer-source');
const { loadPreload, runCommand, page } = require('./helpers/behaviour');
const { normalizeSettings } = require('../src/settings');
const { DEFAULT_LIMITS, pruneCrashpadPending } = require('../src/profile-runtime');
const { makeTempDir } = require('./helpers/temp');

test('退出时关闭启动过的客户端是默认；只认 close 和 keep 两种', () => {
  assert.equal(normalizeSettings({}).profileQuitBehavior, 'close');
  assert.equal(normalizeSettings({ profileQuitBehavior: 'keep' }).profileQuitBehavior, 'keep');
  assert.equal(normalizeSettings({ profileQuitBehavior: 'kill' }).profileQuitBehavior, 'close');

  const doc = page();
  const select = doc.byId('profileQuitBehavior');
  assert.equal(select.tag, 'select');
  assert.deepEqual(doc.children(select).map((option) => option.attrs.value), ['close', 'keep']);
  const stop = doc.byId('stopProfileBtn'); const clean = doc.byId('cleanCrashpadBtn');
  assert.ok(stop && clean && doc.index(stop) < doc.index(clean), 'stop comes before clean');
});

test('停止与清理只把位置的标识交给主进程，主进程自己查表', async () => {
  const { api, calls } = loadPreload();
  await api.stopProfile('p1');
  await api.cleanProfileCrashpad('p1');
  assert.deepEqual(calls, [['invoke', 'profiles:stop', 'p1'], ['invoke', 'profiles:cleanCrashpad', 'p1']]);

  const cleaned = [];
  const deps = {
    boundedText: (value, max) => (typeof value === 'string' ? value.slice(0, max) : ''),
    loadProfiles: () => [{ id: 'p1', profilePath: '/x' }],
    getProfileRuntimeSupervisor: () => ({ cleanCrashpad: async (profile) => { cleaned.push(profile.id); if (profile.id === 'p1') return { ok: true }; throw new Error('x'); } })
  };
  assert.deepEqual(await runCommand('profiles:cleanCrashpad', deps, 'p1'), { ok: true });
  assert.deepEqual(await runCommand('profiles:cleanCrashpad', deps, 'missing'), { ok: false, reasonCode: 'profile-not-found' });
  assert.deepEqual(cleaned, ['p1']);
});

test('崩溃报告：最多 100 个、200 MiB，5 个同尺寸算风暴；清理只碰 Crashpad/pending 里的转储', (t) => {
  assert.equal(DEFAULT_LIMITS.maxFiles, 100);
  assert.equal(DEFAULT_LIMITS.maxBytes, 200 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.burstLimit, 5);

  const dir = makeTempDir('agentdesk-crashpad-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pending = path.join(dir, 'Crashpad', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  for (let i = 0; i < 4; i += 1) {
    fs.writeFileSync(path.join(pending, `dump${i}.dmp`), 'x'.repeat(100));
    fs.writeFileSync(path.join(pending, `dump${i}_sidecar.json`), '{}');
  }
  const kept = { 'sessions/a.jsonl': 's', 'codex-home/config.toml': 'c', 'state.sqlite': 'q', 'Crashpad/pending/notes.txt': 'n' };
  for (const [file, body] of Object.entries(kept)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), body); }
  pruneCrashpadPending(dir, { maxFiles: 2, maxBytes: 1_000_000, now: Date.now() });
  const dumps = fs.readdirSync(pending).filter((f) => f.endsWith('.dmp'));
  assert.ok(dumps.length < 4, 'old dumps were pruned');
  for (const [file, body] of Object.entries(kept)) assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), body, `${file} untouched`);
});

// No Node equivalent: the select and the confirm live in the renderer (no DOM
// in Node), and quitting goes through Electron's app object. Each check is
// held to one function, not the whole source.
test('界面记住退出方式、清理前先确认；退出时停下受管客户端', () => {
  assert.match(rendererFunction('bindSettingsEvents'), /persistSettings\(\{ profileQuitBehavior: state\.profileQuitBehavior \}\)/);
  assert.match(rendererFunction('bindAgentManageEvents'), /window\.confirm\(tr\('status\.cleanCrashpadConfirm'/);
  const main = mainHandlerSource();
  assert.match(main, /app\.on\('before-quit'[\s\S]*?stopAll\(\{[\s\S]*?terminateOwned: true/);
  // A launch is registered as AgentDesk's own, with the app version it started from.
  assert.match(main, /runtimeSupervisor\.registerLaunch\(profile, \{ \.\.\.launched, \.\.\.from \}\)/);
});
