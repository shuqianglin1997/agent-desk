'use strict';

// Synthetic session data for the architecture timing harness: by default
// 10 accounts × 500 sessions across six clients, written only inside a
// directory under the system temp folder (never a real userData or home).
// File sizes follow the real read bounds: Claude CLI files are large enough
// for the full 256 KB head + 64 KB tail read, Codex rollouts exceed the 64 KB
// tail window. Timestamps are derived from `now`, so output is deterministic
// for a fixed `now`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIX = ['claude-cli', 'codex', 'claude-cli', 'codex', 'claude-cli', 'codex', 'claude', 'kimi', 'gemini-cli', 'qwen-code'];
const TARGET_BYTES = { 'claude-cli': 336 * 1024, codex: 136 * 1024, claude: 3 * 1024, kimi: 2 * 1024, 'gemini-cli': 48 * 1024, 'qwen-code': 48 * 1024 };

function assertTempRoot(root) {
  const tmp = fs.realpathSync(os.tmpdir());
  const target = path.resolve(root);
  fs.mkdirSync(target, { recursive: true });
  const real = fs.realpathSync(target);
  if (real !== tmp && !real.startsWith(tmp + path.sep)) throw new Error('arch-fixtures-root-outside-temp');
  return real;
}

function uuid(account, index, salt = 0) {
  const hex = (n, width) => n.toString(16).padStart(width, '0').slice(-width);
  return `${hex(account + 0xa0, 8)}-${hex(index, 4)}-4${hex(salt, 3)}-8${hex(account * 7 + index, 3)}-${hex(index * 7919 + salt, 12)}`;
}

function padLines(target, make) {
  const lines = [];
  let size = 0;
  for (let i = 0; size < target; i++) {
    const line = make(i);
    lines.push(line);
    size += Buffer.byteLength(line) + 1;
  }
  return lines;
}

const FILLER = 'Synthetic work log line for the AgentDesk timing harness. '.repeat(18);

function write(file, body, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const seconds = mtimeMs / 1000;
  fs.utimesSync(file, seconds, seconds);
  return Buffer.byteLength(body);
}

// Session i of an account was last active `minutesAgo(i)` minutes before now:
// the first two are still being written (within 90 s), then spread over weeks.
function minutesAgo(i) { return i < 2 ? 0.5 : i < 6 ? 3 + i : 30 * i; }

function claudeCliAccount(dir, account, count, now, scale) {
  let bytes = 0;
  for (let i = 0; i < count; i++) {
    const id = uuid(account, i);
    const project = path.join(dir, 'work', `project-${i % 12}`);
    const at = now - minutesAgo(i) * 60000;
    const start = new Date(at - 3600000).toISOString();
    const head = [
      JSON.stringify({ type: 'summary', summary: `Synthetic task ${account}-${i}` }),
      JSON.stringify({ type: 'user', timestamp: start, cwd: project, sessionId: id, message: { role: 'user', content: `Please work on synthetic task ${i}` } })
    ];
    const middle = padLines(TARGET_BYTES['claude-cli'] * scale, (n) => JSON.stringify({
      type: 'assistant', timestamp: start, sessionId: id, message: { role: 'assistant', content: [{ type: 'text', text: `${n} ${FILLER}` }], stop_reason: 'tool_use' }
    }));
    const tail = [
      JSON.stringify({ type: 'ai-title', aiTitle: `Synthetic Claude CLI session ${account}-${i}` }),
      JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), sessionId: id, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } })
    ];
    bytes += write(path.join(dir, 'projects', `-work-project-${i % 12}`, `${id}.jsonl`), [...head, ...middle, ...tail].join('\n') + '\n', at);
  }
  return bytes;
}

function codexAccount(dir, account, count, now, scale) {
  let bytes = 0;
  const index = [];
  for (let i = 0; i < count; i++) {
    const id = uuid(account, i);
    const at = now - minutesAgo(i) * 60000;
    const day = new Date(at);
    const stamp = day.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archived = i % 10 === 9;
    const area = archived ? path.join(dir, 'archived_sessions') : path.join(dir, 'sessions', String(day.getUTCFullYear()), String(day.getUTCMonth() + 1).padStart(2, '0'), String(day.getUTCDate()).padStart(2, '0'));
    const meta = { timestamp: new Date(at - 3600000).toISOString(), type: 'session_meta', payload: { id, session_id: id, cwd: path.join(dir, 'work', `project-${i % 12}`), originator: 'codex_cli_rs' } };
    const body = padLines(TARGET_BYTES.codex * scale, (n) => JSON.stringify({ timestamp: meta.timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${n} ${FILLER}` }] } }));
    const end = [
      JSON.stringify({ timestamp: new Date(at - 1000).toISOString(), type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } }),
      JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'task_complete' } })
    ];
    bytes += write(path.join(area, `rollout-${stamp}-${id}.jsonl`), [JSON.stringify(meta), ...body, ...end].join('\n') + '\n', at);
    index.push(JSON.stringify({ id, thread_name: `Synthetic Codex session ${account}-${i}`, updated_at: new Date(at).toISOString() }));
    if (i % 5 === 0) {
      // One guardian/subagent rollout per five roots: an internal child, never a row.
      const child = uuid(account, i, 1);
      const childMeta = { timestamp: meta.timestamp, type: 'session_meta', payload: { id: child, session_id: id, parent_thread_id: id, thread_source: 'subagent', source: { subagent: { other: 'guardian' } } } };
      bytes += write(path.join(path.dirname(path.join(area, 'x')), `rollout-${stamp}-${child}.jsonl`), [JSON.stringify(childMeta), ...end].join('\n') + '\n', at);
    }
  }
  bytes += write(path.join(dir, 'session_index.jsonl'), index.join('\n') + '\n', now);
  return bytes;
}

function claudeDesktopAccount(dir, account, count, now) {
  let bytes = 0;
  for (let i = 0; i < count; i++) {
    const id = uuid(account, i);
    const at = now - minutesAgo(i) * 60000;
    const json = { sessionId: id, title: `Synthetic Claude session ${account}-${i}`, createdAt: new Date(at - 3600000).toISOString(), lastActivityAt: new Date(at).toISOString(), cwd: path.join(dir, 'work'), model: 'synthetic', notes: FILLER.slice(0, 2000) };
    bytes += write(path.join(dir, 'claude-code-sessions', `workspace-${i % 8}`, `local_${id}.json`), JSON.stringify(json), at);
  }
  return bytes;
}

function kimiAccount(dir, account, count, now) {
  let bytes = 0;
  for (let i = 0; i < count; i++) {
    const at = now - minutesAgo(i) * 60000;
    const json = { title: `Synthetic Kimi session ${account}-${i}`, createdAt: new Date(at - 3600000).toISOString(), updatedAt: new Date(at).toISOString(), workDir: path.join(dir, 'work'), padding: FILLER.slice(0, 1500) };
    bytes += write(path.join(dir, 'sessions', `workspace-${i % 8}`, `session_${uuid(account, i)}`, 'state.json'), JSON.stringify(json), at);
  }
  return bytes;
}

function geminiAccount(dir, account, count, now, scale) {
  let bytes = 0;
  const projects = {};
  for (let i = 0; i < count; i++) {
    const id = uuid(account, i);
    const at = now - minutesAgo(i) * 60000;
    const slug = `project-${i % 12}`;
    projects[path.join(dir, 'work', slug)] = slug;
    const meta = { sessionId: id, projectHash: slug, startTime: new Date(at - 3600000).toISOString(), lastUpdated: new Date(at).toISOString(), kind: 'main' };
    const lines = padLines(TARGET_BYTES['gemini-cli'] * scale, (n) => JSON.stringify({ type: n === 0 ? 'user' : 'gemini', timestamp: meta.startTime, content: [{ text: n === 0 ? `Synthetic Gemini task ${account}-${i}` : FILLER }] }));
    lines.push(JSON.stringify({ $set: { lastUpdated: meta.lastUpdated } }));
    bytes += write(path.join(dir, 'tmp', slug, 'chats', `session-${meta.startTime.slice(0, 16).replace(/:/g, '-')}-${id.slice(0, 8)}.jsonl`), [JSON.stringify(meta), ...lines].join('\n') + '\n', at);
  }
  bytes += write(path.join(dir, 'projects.json'), JSON.stringify({ projects }), now);
  return bytes;
}

function qwenAccount(dir, account, count, now, scale) {
  let bytes = 0;
  for (let i = 0; i < count; i++) {
    const id = uuid(account, i);
    const at = now - minutesAgo(i) * 60000;
    const cwd = path.join(dir, 'work', `project-${i % 12}`);
    const first = { uuid: `${id}-0`, parentUuid: null, sessionId: id, timestamp: new Date(at - 3600000).toISOString(), type: 'user', cwd, message: { role: 'user', parts: [{ text: `Synthetic Qwen task ${account}-${i}` }] } };
    const lines = padLines(TARGET_BYTES['qwen-code'] * scale, (n) => JSON.stringify({ uuid: `${id}-${n + 1}`, sessionId: id, timestamp: first.timestamp, type: 'assistant', cwd, message: { role: 'model', parts: [{ text: FILLER }] } }));
    lines.push(JSON.stringify({ uuid: `${id}-end`, sessionId: id, timestamp: new Date(at).toISOString(), type: 'assistant', cwd, message: { role: 'model', parts: [{ text: 'Done.' }] } }));
    bytes += write(path.join(dir, 'projects', `-work-project-${i % 12}`, 'chats', `${id}.jsonl`), [JSON.stringify(first), ...lines].join('\n') + '\n', at);
  }
  return bytes;
}

const WRITERS = { 'claude-cli': claudeCliAccount, codex: codexAccount, claude: claudeDesktopAccount, kimi: kimiAccount, 'gemini-cli': geminiAccount, 'qwen-code': qwenAccount };

// Returns { root, profiles, bytes, sessionsPerAccount, internalChildren, archived }.
function generate(root, options = {}) {
  const base = assertTempRoot(root);
  const accounts = options.accounts || MIX.length;
  const count = options.sessionsPerAccount || 500;
  const scale = options.scale || 1;
  const now = options.now || Date.now();
  const profiles = [];
  let bytes = 0;
  for (let a = 0; a < accounts; a++) {
    const appId = MIX[a % MIX.length];
    const dir = path.join(base, 'accounts', `account-${a}`);
    fs.mkdirSync(dir, { recursive: true });
    bytes += WRITERS[appId](dir, a, count, now, scale);
    profiles.push({ id: `synthetic-${a}`, appId, name: `Synthetic ${a}`, profilePath: dir, sessionRoot: dir, profilePathMode: 'custom', sessionRootMode: 'custom' });
  }
  const codexAccounts = profiles.filter((profile) => profile.appId === 'codex').length;
  return {
    root: base,
    profiles,
    bytes,
    sessionsPerAccount: count,
    expectedRows: Object.fromEntries(profiles.map((profile) => [profile.id, count])),
    internalChildren: codexAccounts * Math.ceil(count / 5),
    archivedPerCodexAccount: Math.floor((count + 0) / 10),
    now
  };
}

module.exports = { generate, MIX, assertTempRoot };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-arch-fixtures-'));
  const light = args.includes('--light');
  const result = generate(root, light ? { sessionsPerAccount: 20, scale: 0.05 } : {});
  process.stdout.write(JSON.stringify({ root: result.root, bytes: result.bytes, profiles: result.profiles.length }, null, 2) + '\n');
}
