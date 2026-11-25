'use strict';

/*
 * The recruit dialog ("招募"), drawn to the measurements of the real one at
 * 960×840: 640px wide, centred, a seal for a title, four tabs, and for
 * "New one" a name, a client and the ways that client can sign in.
 * Words come from the app's tables; the hints wrap exactly where 456px puts them.
 */

const app = require('./app.js');
const { ui } = require('./strings.js');

const X = 160, WIDTH = 640;
const TABS = [['recruit.tab.new', 'plus'], ['recruit.tab.existing', 'search'], ['recruit.tab.drop', 'dl'], ['recruit.tab.ai', 'copy']];
// Codex offers three ways to sign in (src/renderer/recruit.js); the first is preselected.
const CODEX_METHODS = [['recruit.method.browser', 'recruit.method.browser.codex'], ['recruit.method.key.codex', 'recruit.method.key.codex.hint'], ['recruit.method.provider', 'recruit.method.provider.hint']];
const half = (value) => Math.round(value * 2) / 2;

function layout(pen, lang) {
  const summary = pen.wrap(ui(lang, 'recruit.summary'), 456, 13);
  const headH = 12 + 38 + 8 + summary.length * 20 + 10 + 2;
  const methods = CODEX_METHODS.map(([title, hint]) => ({ title: ui(lang, title), lines: pen.wrap(ui(lang, hint), 456, 13) }));
  let cursor = headH + 42 + 12 + 60 + 12 + 22;
  const choices = methods.map((method) => { const h = half(37.76 + method.lines.length * 20); const box = { dy: cursor, h, ...method }; cursor += h; return box; });
  const contentEnd = cursor + 14, height = contentEnd + 54;
  const top = half((app.H - height) / 2);
  const create = ui(lang, 'recruit.new.create'), createW = pen.width(create) + 20;
  let tabX = X + 16;
  const tabs = TABS.map(([key, icon]) => { const label = ui(lang, key), w = 10 + 12 + 6 + pen.width(label) + 10; const tab = { x: tabX, y: top + headH + 8, w, h: 32, label, icon }; tabX += w + 6; return tab; });
  const fieldsY = top + headH + 42 + 12;
  return {
    box: { x: X, y: top, w: WIDTH, h: height }, summary, headH, tabs, choices: choices.map((choice) => ({ ...choice, x: X + 18, y: top + choice.dy, w: 594 })),
    name: { x: X + 20, y: fieldsY + 25, w: 290, h: 32 }, client: { x: X + 324, y: fieldsY + 25, w: 290, h: 32 }, fieldsY,
    legendY: fieldsY + 60 + 12, footerY: top + contentEnd,
    primary: { x: X + 620 - createW, y: top + contentEnd + 10, w: createW, h: 32, label: create },
    close: { x: X + 620 - 58, y: top + 22, w: 58, h: 30 }
  };
}

function radio(pen, x, y, on) {
  const P = pen.P;
  pen.rect(x - 2, y - 2, 16, 16, P.edge);
  pen.rect(x, y, 12, 12, P.float);
  if (on) pen.rect(x + 2, y + 2, 8, 8, P.brand);
}

function field(pen, box, focused) {
  const P = pen.P;
  if (focused) { pen.rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, P.focus); pen.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4, P.float); }
  pen.frame(box.x, box.y, box.w, box.h, { fill: P.bg });
}

// state: { rise (0..3, the three steps of a folder pulled out from below), name, caret, focus, method, pressed, status }
function draw(pen, lang, state, L) {
  const P = pen.P, ctx = pen.ctx, lift = [28, 12, 4, 0][Math.min(3, state.rise === undefined ? 3 : state.rise)];
  ctx.fillStyle = P.scrim;
  ctx.fillRect(0, 0, app.W, app.H);
  ctx.save();
  ctx.translate(0, lift);
  const { x, y, w, h } = L.box;
  pen.frame(x, y, w, h, { drop: [6, 8] });
  // Title seal, summary, close.
  const title = ui(lang, 'recruit.title'), titleW = pen.width(title, 24) + 28;
  pen.rect(x + 16, y + 10, titleW + 4, 2, P.edge); pen.rect(x + 16, y + 12, 2, 38, P.edge); pen.rect(x + 18 + titleW, y + 12, 2, 38, P.edge); pen.rect(x + 18, y + 50, titleW, 2, P.edge);
  pen.rect(x + 18, y + 12, titleW, 38, P.brand); pen.rect(x + 18, y + 12, titleW, 2, P.brandHi);
  pen.text(title, x + 32, y + 18, { size: 24, colour: P.onBrand });
  L.summary.forEach((line, i) => pen.read(line, x + 18, y + 58 + i * 20));
  pen.text(ui(lang, 'dialog.close'), L.close.x + L.close.w / 2, L.close.y + 9, { align: 'center' });
  pen.rect(x, y + L.headH - 2, w, 2, P.line);
  // Tabs.
  L.tabs.forEach((tab, k) => {
    const on = k === (state.tab || 0), colour = on ? P.ink : P.ink2;
    pen.icon(tab.icon, tab.x + 10, tab.y + 9, 12, colour);
    pen.text(tab.label, tab.x + 28, tab.y + 9, { colour });
    if (on) pen.rect(tab.x, tab.y + 28, tab.w, 4, P.brand);
  });
  app.dotted(pen, x, x + w, y + L.headH + 40, P.line);
  // Name and client.
  const upper = (text) => (lang === 'en' ? text.toUpperCase() : text);
  pen.text(upper(ui(lang, 'recruit.new.name')), x + 18, L.fieldsY + 3, { colour: P.ink2 });
  pen.text(upper(ui(lang, 'recruit.new.client')), x + 322, L.fieldsY + 3, { colour: P.ink2 });
  field(pen, L.name, state.focus === 'name');
  if (state.name) pen.read(state.name + (state.caret ? '|' : ''), L.name.x + 8, L.name.y + 6);
  else { if (state.caret) pen.rect(L.name.x + 8, L.name.y + 8, 1, 16, P.ink); pen.read(ui(lang, 'recruit.new.namePlaceholder'), L.name.x + 9, L.name.y + 6, { colour: P.ink2 }); }
  field(pen, L.client, false);
  pen.text('Codex', L.client.x + 12, L.client.y + 10);
  for (let k = 0; k < 4; k += 1) { pen.rect(L.client.x + L.client.w - 20 + k, L.client.y + 13 + k, 1.5, 1.5, P.ink); pen.rect(L.client.x + L.client.w - 12 - k, L.client.y + 13 + k, 1.5, 1.5, P.ink); }
  // How to sign in.
  pen.text(ui(lang, 'recruit.new.how'), x + 18, L.legendY + 3, { colour: P.ink2 });
  L.choices.forEach((choice, k) => {
    const on = k === (state.method || 0);
    if (on) pen.rect(choice.x, choice.y + 2, choice.w, choice.h - 2, P.chk);
    app.dotted(pen, choice.x, choice.x + choice.w, choice.y, P.line);
    radio(pen, choice.x + 4, choice.y + 13, on);
    pen.text(choice.title, choice.x + 28, choice.y + 13);
    choice.lines.forEach((line, i) => pen.read(line, choice.x + 28, choice.y + 30 + i * 20, { colour: on ? P.ink : P.ink2 }));
  });
  // Footer: what happened, and the seal.
  app.dotted(pen, x, x + w, L.footerY, P.line);
  if (state.status) {
    const lines = pen.wrap(state.status, L.primary.x - x - 18 - 16, 13);
    lines.forEach((line, i) => pen.read(line, x + 18, L.footerY + 27 - lines.length * 9 + i * 18, { lineHeight: 18 }));
  }
  const b = L.primary;
  pen.seal(b.x, b.y, b.w, b.h, state.pressed);
  pen.text(state.busy ? ui(lang, 'recruit.working') : b.label, b.x + b.w / 2, b.y + 10 + (state.pressed ? 2 : 0), { colour: P.onBrand, align: 'center' });
  ctx.restore();
}

module.exports = { layout, draw };
