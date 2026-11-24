'use strict';

// 调度中枢在界面上的样子：账本里的行、状态灯、搁板上的点线、桌面上飞的东西。
// 行为在不显示窗口的真实界面里另行核对；这里守住接线与规矩。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rendererSource } = require('./helpers/renderer-source');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('pure helpers: elapsed time and who-called-whom never present a label as a cat', () => {
  global.self = {};
  require('../src/renderer/hub.js');
  const Ui = global.self.AgentHubUi;
  delete global.self;
  assert.equal(Ui.formatElapsed(0), '0:00');
  assert.equal(Ui.formatElapsed(112000), '1:52');
  assert.equal(Ui.formatElapsed(3725000), '1:02:05');
  assert.equal(Ui.elapsedOf({ state: 'completed', startedAt: '2026-11-24T10:00:00Z', endedAt: '2026-11-24T10:01:52Z' }), 112000);
  const t = (key, params = {}) => ({ 'hub.pair': `${params.from} → ${params.to}`, 'hub.from.label': `“${params.label}”`, 'hub.from.unknown': 'unnamed' }[key] || key);
  const names = { 'p-claude': 'Claude 个人' };
  const ctx = { t, nameOf: (id) => names[id] || null };
  assert.equal(Ui.pairText({ caller: { id: 'p-claude', via: 'account-home' }, from: 'whatever', target: { name: 'Codex 工作' } }, ctx), 'Claude 个人 → Codex 工作');
  assert.equal(Ui.pairText({ caller: null, from: 'Claude 个人', target: { name: 'Codex 工作' } }, ctx), '“Claude 个人” → Codex 工作');
  assert.equal(Ui.pairText({ caller: null, from: null, target: { name: 'Codex 工作' } }, ctx), 'unnamed → Codex 工作');
});

test('the desk motion follows the approved rules: three at once, interruptible, never in the background', () => {
  const desk = read('src/pixel/desk.js');
  assert.match(desk, /const MAX_AT_ONCE = 3;/);
  assert.match(desk, /const STEPS = 12;/);
  assert.match(desk, /!reduced\(\) && foreground\(\) && flights\.size < MAX_AT_ONCE/);
  assert.match(desk, /addEventListener\('pointerdown', \(event\) => \{ if \(event\.isTrusted\) finishAll\(\); \}, true\)/);
  assert.match(desk, /addEventListener\('keydown', \(event\) => \{ if \(event\.isTrusted\) finishAll\(\); \}, true\)/);
  assert.match(desk, /visibilitychange[\s\S]*finishAll/);
  assert.match(desk, /Math\.round\(value \/ 2\) \* 2/);
  const css = read('src/pixel.css');
  const hub = css.slice(css.indexOf('/* ══ 后台对话（调度中枢）'));
  assert.match(hub, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hub-lamp\[data-state="running"\] \{ animation: none;[\s\S]*\.hub-link \{ animation: none; \}/);
  for (const state of ['starting', 'running', 'completed', 'failed', 'stopped']) assert.match(hub, new RegExp(`\\.hub-lamp\\[data-state="${state}"\\]`));
  assert.doesNotMatch(hub, /https?:|border-radius:\s*[1-9]/);
});

test('run state is pushed by Main at each transition, never polled by the Renderer', () => {
  const main = require('./helpers/main-handler-source').mainHandlerSource();
  assert.match(main, /function notifyHubChanged\(record = null\)[\s\S]*(?:main\.)?mainWindow\.webContents\.send\('hub:changed', run \? \{ run: \{ \.\.\.run, cwd: undefined \} \} : \{\}\)/);
  assert.match(read('src/preload.js'), /onHubChanged: \(callback\) => \{\s*const listener = \(_event, payload\) => callback\(payload && typeof payload === 'object' \? payload : \{\}\);/);
  const renderer = rendererSource();
  assert.match(renderer, /window\.manager\.onHubChanged\(\(payload\) => applyHubChange\(payload\?\.run\)\)/);
  // The only interval is the local clock for the elapsed time; it never asks Main for data.
  const ticker = renderer.slice(renderer.indexOf('function ensureHubTicker()'), renderer.indexOf('// ── 交接：发送到另一台电脑'));
  assert.doesNotMatch(ticker, /window\.manager/);
  assert.equal((renderer.match(/window\.manager\.hubState\(\)/g) || []).length, 1);
});

test('copies show no arrival; hand-offs only move on a real send, receipt or incoming transfer', () => {
  const renderer = rendererSource();
  // Copy keeps the stamp and the slip into the footer (pixel/ui.js); nothing here animates an arrival for it.
  assert.doesNotMatch(renderer.slice(renderer.indexOf('// ── 调度中枢：后台对话在台面上的样子')), /copySessionInfo|session\.copy/);
  assert.match(renderer, /if \(result\?\.ok && result\.transfer\?\.transferId\) \{\s*\/\/ 信封等送出的弹窗合上以后/);
  assert.match(renderer, /els\.sessionSendDialog\?\.addEventListener\('close', \(\) => deskSendFlights\(\)\);/);
  assert.match(renderer, /if \(now\.state === 'completed' && before\.get\(entry\.transferId\) !== 'completed' && entry\.flown && !entry\.delivered\)/);
  assert.match(renderer, /const DESK_PENDING = new Set\(\['queued', 'sending', 'awaiting-ack'\]\);/);
});

test('sounds reuse existing ones through ui.js; failure sounds through the status error mark', () => {
  const sfx = require('../src/pixel/sfx.js');
  assert.equal(sfx.EVENTS['hub.start'].sound, 'send');
  assert.equal(sfx.EVENTS['hub.arrive'].sound, 'arrive');
  assert.equal(sfx.EVENTS['hub.done'].sound, 'ready');
  assert.match(read('src/pixel/ui.js'), /function hubSound\(kind\) \{\s*cue\(kind === 'outside' \? 'hub\.arrive' : kind === 'done' \? 'hub\.done' : 'hub\.start'\);/);
  assert.match(rendererSource(), /setStatus\(tr\('hub\.say\.failed'[\s\S]{0,160}\), 'error'\);/);
});

test('one background chat is one ledger record, and its strings exist in all three languages', () => {
  const renderer = rendererSource();
  assert.match(renderer, /: \[\.\.\.withHubRuns\(state\.sessions\)\];/);
  assert.match(renderer, /if \(session\._hubRun\) \{\s*const row = renderHubRow\(session\);/);
  const keys = ['hub.kind', 'hub.pair', 'hub.from.label', 'hub.from.unknown', 'hub.from.declared', 'hub.stop', 'hub.stop.title', 'hub.stopFailed',
    'hub.state.starting', 'hub.state.running', 'hub.state.completed', 'hub.state.failed', 'hub.state.stopped', 'hub.elapsed.running', 'hub.elapsed.done',
    'hub.access.read', 'hub.access.write', 'hub.say.started', 'hub.say.startedOutside', 'hub.say.done', 'hub.say.failed', 'hub.say.stopped',
    'hub.footer.running', 'transfers.delivered', 'transfers.parked'];
  for (const lang of ['zh', 'en', 'ja']) {
    const locale = read(`src/i18n/${lang}.js`);
    for (const key of keys) assert.match(locale, new RegExp(`'${key.replace(/\./g, '\\.')}': '[^']+'`), `${lang} 缺少 ${key}`);
  }
  const html = read('src/index.html');
  const order = ['./pixel/sfx.js', './pixel/desk.js', './renderer/hub.js', './pixel/ui.js', './renderer.js'];
  let cursor = -1;
  for (const file of order) {
    const index = html.indexOf(`<script src="${file}"></script>`);
    assert.ok(index > cursor, `${file} 的位置不对`);
    cursor = index;
  }
});
