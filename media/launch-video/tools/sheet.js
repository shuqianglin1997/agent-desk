#!/usr/bin/env node
'use strict';

// A contact sheet: frames of the film at the given times, reduced and laid out
// in rows, to look at a movement frame by frame.
//
//   node media/launch-video/tools/sheet.js <zh|en> <out.png> <columns> <factor> <from> <to> <step in frames>
//   node media/launch-video/tools/sheet.js <zh|en> <out.png> <columns> <factor> at <t,t,…>

const path = require('node:path');
const png = require('./png.js');
const build = require('../build.js');

const [lang, out, columns, factor, from, to, step] = process.argv.slice(2);
const times = [];
if (from === 'at') times.push(...to.split(',').map(Number));
else for (let frame = Math.round(Number(from) * 60); frame <= Math.round(Number(to) * 60); frame += Number(step || 1)) times.push(frame / 60);
const files = build.stills(lang, times.map((t) => Math.round(t * 1000) / 1000));
png.write(path.resolve(out), png.grid(files.map((file) => png.shrink(png.read(file), Number(factor))), Number(columns)));
process.stdout.write(`${times.length} frames → ${out}\n`);
