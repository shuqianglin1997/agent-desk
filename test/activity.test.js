// AgentDesk — 活跃度探测单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { probeActivity } = require('../src/activity');
const { makeTempDir } = require('./helpers/temp');

function mkTmp() {
  return makeTempDir('agentdesk-activity-');
}

test('根目录不存在：rootExists=false，不抛错', () => {
  const result = probeActivity({ id: 'x', appId: 'claude', sessionRoot: path.join(mkTmp(), 'missing') });
  assert.equal(result.rootExists, false);
  assert.equal(result.latestMtime, null);
  assert.equal(result.fileCount, 0);
});

test('claude：统计 local_*.json 的数量与最新 mtime', () => {
  const root = mkTmp();
  const dir = path.join(root, 'claude-code-sessions');
  fs.mkdirSync(dir, { recursive: true });
  const oldFile = path.join(dir, 'local_old.json');
  const newFile = path.join(dir, 'local_new.json');
  fs.writeFileSync(oldFile, '{}');
  fs.writeFileSync(newFile, '{}');
  const past = new Date(Date.now() - 3600e3);
  fs.utimesSync(oldFile, past, past);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored'); // 非会话文件不计入

  const result = probeActivity({ id: 'x', appId: 'claude', sessionRoot: root });
  assert.equal(result.rootExists, true);
  assert.equal(result.rootReadable, true);
  assert.equal(result.fileCount, 2);
  assert.ok(Math.abs(result.latestMtime - fs.statSync(newFile).mtime.getTime()) < 1000);
});

test('codex：扫 sessions 与 archived_sessions 下的 .jsonl', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'sessions', '2026'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archived_sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', '2026', 'rollout-a.jsonl'), '{}');
  fs.writeFileSync(path.join(root, 'archived_sessions', 'rollout-b.jsonl'), '{}');

  const result = probeActivity({ id: 'x', appId: 'codex', sessionRoot: root });
  assert.equal(result.fileCount, 2);
  assert.ok(result.latestMtime > 0);
});

const { scanCodex } = require('../src/clients/codex/sessions');
const { probeActivities } = require('../src/activity');
const { mergeActivity } = require('../src/identity-groups');

test('Codex activity shares logical root identity with the session list and ignores internal orphans', (t) => {
  const root = mkTmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  function write(dir, name, payload, age = 0) {
    const folder = path.join(root, dir); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, name + '.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', timestamp: new Date(now - 86400000).toISOString(), payload }) + '\n');
    fs.utimesSync(file, new Date(now - age), new Date(now - age));
    return file;
  }
  const file = write('sessions', 'root', { id: 'physical-root', session_id: 'root' }, 1000);
  write('sessions', 'guardian', { id: 'child', session_id: 'root', parent_thread_id: 'root' });
  write('sessions', 'orphan', { id: 'orphan', thread_source: 'subagent', session_id: 'missing' });
  const profile = { id: 'a', appId: 'codex', sessionRoot: root };
  assert.equal(scanCodex(profile).length, 1);
  let result = probeActivity(profile, now);
  assert.equal(result.sessionCount, 1); assert.equal(result.fileCount, 3);
  assert.equal(result.activeToday, 1); assert.equal(result.activeNow, 1); assert.equal(result.createdToday, 0);
  write('archived_sessions', 'copy', { id: 'copy', session_id: 'root' });
  result = probeActivity(profile, now);
  assert.equal(result.sessionCount, 1); assert.equal(result.activeToday, 1); assert.equal(result.activeNow, 0);
  // Metadata changes invalidate the cache; a former root cannot survive as a phantom row.
  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'changed', thread_source: 'subagent' } }));
  fs.rmSync(path.join(root, 'archived_sessions'), { recursive: true });
  assert.equal(probeActivity(profile, now).sessionCount, 0);
});

test('shared real roots and symlink aliases count once; distinct roots and device scopes stay independent', (t) => {
  const root = mkTmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(path.join(source, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sessions', 'a.jsonl'), JSON.stringify({ payload: { id: 'same-id' } }));
  const alias = path.join(root, 'alias'); fs.symlinkSync(source, alias, 'junction');
  const other = path.join(root, 'other'); fs.cpSync(source, other, { recursive: true });
  const profiles = [source, source, alias, other].map((sessionRoot, i) => ({ id: String(i), appId: 'codex', sessionRoot }));
  const activities = probeActivities(profiles);
  assert.deepEqual(activities.map(a => a.profileId), ['0', '1', '2', '3']);
  assert.equal(activities[0].sourceKey, activities[2].sourceKey);
  assert.notEqual(activities[0].sourceKey, activities[3].sourceKey);
  assert.equal(mergeActivity(activities.slice(0, 3)).activeNow, 1);
  assert.equal(mergeActivity(activities).activeNow, 2);
  assert.equal(mergeActivity(activities.slice(0, 2).map((a, i) => ({ ...a, deviceId: String(i) }))).activeNow, 2);
  assert.equal(mergeActivity([{ activeNow: 1 }, { activeNow: 1 }]).activeNow, 2);
});


test('tied Codex active/archive revisions follow the same content/index lifecycle rule as the list', (t) => {
  const root = mkTmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const profile = { id: 'a', appId: 'codex', sessionRoot: root };
  const files = ['sessions', 'archived_sessions'].map((area, i) => {
    fs.mkdirSync(path.join(root, area));
    const file = path.join(root, area, 'root.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', timestamp: new Date(now - 10000 + i * 1000).toISOString(), payload: { id: 'root' } }) + '\n');
    fs.utimesSync(file, new Date(now), new Date(now));
    return file;
  });
  assert.equal(scanCodex(profile)[0].status, '已归档');
  assert.equal(probeActivity(profile, now).activeNow, 0);
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: 'root', updated_at: new Date(now).toISOString() }) + '\n');
  assert.equal(scanCodex(profile)[0].status, '可用');
  assert.equal(probeActivity(profile, now).activeNow, 1);
  fs.copyFileSync(files[0], files[1]);
  fs.utimesSync(files[1], new Date(now), new Date(now));
  assert.equal(scanCodex(profile)[0].status, '可用');
  assert.equal(probeActivity(profile, now).activeNow, 1);
});

test('the session count Main reports with activity is the session index count', (t) => {
  const { finishActivities, probeRawActivities } = require('../src/activity');
  const root = makeTempDir('agentdesk-activity-count-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'projects', '-w');
  fs.mkdirSync(dir, { recursive: true });
  const line = (extra) => JSON.stringify({ type: 'user', timestamp: '2026-11-24T10:00:00.000Z', cwd: '/w', message: { role: 'user', content: 'hi' }, ...extra });
  fs.writeFileSync(path.join(dir, '11111111-1111-4111-8111-111111111111.jsonl'), line({}) + '\n');
  // A sub-agent record: the list leaves it out, the file walk sees it.
  fs.writeFileSync(path.join(dir, '22222222-2222-4222-8222-222222222222.jsonl'), line({ isSidechain: true }) + '\n');
  const profile = { id: 'p', appId: 'claude-cli', sessionRoot: root };
  const rows = require('../src/apps').getApp('claude-cli').scan(profile);
  assert.equal(rows.length, 1);
  const raws = probeRawActivities([profile], Date.now(), 0);
  assert.equal(raws[0].sessionCount, 2, 'the walk alone counts the sub-agent file');
  const [withIndex] = finishActivities([profile], raws, null, { sessionCountOf: () => rows.length });
  assert.equal(withIndex.sessionCount, 1, 'with the index the counts agree');
  const [withoutEntry] = finishActivities([profile], raws, null, { sessionCountOf: () => null });
  assert.equal(withoutEntry.sessionCount, 2, 'a profile the index has not read keeps the walk count');
});
