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

// The three other ways. Their heights follow their content; the two long ones fill the window as the real ones do.
const DROP_ROWS = [['Claude', 'recruit.drop.dataInPlace', 'recruit.drop.no'], ['Claude CLI', 'recruit.drop.inPlace', 'recruit.drop.file.claude-cli'], ['DSH', 'recruit.drop.inPlace', 'recruit.drop.file.dsh-cli'], ['Codex', 'recruit.drop.inPlace', 'recruit.drop.file.codex']];
// The commands of "Hand to AI", as src/renderer/recruit.js builds them on macOS.
const AI_STEPS = (lang) => [
  ['recruit.ai.step0', 'catshelf=/Applications/Catshelf.app/Contents/MacOS/Catshelf'],
  ['recruit.ai.step1', '"$catshelf" --cli capabilities'],
  ['recruit.ai.step2', '"$catshelf" --cli profiles discover --scan home'],
  ['recruit.ai.step3', '"$catshelf" --cli profiles register --app codex --session-root "$HOME/.codex"'],
  ['recruit.ai.step4', `"$catshelf" --cli profiles create --app claude-cli --name ${ui(lang, 'recruit.ai.work')}`]
];

function layout(pen, lang, tab = 0) {
  const summary = pen.wrap(ui(lang, 'recruit.summary'), 456, 13);
  const headH = 12 + 38 + 8 + summary.length * 20 + 10 + 2;
  const methods = CODEX_METHODS.map(([title, hint]) => ({ title: ui(lang, title), lines: pen.wrap(ui(lang, hint), 456, 13) }));
  let cursor = headH + 42 + 12 + 60 + 12 + 22;
  const choices = methods.map((method) => { const h = half(37.76 + method.lines.length * 20); const box = { dy: cursor, h, ...method }; cursor += h; return box; });
  let contentEnd = cursor + 14;
  if (tab === 1) contentEnd = headH + 42 + 12 + 30 + 10 + 26 + 2 * 72 + 12 + 36 + 14;
  let height = contentEnd + 54;
  if (tab >= 2) { height = app.H - 48; contentEnd = height - 54; }
  const top = half((app.H - height) / 2);
  const primaryLabel = ui(lang, tab === 0 ? 'recruit.new.create' : tab === 1 ? 'recruit.existing.registerN' : tab === 2 ? 'recruit.drop.pick' : 'recruit.ai.copyAll', { n: 2 }), createW = pen.width(primaryLabel) + 20;
  let tabX = X + 16;
  const tabs = TABS.map(([key, icon]) => { const label = ui(lang, key), w = 10 + 12 + 6 + pen.width(label) + 10; const box = { x: tabX, y: top + headH + 8, w, h: 32, label, icon }; tabX += w + 6; return box; });
  const fieldsY = top + headH + 42 + 12, body = top + headH + 42;
  return {
    tab, box: { x: X, y: top, w: WIDTH, h: height }, summary, headH, tabs, choices: choices.map((choice) => ({ ...choice, x: X + 18, y: top + choice.dy, w: 594 })),
    name: { x: X + 20, y: fieldsY + 25, w: 290, h: 32 }, client: { x: X + 324, y: fieldsY + 25, w: 290, h: 32 }, fieldsY, body,
    legendY: fieldsY + 60 + 12, footerY: top + contentEnd,
    primary: { x: X + 620 - createW, y: top + contentEnd + 10, w: createW, h: 32, label: primaryLabel },
    close: { x: X + 620 - 58, y: top + 22, w: 58, h: 30 },
    homes: [0, 1].map((k) => ({ x: X + 18, y: body + 12 + 30 + 10 + 26 + k * 72, w: 594, h: 72 })),
    zone: { x: X + 18, y: body + 14, w: 594, h: 132 }
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

function newOne(pen, lang, state, L) {
  const P = pen.P, x = L.box.x;
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
}

// "Bring back": accounts found in the usual folders, to be registered where they are.
function existing(pen, lang, state, L) {
  const P = pen.P, x = L.box.x, top = L.body + 12;
  pen.read(ui(lang, 'recruit.existing.found', { n: state.homes.length }), x + 18, top + 5);
  const pick = ui(lang, 'recruit.existing.pickFolder'), pickW = pen.width(pick), scan = ui(lang, 'recruit.existing.scanHome'), scanW = pen.width(scan);
  pen.text(pick, x + 612 - pickW, top + 9); pen.icon('folder', x + 612 - pickW - 18, top + 9, 12, P.ink);
  pen.text(scan, x + 612 - pickW - 42 - scanW, top + 9); pen.icon('search', x + 612 - pickW - 60 - scanW, top + 9, 12, P.ink);
  const groupY = top + 40;
  pen.text('Claude CLI', x + 18, groupY + 4); pen.text(String(state.homes.length), x + 18 + pen.width('Claude CLI') + 8, groupY + 4, { colour: P.ink2 });
  pen.rect(x + 18, groupY + 22, 594, 2, P.edge);
  state.homes.forEach((home, k) => {
    const box = L.homes[k];
    pen.rect(box.x + 2, box.y + 9, 16, 16, P.edge); pen.rect(box.x + 4, box.y + 11, 12, 12, P.float);
    if (home.checked) { pen.rect(box.x + 6, box.y + 13, 8, 8, P.brand); pen.icon('check', box.x + 5, box.y + 12, 10, P.onBrand); }
    pen.text(home.identity, box.x + 28, box.y + 11);
    pen.read(home.detail, box.x + 28, box.y + 27, { lineHeight: 18, colour: P.ink2 });
    pen.read(home.path, box.x + 28, box.y + 46, { size: 12, lineHeight: 16, colour: P.ink2, mono: true });
    app.dotted(pen, box.x, box.x + box.w, box.y + box.h - 2, P.line);
  });
  const noteY = L.homes[1].y + 72 + 12;
  pen.rect(x + 18, noteY, 594, 36, P.lo); pen.rect(x + 18, noteY, 4, 36, P.mute);
  pen.icon('pin', x + 30, noteY + 12, 12, P.ink2);
  pen.read(ui(lang, 'recruit.existing.inPlace'), x + 48, noteY + 8, { colour: P.ink });
}

// "Drop in": a folder or a sign-in file, recognised by what is inside it.
function dropIn(pen, lang, state, L) {
  const P = pen.P, x = L.box.x, Z = L.zone;
  pen.rect(Z.x, Z.y, Z.w, Z.h, state.dragging ? P.hl : P.lo);
  const edge = state.dragging ? P.ink : P.edge;
  for (let dx = 0; dx < Z.w; dx += 12) { pen.rect(Z.x + dx, Z.y, Math.min(8, Z.w - dx), 2, edge); pen.rect(Z.x + dx, Z.y + Z.h - 2, Math.min(8, Z.w - dx), 2, edge); }
  for (let dy = 0; dy < Z.h; dy += 12) { pen.rect(Z.x, Z.y + dy, 2, Math.min(8, Z.h - dy), edge); pen.rect(Z.x + Z.w - 2, Z.y + dy, 2, Math.min(8, Z.h - dy), edge); }
  pen.icon('dl', Z.x + Z.w / 2 - 12, Z.y + 20, 24, P.ink2);
  pen.text(ui(lang, 'recruit.drop.zone'), Z.x + Z.w / 2, Z.y + 56, { size: 24, align: 'center' });
  pen.read(ui(lang, 'recruit.drop.zoneHint'), Z.x + Z.w / 2, Z.y + 92, { align: 'center', colour: P.ink2 });
  // What each client accepts.
  const headY = Z.y + Z.h + 12;
  pen.rect(x + 18, headY, 594, 40, P.lo);
  [['recruit.drop.col.client', 22], ['recruit.drop.col.folder', 118], ['recruit.drop.col.file', 320]].forEach(([key, dx]) => pen.text(ui(lang, key), x + dx, headY + 14, { colour: P.ink2 }));
  pen.rect(x + 18, headY + 38, 594, 2, P.edge);
  let rowY = headY + 40;
  DROP_ROWS.forEach(([client, folder, file]) => {
    const lines = pen.wrap(ui(lang, file), 280, 13), rowH = 22 + lines.length * 18;
    pen.text(client, x + 22, rowY + 14);
    pen.read(ui(lang, folder), x + 118, rowY + 10, { lineHeight: 18 });
    lines.forEach((line, i) => pen.read(line, x + 320, rowY + 10 + i * 18, { lineHeight: 18 }));
    app.dotted(pen, x + 18, x + 612, rowY + rowH - 2, P.line);
    rowY += rowH;
  });
}

// "Hand to AI": the command line an AI can run for you.
function handToAi(pen, lang, state, L) {
  const P = pen.P, x = L.box.x, ctx = pen.ctx;
  let y = L.body + 14;
  pen.wrap(ui(lang, 'recruit.ai.lead'), 594, 13).forEach((line) => { pen.read(line, x + 18, y); y += 20; });
  y += 10;
  AI_STEPS(lang).forEach(([title, command], k) => {
    app.dotted(pen, x + 18, x + 612, y, P.line);
    pen.text(String(k + 1), x + 18, y + 16, { colour: P.ink2 });
    pen.text(ui(lang, title), x + 48, y + 16);
    pen.rect(x + 48, y + 34, 490, 32, P.line); pen.rect(x + 50, y + 36, 486, 28, P.lo);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 50, y + 36, 486, 28); ctx.clip();
    pen.read(command, x + 56, y + 40, { size: 13, lineHeight: 20, mono: true });
    ctx.restore();
    pen.icon('copy', x + 558, y + 34, 12, P.ink); pen.text(ui(lang, 'recruit.ai.copy'), x + 576, y + 34);
    y += 74;
  });
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
  const tab = state.tab || 0;
  if (tab === 0) newOne(pen, lang, state, L);
  else if (tab === 1) existing(pen, lang, state, L);
  else if (tab === 2) dropIn(pen, lang, state, L);
  else handToAi(pen, lang, state, L);
  // Footer: what happened, and the seal.
  app.dotted(pen, x, x + w, L.footerY, P.line);
  if (state.status) {
    const lines = pen.wrap(state.status, L.primary.x - x - 18 - 16, 13);
    lines.forEach((line, i) => pen.read(line, x + 18, L.footerY + 27 - lines.length * 9 + i * 18, { lineHeight: 18 }));
  }
  const b = L.primary;
  if (state.primaryOff) {
    pen.rect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, P.mute); pen.rect(b.x, b.y, b.w, b.h, P.float);
    pen.text(ui(lang, 'recruit.existing.register'), b.x + b.w / 2, b.y + 10, { colour: P.off, align: 'center' });
  } else {
    pen.seal(b.x, b.y, b.w, b.h, state.pressed);
    pen.text(state.busy ? ui(lang, 'recruit.working') : b.label, b.x + b.w / 2, b.y + 10 + (state.pressed ? 2 : 0), { colour: P.onBrand, align: 'center' });
  }
  ctx.restore();
}

module.exports = { layout, draw };
