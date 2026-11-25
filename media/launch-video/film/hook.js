'use strict';

/*
 * 0–4 s: one seat, six cats.
 *
 * A dark room, one small desk. The cats take turns on it, faster and faster;
 * the sign above says whose sign-in it is now. From 2 s the papers on the desk
 * get knocked to the floor. At 3.5 s one cat has an idea.
 *
 * Drawn in frame pixels on a 4px grid; cats are the app's own, three screen
 * pixels to the grid square larger than on the shelf (a 12px square).
 */

const { NIGHT, CatArt, loop, clamp, mix, ease, within } = require('./draw.js');
const { FILM, CAST } = require('./strings.js');
const { NIGHT_DESK } = require('./app.js');

const CELL = 12, CAT_W = 20 * CELL, CAT_H = 18 * CELL;
const SEAT = { x: 960 - CAT_W / 2, y: 384 };          // top-left of the seated cat
const DESK = { x: 716, y: 600, w: 488 };
const FLOOR = 868;
const HOME = [8, 248, 488, 1192, 1432, 1672];          // where each cat waits, by cast index
// The seat changes hands on these times; the last is the idea.
const SWAPS = [1, 1.5, 2, 2.5, 2.75, 3, 3.25];
const IDEA = 3.5;
const JUMP = 9 / 60;                                    // a jump takes nine frames, in three held positions

// Papers: where each lands, and which change of seat knocks it down.
const PAPERS = [
  [2, 300, 816], [2, 1340, 838], [3, 640, 846], [3, 1580, 812], [4, 150, 846], [4, 1090, 850], [4, 1780, 842],
  [5, 470, 820], [5, 1230, 812], [6, 820, 838], [6, 1500, 850], [6, 60, 812]
].map(([swap, x, y], k) => ({ at: SWAPS[swap], x, y, from: [1088 + (k % 3) * 8, 556 - (k % 4) * 4] }));

const snap = (value) => Math.round(value / 4) * 4;
const seatedAt = (t) => SWAPS.filter((s) => t >= s).length % CAST.length;

function sheet(pen, x, y, tilt) {
  pen.rect(x - 4, y - 4, 56, 40, '#100A0D');
  pen.rect(x, y, 48, 32, '#E9DCC0');
  pen.rect(x + 8, y + 8 + (tilt ? 4 : 0), 28, 4, '#8E7B68');
  pen.rect(x + 8, y + 20 - (tilt ? 4 : 0), 20, 4, '#8E7B68');
}

function bulb(pen, x, y, age) {
  const pop = age < 4 / 60 ? 8 : 0;
  pen.rect(x - 28 - pop, y - 44 - pop, 56 + pop * 2, 52 + pop * 2, '#59331D');
  pen.rect(x - 24 - pop, y - 40 - pop, 48 + pop * 2, 44 + pop * 2, '#F2C14E');
  pen.rect(x - 16 - pop, y - 32 - pop, 12, 12, '#FFF3C4');
  pen.rect(x - 16, y + 8, 32, 16, '#59331D');
  pen.rect(x - 12, y + 8, 24, 12, '#8D8F98');
  // rays, in two held lengths
  const reach = age < 6 / 60 ? 52 : 68;
  for (let k = 0; k < 8; k += 1) {
    const angle = Math.PI + k * Math.PI / 7;
    if (k === 0 || k === 7) continue;
    pen.rect(snap(x + Math.cos(angle) * reach) - 6, snap(y - 20 + Math.sin(angle) * reach) - 6, 12, 12, '#F2C14E');
  }
}

function draw(pen, t, lang) {
  const W = 1920, H = 1080, P = NIGHT, words = FILM[lang];
  pen.rect(0, 0, W, H, NIGHT_DESK);
  // A dim pool where the lamp will be: stepped, not faded.
  for (let y = 260; y < FLOOR; y += 4) {
    const k = 1 - Math.pow((y + 2 - 600) / 340, 2);
    if (k > 0) { const half = Math.round(700 * Math.sqrt(k) / 4) * 4; pen.rect(960 - half, y, half * 2, 4, '#1A1216'); }
  }
  pen.rect(0, FLOOR, W, H - FLOOR, '#1B1417');
  pen.dither(0, FLOOR - 8, W, 8, '#1B1417', 8, 4);
  pen.rect(0, FLOOR, W, 4, '#2B1F22');

  const seated = seatedAt(t), last = SWAPS.filter((s) => t >= s).pop();
  const since = last === undefined ? 9 : t - last, previous = (seated + CAST.length - 1) % CAST.length;
  const idea = t >= IDEA;

  // The sign: whose sign-in it is.
  const who = CAST[seated], label = words.login + words.names[who.name] + ' · ' + who.client;
  const signW = snap(pen.width(label, 48, 'film') + 72), signX = 960 - signW / 2, signY = 112 + (since < 3 / 60 ? -8 : since < 6 / 60 ? 4 : 0);
  if (!idea) {
    pen.rect(signX + 8, signY + 8, signW, 80, '#0B0709');
    pen.rect(signX - 4, signY - 4, signW + 8, 88, P.edge);
    pen.rect(signX, signY, signW, 80, P.float);
    pen.rect(signX, signY, 12, 80, P.brand);
    pen.text(label, 960 + 6, signY + 16, { size: 48, film: true, colour: P.ink, align: 'center' });
    for (let k = 0; k < 3; k += 1) pen.rect(signX + signW - 60 + k * 16, signY + 92, 8, 8, Math.floor(t * 6) % 3 === k ? P.brand : '#3A2A30');
  }

  // The desk: one plank, two legs, a pile of paper.
  pen.rect(DESK.x + 24, DESK.y + 24, 16, FLOOR - DESK.y - 24, P.woodLo); pen.rect(DESK.x + DESK.w - 40, DESK.y + 24, 16, FLOOR - DESK.y - 24, P.woodLo);
  const left = PAPERS.filter((paper) => t < paper.at).length;
  for (let k = 0; k < Math.min(left, 12); k += 1) { pen.rect(1076, DESK.y - 8 - k * 4, 64, 4, k % 2 ? '#D8C9A8' : '#E9DCC0'); }
  if (left) pen.rect(1072, DESK.y - 8 - left * 4, 72, 4, '#100A0D');

  // Waiting cats sit on the floor; the two that are changing places are in the air.
  CAST.forEach((cat, i) => {
    let x = HOME[i], y = FLOOR - CAT_H, spec = loop('onduty', t + i * 0.7);
    const arriving = i === seated && since < JUMP && last !== undefined, leaving = i === previous && since < JUMP && last !== undefined;
    if (arriving || leaving) {
      const p = ease(since / JUMP, 3), from = arriving ? [HOME[i], FLOOR - CAT_H] : [SEAT.x, SEAT.y], to = arriving ? [SEAT.x, SEAT.y] : [HOME[i], FLOOR - CAT_H];
      x = snap(mix(from[0], to[0], p)); y = snap(mix(from[1], to[1], p) - Math.sin(clamp(Math.round(since / JUMP * 3) / 3) * Math.PI) * 96);
      spec = { pose: 'leap' };
    } else if (i === seated) {
      x = SEAT.x; y = SEAT.y + (since < JUMP + 3 / 60 && last !== undefined ? 8 : 0);
      spec = idea ? { pose: 'sit', tail: 2, eyes: 'wide' } : since < JUMP + 3 / 60 && last !== undefined ? { pose: 'crouch', tail: 0 } : loop('working', t * 2);
    } else if (idea) spec = { pose: 'sit', tail: 1, eyes: 'wide' };
    else if (i === (seated + 1) % CAST.length) spec = { pose: 'crouch', tail: 1 };
    pen.cat(cat.look, spec, x, y, { cell: CELL, collar: cat.collar, accessory: 'none' });
  });
  // The plank goes over the seated cat's feet, as on the shelf.
  pen.rect(DESK.x, DESK.y + 24, DESK.w, 8, '#0B0709');
  pen.rect(DESK.x, DESK.y - 4, DESK.w, 4, P.edge); pen.rect(DESK.x, DESK.y + 20, DESK.w, 4, P.edge);
  pen.rect(DESK.x, DESK.y, DESK.w, 20, P.wood); pen.rect(DESK.x, DESK.y, DESK.w, 4, P.woodHi); pen.rect(DESK.x, DESK.y + 16, DESK.w, 4, P.woodLo);

  // Papers on the floor, and the ones in flight.
  PAPERS.forEach((paper, k) => {
    if (t < paper.at) return;
    const age = t - paper.at, flight = 12 / 60;
    if (age >= flight) { sheet(pen, paper.x, paper.y, k % 2); return; }
    const p = ease(age / flight, 4);
    sheet(pen, snap(mix(paper.from[0], paper.x, p)), snap(mix(paper.from[1], paper.y, p) - Math.sin(clamp(Math.round(age / flight * 4) / 4) * Math.PI) * 180), (k + Math.floor(age * 30)) % 2);
  });

  // Each change of seat goes off like a small bang.
  SWAPS.forEach((s) => pen.burst(960, DESK.y - 108, t - s, '#F8E9C9', 190, 12));
  if (idea) bulb(pen, 960, SEAT.y - 36, t - IDEA);
  void within;
}

module.exports = { draw, SWAPS, IDEA, PAPERS };
