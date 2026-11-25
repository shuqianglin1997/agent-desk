'use strict';

/*
 * Everything that is not Catshelf: a neutral desktop, and the official
 * clients as plain windows.
 *
 * These stand for other people's software, so they are deliberately not
 * drawn like Catshelf and not like any real client: system type, grey
 * panels, a title that says "client · account", a list of conversations on
 * the left, the conversation on the right, an input box. No logo anywhere.
 * Drawn in frame pixels.
 */

const { SYS, clamp, mix } = require('./draw.js');
const { FILM } = require('./strings.js');

const INK = '#1B1F24', DIM = '#5A616B', PANEL = '#F6F6F4', SIDE = '#ECECE9', BAR = '#E2E2DF', LINE = '#C9C9C4', EDGE = '#0E1116';
const HONEY = '#F6D37C';

function sys(ctx, string, x, y, size, colour, options = {}) {
  ctx.font = `${options.weight || 400} ${size}px ${SYS}`;
  ctx.wordSpacing = '0px';
  ctx.fillStyle = colour;
  ctx.textBaseline = 'alphabetic';
  const width = ctx.measureText(string).width;
  ctx.fillText(string, options.align === 'center' ? x - width / 2 : options.align === 'right' ? x - width : x, y);
  return width;
}

// The desktop: a menu bar, a dock with the clients' names, nothing else.
function desktop(pen, lang, state = {}) {
  const ctx = pen.ctx, words = FILM[lang], W = 1920, H = 1080;
  pen.rect(0, 0, W, H, '#2C3440');
  pen.rect(0, 600, W, H - 600, '#323C4A');
  pen.dither(0, 584, W, 16, '#323C4A', 8, 4);
  pen.rect(0, 0, W, 44, '#161B21');
  sys(ctx, words.desktop, 24, 30, 22, '#CFD6DF', { weight: 600 });
  sys(ctx, words.clock, W - 24, 30, 22, '#CFD6DF', { align: 'right' });
  const tiles = [[words.product, '#85532F', '#FFF8E8', true]].concat((state.dock || []).map((entry) => [entry.label, entry.dark ? '#22272F' : '#E6E8EB', entry.dark ? '#D8DEE6' : INK, entry.open]));
  const widths = tiles.map(([label]) => { ctx.font = `600 20px ${SYS}`; return Math.max(104, Math.ceil(ctx.measureText(label).width / 4) * 4 + 36); });
  const total = widths.reduce((sum, w) => sum + w + 12, -12);
  let x = Math.round((W - total) / 4) * 2;
  pen.rect(x - 16, 1008, total + 32, 68, '#1A1F27');
  pen.rect(x - 16, 1008, total + 32, 2, '#3A4350');
  tiles.forEach(([label, fill, ink, open], k) => {
    // When the desktop first comes into view the clients' tiles hop one after another: these are what Catshelf looks after.
    const since = state.hop === undefined || k === 0 ? 9 : state.t - state.hop - (k - 1) * 0.125, lift = since >= 0 && since < 3 / 60 ? 12 : since >= 3 / 60 && since < 6 / 60 ? 8 : since >= 6 / 60 && since < 9 / 60 ? -2 : 0;
    pen.rect(x, 1018 - lift, widths[k], 40, fill);
    sys(ctx, label, x + widths[k] / 2, 1045 - lift, 20, ink, { weight: 600, align: 'center' });
    if (open) pen.rect(x + widths[k] / 2 - 4, 1064, 8, 6, '#E6EDF5');
    x += widths[k] + 12;
  });
}

/*
 * One client window. box: {x, y, w, h}; options: title, badge, side: [[label, running]],
 * lines: [text], input: [text] | null (placeholder), t (for the running dots), rise (0..3).
 */
function client(pen, box, options) {
  const ctx = pen.ctx, lift = [28, 12, 4, 0][Math.min(3, options.rise === undefined ? 3 : options.rise)];
  const { x, w, h } = box, y = box.y + lift, words = FILM[options.lang];
  pen.rect(x + 8, y + 10, w + 2, h + 2, '#1E242D');
  pen.rect(x - 2, y - 2, w + 4, h + 4, EDGE);
  pen.rect(x, y, w, h, PANEL);
  pen.rect(x, y, w, 44, BAR);
  pen.rect(x, y + 44, w, 2, LINE);
  ['#E0584A', '#E8B83A', '#4FAE5A'].forEach((colour, k) => { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x + 26 + k * 26, y + 22, 8, 0, Math.PI * 2); ctx.fill(); });
  sys(ctx, options.title, x + w / 2, y + 30, 22, INK, { weight: 600, align: 'center' });
  if (options.badge) sys(ctx, options.badge, x + w - 20, y + 30, 20, '#2F7D3B', { weight: 600, align: 'right' });
  if (options.panel) { options.panel(ctx, x, y + 46, w, h - 46); return; }
  const sideW = 232;
  pen.rect(x, y + 46, sideW, h - 46, SIDE);
  pen.rect(x + sideW, y + 46, 2, h - 46, LINE);
  (options.side || []).forEach(([label, running], k) => {
    const top = y + 62 + k * 34;
    if (k === 0 && options.side.length > 1 && running) pen.rect(x + 8, top - 6, sideW - 16, 32, '#DFDFDB');
    sys(ctx, label, x + 20, top + 17, 19, INK);
    if (running) for (let d = 0; d < 3; d += 1) pen.rect(x + sideW - 44 + d * 10, top + 8, 6, 6, Math.floor(options.t * 6) % 3 === d ? '#D0483A' : LINE);
  });
  const inputH = 52, textTop = y + 62, room = Math.floor((h - 46 - inputH - 28) / 34);
  (options.lines || []).slice(-room).forEach((line, k) => sys(ctx, line, x + sideW + 24, textTop + 17 + k * 34, 20, line.startsWith(words.you.trim()) ? INK : DIM));
  const ix = x + sideW + 16, iy = y + h - inputH - 12, iw = w - sideW - 32;
  pen.rect(ix - 2, iy - 2, iw + 4, inputH + 4, options.focus ? '#6C8EBF' : LINE);
  pen.rect(ix, iy, iw, inputH, '#FFFFFF');
  if (options.input && options.input.length) options.input.forEach((line, k) => sys(ctx, line, ix + 16, iy + (options.input.length > 1 ? 22 : 33) + k * 22, options.input.length > 1 ? 17 : 20, INK));
  else sys(ctx, words.placeholder, ix + 16, iy + 33, 20, '#9A9A94');
}

// A dashed line in the "pointing" colour, from a cat to its client. Squares on a 4px grid, no smoothing.
function link(pen, from, to, label) {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy), steps = Math.floor(length / 6);
  for (let k = 0; k <= steps; k += 1) {
    if (k % 2) continue;
    const p = k / Math.max(1, steps);
    pen.rect(Math.round((from[0] + dx * p) / 2) * 2 - 2, Math.round((from[1] + dy * p) / 2) * 2 - 2, 4, 4, HONEY);
  }
  if (label) {
    const mx = Math.round((from[0] + to[0]) / 4) * 2, my = Math.round((from[1] + to[1]) / 4) * 2, w = Math.ceil(pen.width(label, 24) / 4) * 4 + 32;
    pen.rect(mx - w / 2 - 4, my - 22, w + 8, 44, '#3B272C');
    pen.rect(mx - w / 2, my - 18, w, 36, HONEY);
    pen.text(label, mx, my - 12, { size: 24, colour: '#3B272C', align: 'center' });
  }
}

module.exports = { desktop, client, link, sys, HONEY };
void clamp; void mix;
