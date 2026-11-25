'use strict';

/*
 * The smaller pieces of the Catshelf window that open over it: the tag menu
 * on a ledger row, the "Send" menu and the "Send to device" dialog, and the
 * part of the edit dialog where a cat's coat, collar and accessory are chosen.
 * Each is drawn to the measurements of the real one at 960×840
 * (reference/capture.js); all words come from the app's tables.
 */

const { CatArt, loop, once } = require('./draw.js');
const app = require('./app.js');
const { ui } = require('./strings.js');

const LIFT = [28, 12, 4, 0];

/* ── Tag menu (right click on a row) ───────────────── */
const TAG_MENU = { w: 168, h: 220 };
function tagMenuLayout(x, y) {
  return { x, y, ...TAG_MENU, items: [0, 1, 2, 3, 4, 5].map((k) => ({ x: x + 4, y: y + 26.5 + k * 32, w: 160, h: 30 })) };
}

function tagMenu(pen, lang, L, state = {}) {
  const P = pen.P;
  pen.frame(L.x, L.y, L.w, L.h, { drop: [4, 4] });
  pen.text(ui(lang, 'marks.picker'), L.x + 12, L.y + 7, { colour: P.ink2 });
  L.items.forEach((item, k) => {
    if (state.hover === k) { pen.rect(item.x, item.y, item.w, item.h, P.hl); pen.rect(item.x, item.y, 2, item.h, P.brand); }
    if (k < 5) pen.icon('tag' + (k + 1), item.x + 8, item.y + 9, 12, P.tag[k]);
    pen.text(k < 5 ? ui(lang, 'marks.color.' + (k + 1)) : ui(lang, 'marks.none'), item.x + 28, item.y + 9);
    pen.text(String((k + 1) % 6), item.x + 146, item.y + 9, { colour: P.ink2 });
  });
}

/* ── "Send" menu ───────────────────────────────────── */
function sendMenuLayout() {
  return { x: 694, y: 330, w: 236, h: 96, device: { x: 698, y: 334, w: 228, h: 42 }, pack: { x: 698, y: 378, w: 228, h: 44 } };
}

function sendMenu(pen, lang, state = {}) {
  const P = pen.P, L = sendMenuLayout();
  pen.frame(L.x, L.y, L.w, L.h, { drop: [4, 6] });
  if (state.hover === 'device') pen.dither(L.device.x, L.device.y, L.device.w, L.device.h, P.hl, 8);
  pen.icon('pin', 706, 342, 12, P.ink);
  pen.text(ui(lang, 'session.sendInfo'), 730, 340, { colour: P.ink });
  pen.read(ui(lang, 'hub.menu.send.hint'), 730, 354, { size: 12, lineHeight: 16, colour: P.ink2 });
  app.dotted(pen, 698, 926, 378, P.line);
  pen.icon('box', 706, 388, 12, P.ink);
  pen.text(ui(lang, 'taskPackage.action'), 730, 386, { colour: P.ink });
  pen.read(ui(lang, 'hub.menu.package.hint'), 730, 400, { size: 12, lineHeight: 16, colour: P.ink2 });
}

/* ── "Send to device" ──────────────────────────────── */
function sendDialogLayout(pen, lang) {
  const send = ui(lang, 'transfers.sendSessions'), sendW = pen.width(send) + 20, done = ui(lang, 'dialog.done'), doneW = pen.width(done) + 20;
  const x = 200, w = 560, body = pen.wrap(ui(lang, 'transfers.pointerBody'), 520, 13), y = 275 - (body.length - 1) * 10;
  const controls = y + 100 + body.length * 20;
  return {
    box: { x, y, w, h: 270 + body.length * 20 }, body,
    select: { x: x + 20, y: controls + 26, w: w - 40 - sendW - 12, h: 32 },
    send: { x: x + w - 20 - sendW, y: controls + 26, w: sendW, h: 32, label: send },
    status: { x: x + 18, y: controls + 72, w: 456, h: 34 },
    done: { x: x + w - 20 - doneW, y: controls + 140, w: doneW, h: 32, label: done }, controls
  };
}

// state: { rise, device, status, tone, pressed }
function sendDialog(pen, lang, L, state) {
  const P = pen.P, ctx = pen.ctx, { x, y, w, h } = L.box;
  ctx.fillStyle = P.scrim; ctx.fillRect(0, 0, app.W, app.H);
  ctx.save(); ctx.translate(0, LIFT[Math.min(3, state.rise === undefined ? 3 : state.rise)]);
  pen.frame(x, y, w, h, { drop: [6, 8] });
  pen.text(ui(lang, 'transfers.kicker'), x + 18, y + 22, { colour: P.brandInk });
  pen.text(ui(lang, 'transfers.title'), x + 18, y + 40, { size: 24 });
  L.body.forEach((line, i) => pen.read(line, x + 18, y + 70 + i * 20));
  pen.text(lang === 'en' ? ui(lang, 'transfers.target').toUpperCase() : ui(lang, 'transfers.target'), x + 18, L.controls + 3, { colour: P.ink2 });
  const S = L.select;
  pen.rect(S.x - 4, S.y - 4, S.w + 8, S.h + 8, P.focus); pen.rect(S.x - 2, S.y - 2, S.w + 4, S.h + 4, P.float);
  pen.frame(S.x, S.y, S.w, S.h, { fill: P.bg });
  pen.text(state.device, S.x + 12, S.y + 10);
  for (let k = 0; k < 4; k += 1) { pen.rect(S.x + S.w - 20 + k, S.y + 13 + k, 1.5, 1.5, P.ink); pen.rect(S.x + S.w - 12 - k, S.y + 13 + k, 1.5, 1.5, P.ink); }
  pen.seal(L.send.x, L.send.y, L.send.w, L.send.h, state.pressed);
  pen.text(L.send.label, L.send.x + L.send.w / 2, L.send.y + 10 + (state.pressed ? 2 : 0), { colour: P.onBrand, align: 'center' });
  pen.rect(L.status.x, L.status.y, L.status.w, L.status.h, P.line); pen.rect(L.status.x + 1, L.status.y + 1, L.status.w - 2, L.status.h - 2, P.lo);
  if (state.tone === 'ok') pen.rect(L.status.x, L.status.y, 4, L.status.h, P.ok);
  pen.read(state.status, L.status.x + 12, L.status.y + 7, { colour: P.ink });
  pen.rect(x + 18, L.controls + 124, w - 36, 1, P.line);
  pen.seal(L.done.x, L.done.y, L.done.w, L.done.h, false);
  pen.text(L.done.label, L.done.x + L.done.w / 2, L.done.y + 10, { colour: P.onBrand, align: 'center' });
  ctx.restore();
}

/* ── Edit dialog: the cat's appearance ─────────────── */
const LOOK_IDS = Object.keys(CatArt.LOOKS);
const GROUPS = [['cat.group.home', LOOK_IDS.slice(0, 12), 264, 477.5], ['cat.group.storied', LOOK_IDS.slice(12, 19), 264, 541], ['cat.group.client', LOOK_IDS.slice(19), 596, 541]];
const COLLARS = ['#c94f2e', '#2f9e8f', '#d9a53a', '#3d6aa8', '#8a6bb8', '#6d9440', '#2b2018'];
const ACCESSORIES = ['none', 'scarf', 'bow', 'tie', 'bell', 'glasses', 'shades', 'straw', 'beret', 'bamboo', 'phones', 'flower'];

function editLayout() {
  const looks = {};
  GROUPS.forEach(([, ids, x, y]) => ids.forEach((id, i) => { looks[id] = { x: x + i * 46, y: y + 17.5, w: 44, h: 40 }; }));
  const accessories = {};
  ACCESSORIES.forEach((id, i) => { accessories[id] = { x: 264 + i * 46, y: 686, w: 44, h: 40 }; });
  return { box: { x: 100, y: 30, w: 760, h: 780 }, looks, accessories, collars: COLLARS.map((colour, i) => ({ x: 264 + i * 30, y: 629, w: 26, h: 26, colour })) };
}

function tile(pen, box, on) {
  const P = pen.P;
  pen.rect(box.x, box.y, box.w, box.h, on ? P.ink : P.line);
  pen.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, P.bg);
  if (on) pen.rect(box.x + 2, box.y + box.h - 6, box.w - 4, 4, P.brand);
}

// state: { rise, look, collar, accessory, changed (seconds since the last change), t }
function editDialog(pen, lang, L, state) {
  const P = pen.P, ctx = pen.ctx, { x, y, w, h } = L.box;
  ctx.fillStyle = P.scrim; ctx.fillRect(0, 0, app.W, app.H);
  ctx.save(); ctx.translate(0, LIFT[Math.min(3, state.rise === undefined ? 3 : state.rise)]);
  pen.frame(x, y, w, h, { drop: [6, 8] });
  pen.text(ui(lang, 'dialog.editProfile.title'), x + 18, y + 22, { size: 24 });
  // The note field just above the appearance.
  pen.text(lang === 'en' ? ui(lang, 'dialog.field.note').toUpperCase() : ui(lang, 'dialog.field.note'), 118, 347, { colour: P.ink2 });
  pen.frame(118, 366, 724, 78, { fill: P.bg });
  pen.read(ui(lang, 'dialog.ph.editNote'), 128, 374, { colour: P.ink2 });
  // Preview: the cat as it will look, on its own bit of shelf.
  const look = CatArt.LOOKS[state.look];
  const spec = once('hop', state.changed) || loop('onduty', state.t);
  pen.cat(state.look, spec, 124, 468, { cell: 6, collar: state.collar || undefined, accessory: state.accessory === 'none' ? (look.accessory || 'none') : state.accessory, headroom: 2 });
  pen.rect(120, 576, 128, 2, P.edge); pen.rect(120, 586, 128, 2, P.edge); pen.rect(120, 578, 128, 8, P.wood); pen.rect(120, 578, 128, 2, P.woodHi); pen.rect(120, 584, 128, 2, P.woodLo);
  pen.text(ui(lang, 'cat.breed.' + state.look), 184, 597.5, { align: 'center' });
  pen.text(ui(lang, 'dialog.random'), 184, 627, { align: 'center' });
  // Coat.
  pen.text(ui(lang, 'dialog.cc.breed'), 264, 457.5);
  GROUPS.forEach(([key, ids, gx, gy]) => {
    pen.text(ui(lang, key), gx, gy + 1.5, { colour: P.ink2 });
    ids.forEach((id) => {
      const box = L.looks[id];
      tile(pen, box, id === state.look);
      pen.cat(id, CatArt.ACTIONS.onduty.frames[0], box.x + 2, box.y + 2, { cell: 2, accessory: CatArt.LOOKS[id].accessory || 'none' });
    });
  });
  // Collar.
  pen.text(ui(lang, 'dialog.cc.collar'), 264, 610);
  L.collars.forEach((box) => {
    const on = (state.collar || look.collar || '#c94f2e').toLowerCase() === box.colour;
    pen.rect(box.x, box.y, box.w, box.h, on ? P.ink : P.line); pen.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, P.bg); pen.rect(box.x + 5, box.y + 5, box.w - 10, box.h - 10, box.colour);
  });
  // Accessory.
  pen.text(ui(lang, 'dialog.cc.accessory'), 264, 667);
  ACCESSORIES.forEach((id) => {
    const box = L.accessories[id];
    tile(pen, box, id === state.accessory);
    pen.cat(state.look, CatArt.ACTIONS.onduty.frames[0], box.x + 2, box.y + 2, { cell: 2, collar: state.collar || undefined, accessory: id });
  });
  pen.rect(118, 742, 724, 1, P.line);
  const save = ui(lang, 'dialog.save'), saveW = pen.width(save) + 24;
  pen.seal(842 - saveW, 757, saveW, 32, false);
  pen.text(save, 842 - saveW / 2, 767, { colour: P.onBrand, align: 'center' });
  pen.text(ui(lang, 'dialog.cancel'), 842 - saveW - 24, 767, { align: 'right' });
  ctx.restore();
}

module.exports = { tagMenu, tagMenuLayout, sendMenu, sendMenuLayout, sendDialog, sendDialogLayout, editDialog, editLayout, LOOK_IDS, ACCESSORIES, COLLARS };
