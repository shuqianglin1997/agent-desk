#!/usr/bin/env node
'use strict';

/*
 * Brings a run of frames down to one palette of at most 255 colours, so a GIF
 * can hold them exactly (a GIF has 256, one of which is kept for "unchanged").
 *
 * The drawing is flat colour; what goes over 255 is the smoothing the browser
 * puts on the edges of letters and of the three round window buttons. The 255
 * colours that cover the most pixels over the whole run are kept as they are,
 * and every other pixel takes the nearest of them: a smoothed edge becomes a
 * hard one. Nothing is dithered.
 *
 *   node media/launch-video/tools/palette.js <frames dir> <out dir> [half]
 *
 * half: first take every second pixel of every second row (frames drawn at
 * twice the window's size become the window at its own size, exactly).
 */

const fs = require('node:fs');
const path = require('node:path');
const png = require('./png.js');

function reduce(from, to, half) {
  const manifest = fs.readFileSync(path.join(from, 'manifest.txt'), 'utf8').trim().split('\n'), names = [...new Set(manifest)];
  const load = (name) => {
    const image = png.read(path.join(from, name));
    if (!half) return image;
    const width = image.width / 2, height = image.height / 2, pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) image.pixels.copy(pixels, (y * width + x) * 4, (y * 2 * image.width + x * 2) * 4, (y * 2 * image.width + x * 2) * 4 + 4);
    return { width, height, pixels };
  };
  const key = (pixels, i) => (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
  const counts = new Map();
  for (const name of names) { const { pixels } = load(name); for (let i = 0; i < pixels.length; i += 4) { const k = key(pixels, i); counts.set(k, (counts.get(k) || 0) + 1); } }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]), kept = ranked.slice(0, 255).map(([colour]) => colour);
  const map = new Map(kept.map((colour) => [colour, colour]));
  let moved = 0, furthest = 0;
  for (const [colour, count] of ranked.slice(255)) {
    let best = kept[0], bestD = Infinity;
    for (const candidate of kept) {
      const dr = (colour >> 16) - (candidate >> 16), dg = ((colour >> 8) & 255) - ((candidate >> 8) & 255), db = (colour & 255) - (candidate & 255), d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = candidate; }
    }
    map.set(colour, best); moved += count; furthest = Math.max(furthest, Math.sqrt(bestD));
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  let total = 0;
  for (const name of names) {
    const image = load(name), { pixels } = image;
    for (let i = 0; i < pixels.length; i += 4) { const colour = map.get(key(pixels, i)); pixels[i] = colour >> 16; pixels[i + 1] = (colour >> 8) & 255; pixels[i + 2] = colour & 255; pixels[i + 3] = 255; }
    total += pixels.length / 4;
    png.write(path.join(to, name), image);
  }
  fs.writeFileSync(path.join(to, 'manifest.txt'), `${manifest.join('\n')}\n`);
  return { pictures: names.length, colours: counts.size, kept: kept.length, moved, total, furthest };
}

module.exports = { reduce };

if (require.main === module) {
  const [from, to, half] = process.argv.slice(2);
  const r = reduce(from, to, half === 'half');
  process.stdout.write(`${r.pictures} pictures, ${r.colours} colours → ${r.kept}; ${r.moved} of ${r.total} pixels (${(r.moved / r.total * 100).toFixed(3)} %) took the nearest kept colour, the furthest ${r.furthest.toFixed(1)} away\n`);
}
