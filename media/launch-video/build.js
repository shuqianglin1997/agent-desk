#!/usr/bin/env node
'use strict';

/*
 * Builds the launch film.
 *
 *   node media/launch-video/build.js stills <zh|en> <t,t,…> [piece]  single frames into out/stills/
 *   node media/launch-video/build.js film <zh|en> [from] [to] [name] frames, sound and mp4 into out/
 *   node media/launch-video/build.js cover <zh|en>                   the 1280×720 cover into out/
 *   node media/launch-video/build.js short <zh|en> [wide|tall]       the 15-second cut, 1920×1080 or 1080×1440
 *   node media/launch-video/build.js cover-tall <zh|en>              the 1080×1440 cover into out/
 *   node media/launch-video/build.js loop <zh|en>                    the README loop into docs/media/
 *
 * Frames are drawn by a hidden Electron page (render/), sound by audio/mix.js,
 * and the mp4 is written by the Swift encoder (encode/encode.swift) through
 * AVFoundation. Nothing is downloaded and no window is shown.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');

function electron(job) {
  fs.mkdirSync(OUT, { recursive: true });
  const jobFile = path.join(OUT, `job-${process.pid}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require(path.join(ROOT, 'node_modules', 'electron')), [path.join(HERE, 'render', 'main.js'), `--user-data-dir=${path.join(OUT, '.render-profile')}`, `--job=${jobFile}`], { cwd: ROOT, env, encoding: 'utf8' });
  fs.rmSync(jobFile, { force: true });
  const noise = /For more information and help|Security Warning|Content-Security|unsafe-eval|unnecessary security|electronjs\.org|will not show up|once the app is packaged|console-message|^\s*$|Policy set or a policy/;
  const lines = `${run.stdout || ''}${run.stderr || ''}`.split(/\r?\n/).filter((line) => !noise.test(line));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  if (run.status !== 0) throw new Error(`render failed (exit ${run.status})`);
}

// What each piece is (the sizes and rates are the ones film/pieces.js draws at).
const PIECES = { film: { fps: 60, seconds: 60 }, short: { fps: 60, seconds: 15 }, 'short-tall': { fps: 60, seconds: 15 }, loop: { fps: 50, seconds: 8 } };

function stills(lang, times, piece = 'film') {
  const out = path.join(OUT, 'stills'), tag = piece === 'film' ? lang : `${piece}-${lang}`;
  electron({ lang, piece, out, stills: times.map((t) => ({ t, name: `${tag}-${t.toFixed(2).padStart(5, '0')}` })) });
  return times.map((t) => path.join(out, `${tag}-${t.toFixed(2).padStart(5, '0')}.png`));
}

// The cover image, drawn at its own size.
function cover(lang) {
  electron({ lang, width: 1280, height: 720, out: OUT, stills: [{ state: 'cover', name: `catshelf-cover-${lang}` }] });
  return path.join(OUT, `catshelf-cover-${lang}.png`);
}

// The 3:4 cover: the 15-second cut's end card at rest, 1080×1440.
function coverTall(lang) {
  electron({ lang, width: 1080, height: 1440, out: OUT, stills: [{ state: 'cover-tall', name: `catshelf-cover-3x4-${lang}` }] });
  return path.join(OUT, `catshelf-cover-3x4-${lang}.png`);
}

// Where each caption sits (frame pixels), measured with the real font. `state` names which captions.
function captions(lang, state = 'captions') {
  const report = path.join(OUT, `captions-${lang}.json`);
  electron({ lang, out: OUT, report, stills: [{ state, name: 'captions' }] });
  const boxes = JSON.parse(fs.readFileSync(report, 'utf8')).captions;
  fs.rmSync(report, { force: true });
  return boxes;
}

function frames(lang, from, to, name, piece = 'film') {
  const out = path.join(OUT, 'frames', `${name}-${lang}`), fps = PIECES[piece].fps;
  fs.rmSync(out, { recursive: true, force: true });
  const report = path.join(OUT, `render-${name}-${lang}.json`);
  electron({ lang, piece, out, from: Math.round(from * fps), to: Math.round(to * fps), report });
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  fs.rmSync(report, { force: true });
  return { dir: out, report: result };
}

module.exports = { electron, stills, frames, cover, coverTall, captions, PIECES, OUT, HERE, ROOT };

if (require.main === module) {
  const [command, lang, ...rest] = process.argv.slice(2);
  if (command === 'stills') {
    const piece = PIECES[rest[rest.length - 1]] ? rest.pop() : 'film';
    for (const file of stills(lang, rest.join(',').split(',').map(Number), piece)) process.stdout.write(`${file}\n`);
  } else if (command === 'short') {
    process.stdout.write(`${require('./assemble.js').short(lang, rest[0] || 'wide')}\n`);
  } else if (command === 'cover-tall') {
    process.stdout.write(`${coverTall(lang)}\n`);
  } else if (command === 'loop') {
    process.stdout.write(`${require('./assemble.js').loop(lang)}\n`);
  } else if (command === 'cover') {
    process.stdout.write(`${cover(lang)}\n`);
  } else if (command === 'film') {
    const [from = '0', to = '60', name = 'film'] = rest;
    require('./assemble.js').film(lang, Number(from), Number(to), name);
  } else {
    process.stderr.write('usage: build.js stills <lang> <t,…> [piece] | film <lang> [from] [to] [name] | cover <lang> | short <lang> [wide|tall] | cover-tall <lang> | loop <lang>\n');
    process.exitCode = 1;
  }
}
