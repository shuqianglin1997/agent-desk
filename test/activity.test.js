// AgentDesk — 活跃度探测单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { probeActivity } = require('../src/activity');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-activity-'));
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
