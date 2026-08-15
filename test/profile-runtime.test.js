const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scanCrashpadPending,
  pruneCrashpadPending,
  pruneCrashpadPendingAsync,
  cleanCrashpadPending,
  ProfileRuntimeSupervisor
} = require('../src/profile-runtime');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-profile-runtime-'));
  const profilePath = path.join(root, 'Profile');
  const pendingPath = path.join(profilePath, 'Crashpad', 'pending');
  fs.mkdirSync(pendingPath, { recursive: true });
  return { root, profilePath, pendingPath };
}

function writeReport(pendingPath, id, size = 32, mtimeMs = Date.now()) {
  const dump = path.join(pendingPath, `${id}.dmp`);
  const sidecar = path.join(pendingPath, `${id}_sidecar.json`);
  fs.writeFileSync(dump, Buffer.alloc(size, 1));
  fs.writeFileSync(sidecar, '{"private":"not-read-by-AgentDesk"}');
  const time = new Date(mtimeMs);
  fs.utimesSync(dump, time, time);
  fs.utimesSync(sidecar, time, time);
}

test('Crashpad 扫描只统计 pending 的 dump/sidecar，不读取或触碰会话与留存样本', () => {
  const { profilePath, pendingPath } = fixture();
  writeReport(pendingPath, 'one', 64);
  fs.writeFileSync(path.join(pendingPath, 'metadata'), 'keep');
  fs.mkdirSync(path.join(profilePath, 'Crashpad', 'saved-diagnostic-20260815'));
  fs.writeFileSync(path.join(profilePath, 'Crashpad', 'saved-diagnostic-20260815', 'sample.dmp'), 'keep');
  fs.mkdirSync(path.join(profilePath, 'codex-home', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(profilePath, 'codex-home', 'sessions', 'session.jsonl'), 'keep');

  const status = scanCrashpadPending(profilePath);
  assert.equal(status.fileCount, 2);
  assert.equal(status.dumpCount, 1);
  assert.equal(status.totalBytes, 64 + Buffer.byteLength('{"private":"not-read-by-AgentDesk"}'));

  const cleaned = cleanCrashpadPending(profilePath);
  assert.equal(cleaned.removedFiles, 2);
  assert.equal(fs.existsSync(path.join(pendingPath, 'metadata')), true);
  assert.equal(fs.existsSync(path.join(profilePath, 'Crashpad', 'saved-diagnostic-20260815', 'sample.dmp')), true);
  assert.equal(fs.existsSync(path.join(profilePath, 'codex-home', 'sessions', 'session.jsonl')), true);
});

test('Crashpad 硬上限按完整事件删除最旧报告，同时满足文件数与容量', async () => {
  const { profilePath, pendingPath } = fixture();
  const now = Date.now();
  writeReport(pendingPath, 'old', 80, now - 10_000);
  writeReport(pendingPath, 'middle', 80, now - 5_000);
  writeReport(pendingPath, 'new', 80, now);

  const result = pruneCrashpadPending(profilePath, { maxFiles: 4, maxBytes: 250, now });
  assert.equal(result.fileCount <= 4, true);
  assert.equal(result.totalBytes <= 250, true);
  assert.equal(result.removedFiles, 2);
  assert.equal(fs.existsSync(path.join(pendingPath, 'old.dmp')), false);
  assert.equal(fs.existsSync(path.join(pendingPath, 'old_sidecar.json')), false);
  assert.equal(fs.existsSync(path.join(pendingPath, 'new.dmp')), true);

  const backlog = fixture();
  for (let index = 0; index < 150; index += 1) {
    writeReport(backlog.pendingPath, `backlog-${String(index).padStart(3, '0')}`, 64, now - index);
  }
  let eventLoopYielded = false;
  const yielded = new Promise((resolve) => setTimeout(() => {
    eventLoopYielded = true;
    resolve();
  }, 0));
  const pruning = pruneCrashpadPendingAsync(backlog.profilePath, {
    maxFiles: 100,
    maxBytes: 200 * 1024 * 1024,
    now
  });
  await yielded;
  assert.equal(eventLoopYielded, true);
  const boundedBacklog = await pruning;
  assert.equal(boundedBacklog.fileCount <= 100, true);
  assert.equal(boundedBacklog.totalBytes <= 200 * 1024 * 1024, true);
});

test('Crashpad 清理拒绝 pending 符号链接，不会越过 Profile 边界', (t) => {
  if (process.platform === 'win32') return t.skip('Windows symlink creation needs elevated privileges');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-profile-runtime-link-'));
  const profilePath = path.join(root, 'Profile');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(profilePath, 'Crashpad'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.dmp'), 'keep');
  fs.symlinkSync(outside, path.join(profilePath, 'Crashpad', 'pending'));

  assert.throws(() => cleanCrashpadPending(profilePath), /crashpad-path-unsafe/);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.dmp'), 'utf8'), 'keep');
});

test('相同尺寸转储一分钟内达到五次后熔断并关闭 AgentDesk 所有的 Profile', async () => {
  const { root, profilePath, pendingPath } = fixture();
  const now = Date.now();
  for (let index = 0; index < 5; index += 1) writeReport(pendingPath, `loop-${index}`, 165_168, now - index);
  const profile = { id: 'codex-profile', profilePath };
  let processes = [{
    pid: 9001,
    ppid: 1,
    pgid: 9001,
    command: `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=${profilePath} --type=browser`
  }];
  const incidents = [];
  const supervisor = new ProfileRuntimeSupervisor({
    stateFile: path.join(root, 'profile-runtime.json'),
    now: () => now,
    snapshotProcessRecords: () => processes,
    signalProcess: (pid) => { processes = processes.filter((item) => item.pid !== pid); },
    limits: { terminateGraceMs: 0, burstLimit: 5, burstWindowMs: 60_000 },
    onIncident: (incident) => incidents.push(incident)
  });
  supervisor.updateProfiles([profile]);
  supervisor.registerLaunch(profile, { pid: 9001 });
  await supervisor.tick();

  const status = supervisor.status(profile);
  assert.equal(status.fusedAt !== null, true);
  assert.equal(status.active, false);
  assert.equal(status.lastIncident.burstCount, 5);
  assert.equal(incidents.length, 1);
  assert.equal((await supervisor.preflight(profile)).reasonCode, 'profile-crashpad-fused');
});

test('重复启动同一 user-data-dir 会被识别，不会产生第二个实例', async () => {
  const { root, profilePath } = fixture();
  const profile = { id: 'existing', profilePath };
  const supervisor = new ProfileRuntimeSupervisor({
    stateFile: path.join(root, 'profile-runtime.json'),
    snapshotProcessRecords: () => [{
      pid: 99,
      ppid: 1,
      pgid: 99,
      command: `client --user-data-dir="${profilePath}" --type=renderer`
    }]
  });
  supervisor.updateProfiles([profile]);
  assert.deepEqual(await supervisor.preflight(profile), {
    ok: true,
    alreadyRunning: true,
    processCount: 1
  });
});

test('AgentDesk 启动的进程自然退出后解除所有权，不会误关后来由用户启动的同路径进程', async () => {
  const { root, profilePath } = fixture();
  const profile = { id: 'ownership-release', profilePath };
  let processes = [{
    pid: 101,
    ppid: 1,
    pgid: 101,
    command: `client --user-data-dir="${profilePath}" --type=browser`
  }];
  const supervisor = new ProfileRuntimeSupervisor({
    stateFile: path.join(root, 'profile-runtime.json'),
    snapshotProcessRecords: () => processes,
    limits: { terminateGraceMs: 0 }
  });
  supervisor.updateProfiles([profile]);
  supervisor.registerLaunch(profile, { pid: 101 });

  processes = [];
  await supervisor.tick();
  assert.equal(supervisor.status(profile).owned, false);

  processes = [{
    pid: 202,
    ppid: 1,
    pgid: 202,
    command: `client --user-data-dir="${profilePath}" --type=browser`
  }];
  assert.deepEqual(await supervisor.stopProfile(profile), {
    ok: false,
    reasonCode: 'profile-process-not-owned'
  });
});

test('安全清理会解除熔断，但不会删除 Profile 数据库或会话', async () => {
  const { root, profilePath, pendingPath } = fixture();
  const now = Date.now();
  for (let index = 0; index < 5; index += 1) writeReport(pendingPath, `fuse-${index}`, 120, now - index);
  fs.writeFileSync(path.join(profilePath, 'Cookies'), 'database');
  const profile = { id: 'clean', profilePath };
  const supervisor = new ProfileRuntimeSupervisor({
    stateFile: path.join(root, 'profile-runtime.json'),
    now: () => now,
    snapshotProcessRecords: () => [],
    limits: { terminateGraceMs: 0 }
  });
  supervisor.updateProfiles([profile]);
  await supervisor.tick();
  assert.equal(supervisor.status(profile).fusedAt !== null, true);

  const cleaned = await supervisor.cleanCrashpad(profile);
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.removedFiles, 10);
  assert.equal(cleaned.runtime.fusedAt, null);
  assert.equal(fs.readFileSync(path.join(profilePath, 'Cookies'), 'utf8'), 'database');
  assert.deepEqual(await supervisor.preflight(profile), { ok: true, alreadyRunning: false });
});
