// The renderer is native modules with written-out dependencies
// (docs/ARCHITECTURE_PLAN.md 5.7, phase 6): src/renderer.js is the start-up
// and the page's one module entry; the views import what they use; nothing is
// published on window except the inspect object the harness reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const VIEWS = path.join(SRC, 'renderer', 'views');
const read = (file) => fs.readFileSync(file, 'utf8');
const views = fs.readdirSync(VIEWS).filter((file) => file.endsWith('.js')).sort();

test('the page loads renderer.js as its one module; the views come through imports', () => {
  const html = read(path.join(SRC, 'index.html'));
  assert.deepEqual([...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['./renderer.js']);
  const reached = new Set();
  const visit = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const m of read(file).matchAll(/^import \{[^}]*\} from '([^']+)';$/gm)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(SRC, 'renderer.js'));
  for (const file of views) assert.ok(reached.has(path.join(VIEWS, file)), `${file} is imported`);
});

test('renderer.js is start-up only and nothing is published on window but the inspect object', () => {
  const renderer = read(path.join(SRC, 'renderer.js'));
  assert.deepEqual([...renderer.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]), ['bindEvents']);
  assert.deepEqual([...renderer.matchAll(/^window\.(\w+)\s*=/gm)].map((m) => m[1]), ['AgentDeskInspect']);
  for (const file of views) {
    const source = read(path.join(VIEWS, file));
    assert.doesNotMatch(source, /Object\.assign\(window,/, file);
    assert.doesNotMatch(source, /^window\.\w+\s*=/m, file);
    assert.match(source, /^export \{ [^}]+ \};$/m, `${file} lists its exports`);
  }
});
