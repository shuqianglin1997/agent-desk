// A session store that exists but cannot be read is a failure, not "no
// sessions"; a walk that stops at its entry limit says so. Both travel as
// data (src/core/result.js); showing them to the person is later work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const apps = require('../src/apps');
const { probeActivities } = require('../src/activity');
const { execute, InterfaceError } = require('../src/automation/service');
const { makeTempDir } = require('./helpers/temp');

function tempDir(t) {
  const dir = fs.realpathSync(makeTempDir('agentdesk-scan-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a Cursor database that cannot be read is a failure, a missing one is empty', (t) => {
  const root = tempDir(t);
  const profile = { id: 'cursor', appId: 'cursor', sessionRoot: root, profilePath: root };
  assert.deepEqual(apps.scanResult(profile), { truncated: false, ok: true, value: [] });
  const db = path.join(root, 'User', 'globalStorage', 'state.vscdb');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.writeFileSync(db, 'this is not a sqlite database');
  const result = apps.scanResult(profile);
  assert.equal(result.ok, false);
  assert.match(result.code, /^sqlite-(?:unavailable|query-failed)$|^session-store-unreadable$/);
  assert.throws(() => apps.getApp('cursor').scan(profile), (error) => typeof error.code === 'string');
});

test('a Kimi Work index that cannot be read is a failure', (t) => {
  const root = tempDir(t);
  const db = path.join(root, 'agents', 'main', 'sessions', 'hosted-logical', 'conversations.sqlite');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.writeFileSync(db, 'not sqlite');
  const result = apps.scanResult({ id: 'kw', appId: 'kimi-work', sessionRoot: root, profilePath: root });
  assert.equal(result.ok, false);
});

test('the CLI reports an unreadable session store instead of an empty list', (t) => {
  const root = tempDir(t);
  const userData = path.join(root, 'AgentDesk');
  const home = path.join(root, 'cursor');
  const db = path.join(home, 'User', 'globalStorage', 'state.vscdb');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.mkdirSync(userData);
  fs.writeFileSync(db, 'not sqlite');
  fs.writeFileSync(path.join(userData, 'profiles.json'), JSON.stringify({ version: 2, profiles: [{ id: 'c', appId: 'cursor', profilePath: home, sessionRoot: home }] }));
  assert.throws(() => execute('sessions list', { 'user-data': userData, profile: 'c' }),
    (error) => error instanceof InterfaceError && error.code === 'session-store-unreadable');
});

test('a walk that stops at the entry limit reports truncation, in the scan and in activity', (t) => {
  const root = tempDir(t);
  // The walk checks its limit between folders and reads the last-listed folder
  // first; 'c' alone exceeds the limit, so 'a' (with a session) is never read.
  const sessions = path.join(root, 'sessions');
  for (const dir of ['a', 'b', 'c']) fs.mkdirSync(path.join(sessions, dir), { recursive: true });
  const id = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(sessions, 'a', `rollout-2026-11-24T10-00-00-${id}.jsonl`), JSON.stringify({ timestamp: '2026-11-24T10:00:00Z', type: 'session_meta', payload: { id, cwd: '/w' } }) + '\n');
  for (let i = 0; i < 12001; i++) fs.writeFileSync(path.join(sessions, 'c', `f${i}.txt`), '');
  const profile = { id: 'codex', appId: 'codex', sessionRoot: root, profilePath: root };
  const result = apps.scanResult(profile);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  const [activity] = probeActivities([profile], Date.parse('2026-11-24T12:00:00Z'), null);
  assert.equal(activity.truncated, true);
  const small = { id: 'small', appId: 'codex', sessionRoot: tempDir(t), profilePath: root };
  assert.equal(apps.scanResult(small).truncated, false);
  assert.equal(probeActivities([small], Date.now(), null)[0].truncated, false);
});
