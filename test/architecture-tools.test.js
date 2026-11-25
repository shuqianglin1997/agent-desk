const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { maskSource, findFunctions, cssStyleRules, splitSelectors, collect } = require('../scripts/arch-metrics');
const layers = require('../scripts/check-layers');
const { makeTempDir } = require('./helpers/temp');

function tree(t, files) {
  const root = makeTempDir('agentdesk-arch-tools-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}

test('masking hides braces in comments, strings, templates and regular expressions without moving lines', () => {
  const source = [
    "const a = '{'; // }",
    'const b = `x${ { y: 1 }.y }{`; /* { */',
    'const c = /[{}]\\//g.test(a) ? 1 / 2 : 0;',
    'function f() { return "}"; }'
  ].join('\n');
  const code = maskSource(source);
  assert.equal(code.length, source.length);
  assert.equal(code.split('\n').length, source.split('\n').length);
  const opens = (code.match(/\{/g) || []).length;
  const closes = (code.match(/\}/g) || []).length;
  assert.equal(opens, closes);
  assert.equal(opens, 3, 'the ${ } pair, the object literal inside it and the function body remain');
  assert.match(maskSource(source, { keepStrings: true }), /'\{'/);
});

test('function extents cover declarations, methods and block arrows, nested ones counted on their own', () => {
  const source = [
    'function outer(a = f()) {',
    '  const inner = async (x) => {',
    '    return x;',
    '  };',
    '  return inner;',
    '}',
    'class K {',
    '  method(y) {',
    '    if (y) { return 1; }',
    '  }',
    '}',
    'const short = () => 1;'
  ].join('\n');
  const found = Object.fromEntries(findFunctions(source).map((fn) => [fn.name, [fn.line, fn.lines]]));
  assert.deepEqual(found.outer, [1, 6]);
  assert.deepEqual(found.inner, [2, 3]);
  assert.deepEqual(found.method, [8, 3]);
  assert.equal(found.short, undefined, 'expression-bodied arrows are not counted');
  assert.equal(found.if, undefined);
});

test('CSS walker keeps attribute values, splits top-level commas and marks rules inside @media', () => {
  const { rules } = cssStyleRules([
    '/* a { } */',
    ':root[data-theme="dark"], .a:is(.b, .c) { color: red; }',
    '@layer x { .d { --t: 1; } }',
    '@media (max-width: 1px) { .e { color: blue !important; } }',
    '@keyframes k { from { opacity: 0 } to { opacity: 1 } }'
  ].join('\n'));
  assert.deepEqual(rules.map((rule) => [rule.prelude, rule.conditional]), [
    [':root[data-theme="dark"], .a:is(.b, .c)', false], ['.d', false], ['.e', true]
  ]);
  assert.deepEqual(splitSelectors(rules[0].prelude), [':root[data-theme="dark"]', '.a:is(.b, .c)']);
});

test('metrics count the §8 rows on a small tree', (t) => {
  const root = tree(t, {
    'package.json': '{}',
    'src/apps.js': "const APPS = [\n  {\n    id: 'codex',\n  },\n  {\n    id: 'claude-cli',\n  }\n];\n",
    'src/main.js': [
      "const { ipcMain } = require('electron');",
      "require('./helper');",
      "function registerIpc() {",
      "  ipcMain.handle('a:b', () => 1);",
      "  // ipcMain.handle('commented:out', () => 1);",
      "}",
      "function reveal(profile, id) {",
      "  return apps.getApp(profile.appId).scan(profile).find((s) => s.id === id);",
      "}",
      "function isSubpath(a, b) {",
      "  const relative = path.relative(path.resolve(b), path.resolve(a));",
      "  return !relative.startsWith('..');",
      "}",
      "if (appId === 'codex') run();",
      "switch (x) { case 'claude-cli': break; }"
    ].join('\n') + '\n',
    'src/helper.js': "const fs = require('node:fs');\nmodule.exports = () => fs.readFileSync('x');\n",
    'src/renderer.js': "const x = 1;\n",
    'src/index.html': '<link rel="stylesheet" href="./a.css"><link rel="stylesheet" href="./b.css"><script src="./renderer.js"></script>',
    'src/a.css': '.same { color: red; } :root { --tok: 1; }',
    'src/b.css': '.same { color: blue !important; } .only-b { x: y; } :root { --tok: 2; }',
    'test/text.test.js': "const fs = require('node:fs');\nfs.readFileSync('src/renderer.js', 'utf8');\ntest('x', () => {});\n",
    'test/real.test.js': "require('../src/helper');\ntest('y', () => {});\n"
  });
  const metrics = collect(root);
  assert.equal(metrics.mainJsLines, 15);
  assert.equal(metrics.ipcHandleLiterals.mainJs, 1);
  assert.equal(metrics.clientNameComparisonsOutsideApps.total, 2);
  assert.equal(metrics.findSessionByIdAfterRescan.count, 1);
  assert.equal(metrics.pathEqualityOrContainmentHelpers.count, 1);
  assert.equal(metrics.syncCalls.mainProcessTotal, 1);
  assert.equal(metrics.css.selectorsInMoreThanOneSheet, 2, '.same and :root');
  assert.equal(metrics.css.important, 1);
  assert.equal(metrics.css.customPropertiesInMoreThanOneSheet, 1);
  assert.equal(metrics.tests.textOnlyFiles, 1);
  assert.equal(metrics.rendererScripts, 1);
});

test('client ids come from the adapter folders, and comparisons inside them do not count', (t) => {
  const root = tree(t, {
    'package.json': '{}',
    'src/apps.js': "const ADAPTERS = [require('./clients/codex'), require('./clients/kimi-work')];\nif (id === 'codex') x();\n",
    'src/clients/codex/index.js': "module.exports = {\n  id: 'codex',\n};\nif (profile.appId === 'codex') y();\n",
    'src/clients/codex/quota.js': "if (appId === 'codex') z();\n",
    'src/clients/kimi-work/index.js': "module.exports = {\n  id: 'kimi-work',\n};\n",
    'src/main.js': "if (appId === 'kimi-work') a();\nif (appId === 'kimi') b();\n",
    'src/renderer.js': ''
  });
  const metrics = collect(root);
  assert.deepEqual(metrics.clientNameComparisonsOutsideApps, { total: 1, files: { 'src/main.js': 1 } });
});

test('metrics run on this repository and name the files each count comes from', () => {
  const metrics = collect();
  assert.ok(metrics.mainJsLines > 0 && metrics.rendererJsLines > 0);
  assert.ok(metrics.functions.longest.length > 0);
  assert.ok(metrics.findSessionByIdAfterRescan.sites.every((site) => site.file && site.line));
  assert.ok(metrics.pathEqualityOrContainmentHelpers.sites.every((site) => site.file && site.function));
  assert.ok(metrics.css.mainWindowSheets.includes('src/pixel.css'));
});

test('layer check enforces the core and clients layers and unmapped files, and only reports the rest', (t) => {
  const root = tree(t, {
    'src/json-store.js': "require('electron');\nrequire('./activity');\n",
    'src/activity.js': "require('./json-store');\n",
    'src/apps.js': "require('./activity');\n",
    'src/main/recruit-items.js': "require('../renderer');\n",
    'src/renderer.js': '',
    'src/new-file.js': ''
  });
  const report = layers.check(root);
  assert.equal(report.mode, 'core-and-clients-enforced');
  assert.deepEqual(report.enforcedLayers, ['core', 'clients']);
  assert.deepEqual(report.upward.map((edge) => [edge.from, edge.to]).sort(),
    [['src/apps.js', 'src/activity.js'], ['src/json-store.js', 'src/activity.js'], ['src/main/recruit-items.js', 'src/renderer.js']]);
  assert.deepEqual(report.electronBelowServices, [{ file: 'src/json-store.js', layer: 'core' }]);
  assert.deepEqual(report.unmapped, ['src/new-file.js']);
  // commands -> ui is reported but not yet enforced; core and clients are.
  assert.deepEqual(report.enforced.map((item) => [item.rule, item.from || item.file]).sort(),
    [['electron', 'src/json-store.js'], ['unmapped', 'src/new-file.js'], ['upward', 'src/apps.js'], ['upward', 'src/json-store.js']]);
});

test('this repository has no enforced layer violation: core and clients require nothing above them, no electron, every file mapped', () => {
  const report = layers.check();
  assert.deepEqual(report.unmapped, [], 'every new source file needs a layer in scripts/check-layers.js');
  assert.ok(report.relativeRequires > 0);
  assert.equal(report.mode, 'core-and-clients-enforced');
  assert.deepEqual(report.enforced, []);
});
