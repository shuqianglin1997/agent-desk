#!/usr/bin/env node
'use strict';

/*
 * Builds the launch film.
 *
 *   node media/launch-video/build.js stills <zh|en> <t,t,…>          single frames into out/stills/
 *   node media/launch-video/build.js film <zh|en> [from] [to] [name] frames, sound and mp4 into out/
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
  const noise = /Security Warning|Content-Security|unsafe-eval|unnecessary security|electronjs\.org|will not show up|once the app is packaged|console-message|^\s*$|Policy set or a policy/;
  const lines = `${run.stdout || ''}${run.stderr || ''}`.split(/\r?\n/).filter((line) => !noise.test(line));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  if (run.status !== 0) throw new Error(`render failed (exit ${run.status})`);
}

function stills(lang, times) {
  const out = path.join(OUT, 'stills');
  electron({ lang, out, stills: times.map((t) => ({ t, name: `${lang}-${t.toFixed(2).padStart(5, '0')}` })) });
  return times.map((t) => path.join(out, `${lang}-${t.toFixed(2).padStart(5, '0')}.png`));
}

function frames(lang, from, to, name) {
  const out = path.join(OUT, 'frames', `${name}-${lang}`);
  fs.rmSync(out, { recursive: true, force: true });
  const report = path.join(OUT, `render-${name}-${lang}.json`);
  electron({ lang, out, from: Math.round(from * 60), to: Math.round(to * 60), report });
  return { dir: out, report: JSON.parse(fs.readFileSync(report, 'utf8')) };
}

module.exports = { electron, stills, frames, OUT, HERE, ROOT };

if (require.main === module) {
  const [command, lang, ...rest] = process.argv.slice(2);
  if (command === 'stills') {
    for (const file of stills(lang, rest.join(',').split(',').map(Number))) process.stdout.write(`${file}\n`);
  } else if (command === 'film') {
    const [from = '0', to = '60', name = 'film'] = rest;
    require('./assemble.js').film(lang, Number(from), Number(to), name);
  } else {
    process.stderr.write('usage: build.js stills <lang> <t,…> | film <lang> [from] [to] [name]\n');
    process.exitCode = 1;
  }
}
