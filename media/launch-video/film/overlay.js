'use strict';

/*
 * What is laid over the picture in frame pixels: the caption, the cursor,
 * envelopes in flight, the lock, the other computer, the terminal, and the
 * end card. None of these is Catshelf's own interface; they are the film's.
 */

const { Pen, DAY, NIGHT, CatArt, SYS, MONO, clamp, mix, ease, loop, once } = require('./draw.js');
const { NIGHT_DESK } = require('./app.js');
const { FILM, CAST, JOINED, ui } = require('./strings.js');
const { FPS, SHOTS, T } = require('./times.js');

const HONEY = '#F6D37C', INK = '#3B272C', PAPER = '#FBF2DB', SEAL = '#AE3319';
const snap = (value, grid = 4) => Math.round(value / grid) * grid;

/* ── Caption: a nameplate that drops on the beat ───── */
// Where a plate sits, in the frame at half size: the middle of the lower third of the 1920×1080 frame.
const PLACE = { cx: 480, y: 446 };

// One plate: `raw` with [[the word printed in seal red]], `age` seconds after it began to drop.
function plateBox(ctx, raw, age, place = PLACE) {
  const pen = new Pen(ctx, 2, DAY), parts = raw.split(/\[\[|\]\]/);
  const frame = Math.floor(age * FPS + 1e-6), d = frame < 3 ? -12 : frame < 6 ? -6 : frame < 9 ? 2 : 0;
  const widths = parts.map((part) => pen.width(part, 24, 'film')), total = widths.reduce((a, b) => a + b, 0);
  const w = Math.ceil((total + 56) / 2) * 2, x = Math.round((place.cx - w / 2) / 2) * 2, y = place.y + d;
  return { pen, parts, widths, x, y, w };
}

function plate(ctx, box) {
  const { pen, parts, widths, x, y, w } = box;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  pen.rect(x + 4, y + 4, w + 2, 42, '#1B1417');
  pen.rect(x - 2, y - 2, w + 4, 44, INK);
  pen.rect(x, y, w, 40, PAPER);
  pen.rect(x, y, 8, 40, SEAL);
  let cx = x + 32;
  parts.forEach((part, k) => { pen.text(part, cx, y + 8, { size: 24, film: true, colour: k % 2 ? SEAL : INK }); cx += widths[k]; });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { x: (x - 2) * 2, y: (y - 2) * 2, w: (w + 8) * 2, h: 96 };
}

function captionBox(ctx, t, lang) {
  let shot = 0;
  SHOTS.forEach((at, i) => { if (t >= at - 1e-9) shot = i; });
  const raw = FILM[lang].captions[shot];
  if (!raw) return null;
  return { ...plateBox(ctx, raw, t - SHOTS[shot]), shot };
}

function caption(ctx, t, lang) {
  const box = captionBox(ctx, t, lang);
  if (!box) return null;
  return { ...plate(ctx, box), shot: box.shot };
}

/* ── Cursor ────────────────────────────────────────── */
const ARROW = ['#..........', '##.........', '#o#........', '#oo#.......', '#ooo#......', '#oooo#.....', '#ooooo#....', '#oooooo#...', '#ooooooo#..', '#oooooooo#.', '#ooooo#####', '#oo#oo#....', '#o#.#oo#...', '##..#oo#...', '#....#oo#..', '.....###...'];

function cursor(ctx, at) {
  if (!at) return;
  if (at.click) {
    const [x, y] = at.click.at.map((value) => Math.round(value / 2) * 2), r = at.click.age < 4 / FPS ? 16 : 26;
    ctx.fillStyle = SEAL;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillRect(x + sx * r - (sx > 0 ? 12 : 0), y + sy * r - (sy > 0 ? 4 : 0), 12, 4); ctx.fillRect(x + sx * r - (sx > 0 ? 4 : 0), y + sy * r - (sy > 0 ? 12 : 0), 4, 12); }
  }
  if (at.carry) {
    // A folder being dragged: no name on it.
    const fx = at.x + 18, fy = at.y + 26;
    ctx.fillStyle = '#59331D'; ctx.fillRect(fx - 4, fy - 12, 40, 12); ctx.fillRect(fx - 4, fy - 4, 80, 60);
    ctx.fillStyle = '#F2C14E'; ctx.fillRect(fx, fy - 8, 32, 8); ctx.fillRect(fx, fy, 72, 52);
    ctx.fillStyle = '#D9A53A'; ctx.fillRect(fx, fy + 44, 72, 8);
  }
  const cell = 3;
  ARROW.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    ctx.fillStyle = ch === '#' ? '#FFF8E8' : '#1B1417';
    ctx.fillRect(at.x + i * cell, at.y + j * cell, cell, cell);
  }));
}

/* ── Envelopes: only for what really passes through Catshelf ── */
// The app's envelope (src/pixel/desk.js): 10×7 squares, dark edge, paper, a V flap and a red seal.
function envelope(ctx, x, y, label, cell = 6) {
  const left = snap(x - 5 * cell, 2), top = snap(y - 3.5 * cell, 2), r = (cx, cy, w, h, colour) => { ctx.fillStyle = colour; ctx.fillRect(left + cx * cell, top + cy * cell, w * cell, h * cell); };
  r(0, 0, 10, 7, '#4A2F35'); r(1, 1, 8, 5, PAPER);
  for (const [cx, cy] of [[1, 1], [8, 1], [2, 2], [7, 2], [3, 3], [6, 3]]) r(cx, cy, 1, 1, '#4A2F35');
  r(4, 3, 2, 2, SEAL);
  if (label) {
    const pen = new Pen(ctx, 1, DAY), w = snap(pen.width(label, 24, 'film') + 24);
    pen.rect(snap(x - w / 2) - 4, top - 44, w + 8, 36, INK); pen.rect(snap(x - w / 2), top - 40, w, 28, HONEY);
    pen.text(label, snap(x - w / 2) + w / 2, top - 38, { size: 24, film: true, colour: INK, align: 'center' });
  }
}

// One flight from a to b that starts at `start` and lasts `duration`: ten held positions, a low arc, a ring of sparks on landing.
function flight(ctx, t, start, duration, a, b, label, arc = 90) {
  const age = t - start;
  if (age >= 0 && age < duration) {
    const p = Math.min(1, (Math.floor(age / duration * 10) + 1) / 10), e = 1 - Math.pow(1 - p, 3);
    envelope(ctx, mix(a[0], b[0], e), mix(a[1], b[1], e) - Math.sin(p * Math.PI) * arc, label);
  }
  new Pen(ctx, 1, DAY).burst(b[0], b[1], age - duration, SEAL, 60, 8);
}

/* ── The lock (48–50 s) ────────────────────────────── */
function lock(ctx, t, lang) {
  const age = t - T.LOCK.shut, pen = new Pen(ctx, 1, DAY), words = FILM[lang];
  if (age < 0) return;
  const d = [-24, -12, 4, 0][Math.min(3, Math.floor(age * FPS / 3))], cx = 960, top = 196 + d;
  pen.rect(cx - 250 + 12, top + 12, 500, 420, '#1B1417');
  pen.rect(cx - 254, top - 4, 508, 428, INK); pen.rect(cx - 250, top, 500, 420, PAPER);
  pen.rect(cx - 250, top, 500, 8, '#FFFDF1'); pen.rect(cx - 250, top + 412, 500, 8, '#E4CD9C');
  // The shackle is up for the first few frames, then it is home.
  const shut = age >= 9 / FPS, lift = shut ? 0 : age >= 6 / FPS ? 16 : 40, c = 12, bx = cx - 8 * c, by = top + 150;
  const dark = '#59331D', gold = '#F2C14E', deep = '#D9A53A';
  pen.rect(bx + 3 * c, by - 7 * c - lift, 10 * c, 2 * c, dark); pen.rect(bx + 2 * c, by - 6 * c - lift, 2 * c, 7 * c + lift, dark); pen.rect(bx + 12 * c, by - 6 * c - lift, 2 * c, (shut ? 7 : 4) * c, dark);
  pen.rect(bx + 4 * c, by - 6 * c - lift, 8 * c, c, '#8D8F98'); pen.rect(bx + 3 * c, by - 5 * c - lift, c, 6 * c + lift, '#8D8F98'); pen.rect(bx + 12 * c, by - 5 * c - lift, c, (shut ? 6 : 3) * c, '#8D8F98');
  pen.rect(bx - 4, by - 4, 16 * c + 8, 12 * c + 8, dark); pen.rect(bx, by, 16 * c, 12 * c, gold);
  pen.rect(bx, by, 16 * c, c, '#FFE9A8'); pen.rect(bx, by + 11 * c, 16 * c, c, deep);
  pen.rect(bx + 7 * c, by + 4 * c, 2 * c, 2 * c, dark); pen.rect(bx + 7.5 * c, by + 6 * c, c, 3 * c, dark);
  pen.burst(cx, by + 6 * c, age - 9 / FPS, gold, 230, 12);
  pen.text(words.lock, cx, top + 332, { size: 48, film: true, colour: INK, align: 'center' });
}

/* ── Another computer (40–42 s) ────────────────────── */
function otherComputer(ctx, t, lang) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], x = 1392, y = 612, w = 500, h = 248;
  const rise = [28, 12, 4, 0][Math.min(3, Math.floor((t - T.SEND.item) * FPS / 3))];
  const top = y + rise, got = t >= T.SEND.land;
  pen.rect(x + 8, top + 10, w + 2, h + 2, '#1B1417');
  pen.rect(x - 4, top - 4, w + 8, h + 8, '#0E1116'); pen.rect(x, top, w, h, '#1E242D');
  pen.rect(x + w / 2 - 60, top + h + 4, 120, 12, '#0E1116'); pen.rect(x + w / 2 - 110, top + h + 16, 220, 8, '#0E1116');
  // Its screen: the same shelf, small.
  const sx = x + 12, sy = top + 12, sw = w - 24, sh = h - 24, foot = 100;
  pen.rect(sx, sy, sw, sh, DAY.bg); pen.rect(sx, sy, sw, 32, DAY.wood); pen.rect(sx, sy + 32, sw, 4, DAY.edge);
  // Its name, where that computer's own window would say which device it is.
  pen.text(words.device, sx + 16, sy + 4, { size: 24, film: true, colour: DAY.onWood });
  ['tuxedo', 'siamese', 'blue', 'cream'].forEach((look, i) => pen.cat(look, loop('onduty', t + i), sx + 28 + i * 108, sy + 30, { cell: 4, accessory: 'none' }));
  pen.rect(sx + 12, sy + 100, sw - 24, 4, DAY.edge); pen.rect(sx + 12, sy + 104, sw - 24, 8, DAY.wood); pen.rect(sx + 12, sy + 112, sw - 24, 4, DAY.edge);
  pen.rect(sx, sy + sh - foot, sw, 4, DAY.edge); pen.rect(sx, sy + sh - foot + 4, sw, foot - 4, DAY.wood);
  if (got) {
    const lines = pen.wrap(ui(lang, 'transfers.received', { name: words.thisDevice, n: 1 }), sw - 64, 24, 'film').slice(0, 3);
    pen.rect(sx + 14, sy + sh - foot + 16, 20, 20, DAY.ok);
    lines.forEach((line, i) => pen.text(line, sx + 46, sy + sh - foot + 14 + (3 - lines.length) * 14 + i * 28, { size: 24, film: true, colour: DAY.onWood }));
  }
  return [x + w / 2, top + h / 2];
}

/* ── A terminal where an AI runs Catshelf's command line (45–46 s) ── */
function terminal(ctx, t, lang, lines) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], x = 940, y = 566, w = 940, h = 290;
  const rise = [28, 12, 4, 0][Math.min(3, Math.floor((t - T.WAYS.command + 0.1) * FPS / 3))], top = y + rise;
  pen.rect(x + 8, top + 10, w + 2, h + 2, '#1E242D');
  pen.rect(x - 2, top - 2, w + 4, h + 4, '#0E1116'); pen.rect(x, top, w, h, '#12161C'); pen.rect(x, top, w, 44, '#232A33');
  ['#E0584A', '#E8B83A', '#4FAE5A'].forEach((colour, k) => { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x + 26 + k * 26, top + 22, 8, 0, Math.PI * 2); ctx.fill(); });
  ctx.font = `600 22px ${SYS}`; ctx.wordSpacing = '0px'; ctx.fillStyle = '#CFD6DF'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(words.terminal2, x + w / 2 - ctx.measureText(words.terminal2).width / 2, top + 30);
  ctx.font = `20px ${MONO}`;
  let row = 0;
  lines.forEach(({ text, colour }) => {
    // wrap as a terminal does: by width, anywhere
    let rest = text;
    while (rest.length) {
      let n = rest.length;
      while (n > 1 && ctx.measureText(rest.slice(0, n)).width > w - 48) n -= 1;
      ctx.fillStyle = colour || '#9AD27A';
      ctx.fillText(rest.slice(0, n), x + 24, top + 84 + row * 30);
      rest = rest.slice(n); row += 1;
    }
  });
}

/* ── End card (51.5–60 s) ──────────────────────────── */
const SLEEPERS = CAST.concat([JOINED[3]]);

function endCard(ctx, t, lang) {
  const pen = new Pen(ctx, 1, NIGHT), words = FILM[lang], N = T.NIGHT, W = 1920, H = 1080;
  pen.rect(0, 0, W, H, NIGHT_DESK);
  // One shelf, a row of sleeping cats.
  const shelfY = 912, x0 = 128;
  SLEEPERS.forEach((cat, i) => {
    const x = x0 + 24 + i * 232;
    let spec = loop(i % 2 ? 'hibernate' : 'nap', t * 0.8 + i * 0.37);
    const last = i === SLEEPERS.length - 1;
    if (last && t >= N.eye) spec = { pose: 'sleep' };
    pen.cat(cat.look, spec, x, shelfY - 144, { cell: 8, collar: cat.collar, accessory: 'none' });
    if (last && t >= N.eye && t < N.shut) {
      // It opens one eye.
      const look = CatArt.LOOKS[cat.look];
      pen.rect(x + 13 * 8, shelfY - 144 + 11 * 8, 8, 16, look.e || '#2B2018');
      pen.rect(x + 13 * 8, shelfY - 144 + 11 * 8, 4, 4, '#FFFFFF');
      pen.burst(x + 80, shelfY - 180, t - N.eye, '#F8E9C9', 90, 8);
    }
  });
  pen.rect(x0, shelfY + 20, W - x0 * 2, 8, '#0B0709');
  pen.rect(x0, shelfY - 4, W - x0 * 2, 4, NIGHT.edge); pen.rect(x0, shelfY + 16, W - x0 * 2, 4, NIGHT.edge);
  pen.rect(x0, shelfY, W - x0 * 2, 16, NIGHT.wood); pen.rect(x0, shelfY, W - x0 * 2, 4, NIGHT.woodHi); pen.rect(x0, shelfY + 12, W - x0 * 2, 4, NIGHT.woodLo);
  // Four lines, one to a chord; each drops in like a nameplate.
  const dropAt = (at) => { const frame = Math.floor((t - at) * FPS + 1e-6); return frame < 0 ? null : frame < 3 ? -24 : frame < 6 ? -12 : frame < 9 ? 4 : 0; };
  const line = (k, y, size, colour) => {
    const d = dropAt(N.lines[k]);
    if (d === null) return 0;
    const w = pen.text(words.end[k], 960, y + d, { size, film: true, colour, align: 'center' });
    pen.burst(960, y + size / 2, t - N.lines[k], colour, size > 100 ? 420 : 300, 12);
    return w;
  };
  const top = 176, nameW = line(0, top, 144, '#FFF8E8');
  if (nameW) {
    // A small cat hops up beside the name and stays.
    const cx = snap(960 + nameW / 2 + 28), spec = once('arrive', t - N.lines[0] - 0.15) || loop('onduty', t);
    if (t >= N.lines[0] + 0.15) pen.cat('orange', spec, cx, top + 144 - 108 + 4, { cell: 6, collar: '#2f9e8f', accessory: 'none' });
    pen.rect(snap(960 - nameW / 2), top + 144 + 12, snap(nameW + 28 + 120), 8, HONEY);
  }
  line(1, top + 232, 48, '#FFF8E8');
  line(2, top + 340, 48, HONEY);
  line(3, top + 428, 48, '#A88F7A');
}

/* ── Cover (1280×720) ──────────────────────────────── */
function cover(ctx, lang) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], W = 1280, H = 720, P = DAY;
  // The desk under the lamp, in the app's three hard steps.
  pen.rect(0, 0, W, H, P.dusk);
  const pool = (cx, cy, rx, ry, colour) => { for (let y = 0; y < H; y += 4) { const k = 1 - Math.pow((y + 2 - cy) / ry, 2); if (k > 0) { const half = Math.round(rx * Math.sqrt(k) / 4) * 4; pen.rect(Math.max(0, cx - half), y, Math.min(W, cx + half) - Math.max(0, cx - half), 4, colour); } } };
  pool(640, 300, 880, 560, P.bg); pool(640, 280, 500, 300, P.lamp);
  // Top and bottom edges of the desk.
  pen.rect(0, 0, W, 56, P.wood); pen.rect(0, 0, W, 4, P.woodHi); pen.rect(0, 48, W, 8, P.woodLo); pen.rect(0, 56, W, 4, P.edge); pen.rect(0, 60, W, 8, P.shade);
  pen.rect(0, H - 52, W, 52, P.wood); pen.rect(0, H - 56, W, 4, P.edge); pen.rect(0, H - 52, W, 4, P.woodHi);
  pen.text(words.end[2], W / 2, H - 44, { size: 36, film: true, colour: P.onWood, align: 'center' });
  // The name and the one line.
  const nameW = pen.text(words.end[0], W / 2 - 60, 104, { size: 144, film: true, colour: P.ink, align: 'center' });
  pen.cat('orange', CatArt.ACTIONS.onduty.frames[1], snap(W / 2 - 60 + nameW / 2 + 24), 104 + 144 - 108, { cell: 6, collar: '#2f9e8f', accessory: 'none' });
  pen.rect(snap(W / 2 - 60 - nameW / 2), 104 + 156, snap(nameW + 150), 8, SEAL);
  pen.text(words.end[1], W / 2, 292, { size: 48, film: true, colour: P.ink2, align: 'center' });
  // One shelf, six cats, each doing something different.
  const shelfY = 560, poses = [['working', 0], ['onduty', 0], ['busy', 3], ['play', 2], ['spent', 0], ['nap', 1]];
  CAST.forEach((cat, i) => {
    const [action, frame] = poses[i], spec = CatArt.ACTIONS[action].frames[frame];
    pen.cat(cat.look, spec, 100 + i * 184, shelfY - 144, { cell: 8, collar: cat.collar, accessory: 'none', papers: action === 'busy' ? 3 : 0 });
  });
  pen.rect(56, shelfY + 20, W - 112, 12, P.shade);
  pen.rect(56, shelfY - 4, W - 112, 4, P.edge); pen.rect(56, shelfY + 16, W - 112, 4, P.edge);
  pen.rect(56, shelfY, W - 112, 16, P.wood); pen.rect(56, shelfY, W - 112, 4, P.woodHi); pen.rect(56, shelfY + 12, W - 112, 4, P.woodLo);
}

module.exports = { caption, captionBox, plateBox, plate, cursor, envelope, flight, lock, otherComputer, terminal, endCard, cover, HONEY };
void clamp; void ease;
