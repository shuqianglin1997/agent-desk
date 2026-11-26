'use strict';

/*
 * The end card of the 15-second cut.
 *
 * It is the film's cover design in motion: the desk under the lamp, the name
 * with a small cat beside it, the one line, the six cats on a shelf each doing
 * something different, and — the line that matters most here — how to find
 * it, on a plate like the captions' only larger. Three drops on three chords;
 * on the last chord the cats that are awake cheer.
 */

const { Pen, DAY, CatArt, loop, once } = require('./draw.js');
const { FILM, CAST, SHORT } = require('./strings.js');

const FPS = 60, INK = '#3B272C', PAPER = '#FBF2DB', SEAL = '#AE3319';
const snap = (value, grid = 4) => Math.round(value / grid) * grid;
// Seconds after the card appears: the name, the one line, how to find it, the cheer.
const AT = { name: 0, line: 0.25, find: 0.5, cheer: 1.5 };
// What each cat is doing, and the frame it holds on the still.
const DOING = [['working', 0], ['onduty', 0], ['busy', 3], ['play', 2], ['spent', 0], ['nap', 1]];
const AWAKE = [0, 1, 2, 3];

// Dropping in like a nameplate, at the size of the frame: three steps, 4px past, back.
function dropAt(age, start) {
  const frame = Math.floor((age - start) * FPS + 1e-6);
  return frame < 0 ? null : frame < 3 ? -24 : frame < 6 ? -12 : frame < 9 ? 4 : 0;
}

// How the "search for it" line is set: one line where it fits, otherwise the search on one line and the rest under it.
function findLayout(pen, lang, room) {
  const text = FILM[lang].end[3], word = SHORT[lang].keyword, at = text.indexOf(word);
  const head = text.slice(0, at), tail = text.slice(at + word.length);
  for (const size of [72, 60]) {
    const widths = [head, word, tail].map((part) => pen.width(part, size, 'film')), total = widths.reduce((a, b) => a + b, 0);
    if (total + 112 <= room) return { lines: [{ size, parts: [head, word, tail], widths, total }], w: snap(total + 112), h: size + 48 };
  }
  const rest = tail.replace(/^[\s·]+/, '');
  for (const size of [72, 60, 48]) {
    const widths = [head, word].map((part) => pen.width(part, size, 'film')), total = widths[0] + widths[1], restW = pen.width(rest, 48, 'film');
    if (Math.max(total, restW) + 112 <= room || size === 48) {
      return { lines: [{ size, parts: [head, word], widths, total }, { size: 48, parts: [rest], widths: [restW], total: restW }], w: snap(Math.max(total, restW) + 112), h: size + 48 + 64 };
    }
  }
  return null;
}

// The desk under the lamp, in the app's three hard steps, and its top and bottom edges. foot: how tall the bottom edge is.
function desk(pen, W, H, foot = 80) {
  const P = DAY, tall = H > W;
  pen.rect(0, 0, W, H, P.dusk);
  const pool = (cx, cy, rx, ry, colour) => { for (let y = 0; y < H; y += 4) { const k = 1 - Math.pow((y + 2 - cy) / ry, 2); if (k > 0) { const half = Math.round(rx * Math.sqrt(k) / 4) * 4; pen.rect(Math.max(0, cx - half), y, Math.min(W, cx + half) - Math.max(0, cx - half), 4, colour); } } };
  pool(W / 2, snap(H * 0.42), snap(W * (tall ? 0.9 : 0.69)), snap(H * 0.78), P.bg);
  pool(W / 2, snap(H * 0.39), snap(W * (tall ? 0.6 : 0.39)), snap(H * 0.42), P.lamp);
  pen.rect(0, 0, W, 84, P.wood); pen.rect(0, 0, W, 4, P.woodHi); pen.rect(0, 72, W, 12, P.woodLo); pen.rect(0, 84, W, 4, P.edge); pen.rect(0, 88, W, 12, P.shade);
  pen.rect(0, H - foot, W, foot, P.wood); pen.rect(0, H - foot - 4, W, 4, P.edge); pen.rect(0, H - foot, W, 4, P.woodHi);
}

// One board of the shelf across the frame, its top at shelfY.
function board(pen, W, shelfY) {
  const P = DAY;
  pen.rect(84, shelfY + 28, W - 168, 12, P.shade);
  pen.rect(84, shelfY - 4, W - 168, 4, P.edge); pen.rect(84, shelfY + 24, W - 168, 4, P.edge);
  pen.rect(84, shelfY, W - 168, 24, P.wood); pen.rect(84, shelfY, W - 168, 4, P.woodHi); pen.rect(84, shelfY + 20, W - 168, 4, P.woodLo);
}

/*
 * age: seconds since the card appeared. still: draw it finished and at rest.
 * view: { width, height } — 1920×1080, or 1080×1440 with the cats on two shelves.
 */
function draw(ctx, age, lang, view, still = false) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], P = DAY, W = view.width, H = view.height, tall = H > W;
  const t = still ? 60 : age;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  desk(pen, W, H);

  const top = tall ? 164 : 128, cx = W / 2 - 60;
  // The name, a small cat hopping up beside it, a seal-red rule under both.
  const nameD = dropAt(t, AT.name);
  if (nameD !== null) {
    const nameW = pen.text(words.end[0], cx, top + nameD, { size: 144, film: true, colour: P.ink, align: 'center' });
    pen.burst(cx, top + 72, t - AT.name, SEAL, 420, 12);
    const spec = still ? CatArt.ACTIONS.onduty.frames[1] : once('arrive', t - AT.name - 0.15) || loop('onduty', t);
    if (t >= AT.name + 0.15) pen.cat('orange', spec, snap(cx + nameW / 2 + 24), top + 144 - 108, { cell: 6, collar: '#2f9e8f', accessory: 'none' });
    pen.rect(snap(cx - nameW / 2), top + 156, snap(nameW + 150), 8, SEAL);
  }
  const lineD = dropAt(t, AT.line);
  if (lineD !== null) pen.text(words.end[1], W / 2, top + 196 + lineD, { size: 48, film: true, colour: P.ink2, align: 'center' });

  // The shelves: six cats, each doing something different, hopping on one after another.
  const cell = 12, catW = 20 * cell, catH = 18 * cell, perShelf = tall ? 3 : 6, pitch = tall ? 300 : 276;
  const x0 = Math.round((W - ((perShelf - 1) * pitch + catW)) / 8) * 4, shelves = tall ? [716, 1004] : [656];
  CAST.forEach((cat, i) => {
    const [action, frame] = DOING[i], shelfY = shelves[Math.floor(i / perShelf)], x = x0 + (i % perShelf) * pitch, since = t - i * 0.05;
    if (since < 0) return;
    let spec = still ? CatArt.ACTIONS[action].frames[frame] : once('arrive', since) || loop(action, t + i * 0.37);
    if (!still && AWAKE.includes(i)) spec = once('cheer', t - AT.cheer - i * 0.04) || spec;
    pen.cat(cat.look, spec, x, shelfY - catH, { cell, collar: cat.collar, accessory: 'none', papers: action === 'busy' ? 3 : 0 });
  });
  shelves.forEach((shelfY) => board(pen, W, shelfY));

  // How to find it: the plate of the captions, larger, the word to type in seal red.
  const findD = dropAt(t, AT.find);
  if (findD !== null) {
    const L = findLayout(pen, lang, W - 160), x = Math.round((W - L.w) / 8) * 4, y = (tall ? 1112 : 772) + findD;
    pen.rect(x + 8, y + 8, L.w + 4, L.h + 4, '#1B1417');
    pen.rect(x - 4, y - 4, L.w + 8, L.h + 8, INK);
    pen.rect(x, y, L.w, L.h, PAPER);
    pen.rect(x, y, 16, L.h, SEAL);
    let ty = y + 24;
    L.lines.forEach((line) => {
      let tx = snap(x + 16 + (L.w - 16 - line.total) / 2);
      line.parts.forEach((part, k) => { pen.text(part, tx, ty, { size: line.size, film: true, colour: k === 1 ? SEAL : INK }); tx += line.widths[k]; });
      ty += line.size + 16;
    });
    pen.burst(W / 2, y + L.h / 2, t - AT.find, SEAL, 520, 12);
  }
}

module.exports = { draw, desk, board, findLayout, AT };
