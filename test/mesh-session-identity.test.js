const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanCodex } = require('../src/sessions');
const { classifyCodexSessionMeta } = require('../src/mesh/domain/session-identity');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-mesh-session-'));
}

function writeJsonl(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function sessionMeta(payload, timestamp = '2026-08-10T00:00:00.000Z') {
  return { timestamp, type: 'session_meta', payload };
}

test('classifyCodexSessionMeta separates physical rollout and logical conversation identities', () => {
  assert.deepEqual(
    classifyCodexSessionMeta({ id: 'physical-root', session_id: 'conversation-root' }),
    {
      recordKind: 'conversation-root',
      physicalRecordId: 'physical-root',
      adapterConversationKey: 'conversation-root',
      parentConversationKey: null
    }
  );

  assert.deepEqual(
    classifyCodexSessionMeta({
      id: 'physical-child',
      session_id: 'conversation-root',
      parent_thread_id: 'conversation-root',
      thread_source: 'subagent',
      source: { subagent: { other: 'guardian' } }
    }),
    {
      recordKind: 'internal-child',
      physicalRecordId: 'physical-child',
      adapterConversationKey: 'conversation-root',
      parentConversationKey: 'conversation-root'
    }
  );
});

test('Codex compression events and guardian rollout remain one visible conversation', (t) => {
  const root = mkTmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeJsonl(path.join(root, 'sessions', 'root.jsonl'), [
    sessionMeta({ id: 'physical-root', session_id: 'conversation-root', cwd: '/work/project' }),
    { timestamp: '2026-08-10T00:01:00.000Z', type: 'compacted', payload: { summary: 'internal' } },
    { timestamp: '2026-08-10T00:02:00.000Z', type: 'context_compacted', payload: { summary: 'internal again' } }
  ]);
  writeJsonl(path.join(root, 'sessions', 'guardian.jsonl'), [
    sessionMeta({
      id: 'physical-guardian',
      session_id: 'conversation-root',
      parent_thread_id: 'conversation-root',
      thread_source: 'subagent',
      source: { subagent: { other: 'guardian' } },
      cwd: '/work/project'
    })
  ]);

  const records = scanCodex({ sessionRoot: root });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'conversation-root');
  assert.equal(records[0].address, 'conversation-root');
  assert.equal(records[0].adapterConversationKey, 'conversation-root');
  assert.equal(records[0].physicalRecordId, 'physical-root');
  assert.equal(records[0].recordKind, 'conversation-root');
  assert.equal(records[0].internalBranchCount, 1);
});

test('all Codex internal-child signals stay hidden, including orphan children', (t) => {
  const root = mkTmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeJsonl(path.join(root, 'sessions', 'by-parent.jsonl'), [
    sessionMeta({ id: 'child-parent', parent_thread_id: 'missing-parent' })
  ]);
  writeJsonl(path.join(root, 'sessions', 'by-thread-source.jsonl'), [
    sessionMeta({ id: 'child-source', session_id: 'missing-parent', thread_source: 'subagent' })
  ]);
  writeJsonl(path.join(root, 'sessions', 'by-source-object.jsonl'), [
    sessionMeta({ id: 'child-object', session_id: 'missing-parent', source: { subagent: { other: 'guardian' } } })
  ]);

  assert.deepEqual(scanCodex({ sessionRoot: root }), []);
});

test('active and archived Codex roots dedupe by session_id, not physical rollout id', (t) => {
  const root = mkTmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const activePath = path.join(root, 'sessions', 'active.jsonl');
  const archivedPath = path.join(root, 'archived_sessions', 'archived.jsonl');

  writeJsonl(activePath, [
    sessionMeta({ id: 'physical-active', session_id: 'same-conversation', cwd: '/work/project' })
  ]);
  writeJsonl(archivedPath, [
    sessionMeta({ id: 'physical-archived', session_id: 'same-conversation', cwd: '/work/project' })
  ]);
  writeJsonl(path.join(root, 'session_index.jsonl'), [
    { id: 'same-conversation', thread_name: 'Stable title', updated_at: '2026-08-10T03:00:00.000Z' }
  ]);
  fs.utimesSync(activePath, new Date('2026-08-10T01:00:00.000Z'), new Date('2026-08-10T01:00:00.000Z'));
  fs.utimesSync(archivedPath, new Date('2026-08-10T02:00:00.000Z'), new Date('2026-08-10T02:00:00.000Z'));

  const records = scanCodex({ sessionRoot: root });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'same-conversation');
  assert.equal(records[0].address, 'same-conversation');
  assert.equal(records[0].physicalRecordId, 'physical-archived');
  assert.equal(records[0].status, '已归档');
  assert.equal(records[0].lifecycleConflict, true);
});
