'use strict';

/*
 * Covers: one composition at the sizes the places it is posted want.
 *
 * A cover is first seen small — a third of a phone's width in one feed, 170px
 * wide in another — and whether anyone taps is decided by what can be read at
 * that size. So:
 *
 *   top     two lines as large as the frame allows, the words that matter in seal red
 *   middle  the shelf: four cats, each in a state the app shows — typing, behind a stack
 *           of paper and sweating, out of energy and flat, asleep. Over each, the film's
 *           pointing tag (the one that says "快没电" at 25 s) with what the app itself
 *           says of that cat: its card's line or its energy.
 *   bottom  how to find it, written on the edge of the desk as on the 16:9 cover
 *
 * Nothing is drawn here for the first time: the desk and the boards are the end
 * card's (ending.js), the cats are cat-art's frames, the tag is state.js's
 * pointNote three or four times its size in the window.
 *
 * FORMATS says, for each place, the frame and where things go in it. Some places
 * show only the middle of the picture (safe): what must survive lies inside it.
 */

const { Pen, DAY, CatArt } = require('./draw.js');
const { ui, FILM, CAST, SHORT } = require('./strings.js');
const { pointNote } = require('./state.js');
const ending = require('./ending.js');

const SEAL = '#AE3319';
const snap = (value, grid = 4) => Math.round(value / grid) * grid;

/*
 * w, h: the frame. top, foot: the desk's top and bottom edges. head: where the two lines begin and the sizes to try
 * (the largest at which both fit `room` wins). cell: one square of a cat. rows: which cats stand on which board;
 * boards: the boards' tops; pitch: from one cat to the next. tag: how many times its size in the window the tag is
 * drawn (its words are 12px there). find: sizes to try for the line at the bottom. file: the picture's name in out/.
 * safe: [left, right] of the part some places crop to; safeHolds: what must lie inside it.
 */
const FORMATS = {
  // 小红书, 3:4: seen a third of a phone's width wide.
  xiaohongshu: {
    w: 1080, h: 1440, top: 84, foot: 120, file: (lang) => `catshelf-cover-3x4-${lang}`,
    head: { tops: [140, 284], sizes: [120, 108, 96, 84, 72], room: 1080 - 112 },
    cell: 16, rows: [[0, 1], [2, 3]], boards: [860, 1216], pitch: 480, tag: 4, find: [60, 48, 36]
  },
  // B 站, 16:9: some places show the middle 4:3 (1440×1080) only, so the words and the cats stay inside it.
  bilibili: {
    w: 1920, h: 1080, top: 84, foot: 120, file: (lang) => `cover-bilibili-${lang}`,
    safe: [240, 1680], safeHolds: 'all',
    head: { tops: [116, 272], sizes: [144, 132, 120, 108, 96], room: 1440 - 120 },
    cell: 16, rows: [[0, 1, 2, 3]], boards: [872], pitch: 360, tag: 4, find: [60, 48, 36]
  },
  // YouTube, 1280×720: about 170px wide in a phone's list.
  youtube: {
    w: 1280, h: 720, top: 56, foot: 84, file: (lang) => `cover-youtube-${lang}`,
    head: { tops: [76, 192], sizes: [108, 96, 84, 72], room: 1280 - 120 },
    cell: 10, rows: [[0, 1, 2, 3]], boards: [588], board: 16, inset: 56, pitch: 260, tag: 3, find: [48, 36]
  },
  // 公众号, 2.35:1: shared on, it is cropped to the square in the middle, which must hold the two lines and a cat.
  wechat: {
    w: 1800, h: 766, top: 56, foot: 86, file: (lang) => `cover-wechat-${lang}`,   // 766 is not on the 4px grid; 86 puts the edge of the desk back on it
    safe: [517, 1283], safeHolds: 'head and a cat',
    head: { tops: [88, 180], sizes: [84, 72], room: 766 - 40 },
    cell: 12, rows: [[0, 1, 2, 3]], boards: [600], board: 16, inset: 56, pitch: 380, tag: 3, find: [48, 36]
  },
  // 公众号, the square, composed for itself.
  'wechat-square': {
    w: 1080, h: 1080, top: 84, foot: 120, file: (lang) => `cover-wechat-square-${lang}`,
    head: { tops: [140, 284], sizes: [120, 108, 96, 84, 72], room: 1080 - 112 },
    cell: 12, rows: [[0, 1, 2, 3]], boards: [816], inset: 24, pitch: 256, tag: 3, find: [60, 48, 36]
  }
};

/*
 * Who is on the shelf. who: index into CAST. frame: the frame of its action that is held.
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
function layout(ctx, lang, name = 'xiaohongshu') {
  const F = FORMATS[name];
  if (!F) throw new Error(`no cover called ${name}`);
  const pen = new Pen(ctx, 1, DAY), words = SHORT[lang].cover.map(split), W = F.w, H = F.h;
  const widthsAt = (size) => words.map((parts) => parts.map((part) => pen.width(part, size, 'film')));
  const size = F.head.sizes.find((candidate) => widthsAt(candidate).every((widths) => widths.reduce((a, b) => a + b, 0) <= F.head.room)) || F.head.sizes[F.head.sizes.length - 1];
  const head = words.map((parts, i) => {
    const widths = widthsAt(size)[i], total = widths.reduce((a, b) => a + b, 0);
    return { parts, widths, size, x: snap((W - total) / 2), y: F.head.tops[i], w: total, h: size, text: parts.join('') };
  });
  /*
   * The tags. In a tag's own units (F.tag px each) its paper is 20 high with a 2 edge and its tail ends 6 under it:
   * 28 from its top edge to the end of its tail. Its top left corner is put on the frame's 4px grid: any whole unit
   * when a unit is 4px, every fourth when it is 3px.
   */
  const unit = F.tag, small = new Pen(ctx, unit, DAY), step = unit % 4 === 0 ? 1 : unit % 2 === 0 ? 2 : 4, gap = unit === 4 ? 8 : 6;
  const cellW = 20 * F.cell, cellH = 18 * F.cell;
  const cats = [];
  F.rows.forEach((row, r) => {
    const x0 = snap((W - ((row.length - 1) * F.pitch + cellW)) / 2);
    row.forEach((index, i) => {
      const cat = CATS[index], x = x0 + i * F.pitch, y = F.boards[r] - cellH, label = cat.says(lang);
      const w = Math.ceil(small.width(label)) + 20;
      let left = Math.round(((x + cat.at[0] * F.cell) / unit - w / 2 - 2) / step) * step;
      if (cat.until) left = Math.min(left, Math.floor(((x + cat.until * F.cell) / unit - 5 - w) / step) * step);
      const top = Math.floor(((y + cat.at[1] * F.cell - gap) / unit - 28) / step) * step;
      cats.push({ ...cat, x, y, label, note: { cx: left + 2 + w / 2, top: top + 2 }, box: { x: left * unit, y: top * unit, w: (w + 4) * unit, h: 28 * unit, text: label }, grid: { x, y, w: cellW, h: cellH, text: cat.action } });
    });
  });
  const text = FILM[lang].end[3], word = SHORT[lang].keyword, cut = text.indexOf(word);
  const parts = [text.slice(0, cut), word, text.slice(cut + word.length)];
  const findSize = F.find.find((candidate) => parts.reduce((sum, part) => sum + pen.width(part, candidate, 'film'), 0) <= W - 96) || F.find[F.find.length - 1];
  const widths = parts.map((part) => pen.width(part, findSize, 'film')), total = widths.reduce((a, b) => a + b, 0);
  const find = { parts, widths, size: findSize, x: snap((W - total) / 2), y: H - F.foot + snap((F.foot - findSize) / 2), w: total, h: findSize, text };
  return { F, width: W, height: H, head, cats, find };
}

function draw(ctx, lang, name = 'xiaohongshu') {
  const pen = new Pen(ctx, 1, DAY), P = DAY, L = layout(ctx, lang, name), F = L.F;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ending.desk(pen, F.w, F.h, F.foot, F.top);
  // The two lines.
  L.head.forEach((line) => {
    let x = line.x;
    line.parts.forEach((part, k) => { pen.text(part, x, line.y, { size: line.size, film: true, colour: k % 2 ? SEAL : P.ink }); x += line.widths[k]; });
  });
  // The cats, then the boards over their feet.
  L.cats.forEach((cat) => {
    const who = CAST[cat.who];
    pen.cat(who.look, CatArt.ACTIONS[cat.action].frames[cat.frame], cat.x, cat.y, { cell: F.cell, collar: who.collar, accessory: 'none', papers: cat.papers });
  });
  F.boards.forEach((shelfY) => ending.board(pen, F.w, shelfY, F.board || 24, F.inset || 84));
  // What the app says of each.
  ctx.setTransform(F.tag, 0, 0, F.tag, 0, 0);
  const small = new Pen(ctx, F.tag, DAY);
  L.cats.forEach((cat) => pointNote(small, cat.note.cx, cat.note.top, cat.label, 1));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // How to find it, on the edge of the desk; the word to type in the accent the app's own name wears on wood.
  let x = L.find.x;
  L.find.parts.forEach((part, k) => { pen.text(part, x, L.find.y, { size: L.find.size, film: true, colour: k === 1 ? P.woodAccent : P.onWood }); x += L.find.widths[k]; });
}

// The boxes of everything on the cover (frame pixels), for checking that what is written lies inside the frame
// and that what must survive a crop lies inside the part that is kept.
function boxes(ctx, lang, name = 'xiaohongshu') {
  const L = layout(ctx, lang, name), box = ({ x, y, w, h, text, size }) => ({ x, y, w, h, text, size });
  return { width: L.width, height: L.height, safe: L.F.safe || null, safeHolds: L.F.safeHolds || null, head: L.head.map(box), tags: L.cats.map((cat) => cat.box), cats: L.cats.map((cat) => cat.grid), find: box(L.find) };
}

module.exports = { draw, boxes, FORMATS };
