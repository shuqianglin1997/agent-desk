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
 * Three framings of the same thing: wide (1920×1080) uses the film's camera
 * places; tall (1080×1440) is composed again for a 3:4 feed (film.js, TALL);
 * reel (1080×1920) is the tall picture between two bands, for a 9:16 player
 * (film.js, REEL): the name and the one line above, how to find it below.
 */

const { Pen, DAY } = require('./draw.js');
const film = require('./film.js');
const over = require('./overlay.js');
const ending = require('./ending.js');
const { FILM, SHORT } = require('./strings.js');
const { cues: filmCues } = require('./cues.js');

const FPS = 60, END = 15, CARD = 12.5;
/*
 * at: where the stretch begins here; src: where it begins in the film.
 * wide: [desktop, tilt], one camera place for the whole stretch.
 * tall: [[film time, x, y]…]: the first is where the stretch opens, the rest are moves (three held steps, like
 * every camera move in the film) that begin on a beat or a clean part of one. A key marked 'cut' is not a move: the
 * camera is simply there from that frame, and it is on a beat like every other cut of this piece.
 * clients: in the tall framing the official clients' windows are drawn over the Catshelf window in this stretch.
 *
 * Copying (9.0–10.5), tall: the row is ticked a quarter second before the button is pressed, and the two are further
 * apart in the window than the frame is wide. A move that begins on the press has the button half outside the frame
 * on its first step, so the camera cuts: on the row while it is ticked (its title and its tick in view), on the button
 * as it is pressed at 9.5, and a quarter second later it moves back to the row, where the slip lands in the footer.
 */
const STRETCHES = [
  { at: 0, src: 9.75, wide: [0, 0], tall: [[9.75, 0, 0], [10.5, 406, 0]] },
  { at: 1.5, src: 12, wide: [1, 0], tall: [[12, 0, 0]], clients: true },
  { at: 3.5, src: 16, wide: [0, 0], tall: [[16, 0, 0], [16.75, 406, 0]] },
  { at: 5, src: 18, wide: [0, film.LEDGER_TILT], tall: [[18, 0, 150]] },
  { at: 6, src: 19.5, wide: [0, film.PLATES_TILT], tall: [[19.5, 0, 150]] },
  { at: 7, src: 22, wide: [0, film.PLATES_TILT], tall: [[22, 0, 150]] },
  { at: 8, src: 24.5, wide: [0, 0], tall: [[24.5, 0, 0]] },
  { at: 9, src: 26, wide: [0, film.LEDGER_TILT], tall: [[26, 0, 150], [26.5, 420, 150, 'cut'], [26.75, 0, 150]] },
  { at: 10.5, src: 28.5, wide: [1, 0], tall: [[28.5, 270, 0]], clients: true }
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
  const since = source - frames(to[0]), p = index === 0 || to[3] === 'cut' ? 1 : since < 4 ? 0.55 : since < 8 ? 0.85 : 1;
  const place = (a, b) => Math.round((a + (b - a) * p) / 2) * 2, lift = (y) => Math.max(y, view.lift || 0);
  return { ...film.closeAt(place(from[1], to[1]), place(lift(from[2]), lift(to[2])), Boolean(stretch.clients), view.picture ? view.picture.y : 0), moving: p < 1 };
}

// Every camera move of the tall framing, in this cut's own seconds; and the cuts it makes inside a stretch.
const tallKeys = (viewName, cuts) => (!film.VIEWS[viewName].over ? [] : STRETCHES.flatMap((stretch) => stretch.tall.slice(1).filter((key) => (key[3] === 'cut') === cuts).map((key) => stretch.at + key[0] - stretch.src)));
const moves = (viewName) => tallKeys(viewName, false);
const jumps = (viewName) => tallKeys(viewName, true);

function captionAt(frame, lang) {
  let hit = null;
  SHORT[lang].captions.forEach((entry) => { if (frame >= frames(entry[0])) hit = entry; });
  return hit && hit[1] ? { raw: hit[1], age: (frame - frames(hit[0])) / FPS, at: hit[0] } : null;
}

/*
 * The two bands of the 9:16 framing, drawn over the picture.
 * Above: the window's top bar made tall — its wood, its lip, the name in the two tones the app writes it in there —
 * and the one line. Below: the edge of the desk as on the covers, with how to find it.
 */
function bands(ctx, lang, view) {
  const pen = new Pen(ctx, 1, DAY), P = DAY, W = view.width, H = view.height, top = view.picture.y, foot = top + view.picture.h, words = FILM[lang];
  const centred = (parts, y, size, colours) => {
    const widths = parts.map((part) => pen.width(part, size, 'film'));
    let x = Math.round((W - widths.reduce((a, b) => a + b, 0)) / 8) * 4;
    parts.forEach((part, k) => { pen.text(part, x, y, { size, film: true, colour: colours[k] }); x += widths[k]; });
  };
  pen.rect(0, 0, W, top, P.wood); pen.rect(0, 0, W, 4, P.woodHi); pen.rect(0, top - 8, W, 8, P.woodLo);
  pen.rect(0, top, W, 4, P.edge); pen.rect(0, top + 4, W, 8, P.shade);
  const name = words.end[0], brand = /^Cat(shelf)$/.test(name) ? ['Cat', 'shelf'] : [name];
  centred(brand, 24, 96, [P.onWood, P.woodAccent]);
  centred([words.end[1]], 136, 36, [P.onWood]);
  pen.rect(0, foot, W, H - foot, P.wood); pen.rect(0, foot - 4, W, 4, P.edge); pen.rect(0, foot, W, 4, P.woodHi);
  // One line where it fits, otherwise the search on one line and the rest under it.
  const find = words.end[3], word = SHORT[lang].keyword, parted = (text) => { const at = text.indexOf(word); return at < 0 ? [text] : [text.slice(0, at), word, text.slice(at + word.length)]; };
  const tones = (parts) => parts.map((part) => (part === word ? P.woodAccent : P.onWood));
  if (pen.width(find, 48, 'film') <= W - 96) centred(parted(find), foot + 36, 48, tones(parted(find)));
  else {
    const [first, ...rest] = find.split(' · ');
    centred(parted(first), foot + 36, 48, tones(parted(first)));
    centred([rest.join(' · ')], foot + 100, 36, [P.onWood]);
  }
}

function render(ctx, time, lang, viewName = 'wide') {
  const view = film.VIEWS[viewName], frame = Math.max(0, Math.min(frames(END) - 1, Math.round(time * FPS)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (frame >= frames(CARD)) ending.draw(ctx, (frame - frames(CARD)) / FPS, lang, view);
  else {
    const stretch = stretchAt(frame), source = sourceFrame(frame);
    film.scene(ctx, source / FPS, lang, film.planFor(lang, ctx, view), cameraFor(stretch, source, view));
    if (view.picture) bands(ctx, lang, view);
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

module.exports = { render, cues, captionBoxes, moves, jumps, sourceFrame, STRETCHES, CUTS, FPS, END, CARD };
