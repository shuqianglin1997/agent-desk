'use strict';

/*
 * What can be rendered: the one-minute film, its 15-second cut in two
 * framings, and the README loop. Each is a pure function of time and
 * language at its own size and rate; frame n is drawn for n / fps seconds.
 */

const film = require('./film.js');
const cut = require('./cut.js');
const poster = require('./poster.js');
const loop = require('./loop.js');

const PIECES = {
  film: { width: 1920, height: 1080, fps: 60, seconds: 60, render: (ctx, t, lang) => film.render(ctx, t, lang) },
  short: { width: 1920, height: 1080, fps: 60, seconds: 15, render: (ctx, t, lang) => cut.render(ctx, t, lang, 'wide') },
  'short-tall': { width: 1080, height: 1440, fps: 60, seconds: 15, render: (ctx, t, lang) => cut.render(ctx, t, lang, 'tall') },
  loop: { width: loop.WIDTH, height: loop.HEIGHT, fps: loop.FPS, seconds: loop.SECONDS, render: (ctx, t, lang) => loop.render(ctx, t, lang) }
};

// Named pictures that are not frames: covers, measured caption boxes, the window alone.
function state(ctx, name, lang, still) {
  if (name === 'cover-tall') { poster.draw(ctx, lang); return null; }
  if (name === 'cover-tall-boxes') return poster.boxes(ctx, lang);
  if (name === 'short-captions') return { wide: cut.captionBoxes(ctx, lang, 'wide'), tall: cut.captionBoxes(ctx, lang, 'tall') };
  if (name === 'loop-captions') return loop.captionBoxes(ctx, lang);
  return film.renderState(ctx, name, lang, still);
}

module.exports = { PIECES, state };
