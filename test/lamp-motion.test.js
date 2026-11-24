'use strict';

// 开灯与关灯：逐帧路径、错开间隔、编排在页面里的行为（减少动态效果、被输入打断、关灯回话），
// 主进程的硬上限，以及连成一条的搁板。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const Lamp = require('../src/pixel/boot.js');
const { createWindowLamp, LIMITS } = require('../src/main/window-lamp.js');
const { ProfileRuntimeSupervisor } = require('../src/profile-runtime.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const steps = (values) => values.slice(1).map((value, index) => Math.abs(value - values[index]));

function assertEaseOut(values, label) {
  for (const value of values) assert.ok(Number.isInteger(value) && value % 2 === 0, `${label}: ${value} 不在 2px 格子上`);
  const sizes = steps(values);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index] <= sizes[index - 1], `${label}: 第 ${index + 1} 步比前一步大 ${JSON.stringify(sizes)}`);
    if (sizes[index] > 0) assert.ok(sizes[index] < sizes[index - 1], `${label}: 相邻两步一样大 ${JSON.stringify(sizes)}`);
  }
}

test('逐帧的路：每一帧落在 2px 格子上，先快后慢，步子一帧比一帧小，首尾准确', () => {
  for (const distance of [2, 4, 8, 16, 24, 40, 68, 112, 128, 194, 196, 300, 517]) {
    for (let frames = 3; frames <= 8; frames += 1) {
      for (const [from, to] of [[0, distance], [distance, 0], [-distance, 0], [10, 10 + distance]]) {
        const values = Lamp.path(from, to, frames);
        assert.equal(values.length, frames + 1);
        assert.equal(values[0], Lamp.snap(from));
        assert.equal(values[values.length - 1], Lamp.snap(to));
        assertEaseOut(values, `${from}→${to}/${frames}`);
      }
    }
  }
  assert.equal(Object.is(Lamp.snap(-0.4), -0), false);
});

test('每段动作六到八帧；落下的回弹一次，跳起来的先越过落点再回来', () => {
  const { MOVES } = Lamp;
  for (const [name, values] of [['tag', MOVES.tag], ['cat', MOVES.cat], ['row', MOVES.row], ['leaveCat', MOVES.leaveCat], ['pull', MOVES.pull]]) {
    const frames = values.length - 1;
    assert.ok(frames >= 6 && frames <= 8, `${name} 是 ${frames} 帧`);
    for (const value of values) assert.ok(Math.abs(value) % 2 === 0, `${name} 的 ${value} 不在格子上`);
  }
  for (const frames of [MOVES.shelf, MOVES.ledgerOpen, MOVES.grow, MOVES.slide]) assert.ok(frames >= 6 && frames <= 8);
  assert.ok(MOVES.ledgerClose < MOVES.ledgerOpen, '账本合上比摊开快');
  // 名牌：从搁板后面落下来（先快后慢），落过头一次再回到原位。
  assertEaseOut(MOVES.tag.slice(0, 6), 'tag');
  assert.equal(MOVES.tag[0], -112);
  assert.deepEqual(MOVES.tag.slice(-2), [4, 0], '落过头 4px，再回到原位');
  const firstBelow = MOVES.tag.findIndex((value) => value > 0);
  assert.ok(MOVES.tag.slice(firstBelow).every((value) => value >= 0), '名牌只回弹一次，不来回晃');
  // 猫：从搁板后面（向下 40px）跳上来，越过落点再回来，落地压扁一帧（见 boot.js 的 squash）。
  assertEaseOut(MOVES.cat.slice(0, 6), 'cat');
  assert.ok(MOVES.cat.some((value) => value < 0));
  assert.match(read('src/pixel/boot.js'), /at\(jump \+ CAT_MS, \(\) => squash\(avatar\)\)/);
});

test('一组错开出现：40–60ms 为宜，整组不超过半秒；行太多时间隔缩短但守住半秒', () => {
  const tagMs = (Lamp.MOVES.tag.length - 1) * Lamp.FRAME;
  const rowMs = (Lamp.MOVES.row.length - 1) * Lamp.FRAME;
  assert.equal(Lamp.stagger(1, tagMs), 0);
  for (let count = 2; count <= 7; count += 1) {
    const gap = Lamp.stagger(count, tagMs);
    assert.ok(gap >= 40 && gap <= 60, `${count} 张名牌间隔 ${gap}`);
    assert.ok((count - 1) * gap + tagMs <= 500, `${count} 张名牌超过半秒`);
  }
  // 猫：跳上来再压扁一帧；名册看得见的六个位置（“全部”加五张）也要在半秒内跳完。
  const catMs = (Lamp.MOVES.cat.length - 1) * Lamp.FRAME + Lamp.FRAME;
  const catGap = Lamp.stagger(6, catMs);
  assert.ok(catGap >= 40 && catGap <= 60 && 5 * catGap + catMs <= 500, `六只猫间隔 ${catGap}`);
  assert.match(read('src/pixel/boot.js'), /\], FRAME, options\);/, '压扁只有一帧');
  const rowGap = Lamp.stagger(Lamp.LIMIT.rows, rowMs);
  assert.ok(rowGap >= 24 && (Lamp.LIMIT.rows - 1) * rowGap + rowMs <= 500, `十二行 ${rowGap}`);
  assert.deepEqual(Lamp.TIMELINE.lamp, [60, 140, 220]);
  assert.equal(Lamp.TIMELINE.shelf, 160);
  assert.equal(Lamp.TIMELINE.tags, 300);
  assert.equal(Lamp.TIMELINE.ledger, 700);
  assert.equal(Lamp.TIMELINE.wait, 2000);
});

test('样式里的逐帧动画与同一条路一致：会话行六帧写进来，档案夹三档抽出、两档合上', () => {
  const css = read('src/pixel.css');
  const block = (name) => css.slice(css.indexOf(`@keyframes ${name}`), css.indexOf('}\n}', css.indexOf(`@keyframes ${name}`)) + 3);
  const rows = [...block('lamp-row-in').matchAll(/translate: (-?\d+)(?:px)? 0/g)].map((match) => Number(match[1]));
  assert.deepEqual(rows.slice(0, 5), Lamp.path(-24, 0, 6).slice(0, 5));
  assert.ok(rows.slice(4).every((value) => value === 0));
  assert.match(css, /tr\.fx-in \{ animation: lamp-row-in 192ms linear backwards; animation-delay: calc\(var\(--i\) \* 28ms\); \}/);
  const folder = [...block('lamp-folder').matchAll(/translate: 0 (\d+)(?:px)?;/g)].map((match) => Number(match[1]));
  assert.deepEqual(folder, Lamp.path(40, 0, 3));
  assert.match(css, /dialog\[open\] \{ animation: lamp-folder 144ms linear backwards; \}/);
  assert.match(css, /dialog \{ transition: translate 80ms steps\(2, end\), clip-path 80ms steps\(2, end\), display 80ms allow-discrete, overlay 80ms allow-discrete; \}/);
  // 明暗只用台阶：灯的四档是硬切换，新加的样子里没有透明度渐变。
  const section = css.slice(css.indexOf('/* ══ 开灯与关灯'));
  assert.doesNotMatch(section, /opacity:\s*0(?:\.\d+)?\s*;[^}]*transition|@keyframes[^{]*\{[^}]*opacity/);
  for (const level of ['0', '1', '2']) assert.match(section, new RegExp(`html\\[data-lamp="${level}"\\] body \\{`));
  // 减少动态效果时全局停掉动画与过渡（这里的档案夹和会话行也一样）。
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{\s*animation: none !important;\s*transition: none !important;/);
});

test('搁板连成一条：格子占满卡片，搁板正好等于卡片间距，“全部”接上名册（几种卡数和滚动位置）', () => {
  const css = read('src/pixel.css');
  assert.match(css, /\.agent-panel \.account-card-select,\n\.agent-panel \.account-card-all \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /margin: -2px -14px 0;/);
  const card = { width: 180, margin: 2, padding: 6 };
  const gap = 12;
  const ledge = { overhang: 14 };
  const pitch = card.width + card.margin * 2 + gap;
  const ledgeLeft = (cardLeft) => cardLeft + card.padding - ledge.overhang;
  const ledgeRight = (cardLeft, width = card.width) => cardLeft + width - card.padding + ledge.overhang;
  // 版面：presenter 左 4px，“全部”宽 112 外边距 2；名册左外边距 -6、内边距 6（与 pixel.css 一致）。
  const allLeft = 4 + card.margin;
  const rosterLeft = allLeft + 112 + card.margin + gap - 6;
  const rosterRight = 1032;
  for (const count of [1, 2, 5, 8, 12]) {
    const contentWidth = 6 + count * pitch - gap;
    const maxScroll = Math.max(0, contentWidth - (rosterRight - rosterLeft));
    for (const scroll of [0, Math.round(maxScroll / 3), maxScroll]) {
      const pieces = [[ledgeLeft(allLeft), ledgeRight(allLeft, 112)]];
      for (let index = 0; index < count; index += 1) {
        const left = rosterLeft + 6 + card.margin + index * pitch - scroll;
        const visible = [Math.max(ledgeLeft(left), rosterLeft), Math.min(ledgeRight(left), rosterRight)];
        if (visible[1] > visible[0]) pieces.push(visible);
      }
      const gaps = pieces.slice(1).map((piece, index) => piece[0] - pieces[index][1]);
      assert.ok(gaps.every((value) => value === 0), `${count} 张卡、滚动 ${scroll}：${JSON.stringify(gaps)}`);
    }
  }
  // 名册两头化进桌面时，搁板那一条不化（多出的第四层蒙版）；拿起排序的卡片木板不淡。
  assert.match(css, /mask-position: var\(--roster-fade-start\) 0, left top, right top, 0 var\(--shelf-y, 100px\);/);
  assert.match(css, /\.account-card\.roster-dragging \.account-card-select > :not\(\.account-card-ledge\) \{ opacity: 0\.65; \}/);
});

/* ── 在一个最小的假页面里真正跑 boot.js ─────────────────────────── */
function fakePage({ reducedMotion = false } = {}) {
  let clock = 0;
  const timers = [];
  let timerId = 0;
  const animations = [];
  const listeners = { window: {}, document: {} };
  const observers = [];
  const calls = { done: [] };

  function element(tag = 'div', rect = { left: 0, right: 180, top: 0, bottom: 300, width: 180, height: 300 }) {
    const classes = new Set();
    return {
      tagName: tag.toUpperCase(), dataset: {}, style: { setProperty() {} }, isConnected: true, hidden: false, children: [], textContent: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name)
      },
      getBoundingClientRect: () => rect,
      animate(keys, timing) {
        const handlers = {};
        const animation = {
          keys, timing, startTime: null, state: 'running',
          addEventListener: (type, fn) => { handlers[type] = fn; },
          finish() { animation.state = 'finished'; if (handlers.finish) handlers.finish(); },
          cancel() { animation.state = 'cancelled'; if (handlers.cancel) handlers.cancel(); }
        };
        animations.push(animation);
        return animation;
      },
      contains: () => false, querySelector: () => null, querySelectorAll: () => [], hasAttribute: () => false,
      setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, remove() { this.isConnected = false; }
    };
  }
  const html = element('html');
  const pane = element('section', { left: 0, right: 690, top: 300, bottom: 780, width: 690, height: 480 });
  const footer = element('div');
  const registry = { '.session-pane': [pane], '.footer-status': [footer] };
  const document = {
    documentElement: html, readyState: 'complete', body: element('body'), hidden: false,
    timeline: { get currentTime() { return clock; } },
    querySelector: (selector) => (registry[selector] || [])[0] || null,
    querySelectorAll: (selector) => registry[selector] || [],
    createElement: (tag) => element(tag),
    addEventListener: (type, fn) => { (listeners.document[type] ||= []).push(fn); },
    dispatchEvent: (event) => { for (const fn of listeners.document[event.type] || []) fn(event); return true; }
  };
  const sandbox = {
    document,
    performance: { now: () => clock },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (fn) => sandbox.setTimeout(fn, 16),
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { observers.push({ target, options, callback: this.callback }); }
    },
    setTimeout: (fn, ms = 0) => { timerId += 1; timers.push({ id: timerId, due: clock + Math.max(0, ms), fn }); return timerId; },
    clearTimeout: (id) => { const index = timers.findIndex((item) => item.id === id); if (index >= 0) timers.splice(index, 1); },
    addEventListener: (type, fn) => { (listeners.window[type] ||= []).push(fn); },
    manager: {
      windowShowing: () => Promise.resolve({ kind: 'first' }),
      onWindowLamp: (fn) => { sandbox.__lamp = fn; },
      windowLampDone: (token) => { calls.done.push({ token, at: clock }); }
    },
    Promise, Math, Number, String, Object, Array, Set, Map, WeakMap, JSON, Infinity
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(read('src/pixel/boot.js'), sandbox, { filename: 'boot.js' });

  async function advance(ms) {
    const until = clock + ms;
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const next = timers[0];
      if (!next || next.due > until) break;
      timers.shift();
      clock = next.due;
      next.fn();
    }
    clock = until;
    await new Promise((resolve) => setImmediate(resolve));
  }
  function themeReady() {
    html.dataset.theme = 'light';
    for (const item of observers) if (item.target === html) item.callback([]);
  }
  function input(type = 'pointerdown') {
    for (const fn of listeners.window[type] || []) fn({ type, isTrusted: true });
  }
  return { sandbox, html, pane, animations, calls, advance, themeReady, input, now: () => clock, lamp: () => sandbox.PixelLamp };
}

test('页面：第一帧之前就是夜色；减少动态效果时一律直接出现，开灯、关灯都不产生任何动画', async () => {
  const page = fakePage({ reducedMotion: true });
  assert.equal(page.html.dataset.boot, 'cover');
  assert.equal(page.html.dataset.lamp, '0');
  await page.advance(10);
  page.themeReady();
  await page.advance(10);
  assert.equal(page.html.dataset.lamp, '3');
  assert.equal(page.html.dataset.boot, 'done');
  assert.equal(page.lamp().state().mode, 'instant');
  page.sandbox.__lamp({ step: 'closing', clients: [{ profileId: 'a', name: 'A' }] });
  page.sandbox.__lamp({ step: 'quit', token: 5 });
  assert.equal(page.html.dataset.lamp, '0');
  assert.deepEqual(page.calls.done.map((item) => item.token), [5], '减少动态效果时关灯立刻回话');
  await page.advance(3000);
  assert.equal(page.animations.length, 0, '减少动态效果时不能有任何逐帧动画');
});

test('页面：开灯分三档硬切换，账本逐帧摊开；任何输入直接跳到最后的样子', async () => {
  const page = fakePage();
  await page.advance(5);
  page.themeReady();
  await page.advance(1);
  assert.equal(page.html.dataset.boot, 'run');
  assert.equal(page.html.dataset.lamp, '0');
  const levels = [];
  for (let ms = 0; ms <= 300; ms += 10) { levels.push(page.html.dataset.lamp); await page.advance(10); }
  assert.deepEqual([...new Set(levels)], ['0', '1', '2', '3'], '灯一档一档亮起来');
  await page.advance(500);
  const ledger = page.animations.find((animation) => animation.keys.some((key) => /inset/.test(key.clipPath || '')));
  assert.ok(ledger, '账本在 700ms 摊开');
  assert.ok(ledger.keys.slice(0, -1).every((key) => key.easing === 'steps(1, end)'), '每一帧保持一帧，不插值');
  const heights = ledger.keys.map((key) => Number(/inset\(-4px -6px (-?\d+)px/.exec(key.clipPath)[1]));
  for (const value of heights) assert.ok(Math.abs(value) % 2 === 0, `${value} 不在格子上`);
  assert.equal(page.lamp().state().phase, 'run', '数据还没到时编排停在等待里');
  page.input('keydown');
  assert.equal(page.lamp().state().phase, 'done');
  assert.equal(page.html.dataset.boot, 'done');
  assert.equal(page.html.dataset.lamp, '3');
  assert.ok(page.animations.every((animation) => animation.state !== 'running'), '输入以后没有还在走的动画');
});

test('页面：关灯不到半秒演完并回话；中途有输入立刻关灯回话；退出被拦下灯重新亮起来', async () => {
  const page = fakePage();
  page.themeReady();
  await page.advance(50);
  page.input();
  const levels = [];
  page.sandbox.document.addEventListener('agentdesk:lamp', (event) => { if (event.detail.step === 'lamp') levels.push(event.detail.level); });
  page.sandbox.__lamp({ step: 'closing', clients: [{ profileId: 'a', name: 'A' }, { profileId: 'b', name: 'B' }] });
  assert.equal(page.html.dataset.lamp, '2', '关客户端期间灯留一档');
  page.sandbox.__lamp({ step: 'relight' });
  await page.advance(200);
  assert.equal(page.html.dataset.lamp, '3', '关不掉时灯重新亮起来');
  const start = page.now();
  page.sandbox.__lamp({ step: 'quit', token: 9 });
  await page.advance(600);
  assert.equal(page.calls.done.length, 1);
  assert.equal(page.calls.done[0].token, 9);
  assert.ok(page.calls.done[0].at - start < 500, `关灯用了 ${page.calls.done[0].at - start}ms`);
  assert.equal(page.html.dataset.lamp, '0');
  assert.deepEqual(levels, [2, 3, 2, 1, 0], '灯分档暗下去，一次一档');
  // 中途有输入：直接到最后。
  const second = fakePage();
  second.themeReady();
  await second.advance(50);
  second.input();
  second.sandbox.__lamp({ step: 'quit', token: 3 });
  await second.advance(40);
  second.input('pointerdown');
  assert.equal(second.html.dataset.lamp, '0');
  assert.deepEqual(second.calls.done.map((item) => item.token), [3]);
});

test('页面：每一步都派发有文档的事件，事件名都在 STEPS 里', () => {
  const source = read('src/pixel/boot.js');
  const used = new Set([...source.matchAll(/emit\((?:[^()]*\? )?'([a-z-]+)'(?: : '([a-z-]+)')?/g)].flatMap((match) => [match[1], match[2]]).filter(Boolean));
  for (const name of used) assert.ok(Lamp.STEPS.includes(name), `${name} 不在 STEPS 里`);
  for (const name of ['lamp', 'shelf', 'tag', 'cat', 'ledger-open', 'rows', 'ready', 'closing', 'sleep', 'ledger-close', 'lamp-off', 'relight']) assert.ok(used.has(name), `缺少 ${name}`);
  assert.match(read('docs/INTERNAL.md'), /agentdesk:lamp/);
});

/* ── 主进程：硬上限、只拦一次、关窗 ─────────────────────────── */
function fakeTimers() {
  let clock = 0;
  const list = [];
  return {
    setTimer: (fn, ms) => { const item = { fn, due: clock + ms }; list.push(item); return item; },
    clearTimer: (item) => { const index = list.indexOf(item); if (index >= 0) list.splice(index, 1); },
    async advance(ms) {
      clock += ms;
      for (const item of [...list].sort((a, b) => a.due - b.due)) {
        if (item.due <= clock && list.includes(item)) { list.splice(list.indexOf(item), 1); item.fn(); }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}
function fakeWindow(overrides = {}) {
  const sent = [];
  const handlers = {};
  const win = {
    sent, closed: 0,
    isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }), isLoading: () => false, isDestroyed: () => false },
    on: (type, fn) => { handlers[type] = fn; },
    emit: (type, event) => handlers[type](event),
    close() { win.closed += 1; },
    ...overrides
  };
  return win;
}

test('主进程：关灯等窗口回话，等不到就按硬上限继续；窗口看不见时根本不等', async () => {
  assert.ok(LIMITS.quit <= 1000 && LIMITS.close <= LIMITS.quit);
  const timers = fakeTimers();
  const win = fakeWindow();
  const lamp = createWindowLamp({ getWindow: () => win, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const answered = lamp.play('quit');
  const token = win.sent.at(-1).payload.token;
  assert.equal(win.sent.at(-1).channel, 'window:lamp');
  lamp.done({ token });
  assert.equal(await answered, 'done');
  const silent = lamp.play('quit');
  await timers.advance(LIMITS.quit - 1);
  let settled = false;
  silent.then(() => { settled = true; });
  await timers.advance(0);
  assert.equal(settled, false, '上限之前还在等');
  await timers.advance(1);
  assert.equal(await silent, 'timeout', '窗口不回话时到上限照常继续');
  for (const hidden of [{ isVisible: () => false }, { isMinimized: () => true }, { isDestroyed: () => true }]) {
    const other = createWindowLamp({ getWindow: () => fakeWindow(hidden), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    assert.equal(await other.play('quit'), 'skipped');
  }
  assert.equal(await createWindowLamp({ getWindow: () => null }).play('close'), 'skipped');
});

test('主进程：before-quit 只拦一次来演关灯，退出被拦下后重新亮灯并在下次退出再演', async () => {
  const timers = fakeTimers();
  const win = fakeWindow();
  const lamp = createWindowLamp({ getWindow: () => win, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  let quits = 0;
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  assert.equal(lamp.holdQuit(event, () => { quits += 1; }), true);
  assert.equal(lamp.holdQuit(event, () => { quits += 1; }), true, '演的时候再来的退出也拦着');
  await timers.advance(LIMITS.quit);
  assert.equal(quits, 1);
  assert.equal(lamp.holdQuit(event, () => { quits += 1; }), false, '演过以后放行');
  assert.equal(prevented, 2);
  lamp.relight();
  assert.equal(win.sent.at(-1).payload.step, 'relight');
  assert.equal(lamp.holdQuit(event, () => {}), true, '重新亮灯以后下一次退出再演');
  // 关客户端：只发 AgentDesk 启动、还在运行的那几个，名字只用于页脚显示。
  const count = lamp.closingClients({ ownedActiveProfileIds: () => ['p1', 'p2'] }, [{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Home' }, { id: 'p3', name: 'Idle' }]);
  assert.equal(count, 2);
  assert.deepEqual(win.sent.find((item) => item.payload.step === 'closing').payload.clients, [{ profileId: 'p1', name: 'Work' }, { profileId: 'p2', name: 'Home' }]);
  assert.equal(lamp.closingClients({ ownedActiveProfileIds: () => [] }, []), 0);
});

test('主进程：macOS 关窗先短短关灯再关；其他系统关窗交给退出流程；退出进行中不拦', async () => {
  const timers = fakeTimers();
  const mac = fakeWindow();
  const lamp = createWindowLamp({ getWindow: () => mac, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  let quitting = false;
  lamp.attach(mac, { platform: 'darwin', isQuitting: () => quitting, quit: () => {} });
  let prevented = 0;
  mac.emit('close', { preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.equal(mac.sent.at(-1).payload.step, 'close');
  await timers.advance(LIMITS.close);
  assert.equal(mac.closed, 1, '到上限也会关');
  mac.emit('close', { preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1, '第二次 close 放行');
  assert.equal(lamp.showingKind(), 'first');
  const win = fakeWindow();
  let quits = 0;
  lamp.attach(win, { platform: 'win32', isQuitting: () => quitting, quit: () => { quits += 1; } });
  assert.equal(lamp.showingKind(), 'reopen', '同一进程里第二扇窗是重新打开');
  win.emit('close', { preventDefault: () => { prevented += 1; } });
  assert.equal(quits, 1);
  quitting = true;
  win.emit('close', { preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 2, '退出进行中关窗不再拦');
  // The window's two calls are commands over the lamp (src/commands/window.js).
  const { COMMANDS } = require('../src/commands/window');
  const { runCommand } = require('../src/commands/registry');
  assert.deepEqual(COMMANDS.map((command) => command.channel), ['window:lampDone', 'window:showing']);
  assert.deepEqual(await runCommand(COMMANDS[1], { windowLamp: lamp }, undefined), { kind: 'reopen' });
});

test('监管器：只列出自己启动且仍在运行的 Profile，每关好一个回调一次', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-lamp-'));
  try {
    const supervisor = new ProfileRuntimeSupervisor({ stateFile: path.join(dir, 'runtime.json'), snapshotProcessRecords: () => [] });
    supervisor.profiles.set('a', { id: 'a' });
    supervisor.profiles.set('b', { id: 'b' });
    supervisor.profiles.set('c', { id: 'c' });
    supervisor.records.set('a', { owned: true, active: true });
    supervisor.records.set('b', { owned: false, active: true });
    supervisor.records.set('c', { owned: true, active: true });
    supervisor.records.set('gone', { owned: true, active: true });
    assert.deepEqual(supervisor.ownedActiveProfileIds(), ['a', 'c']);
    supervisor.stopProfile = async (profile) => ({ ok: profile.id !== 'c' });
    const stopped = [];
    const result = await supervisor.stopAll({ terminateOwned: true, reason: 'app-quit', onStopped: (id) => stopped.push(id) });
    assert.equal(result.ok, false);
    assert.deepEqual(stopped, ['a'], '没关掉的不报“关好了”');
    await supervisor.stopAll({ terminateOwned: true, onStopped: () => { throw new Error('ui'); } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('接线：窗口底色是夜色，关客户端前降灯、被拦下亮灯、最后关灯；页面在 <head> 里先盖上夜色', () => {
  const main = read('src/main.js');
  const css = read('src/pixel.css');
  const night = /--lamp-night: (#[0-9A-Fa-f]{6});/.exec(css)[1].toLowerCase();
  assert.match(main, new RegExp(`backgroundColor: '${night}'`));
  assert.match(main, /windowLamp\.attach\(mainWindow, \{ platform: process\.platform, isQuitting: \(\) => appQuitting, quit: \(\) => app\.quit\(\) \}\);/);
  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('function registerIpc()'));
  assert.ok(beforeQuit.indexOf('windowLamp.closingClients(') < beforeQuit.indexOf('stopAll({'), '先降灯再关客户端');
  assert.match(beforeQuit, /onStopped: \(profileId\) => windowLamp\.send\(\{ step: 'closed'/);
  assert.equal((beforeQuit.match(/windowLamp\.relight\(\);/g) || []).length, 2, '两条拦下退出的路都重新亮灯');
  assert.ok(beforeQuit.indexOf('windowLamp.holdQuit(event') < beforeQuit.indexOf('appQuitting = true;'));
  assert.ok(beforeQuit.indexOf('appQuitting = true;') < beforeQuit.indexOf("mainOwner.shutdown('app-quit')"));
  // The window's lamp calls are commands; Main hands them the lamp.
  assert.match(main, /commandDepsCache = \{[\s\S]*?\bwindowLamp\b[\s\S]*?\};/);
  const preload = read('src/preload.js');
  assert.match(preload, /onWindowLamp: \(callback\) => \{/);
  assert.match(preload, /windowLampDone: \(token\) => ipcRenderer\.invoke\('window:lampDone', \{ token: Number\(token\) \|\| 0 \}\)/);
  assert.match(preload, /windowShowing: \(\) => ipcRenderer\.invoke\('window:showing'\)/);
  const html = read('src/index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.indexOf('./pixel.css') < head.indexOf('./pixel/boot.js'), 'boot.js 在样式之后、正文之前');
  const renderer = read('src/renderer.js');
  for (const stage of ['settings-loading', 'profiles-loading', 'task-package-history-loading', 'ready']) {
    assert.match(renderer, new RegExp(`setStartupStage\\('${stage}'`));
  }
  assert.match(renderer, /new CustomEvent\('agentdesk:startup', \{ detail: \{ stage, step \} \}\)/);
  // 会话行只在用户自己的操作之后才演；新猫上场交给 boot.js。
  const ui = read('src/pixel/ui.js');
  assert.match(ui, /const userCaused = !root\.PixelLamp \|\| root\.PixelLamp\.userCaused\(\);/);
  assert.match(ui, /!Fx\.reduced\(\) && !root\.PixelLamp\)/, '有开灯编排时新猫不再自己升起');
  assert.match(ui, /root\.PixelUi = \{[^}]*\bpose\b/, '关灯时让猫睡下要用 PixelUi.pose');
  for (const lang of ['zh', 'en', 'ja']) {
    const locale = read(`src/i18n/${lang}.js`);
    for (const key of ['lamp.wait.settings', 'lamp.wait.devices', 'lamp.wait.profiles', 'lamp.wait.sessions', 'lamp.closing', 'lamp.closing.join', 'lamp.closing.more']) {
      assert.ok(locale.includes(`'${key}':`), `${lang} 缺少 ${key}`);
    }
  }
});
