'use strict';

/*
 * The Catshelf window, drawn.
 *
 * Positions, sizes, colours and words follow the real window at 960×840
 * (measured with reference/capture.js): the 58px top bar, the shelf at y=142,
 * nameplates hanging under it, the ledger from y=290, the 38px footer.
 * One thing is narrower than in the app so that six cats fit one 16:9 frame:
 * a nameplate is 126px wide here (172px in the app); what is written on it,
 * and where each line sits, is the same.
 *
 * drawWindow(pen, state) draws one frame from a plain state object; the
 * layout helpers return the boxes the cursor clicks on.
 */

const { DAY, CatArt } = require('./draw.js');
const { ui, FILM } = require('./strings.js');

const W = 960, H = 840;
const TOP = 58, FOOT_Y = 802, SHELF_Y = 142, PLATE_Y = 154, PLATE_H = 111;
const ALL = { x: 26, w: 112 };
const CARD = { first: 140, w: 134, pitch: 134 };   // the article box; the paper is 4px inside on each side
const LEDGER = { x: 22, y: 290, w: 916, h: 502, toolbar: 40, head: 33 };
const NIGHT_DESK = '#140E11';

// The roster scrolls sideways when there are more cats than fit: `scroll` is how far the cards have moved left.
const cardX = (k, scroll = 0) => CARD.first + CARD.pitch * k - scroll;
const cardCentre = (k, scroll = 0) => cardX(k, scroll) + CARD.w / 2;
const ROSTER_LEFT = 138, ROSTER_RIGHT = 952;
const upper = (lang, text) => (lang === 'en' ? text.toUpperCase() : text);

/* ── Desk and lamp ─────────────────────────────────── */
function ellipse(pen, cx, cy, rx, ry, colour, yMin = 0, yMax = H) {
  for (let y = Math.max(yMin, Math.floor((cy - ry) / 2) * 2); y < Math.min(yMax, cy + ry); y += 2) {
    const k = 1 - Math.pow((y + 1 - cy) / ry, 2);
    if (k <= 0) continue;
    const half = Math.round(rx * Math.sqrt(k) / 2) * 2;
    pen.rect(Math.max(0, cx - half), y, Math.min(W, cx + half) - Math.max(0, cx - half), 2, colour);
  }
}

// The four lamp levels of src/pixel.css: 0 night, 1 a small pool under the lamp, 2 the desk without the core, 3 as usual.
function desk(pen, lamp) {
  const P = pen.P;
  if (lamp <= 1) {
    pen.rect(0, 0, W, H, NIGHT_DESK);
    if (lamp === 1) ellipse(pen, 480, 252, 0.30 * W * 0.62, 0.26 * H * 0.62, P.lamp);
    return;
  }
  pen.rect(0, 0, W, H, P.dusk);
  ellipse(pen, 480, 286, 0.96 * W * 0.74, 0.86 * H * 0.74, P.bg);
  if (lamp >= 3) ellipse(pen, 480, 252, 0.62 * W * 0.62, 0.54 * H * 0.62, P.lamp);
}

/* ── Top bar ───────────────────────────────────────── */
function navLayout(pen, lang) {
  const system = ui(lang, 'topbar.system'), inbox = ui(lang, 'topbar.activity');
  const systemW = 7 + 12 + 5 + pen.width(system) + 7, inboxW = 7 + 12 + 5 + pen.width(inbox) + 7;
  const systemX = 946 - systemW, inboxX = systemX - 2 - inboxW;
  return { system: { x: systemX, y: 15, w: systemW, h: 28, label: system }, inbox: { x: inboxX, y: 15, w: inboxW, h: 28, label: inbox } };
}

function topbar(pen, lang, dy = 0) {
  const P = pen.P, y = dy;
  pen.rect(0, y + TOP + 2, W, 4, P.shade);
  pen.rect(0, y + TOP, W, 2, P.edge);
  pen.rect(0, y, W, TOP, P.wood);
  pen.rect(0, y, W, 2, P.woodHi);
  pen.rect(0, y + TOP - 4, W, 4, P.woodLo);
  // The window's own controls: macOS draws them over the bar at (15, 22).
  const ctx = pen.ctx;
  [['#FF5F57', '#E0443E'], ['#FEBC2E', '#DEA123'], ['#28C840', '#1AAB29']].forEach(([fill, ring], k) => {
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(21 + k * 20, y + 28, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(21 + k * 20, y + 28, 5.5, 0, Math.PI * 2); ctx.fill();
  });
  const cat = pen.text('Cat', 82, y + 17, { size: 24, colour: P.onWood });
  pen.text('shelf', 82 + cat, y + 17, { size: 24, colour: P.woodAccent });
  // Device lens: this computer.
  pen.rect(347, y + 46, 216, 2, P.onWood);
  pen.icon('device', 353, y + 23, 12, P.onWood);
  pen.text(ui(lang, 'devices.device.local'), 372, y + 23, { colour: P.onWood });
  pen.icon('caret', 545, y + 23, 12, P.onWood);
  const nav = navLayout(pen, lang);
  pen.icon('inbox', nav.inbox.x + 7, y + 23, 12, P.onWood);
  pen.text(nav.inbox.label, nav.inbox.x + 24, y + 23, { colour: P.onWood });
  pen.icon('gear', nav.system.x + 7, y + 23, 12, P.onWood);
  pen.text(nav.system.label, nav.system.x + 24, y + 23, { colour: P.onWood });
}

/* ── The row above the shelf: "Accounts ×n", quota overview, recruit ── */
function headLayout(pen, lang, quotaChip) {
  const recruit = ui(lang, 'roster.recruit'), recruitW = 6 + 12 + 5 + pen.width(recruit) + 6, recruitX = 940 - recruitW;
  const quota = ui(lang, 'quotaMap.title'), quotaW = 6 + pen.width(quota) + 6 + 24 + 6;
  return { recruit: { x: recruitX, y: 61, w: recruitW, h: 22, label: recruit }, quota: quotaChip ? { x: recruitX - 2 - quotaW, y: 61, w: quotaW, h: 22, label: quota } : null };
}

function presenterHead(pen, lang, count, quotaChip, hover) {
  const P = pen.P, L = headLayout(pen, lang, quotaChip);
  const title = upper(lang, ui(lang, 'presenter.title'));
  const titleW = pen.text(title, 20, 66, { colour: P.ink2 });
  pen.text('×' + count, 20 + titleW + 8, 66, { colour: P.ink2 });
  if (L.quota) {
    const w = pen.text(L.quota.label, L.quota.x + 6, 66, { colour: P.ink2 });
    pen.rect(L.quota.x + 12 + w, 65, 24, 14, P.bg);
    pen.text('—', L.quota.x + 24 + w, 66, { colour: P.ink2, align: 'center' });
  }
  if (hover === 'recruit') pen.dither(L.recruit.x, L.recruit.y, L.recruit.w, L.recruit.h, P.hl, 8);
  pen.icon('plus', L.recruit.x + 6, 66, 12, P.ink);
  pen.text(L.recruit.label, L.recruit.x + 23, 66, { colour: P.ink });
}

/* ── Shelf ─────────────────────────────────────────── */
function ledge(pen, x0, x1, y = SHELF_Y) {
  const P = pen.P, w = x1 - x0;
  if (w <= 0) return;
  pen.rect(x0, y + 10, w, 4, P.shade);
  pen.rect(x0, y - 2, w, 2, P.edge); pen.rect(x0, y + 8, w, 2, P.edge);
  pen.rect(x0, y, w, 8, P.wood);
  pen.rect(x0, y, w, 2, P.woodHi); pen.rect(x0, y + 6, w, 2, P.woodLo);
}

// A cat in its pit: the 80×80 canvas of the card (two rows of headroom), cut off below the shelf line.
function pitCat(pen, centre, cat, top = SHELF_Y - 80) {
  if (!cat || !cat.spec) return;
  const ctx = pen.ctx;
  ctx.save();
  ctx.beginPath(); ctx.rect(centre - 44, top - 60, 88, 80 + 60); ctx.clip();
  pen.cat(cat.look, cat.spec, centre - 40, top + 8, { cell: 4, collar: cat.collar, accessory: cat.accessory, papers: cat.papers, headroom: 2 });
  ctx.restore();
}

function plate(pen, x, w, h, dy, selected) {
  const P = pen.P, y = PLATE_Y + dy;
  pen.rect(x + 22, SHELF_Y + 4, 2, 10 + Math.max(0, dy), P.edge);
  pen.rect(x + w - 24, SHELF_Y + 4, 2, 10 + Math.max(0, dy), P.edge);
  pen.frame(x, y, w, h, { lip: true });
  if (selected) { pen.rect(x + 2, y + 2, w - 4, 4, P.brand); }
}

const DOT = { working: 'ok', busy: 'warn', frantic: 'bad', onduty: 'info', arriving: 'warn', play: 'brand', confused: 'bad' };
const PIP = { fresh: 'ok', steady: 'info', tired: 'warn', exhausted: 'bad' };

function lampDot(pen, x, y, colour) {
  pen.rect(x - 2, y - 2, 12, 12, pen.P.edge);
  pen.rect(x, y, 8, 8, colour);
}

function pips(pen, x, y, count, level) {
  const P = pen.P;
  for (let k = 0; k < 5; k += 1) {
    const px = x + k * 12;
    if (k < count) {
      pen.rect(px, y, 10, 8, P.edge);
      pen.rect(px + 2, y + 2, 6, 4, P[PIP[level] || 'ok']);
      pen.ctx.fillStyle = 'rgba(255,255,255,0.42)';
      pen.ctx.fillRect(px + 2, y + 2, 6, 2); pen.ctx.fillRect(px + 2, y + 4, 2, 2);
    } else {
      pen.rect(px, y, 10, 8, P.mute);
      pen.rect(px + 2, y + 2, 6, 4, P.float);
    }
  }
}

function cardLayout(pen, lang, k, scroll = 0) {
  const x = cardX(k, scroll), centre = x + CARD.w / 2;
  const open = ui(lang, 'account.open'), manage = ui(lang, 'account.manageShort');
  const openW = 8 + 10 + 5 + pen.width(open) + 8, manageW = 8 + pen.width(manage) + 8, total = openW + 2 + manageW;
  const left = Math.round(centre - total / 2);
  return {
    x, centre, paper: { x: x + 4, y: PLATE_Y, w: CARD.w - 8, h: PLATE_H },
    select: { x: x + 6, y: 74, w: CARD.w - 12, h: 123 },
    launch: { x: left, y: 238, w: openW, h: 24, label: open },
    manage: { x: left + openW + 2, y: 238, w: manageW, h: 24, label: manage }
  };
}

function card(pen, lang, k, account, scroll = 0) {
  const P = pen.P, L = cardLayout(pen, lang, k, scroll), dy = account.plateDy || 0, ctx = pen.ctx;
  if (account.plateDy === null || account.plateDy === undefined) return;
  if (L.x + CARD.w < ROSTER_LEFT || L.x > ROSTER_RIGHT) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(L.x - 8, SHELF_Y + 8, CARD.w + 16, H); ctx.clip();
  plate(pen, L.paper.x, L.paper.w, L.paper.h, dy, account.selected);
  const centre = L.centre;
  pen.text(account.name, centre, 165.5 + dy, { align: 'center' });
  // What it is doing: one lamp bead and one line.
  const label = account.state.label, labelW = pen.width(label), stateX = Math.round(centre - (8 + 6 + labelW) / 2);
  lampDot(pen, stateX, 185.5 + dy, P[DOT[account.state.dot]] || P.mute);
  pen.text(label, stateX + 14, 183 + dy, { colour: P.ink2 });
  // How much energy is left.
  const quota = account.quota, quotaW = 58 + 6 + pen.width(quota.text), quotaX = Math.round(centre - quotaW / 2);
  pips(pen, quotaX, 203 + dy, quota.pips, quota.level);
  pen.text(quota.text, quotaX + 64, 201 + dy, { colour: P.ink2 });
  // Where it runs.
  const place = ui(lang, 'devices.device.local') + ' · ' + account.client, placeW = 10 + 4 + pen.width(place), placeX = Math.round(centre - placeW / 2);
  pen.icon('pin', placeX, 221 + dy, 10, P.ink2);
  pen.text(place, placeX + 14, 220 + dy, { colour: P.ink2 });
  // Open, dossier.
  const b = L.launch, press = account.pressed ? 2 : 0;
  if (account.selected) {
    pen.seal(b.x, b.y + dy, b.w, b.h, account.pressed);
    pen.icon('play', b.x + 8, b.y + 7 + dy + press, 10, P.onBrand);
    pen.text(b.label, b.x + 23, b.y + 5 + dy + press, { colour: P.onBrand });
  } else {
    if (account.hover === 'launch' || account.pressed) pen.dither(b.x, b.y + dy, b.w, b.h, P.hl, account.pressed ? 16 : 8);
    pen.icon('play', b.x + 8, b.y + 7 + dy, 10, P.ink);
    pen.text(b.label, b.x + 23, b.y + 6 + dy, { colour: P.ink });
  }
  pen.text(L.manage.label, L.manage.x + 8, L.manage.y + 6 + dy, { colour: P.ink });
  ctx.restore();
}

function allCard(pen, lang, roster) {
  const P = pen.P, dy = roster.allDy || 0, ctx = pen.ctx;
  if (roster.allDy === null) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(ALL.x - 8, SHELF_Y + 8, ALL.w + 16, H); ctx.clip();
  plate(pen, ALL.x + 4, ALL.w - 8, 45, dy, roster.scope === 'all');
  pen.text(ui(lang, 'roster.all'), ALL.x + ALL.w / 2, 165.5 + dy, { align: 'center' });
  pen.text(roster.allMeta, ALL.x + ALL.w / 2, 183 + dy, { align: 'center', colour: P.ink2 });
  ctx.restore();
}

// "All": a still group photo of three cats (src/pixel/ui.js drawAll).
function groupPhoto(pen) {
  for (const [look, dx, dy] of [['cow', -2, 26], ['black', 42, 26], ['orange', 20, 44]]) {
    pen.cat(look, CatArt.ACTIONS.onduty.frames[5], 42 + dx, 62 + dy, { cell: 2, collar: '#2f9e8f', accessory: 'none' });
  }
}

// The selection corners around the chosen card (#rosterBracket).
function bracket(pen, x, y, w, h) {
  const c = pen.P.brand;
  for (const [bx, by, top, left] of [[x, y, 1, 1], [x + w - 12, y, 1, 0], [x, y + h - 12, 0, 1], [x + w - 12, y + h - 12, 0, 0]]) {
    pen.rect(bx, top ? by : by + 9, 12, 3, c);
    pen.rect(left ? bx : bx + 9, by, 3, 12, c);
  }
}

// Cards sliding out under "All" melt into the desk in an ordered dither instead of being cut (the app's dissolve strip).
function dissolve(pen, state, x0, width) {
  const ctx = pen.ctx, BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  ctx.save();
  ctx.beginPath();
  for (let y = 56; y < 276; y += 2) for (let x = x0; x < x0 + width; x += 2) {
    const solid = 1 - (x - x0 + 1) / width;
    if (solid > (BAYER[(y / 2) & 3][((x - x0) / 2) & 3] + 0.5) / 16) ctx.rect(x, y, 2, 2);
  }
  ctx.clip();
  desk(pen, state.lamp);
  ctx.restore();
}

// A call in progress: short dashes along the middle of the plank, flowing toward the cat that was called.
function hubLinks(pen, r, t) {
  const scroll = r.scroll || 0;
  for (const link of r.links || []) {
    const from = cardCentre(link.from, scroll), to = cardCentre(link.to, scroll), left = Math.min(from, to), right = Math.max(from, to);
    const shift = (Math.floor(t * 6) % 3) * 12 * (to > from ? 1 : -1);
    for (let x = left - 36 + ((shift % 36) + 36) % 36; x < right; x += 36) {
      const a = Math.max(left, x), b = Math.min(right, x + 6);
      if (b > a && a >= ROSTER_LEFT) pen.rect(a, SHELF_Y + 3, b - a, 2, pen.P.woodAccent);
    }
  }
}

function mailBadge(pen, x, count) {
  const P = pen.P, w = 3 + 12 + 3 + pen.width(String(count)) + 4;
  pen.frame(x + 6, 80, w, 18, { bevel: false });
  pen.icon('mail', x + 9, 83, 12, P.brandInk);
  pen.text(String(count), x + 24, 83, { colour: P.brandInk });
}

const shownAccount = (a) => (a.plateDy !== null && a.plateDy !== undefined) || Boolean(a.cat);
function shelfEnd(r) {
  if (r.shelfEnd !== undefined) return r.shelfEnd;
  const last = r.accounts.reduce((n, a, k) => (shownAccount(a) ? k : n), -1);
  return last < 0 ? ALL.x + ALL.w + 8 : Math.min(ROSTER_RIGHT, cardX(last, r.scroll || 0) + CARD.w + 8);
}

function roster(pen, lang, state) {
  const r = state.roster, accounts = r.accounts, scroll = r.scroll || 0, ctx = pen.ctx;
  ctx.save(); ctx.beginPath(); ctx.rect(ROSTER_LEFT, 0, W - ROSTER_LEFT, H); ctx.clip();
  accounts.forEach((account, k) => card(pen, lang, k, account, scroll));
  accounts.forEach((account, k) => { const centre = cardCentre(k, scroll); if (centre > ROSTER_LEFT - 44 && centre < W + 44) pitCat(pen, centre, account.cat); });
  accounts.forEach((account, k) => { if (account.mail && account.plateDy === 0) mailBadge(pen, cardX(k, scroll), account.mail); });
  if (scroll > 0) dissolve(pen, state, ROSTER_LEFT, 56);
  ctx.restore();
  allCard(pen, lang, r);
  if (r.photo !== false) groupPhoto(pen);
  ledge(pen, 18, shelfEnd(r));
  hubLinks(pen, r, state.t || 0);
  if (r.bracket !== false) {
    if (r.scope === 'all') bracket(pen, ALL.x - 6, 68, ALL.w + 12, 139);
    else if (Number.isInteger(r.scope) && accounts[r.scope] && accounts[r.scope].plateDy === 0) bracket(pen, cardX(r.scope, scroll) - 6, 68, CARD.w + 12, 205);
  }
}

// The cats and the shelf once more, over anything drawn across the window since (the links to the clients pass behind the cats).
function catsAgain(pen, state) {
  if (!state.roster) return;
  const r = state.roster, scroll = r.scroll || 0;
  if (r.photo !== false) groupPhoto(pen);
  r.accounts.forEach((account, k) => pitCat(pen, cardCentre(k, scroll), account.cat));
  ledge(pen, 18, shelfEnd(r));
  hubLinks(pen, r, state.t || 0);
}

/* ── The desk before the first cat ─────────────────── */
function emptyLayout(pen, lang) {
  const label = ui(lang, 'roster.recruitFirst');
  return { button: { x: 168, y: 212.5, w: 10 + 10 + 6 + pen.width(label) + 10, h: 26, label } };
}

function emptyDesk(pen, lang, empty) {
  const P = pen.P, L = emptyLayout(pen, lang);
  if (empty.seat > 0) ledge(pen, 30, 30 + Math.round(132 * empty.seat / 2) * 2, 191.5);
  if (empty.cat) pitCat(pen, 96, empty.cat, 191.5 - 80);
  if (empty.seat > 0) ledge(pen, 30, 30 + Math.round(132 * empty.seat / 2) * 2, 191.5);
  if (!empty.words) return;
  pen.text(ui(lang, 'roster.empty.title'), 166, 133.5, { size: 24 });
  pen.wrap(ui(lang, 'roster.empty.lead'), 456, 13).forEach((line, i) => pen.read(line, 166, 163.5 + i * 19.5, { lineHeight: 19.5 }));
  const b = L.button, press = empty.pressed ? 2 : 0;
  pen.seal(b.x, b.y, b.w, b.h, empty.pressed);
  pen.icon('plus', b.x + 10, b.y + 6.5 + press, 10, P.onBrand);
  pen.text(b.label, b.x + 26, b.y + 5.5 + press, { colour: P.onBrand });
}

/* ── The ledger ────────────────────────────────────── */
function checkbox(pen, x, y, checked) {
  const P = pen.P;
  pen.frame(x, y, 14, 14, { fill: checked ? P.brand : P.float, bevel: !checked });
  if (checked) pen.icon('check', x + 1, y + 1, 12, P.onBrand);
}

function dotted(pen, x0, x1, y, colour) {
  pen.ctx.fillStyle = colour;
  for (let x = Math.ceil(x0 / 4) * 4; x < x1; x += 4) pen.ctx.fillRect(x, y, 2, 2);
}

function toolbarLayout(pen, lang, ledger) {
  const title = ledger.title, chipW = pen.width(title) + 18;
  const count = String(ledger.count), countX = 34 + chipW + 16;
  const picked = ledger.checked || 0;
  const fresh = ui(lang, 'marks.fresh'), freshCount = String(ledger.fresh || 0);
  const copyLabel = picked > 1 ? ui(lang, 'session.copyInfoCount', { n: picked }) : ui(lang, 'session.copyInfo');
  const copyW = 10 + 12 + 13 + pen.width(copyLabel) + 10;
  const send = ui(lang, 'session.actions.send'), open = ui(lang, 'session.actions.openDirectory'), exportLabel = ui(lang, 'session.actions.export');
  const view = ui(lang, 'session.view.compact'), viewW = Math.max(74, pen.width(view) + 50);
  const clear = ledger.filter !== undefined && ledger.filter !== null ? ui(lang, 'marks.clear') : '', clearW = clear ? pen.width(clear) + 12 : 0;
  const selection = picked ? { count: ui(lang, 'session.selection.count', { n: picked }), tag: ui(lang, 'marks.tagChecked') } : null;
  const selectionW = selection ? 14 + pen.width(selection.count) + 6 + pen.width(selection.tag) + 10 + 4 + 23 : 0;
  const right = 930;
  // The app fits a crowded bar in steps: first "New reply" keeps only its bubble and count, then the side actions keep only their icons.
  const widths = (fit) => {
    const freshW = fit >= 1 ? 5 + 12 + 6 + pen.width(freshCount) + 5 : 5 + 12 + 12 + pen.width(fresh) + 4 + pen.width(freshCount) + 5;
    const openW = fit >= 2 ? 26 : 7 + 12 + 5 + pen.width(open) + 7, exportW = fit >= 2 ? 26 : 7 + 12 + 5 + pen.width(exportLabel) + 7;
    const sendW = fit >= 2 ? 7 + 12 + 6 + 10 + 7 : 7 + 12 + 13 + pen.width(send) + 6 + 10 + 7;
    return { freshW, openW, exportW, sendW };
  };
  let fit = 0, w = widths(0);
  const filtersX = Math.max(143, countX + pen.width(count) + 14);
  const need = (v) => filtersX + v.freshW + 12 + 5 * 26 + clearW + 14 + 70 + 4 + viewW + 8 + (selection ? selectionW + 4 : 0) + copyW + 4 + v.openW + 2 + v.exportW + 2 + v.sendW;
  while (fit < 2 && need(w) > right) { fit += 1; w = widths(fit); }
  const tagsX = filtersX + w.freshW + 12, tagsEnd = tagsX + 5 * 26 + clearW;
  const sendX = right - w.sendW, exportX = sendX - 2 - w.exportW, openX = exportX - 2 - w.openW, copyX = openX - 4 - copyW;
  const selectionX = selection ? copyX - 4 - selectionW : copyX;
  const viewX = selectionX - 8 - viewW, searchX = tagsEnd + 14, searchW = Math.max(60, Math.min(170, viewX - 4 - searchX));
  return {
    fit, chip: { x: 34, y: 299.5, w: chipW, h: 23 }, countX,
    fresh: { x: filtersX, y: 298, w: w.freshW, h: 26, label: fresh, count: freshCount }, sepX: filtersX + w.freshW + 5,
    tags: [0, 1, 2, 3, 4].map((k) => ({ x: tagsX + k * 26, y: 298, w: 24, h: 26 })), clear: clear ? { x: tagsX + 5 * 26 + 2, y: 298, w: clearW, h: 26, label: clear } : null,
    search: { x: searchX, y: 297, w: searchW, h: 28 }, view: { x: viewX, y: 298, w: viewW, h: 26, label: view },
    selection: selection ? { x: selectionX, y: 300, w: selectionW, h: 22, ...selection } : null,
    copy: { x: copyX, y: 299, w: copyW, h: 24, label: copyLabel }, open: { x: openX, y: 298, w: w.openW, h: 26, label: open },
    export: { x: exportX, y: 298, w: w.exportW, h: 26, label: exportLabel }, send: { x: sendX, y: 298, w: w.sendW, h: 26, label: send }
  };
}

const rowHeight = (ledger) => (ledger.twoLine ? 37.5 : 36);
const rowTop = (ledger, n) => LEDGER.y + LEDGER.toolbar + LEDGER.head + Math.round(n * rowHeight(ledger) * 2) / 2;
// Where on a row its checkbox, its title and its end sit (for the cursor and for things that land on a row).
function rowLayout(ledger, n) {
  const top = rowTop(ledger, n), h = rowHeight(ledger);
  return { top, h, box: { x: 44, y: top + (ledger.twoLine ? 11.5 : 11), w: 14, h: 14 }, title: { x: 108, y: top + (ledger.twoLine ? 4.5 : 11.5) }, end: { x: LEDGER.x + LEDGER.w - 34, y: top + h / 2 } };
}

// The lamp of a background chat: empty while starting, seal red blinking while running, green when done.
function hubLamp(pen, x, y, state, t) {
  const P = pen.P;
  pen.rect(x - 2, y - 2, 14, 14, P.edge);
  pen.rect(x, y, 10, 10, state === 'completed' ? P.ok : state === 'running' ? (Math.floor(t * 4) % 2 ? P.line : P.brand) : P.float);
}

function ledgerRow(pen, lang, ledger, row, n, t) {
  const P = pen.P, { x, w } = LEDGER, ctx = pen.ctx, rh = rowHeight(ledger), top = rowTop(ledger, n), dx = row.dx || 0;
  if (row.checked) pen.rect(x, top, w, rh - 2, P.chk);
  if (row.lit) pen.rect(x, top, w, rh - 2, P.hl);
  else if (row.hover) pen.dither(x, top, w, rh - 2, P.hl, 8);
  ctx.save(); ctx.beginPath(); ctx.rect(x, top, w, rh); ctx.clip();
  const L = rowLayout(ledger, n), titleTop = L.title.y;
  if (row.hub) {
    hubLamp(pen, 110 + dx, titleTop + 1, row.hub.state, t);
    pen.text(row.title, 128 + dx, titleTop, { colour: P.ink });
    const kind = ui(lang, 'hub.kind'), kindW = pen.width(kind) + 8;
    pen.rect(76 + dx, top + 21, kindW, 14, P.line); pen.rect(78 + dx, top + 23, kindW - 4, 10, row.lit ? P.hl : P.float);
    pen.text(kind, 80 + dx, top + 22, { colour: P.ink });
    pen.text(row.hub.pair, 76 + dx + kindW + 6, top + 22, { colour: P.ink2 });
    const mid = top + 12.5, folderW = pen.text(row.project, 527.5 + dx, mid, { colour: P.ink });
    pen.text(ui(lang, 'hub.access.read'), 527.5 + dx + folderW + 6, mid, { colour: P.ink2 });
    if (row.hub.state === 'completed') {
      pen.text(row.when, 822 + dx, mid, { colour: P.ink, align: 'right' });
      pen.text(ui(lang, 'hub.state.completed'), 842 + dx, mid, { colour: P.okInk });
    } else {
      pen.text(row.hub.state === 'starting' ? ui(lang, 'hub.state.starting') : ui(lang, 'hub.elapsed.running', { t: row.hub.elapsed }), 822 + dx, mid, { colour: P.ink, align: 'right' });
      const stop = ui(lang, 'hub.stop'), stopW = 6 + 8 + 4 + pen.width(stop) + 6;
      pen.rect(842 + dx, top + 7.5, stopW, 22, P.brand); pen.rect(844 + dx, top + 9.5, stopW - 4, 18, row.lit ? P.hl : P.float);
      pen.icon('x', 848 + dx, top + 14.5, 8, P.brandInk);
      pen.text(stop, 860 + dx, top + 12.5, { colour: P.brandInk });
    }
  } else {
    const big = row.stamp === 2 ? 4 : row.stamp === 1 ? -1 : 0;
    pen.frame(L.box.x + dx - big, L.box.y - big, 14 + big * 2, 14 + big * 2, { fill: row.checked ? P.brand : P.float, bevel: !row.checked });
    if (row.checked) pen.icon('check', L.box.x + dx + 1 - big, L.box.y + 1 - big, 12 + big * 2, P.onBrand);
    if (row.tag !== undefined && row.tag !== null) pen.icon('tag' + (row.tag + 1), 76 + dx, titleTop - 0.5, 12, P.tag[row.tag]);
    if (row.fresh) pen.icon('reply', 92 + dx, titleTop - 0.5 - (row.pop || 0), 12, P.brand);
    // Still writing: three dots that come on one after another (mark-dot, 0.9 s a round).
    else if (row.running) for (let d = 0; d < 3; d += 1) { if ((((t - d * 0.3) % 0.9) + 0.9) % 0.9 >= 0.3) pen.rect(93 + dx + d * 4, titleTop + 8, 2, 2, P.okInk); }
    const titleW = pen.text(row.title, 108 + dx, titleTop, { colour: P.ink });
    if (row.fresh) {
      pen.text(row.title, 108.5 + dx, titleTop, { colour: P.ink });
      const label = ui(lang, 'marks.row.fresh'), lw = pen.width(label);
      pen.rect(112 + dx + titleW, titleTop - 2, lw + 8, 16, P.brand);
      pen.text(label, 116 + dx + titleW, titleTop, { colour: P.onBrand });
    } else if (row.running) pen.text(ui(lang, 'marks.row.running'), 112 + dx + titleW, titleTop, { colour: P.okInk });
    if (row.tagButton) {
      const label = ui(lang, 'marks.tagButton'), lw = pen.width(label) + 12;
      pen.rect(507 - lw, top + (rh - 22) / 2, lw, 20, P.ink2); pen.rect(509 - lw, top + (rh - 22) / 2 + 2, lw - 4, 16, row.lit ? P.hl : P.float);
      pen.text(label, 513 - lw, top + (rh - 22) / 2 + 4, { colour: P.ink });
    }
    if (ledger.twoLine) pen.text(row.owner, 76 + dx, top + 23, { colour: P.ink2 });
    const mid = top + (ledger.twoLine ? 12.5 : 11.5);
    pen.text(row.project, 527.5 + dx, mid, { colour: P.ink });
    pen.text(row.when, 822 + dx, mid, { colour: P.ink, align: 'right' });
    pen.text(row.source, 842 + dx, mid, { colour: P.ink2 });
  }
  ctx.restore();
  dotted(pen, x, x + w, top + rh - 2, P.line);
}

function ledgerPane(pen, lang, ledger, t = 0) {
  const P = pen.P, { x, y, w, h } = LEDGER, ctx = pen.ctx;
  const openH = Math.round(h * (ledger.open === undefined ? 1 : ledger.open) / 2) * 2;
  if (openH <= 0) return;
  pen.frame(x, y, w, openH, { lip: true });
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, openH); ctx.clip();
  const T = toolbarLayout(pen, lang, ledger), active = (ledger.checked || 0) > 0;
  // Bookmark: what is listed, and how many.
  pen.rect(T.chip.x, T.chip.y, T.chip.w, T.chip.h, P.edge);
  pen.text(ledger.title, T.chip.x + 9, 305.5, { colour: P.float });
  pen.text(String(ledger.count), T.countX, 305.5, { colour: P.brandDeep });
  // Marks: new replies and the five tags. A pressed filter is a filled band with an ink ring.
  const pressed = (box) => { pen.rect(box.x, box.y, box.w, box.h, P.ink); pen.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, P.chk); };
  if (ledger.filter === 'fresh') pressed(T.fresh);
  pen.icon('reply', T.fresh.x + 5, 305 - (ledger.freshPop || 0), 12, P.brand);
  if (T.fit >= 1) pen.text(T.fresh.count, T.fresh.x + 23, 305, { colour: P.brandDeep });
  else { const fw = pen.text(T.fresh.label, T.fresh.x + 29, 305, { colour: P.ink2 }); pen.text(T.fresh.count, T.fresh.x + 33 + fw, 305, { colour: P.brandDeep }); }
  pen.rect(T.sepX, 303, 2, 16, P.line);
  T.tags.forEach((tag, k) => {
    if (ledger.filter === k) pressed(tag);
    else if (ledger.hover === 'tag' + k) pen.dither(tag.x, tag.y, tag.w, tag.h, P.hl, 8);
    pen.icon('tag' + (k + 1), tag.x + 6, 305, 12, P.tag[k]);
  });
  if (T.clear) { pen.text(T.clear.label, T.clear.x + 6, 305, { colour: P.brandInk }); pen.rect(T.clear.x + 6, 319, T.clear.w - 12, 1, P.brandInk); }
  // Search.
  const S = T.search, query = ledger.query || '';
  pen.rect(S.x, S.y + 26, S.w, 2, ledger.searching ? P.focus : P.ink2);
  pen.icon('search', S.x + 4, 305, 12, P.ink2);
  ctx.save(); ctx.beginPath(); ctx.rect(S.x + 22, S.y, S.w - 26, S.h); ctx.clip();
  if (query || ledger.searching) pen.read(query + (ledger.caret ? '|' : ''), S.x + 22, 301, { lineHeight: 20 });
  else pen.text(ui(lang, 'session.search'), S.x + 22, 305, { colour: P.ink2 });
  ctx.restore();
  pen.text(T.view.label, T.view.x + 25, 305, { colour: P.ink });
  if (T.selection) {
    const X = T.selection, cw = pen.text(X.count, X.x + 14, 305, { colour: P.ink2 });
    const tw = pen.text(X.tag, X.x + 20 + cw, 305, { colour: P.ink });
    pen.rect(X.x + 20 + cw, 319, tw, 1, P.ink);
    pen.text('×', X.x + X.w - 16, 305, { colour: P.ink });
  }
  // Actions: copy is the one seal of this region; it lights up when a row is picked.
  const C = T.copy, sink = ledger.copyPressed ? 2 : 0;
  if (active) {
    pen.seal(C.x, C.y, C.w, C.h, ledger.copyPressed);
    pen.icon('copy', C.x + 10, C.y + 5 + sink, 12, P.onBrand);
    pen.text(C.label, C.x + 35, C.y + 5 + sink, { colour: P.onBrand });
  } else {
    pen.icon('copy', C.x + 10, C.y + 6, 12, P.off);
    pen.text(C.label, C.x + 35, C.y + 6, { colour: P.off });
  }
  const side = active ? P.ink : P.off;
  pen.icon('folder', T.open.x + 7, 305, 12, side); if (T.fit < 2) pen.text(T.open.label, T.open.x + 24, 305, { colour: side });
  pen.icon('box', T.export.x + 7, 305, 12, side); if (T.fit < 2) pen.text(T.export.label, T.export.x + 24, 305, { colour: side });
  if (ledger.sendOpen) pen.dither(T.send.x, T.send.y, T.send.w, T.send.h, P.hl, 8);
  pen.icon('send', T.send.x + 7, 305, 12, side);
  if (T.fit < 2) pen.text(T.send.label, T.send.x + 32, 305, { colour: active ? P.ink : P.ink2 });
  pen.icon('caret', T.send.x + T.send.w - 17, 306, 10, side);

  // Column heads.
  const headY = y + LEDGER.toolbar;
  pen.rect(x, headY + 29, w, 2, P.line); pen.rect(x, headY + 31, w, 2, P.edge);
  checkbox(pen, 44, headY + 9, false);
  pen.text(ui(lang, 'session.col.title'), 76, headY + 10, { colour: P.ink2 });
  pen.text(ui(lang, 'session.col.project'), 527.5, headY + 10, { colour: P.ink2 });
  pen.text(ui(lang, 'session.col.active'), 804, headY + 10, { colour: P.ink2, align: 'right' });
  pen.text('↓', 813, headY + 10, { colour: P.ink2 });
  pen.text(ui(lang, 'session.col.source'), 842, headY + 10, { colour: P.ink2 });

  // Rows.
  const bodyY = headY + LEDGER.head;
  ledger.rows.forEach((row, n) => ledgerRow(pen, lang, ledger, row, n, t));
  if (!ledger.rows.length && ledger.emptyText) {
    const lines = pen.wrap(ledger.emptyText, 620, 13);
    lines.forEach((line, i) => pen.read(line, x + w / 2 + 22, bodyY + 46 + i * 20, { align: 'center' }));
    dotted(pen, x, x + w, bodyY + 118, P.line);
  }
  // The red margin line of the page.
  ctx.fillStyle = 'rgba(174, 51, 25, 0.55)';
  ctx.fillRect(x + 42, bodyY, 2, openH - LEDGER.toolbar - LEDGER.head);
  ctx.restore();
}

/* ── Footer ────────────────────────────────────────── */
function footer(pen, lang, foot) {
  const P = pen.P, y = FOOT_Y + (foot.dy || 0);
  pen.rect(0, y, W, H - y + 40, P.wood);
  pen.rect(0, y, W, 2, P.edge);
  pen.rect(0, y + 2, W, 2, P.woodHi);
  if (foot.mascot !== false) {
    const spec = foot.mascotSpec || { pose: 'loaf' };
    pen.cat('orange', spec, 20, y, { cell: 2, collar: '#2f9e8f', accessory: 'none' });
  }
  if (foot.text !== null && foot.text !== undefined) {
    lampDot(pen, 70, y + 16, foot.tone === 'ok' ? P.ok : foot.tone === 'warn' ? P.warn : P.mute);
    const shown = foot.typed === undefined ? foot.text : [...foot.text].slice(0, foot.typed).join('');
    const w = pen.text(shown, 86, y + 13.5, { colour: P.onWood });
    if (foot.typed === undefined || foot.typed >= [...foot.text].length) pen.text('▼', 86 + w + 8, y + 13.5, { colour: P.onWood });
  }
  if (foot.global !== false) {
    const label = ui(lang, 'footer.localOnly'), lw = pen.width(label);
    pen.rect(902 - lw - 12, y + 16, 8, 8, P.ok);
    pen.text(label, 902 - lw, y + 14, { colour: P.onWood });
    pen.icon('sound', 918, y + 12, 16, P.onWood);
    if (foot.hub) pen.text(foot.hub, 902 - lw - 26, y + 14, { colour: P.onWood, align: 'right' });
  }
}

// A label that rises for a moment where something happened (the app's fx-float): nine held steps.
function floatLabel(pen, x, y, label, tone, age) {
  if (age < 0 || age >= 0.9) return;
  const P = pen.P, step = Math.floor(age / 0.1), w = pen.width(label) + 12, top = y - 18 - step * 2;
  const fill = tone === 'ok' ? P.ok : tone === 'warn' ? P.warn : P.float;
  pen.frame(Math.round(x - w / 2), top, w, 18, { fill, bevel: false });
  pen.text(label, Math.round(x - w / 2) + 6, top + 3, { colour: tone ? P.bg : P.ink });
}

// The small red seal that lands at the end of a copied row (fx-seal): drops, presses, stays, goes.
function rowSeal(pen, x, y, age) {
  if (age < 0 || age >= 0.8) return;
  const P = pen.P, frame = Math.floor(age * 60 + 1e-6), dy = frame < 4 ? -12 : frame < 8 ? -4 : frame < 12 ? 0 : frame < 16 ? 2 : 0, big = frame < 4 ? 6 : frame < 8 ? 2 : 0;
  const s = 22 + big * 2, left = x - s / 2, top = y - s / 2 + dy;
  pen.rect(left, top - 2, s, 2, P.brandDeep); pen.rect(left, top + s, s, 2, P.brandDeep); pen.rect(left - 2, top, 2, s, P.brandDeep); pen.rect(left + s, top, 2, s, P.brandDeep);
  pen.rect(left, top, s, s, P.brand); pen.rect(left + 2, top + 2, s - 4, s - 4, P.brandHi); pen.rect(left + 4, top + 4, s - 8, s - 8, P.brand);
  pen.icon('check', left + 6, top + 6, s - 12, P.onBrand);
}

/* ── The whole window ──────────────────────────────── */
function drawWindow(pen, state) {
  const lang = state.lang;
  desk(pen, state.lamp);
  if (state.empty) emptyDesk(pen, lang, state.empty);
  if (state.roster) roster(pen, lang, state);
  if (state.head) presenterHead(pen, lang, state.head.count, state.head.quota, state.head.hover);
  if (state.ledger) ledgerPane(pen, lang, state.ledger, state.t || 0);
  if (state.marks) state.marks(pen);
  topbar(pen, lang, state.topbarDy || 0);
  footer(pen, lang, state.footer || {});
}

module.exports = {
  W, H, TOP, FOOT_Y, SHELF_Y, PLATE_Y, PLATE_H, ALL, CARD, LEDGER, NIGHT_DESK,
  cardX, cardCentre, cardLayout, headLayout, emptyLayout, toolbarLayout, navLayout, rowTop, rowHeight, rowLayout,
  drawWindow, desk, topbar, footer, ledge, pitCat, catsAgain, bracket, checkbox, dotted, floatLabel, rowSeal, lampDot, pips, plate, ROSTER_LEFT, ROSTER_RIGHT
};
