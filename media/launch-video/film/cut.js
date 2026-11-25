'use strict';

/*
 * The 15-second cut: the film recut, nothing redrawn.
 *
 * Every picture here is a frame of the one-minute film (film.js's scene at a
 * source time) with the camera standing where this cut needs it, then the
 * end card. 120 beats a minute as in the film: every cut is on a beat, and
 * since each stretch starts a whole number of quarter beats away from its
 * source, what happens inside it still lands on the beat.
 *
 *   0.0  the shelf fills: five more cats hop on, one every half beat
 *   1.5  three accounts of one platform, opened one after another
 *   3.5  who is busy, who is out, who is asleep
 *   5.0  one ledger: the papers fly in; new replies light up; a search finds one
 *   8.0  this one runs out → tick its chat, copy → paste to another cat → it carries on
 *  12.5  the end card
 *
 * Two framings of the same thing: wide (1920×1080) uses the film's camera
 * places; tall (1080×1440) is composed again for a 3:4 feed (film.js, TALL).
 */

const film = require('./film.js');
const over = require('./overlay.js');
const ending = require('./ending.js');
const { SHORT } = require('./strings.js');
const { cues: filmCues } = require('./cues.js');

const FPS = 60, END = 15, CARD = 12.5;
/*
 * at: where the stretch begins here; src: where it begins in the film.
 * wide: [desktop, tilt], one camera place for the whole stretch.
 * tall: [[film time, x, y, clients over the window]…]: the first is where the stretch opens, the rest are moves
 * (three held steps, like every camera move in the film) that begin on a beat or a clean part of one.
 */
const STRETCHES = [
  { at: 0, src: 9.75, wide: [0, 0], tall: [[9.75, 0, 0], [10.5, 406, 0]] },
  { at: 1.5, src: 12, wide: [1, 0], tall: [[12, 0, 0, true]] },
  { at: 3.5, src: 16, wide: [0, 0], tall: [[16, 0, 0], [16.75, 406, 0]] },
  { at: 5, src: 18, wide: [0, film.LEDGER_TILT], tall: [[18, 0, 150]] },
  { at: 6, src: 19.5, wide: [0, film.PLATES_TILT], tall: [[19.5, 0, 150]] },
  { at: 7, src: 22, wide: [0, film.PLATES_TILT], tall: [[22, 0, 150]] },
  { at: 8, src: 24.5, wide: [0, 0], tall: [[24.5, 0, 0]] },
  { at: 9, src: 26, wide: [0, film.LEDGER_TILT], tall: [[26, 0, 150], [26.5, 420, 150], [27, 0, 150]] },
  { at: 10.5, src: 28.5, wide: [1, 0], tall: [[28.5, 270, 0, true]] }
];
const CUTS = STRETCHES.map((stretch) => stretch.at).concat([CARD]);
const frames = (seconds) => Math.round(seconds * FPS);

function stretchAt(frame) {
  let hit = STRETCHES[0];
  STRETCHES.forEach((stretch) => { if (frame >= frames(stretch.at)) hit = stretch; });
  return hit;
}

// Frame n of the cut is this frame of the film (whole frames, so a picture here is exactly a picture there).
function sourceFrame(frame) {
  const stretch = stretchAt(frame);
  return frames(stretch.src) + frame - frames(stretch.at);
}

function cameraFor(stretch, source, view) {
  if (view.name === 'wide') return stretch.wide[0] ? film.desktopCam() : film.closeAt(0, stretch.wide[1]);
  let index = 0;
  stretch.tall.forEach((key, i) => { if (source >= frames(key[0])) index = i; });
  const to = stretch.tall[index], from = stretch.tall[Math.max(0, index - 1)];
  const since = source - frames(to[0]), p = index === 0 ? 1 : since < 4 ? 0.55 : since < 8 ? 0.85 : 1;
  const place = (a, b) => Math.round((a + (b - a) * p) / 2) * 2;
  return { ...film.closeAt(place(from[1], to[1]), place(from[2], to[2]), Boolean(stretch.tall[0][3])), moving: p < 1 };
}

// Every camera move of the tall framing, in this cut's own seconds.
function moves(viewName) {
  if (viewName !== 'tall') return [];
  return STRETCHES.flatMap((stretch) => stretch.tall.slice(1).map((key) => stretch.at + key[0] - stretch.src));
}

function captionAt(frame, lang) {
  let hit = null;
  SHORT[lang].captions.forEach((entry) => { if (frame >= frames(entry[0])) hit = entry; });
  return hit && hit[1] ? { raw: hit[1], age: (frame - frames(hit[0])) / FPS, at: hit[0] } : null;
}

function render(ctx, time, lang, viewName = 'wide') {
  const view = film.VIEWS[viewName], frame = Math.max(0, Math.min(frames(END) - 1, Math.round(time * FPS)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (frame >= frames(CARD)) ending.draw(ctx, (frame - frames(CARD)) / FPS, lang, view);
  else {
    const stretch = stretchAt(frame), source = sourceFrame(frame);
    film.scene(ctx, source / FPS, lang, film.planFor(lang, ctx, view), cameraFor(stretch, source, view));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const caption = captionAt(frame, lang);
  if (caption) over.plate(ctx, over.plateBox(ctx, caption.raw, caption.age, view.caption));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Where each caption sits once it has landed (frame pixels), measured with the real font.
function captionBoxes(ctx, lang, viewName = 'wide') {
  const view = film.VIEWS[viewName];
  return SHORT[lang].captions.filter((entry) => entry[1]).map(([at, raw]) => {
    const box = over.plateBox(ctx, raw, 1, view.caption);
    return { at, x: (box.x - 2) * 2, y: (box.y - 2) * 2, w: (box.w + 8) * 2, h: 96, text: box.parts.join('') };
  });
}

/*
 * Sound: the film's own cues that fall inside a stretch, moved with it, and four for the end card.
 * (A cue exactly on a cut belongs to the stretch that begins there.)
 */
function cues(lang) {
  const list = [[0, 'mew', 0]];
  STRETCHES.forEach((stretch, i) => {
    const length = (STRETCHES[i + 1] ? STRETCHES[i + 1].at : CARD) - stretch.at;
    filmCues(lang).forEach(([at, name, seed]) => { if (at >= stretch.src - 1e-9 && at < stretch.src + length - 1e-9) list.push([Math.round((stretch.at + at - stretch.src) * 1000) / 1000, name, seed]); });
  });
  const A = ending.AT;
  list.push([CARD + A.name, 'arrive'], [CARD + A.find, 'stamp'], [CARD + A.cheer, 'ready'], [CARD + A.cheer + 0.05, 'mew', 0]);
  return list.sort((a, b) => a[0] - b[0]);
}

module.exports = { render, cues, captionBoxes, moves, sourceFrame, STRETCHES, CUTS, FPS, END, CARD };
