// AgentDesk — session scanner tests (node:test, zero deps).
// Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanSessions, claudeActivityFromFile, codexActivityFromFile, parseDate, cleanTitle, uuidFromFilename } = require('../src/sessions');

// ── pure helpers ──────────────────────────────────────
test('parseDate: unix seconds → ISO', () => {
  assert.equal(parseDate(1700000000), new Date(1700000000000).toISOString());
});
test('parseDate: unix milliseconds → ISO', () => {
  assert.equal(parseDate(1700000000000), new Date(1700000000000).toISOString());
});
test('parseDate: ISO string passes through', () => {
  assert.equal(parseDate('2026-07-13T10:00:00.000Z'), '2026-07-13T10:00:00.000Z');
});
test('parseDate: numeric string → ISO', () => {
  assert.equal(parseDate('1700000000'), new Date(1700000000000).toISOString());
});
test('parseDate: invalid / empty → null', () => {
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
});
test('cleanTitle trims and nullifies blanks', () => {
  assert.equal(cleanTitle('  hi  '), 'hi');
  assert.equal(cleanTitle('   '), null);
  assert.equal(cleanTitle(null), null);
});
test('uuidFromFilename extracts the codex rollout uuid', () => {
  assert.equal(
    uuidFromFilename('/x/rollout-2026-07-13T14-52-41-019f5a3f-d8b5-7551-88d5-01cb0bb1d96f.jsonl'),
    '019f5a3f-d8b5-7551-88d5-01cb0bb1d96f'
  );
});

// ── fixture-based scanners ────────────────────────────
function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-test-'));
}

test('scanClaude reads title / cwd / dates from local_*.json', () => {
  const root = mkTmp();
  const dir = path.join(root, 'claude-code-sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local_abc.json'), JSON.stringify({
    sessionId: 'abc123',
    title: 'Fix the scanner',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastActivityAt: '2026-07-02T00:00:00.000Z',
    cwd: '/Users/x/proj',
    model: 'opus'
  }));
  const recs = scanSessions({ appId: 'claude', sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, 'Fix the scanner');
  assert.equal(recs[0].projectPath, '/Users/x/proj');
  assert.equal(recs[0].updatedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(recs[0].status, '可用');
  assert.equal(recs[0].address, 'abc123');
  fs.rmSync(root, { recursive: true, force: true });
});

// Regression: Codex indexes session_index.jsonl by session_id, which differs
// from payload.id for most rollouts. Keying the lookup by payload.id (the old
// bug) dropped ~70% of titles to a placeholder.
test('scanCodex resolves title via session_index keyed by session_id', () => {
  const root = mkTmp();
  const sdir = path.join(root, 'sessions');
  fs.mkdirSync(sdir, { recursive: true });
  const meta = {
    timestamp: '2026-07-10T00:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'rollout-id-111', session_id: 'thread-sid-999', cwd: '/Users/x/w', model_provider: 'openai' }
  };
  fs.writeFileSync(path.join(sdir, 'rollout-2026-07-10T00-00-00-thread-sid-999.jsonl'), JSON.stringify(meta) + '\n');
  fs.writeFileSync(
    path.join(root, 'session_index.jsonl'),
    JSON.stringify({ id: 'thread-sid-999', thread_name: 'My Codex thread', updated_at: '2026-07-11T00:00:00.000Z' }) + '\n'
  );
  const recs = scanSessions({ appId: 'codex', sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, 'My Codex thread'); // fallback placeholder if the bug regresses
  assert.equal(recs[0].updatedAt, '2026-07-11T00:00:00.000Z');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scanCodex falls back to a placeholder title when unindexed', () => {
  const root = mkTmp();
  const sdir = path.join(root, 'sessions');
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(
    path.join(sdir, 'rollout-x-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
    JSON.stringify({ timestamp: '2026-07-10T00:00:00.000Z', type: 'session_meta', payload: { id: 'i1', session_id: 's1', cwd: '/w' } }) + '\n'
  );
  const recs = scanSessions({ appId: 'codex', sessionRoot: root });
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /^Codex 会话 /);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scanners tolerate missing dirs and malformed files', () => {
  const root = mkTmp();
  const dir = path.join(root, 'claude-code-sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local_bad.json'), '{ not valid json');
  assert.doesNotThrow(() => scanSessions({ appId: 'claude', sessionRoot: root }));
  assert.deepEqual(scanSessions({ appId: 'claude', sessionRoot: path.join(root, 'does-not-exist') }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('records are sorted most-recently-active first', () => {
  const root = mkTmp();
  const dir = path.join(root, 'claude-code-sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local_old.json'), JSON.stringify({ sessionId: 'old', title: 'old', lastActivityAt: '2026-01-01T00:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, 'local_new.json'), JSON.stringify({ sessionId: 'new', title: 'new', lastActivityAt: '2026-07-01T00:00:00.000Z' }));
  const recs = scanSessions({ appId: 'claude', sessionRoot: root });
  assert.equal(recs[0].title, 'new');
  assert.equal(recs[1].title, 'old');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── 会话记录最后活跃时间戳（驱动猫的干活/在岗）──
test('claudeActivityFromFile: 读 lastActivityAt（毫秒 epoch）→ 毫秒', () => {
  const root = mkTmp();
  const fp = path.join(root, 'local_x.json');
  fs.writeFileSync(fp, JSON.stringify({ lastActivityAt: 1784166156219 }));
  assert.equal(claudeActivityFromFile(fp), 1784166156219);
  fs.rmSync(root, { recursive: true, force: true });
});
test('claudeActivityFromFile: 兼容 ISO 字符串 / 缺字段 / 空路径 → 毫秒或 null', () => {
  const root = mkTmp();
  const fp = path.join(root, 'local_y.json');
  fs.writeFileSync(fp, JSON.stringify({ lastActivityAt: '2026-07-13T10:00:00.000Z' }));
  assert.equal(claudeActivityFromFile(fp), Date.parse('2026-07-13T10:00:00.000Z'));
  const fp2 = path.join(root, 'local_z.json');
  fs.writeFileSync(fp2, JSON.stringify({ title: 'no ts' }));
  assert.equal(claudeActivityFromFile(fp2), null);
  assert.equal(claudeActivityFromFile(null), null);
  assert.equal(claudeActivityFromFile(path.join(root, 'nope.json')), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('codexActivityFromFile: 取末行事件 timestamp（毫秒）', () => {
  const root = mkTmp();
  const fp = path.join(root, 'r.jsonl');
  fs.writeFileSync(fp,
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-15T16:13:06.000Z' }) + '\n' +
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-15T20:55:24.000Z' }) + '\n');
  assert.equal(codexActivityFromFile(fp), Date.parse('2026-07-15T20:55:24.000Z'));
  fs.rmSync(root, { recursive: true, force: true });
});
test('codexActivityFromFile: 大文件也只读末尾 64KB，仍取到末行事件', () => {
  const root = mkTmp();
  const fp = path.join(root, 'big.jsonl');
  const huge = JSON.stringify({ type: 'pad', blob: 'x'.repeat(100 * 1024), timestamp: '2000-01-01T00:00:00.000Z' });
  fs.writeFileSync(fp, huge + '\n' + JSON.stringify({ type: 'event_msg', timestamp: '2026-07-16T01:00:00.000Z' }) + '\n');
  assert.equal(codexActivityFromFile(fp), Date.parse('2026-07-16T01:00:00.000Z'));
  fs.rmSync(root, { recursive: true, force: true });
});
test('codexActivityFromFile: 末行是半截 JSON → 回退到上一条完整事件', () => {
  const root = mkTmp();
  const fp = path.join(root, 'partial.jsonl');
  fs.writeFileSync(fp,
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-16T02:00:00.000Z' }) + '\n' +
    '{"type":"event_msg","timestamp":"2026-07-16T03:00:00'); // 被截断、无换行
  assert.equal(codexActivityFromFile(fp), Date.parse('2026-07-16T02:00:00.000Z'));
  fs.rmSync(root, { recursive: true, force: true });
});
test('codexActivityFromFile: 空文件 / 空路径 → null，不抛', () => {
  const root = mkTmp();
  const fp = path.join(root, 'empty.jsonl');
  fs.writeFileSync(fp, '');
  assert.equal(codexActivityFromFile(fp), null);
  assert.equal(codexActivityFromFile(null), null);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── real-data smoke (skipped when local dirs aren't present, e.g. CI) ──
const codexHome = path.join(os.homedir(), '.codex');
test('real Codex data scans cleanly and resolves most titles', {
  skip: !fs.existsSync(path.join(codexHome, 'session_index.jsonl'))
}, () => {
  const recs = scanSessions({ appId: 'codex', sessionRoot: codexHome });
  assert.ok(recs.length > 0, 'expected some sessions');
  const real = recs.filter((r) => r.title && !/^Codex 会话 /.test(r.title)).length;
  const ratio = real / recs.length;
  assert.ok(ratio > 0.8, `expected >80% resolved titles, got ${Math.round(ratio * 100)}%`);
});
