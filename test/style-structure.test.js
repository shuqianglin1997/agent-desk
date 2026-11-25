'use strict';

// Phase 7 of docs/ARCHITECTURE_PLAN.md: one generation of styles. The main
// window loads three sheets; no selector is styled by two of them, every
// variable is defined in one sheet (and once per root state), and
// !important appears only where the list below gives the reason.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cssMetrics, cssStyleRules, splitSelectors } = require('../scripts/arch-metrics');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Every !important in src's stylesheets, with why it has to be one. A new
// !important needs an entry here; removing one removes its entry.
const IMPORTANT = [
  // pixel.css: the skin
  ['src/pixel.css', '[hidden]', ['display'], 'hidden 属性必须压过各部件自己写的 display（按钮、卡片、面板设了 flex 或 grid），带 hidden 的元素一定隐藏'],
  ['src/pixel.css', '*, *::before, *::after', ['animation', 'transition'], '系统要求减少动态效果时，任何部件自己的动画和过渡都要停下'],
  ['src/pixel.css', 'body, body *', ['font-family', '-webkit-font-smoothing', 'letter-spacing', 'font-weight', 'text-shadow'], '点阵字的统一规则：所有文字用同一套字形与渲染，压过各层和部件里写的字体；需要例外的元素通过 --type-* 变量留口'],
  ['src/pixel.css', 'body, body *:not(h1):not(h2):not(h3):not(.topbar-brand):not(.topbar-brand *)', ['font-size'], '点阵字只用 12px（--type-size 可改），压过各层写的字号；标题和品牌字另有规定'],
  ['src/pixel.css', 'body, body *', ['word-spacing'], '点阵字的空格和一个字母一样宽，词距统一收回 2px（--type-word 可改）'],
  ['src/pixel.css', 'dialog h3, .utility-dialog-head h3', ['font-size', 'line-height'], '弹窗标题固定为点阵字的两倍字号 24px、行高 28px，不受各弹窗给标题写的字号影响'],
  ['src/pixel.css', '.topbar-brand, .topbar-brand *', ['font-size'], '顶栏品牌字固定为两倍字号 24px，不受顶栏按钮的字号影响'],
  ['src/pixel.css', '#sessionTitle', ['font-size'], '会话详情的标题是 h2，不在统一字号规则里；固定为 12px，压过各层给标题写的字号'],
  ['src/pixel.css', '.utility-dialog-head h3', ['margin'], '弹窗标题是贴在档案夹上沿的标签，边距固定，压过各弹窗给 h3 写的边距'],
  ['src/pixel.css', '.utility-dialog-head p', ['margin'], '弹窗标签下的说明与标签的间距固定，压过各弹窗给 p 写的边距'],
  ['src/pixel.css', '.recruit-dialog .utility-dialog-head p', ['margin'], '招募弹窗的说明另设边距；与上一条同为 !important，靠更高的特异性胜出'],
  ['src/pixel.css', '.session-filter-clear[hidden]', ['display'], '“清除筛选”隐藏时仍占位（配合 visibility: hidden），搜索框不跳动；要压过 [hidden] 的 display: none !important，靠更高的特异性'],
  ['src/pixel.css', '.session-table .title-cell.is-fresh .title-cell-main', ['text-shadow'], '有新回复的标题用 1px 阴影加粗，要压过统一字形规则的 text-shadow: none !important'],
  // workspace.css: the base layer (the old sheet's rules). In the first layer,
  // these !important win over every other !important, the skin's included.
  ['src/workspace.css', '.quota-message', ['margin', 'color'], '额度提示的边距与颜色。在截取到的状态里不起作用，没有证据证明去掉不改显示，所以保留（规划会话 2026-11-24 已定）。字号已去掉 !important，跟统一字号走（12px）'],
  ['src/workspace.css', '.catalog-local-registration', ['grid-template-columns', 'text-transform'], '本机登记行是复选框加文字的两列、不改大小写，压过弹窗里 label 的通用布局与 text-transform'],
  ['src/workspace.css', '.topbar-actions > [hidden]', ['display'], '顶栏按钮带 hidden 时一定隐藏（第一层的 !important 在所有 !important 里最强）'],
  ['src/workspace.css', '.detail-surface[hidden]', ['display'], '右下详情的各个面带 hidden 时一定隐藏（同上）'],
  ['src/workspace.css', '.visually-hidden', ['position', 'width', 'height', 'padding', 'margin', 'overflow', 'clip', 'white-space', 'border'], '只给读屏用的文字：任何部件样式都不能让它显示出来（通用的视觉隐藏写法）'],
  // the isolated remote windows
  ['src/remote/console.css', '*, *::before, *::after', ['animation-duration', 'transition-duration'], '远控控制台：系统要求减少动态效果时，动画与过渡缩到 0.001ms'],
  ['src/remote/host.css', '*, *::before, *::after', ['animation-duration', 'transition-duration'], '被控端窗口：系统要求减少动态效果时，动画与过渡缩到 0.001ms'],
  ['src/remote/host.css', '.host-error', ['color'], '被控端的错误提示是同意卡片里的一个 p，.consent-card > p 的特异性更高、会把它改成灰色；错误必须是危险色']
];

function importantDeclarations(file) {
  const { text, rules } = cssStyleRules(read(file));
  const found = [];
  for (const rule of rules) {
    const end = text.indexOf('}', rule.declarationsStart);
    const body = text.slice(rule.declarationsStart, end);
    for (const m of body.matchAll(/([-\w]+)\s*:[^;]*!\s*important/g)) found.push(`${file} | ${splitSelectors(rule.prelude).join(', ')} | ${m[1]}`);
  }
  return found;
}

test('the main window loads one generation of styles: three sheets, the old one gone', () => {
  const html = read('src/index.html');
  const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sheets, ['workspace.css', 'pixel.css', 'cats.css']);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/styles.css')), false);
  assert.match(read('src/workspace.css'), /\n@layer base, reset, tokens, shell, components, features, themes;\n/);
  for (const file of ['src/pixel.css', 'src/cats.css']) assert.doesNotMatch(read(file), /^@layer [\w, ]+;/m, `${file} declares no layer order of its own`);
});

test('no selector is styled by two sheets, and every variable is defined in one sheet', () => {
  const metrics = cssMetrics(ROOT);
  assert.deepEqual(metrics.examples.selectors, []);
  assert.equal(metrics.selectorsInMoreThanOneSheet, 0);
  assert.deepEqual(metrics.examples.properties, []);
  assert.equal(metrics.customPropertiesInMoreThanOneSheet, 0);
});

test('each variable is set once for each state of the root (light, dark, a language)', () => {
  const seen = new Map();
  for (const file of ['src/workspace.css', 'src/pixel.css', 'src/cats.css']) {
    const { text, rules } = cssStyleRules(read(file));
    for (const rule of rules) {
      const body = text.slice(rule.declarationsStart, text.indexOf('}', rule.declarationsStart));
      const names = [...body.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[1]);
      for (const selector of splitSelectors(rule.prelude)) {
        if (!/^:root(\[[^\]]+\])*$/.test(selector)) continue; // the root element itself
        for (const name of names) {
          const key = `${rule.conditional ? '@' : ''}${selector} ${name}`;
          assert.ok(!seen.has(key), `${name} is set twice for ${selector} (${seen.get(key)} and ${file})`);
          seen.set(key, file);
        }
      }
    }
  }
  assert.ok(seen.size > 100, 'the palette and the tokens are found');
});

test('!important appears only where the list gives the reason', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .filter((name) => name.endsWith('.css')).map((name) => `src/${name.split(path.sep).join('/')}`).sort();
  const actual = files.flatMap(importantDeclarations).sort();
  const listed = IMPORTANT.flatMap(([file, selector, properties]) => properties.map((p) => `${file} | ${selector} | ${p}`)).sort();
  assert.deepEqual(actual, listed);
  for (const [file, selector, , reason] of IMPORTANT) assert.ok(reason.length >= 12, `${file} ${selector} has a reason`);
  assert.equal(actual.length, 39);
});
