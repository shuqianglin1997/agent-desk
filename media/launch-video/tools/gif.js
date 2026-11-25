#!/usr/bin/env node
'use strict';

/*
 * Reads a GIF back, the way a browser would play it: its size on disk, the
 * frames, how long each is held, whether it loops for ever, and the pictures
 * themselves (every frame decoded and laid over the ones before it).
 *
 *   node media/launch-video/tools/gif.js <file.gif>                         what is in the file
 *   node media/launch-video/tools/gif.js <file.gif> compare <frames dir> [half]
 *        every picture against the PNG it was made from: how many pixels differ, and by how much
 *   node media/launch-video/tools/gif.js <file.gif> export <out dir> <n,n,…> [shrink]
 *        the pictures of those frames as PNGs (shrunk by a whole factor, to see it as a narrow page shows it)
 *   node media/launch-video/tools/gif.js <file.gif> browser <frames dir>
 *        the same comparison made by a browser's decoder: the hidden Chromium page that draws the film
 *        (render/page.js) reads the GIF and holds each frame, as it would show it, against its source
 */

const fs = require('node:fs');
const path = require('node:path');
const png = require('./png.js');

function parse(file) {
  const b = fs.readFileSync(file);
  const info = { bytes: b.length, signature: b.slice(0, 6).toString('latin1'), width: b.readUInt16LE(6), height: b.readUInt16LE(8), frames: [], loop: null };
  let p = 13;
  const table = (at, flags) => (flags & 0x80 ? b.slice(at, at + 3 * (1 << ((flags & 7) + 1))) : null);
  info.palette = table(p, b[10]);
  if (info.palette) p += info.palette.length;
  let control = { disposal: 0, transparent: -1, delay: 0 };
  while (p < b.length) {
    const tag = b[p];
    if (tag === 0x21) {
      const label = b[p + 1];
      p += 2;
      if (label === 0xf9) control = { disposal: (b[p + 1] >> 2) & 7, transparent: b[p + 1] & 1 ? b[p + 4] : -1, delay: b.readUInt16LE(p + 2) };
      if (label === 0xff && b.slice(p + 1, p + 12).toString('latin1') === 'NETSCAPE2.0') info.loop = b.readUInt16LE(p + 14);
      while (b[p]) p += b[p] + 1;
      p += 1;
    } else if (tag === 0x2c) {
      const frame = { x: b.readUInt16LE(p + 1), y: b.readUInt16LE(p + 3), w: b.readUInt16LE(p + 5), h: b.readUInt16LE(p + 7), ...control };
      const flags = b[p + 9];
      p += 10;
      frame.palette = table(p, flags);
      if (frame.palette) p += frame.palette.length;
      frame.interlaced = Boolean(flags & 0x40);
      frame.codeSize = b[p]; p += 1;
      const chunks = [];
      while (b[p]) { chunks.push(b.slice(p + 1, p + 1 + b[p])); p += b[p] + 1; }
      p += 1;
      frame.data = Buffer.concat(chunks);
      info.frames.push(frame);
      control = { disposal: 0, transparent: -1, delay: 0 };
    } else if (tag === 0x3b) break;
    else throw new Error(`unexpected block 0x${tag.toString(16)} at ${p}`);
  }
  return info;
}

// LZW, as GIF packs it: codes of growing width, least significant bit first.
function unpack(frame) {
  const out = new Uint8Array(frame.w * frame.h), data = frame.data, clear = 1 << frame.codeSize, end = clear + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = frame.codeSize + 1, next = end + 1, old = -1, first = 0, bits = 0, held = 0, at = 0, n = 0;
  for (let i = 0; i < clear; i += 1) suffix[i] = i;
  while (n < out.length) {
    while (held < size && at < data.length) { bits |= data[at] << held; held += 8; at += 1; }
    if (held < size) break;
    let code = bits & ((1 << size) - 1);
    bits >>>= size; held -= size;
    if (code === clear) { size = frame.codeSize + 1; next = end + 1; old = -1; continue; }
    if (code === end) break;
    if (old === -1) { out[n] = suffix[code]; n += 1; old = code; first = code; continue; }
    const incoming = code;
    let top = 0;
    if (code >= next) { stack[top] = first; top += 1; code = old; }
    while (code >= clear) { stack[top] = suffix[code]; top += 1; code = prefix[code]; }
    first = suffix[code];
    stack[top] = first; top += 1;
    if (next < 4096) { prefix[next] = old; suffix[next] = first; next += 1; if (next === (1 << size) && size < 12) size += 1; }
    old = incoming;
    while (top > 0 && n < out.length) { top -= 1; out[n] = stack[top]; n += 1; }
  }
  return out;
}

// Calls back with each frame's finished picture (RGBA over the whole canvas).
function play(info, each) {
  const canvas = Buffer.alloc(info.width * info.height * 4, 0);
  info.frames.forEach((frame, index) => {
    if (frame.interlaced) throw new Error('interlaced frames are not read');
    const palette = frame.palette || info.palette, pixels = unpack(frame);
    const before = frame.disposal === 3 ? Buffer.from(canvas) : null;
    for (let row = 0; row < frame.h; row += 1) for (let col = 0; col < frame.w; col += 1) {
      const value = pixels[row * frame.w + col];
      if (value === frame.transparent) continue;
      const to = ((frame.y + row) * info.width + frame.x + col) * 4;
      canvas[to] = palette[value * 3]; canvas[to + 1] = palette[value * 3 + 1]; canvas[to + 2] = palette[value * 3 + 2]; canvas[to + 3] = 255;
    }
    each(canvas, frame, index);
    if (frame.disposal === 2) for (let row = 0; row < frame.h; row += 1) canvas.fill(0, ((frame.y + row) * info.width + frame.x) * 4, ((frame.y + row) * info.width + frame.x + frame.w) * 4);
    if (before) before.copy(canvas);
  });
}

module.exports = { parse, play };

if (require.main === module) {
  const [file, command, ...rest] = process.argv.slice(2);
  const info = parse(file), delays = info.frames.map((frame) => frame.delay);
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  process.stdout.write(`${file}: ${info.bytes} bytes (${(info.bytes / 1048576).toFixed(2)} MB), ${info.signature}, ${info.width}×${info.height}, ${info.frames.length} frames, ${(total / 100).toFixed(2)} s, ` +
    `${info.loop === 0 ? 'loops for ever' : info.loop === null ? 'plays once (no loop block)' : `loops ${info.loop} times`}\n` +
    `  held ${Math.min(...delays) / 100}–${Math.max(...delays) / 100} s a frame; shared palette ${info.palette ? info.palette.length / 3 : 0} colours; ` +
    `${info.frames.filter((frame) => frame.palette).length} frames with their own; ` +
    `largest frame ${Math.max(...info.frames.slice(1).map((frame) => frame.data.length), 0)} bytes after the first (${info.frames[0].data.length})\n`);
  if (delays.some((delay) => delay < 2)) process.stdout.write('  ✗ a frame is held under 0.02 s: browsers slow those down\n');
  if (command === 'compare') {
    // Each frame against the PNG it was made from (the manifest's runs, in order).
    const [dir, half] = rest, names = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8').trim().split('\n');
    const runs = names.filter((name, i) => i === 0 || name !== names[i - 1]);
    if (runs.length > 1 && runs[runs.length - 1] === runs[0]) runs.pop();
    let worst = 0, wrong = 0, pixels = 0, bad = 0;
    play(info, (canvas, frame, index) => {
      const source = png.read(path.join(dir, runs[index])), step = half ? 2 : 1;
      let differing = 0;
      for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
        const a = (y * info.width + x) * 4, b = (y * step * source.width + x * step) * 4;
        const d = Math.max(Math.abs(canvas[a] - source.pixels[b]), Math.abs(canvas[a + 1] - source.pixels[b + 1]), Math.abs(canvas[a + 2] - source.pixels[b + 2]));
        if (d) { differing += 1; worst = Math.max(worst, d); }
      }
      wrong += differing; pixels += info.width * info.height; if (differing) bad += 1;
    });
    process.stdout.write(`  against ${runs.length} source pictures: ${wrong ? `${bad} frames differ, ${wrong} of ${pixels} pixels (${(wrong / pixels * 100).toFixed(4)} %), by at most ${worst} of 255 in a channel` : 'every pixel of every frame is the same'}\n`);
    if (runs.length !== info.frames.length) process.stdout.write(`  ✗ ${info.frames.length} frames but ${runs.length} source pictures\n`);
  }
  if (command === 'browser') {
    const build = require('../build.js'), report = path.join(build.OUT, `gif-browser-${process.pid}.json`);
    build.electron({ gifCheck: { file: path.resolve(file), dir: path.resolve(rest[0]) }, report });
    const r = JSON.parse(fs.readFileSync(report, 'utf8'));
    fs.rmSync(report, { force: true });
    process.stdout.write(`  Chromium reads it: ${r.width}×${r.height}, ${r.frames} frames, ${r.seconds.toFixed(2)} s, shortest hold ${r.shortest.toFixed(2)} s, loops ${r.loops}\n` +
      `  ${r.wrongFrames ? `✗ ${r.wrongFrames} frames differ from their source: ${r.wrongPixels} pixels, by at most ${r.worst} of 255 in a channel` : 'every pixel of every frame is the same as its source'}\n`);
    if (r.wrongFrames || r.frames !== r.sources) process.exitCode = 1;
  }
  if (command === 'export') {
    const [dir, list, shrink = '1'] = rest, wanted = new Set(list.split(',').map(Number));
    fs.mkdirSync(dir, { recursive: true });
    play(info, (canvas, frame, index) => {
      if (!wanted.has(index)) return;
      const image = { width: info.width, height: info.height, pixels: Buffer.from(canvas) }, target = path.join(dir, `${path.basename(file, '.gif')}-${String(index).padStart(3, '0')}.png`);
      png.write(target, Number(shrink) > 1 ? png.shrink(image, Number(shrink)) : image);
      process.stdout.write(`  ${target}\n`);
    });
  }
}
