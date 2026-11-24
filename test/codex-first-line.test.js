// A Codex rollout's first line (session_meta) can exceed 64 KB when it embeds
// long instructions. Its identity, title and project must still be read, an
// internal child must still be recognised, and the file is always closed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sessions = require('../src/clients/codex/sessions');

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const big = 'x'.repeat(100 * 1024);

function rollout(dir, id, payload, minutes) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-11-24T10-00-00-${id}.jsonl`);
  const at = new Date(Date.parse('2026-11-24T12:00:00Z') - minutes * 60000).toISOString();
  fs.writeFileSync(file, [
    JSON.stringify({ timestamp: at, type: 'session_meta', payload: { id, ...payload, base_instructions: { text: big } } }),
    JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'task_complete' } })
  ].join('\n') + '\n');
  return file;
}

test('a session_meta line over 64 KB keeps its identity, title and project; its child stays internal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-bigmeta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const day = path.join(root, 'sessions', '2026', '11', '24');
  rollout(day, ROOT_ID, { session_id: ROOT_ID, cwd: '/work/big' }, 5);
  rollout(day, CHILD_ID, { session_id: ROOT_ID, parent_thread_id: ROOT_ID, thread_source: 'subagent' }, 4);
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: ROOT_ID, thread_name: 'Big instructions', updated_at: '2026-11-24T11:55:00Z' }) + '\n');
  const rows = sessions.scanCodex({ sessionRoot: root });
  assert.deepEqual(rows.map((row) => [row.id, row.title, row.projectPath]), [[ROOT_ID, 'Big instructions', '/work/big']]);
});

test('reading the first line closes the file even when the read fails', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-fd-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = rollout(path.join(root, 'sessions'), ROOT_ID, { session_id: ROOT_ID, cwd: '/work/fd' }, 5);
  const opened = new Set();
  const { openSync, closeSync, readSync } = fs;
  t.after(() => Object.assign(fs, { openSync, closeSync, readSync }));
  fs.openSync = (...args) => { const fd = openSync(...args); if (args[0] === file) opened.add(fd); return fd; };
  fs.closeSync = (fd) => { opened.delete(fd); return closeSync(fd); };
  fs.readSync = (fd, ...rest) => {
    if (opened.has(fd)) { const error = new Error('EIO: i/o error, read'); error.code = 'EIO'; throw error; }
    return readSync(fd, ...rest);
  };
  const result = sessions.codexRecordIdentity(file);
  assert.equal(result.first, null);
  assert.equal(opened.size, 0, 'every descriptor opened for the rollout was closed');
});
