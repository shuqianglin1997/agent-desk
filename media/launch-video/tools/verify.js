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
 *
 * The 15-second cut and the README loop are held to the same list:
 *
 *   node media/launch-video/tools/verify.js <zh|en> short [wide|tall]
 *   node media/launch-video/tools/verify.js <zh|en> loop
 *
 * And the 3:4 cover, which has no time: everything written on it lies inside the frame with room to spare, on the
 * 4px grid, in sizes that are whole multiples of 12, and nothing written lies over anything else written.
 *
 *   node media/launch-video/tools/verify.js <zh|en> cover [xiaohongshu|bilibili|youtube|wechat|wechat-square]
 *
 * For a cover that some places crop to its middle, also that the part kept holds what it must.
 */

const fs = require('node:fs');
const path = require('node:path');
const film = require('../film/film.js');
const build = require('../build.js');
const { FILM } = require('../film/strings.js');
const { cues } = require('../film/cues.js');
const Chip = require('../../../src/pixel/chip.js');

const [lang, name = 'film', from = '0', to = '60'] = process.argv.slice(2);
const read = (folder) => fs.readFileSync(path.join(__dirname, '..', 'out', 'frames', folder, 'manifest.txt'), 'utf8').trim().split('\n');
const lengthOf = (text) => (lang === 'zh' ? [...text.replace(/[\s，。：、]/g, '')].length : text.trim().split(/\s+/).length);
const LIMIT = lang === 'zh' ? 12 : 6, UNIT = lang === 'zh' ? 'characters' : 'words';
const report = (line, problems, good) => {
  process.stdout.write(`${line}\n`);
  if (problems.length) { process.stdout.write(`${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write(`  ${good}\n`);
};
// A caption box against a frame: inside it, in its lower third, within the length the plan allows.
function checkCaptions(boxes, width, height, problems) {
  boxes.forEach((box) => {
    if (!box.text) return;
    if (box.x < 0 || box.x + box.w > width) problems.push(`caption at ${box.at} s leaves the frame (${box.x}…${box.x + box.w})`);
    if (box.y < height * 2 / 3 || box.y + box.h > height) problems.push(`caption at ${box.at} s is not in the lower third (${box.y}…${box.y + box.h} of ${height})`);
    if (lengthOf(box.text) > LIMIT) problems.push(`caption at ${box.at} s is ${lengthOf(box.text)} ${UNIT}: “${box.text}”`);
  });
}

if (name === 'short') verifyShort(from === 'tall' ? 'tall' : 'wide');
else if (name === 'loop') verifyLoop();
else if (name === 'cover') verifyCover(from === '0' ? 'xiaohongshu' : from);
else verifyFilm();

function verifyShort(framing) {
  const cut = require('../film/cut.js'), view = film.VIEWS[framing];
  const manifest = read(`${framing === 'tall' ? 'short-3x4' : 'short'}-${lang}`), problems = [];
  if (manifest.length !== cut.END * 60) problems.push(`expected ${cut.END * 60} frames, found ${manifest.length}`);
  const onBeat = (label, seconds, grid) => { if (Math.abs(seconds * grid - Math.round(seconds * grid)) > 1e-9) problems.push(`${label} at ${seconds} s is not on ${grid === 2 ? 'a beat' : 'a beat, a half or a quarter of one'}`); };
  const fresh = (label, seconds) => { const frame = Math.round(seconds * 60); if (frame > 0 && manifest[frame] === manifest[frame - 1]) problems.push(`${label} at ${seconds} s: frame ${frame} is the same picture as the one before`); };
  cut.CUTS.forEach((at, i) => { onBeat(`cut ${i + 1}`, at, 2); fresh(`cut ${i + 1}`, at); });
  cut.moves(framing).forEach((at) => { onBeat('camera move', at, 4); fresh('camera move', at); });
  cut.jumps(framing).forEach((at) => { onBeat('cut inside a stretch', at, 2); fresh('cut inside a stretch', at); });
  const SHORT = require('../film/strings.js').SHORT[lang];
  SHORT.captions.forEach(([at, text]) => { onBeat('caption', at, 2); if (text) fresh('caption', at); });
  const boxes = build.captions(lang, 'short-captions')[framing];
  checkCaptions(boxes, view.width, view.height, problems);
  const list = cut.cues(lang), unknown = list.filter(([, sound]) => !Chip.names.includes(sound));
  if (unknown.length) problems.push(`unknown sounds: ${unknown.map((cue) => cue[1]).join(', ')}`);
  list.forEach(([at, sound]) => { if (at < 0 || at >= cut.END) problems.push(`sound ${sound} at ${at} s is outside the cut`); });
  report(`${lang} short ${framing}: ${manifest.length} frames (${(manifest.length / 60).toFixed(3)} s) at ${view.width}×${view.height}, ${new Set(manifest).size} distinct pictures, ${cut.CUTS.length + cut.jumps(framing).length} cuts, ${cut.moves(framing).length} camera moves, ${boxes.length} captions, ${list.length} sound cues`,
    problems, 'every cut is on a beat and every camera move on a clean part of one, each with a new picture; every caption is inside the lower third and within length');
}

function verifyCover(format) {
  const spec = require('../film/poster.js').FORMATS[format];
  if (!spec) { process.stdout.write(`no cover called ${format}\n`); process.exitCode = 1; return; }
  const boxes = build.captions(lang, `poster-boxes:${format}`), problems = [], MARGIN = 40;
  const file = path.join(__dirname, '..', 'out', `${spec.file(lang)}.png`);
  let bytes = 0;
  if (!fs.existsSync(file)) problems.push(`the cover has not been rendered (build.js poster ${format} ${lang})`);
  else {
    const image = require('./png.js').read(file);
    bytes = fs.statSync(file).size;
    if (image.width !== boxes.width || image.height !== boxes.height) problems.push(`the cover is ${image.width}×${image.height}, not ${boxes.width}×${boxes.height}`);
    if (bytes >= 2 * 1024 * 1024) problems.push(`the cover is ${bytes} bytes; the places it goes take less than 2 MB`);
  }
  const written = boxes.head.map((box) => ['line', box]).concat(boxes.tags.map((box) => ['tag', box]), [['the line at the bottom', boxes.find]]);
  written.forEach(([kind, box]) => {
    if (box.x < MARGIN || box.x + box.w > boxes.width - MARGIN || box.y < MARGIN || box.y + box.h > boxes.height - 16) problems.push(`${kind} “${box.text}” is too close to the edge (${box.x}…${Math.ceil(box.x + box.w)}, ${box.y}…${box.y + box.h})`);
    if (box.x % 4 || box.y % 4) problems.push(`${kind} “${box.text}” is off the 4px grid (${box.x}, ${box.y})`);
    if (box.size && box.size % 12) problems.push(`${kind} “${box.text}” is set at ${box.size}px, not a whole multiple of 12`);
  });
  written.forEach(([kind, a], i) => written.slice(i + 1).forEach(([, b]) => {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) problems.push(`${kind} “${a.text}” lies over “${b.text}”`);
  }));
  // What a crop to the middle must keep.
  let kept = '';
  if (boxes.safe) {
    const [left, right] = boxes.safe, inside = (box) => box.x >= left && box.x + box.w <= right;
    const must = boxes.safeHolds === 'all' ? written.concat(boxes.cats.map((box) => ['cat', box])) : boxes.head.map((box) => ['line', box]);
    must.forEach(([kind, box]) => { if (!inside(box)) problems.push(`${kind} “${box.text}” reaches outside the part that is kept (${left}…${right}): ${box.x}…${Math.ceil(box.x + box.w)}`); });
    const whole = boxes.cats.filter((cat, i) => inside(cat) && inside(boxes.tags[i]));
    if (!whole.length) problems.push(`no cat with its tag lies inside the part that is kept (${left}…${right})`);
    kept = `; cropped to ${left}…${right} it keeps the two lines and ${whole.length} of the cats with their tags`;
  }
  report(`${lang} cover ${format}: ${boxes.width}×${boxes.height}, ${bytes} bytes; ${boxes.head.length} lines at ${boxes.head[0].size}px (${boxes.head.map((box) => Math.ceil(box.w)).join(' and ')}px wide), ${boxes.tags.length} tags (${boxes.tags.map((box) => box.text).join(', ')}), the line at the bottom at ${boxes.find.size}px${kept}`,
    problems, 'everything written is inside the frame, on the 4px grid, in whole multiples of 12, and nothing lies over anything else');
}

function verifyLoop() {
  const loop = require('../film/loop.js'), manifest = read(`loop-${lang}`), problems = [];
  if (manifest.length !== loop.SECONDS * loop.FPS) problems.push(`expected ${loop.SECONDS * loop.FPS} frames, found ${manifest.length}`);
  const boxes = build.captions(lang, 'loop-captions');
  checkCaptions(boxes, loop.WIDTH, loop.HEIGHT, problems);
  boxes.forEach((box) => { const frame = Math.round(box.at * loop.FPS); if (frame > 0 && manifest[frame] === manifest[frame - 1]) problems.push(`caption at ${box.at} s does not bring a new picture`); });
  report(`${lang} loop: ${manifest.length} frames (${(manifest.length / loop.FPS).toFixed(3)} s) at ${loop.WIDTH}×${loop.HEIGHT}, ${new Set(manifest).size} distinct pictures, ${boxes.length} captions, no sound`,
    problems, 'every caption is inside the lower third and within length');
}

function verifyFilm() {
  const manifest = read(`${name}-${lang}`);
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
}
