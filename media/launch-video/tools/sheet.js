#!/usr/bin/env node
'use strict';

// A contact sheet: frames of the film at the given times, reduced and laid out
// in rows, to look at a movement frame by frame.
//
//   node media/launch-video/tools/sheet.js <zh|en> <out.png> <columns> <factor> <from> <to> <step in frames>
//   node media/launch-video/tools/sheet.js <zh|en> <out.png> <columns> <factor> at <t,t,…>
//   node media/launch-video/tools/sheet.js frames <frames dir> <out.png> <columns> <factor> <first> <last> <step>   (frames already rendered, any piece)

const fs = require('node:fs');
const path = require('node:path');
const png = require('./png.js');
const build = require('../build.js');

const [lang, out, columns, factor, from, to, step] = process.argv.slice(2);
if (lang === 'frames') {
  // A sheet from frames already rendered: sheet.js frames <frames dir> <out.png> <columns> <factor> <first> <last> <step>
  const [dir, target, cols, shrink, first, last, every] = process.argv.slice(3);
  const manifest = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8').trim().split('\n'), picked = [];
  for (let frame = Number(first); frame <= Math.min(Number(last), manifest.length - 1); frame += Number(every || 1)) picked.push(path.join(dir, manifest[frame]));
  png.write(path.resolve(target), png.grid(picked.map((file) => png.shrink(png.read(file), Number(shrink))), Number(cols)));
  process.stdout.write(`${picked.length} frames → ${target}\n`);
} else {
  const times = [];
  if (from === 'at') times.push(...to.split(',').map(Number));
  else for (let frame = Math.round(Number(from) * 60); frame <= Math.round(Number(to) * 60); frame += Number(step || 1)) times.push(frame / 60);
  const files = build.stills(lang, times.map((t) => Math.round(t * 1000) / 1000));
  png.write(path.resolve(out), png.grid(files.map((file) => png.shrink(png.read(file), Number(factor))), Number(columns)));
  process.stdout.write(`${times.length} frames → ${out}\n`);
}
