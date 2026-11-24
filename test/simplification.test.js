const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rendererSource } = require('./helpers/renderer-source');
const renderer = rendererSource();
function fn(name) { return renderer.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{\\n.*?^\\}', 'ms'))[0]; }

test('repeated activity polls never write a guessed completion or companion ledger', async () => {
  const context = vm.createContext({
    state: { activity: {} }, renderAccountHeader() {}, renderAccountRoster() {}, renderTopbarContext() {}, renderAttentionInbox() {},
    // 会话记号（新回复、在跑）只读探测结果，不写任何账本。
    sessionMarks: { updateFromActivity: () => 0 }, hubWritingKeys: () => [], applySessionFilter() {}, document: { dispatchEvent() {} },
    refreshSessionsOnActivity() {},
    window: { manager: { listActivity: async () => [{ profileId: 'a', activeNow: 1 }] } }
  });
  vm.runInContext("let activityLoading = false; let busySignature = ''; let replySignature = '';\n" + fn('loadActivity'), context);
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
  vm.runInContext(fn('confirmAgentCreation') + '\n' + fn('createAgentAndPrepare'), context);
  await context.confirmAgentCreation();
  assert.equal(requests[0].displayName, 'Company');
  assert.equal(refreshes[0].deviceLensId, 'local');
  assert.equal(refreshes[0].agentId, 'new');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { agentId: 'new', deviceId: 'local', requestedAppId: 'codex', requestedClientForm: 'desktop' });
  assert.equal(context.els.agentCreateDialog.open, false);
});
