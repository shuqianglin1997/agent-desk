// AgentDesk — 猫有多忙、新回复、颜色标签：列表（docs/SESSION_MARKS_PLAN.md 第 6 节第 2 批）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const createSessionMarks = require('../src/renderer/session-marks.js');
const { normalizeSettings } = require('../src/settings');
const PixelIcons = require('../src/pixel/icons.js');
const Sfx = require('../src/pixel/sfx.js');

function words(lang) {
  const source = read(`src/i18n/${lang}.js`);
  const sandbox = { self: {} };
  new Function('self', source)(sandbox.self);
  const table = sandbox.self.I18N_DICT?.[lang] || Object.values(sandbox.self).find((value) => value && typeof value === 'object' && value['marks.fresh']);
  if (table) return table;
  const out = {};
  for (const match of source.matchAll(/'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g)) out[match[1]] = match[2];
  return out;
}

function fakeMarks(overrides = {}) {
  const calls = [];
  const store = {};
  const document = { querySelector: () => null, querySelectorAll: () => [], activeElement: null };
  const manager = {
    getSessionMarks: async () => ({ ok: true, tags: {}, seen: {}, names: [null, null, null, null, null], baselineAt: 1 }),
    markSessionsSeen: async (entries) => { calls.push(['seen', entries]); return { ok: true, tags: {}, seen: Object.fromEntries(entries.map((e) => [e.key, e.at])), names: [], baselineAt: 1 }; },
    setSessionTag: async (keys, tag) => {
      calls.push(['tag', keys, tag]);
      for (const key of keys) { if (tag) store[key] = tag; else delete store[key]; }
      return { ok: true, tags: { ...store }, seen: {}, names: [], baselineAt: 1 };
    },
    ...overrides
  };
  const marks = createSessionMarks({ document, manager, tr: (key) => key, keyOf: (s) => s.key || '', rerender: () => calls.push(['render']), setStatus: () => {} });
  return { marks, calls };
}

test('new replies and running come from the activity probe; seen and running hide new replies', async () => {
  const { marks, calls } = fakeMarks();
  await marks.load();
  const activity = [{ writingKeys: ['p::run'], freshKeys: [{ key: 'p::a', at: 100 }, { key: 'p::b', at: 200 }, { key: 'p::run', at: 50 }] }];
  assert.equal(marks.updateFromActivity(activity), 0, 'the first round is only the starting point');
  assert.equal(marks.isFresh({ key: 'p::a' }), true);
  assert.equal(marks.isFresh({ key: 'p::run' }), false, 'running rows never show 新回复');
  assert.equal(marks.isWriting({ key: 'p::run' }), true);
  assert.equal(marks.freshCount(activity), 2);
  assert.equal(await marks.markSeen([{ key: 'p::a' }, { key: 'p::nothing' }]), 1);
  assert.deepEqual(calls.find((c) => c[0] === 'seen')[1], [{ key: 'p::a', at: 100 }], 'seen time is the reply time');
  assert.equal(marks.isFresh({ key: 'p::a' }), false);
  const next = [{ writingKeys: [], freshKeys: [{ key: 'p::b', at: 200 }, { key: 'p::c', at: 300 }] }];
  assert.equal(marks.updateFromActivity(next, ['p::b']), 1, 'only the newly arrived reply counts; hub runs mark rows running');
  assert.equal(marks.isWriting({ key: 'p::b' }), true);
});

test('tag filters are OR among shapes, AND with 新回复; sorting keeps the header order inside groups', async () => {
  const { marks } = fakeMarks();
  await marks.load();
  marks.updateFromActivity([{ freshKeys: [{ key: 'k2', at: 9 }, { key: 'k4', at: 9 }] }]);
  await marks.setTag(['k1', 'k2'], 1);
  await marks.setTag(['k3'], 3);
  await marks.setTag(['k4'], 5);
  const rows = ['k1', 'k2', 'k3', 'k4', 'k5'].map((key) => ({ key }));
  assert.deepEqual(marks.filter(rows).map((r) => r.key), ['k1', 'k2', 'k3', 'k4', 'k5'], 'no filter, no change');
  marks.clearFilters();
  marks.showFresh();
  assert.deepEqual(marks.filter(rows).map((r) => r.key), ['k2', 'k4']);
  marks.clearFilters();
  marks.setOrder('tag');
  assert.deepEqual(marks.order(rows).map((r) => r.key), ['k1', 'k2', 'k3', 'k4', 'k5']);
  assert.deepEqual(marks.order([rows[4], rows[3], rows[2], rows[1], rows[0]]).map((r) => r.key), ['k2', 'k1', 'k3', 'k4', 'k5']);
  marks.setOrder('fresh');
  assert.deepEqual(marks.order(rows).map((r) => r.key), ['k2', 'k4', 'k1', 'k3', 'k5']);
  marks.setOrder('nonsense');
  assert.equal(marks.currentOrder(), 'recent');
  assert.equal(marks.order(rows), rows, 'the default order is the table’s own');
  await marks.setTag(['k1'], 0);
  assert.equal(marks.tagOf({ key: 'k1' }), 0, '0 removes a tag');
});

test('the sort order is a stable setting; the filters are not', () => {
  assert.equal(normalizeSettings({}).sessionOrder, 'recent');
  assert.equal(normalizeSettings({ sessionOrder: 'tag' }).sessionOrder, 'tag');
  assert.equal(normalizeSettings({ sessionOrder: 'priority' }).sessionOrder, 'recent');
  const settings = read('src/settings.js');
  assert.doesNotMatch(settings, /markFilter|sessionFilter/);
});

test('toolbar: the filter strip sits left of the search box; the picker is a top-layer popover; the card envelope is not nested in a button', () => {
  const html = read('src/index.html');
  assert.match(html, /session-toolbar-controls">\s*<div id="sessionMarkFilters"[\s\S]*?id="clearSessionFiltersBtn"[\s\S]*?id="searchInput"[\s\S]*?id="sessionDisplayMenu"/);
  assert.match(html, /id="sessionDisplayMenu"[\s\S]*?data-session-order="recent"[\s\S]*?data-session-order="fresh"[\s\S]*?data-session-order="tag"[\s\S]*?id="markAllSeenBtn"/);
  assert.match(html, /<div id="sessionTagPicker"[^>]*popover="auto"[^>]*role="menu"/);
  assert.match(html, /<\/button>\s*<button class="account-card-mail" type="button" hidden data-roster-control>/);
  assert.match(html, /id="sessionSelectionBar"[\s\S]*?id="tagCheckedSessionsBtn"/);
  assert.match(html, /renderer\/session-marks\.js[\s\S]*?\.\/renderer\.js/);
});

test('filtering treats focused and ticked rows exactly as the search box does', () => {
  const renderer = read('src/renderer.js');
  const body = renderer.slice(renderer.indexOf('function applySessionFilter()'), renderer.indexOf('// ── 猫咪档案卡'));
  assert.match(body, /const filtered = sessionMarks\.filter\(searched\);/);
  assert.doesNotMatch(body, /checkedConversationIds|focusedConversationId|UiContext\./, 'filtering never edits the selection');
  const module = read('src/renderer/session-marks.js');
  assert.doesNotMatch(module, /checkedConversationIds|focusedConversationId|persistSettings/);
});

test('words: three lists carry every new key; nothing says “unread”', () => {
  const keys = ['marks.fresh', 'marks.fresh.title', 'marks.clear', 'marks.shown', 'marks.sort', 'marks.sort.recent', 'marks.sort.fresh', 'marks.sort.tag',
    'marks.allSeen', 'marks.tagChecked', 'marks.picker', 'marks.picker.checked', 'marks.none', 'marks.tagButton', 'marks.tagButton.aria', 'marks.tag.title',
    'marks.tag.full', 'marks.tag.plain', 'marks.rename.aria', 'marks.row.fresh', 'marks.row.freshHint', 'marks.row.running', 'marks.row.runningHint',
    'marks.status.tagged', 'marks.status.untagged', 'marks.status.allSeen', 'marks.status.failed', 'card.replies', 'card.mail.title',
    ...[1, 2, 3, 4, 5].flatMap((n) => [`marks.color.${n}`, `marks.shape.${n}`])];
  for (const lang of ['zh', 'en', 'ja']) {
    const table = words(lang);
    for (const key of keys) assert.ok(table[key], `${lang} ${key}`);
    const text = keys.map((key) => table[key]).join('\n');
    assert.doesNotMatch(text, /未读|未讀|未読|unread/i, `${lang} must say 新回复, never unread`);
  }
  assert.equal(words('zh')['marks.row.fresh'], '新回复');
  assert.equal(words('zh')['marks.sort.recent'], '最近活跃（默认）');
});

test('tags: five shapes that differ from each other, colours readable as graphics in both themes', () => {
  const shapes = [1, 2, 3, 4, 5].map((n) => PixelIcons.ICONS?.[`tag${n}`] || null).filter(Boolean);
  if (shapes.length) assert.equal(new Set(shapes.map((s) => s.join('/'))).size, 5);
  for (const name of ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'reply', 'mail']) assert.ok(PixelIcons.svg(name).includes('<rect'), name);
  const css = read('src/pixel.css');
  const block = (selector) => css.slice(css.indexOf(selector + ' {'), css.indexOf('}', css.indexOf(selector + ' {')));
  const token = (text, name) => (text.match(new RegExp(`--px-${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const theme of [block(':root'), block(':root[data-theme="dark"]')]) {
    for (let n = 1; n <= 5; n += 1) {
      const colour = token(theme, `tag-${n}`);
      assert.ok(colour, `tag-${n} defined`);
      for (const ground of ['bg', 'float', 'hl', 'chk']) {
        assert.ok(ratio(colour, token(theme, ground)) >= 3, `tag-${n} on ${ground}: ${ratio(colour, token(theme, ground)).toFixed(2)}`);
      }
    }
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.session-writing i \{ animation: none; visibility: visible; \}\s*\.fx-pop \{ animation: none; \}/);
});

test('the reply chime: one sound event, only when the window is not in front, at most once in 30 seconds', () => {
  assert.deepEqual(Sfx.EVENTS['session.reply'] && Sfx.EVENTS['session.reply'].sound, 'arrive');
  const ui = read('src/pixel/ui.js');
  const hook = ui.slice(ui.indexOf("addEventListener('agentdesk:replies'"), ui.indexOf("cue('session.reply')") + 30);
  assert.match(hook, /document\.hasFocus\(\)\) return;/);
  assert.match(hook, /clock\(\) - lastReplyAt < 30000/);
  assert.match(read('src/renderer.js'), /new CustomEvent\('agentdesk:replies', \{ detail: \{ added \} \}\)/);
});
