#!/usr/bin/env node
'use strict';

/*
 * Checks a rendered stretch of the film against the plan's acceptance list:
 *   - the frame count is the stretch × 60;
 *   - every shot begins on its beat: the frame at each shot time is a new picture, within one frame;
 *   - every camera move begins on a beat;
 *   - every caption lies inside the frame, in the lower third, and keeps to the length the plan allows;
 *   - every sound cue names a sound the app has.
 *
 *   node media/launch-video/tools/verify.js <zh|en> <name> [from] [to]
 */

const fs = require('node:fs');
const path = require('node:path');
const film = require('../film/film.js');
const build = require('../build.js');
const { FILM } = require('../film/strings.js');
const { cues } = require('../film/cues.js');
const Chip = require('../../../src/pixel/chip.js');

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
  if (Math.abs(seconds * 4 - Math.round(seconds * 4)) > 1e-9) problems.push(`${label} at ${seconds} s is not on a beat, a half or a quarter of one`);
  if (!changesAt(frame)) problems.push(`${label} at ${seconds} s: frame ${frame} is the same picture as the one before`);
};
film.SHOTS.forEach((at, i) => check(`shot ${i + 1}`, at));
film.cameraMoves({ dialogTilt: 0 }).slice(1).forEach((move) => check('camera move', move[0]));

// Captions: inside the frame, in the lower third, short enough.
const boxes = build.captions(lang);
boxes.forEach((box) => {
  if (!box.text) return;
  if (box.x < 0 || box.x + box.w > film.WIDTH) problems.push(`caption at ${box.at} s leaves the frame (${box.x}…${box.x + box.w})`);
  if (box.y < film.HEIGHT * 2 / 3 || box.y + box.h > film.HEIGHT) problems.push(`caption at ${box.at} s is not in the lower third`);
  const length = lang === 'zh' ? [...box.text.replace(/[\s，。：、]/g, '')].length : box.text.trim().split(/\s+/).length;
  if (length > (lang === 'zh' ? 12 : 6)) problems.push(`caption at ${box.at} s is ${length} ${lang === 'zh' ? 'characters' : 'words'}: “${box.text}”`);
});
if (FILM[lang].captions.length !== film.SHOTS.length) problems.push('captions and shots do not pair up');

const unknown = cues(lang).filter(([, sound]) => !Chip.names.includes(sound));
if (unknown.length) problems.push(`unknown sounds: ${unknown.map((cue) => cue[1]).join(', ')}`);

const distinct = new Set(manifest).size, shots = film.SHOTS.filter((at) => at * 60 >= first && at * 60 < last).length;
process.stdout.write(`${lang} ${name}: ${manifest.length} frames (${(manifest.length / 60).toFixed(3)} s), ${distinct} distinct pictures, ${shots} shots, ${boxes.filter((box) => box.text).length} captions, ${cues(lang).length} sound cues\n`);
if (problems.length) { process.stdout.write(`${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write('  every shot and camera move starts on its beat; every caption is inside the lower third and within length\n');
