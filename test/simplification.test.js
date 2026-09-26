const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
function fn(name) { return renderer.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{\\n.*?^\\}', 'ms'))[0]; }

test('yard placement saves a bounded point without routing any account or session action', () => {
  const writes = [];
  const state = { yardPositions: {} };
  const context = vm.createContext({
    state, Date, tr: x => x, setStatus() {}, persistSettings: patch => writes.push(patch),
    window: { YardInteractions: require('../src/yard/interactions'), YardScene: { say() {} } }
  });
  vm.runInContext(fn('saveYardPosition') + '\n' + fn('handleYardDrop'), context);
  for (const point of [{ x: 50, y: 52 }, { x: 236, y: 104 }, { x: 420, y: 104 }]) {
    assert.equal(context.handleYardDrop({ profile: { id: 'a', name: 'Account' }, point }).keepPosition, true);
  }
  assert.equal(writes.length, 3);
  assert.equal(state.yardPositions.a.x, 420);
  assert.equal(context.handleYardDrop({ profile: { id: 'a' }, point: { x: NaN, y: 90 } }), false);
  assert.equal(writes.length, 3);
});

test('repeated activity polls never write a guessed completion or companion ledger', async () => {
  const context = vm.createContext({
    state: { activity: {} }, renderAccounts() {}, renderAccountHeader() {}, syncYard() {},
    window: { manager: { listActivity: async () => [{ profileId: 'a', activeNow: 1 }] } }
  });
  vm.runInContext("let activityLoading = false; let busySignature = '';\n" + fn('loadActivity'), context);
  await context.loadActivity(); await context.loadActivity();
  assert.equal(context.state.activity.a.activeNow, 1);
  assert.equal(context.state.ledger, undefined);
});

test('ordinary Agent creation prepares only the newly created Agent on this device with the chosen client', async () => {
  const requests = [];
  const refreshes = [];
  const button = { disabled: false };
  const context = vm.createContext({
    els: { newAgentName: { value: 'Company', focus() {} }, newAgentGroup: { value: 'Work' }, newAgentNote: { value: '' },
      newAgentApp: { value: 'codex' }, confirmAddAgentBtn: button, agentCreateDialog: { open: true, close() { this.open = false; } } },
    state: { appMeta: { codex: { canProvision: true } } },
    currentCatalogRevision: () => 1, setStatus() {}, tr: x => x, provisioningResultMessage: () => 'waiting-login',
    refreshCatalogWorkspace: async (_overview, options) => refreshes.push(options), rememberProvisioningChoice() {},
    window: { manager: {
      createAgent: async input => { requests.push(input); return { ok: true, agent: { agentId: 'new', displayName: input.displayName }, overview: { localDeviceId: 'local' } }; },
      ensureAgentReady: async input => { requests.push(input); return { state: 'waiting-login' }; }
    } }
  });
  vm.runInContext(fn('confirmAgentCreation'), context);
  await context.confirmAgentCreation();
  assert.equal(requests[0].displayName, 'Company');
  assert.equal(refreshes[0].deviceLensId, 'local');
  assert.equal(refreshes[0].agentId, 'new');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { agentId: 'new', deviceId: 'local', requestedAppId: 'codex', requestedClientForm: 'desktop' });
  assert.equal(context.els.agentCreateDialog.open, false);
});
