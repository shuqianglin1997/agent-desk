// The cards follow the 8-second activity poll; the list used to refresh only
// when the window regained focus, so a focused window showed old times and
// order. New activity in the listed accounts reloads the list in the same
// poll round that sees it (docs/ARCHITECTURE_PLAN.md 9.1, phase 6 close:
// once the table updated by row, the 30-second limit of phase 1 became one
// reload per round). No new activity, a hidden window, or activity outside
// the list's accounts reloads nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source');

const renderer = rendererSource();
const fn = (name) => renderer.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function setup() {
  let now = Date.parse('2026-11-24T12:00:00Z');
  let activity = [{ profileId: 'a1', latestMtime: 1000 }, { profileId: 'b1', latestMtime: 5000 }];
  let loads = 0;
  let hidden = false;
  const groups = [
    { key: 'A', primary: { name: 'A' }, members: [{ id: 'a1' }] },
    { key: 'B', primary: { name: 'B' }, members: [{ id: 'b1' }] }
  ];
  const context = vm.createContext({
    Date: { now: () => now, parse: Date.parse },
    state: { activity: {}, startupStage: 'ready', ui: { agentScope: 'current' }, profiles: [{ id: 'a1' }, { id: 'b1' }] },
    document: { get hidden() { return hidden; }, dispatchEvent() {} },
    currentAgentId: () => 'A', identityGroups: () => groups,
    loadSessions: async () => { loads += 1; },
    renderAccountHeader() {}, renderAccountRoster() {}, renderTopbarContext() {}, renderAttentionInbox() {},
    sessionMarks: { updateFromActivity: () => 0 }, hubWritingKeys: () => [], applySessionFilter() {},
    window: { manager: { listActivity: async () => activity } }
  });
  const declarations = (renderer.match(/^(?:let|const) (?:activitySessionRefreshAt|listedActivityAt|ACTIVITY_POLL_INTERVAL)\b[^\n]*$/gm) || []).join('\n');
  vm.runInContext(`let activityLoading = false; let busySignature = ''; let replySignature = '';\n${declarations}\n${fn('loadActivity')}\n${fn('listedProfileIds')}\n${fn('refreshSessionsOnActivity')}`, context);
  return {
    poll: () => context.loadActivity(),
    loads: () => loads,
    advance: (ms) => { now += ms; },
    write: (id, at) => { activity = activity.map((item) => (item.profileId === id ? { ...item, latestMtime: at } : item)); },
    hide: (value) => { hidden = value; }
  };
}

test('new activity in a listed account reloads the list; the first poll only sets the baseline', async () => {
  const run = setup();
  await run.poll();
  assert.equal(run.loads(), 0, 'the first poll after start-up does not reload');
  run.advance(8000); await run.poll();
  assert.equal(run.loads(), 0, 'nothing new, nothing reloaded');
  run.write('a1', 2000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1);
});

test('every poll round that sees new activity reloads in that round, also when the timer runs a little early', async () => {
  const run = setup();
  await run.poll();
  let at = 2000;
  for (const gap of [8000, 8000, 7990, 8010, 7995]) {
    run.write('a1', at += 1000); run.advance(gap); await run.poll();
  }
  assert.equal(run.loads(), 5, 'one reload per round that saw something new');
  run.advance(8000); await run.poll();
  assert.equal(run.loads(), 5, 'a round with nothing new reloads nothing');
});

test('a second probe within the same round does not reload again', async () => {
  const run = setup();
  await run.poll();
  run.write('a1', 2000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1);
  // e.g. the window came back to the front and probed again a second later
  run.write('a1', 2500); run.advance(1000); await run.poll();
  assert.equal(run.loads(), 1, 'the change waits for the next round');
  run.advance(7000); await run.poll();
  assert.equal(run.loads(), 2, 'and reloads there');
});

test('a hidden window and accounts outside the list scope reload nothing', async () => {
  const run = setup();
  await run.poll();
  run.hide(true);
  run.write('a1', 2000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 0, 'hidden: nothing reloaded');
  run.hide(false);
  run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1, 'shown again: the change is reloaded');
  run.write('b1', 9000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1, 'account B is not in the current list scope');
});
