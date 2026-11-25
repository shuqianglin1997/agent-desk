// Switching cats quickly starts overlapping list loads. Whichever answer
// arrives last must not win: only the most recent request may fill the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source');

const renderer = rendererSource();
const fn = (name) => renderer.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function context() {
  const pending = new Map();
  let agent = 'A';
  const groups = [
    { key: 'A', primary: { name: 'Cat A' }, members: [{ id: 'a1', name: 'Cat A', appId: 'codex' }] },
    { key: 'B', primary: { name: 'Cat B' }, members: [{ id: 'b1', name: 'Cat B', appId: 'codex' }] }
  ];
  const ctx = vm.createContext({
    state: { ui: { agentScope: 'current' }, profiles: [{ id: 'a1' }, { id: 'b1' }], mesh: { overview: null }, sessions: [] },
    currentAgentId: () => agent,
    identityGroups: () => groups,
    appLabel: (id) => id,
    tr: (key) => key,
    validateSessionContext() {},
    applySessionFilter() {},
    renderSessionControls() {},
    renderAccounts() {},
    setStatus() {},
    window: {
      // The page loads src/session-table.js as window.SessionTable.
      SessionTable: require('../src/session-table'),
      manager: { listSessions: (member) => { const step = deferred(); pending.set(member.id, step); return step.promise; } }
    }
  });
  const declarations = (renderer.match(/^let sessionsLoad\w* = [^\n]*$/gm) || []).join('\n');
  vm.runInContext(`${declarations}\n${fn('loadSessions')}\n${fn('loadLocalSessions')}`, ctx);
  return { ctx, pending, select: (value) => { agent = value; } };
}

test('a slower answer for the previous cat does not replace the list of the cat now shown', async () => {
  const { ctx, pending, select } = context();
  const first = ctx.loadSessions();
  await new Promise((resolve) => setImmediate(resolve));
  select('B');
  const second = ctx.loadSessions();
  await new Promise((resolve) => setImmediate(resolve));
  pending.get('b1').resolve([{ id: 'b-row', updatedAt: '2026-11-24T10:00:00Z' }]);
  await second;
  pending.get('a1').resolve([{ id: 'a-row', updatedAt: '2026-11-24T11:00:00Z' }]);
  await first;
  assert.deepEqual(Array.from(ctx.state.sessions, (row) => row.id), ['b-row']);
});

test('answers arriving in order still fill the list', async () => {
  const { ctx, pending } = context();
  const load = ctx.loadSessions();
  await new Promise((resolve) => setImmediate(resolve));
  pending.get('a1').resolve([{ id: 'a-row', updatedAt: '2026-11-24T11:00:00Z' }]);
  await load;
  assert.deepEqual(Array.from(ctx.state.sessions, (row) => row.id), ['a-row']);
  // Every row carries the slot and account it came from, so actions go back to that slot.
  const [row] = ctx.state.sessions;
  assert.deepEqual([row._profileId, row._accountKey, row._accountName, row._profileName], ['a1', 'A', 'Cat A', 'Cat A']);
});
