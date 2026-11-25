'use strict';

/*
 * Frames + sound → mp4, for one language and one stretch of the film.
 * Called by build.js; everything it writes goes under out/.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = require('./build.js');
const audio = require('./audio/mix.js');

// The encoder is built from encode/encode.swift with the system's Swift when it is missing or older than its source.
function encoder() {
  const source = path.join(build.HERE, 'encode', 'encode.swift'), binary = path.join(build.OUT, 'bin', 'encode');
  if (!fs.existsSync(binary) || fs.statSync(binary).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const run = spawnSync('/usr/bin/swiftc', ['-O', source, '-o', binary], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`swiftc failed:\n${run.stderr}`);
  }
  return binary;
}

function film(lang, from, to, name) {
  const started = Date.now();
  const { dir, report } = build.frames(lang, from, to, name);
  const wav = path.join(build.OUT, 'audio', `${name}-${lang}.wav`);
  audio.writeWav(wav, audio.mix(lang, from, to).pcm);
  const out = path.join(build.OUT, `catshelf-${name}-${lang}.mp4`);
  const run = spawnSync(encoder(), ['--frames', dir, '--manifest', path.join(dir, 'manifest.txt'), '--audio', wav, '--out', out], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`encode failed:\n${run.stdout}${run.stderr}`);
  process.stdout.write(`${run.stdout.trim()}\n  ${report.frames} frames drawn, ${report.written} distinct, ${((Date.now() - started) / 1000).toFixed(0)} s in all\n`);
  return out;
}

module.exports = { film, encoder };
