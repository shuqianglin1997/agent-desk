// AgentDesk — the parts of docs/INTERNAL.md that come from code, and the
// paths the structure docs cite: npm run check:docs fails when either drifts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docs = require('../scripts/command-docs');
const layers = require('../scripts/check-layers');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('五层的文件表由 scripts/check-layers.js 生成：每条登记恰好出现一次，按层从上到下', () => {
  const section = layers.docSection();
  assert.ok(section.startsWith(layers.DOC_START) && section.endsWith(layers.DOC_END));
  const patterns = layers.TABLE.flatMap(([, list]) => list);
  for (const pattern of patterns) {
    assert.equal(section.split(`\`${pattern}\``).length - 1, 1, `${pattern} listed once`);
  }
  const order = [...layers.LAYERS].reverse().concat('entry').map((name) => section.indexOf(`| ${name} `));
  assert.ok(order.every((at) => at > 0), 'every layer has a row');
  // ui is listed first (top of the stack), core last before the entry points.
  assert.ok(section.indexOf('| ui ') < section.indexOf('| core ') && section.indexOf('| core ') < section.indexOf('| entry '));
});

test('INTERNAL.md 里生成的两段与代码一致，--write 只换这两段', () => {
  const text = read('docs/INTERNAL.md');
  assert.equal(docs.current(text), docs.section());
  assert.equal(docs.currentLayers(text), layers.docSection());
  const stale = text.replace(docs.currentLayers(text), `${layers.DOC_START}\nold\n${layers.DOC_END}`);
  assert.equal(docs.rewrite(stale), text, 'a stale block is replaced, nothing else changes');
});

test('结构文档引用的仓库路径都存在；占位、通配和外部路径不算', () => {
  assert.deepEqual(docs.citedPaths('see `scripts/check-layers.js`, `native/<os>/helper`, `scripts/ui-*.js`, `test/*.test.js` and `docs/README.md`'), ['scripts/check-layers.js', 'docs/README.md']);
  assert.deepEqual(docs.missingPaths('`scripts/check-layers.js` and `scripts/no-such-file.js`', ROOT), ['scripts/no-such-file.js']);
  for (const file of ['docs/INTERNAL.md', 'docs/STRUCTURE.md']) {
    assert.deepEqual(docs.missingPaths(read(file), ROOT), [], `${file} cites only existing paths`);
  }
});
