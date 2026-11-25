'use strict';

/*
 * Drawing primitives for the launch film.
 *
 * One style for the whole film: hard 2px edges, flat colours from the app's
 * --px-* palette, the app's pixel font at whole multiples of 12px, the app's
 * cat grids and 8×8 icons. Nothing here is blurred, faded or rotated.
 *
 * Coordinates are CSS pixels of the app ("logical"); the caller scales the
 * context (2 for the Catshelf window in close-up, 1 on the desktop). Text is
 * placed the way the app's own layout places it: the baseline sits 11px below
 * the top of a 12px glyph box, on a whole device pixel.
 */

const CatArt = require('../../../src/yard/cat-art.js');
const PixelIcons = require('../../../src/pixel/icons.js');

// src/pixel.css, the day and night skins.
const DAY = {
  bg: '#EBD8B0', float: '#FBF2DB', ink: '#3B272C', ink2: '#553A34', edge: '#4A2F35', line: '#D9C08F', hi: '#FFFDF1', lo: '#E4CD9C',
  wood: '#85532F', woodHi: '#AB7A4E', woodLo: '#59331D', onWood: '#FFF8E8', woodAccent: '#FFE08A',
  brand: '#AE3319', brandDeep: '#87251F', brandHi: '#EE8156', onBrand: '#FFF8E8', hl: '#F6D37C', chk: '#F9E8B8', focus: '#2B8088',
  ok: '#4A8A49', info: '#3B76A8', warn: '#B8790C', bad: '#B5383A', mute: '#C1A78B', off: '#7F604E',
  brandInk: '#87251F', okInk: '#2A5C2C', badInk: '#8E2426', warnInk: '#6E4A06',
  tag: ['#B5383A', '#9A6508', '#3F7F3E', '#2F6AA0', '#7B4FA6'], shade: '#C3A283', lamp: '#EFDDB8', dusk: '#E6D2A8', scrim: 'rgba(59, 39, 44, 0.52)'
};
const NIGHT = {
  bg: '#231A1E', float: '#35272C', ink: '#F8E9C9', ink2: '#D6BEA2', edge: '#100A0D', line: '#4F3C40', hi: '#4C3A40', lo: '#261B1F',
  wood: '#5E3F31', woodHi: '#7D5842', woodLo: '#3A261F', onWood: '#F8E9C9', woodAccent: '#F4B36A',
  brand: '#F2894A', brandDeep: '#A9461F', brandHi: '#FFB98A', onBrand: '#2A1410', hl: '#5A3E24', chk: '#4A352B', focus: '#6FD0C4',
  ok: '#9AD27A', info: '#8CC0EE', warn: '#F2C14E', bad: '#F4857C', mute: '#7D6862', off: '#9C8880',
  brandInk: '#FFB98A', okInk: '#9AD27A', badInk: '#FFA79E', warnInk: '#F2C14E',
  tag: ['#F4857C', '#F2C14E', '#9AD27A', '#8CC0EE', '#CFA6F2'], shade: '#0F090C', lamp: '#3A2A26', dusk: '#17101A', scrim: 'rgba(8, 5, 7, 0.66)'
};
// The colour the window is covered with before the lamp comes on (src/pixel/boot.js).
const DARK = '#1B1417';

const PX = '"Fusion Pixel", "PingFang SC", sans-serif';
const SYS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

class Pen {
  constructor(ctx, scale, palette) {
    this.ctx = ctx;
    this.s = scale || 1;
    this.P = palette || DAY;
  }

  rect(x, y, w, h, colour) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(x, y, w, h);
  }

  // The app's pixel frame (--px): four 2px edges with the corners left out,
  // one ring of highlight and shade inside, and optionally the lip under it.
  frame(x, y, w, h, options = {}) {
    const P = this.P;
    const edge = options.edge || P.edge;
    if (options.lip) this.rect(x, y + h + 2, w, 2, options.lipColour || P.shade);
    if (options.drop) this.rect(x + options.drop[0], y + options.drop[1], w + 2, h + 2, options.dropColour || P.shade);
    this.rect(x, y - 2, w, 2, edge); this.rect(x, y + h, w, 2, edge);
    this.rect(x - 2, y, 2, h, edge); this.rect(x + w, y, 2, h, edge);
    this.rect(x, y, w, h, options.fill || P.float);
    if (options.bevel !== false) {
      this.rect(x, y + h - 2, w, 2, options.lo || P.lo); this.rect(x + w - 2, y, 2, h, options.lo || P.lo);
      this.rect(x, y, w, 2, options.hi || P.hi); this.rect(x, y, 2, h, options.hi || P.hi);
    }
  }

  // The seal: the one filled button of a region (button.primary).
  seal(x, y, w, h, pressed) {
    const P = this.P, top = y + (pressed ? 2 : 0);
    this.rect(x, top - 2, w, 2, P.edge); this.rect(x, top + h, w, 2, P.edge);
    this.rect(x - 2, top, 2, h, P.edge); this.rect(x + w, top, 2, h, P.edge);
    // background brand; inset rings of 2px brand and 4px brand-hi; a deep band along the bottom under both rings
    this.rect(x, top, w, h, P.brand);
    this.rect(x + 2, top + 2, w - 4, h - 4, P.brandHi);
    this.rect(x + 4, top + 4, w - 8, h - 8, P.brand);
    this.rect(x + 4, top + h - 8, w - 8, 4, P.brandDeep);
  }

  font(size, kind, weight) {
    const family = kind === 'sys' ? SYS : kind === 'mono' ? MONO : PX;
    this.ctx.font = `${weight ? weight + ' ' : ''}${size}px ${family}`;
    // src/pixel.css: pixel text is set with word-spacing -2px; reading text is not.
    // The film's own large lettering (kind 'film') keeps that proportion at its size.
    this.ctx.wordSpacing = kind === 'sys' || kind === 'mono' ? '0px' : kind === 'film' ? `${-size / 6}px` : '-2px';
  }

  width(string, size = 12, kind, weight) {
    this.font(size, kind, weight);
    return this.ctx.measureText(string).width;
  }

  // Pixel text: (x, top) is the top-left of the glyph box; size is a whole multiple of 12.
  text(string, x, top, options = {}) {
    const size = options.size || 12, ctx = this.ctx;
    this.font(size, options.film ? 'film' : undefined);
    ctx.fillStyle = options.colour || this.P.ink;
    ctx.textBaseline = 'alphabetic';
    const width = ctx.measureText(string).width;
    const left = options.align === 'center' ? x - width / 2 : options.align === 'right' ? x - width : x;
    const snap = (value) => Math.floor(value * this.s + 1e-3) / this.s;
    ctx.fillText(string, snap(left), snap(top + size * 11 / 12));
    return width;
  }

  // Reading text in the system face (sentences, hints, typed content), as the app sets it.
  read(string, x, top, options = {}) {
    const size = options.size || 13, lineHeight = options.lineHeight || 20, ctx = this.ctx;
    this.font(size, options.mono ? 'mono' : 'sys', options.weight);
    ctx.fillStyle = options.colour || this.P.ink;
    ctx.textBaseline = 'alphabetic';
    const width = ctx.measureText(string).width;
    const left = options.align === 'center' ? x - width / 2 : options.align === 'right' ? x - width : x;
    ctx.fillText(string, left, top + (lineHeight - size) / 2 + size * 0.86);
    return width;
  }

  // Break a sentence into lines no wider than `max` (CJK may break anywhere, Latin at spaces).
  wrap(string, max, size = 13, kind = 'sys', weight) {
    this.font(size, kind, weight);
    const ctx = this.ctx, lines = [];
    const tokens = string.match(/[⺀-鿿＀-￯　-〿]|[^\s⺀-鿿＀-￯　-〿]+|\s+/g) || [];
    const closing = /^[，。、；：！？）》”’…,.;:!?)]/;
    let line = '';
    for (const token of tokens) {
      const next = line + token;
      if (line && ctx.measureText(next.trimEnd()).width > max && !closing.test(token) && token.trim()) {
        lines.push(line.trimEnd());
        line = token.trim() ? token : '';
      } else line = next;
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }

  // An 8×8 icon at `size` px (the app draws them 10, 12 or 16px), on whole device pixels.
  icon(name, x, y, size, colour) {
    const map = PixelIcons.ICONS[name];
    if (!map) return;
    const ctx = this.ctx, s = this.s, cell = size / 8;
    ctx.fillStyle = colour || this.P.ink;
    const at = (value) => Math.round(value * s) / s;
    for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) {
      if (map[row][col] !== '#') continue;
      const x0 = at(x + col * cell), y0 = at(y + row * cell);
      ctx.fillRect(x0, y0, at(x + (col + 1) * cell) - x0, at(y + (row + 1) * cell) - y0);
    }
  }

  // A cat from src/yard/cat-art.js. (x, y) is the top-left of the 20×18 grid; cell is the size of one grid square.
  cat(look, spec, x, y, options = {}) {
    const cell = options.cell || 4, nudge = spec.nudge || [0, 0];
    const grid = CatArt.frame(spec, { accessory: options.accessory || (CatArt.LOOKS[look] && CatArt.LOOKS[look].accessory) || 'none' }, { headroom: options.headroom || 0, papers: options.papers || 0 });
    CatArt.draw(this.ctx, grid, CatArt.LOOKS[look], { scale: cell, dx: x + nudge[0] * cell / 2, dy: y - (options.headroom || 0) * cell + nudge[1] * cell / 2, collar: options.collar || undefined });
  }

  // An ordered-dither fill: `level` of 16 cells lit, on a 2px grid (the app's dissolve uses the same matrix).
  dither(x, y, w, h, colour, level, cell = 2) {
    const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    this.ctx.fillStyle = colour;
    const x0 = Math.floor(x / cell), y0 = Math.floor(y / cell), x1 = Math.ceil((x + w) / cell), y1 = Math.ceil((y + h) / cell);
    for (let row = y0; row < y1; row += 1) for (let col = x0; col < x1; col += 1) {
      if (BAYER[row & 3][col & 3] < level) this.ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }

  // Eight squares flying outwards for a few frames: the app's "pop".
  burst(x, y, age, colour, reach = 26, size = 4) {
    if (age < 0 || age >= 0.18) return;
    const step = Math.min(3, Math.floor(age / 0.06 + 1e-6) + 1), radius = 10 + step * reach / 3;
    this.ctx.fillStyle = colour;
    for (let k = 0; k < 8; k += 1) {
      const angle = k * Math.PI / 4;
      this.ctx.fillRect(Math.round((x + Math.cos(angle) * radius) / size * 2) * size / 2 - size / 2, Math.round((y + Math.sin(angle) * radius) / size * 2) * size / 2 - size / 2, size, size);
    }
  }
}

/* ── Motion: steps only ───────────────────────────────── */
const clamp = (value) => Math.max(0, Math.min(1, value));
const snap2 = (value) => Math.round(value / 2) * 2;
const mix = (from, to, progress) => from + (to - from) * clamp(progress);
// Fast first, slow after, in `steps` held positions (a 6–8 frame move is 3–4 steps of two frames).
const ease = (progress, steps) => { const p = Math.round(clamp(progress) * steps) / steps; return 1 - Math.pow(1 - p, 3); };
// A move from `from` to `to` that starts at `start`, lasts `frames` film frames and lands on the 2px grid.
const glide = (from, to, t, start, frames = 8, steps = 4) => snap2(mix(from, to, ease((t - start) * 60 / frames, steps)));
// Dropping in like a nameplate: three steps down, 2px past, back. Returns the offset from rest, or null before `start`.
const drop = (t, start, height = 12) => {
  const frame = Math.floor((t - start) * 60 + 1e-6);
  if (frame < 0) return null;
  return frame < 3 ? -height : frame < 6 ? -height / 2 : frame < 9 ? 2 : 0;
};
// Frame of a looping or one-shot cat action at time `t` (seconds since the action began).
const loop = (name, t) => { const action = CatArt.ACTIONS[name], n = action.frames.length; return action.frames[((Math.floor(t * action.fps + 1e-6) % n) + n) % n]; };
const once = (name, t) => { const action = CatArt.ACTIONS[name], i = Math.floor(t * action.fps + 1e-6); return i >= 0 && i < action.frames.length ? action.frames[i] : null; };
const within = (t, from, to) => t >= from - 1e-9 && t < to - 1e-9;

module.exports = { Pen, DAY, NIGHT, DARK, PX, SYS, MONO, CatArt, PixelIcons, clamp, snap2, mix, ease, glide, drop, loop, once, within };
