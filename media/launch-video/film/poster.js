'use strict';

/*
 * The 3:4 cover (1080×1440) for a feed where it is first seen a third of a
 * phone's width wide: whether anyone taps is decided by what can be read at
 * that size.
 *
 *   top     two lines as large as the frame allows, the words that matter in seal red
 *   middle  two boards of the shelf, four cats, each in a state the app shows:
 *           typing, behind a stack of paper and sweating, out of energy and flat, asleep.
 *           Over each, the film's pointing tag (the one that says "快没电" at 25 s) with
 *           what the app itself says of that cat: its card's line or its energy.
 *   bottom  how to find it, written on the edge of the desk as on the 16:9 cover
 *
 * Nothing is drawn here for the first time: the desk and the boards are the end
 * card's (ending.js), the cats are cat-art's frames, the tag is state.js's
 * pointNote four times its size in the window (48px words, as large as a caption).
 */

const { Pen, DAY, CatArt } = require('./draw.js');
const { ui, FILM, CAST, SHORT } = require('./strings.js');
const { pointNote } = require('./state.js');
const ending = require('./ending.js');

const W = 1080, H = 1440, FOOT = 120, SEAL = '#AE3319';
const snap = (value, grid = 4) => Math.round(value / grid) * grid;

const HEAD_TOPS = [140, 284], HEAD_SIZES = [120, 108, 96, 84, 72], HEAD_ROOM = W - 112;
const CELL = 16, CAT_W = 20 * CELL, CAT_H = 18 * CELL, PITCH = 480, X0 = snap((W - PITCH - CAT_W) / 2);
const BOARDS = [860, 1216];
/*
 * Who sits where. who: index into CAST. frame: the frame of its action that is held.
 * says: the app's own words for that state. at: [grid column the tag is centred on, grid row its tail ends above] —
 * a sitting cat's tag stands over its head; the flat one's comes down to it; the sleeper's stands left of its z's
 * (until: the grid column it must end before, however long the word is).
 */
const CATS = [
  { who: 0, action: 'working', frame: 0, papers: 0, says: (lang) => ui(lang, 'card.running', { n: 1 }), at: [10, 0] },
  { who: 3, action: 'busy', frame: 1, papers: 3, says: (lang) => ui(lang, 'card.running', { n: 3 }), at: [10, 0] },
  { who: 4, action: 'spent', frame: 0, papers: 0, says: (lang) => ui(lang, 'energy.exhausted'), at: [10, 11] },
  { who: 5, action: 'nap', frame: 1, papers: 0, says: (lang) => ui(lang, 'state.nap'), at: [7, 7], until: 14 }
];

const split = (raw) => raw.split(/\[\[|\]\]/);

// Where everything sits, measured with the real font.
function layout(ctx, lang) {
  const pen = new Pen(ctx, 1, DAY), words = SHORT[lang].cover.map(split);
  const widthsAt = (size) => words.map((parts) => parts.map((part) => pen.width(part, size, 'film')));
  const size = HEAD_SIZES.find((candidate) => widthsAt(candidate).every((widths) => widths.reduce((a, b) => a + b, 0) <= HEAD_ROOM)) || HEAD_SIZES[HEAD_SIZES.length - 1];
  const head = words.map((parts, i) => {
    const widths = widthsAt(size)[i], total = widths.reduce((a, b) => a + b, 0);
    return { parts, widths, size, x: snap((W - total) / 2), y: HEAD_TOPS[i], w: total, h: size, text: parts.join('') };
  });
  const small = new Pen(ctx, 4, DAY);
  const cats = CATS.map((cat, i) => {
    const x = X0 + (i % 2) * PITCH, y = BOARDS[Math.floor(i / 2)] - CAT_H, label = cat.says(lang);
    // In the tag's own units (4px): the paper is 20 high with a 2 edge, the tail ends 6 under it.
    // Its left edge on a whole unit, so every edge of it is on the frame's 4px grid.
    const w = Math.ceil(small.width(label)) + 20, top = Math.round((y + cat.at[1] * CELL - 8) / 4) - 26;
    let cx = Math.round((x + cat.at[0] * CELL) / 4 - w / 2) + w / 2;
    if (cat.until) cx = Math.min(cx, (x + cat.until * CELL) / 4 - 3 - w / 2);
    return { ...cat, x, y, label, note: { cx, top }, box: { x: (cx - w / 2 - 2) * 4, y: (top - 2) * 4, w: (w + 4) * 4, h: 28 * 4, text: label } };
  });
  const text = FILM[lang].end[3], word = SHORT[lang].keyword, cut = text.indexOf(word);
  const parts = [text.slice(0, cut), word, text.slice(cut + word.length)];
  const findSize = [60, 48, 36].find((candidate) => parts.reduce((sum, part) => sum + pen.width(part, candidate, 'film'), 0) <= W - 96) || 36;
  const widths = parts.map((part) => pen.width(part, findSize, 'film')), total = widths.reduce((a, b) => a + b, 0);
  const find = { parts, widths, size: findSize, x: snap((W - total) / 2), y: H - FOOT + snap((FOOT - findSize) / 2), w: total, h: findSize, text };
  return { width: W, height: H, head, cats, find };
}

function draw(ctx, lang) {
  const pen = new Pen(ctx, 1, DAY), P = DAY, L = layout(ctx, lang);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ending.desk(pen, W, H, FOOT);
  // The two lines.
  L.head.forEach((line) => {
    let x = line.x;
    line.parts.forEach((part, k) => { pen.text(part, x, line.y, { size: line.size, film: true, colour: k % 2 ? SEAL : P.ink }); x += line.widths[k]; });
  });
  // The cats, then the boards over their feet.
  L.cats.forEach((cat) => {
    const who = CAST[cat.who];
    pen.cat(who.look, CatArt.ACTIONS[cat.action].frames[cat.frame], cat.x, cat.y, { cell: CELL, collar: who.collar, accessory: 'none', papers: cat.papers });
  });
  BOARDS.forEach((shelfY) => ending.board(pen, W, shelfY));
  // What the app says of each.
  ctx.setTransform(4, 0, 0, 4, 0, 0);
  const small = new Pen(ctx, 4, DAY);
  L.cats.forEach((cat) => pointNote(small, cat.note.cx, cat.note.top, cat.label, 1));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // How to find it, on the edge of the desk; the word to type in the accent the app's own name wears on wood.
  let x = L.find.x;
  L.find.parts.forEach((part, k) => { pen.text(part, x, L.find.y, { size: L.find.size, film: true, colour: k === 1 ? P.woodAccent : P.onWood }); x += L.find.widths[k]; });
}

// The boxes of everything written on the cover (frame pixels), for checking that it all lies inside the frame.
function boxes(ctx, lang) {
  const L = layout(ctx, lang), box = ({ x, y, w, h, text, size }) => ({ x, y, w, h, text, size });
  return { width: W, height: H, head: L.head.map(box), tags: L.cats.map((cat) => cat.box), find: box(L.find) };
}

module.exports = { draw, boxes, W, H };
