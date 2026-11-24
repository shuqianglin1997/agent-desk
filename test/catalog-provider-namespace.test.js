// The renderer filters account bindings by the provider namespace Main stores
// on each binding. The two must agree for every registered client, otherwise
// the "existing login" choice for that client is always empty (DSH was).
// Main's value also feeds the stored account key, so Main is the reference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const apps = require('../src/apps');
const catalog = require('../src/mesh/domain/agent-catalog');
// Main passes the adapters' client facts, as the app does.
const providerNamespace = (appId) => catalog.providerNamespace(appId, apps.clientFacts);
const clientForm = (appId) => catalog.clientForm(appId, apps.clientFacts);

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const fn = (name) => renderer.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function rendererContext(bindings) {
  const context = vm.createContext({
    // appMeta as the renderer's loadApps() fills it from the app list.
    state: { mesh: { overview: { accountBindings: bindings, agents: [] } }, appMeta: Object.fromEntries(apps.listApps({ uiHints: true }).map((app) => [app.id, { providerNamespace: app.providerNamespace }])) },
    tr: (key) => key,
    catalogAgentById: () => null,
    document: { createElement: () => ({}) }
  });
  vm.runInContext([fn('catalogProviderForApp'), fn('bindingOptionLabel'), fn('appendSelectOption'), fn('fillBindingAssignmentSelect')].join('\n'), context);
  return context;
}

test('the renderer and Main use the same provider namespace for every registered client', () => {
  const context = rendererContext([]);
  for (const app of apps.listApps()) {
    assert.equal(context.catalogProviderForApp(app.id), providerNamespace(app.id), app.id);
  }
});

test('a DSH slot is offered the DSH binding Main recorded', () => {
  const context = rendererContext([
    { accountBindingId: 'b-dsh', agentId: 'a', providerNamespace: providerNamespace('dsh-cli'), displayAlias: 'DeepSeek work' },
    { accountBindingId: 'b-codex', agentId: 'a', providerNamespace: providerNamespace('codex'), displayAlias: 'Codex' }
  ]);
  const options = [];
  const select = { value: '', options, replaceChildren() { options.length = 0; }, append(option) { options.push(option); } };
  const offered = context.fillBindingAssignmentSelect(select, 'dsh-cli');
  assert.deepEqual(offered.map((binding) => binding.accountBindingId), ['b-dsh']);
  assert.deepEqual(options.map((option) => option.value), ['', 'b-dsh']);
});

test('provider namespaces and client forms keep their stored values', () => {
  // Stored in account keys and synced between devices: these must never change.
  const expected = {
    claude: ['claude', 'desktop'], 'claude-cli': ['claude', 'cli'], 'dsh-cli': ['dsh-cli', 'cli'], codex: ['codex', 'desktop'],
    kimi: ['kimi', 'desktop'], 'kimi-work': ['kimi', 'desktop-work'], opencode: ['opencode', 'desktop'],
    'gemini-cli': ['gemini-cli', 'cli'], 'qwen-code': ['qwen-code', 'desktop'], cursor: ['cursor', 'desktop']
  };
  assert.deepEqual(Object.fromEntries(apps.appIds().map((id) => [id, [providerNamespace(id), clientForm(id)]])), expected);
  // An id this build does not know (a remote client) keeps its own name; its form comes from the id.
  assert.deepEqual([providerNamespace('Future-CLI'), clientForm('future-cli'), clientForm('future-app'), providerNamespace('')], ['future-cli', 'cli', 'desktop', 'unknown']);
  assert.throws(() => catalog.providerNamespace('codex'), /clientFacts is required/);
});
