'use strict';

/*
 * The page that draws the film, one frame at a time, and writes each as a PNG.
 *
 * Frame n is drawn for the time n/60 s by film.render(), a pure function of
 * time and language: there is no clock here, so a frame is the same however
 * long it took to draw. A frame identical to the one before is not written
 * again; the manifest names, for every frame, the file that holds it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcRenderer } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..');

async function loadFonts() {
  const file = path.join(ROOT, 'assets', 'fonts', 'fusion-pixel-12px-proportional-zh_hans.otf.woff2');
  const face = new FontFace('Fusion Pixel', `url("file://${encodeURI(file)}")`, { weight: '100 900' });
  await face.load();
  document.fonts.add(face);
  await document.fonts.ready;
}

// FNV-1a over the pixels, two seeds: enough to tell "same as the last frame".
function fingerprint(words) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < words.length; i += 1) {
    const value = words[i];
    a = Math.imul(a ^ value, 0x01000193);
    b = Math.imul(b + value, 0x85ebca6b) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

const toPng = (canvas) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((data) => resolve(Buffer.from(data)), reject) : reject(new Error('no blob'))), 'image/png'));

async function run(job) {
  await loadFonts();
  const film = require(path.join(__dirname, '..', 'film', 'film.js'));
  const width = job.width || 1920, height = job.height || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
  fs.mkdirSync(job.out, { recursive: true });
  const result = { frames: 0, written: 0, files: [] };

  if (job.stills) {
    // Single frames by time (seconds), or named states for checking the drawing.
    for (const still of job.stills) {
      if (still.state) { const data = film.renderState(ctx, still.state, job.lang, still); if (data) { result[still.name] = data; continue; } }
      else film.render(ctx, still.t, job.lang, job.options || {});
      const file = path.join(job.out, `${still.name}.png`);
      fs.writeFileSync(file, await toPng(canvas));
      result.files.push(file);
    }
    return result;
  }

  const manifest = [];
  let last = '', lastFile = '';
  const started = Date.now();
  for (let n = job.from; n < job.to; n += 1) {
    film.render(ctx, n / 60, job.lang, job.options || {});
    const print = fingerprint(new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer));
    if (print !== last) {
      lastFile = `f${String(n).padStart(5, '0')}.png`;
      fs.writeFileSync(path.join(job.out, lastFile), await toPng(canvas));
      last = print;
      result.written += 1;
    }
    manifest.push(lastFile);
    result.frames += 1;
    if (n % 300 === 0) console.log(`  ${job.lang} frame ${n} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  fs.writeFileSync(path.join(job.out, 'manifest.txt'), `${manifest.join('\n')}\n`);
  result.seconds = (Date.now() - started) / 1000;
  return result;
}

ipcRenderer.invoke('film:job').then(run).then((result) => ipcRenderer.send('film:done', result), (error) => {
  console.log(`render failed: ${error && error.stack || error}`);
  ipcRenderer.send('film:done', { error: String(error && error.stack || error) });
});
