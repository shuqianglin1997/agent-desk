'use strict';

/*
 * Writes a looping GIF from frames that already share one palette of at most
 * 255 colours (tools/palette.js). No dependency, nothing downloaded.
 *
 * macOS's ImageIO was tried first, as for the mp4s. Given these frames it
 * stores every one whole, each with a palette of its own that it picks itself:
 * 10 MB for eight seconds, and colours a few steps off. So the file is written
 * here instead, the plain way the format allows:
 *   - one palette for the whole loop; index 255 means "as it was";
 *   - the first frame whole; every later one only the rectangle that changed,
 *     and inside it only the pixels that changed;
 *   - ticks that share a picture become one frame held that long;
 *   - a NETSCAPE2.0 block so it loops for ever.
 * tools/gif.js reads the result back and compares every pixel of every frame
 * with its source; encode/gifcheck.swift does the same through ImageIO.
 */

const fs = require('node:fs');
const path = require('node:path');
const png = require('../tools/png.js');

const KEEP = 255;                                    // the index that leaves a pixel as the frame before left it

// GIF's LZW: 8-bit symbols, codes from 9 bits up to 12, packed least significant bit first, in blocks of 255 bytes.
function pack(indices) {
  const CLEAR = 256, END = 257, bytes = [];
  let size = 9, next = 258, bits = 0, held = 0;
  const emit = (code) => { bits |= code << held; held += size; while (held >= 8) { bytes.push(bits & 255); bits >>>= 8; held -= 8; } };
  let table = new Map();
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const symbol = indices[i], key = (prefix << 8) | symbol, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) { table.set(key, next); next += 1; if (next > (1 << size) && size < 12) size += 1; }
    else { emit(CLEAR); table = new Map(); size = 9; next = 258; }
    prefix = symbol;
  }
  emit(prefix); emit(END);
  if (held > 0) bytes.push(bits & 255);
  const blocks = [];
  for (let at = 0; at < bytes.length; at += 255) { const part = bytes.slice(at, at + 255); blocks.push(Buffer.from([part.length, ...part])); }
  blocks.push(Buffer.from([0]));
  return Buffer.concat([Buffer.from([8]), ...blocks]);
}

/*
 * dir: frames and manifest.txt (one line per tick, naming the PNG that holds its picture).
 * tick: seconds per manifest line. Returns what was written.
 */
function write(dir, out, tick) {
  const names = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8').trim().split('\n');
  const runs = [];
  for (const name of names) { if (runs.length && runs[runs.length - 1][0] === name) runs[runs.length - 1][1] += 1; else runs.push([name, 1]); }
  // The loop closes on itself: a last run that shows the first picture again is the first run held longer.
  if (runs.length > 1 && runs[runs.length - 1][0] === runs[0][0]) runs[0][1] += runs.pop()[1];

  const palette = new Map(), colours = [];
  const indexOf = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let index = palette.get(key);
    if (index === undefined) { index = colours.length; if (index >= KEEP) throw new Error('more than 255 colours: run tools/palette.js first'); palette.set(key, index); colours.push(key); }
    return index;
  };
  const parts = [];
  let width = 0, height = 0, shown = null;
  runs.forEach(([name, ticks], n) => {
    const image = png.read(path.join(dir, name));
    if (!n) { width = image.width; height = image.height; }
    const now = new Uint8Array(width * height);
    for (let i = 0; i < now.length; i += 1) now[i] = indexOf(image.pixels[i * 4], image.pixels[i * 4 + 1], image.pixels[i * 4 + 2]);
    let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1, body = now;
    if (shown) {
      x0 = width; y0 = height; x1 = -1; y1 = -1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (now[y * width + x] !== shown[y * width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }           // the same picture after all: one pixel, left as it was
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      body = new Uint8Array(w * h);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const at = (y0 + y) * width + x0 + x; body[y * w + x] = now[at] === shown[at] ? KEEP : now[at]; }
    }
    const delay = Math.round(ticks * tick * 100), control = Buffer.from([0x21, 0xf9, 4, (1 << 2) | (shown ? 1 : 0), delay & 255, delay >> 8, KEEP, 0]);
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c; descriptor.writeUInt16LE(x0, 1); descriptor.writeUInt16LE(y0, 3); descriptor.writeUInt16LE(x1 - x0 + 1, 5); descriptor.writeUInt16LE(y1 - y0 + 1, 7);
    parts.push(control, descriptor, pack(body));
    shown = now;
  });
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'latin1'); head.writeUInt16LE(width, 6); head.writeUInt16LE(height, 8); head[10] = 0xf7;
  const table = Buffer.alloc(768);
  colours.forEach((colour, i) => { table[i * 3] = colour >> 16; table[i * 3 + 1] = (colour >> 8) & 255; table[i * 3 + 2] = colour & 255; });
  const forEver = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([3, 1, 0, 0, 0])]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([head, table, forEver, ...parts, Buffer.from([0x3b])]));
  return { frames: runs.length, ticks: names.length, seconds: names.length * tick, colours: colours.length, bytes: fs.statSync(out).size, width, height };
}

module.exports = { write, pack };

if (require.main === module) {
  const [dir, out, tick = '0.02'] = process.argv.slice(2);
  const r = write(dir, out, Number(tick));
  process.stdout.write(`${out}: ${r.width}×${r.height}, ${r.frames} frames from ${r.ticks} ticks, ${r.seconds.toFixed(2)} s, ${r.colours} colours, ${r.bytes} bytes\n`);
}
