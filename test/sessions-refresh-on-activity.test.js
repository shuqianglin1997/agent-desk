// The cards follow the 8-second activity poll; the list used to refresh only
// when the window regained focus, so a focused window showed old times and
// order. Now new activity in the listed accounts reloads the list, at most
// once every 30 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const fn = (name) => renderer.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function setup() {
  let now = Date.parse('2026-11-24T12:00:00Z');
  let activity = [{ profileId: 'a1', latestMtime: 1000 }, { profileId: 'b1', latestMtime: 5000 }];
  let loads = 0;
  const groups = [
    { key: 'A', primary: { name: 'A' }, members: [{ id: 'a1' }] },
    { key: 'B', primary: { name: 'B' }, members: [{ id: 'b1' }] }
  ];
  const context = vm.createContext({
    Date: { now: () => now, parse: Date.parse },
    state: { activity: {}, startupStage: 'ready', ui: { agentScope: 'current' }, profiles: [{ id: 'a1' }, { id: 'b1' }] },
    document: { hidden: false, dispatchEvent() {} },
    currentAgentId: () => 'A', identityGroups: () => groups,
    loadSessions: async () => { loads += 1; },
    renderAccountHeader() {}, renderAccountRoster() {}, renderTopbarContext() {}, renderAttentionInbox() {},
    sessionMarks: { updateFromActivity: () => 0 }, hubWritingKeys: () => [], applySessionFilter() {},
    window: { manager: { listActivity: async () => activity } }
  });
  const declarations = (renderer.match(/^(?:let|const) (?:activitySessionRefreshAt|listedActivityAt|ACTIVITY_SESSION_REFRESH_INTERVAL)\b[^\n]*$/gm) || []).join('\n');
  vm.runInContext(`let activityLoading = false; let busySignature = ''; let replySignature = '';\n${declarations}\n${fn('loadActivity')}\n${fn('listedProfileIds')}\n${fn('refreshSessionsOnActivity')}`, context);
  return {
    poll: () => context.loadActivity(),
    loads: () => loads,
    advance: (ms) => { now += ms; },
    write: (id, at) => { activity = activity.map((item) => (item.profileId === id ? { ...item, latestMtime: at } : item)); }
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

test('reloads are at most every 30 seconds, and activity outside the list scope does not count', async () => {
  const run = setup();
  await run.poll();
  run.write('a1', 2000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1);
  run.write('a1', 3000); run.advance(8000); await run.poll();
  assert.equal(run.loads(), 1, 'within 30 seconds of the last reload');
  run.advance(24000); await run.poll();
  assert.equal(run.loads(), 2, 'the pending change reloads once 30 seconds have passed');
  run.write('b1', 9000); run.advance(40000); await run.poll();
  assert.equal(run.loads(), 2, 'account B is not in the current list scope');
});
