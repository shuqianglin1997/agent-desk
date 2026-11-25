'use strict';

/*
 * Renders the film's sound: the music table (audio/bgm.js) and the cue list
 * (film/cues.js), both through the app's chip synthesiser (src/pixel/chip.js),
 * summed at the same levels and written as 48 kHz 16-bit stereo WAV with the
 * peak at −1 dBFS.
 *
 *   node audio/mix.js <zh|en> <out.wav> [from] [to]
 */

const fs = require('node:fs');
const path = require('node:path');
const Chip = require('../../../src/pixel/chip.js');
const bgm = require('./bgm.js');

const RATE = 48000, PEAK = Math.pow(10, -1 / 20);

// One piece of sound: a music table and a cue list, `seconds` long; [from, to) of it is returned.
function render(table, cueList, seconds, from, to) {
  const total = Math.round(seconds * RATE), out = new Float32Array(total);
  const add = (pcm, at) => { const start = Math.round(at * RATE); for (let i = 0; i < pcm.length && start + i < total; i += 1) if (start + i >= 0) out[start + i] += pcm[i]; };
  add(Chip.render(table, RATE), 0);
  const cache = new Map();
  for (const [at, name, seed] of cueList) {
    const key = `${name}:${seed || 0}`;
    if (!cache.has(key)) cache.set(key, Chip.render(Chip.SOUNDS[name](seed || 0), RATE));
    add(cache.get(key), at);
  }
  // One gain for the whole piece, so a sample of it sounds exactly as the whole will.
  let peak = 0;
  for (let i = 0; i < total; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? PEAK / peak : 1;
  const a = Math.round(from * RATE), b = Math.round(to * RATE), length = b - a;
  const cut = new Float32Array(length);
  for (let i = 0; i < length; i += 1) cut[i] = out[a + i] * gain;
  // A part that stops before the end is faded over its last 30 ms so it does not click.
  if (to < seconds) { const fade = Math.round(0.03 * RATE); for (let i = 0; i < fade; i += 1) cut[length - 1 - i] *= i / fade; }
  return { pcm: cut, gain, peakBefore: peak };
}

// The one-minute film.
function mix(lang, from = 0, to = 60) {
  const { cues } = require('../film/cues.js');
  return render(bgm.compose(), cues(lang), 60, from, to);
}

// The 15-second cut (both framings share it).
function mixShort(lang) {
  const cut = require('../film/cut.js');
  const result = render(bgm.composeShort(), cut.cues(lang), bgm.SHORT_SECONDS, 0, bgm.SHORT_SECONDS);
  // The score ends on silence; whatever a cue still has left in the last 50 ms is faded, so a loop does not click.
  const fade = Math.round(0.05 * RATE), length = result.pcm.length;
  for (let i = 0; i < fade; i += 1) result.pcm[length - 1 - i] *= i / fade;
  return result;
}

function writeWav(file, pcm) {
  const data = Buffer.alloc(pcm.length * 4);
  for (let i = 0; i < pcm.length; i += 1) {
    const value = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    data.writeInt16LE(value, i * 4); data.writeInt16LE(value, i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

module.exports = { mix, mixShort, render, writeWav, RATE };

if (require.main === module) {
  const [lang, file, from = '0', to = '60'] = process.argv.slice(2);
  const result = mix(lang, Number(from), Number(to));
  writeWav(file, result.pcm);
  let peak = 0;
  for (const value of result.pcm) peak = Math.max(peak, Math.abs(value));
  process.stdout.write(`${file}: ${(result.pcm.length / RATE).toFixed(3)} s, gain ${result.gain.toFixed(3)}, peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS\n`);
}
