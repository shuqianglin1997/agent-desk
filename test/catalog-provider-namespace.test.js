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
const { providerNamespace } = require('../src/mesh/domain/agent-catalog');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const fn = (name) => renderer.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

function rendererContext(bindings) {
  const context = vm.createContext({
    state: { mesh: { overview: { accountBindings: bindings, agents: [] } } },
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
