// Dialogs, menus and popovers each have one way in the renderer
// (docs/ARCHITECTURE_PLAN.md 5.7, phase 6). The behaviour itself (the
// parent-child stack, layered Escape, focus return, Top Layer) is held by the
// hidden-window acceptance run; see test/ui-contracts.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rendererFiles, rendererFunction } = require('./helpers/renderer-source');

const SRC = path.join(__dirname, '..', 'src');
const files = [...rendererFiles(), ...fs.readdirSync(path.join(SRC, 'renderer')).filter((f) => f.endsWith('.js')).map((f) => path.join(SRC, 'renderer', f))];
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(path.join(SRC, '..'), file);

test('only openDialog shows a modal dialog', () => {
  for (const file of files) {
    const calls = (read(file).match(/\.showModal\(\)/g) || []).length;
    const allowed = rel(file) === 'src/renderer/views/dialogs.js' || rel(file) === 'src/renderer/recruit.js' ? 1 : 0;
    assert.equal(calls, allowed, `${rel(file)} shows a dialog itself`);
  }
  assert.match(rendererFunction('openDialog'), /dialog\.showModal\(\);/);
  assert.match(read(path.join(SRC, 'renderer', 'recruit.js')), /const openDialog = deps\.openDialog \|\| \(\(dialog\) => dialog\.showModal\(\)\);/);
  assert.match(rendererFunction('openChildDialog'), /openDialog\(dialog\);/);
  assert.match(rendererFunction('openUtilityDialog'), /if \(!dialog\.open\) openDialog\(dialog\);/);
});

test('menus close through closeContextMenu and one rule set', () => {
  for (const file of files) {
    if (rel(file) === 'src/renderer/views/dialogs.js') continue;
    assert.doesNotMatch(read(file), /[Mm]enu\.open = false/, `${rel(file)} closes a menu itself`);
  }
  const rules = rendererFunction('bindContextMenuRules');
  for (const pattern of [/'pointerdown'/, /'click'/, /event\.key !== 'Escape'/, /returnFocus: true/]) assert.match(rules, pattern);
  assert.match(rendererFunction('bindEvents'), /bindContextMenuRules\(\);/);
});

test('popovers are browser popovers', () => {
  const html = read(path.join(SRC, 'index.html'));
  for (const id of ['quotaPopover', 'sessionTagPicker']) assert.match(html, new RegExp(`id="${id}"[^>]*popover="auto"`));
  for (const file of files) assert.doesNotMatch(read(file), /\.popover\s*=|setAttribute\('popover'/, `${rel(file)} makes a popover by hand`);
});
