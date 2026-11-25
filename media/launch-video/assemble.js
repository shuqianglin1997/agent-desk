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

// Frames + a WAV → an mp4 at the frames' own size.
function encode(dir, wav, out, size) {
  const args = ['--frames', dir, '--manifest', path.join(dir, 'manifest.txt'), '--audio', wav, '--out', out];
  if (size) args.push('--width', String(size.width), '--height', String(size.height));
  const run = spawnSync(encoder(), args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`encode failed:\n${run.stdout}${run.stderr}`);
  // AVFoundation leaves its working copy beside the finished file (<name>.sb-…); only the film stays.
  for (const entry of fs.readdirSync(build.OUT)) if (entry.startsWith(`${path.basename(out)}.sb-`)) fs.rmSync(path.join(build.OUT, entry), { force: true });
  return run.stdout.trim();
}

function film(lang, from, to, name) {
  const started = Date.now();
  const { dir, report } = build.frames(lang, from, to, name);
  const wav = path.join(build.OUT, 'audio', `${name}-${lang}.wav`);
  audio.writeWav(wav, audio.mix(lang, from, to).pcm);
  const out = path.join(build.OUT, `catshelf-${name}-${lang}.mp4`);
  const said = encode(dir, wav, out);
  process.stdout.write(`${said}\n  ${report.frames} frames drawn, ${report.written} distinct, ${((Date.now() - started) / 1000).toFixed(0)} s in all\n`);
  return out;
}

// The 15-second cut: 'wide' is 1920×1080, 'tall' 1080×1440. Both carry the same sound.
function short(lang, framing = 'wide') {
  const started = Date.now(), tall = framing === 'tall', name = tall ? 'short-3x4' : 'short';
  const { dir, report } = build.frames(lang, 0, 15, name, tall ? 'short-tall' : 'short');
  const wav = path.join(build.OUT, 'audio', `short-${lang}.wav`);
  audio.writeWav(wav, audio.mixShort(lang).pcm);
  const out = path.join(build.OUT, `catshelf-${name}-${lang}.mp4`);
  const said = encode(dir, wav, out, tall ? { width: 1080, height: 1440 } : null);
  process.stdout.write(`${said}\n  ${report.frames} frames drawn, ${report.written} distinct, ${((Date.now() - started) / 1000).toFixed(0)} s in all\n`);
  return out;
}

// A Swift tool built from encode/<name>.swift when it is missing or older than its source.
function swiftTool(name) {
  const source = path.join(build.HERE, 'encode', `${name}.swift`), binary = path.join(build.OUT, 'bin', name);
  if (!fs.existsSync(binary) || fs.statSync(binary).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const run = spawnSync('/usr/bin/swiftc', ['-O', source, '-o', binary], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`swiftc failed:\n${run.stderr}`);
  }
  return binary;
}

/*
 * The README loop → docs/media/catshelf-loop-<lang>.gif (this one is committed: the README shows it).
 * Frames, then one palette for all of them, then the GIF, then two readings of it against those frames:
 * ours (tools/gif.js) and the system's (encode/gifcheck.swift through ImageIO). It is not kept unless both agree.
 */
function loop(lang) {
  const started = Date.now(), piece = build.PIECES.loop;
  const { dir, report } = build.frames(lang, 0, piece.seconds, 'loop', 'loop');
  const flat = `${dir}-palette`, reduced = require('./tools/palette.js').reduce(dir, flat, false);
  const out = path.join(build.ROOT, 'docs', 'media', `catshelf-loop-${lang}.gif`);
  const written = require('./encode/gif.js').write(flat, out, 1 / piece.fps);
  const ours = spawnSync(process.execPath, [path.join(build.HERE, 'tools', 'gif.js'), out, 'compare', flat], { encoding: 'utf8' });
  const system = spawnSync(swiftTool('gifcheck'), [out, flat], { encoding: 'utf8' });
  process.stdout.write(`${ours.stdout}${system.stdout}${system.stderr}`);
  const agreed = ours.status === 0 && /every pixel of every frame is the same/.test(ours.stdout) && system.status === 0;
  if (!agreed) { fs.rmSync(out, { force: true }); throw new Error('the GIF does not read back as its frames; nothing was kept'); }
  process.stdout.write(`  ${report.frames} ticks drawn, ${written.frames} pictures, ${reduced.colours} colours → ${reduced.kept} (${reduced.moved} of ${reduced.total} pixels took the nearest kept colour), ${((Date.now() - started) / 1000).toFixed(0)} s in all\n`);
  return out;
}

module.exports = { film, short, loop, encoder };
