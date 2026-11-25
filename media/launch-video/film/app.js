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

const cardX = (k) => CARD.first + CARD.pitch * k;
const cardCentre = (k) => cardX(k) + CARD.w / 2;
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

function cardLayout(pen, lang, k) {
  const x = cardX(k), centre = x + CARD.w / 2;
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

function card(pen, lang, k, account) {
  const P = pen.P, L = cardLayout(pen, lang, k), dy = account.plateDy || 0, ctx = pen.ctx;
  if (account.plateDy === null || account.plateDy === undefined) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(L.x - 8, SHELF_Y + 8, CARD.w + 16, H); ctx.clip();
  plate(pen, L.paper.x, L.paper.w, L.paper.h, dy, account.selected);
  const centre = L.centre;
  pen.text(account.name, centre, 165.5 + dy, { align: 'center' });
  // What it is doing: one lamp bead and one line.
  const label = account.state.label, labelW = pen.width(label), stateX = Math.round(centre - (8 + 6 + labelW) / 2);
  lampDot(pen, stateX, 185.5 + dy, P[DOT[account.state.dot]] || P.mute);
  pen.text(label, stateX + 14, 183 + dy, { colour: account.state.alert ? P.badInk : P.ink2 });
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

function roster(pen, lang, state) {
  const r = state.roster, accounts = r.accounts;
  const shown = accounts.filter((a) => a.plateDy !== null && a.plateDy !== undefined || a.cat);
  allCard(pen, lang, r);
  accounts.forEach((account, k) => card(pen, lang, k, account));
  if (r.photo !== false) groupPhoto(pen);
  accounts.forEach((account, k) => pitCat(pen, cardCentre(k), account.cat));
  ledge(pen, 18, r.shelfEnd !== undefined ? r.shelfEnd : (shown.length ? cardX(accounts.length - 1) + CARD.w + 8 : ALL.x + ALL.w + 8));
  if (r.bracket !== false) {
    if (r.scope === 'all') bracket(pen, ALL.x - 6, 68, ALL.w + 12, 139);
    else if (Number.isInteger(r.scope) && accounts[r.scope] && accounts[r.scope].plateDy === 0) bracket(pen, cardX(r.scope) - 6, 68, CARD.w + 12, 205);
  }
}

// The cats and the shelf once more, over anything drawn across the window since (the links to the clients pass behind the cats).
function catsAgain(pen, state) {
  if (!state.roster) return;
  const r = state.roster, shown = r.accounts.filter((a) => a.cat);
  if (r.photo !== false) groupPhoto(pen);
  r.accounts.forEach((account, k) => pitCat(pen, cardCentre(k), account.cat));
  ledge(pen, 18, r.shelfEnd !== undefined ? r.shelfEnd : (shown.length ? cardX(r.accounts.length - 1) + CARD.w + 8 : ALL.x + ALL.w + 8));
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
  const filtersX = Math.max(143, countX + pen.width(count) + 14);
  const fresh = ui(lang, 'marks.fresh'), freshW = 5 + 12 + 12 + pen.width(fresh) + 4 + pen.width(String(ledger.fresh || 0)) + 5;
  const tagsX = filtersX + freshW + 12;
  const clear = ledger.filter ? ui(lang, 'marks.clear') : '', clearW = clear ? pen.width(clear) + 12 : 0;
  const copyLabel = ui(lang, 'session.copyInfo') + (ledger.checked ? ' · ' + ledger.checked : '');
  const copyW = 10 + 12 + 13 + pen.width(copyLabel) + 10;
  const send = ui(lang, 'session.actions.send'), sendW = 7 + 12 + 13 + pen.width(send) + 6 + 10 + 7;
  const open = ui(lang, 'session.actions.openDirectory'), exportLabel = ui(lang, 'session.actions.export');
  const view = ui(lang, 'session.view.compact'), viewW = Math.max(74, pen.width(view) + 50);
  const right = 930, tagsEnd = tagsX + 5 * 26 + clearW;
  // Fit as the app does when the bar is crowded: the two side actions fall back to their icons.
  let openW = 7 + 12 + 5 + pen.width(open) + 7, exportW = 7 + 12 + 5 + pen.width(exportLabel) + 7, icons = false;
  const need = () => tagsEnd + 18 + 80 + 4 + viewW + 10 + copyW + 4 + openW + 2 + exportW + 2 + sendW;
  if (need() > right) { icons = true; openW = 26; exportW = 26; }
  const sendX = right - sendW, exportX = sendX - 2 - exportW, openX = exportX - 2 - openW, copyX = openX - 4 - copyW;
  const viewX = copyX - 10 - viewW, searchX = tagsEnd + 18, searchW = Math.max(60, Math.min(170, viewX - 4 - searchX));
  return {
    chip: { x: 34, y: 299.5, w: chipW, h: 23 }, countX, fresh: { x: filtersX, y: 298, w: freshW, h: 26, label: fresh }, sepX: filtersX + freshW + 5,
    tags: [0, 1, 2, 3, 4].map((k) => ({ x: tagsX + k * 26, y: 298, w: 24, h: 26 })), clear: clear ? { x: tagsX + 5 * 26 + 2, y: 298, w: clearW, h: 26, label: clear } : null,
    search: { x: searchX, y: 297, w: searchW, h: 28 }, view: { x: viewX, y: 298, w: viewW, h: 26, label: view },
    copy: { x: copyX, y: 299, w: copyW, h: 24, label: copyLabel }, open: { x: openX, y: 298, w: openW, h: 26, label: open },
    export: { x: exportX, y: 298, w: exportW, h: 26, label: exportLabel }, send: { x: sendX, y: 298, w: sendW, h: 26, label: send }, icons
  };
}

const rowHeight = (ledger) => (ledger.twoLine ? 37.5 : 36);
const rowTop = (ledger, n) => LEDGER.y + LEDGER.toolbar + LEDGER.head + Math.round(n * rowHeight(ledger) * 2) / 2;

function ledgerPane(pen, lang, ledger) {
  const P = pen.P, { x, y, w, h } = LEDGER, ctx = pen.ctx;
  const openH = Math.round(h * (ledger.open === undefined ? 1 : ledger.open) / 2) * 2;
  if (openH <= 0) return;
  pen.frame(x, y, w, openH, { lip: true });
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, openH); ctx.clip();
  const T = toolbarLayout(pen, lang, ledger), active = ledger.rows.some((row) => row.checked) || ledger.focused;
  // Bookmark: what is listed, and how many.
  pen.rect(T.chip.x, T.chip.y, T.chip.w, T.chip.h, P.edge);
  pen.text(ledger.title, T.chip.x + 9, 305.5, { colour: P.float });
  pen.text(String(ledger.count), T.countX, 305.5, { colour: P.brandDeep });
  // Marks: new replies and the five tags.
  if (ledger.filter === 'fresh') pen.rect(T.fresh.x, T.fresh.y, T.fresh.w, T.fresh.h, P.hl);
  pen.icon('reply', T.fresh.x + 5, 305, 12, P.brand);
  const freshW = pen.text(T.fresh.label, T.fresh.x + 29, 305, { colour: P.ink2 });
  pen.text(String(ledger.fresh || 0), T.fresh.x + 33 + freshW, 305, { colour: P.brandDeep });
  pen.rect(T.sepX, 303, 2, 16, P.line);
  T.tags.forEach((tag, k) => {
    if (ledger.filter === k) pen.rect(tag.x, tag.y, tag.w, tag.h, P.hl);
    pen.icon('tag' + (k + 1), tag.x + 6, 305, 12, P.tag[k]);
  });
  if (T.clear) pen.text(T.clear.label, T.clear.x + 6, 305, { colour: P.brandInk });
  // Search.
  const S = T.search, query = ledger.query || '';
  pen.rect(S.x, S.y + 26, S.w, 2, ledger.searching ? P.focus : P.ink2);
  pen.icon('search', S.x + 4, 305, 12, P.ink2);
  ctx.save(); ctx.beginPath(); ctx.rect(S.x + 22, S.y, S.w - 26, S.h); ctx.clip();
  if (query) pen.read(query + (ledger.caret ? '|' : ''), S.x + 22, 301, { lineHeight: 20 });
  else pen.text(ui(lang, 'session.search'), S.x + 22, 305, { colour: P.ink2 });
  ctx.restore();
  pen.text(T.view.label, T.view.x + 25, 305, { colour: P.ink });
  // Actions: copy is the one seal of this region; it lights up when a row is picked.
  const C = T.copy;
  if (active) {
    pen.seal(C.x, C.y, C.w, C.h, ledger.copyPressed);
    pen.icon('copy', C.x + 10, C.y + 5 + (ledger.copyPressed ? 2 : 0), 12, P.onBrand);
    pen.text(C.label, C.x + 35, C.y + 5 + (ledger.copyPressed ? 2 : 0), { colour: P.onBrand });
  } else {
    pen.icon('copy', C.x + 10, C.y + 6, 12, P.off);
    pen.text(C.label, C.x + 35, C.y + 6, { colour: P.off });
  }
  const side = active ? P.ink : P.off;
  pen.icon('folder', T.open.x + 7, 305, 12, side); if (!T.icons) pen.text(T.open.label, T.open.x + 24, 305, { colour: side });
  pen.icon('box', T.export.x + 7, 305, 12, side); if (!T.icons) pen.text(T.export.label, T.export.x + 24, 305, { colour: side });
  if (ledger.sendOpen) pen.dither(T.send.x, T.send.y, T.send.w, T.send.h, P.hl, 8);
  pen.icon('send', T.send.x + 7, 305, 12, active ? P.ink : P.off);
  pen.text(T.send.label, T.send.x + 32, 305, { colour: active ? P.ink : P.ink2 });
  pen.icon('caret', T.send.x + T.send.w - 17, 306, 10, active ? P.ink : P.off);

  // Column heads.
  const headY = y + LEDGER.toolbar;
  pen.rect(x, headY + 29, w, 2, P.line); pen.rect(x, headY + 31, w, 2, P.edge);
  checkbox(pen, 44, headY + 9, false);
  pen.text(ui(lang, 'session.col.title'), 76, headY + 10, { colour: P.ink2 });
  pen.text(ui(lang, 'session.col.project'), 527.5, headY + 10, { colour: P.ink2 });
  const activeW = pen.text(ui(lang, 'session.col.active'), 804, headY + 10, { colour: P.ink2, align: 'right' });
  pen.text('↓', 813, headY + 10, { colour: P.ink2 });
  pen.text(ui(lang, 'session.col.source'), 842, headY + 10, { colour: P.ink2 });
  void activeW;

  // Rows.
  const bodyY = headY + LEDGER.head, rh = rowHeight(ledger);
  ledger.rows.forEach((row, n) => {
    const top = rowTop(ledger, n) + (row.dx ? 0 : 0), dx = row.dx || 0;
    if (row.hidden) return;
    if (row.checked) pen.rect(x, top, w, rh - 2, P.chk);
    if (row.focused) pen.rect(x, top, w, rh - 2, P.hl);
    else if (row.lit) pen.rect(x, top, w, rh - 2, P.hl);
    ctx.save(); ctx.beginPath(); ctx.rect(x, top, w, rh); ctx.clip();
    checkbox(pen, 44 + dx, top + (ledger.twoLine ? 11.5 : 11), row.checked);
    const titleTop = top + (ledger.twoLine ? 4.5 : 11.5);
    if (row.tag !== undefined && row.tag !== null) pen.icon('tag' + (row.tag + 1), 76 + dx, titleTop - 0.5, 12, P.tag[row.tag]);
    if (row.lamp) { pen.rect(92 + dx, titleTop + 1, 10, 10, P.edge); pen.rect(94 + dx, titleTop + 3, 6, 6, row.lamp === 'done' ? P.ok : row.lamp === 'on' ? P.brand : P.float); }
    else if (row.fresh) pen.icon('reply', 92 + dx, titleTop - 0.5, 12, P.brand);
    else if (row.running) pen.icon('dots', 92 + dx, titleTop - 0.5, 12, P.ok);
    const titleW = pen.text(row.title, 108 + dx, titleTop, { colour: P.ink });
    if (row.fresh) {
      const label = ui(lang, 'marks.row.fresh'), lw = pen.width(label);
      pen.rect(116 + dx + titleW, titleTop - 1, lw + 8, 14, P.brand);
      pen.text(label, 120 + dx + titleW, titleTop, { colour: P.onBrand });
    }
    if (ledger.twoLine) pen.text(row.owner, 76 + dx, top + 23, { colour: P.ink2 });
    const mid = top + (ledger.twoLine ? 12.5 : 11.5);
    pen.text(row.project, 527.5 + dx, mid, { colour: P.ink });
    pen.text(row.when, 822 + dx, mid, { colour: P.ink, align: 'right' });
    pen.text(row.source, 842 + dx, mid, { colour: P.ink2 });
    ctx.restore();
    dotted(pen, x, x + w, top + rh - 2, P.line);
  });
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
  if (foot.mascot !== false) pen.cat('orange', foot.mascotSpec || { pose: 'loaf' }, 20, y, { cell: 2, collar: '#2f9e8f', accessory: 'none' });
  if (foot.text !== null && foot.text !== undefined) {
    lampDot(pen, 70, y + 16, foot.tone === 'ok' ? P.ok : foot.tone === 'warn' ? P.warn : P.mute);
    const shown = foot.typed === undefined ? foot.text : [...foot.text].slice(0, foot.typed).join('');
    const w = pen.text(shown, 86, y + 13.5, { colour: foot.honey ? P.woodAccent : P.onWood });
    if (foot.typed === undefined || foot.typed >= [...foot.text].length) pen.text('▼', 86 + w + 8, y + 13.5, { colour: P.onWood });
  }
  if (foot.global !== false) {
    const label = ui(lang, 'footer.localOnly'), lw = pen.width(label);
    pen.rect(902 - lw - 12, y + 16, 8, 8, P.ok);
    pen.text(label, 902 - lw, y + 14, { colour: P.onWood });
    pen.icon('sound', 918, y + 12, 16, P.onWood);
  }
}

/* ── The whole window ──────────────────────────────── */
function drawWindow(pen, state) {
  const lang = state.lang;
  desk(pen, state.lamp);
  if (state.empty) emptyDesk(pen, lang, state.empty);
  if (state.roster) roster(pen, lang, state);
  if (state.head) presenterHead(pen, lang, state.head.count, state.head.quota, state.head.hover);
  if (state.ledger) ledgerPane(pen, lang, state.ledger);
  if (state.marks) state.marks(pen);
  topbar(pen, lang, state.topbarDy || 0);
  footer(pen, lang, state.footer || {});
}

module.exports = {
  W, H, TOP, FOOT_Y, SHELF_Y, PLATE_Y, PLATE_H, ALL, CARD, LEDGER, NIGHT_DESK,
  cardX, cardCentre, cardLayout, headLayout, emptyLayout, toolbarLayout, navLayout, rowTop, rowHeight,
  drawWindow, desk, topbar, footer, ledge, pitCat, catsAgain, bracket, checkbox, dotted
};
