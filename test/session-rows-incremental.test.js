// The session table updates by row (docs/ARCHITECTURE_PLAN.md 5.7, phase 6):
// a row is kept while its signature, everything its drawing reads, is the
// same, and drawn anew when any of it changes. These tests pin the signature:
// each thing a row shows changes it, and nothing a row does not show does.
// The hidden-window acceptance run checks the rows themselves.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const createSessionMarks = require('../src/renderer/session-marks.js');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');

const COLUMNS = [
  { key: 'title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'project', className: 'col-project', cellClass: 'path-cell' },
  { key: 'updatedAt', className: 'col-date' },
  { key: 'source', className: 'col-source' }
];

function context(overrides = {}) {
  const ctx = vm.createContext({
    state: { ui: { agentScope: 'current', checkedConversationIds: new Set(), focusedConversationId: null }, sessionView: 'compact' },
    window: { I18N: { getLang: () => 'zh' } },
    dateLocale: () => 'zh-CN',
    sessionKey: (session) => `p::${session.id}`,
    sessionMarks: { titleSignature: (session) => `marks:${session.tag || 0}` },
    JSON,
    Date,
    Array,
    ...overrides
  });
  vm.runInContext(`${rendererFunction('sessionRowsView')}\n${rendererFunction('sessionRowSignature')}`, ctx);
  return ctx;
}

const base = {
  id: 's1',
  title: 'Alpha',
  address: 's1',
  appId: 'codex',
  _accountName: 'Work',
  _profileName: 'work',
  _appLabel: 'Codex',
  createdAt: '2026-08-11T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
  projectPath: '/p/alpha',
  source: 'Codex',
  _deviceName: 'Mac',
  replicas: [{ deviceId: 'd1', deviceName: 'Mac' }]
};

test('every field a row shows, its check, its focus and its marks change its signature', () => {
  const ctx = context();
  const view = ctx.sessionRowsView(COLUMNS);
  const signature = (session) => ctx.sessionRowSignature(session, view, COLUMNS);
  const before = signature(base);
  assert.equal(signature({ ...base }), before, 'a copy of the same session keeps its row');
  assert.equal(signature({ ...base, _internalField: 'x', status: 'whatever' }), before, 'a field no cell reads keeps the row');
  for (const [field, value] of [
    ['title', 'Beta'], ['id', 's1b'], ['address', 'other'], ['appId', 'claude'], ['_accountName', 'Home'],
    ['_profileName', 'home'], ['_appLabel', 'Claude'], ['createdAt', '2026-08-10T10:00:00.000Z'],
    ['updatedAt', '2026-08-12T11:00:00.000Z'], ['projectPath', '/p/beta'], ['source', 'Other'],
    ['_deviceName', 'PC'], ['replicas', [{ deviceId: 'd1', deviceName: 'Mac' }, { deviceId: 'd2' }]], ['tag', 2]
  ]) {
    assert.notEqual(signature({ ...base, [field]: value }), before, `${field} changes the row`);
  }
  ctx.state.ui.checkedConversationIds.add('p::s1');
  assert.notEqual(signature(base), before, 'checking it changes the row');
  ctx.state.ui.checkedConversationIds.clear();
  ctx.state.ui.focusedConversationId = 'p::s1';
  assert.notEqual(signature(base), before, 'focusing it changes the row');
});

test('the columns, scope, view, language, date locale and day change every row', () => {
  const ctx = context();
  const view = ctx.sessionRowsView(COLUMNS);
  const changed = [];
  changed.push(ctx.sessionRowsView(COLUMNS.slice(0, 3)));
  ctx.state.ui.agentScope = 'all'; changed.push(ctx.sessionRowsView(COLUMNS)); ctx.state.ui.agentScope = 'current';
  ctx.state.sessionView = 'detail'; changed.push(ctx.sessionRowsView(COLUMNS)); ctx.state.sessionView = 'compact';
  ctx.window.I18N.getLang = () => 'ja'; changed.push(ctx.sessionRowsView(COLUMNS)); ctx.window.I18N.getLang = () => 'zh';
  ctx.dateLocale = () => 'en-US'; changed.push(ctx.sessionRowsView(COLUMNS));
  for (const value of changed) assert.notEqual(value, view);
  assert.match(rendererFunction('sessionRowsView'), /new Date\(\)\.toDateString\(\)/, 'a new day draws every date again');
});

test('the title marks signature follows the tag and the tag\'s name', async () => {
  const document = { querySelector: () => null, querySelectorAll: () => [], activeElement: null };
  let names = [null, null, null, null, null];
  let tags = {};
  const manager = {
    getSessionMarks: async () => ({ ok: true, tags, seen: {}, names, baselineAt: 1 }),
    setSessionTag: async () => ({ ok: true, tags, seen: {}, names, baselineAt: 1 })
  };
  const marks = createSessionMarks({ document, manager, tr: (key) => key, keyOf: (s) => s.key || '', rerender: () => {}, setStatus: () => {} });
  await marks.load();
  const session = { key: 'k1' };
  const plain = marks.titleSignature(session);
  assert.equal(marks.titleSignature({ key: '' }), '', 'a session without a key has no marks');
  tags = { k1: 2 };
  await marks.load();
  const tagged = marks.titleSignature(session);
  assert.notEqual(tagged, plain, 'a tag changes it');
  names = [null, 'Urgent', null, null, null];
  await marks.load();
  assert.notEqual(marks.titleSignature(session), tagged, 'renaming the tag changes it');
  assert.match(rendererSource(), /sessionMarks\.titleSignature\(session\)/, 'the row signature includes the marks');
});
