// Orderly client updates in the window (docs/ORDERLY_UPDATE_PLAN.md): the one
// confirmation dialog is built from the shared dialog parts, the tools page
// shows a desktop app's update line and action, and a command-line update
// can be held back by the person. The tool center runs here on a small fake
// document; the rest of the window is covered by the hidden acceptance run.
const test = require('node:test');
const assert = require('node:assert/strict');
const { page } = require('./helpers/behaviour');
const createToolCenter = require('../src/renderer/tool-center.js');

test('the confirmation is one dialog made of the shared dialog parts', () => {
  const doc = page();
  const dialog = doc.byId('clientUpdateDialog');
  assert.ok(dialog);
  assert.equal(dialog.tag, 'dialog');
  assert.equal(dialog.attrs.class, 'catalog-dialog');
  assert.equal(dialog.attrs['aria-labelledby'], 'clientUpdateTitle');
  for (const id of ['clientUpdateTitle', 'clientUpdateLead', 'clientUpdateImpact', 'clientUpdateStopRunsField', 'clientUpdateStopRuns', 'confirmClientUpdateBtn']) {
    assert.ok(doc.within(doc.byId(id), dialog), `${id} is in the dialog`);
  }
  assert.equal(doc.byId('clientUpdateImpact').attrs.class, 'catalog-impact');
  assert.equal(doc.byId('clientUpdateStopRunsField').attrs.class, 'catalog-local-registration');
  assert.ok('hidden' in doc.byId('clientUpdateStopRunsField').attrs, 'the background-run choice shows only when there are runs');
  assert.equal(doc.byId('clientUpdateStopRuns').attrs.type, 'checkbox');
  assert.equal(doc.byId('confirmClientUpdateBtn').attrs.type, 'button');
  assert.ok(doc.all((el) => el.attrs['data-i18n'] === 'dialog.cancel' && el.attrs.value === 'cancel' && doc.within(el, dialog)).length === 1);
});

// Just enough of a document for the tool center.
function fakeDocument() {
  const make = (tag) => ({
    tag, children: [], dataset: {}, listeners: {}, className: '', textContent: '', title: '', disabled: false,
    setAttribute(name, value) { this[name] = value; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  });
  return { createElement: make };
}

function find(node, test) {
  if (test(node)) return node;
  for (const child of node.children || []) {
    const hit = find(child, test);
    if (hit) return hit;
  }
  return null;
}

function center({ updateDetail, confirmUpdate, updates = [] } = {}) {
  const document = fakeDocument();
  const els = { desktopToolList: document.createElement('div'), cliToolList: document.createElement('div'), supportedToolList: document.createElement('div') };
  const manager = {
    scanTools: async () => ({ ok: true, items: [], summary: null }),
    updateTool: async (id) => { updates.push(id); return { ok: true, message: 'done' }; }
  };
  const tools = createToolCenter({ document, manager, els, tr: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key), compactDate: String, currentProfileId: () => '', setStatus() {}, updateDetail, confirmUpdate });
  return { tools, els };
}

test('a desktop app with an update waiting shows its line and the one action; others are unchanged', () => {
  const runs = [];
  const { tools, els } = center({
    updateDetail: (item) => (item.id === 'desktop:claude'
      ? { label: 'waiting-label', line: 'two open', action: { label: 'restart-all', disabled: false, run: (button) => runs.push(button.textContent) } }
      : null)
  });
  tools.state.items = [
    { id: 'desktop:claude', kind: 'desktop', label: 'Claude', installed: true, canUpdate: true, canAutoUpdate: false, clientIds: ['claude'] },
    { id: 'desktop:cursor', kind: 'desktop', label: 'Cursor', installed: true, canUpdate: true, canAutoUpdate: false, clientIds: ['cursor'] }
  ];
  tools.renderToolCenter();
  const [claude, cursor] = els.desktopToolList.children;
  assert.equal(claude.dataset.state, 'update');
  assert.equal(find(claude, (node) => node.className === 'tool-status-badge').textContent, 'waiting-label');
  assert.ok(find(claude, (node) => node.className === 'tool-source' && node.textContent === 'two open'));
  const action = find(claude, (node) => node.tag === 'button' && node.textContent === 'restart-all');
  assert.equal(action.className, 'primary');
  action.listeners.click();
  assert.deepEqual(runs, ['restart-all']);
  assert.equal(cursor.dataset.state, 'managed');
  assert.equal(find(cursor, (node) => node.textContent === 'restart-all'), null);
});

test('a command-line update waits for the person when it is not confirmed', async () => {
  const updates = [];
  const asked = [];
  let answer = false;
  const { tools, els } = center({ updates, confirmUpdate: (item) => { asked.push(item.id); return answer; } });
  tools.state.items = [{ id: 'cli:claude', kind: 'cli', label: 'Claude Code', installed: true, canUpdate: true, canAutoUpdate: true, updateAvailable: true, clientIds: ['claude-cli'] }];
  const press = async () => {
    tools.renderToolCenter();
    const button = find(els.cliToolList, (node) => node.tag === 'button' && node.textContent === 'tools.updateNow');
    await button.listeners.click();
  };
  await press();
  assert.deepEqual(updates, [], 'not confirmed: nothing runs');
  assert.equal(tools.state.busyId, null);
  answer = true;
  await press();
  assert.deepEqual(updates, ['cli:claude']);
  assert.deepEqual(asked, ['cli:claude', 'cli:claude']);
});

test('each tool names the clients it belongs to, so the window can match it to accounts', () => {
  const { publicMaintenanceInventory } = require('../src/main/tools');
  const items = publicMaintenanceInventory([
    { id: 'desktop:kimi', kind: 'desktop', label: 'Kimi', tool: { appIds: ['kimi-work', 'kimi'] }, installed: true },
    { id: 'cli:claude', kind: 'cli', label: 'Claude Code', tool: {}, installed: true },
    { id: 'cli:codex', kind: 'cli', label: 'Codex CLI', tool: { discoveryId: 'codex' }, installed: false },
    { id: 'cli:other', kind: 'cli', label: 'Other', tool: {}, installed: false }
  ], null).items;
  assert.deepEqual(items.map((item) => [item.id, item.clientIds]), [
    ['desktop:kimi', ['kimi-work', 'kimi']],
    ['cli:claude', ['claude-cli']],
    ['cli:codex', ['codex']],
    ['cli:other', []]
  ]);
});
