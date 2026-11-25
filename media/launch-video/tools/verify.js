#!/usr/bin/env node
'use strict';

/*
 * Checks a rendered stretch of the film against the plan's acceptance list:
 *   - every shot begins on its beat: the frame at each shot time is a new picture
 *     (the caption changes there), within one frame;
 *   - every camera move begins on its beat;
 *   - the frame count is the stretch × 60.
 *
 *   node media/launch-video/tools/verify.js <zh|en> <name> [from] [to]
 */

const fs = require('node:fs');
const path = require('node:path');
const film = require('../film/film.js');

const [lang, name = 'film', from = '0', to = '60'] = process.argv.slice(2);
const dir = path.join(__dirname, '..', 'out', 'frames', `${name}-${lang}`);
const manifest = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8').trim().split('\n');
const first = Math.round(Number(from) * 60), last = Math.round(Number(to) * 60);
const problems = [];
if (manifest.length !== last - first) problems.push(`expected ${last - first} frames, found ${manifest.length}`);
const changesAt = (frame) => frame === first || manifest[frame - first] !== manifest[frame - first - 1];
const check = (label, seconds) => {
  const frame = Math.round(seconds * 60);
  if (frame < first || frame >= last) return;
  if (Math.abs(seconds * 2 - Math.round(seconds * 2)) > 1e-9 && Math.abs(seconds * 4 - Math.round(seconds * 4)) > 1e-9) problems.push(`${label} at ${seconds} s is not on a beat or half beat`);
  if (!changesAt(frame)) problems.push(`${label} at ${seconds} s: frame ${frame} is the same picture as the one before`);
};
film.SHOTS.forEach((at, i) => check(`shot ${i + 1}`, at));
film.cameraMoves({ dialogTilt: 0 }).slice(1).forEach((move) => check('camera move', move[0]));
const distinct = new Set(manifest).size;
process.stdout.write(`${lang} ${name}: ${manifest.length} frames (${(manifest.length / 60).toFixed(3)} s), ${distinct} distinct pictures, ${film.SHOTS.filter((at) => at * 60 >= first && at * 60 < last).length} shots checked\n`);
if (problems.length) { process.stdout.write(`${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write('  every shot and camera move starts on its beat\n');
