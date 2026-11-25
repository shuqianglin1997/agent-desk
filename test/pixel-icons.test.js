'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PixelIcons = require('../src/pixel/icons.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('每个像素图标都是 8×8 位图，只含点和井号', () => {
  assert.ok(PixelIcons.names.length >= 20);
  for (const name of PixelIcons.names) {
    const rows = PixelIcons.ICONS[name];
    assert.equal(rows.length, 8, `${name} 必须是 8 行`);
    for (const row of rows) assert.match(row, /^[.#]{8}$/, `${name} 的每行必须是 8 个点或井号`);
    assert.ok(rows.join('').includes('#'), `${name} 不能是空图`);
  }
});

test('图标只生成本地蒙版变量，不引用任何外部地址', () => {
  const css = PixelIcons.stylesheet();
  for (const name of PixelIcons.names) {
    assert.ok(css.includes(`--pxi-${name}:url("data:image/svg+xml;utf8,`), `${name} 缺少蒙版变量`);
    assert.ok(css.includes(`[data-i="${name}"]{--pxi:var(--pxi-${name})}`), `${name} 缺少映射规则`);
  }
  assert.doesNotMatch(css, /https?:|\/\//);
  assert.equal(PixelIcons.svg('不存在'), '');
  assert.match(PixelIcons.svg('copy', 16), /^<svg [^>]*viewBox="0 0 8 8"[^>]*shape-rendering="crispEdges"/);
});

test('界面里用到的图标名都在位图表里', () => {
  const known = new Set(PixelIcons.names);
  const used = new Set();
  for (const file of ['src/index.html', 'src/renderer.js', 'src/pixel/ui.js', 'src/pixel/fx.js']) {
    for (const match of read(file).matchAll(/data-i="([a-z]+)"/g)) used.add(match[1]);
    for (const match of read(file).matchAll(/dataset\.i = '([a-z]+)'/g)) used.add(match[1]);
  }
  for (const match of read('src/pixel.css').matchAll(/var\(--pxi-([a-z]+)\)/g)) used.add(match[1]);
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(known.has(name), `界面引用了未定义的图标：${name}`);
});

test('动效只改位移与透明度，并在减少动态效果时停用', () => {
  const fx = read('src/pixel/fx.js');
  const css = read('src/pixel.css');
  assert.match(fx, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  for (const name of ['burst', 'floatText', 'fly', 'quake', 'act', 'once', 'wipe']) {
    assert.match(fx, new RegExp(`function ${name}\\(.*\\) \\{[\\s\\S]{0,160}?reduced\\(\\)`), `${name} 必须先检查减少动态效果`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // 不计分。声音（2026-11-24 所有者批准）只经过 pixel/sfx.js，动效和界面层不直接碰音频。
  assert.doesNotMatch(fx + read('src/pixel/ui.js'), /new Audio|AudioContext|score|leaderboard/i);
});

test('像素层在页面里的装载顺序固定：图标与动效先于业务脚本，皮肤在分层样式之后', () => {
  const html = read('src/index.html');
  const order = ['./workspace.css', './pixel.css', './pixel/icons.js', './pixel/fx.js', './pixel/ui.js', './renderer.js'];
  let cursor = -1;
  for (const file of order) {
    const index = html.indexOf(file);
    assert.ok(index > cursor, `${file} 的位置不对`);
    cursor = index;
  }
  // 内容安全策略由主进程下发且保持不变：脚本只来自应用自身，图片只允许自身与 data:，
  // 所以图标用 data: 蒙版、猫用画布，不引入任何外部资源。
  const policy = read('src/main/ipc/security-policy.js');
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /img-src 'self' data:/);
  const pixelCss = read('src/pixel.css');
  assert.doesNotMatch(pixelCss, /https?:\/\/|@import/);
  // 点阵字体只从随应用提供的本地文件加载，授权文本和字体放在一起。
  const faces = [...pixelCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map((match) => match[0]);
  assert.equal(faces.length, 2);
  for (const face of faces) {
    const file = face.match(/url\("\.\.\/assets\/fonts\/([a-z0-9_.-]+\.woff2)"\) format\("woff2"\)/);
    assert.ok(file, '字体必须来自 assets/fonts 下的本地 woff2');
    assert.ok(fs.existsSync(path.join(root, 'assets', 'fonts', file[1])), `缺少字体文件 ${file[1]}`);
    assert.match(face, /font-weight:\s*100 900/);
  }
  assert.match(read('assets/fonts/OFL.txt'), /SIL Open Font License|SIL OPEN FONT LICENSE/i);
  assert.match(policy, /font-src 'self'/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
});

test('“台灯下的书桌”：正常与夜间两套暖色都够清楚，看的字是点阵字，复制会盖印', () => {
  const css = read('src/pixel.css');
  const tokensOf = (selector) => {
    const start = css.indexOf(`${selector} {\n  --px-bg:`);
    assert.notEqual(start, -1, `${selector} 的颜色表缺失`);
    const body = css.slice(start, css.indexOf('}', start));
    return Object.fromEntries([...body.matchAll(/--px-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((match) => [match[1], match[2]]));
  };
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  for (const selector of [':root', ':root[data-theme="dark"]']) {
    const t = tokensOf(selector);
    for (const name of ['bg', 'float', 'ink', 'ink-2', 'edge', 'wood', 'on-wood', 'brand', 'brand-deep', 'brand-hi', 'on-brand', 'hl', 'lamp', 'dusk']) {
      assert.ok(t[name], `${selector} 缺少 --px-${name}`);
    }
    assert.ok(contrast(t.ink, t.float) >= 7, `${selector} 正文在纸上不够清楚`);
    assert.ok(contrast(t.ink, t.bg) >= 7, `${selector} 正文在桌面上不够清楚`);
    // 点阵字的笔画只有一格粗：标签和说明在纸上、桌面上都要到 7:1，朱印和木板上的小字到 5.5:1。
    assert.ok(contrast(t['ink-2'], t.float) >= 7, `${selector} 说明文字在纸上不够清楚`);
    assert.ok(contrast(t['ink-2'], t.bg) >= 7, `${selector} 说明文字在桌面上不够清楚`);
    assert.ok(contrast(t['on-brand'], t.brand) >= 5.5, `${selector} 朱印上的字不够清楚`);
    assert.ok(contrast(t['on-wood'], t.wood) >= 5.5, `${selector} 木板上的字不够清楚`);
    // 带颜色的字用加深过的一组；不可用的按钮也要读得出来。
    for (const name of ['brand-ink', 'ok-ink', 'info-ink', 'warn-ink', 'bad-ink', 'focus-ink']) {
      assert.ok(t[name], `${selector} 缺少 --px-${name}`);
      assert.ok(contrast(t[name], t.float) >= 7, `${selector} --px-${name} 在纸上不够清楚`);
    }
    assert.ok(contrast(t.off, t.float) >= 4, `${selector} 不可用按钮的字读不出来`);
    assert.ok(contrast(t.off, t.float) < contrast(t['ink-2'], t.float), `${selector} 不可用的字应当比说明文字浅`);
  }
  // 默认是点阵字，只用原生的 12px 和整两倍的 24px；元素自己设了 --type-* 才换成别的（见“读的字”那项测试）。
  assert.match(css, /--font-sans: "Fusion Pixel"/);
  assert.match(css, /body, body \* \{ font-family: var\(--type-face, var\(--font-sans\)\) !important; -webkit-font-smoothing: var\(--type-smooth, none\) !important;/);
  assert.match(css, /body, body \*:not\(h1\):not\(h2\):not\(h3\)[^{]*\{ font-size: var\(--type-size, 12px\) !important; \}/);
  // 悬停是抖动网点；勾选的行是一档纸色，不再是绿色。
  assert.match(css, /--dither-hl: repeating-conic-gradient\(var\(--px-hl\) 0 25%, transparent 0 50%\) 0 0 \/ 4px 4px;/);
  assert.match(css, /\.session-table tbody tr\.selected \{ background: var\(--px-chk\); \}/);
  // 复制时行尾落一个小红印，系统要求减少动态效果时不出现。
  assert.match(css, /\.fx-seal \{[\s\S]*?animation: fx-seal/);
  const ui = read('src/pixel/ui.js');
  assert.match(ui, /function copied\(keys, label\) \{\s*if \(Fx\.reduced\(\)\) return;[\s\S]*?seal\.className = 'fx-seal'/);
});

test('成句的文字读得清：词距、行高、行宽，带颜色的字不用灯珠的本色', () => {
  const css = read('src/pixel.css');
  // 这套点阵字的空格有一个字母宽，成句的英文要把词距收回去。
  assert.match(css, /body, body \* \{ word-spacing: var\(--type-word, -2px\) !important; \}/);
  assert.match(css, /body p, body li, body \.field-hint, dialog small[^{]*\{ line-height: 20px; \}/);
  assert.match(css, /dialog p, dialog \.field-hint, dialog label > small, dialog span > small \{ max-width: 456px; \}/);
  // 皮肤里没有任何文字直接使用状态色或浅灰：它们只画灯珠、能量格和边框。
  const textColours = [...css.matchAll(/(?<![-\w])color:\s*var\(--px-([a-z0-9-]+)\)/g)].map((match) => match[1]);
  for (const banned of ['ok', 'info', 'warn', 'bad', 'focus', 'mute', 'brand']) {
    assert.ok(!textColours.includes(banned), `文字不应直接使用 --px-${banned}`);
  }
  // 旧样式层里带颜色的文字都改走加深过的那一组，填色和边框照旧。
  for (const file of ['src/workspace.css']) {
    const legacy = read(file);
    assert.doesNotMatch(legacy, /(?<![-\w])color:\s*var\(--(accent|success|warn|danger|focus)\)/, `${file} 仍有文字直接使用状态色`);
  }
  for (const name of ['accent', 'success', 'warn', 'danger', 'focus']) assert.match(css, new RegExp(`--${name}-ink: var\\(--px-`));
  // 顶栏下拉菜单是一张纸，上面的字不能沿用木板上的浅色。
  assert.match(css, /\.app-topbar \.context-menu-panel, \.app-topbar \.context-menu-panel \*[^{]*\{ color: var\(--px-ink\); \}/);
});

test('名册两头不是一刀切：还有猫没露出来的一侧用有序抖动化进桌面', () => {
  const css = read('src/pixel.css');
  const rule = css.slice(css.indexOf('/* ══ 搁板的两头'));
  assert.match(rule, /\.agent-panel \.account-roster \{[\s\S]*?scroll-padding-inline: 72px;[\s\S]*?mask-image: linear-gradient\(#000 0 0\), var\(--px-dissolve-start, [^;]+, var\(--px-dissolve-end, /);
  assert.match(rule, /\[data-more-start="true"\] \{ --roster-fade-start: 64px; \}/);
  assert.match(rule, /\[data-more-end="true"\] \{ --roster-fade-end: 64px; \}/);
  // 两条蒙版和图标一样是本地生成的 data: 图，不引用任何外部地址。
  const sheet = PixelIcons.stylesheet();
  assert.match(sheet, /--px-dissolve-start:url\("data:image\/svg\+xml;utf8,/);
  assert.match(sheet, /--px-dissolve-end:url\("data:image\/svg\+xml;utf8,/);
  // 从实到空：每 8px 一段数出还留着的格子，朝外只减不增；最里面一段几乎是满的，最外面一段几乎是空的。
  const blocks = (rows) => Array.from({ length: 8 }, (_, block) => rows
    .reduce((sum, row) => sum + row.slice(block * 4, block * 4 + 4).filter(Boolean).length, 0));
  const end = PixelIcons.dissolveCells('end');
  const start = PixelIcons.dissolveCells('start');
  assert.equal(end.length, 4);
  assert.ok(end.every((row) => row.length === 32));
  const coverage = blocks(end);
  assert.ok(coverage[0] >= 14 && coverage[7] <= 2, `两端的密度不对：${coverage.join(',')}`);
  for (let index = 1; index < 8; index += 1) assert.ok(coverage[index] <= coverage[index - 1], '靠外的一段不应比靠里的一段更实');
  assert.deepEqual(start, end.map((row) => [...row].reverse()), '左右两条互为镜像');
  // 哪一侧化开由滚动位置决定：滚到头的一侧保持完整。
  const ui = read('src/pixel/ui.js');
  assert.match(ui, /const start = String\(roster\.scrollLeft > 1\);\s*const end = String\(roster\.scrollLeft < hidden - 1\);/);
  assert.match(ui, /roster\.addEventListener\('scroll', queueEdges, \{ passive: true \}\);/);
});

test('读的字与看的字分开：成句的说明和填进去的内容用系统正文字体，标签和按钮仍是点阵字', () => {
  const css = read('src/pixel.css');
  // 正文字体只用系统自带的，不加载任何字体文件。
  const readFace = css.match(/--font-read: ([^;]+);/);
  assert.ok(readFace, '缺少 --font-read');
  assert.match(readFace[1], /^-apple-system, BlinkMacSystemFont, "PingFang SC"/);
  assert.doesNotMatch(readFace[1], /Fusion Pixel|url\(/);
  const section = css.slice(css.indexOf('/* ══ 读的字'));
  // 弹窗里的句子、提示、空状态的话和输入框：13px、照常抗锯齿、不收词距。
  const prose = section.match(/dialog p, dialog small, dialog \.field-hint,[^{]*\{([^}]*)\}/);
  assert.ok(prose, '缺少读的字的规则');
  assert.match(prose[0], /\.account-roster-empty p, \.session-table tr\.empty-row td,/);
  assert.match(prose[0], /input\[type="text"\], input\[type="search"\], input\[type="url"\], input:not\(\[type\]\), textarea \{/);
  assert.match(prose[1], /--type-face: var\(--font-read\);\s*--type-size: 13px;\s*--type-smooth: auto;\s*--type-word: 0px;/);
  // 路径、配对码、诊断输出用等宽字体。
  assert.match(section, /dialog pre, dialog code, dialog output,[^{]*\{\s*--type-face: var\(--font-code\);/);
  // 句子里嵌着的按钮、下拉、标题不跟着换：它们把变量重置掉，回到点阵字。
  assert.match(section, /button, select, summary, h1, h2, h3, h4, th, legend \{ --type-face: initial; --type-size: initial; --type-smooth: initial; --type-word: initial; --type-weight: initial; \}/);
  // 表格正文、卡片、页脚没有被换掉。
  assert.doesNotMatch(prose[0], /\.session-table tbody td|\.account-card|\.status-bar|footer/);
  // 空台面的标题仍是两倍字号，按钮上的字仍是点阵字。
  assert.match(css, /\.account-roster-empty b \{ --type-size: 24px; line-height: 28px; \}/);
  assert.doesNotMatch(css, /\.account-roster-empty span/);
});

