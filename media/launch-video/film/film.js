'use strict';

/*
 * The film: render(ctx, t, lang) draws the frame for time t (seconds).
 *
 * It is a pure function of time and language. 120 beats a minute: a beat is
 * half a second, a bar two seconds, and every shot, camera move, caption and
 * click starts on a beat or a clean fraction of one.
 *
 * The camera has two places to stand: close on the Catshelf window (the
 * window at twice its size, 960×540 of it in view, tilting up and down), or
 * back at the desktop (the whole window at its own size, top left, with the
 * official clients beside it). It moves between them in three held steps.
 */

const { Pen, DAY, NIGHT, CatArt, clamp, mix, ease, glide, loop, once, within } = require('./draw.js');
const app = require('./app.js');
const recruit = require('./recruit.js');
const hook = require('./hook.js');
const desk = require('./desktop.js');
const { ui, FILM, CAST } = require('./strings.js');

const FPS = 60, WIDTH = 1920, HEIGHT = 1080, END = 60;
// Where each shot begins; captions follow FILM[lang].captions in the same order.
const SHOTS = [0, 2, 4, 6, 9.5, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 46, 48, 50, 58];
const F = (frames) => frames / FPS;

/* ── Times of the first fourteen seconds ───────────── */
const LAMP = [4, 4.15, 4.3];                       // the lamp's three steps
const RECRUIT = { click: 6.5, type: 7, create: 8.5, signed: 9, close: 9.25 };
const LAND = [9.5, 10, 10.25, 10.5, 10.75, 11];    // each cat's feet touch the shelf
const SAME = [11.25, 12];                          // "one platform, three accounts"
const OPEN = [12.25, 12.75, 13.25];                // clicks on "Open"; the client is up a quarter second later
const UP = OPEN.map((t) => t + 0.25);
const QUOTA = [92, 81, 100, 78, 34, 88];
const DESK_AT = { x: 16, y: 48 };                  // where the Catshelf window sits on the desktop

/* ── Camera ────────────────────────────────────────── */
// [time, desktop (0 close, 1 desktop), tilt (window y at the top of the frame, close-ups only)]
function cameraMoves(plan) {
  return [[0, 0, 0], [5, 1, 0], [6, 0, 0], [RECRUIT.click, 0, plan.dialogTilt], [RECRUIT.close, 0, 0], [12, 1, 0]];
}

function camera(t, plan) {
  const moves = cameraMoves(plan);
  let index = 0;
  moves.forEach((move, i) => { if (t >= move[0] - 1e-9) index = i; });
  const to = moves[index], from = moves[Math.max(0, index - 1)];
  const frame = Math.floor((t - to[0]) * FPS + 1e-6), p = index === 0 ? 1 : frame < 4 ? 0.55 : frame < 8 ? 0.85 : 1;
  const d = mix(from[1], to[1], p), y = Math.round(mix(from[2], to[2], p) / 2) * 2;
  const scale = 2 - d;
  return { d, y, scale, ox: Math.round(mix(0, DESK_AT.x, d) / 2) * 2, oy: Math.round(mix(-2 * y, DESK_AT.y, d) / 2) * 2, moving: p < 1 };
}

const toFrame = (cam, x, y) => [cam.ox + x * cam.scale, cam.oy + y * cam.scale];

/* ── Things worked out once per language ───────────── */
const plans = new Map();
function planFor(lang, ctx) {
  if (plans.has(lang)) return plans.get(lang);
  const pen = new Pen(ctx, 2, DAY);
  const dialog = recruit.layout(pen, lang), empty = app.emptyLayout(pen, lang);
  const cards = CAST.map((_, k) => app.cardLayout(pen, lang, k));
  // Tilt so that the dialog's seal button sits just above the caption.
  const plan = { dialog, empty, cards, dialogTilt: Math.round((dialog.primary.y + dialog.primary.h - 422) / 2) * 2 };
  const centre = (box) => [box.x + box.w / 2, box.y + box.h / 2];
  const name = [...FILM[lang].names.work];
  plan.typed = (t) => (t < RECRUIT.type ? '' : name.slice(0, Math.min(name.length, Math.floor((t - RECRUIT.type) / (name.length > 2 ? 0.125 : 0.25) + 1e-6) + 1)).join(''));
  plan.keys = name.map((_, i) => RECRUIT.type + i * (name.length > 2 ? 0.125 : 0.25));
  // The cursor: [time, x, y, 'w' window or 'f' frame coordinates, click]
  const first = centre(empty.button), create = centre(dialog.primary), field = [dialog.name.x + 70, dialog.name.y + 20];
  const opens = [0, 1, 2].map((k) => centre(cards[k].launch));
  plan.cursor = [
    [5.4, 1380, 760, 'f'], [5.95, 1380, 760, 'f'], [6.4, first[0], first[1], 'w'], [RECRUIT.click, first[0], first[1], 'w', true],
    [6.95, field[0], field[1] + 22, 'w'], [8.05, field[0], field[1] + 22, 'w'], [8.42, create[0], create[1], 'w'], [RECRUIT.create, create[0], create[1], 'w', true],
    [9.2, create[0], create[1], 'w'], [9.7, 330, 330, 'w'], [11.8, 330, 330, 'w'],
    [12.2, opens[0][0], opens[0][1], 'w'], [OPEN[0], opens[0][0], opens[0][1], 'w', true],
    [12.7, opens[1][0], opens[1][1], 'w'], [OPEN[1], opens[1][0], opens[1][1], 'w', true],
    [13.2, opens[2][0], opens[2][1], 'w'], [OPEN[2], opens[2][0], opens[2][1], 'w', true],
    [13.9, 1480, 268, 'f'], [60, 1480, 268, 'f']
  ];
  plans.set(lang, plan);
  return plan;
}

/* ── The Catshelf window at time t ─────────────────── */
function stepsOver(t, start, frames, steps) { return Math.round(clamp((t - start) * FPS / frames) * steps) / steps; }
// A nameplate dropping from behind the shelf: fast, 4px past, back.
function plateDrop(t, start) {
  const frame = Math.floor((t - start) * FPS + 1e-6);
  if (frame < 0) return null;
  return [-112, -112, -52, -52, -18, -18, -4, -4, 4, 4][frame] ?? 0;
}

function accountAt(t, lang, k) {
  const who = CAST[k], words = FILM[lang], land = LAND[k];
  if (t < land - 1 / 3) return { name: words.names[who.name], client: who.client, plateDy: null, cat: null, state: { label: '', dot: '' }, quota: { pips: 0, level: 'fresh', text: '' } };
  let action = 'play', label = ui(lang, 'state.play'), dot = 'play', spec = null, pressed = false, hover = null;
  if (k < 3 && t >= OPEN[k]) {
    if (t < UP[k]) { action = 'arriving'; label = ui(lang, 'state.arriving'); dot = 'arriving'; pressed = t < OPEN[k] + F(5); hover = 'launch'; }
    else { action = 'onduty'; label = ui(lang, 'state.onduty'); dot = 'onduty'; spec = once('cheer', t - UP[k]); }
  }
  spec = spec || once('arrive', t - (land - 1 / 3)) || loop(action, t + k * 0.37);
  const pct = QUOTA[k];
  return {
    name: words.names[who.name], client: who.client, plateDy: plateDrop(t, land - 0.25), pressed, hover,
    cat: { look: who.look, collar: who.collar, spec, accessory: 'none' },
    state: { label, dot }, quota: { pips: Math.max(1, Math.round(pct / 20)), level: pct < 10 ? 'exhausted' : pct < 30 ? 'tired' : pct < 60 ? 'steady' : 'fresh', text: pct + '%' }
  };
}

function windowState(t, lang, plan) {
  const lamp = t < LAMP[1] ? 1 : t < LAMP[2] ? 2 : 3, words = FILM[lang];
  const landed = LAND.filter((at) => t >= at).length;
  const state = {
    lang, lamp, topbarDy: glide(-66, 0, t, LAMP[0], 8, 4),
    head: t >= LAMP[2] ? { count: landed, quota: landed > 0 } : null,
    footer: { dy: glide(40, 0, t, LAMP[0], 8, 4), mascot: t >= LAMP[2], global: t >= 4.9, text: null }
  };
  const rosterAt = LAND[0] - 1 / 3;
  if (t < rosterAt) {
    const status = ui(lang, 'roster.empty.status');
    state.empty = {
      seat: stepsOver(t, LAMP[2], 6, 3), words: t >= 4.6, pressed: within(t, RECRUIT.click, RECRUIT.click + F(5)),
      cat: t >= 4.4 ? { look: 'orange', collar: '#2f9e8f', accessory: 'none', spec: once('arrive', t - 4.4) || loop('rest', t) } : null
    };
    state.ledger = t >= 4.7 ? { open: stepsOver(t, 4.7, 6, 3), title: ui(lang, 'session.titleAll'), count: 0, fresh: 0, rows: [], emptyText: t >= 4.8 ? ui(lang, 'session.empty.noAgents') : '' } : null;
    if (t >= 4.9) { state.footer.text = status; state.footer.typed = Math.floor((t - 4.9) * 45); }
  } else {
    const accounts = CAST.map((_, k) => accountAt(t, lang, k));
    const reach = (k) => app.cardX(k) + app.CARD.w + 8;
    let shelfEnd = app.ALL.x + app.ALL.w + 8;
    LAND.forEach((land, k) => { shelfEnd = Math.max(shelfEnd, Math.round(mix(k ? reach(k - 1) : 18, reach(k), stepsOver(t, land - 1 / 3, 6, 3)) / 2) * 2); });
    state.roster = {
      accounts, scope: 'all', allDy: plateDrop(t, LAND[0] - 0.25), photo: t >= LAND[0] - 0.25, shelfEnd, bracket: t >= LAND[0],
      allMeta: ui(lang, 'roster.allMeta', { agents: landed, n: 0 })
    };
    state.ledger = { title: ui(lang, 'session.titleAll'), count: 0, fresh: 0, rows: [], emptyText: ui(lang, 'session.empty.noneAll') };
    state.footer.text = t >= LAND[0] ? ui(lang, 'status.ready') : ui(lang, 'roster.empty.status');
    if (within(t, SAME[0], SAME[1])) {
      // Film annotation, in the "pointing" colour: the three Codex accounts are one platform.
      const x0 = app.cardX(0) + 4, x1 = app.cardX(2) + app.CARD.w - 4, label = words.same, d = [-10, -4, 2, 0][Math.min(3, Math.floor((t - SAME[0]) * FPS / 3))];
      state.marks = (pen) => {
        const w = pen.width(label) + 20, cx = (x0 + x1) / 2, y = 274 + d;
        pen.rect(x0, y, x1 - x0, 4, '#3B272C'); pen.rect(x0, y - 8, 4, 8, '#3B272C'); pen.rect(x1 - 4, y - 8, 4, 8, '#3B272C');
        pen.rect(x0 + 2, y, x1 - x0 - 4, 2, desk.HONEY); pen.rect(x0 + 2, y - 8, 2, 8, desk.HONEY); pen.rect(x1 - 4, y - 8, 2, 8, desk.HONEY);
        pen.rect(cx - w / 2 - 2, y - 10, w + 4, 24, '#3B272C'); pen.rect(cx - w / 2, y - 8, w, 20, desk.HONEY);
        pen.text(label, cx, y - 4, { colour: '#3B272C', align: 'center' });
      };
    }
  }
  // The recruit dialog.
  const closing = t - RECRUIT.close;
  if (t >= RECRUIT.click && closing < F(4)) {
    const frame = Math.floor((t - RECRUIT.click) * FPS + 1e-6);
    state.dialog = {
      rise: closing >= 0 ? (closing < F(2) ? 2 : 1) : Math.min(3, Math.floor(frame / 3)),
      name: plan.typed(t), caret: Math.floor(t * 2) % 2 === 0, focus: 'name',
      pressed: within(t, RECRUIT.create, RECRUIT.create + F(6)), busy: within(t, RECRUIT.create, RECRUIT.create + 0.2),
      status: t >= RECRUIT.create + 0.2 ? ui(lang, 'recruit.new.done', { client: 'Codex' }) : ''
    };
  }
  return state;
}

function drawWindowAt(ctx, state, plan, scale, palette) {
  const pen = new Pen(ctx, scale, palette || DAY);
  app.drawWindow(pen, state);
  if (state.dialog) recruit.draw(pen, state.lang, state.dialog, plan.dialog);
}

/* ── Clients on the desktop ────────────────────────── */
const CODEX_BOX = [0, 1, 2].map((k) => ({ x: 1012, y: 56 + k * 280, w: 884, h: 264 }));

// The dashed lines from each open client to its cat; drawn before the cats are drawn again, so they pass behind them.
function linksAt(ctx, t, cam) {
  const pen = new Pen(ctx, 1, DAY);
  [0, 1, 2].forEach((k) => {
    if (t < UP[k] + F(6)) return;
    const box = CODEX_BOX[k];
    desk.link(pen, toFrame(cam, app.cardCentre(k), 112), [box.x - 4, box.y + box.h / 2]);
  });
}

function clientsAt(ctx, t, lang, cam) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang];
  [0, 1, 2].forEach((k) => {
    if (t < UP[k]) return;
    const box = CODEX_BOX[k], frame = Math.floor((t - UP[k]) * FPS + 1e-6);
    desk.client(pen, box, { lang, t, title: 'Codex · ' + words.names[CAST[k].name], badge: words.signed, side: [[words.newChat, false], [words.sideCodex[k], false]], lines: [], rise: Math.min(3, Math.floor(frame / 3)) });
    pen.burst(box.x + box.w / 2, box.y + box.h / 2, t - UP[k], desk.HONEY, 240, 12);
  });
}

// The official sign-in window that opens over Catshelf when "Create and sign in" is pressed.
function signInWindow(ctx, t, lang) {
  if (t < RECRUIT.create + F(4) || t >= RECRUIT.close) return;
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang].signin, box = { x: 1132, y: 72, w: 728, h: 316 };
  const frame = Math.floor((t - RECRUIT.create - F(4)) * FPS + 1e-6), done = t >= RECRUIT.signed;
  desk.client(pen, box, {
    lang, t, title: 'Codex · ' + words.title, rise: Math.min(3, Math.floor(frame / 3)),
    panel: (c, x, y, w, h) => {
      const cx = x + w / 2;
      if (!done) {
        desk.sys(c, words.waiting, cx, y + h / 2 - 4, 30, '#1B1F24', { weight: 600, align: 'center' });
        for (let d = 0; d < 3; d += 1) pen.rect(cx - 26 + d * 22, y + h / 2 + 28, 10, 10, Math.floor(t * 6) % 3 === d ? '#1B1F24' : '#C9C9C4');
        return;
      }
      const pop = t - RECRUIT.signed < F(4) ? 6 : 0;
      pen.rect(cx - 36 - pop, y + 36 - pop, 72 + pop * 2, 72 + pop * 2, '#2F7D3B');
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 10; c.lineCap = 'square'; c.beginPath(); c.moveTo(cx - 18, y + 74); c.lineTo(cx - 4, y + 88); c.lineTo(cx + 20, y + 58); c.stroke();
      desk.sys(c, words.done, cx, y + 160, 34, '#1B1F24', { weight: 700, align: 'center' });
      desk.sys(c, words.keep, cx, y + 206, 24, '#5A616B', { align: 'center' });
    }
  });
  pen.burst(box.x + box.w / 2, box.y + 140, t - RECRUIT.signed, '#2F7D3B', 220, 12);
}

/* ── Caption: a nameplate that drops on the beat ───── */
function caption(ctx, t, lang) {
  let shot = 0;
  SHOTS.forEach((at, i) => { if (t >= at - 1e-9) shot = i; });
  const raw = FILM[lang].captions[shot];
  if (!raw) return null;
  const pen = new Pen(ctx, 2, DAY), parts = raw.split(/\[\[|\]\]/);
  const frame = Math.floor((t - SHOTS[shot]) * FPS + 1e-6), d = frame < 3 ? -12 : frame < 6 ? -6 : frame < 9 ? 2 : 0;
  const widths = parts.map((part) => pen.width(part, 24, 'film')), total = widths.reduce((a, b) => a + b, 0);
  const w = Math.ceil((total + 56) / 2) * 2, x = Math.round((480 - w / 2) / 2) * 2, y = 446 + d;
  pen.rect(x + 4, y + 4, w + 2, 42, '#1B1417');
  pen.rect(x - 2, y - 2, w + 4, 44, '#3B272C');
  pen.rect(x, y, w, 40, '#FBF2DB');
  pen.rect(x, y, 8, 40, '#AE3319');
  let cx = x + 32;
  parts.forEach((part, k) => { pen.text(part, cx, y + 8, { size: 24, film: true, colour: k % 2 ? '#AE3319' : '#3B272C' }); cx += widths[k]; });
  return { x: x * 2, y: y * 2, w: w * 2, h: 80, shot };
}

/* ── Cursor ────────────────────────────────────────── */
const ARROW = ['#..........', '##.........', '#o#........', '#oo#.......', '#ooo#......', '#oooo#.....', '#ooooo#....', '#oooooo#...', '#ooooooo#..', '#oooooooo#.', '#ooooo#####', '#oo#oo#....', '#o#.#oo#...', '##..#oo#...', '#....#oo#..', '.....###...'];

function cursorAt(t, plan, cam) {
  const keys = plan.cursor;
  if (t < keys[0][0]) return null;
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i += 1) { if (keys[i][0] <= t + 1e-9) { a = keys[i]; b = keys[Math.min(keys.length - 1, i + 1)]; } }
  const at = (key) => (key[3] === 'w' ? toFrame(cam, key[1], key[2]) : [key[1], key[2]]);
  const p = b === a || b[0] === a[0] ? 1 : ease((t - a[0]) / (b[0] - a[0]), 8), pa = at(a), pb = at(b);
  const click = keys.find((key) => key[4] && t >= key[0] - 1e-9 && t < key[0] + 0.16);
  return { x: Math.round(mix(pa[0], pb[0], p) / 2) * 2, y: Math.round(mix(pa[1], pb[1], p) / 2) * 2, click: click ? { at: at(click), age: t - click[0] } : null };
}

function drawCursor(ctx, cursor) {
  if (!cursor) return;
  if (cursor.click) {
    const [x, y] = cursor.click.at.map((value) => Math.round(value / 2) * 2), r = cursor.click.age < F(4) ? 16 : 26;
    ctx.fillStyle = '#AE3319';
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillRect(x + sx * r - (sx > 0 ? 12 : 0), y + sy * r - (sy > 0 ? 4 : 0), 12, 4); ctx.fillRect(x + sx * r - (sx > 0 ? 4 : 0), y + sy * r - (sy > 0 ? 12 : 0), 4, 12); }
  }
  const cell = 3;
  ARROW.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    ctx.fillStyle = ch === '#' ? '#FFF8E8' : '#1B1417';
    ctx.fillRect(cursor.x + i * cell, cursor.y + j * cell, cell, cell);
  }));
}

/* ── One frame ─────────────────────────────────────── */
let layer = null;
function render(ctx, time, lang) {
  const t = Math.max(0, Math.min(END - 1 / FPS, time));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const plan = planFor(lang, ctx);
  let cam = null;
  if (t < LAMP[0]) hook.draw(new Pen(ctx, 1, NIGHT), t, lang);
  else {
    cam = camera(t, plan);
    const state = windowState(t, lang, plan);
    if (cam.d === 0) {
      ctx.setTransform(2, 0, 0, 2, 0, cam.oy);
      drawWindowAt(ctx, state, plan, 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      signInWindow(ctx, t, lang);
    } else {
      desk.desktop(new Pen(ctx, 1, DAY), lang, { t, hop: 5.25, dock: [{ label: 'Codex', open: t >= UP[0] }, { label: 'Claude' }, { label: 'Kimi Code' }, { label: 'Qwen Code' }, { label: FILM[lang].terminal, dark: true }] });
      const w = app.W * cam.scale, h = app.H * cam.scale;
      ctx.fillStyle = '#1E242D'; ctx.fillRect(cam.ox + 8, cam.oy + 10, w + 2, h + 2);
      ctx.fillStyle = '#0E1116'; ctx.fillRect(cam.ox - 2, cam.oy - 2, w + 4, h + 4);
      if (cam.d === 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(cam.ox, cam.oy, w, h); ctx.clip();
        ctx.setTransform(1, 0, 0, 1, cam.ox, cam.oy);
        drawWindowAt(ctx, state, plan, 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        linksAt(ctx, t, cam);
        ctx.setTransform(1, 0, 0, 1, cam.ox, cam.oy);
        app.catsAgain(new Pen(ctx, 1, DAY), state);
        ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        clientsAt(ctx, t, lang, cam);
      } else {
        // Between the two places: the close-up picture, scaled in whole steps without smoothing.
        if (!layer) { layer = document.createElement('canvas'); layer.width = app.W * 2; layer.height = app.H * 2; }
        const lctx = layer.getContext('2d');
        lctx.setTransform(2, 0, 0, 2, 0, 0);
        drawWindowAt(lctx, state, plan, 2);
        ctx.drawImage(layer, cam.ox, cam.oy, w, h);
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (cam) drawCursor(ctx, cursorAt(t, plan, cam));
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  caption(ctx, t, lang);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Named stills of the window alone, for matching the drawing to the app.
function renderState(ctx, name, lang, still = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const plan = planFor(lang, ctx);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  drawWindowAt(ctx, windowState(still.t || 0, lang, plan), plan, 2);
}

module.exports = { render, renderState, FPS, WIDTH, HEIGHT, END, SHOTS, LAMP, RECRUIT, LAND, SAME, OPEN, UP, camera, cameraMoves, planFor };
void CatArt;
