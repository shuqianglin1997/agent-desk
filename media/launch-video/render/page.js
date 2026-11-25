'use strict';

/*
 * The page that draws the film, one frame at a time, and writes each as a PNG.
 *
 * Frame n is drawn for the time n/fps by the piece's render(), a pure function
 * of time and language: there is no clock here, so a frame is the same however
 * long it took to draw. A frame identical to the one before is not written
 * again; the manifest names, for every frame, the file that holds it.
 * job.piece picks what is drawn (film/pieces.js): the film, its 15-second cut,
 * the tall cut, or the README loop.
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

/*
 * Reads a GIF with the browser's own decoder (this page is Chromium, as Chrome and Edge are) and compares every
 * frame, as the browser would show it, with the picture it was made from. Nothing is shown.
 */
async function checkGif({ file, dir }) {
  const decoder = new ImageDecoder({ data: fs.readFileSync(file), type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack, count = track.frameCount;
  const names = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8').trim().split('\n').filter((name, i, all) => i === 0 || name !== all[i - 1]);
  if (names.length > 1 && names[names.length - 1] === names[0]) names.pop();
  const result = { frames: count, sources: names.length, loops: track.repetitionCount === Infinity ? 'for ever' : String(track.repetitionCount), seconds: 0, shortest: Infinity, wrongFrames: 0, wrongPixels: 0, worst: 0 };
  let canvas = null, ctx = null;
  const pixelsOf = (image, width, height) => { ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, width, height).data; };
  for (let index = 0; index < count; index += 1) {
    const { image } = await decoder.decode({ frameIndex: index });
    const width = image.displayWidth, height = image.displayHeight;
    if (!canvas) { canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }); result.width = width; result.height = height; }
    result.seconds += image.duration / 1e6; result.shortest = Math.min(result.shortest, image.duration / 1e6);
    const shown = Uint8ClampedArray.from(pixelsOf(image, width, height));
    image.close();
    if (index >= names.length) continue;
    const source = await createImageBitmap(new Blob([fs.readFileSync(path.join(dir, names[index]))], { type: 'image/png' }), { colorSpaceConversion: 'none' });
    const expected = pixelsOf(source, width, height);
    source.close();
    let differing = 0;
    for (let i = 0; i < shown.length; i += 4) {
      const d = Math.max(Math.abs(shown[i] - expected[i]), Math.abs(shown[i + 1] - expected[i + 1]), Math.abs(shown[i + 2] - expected[i + 2]));
      if (d) { differing += 1; if (d > result.worst) result.worst = d; }
    }
    if (differing) { result.wrongFrames += 1; result.wrongPixels += differing; }
  }
  return result;
}

async function run(job) {
  if (job.gifCheck) return checkGif(job.gifCheck);
  await loadFonts();
  const pieces = require(path.join(__dirname, '..', 'film', 'pieces.js'));
  const piece = pieces.PIECES[job.piece || 'film'];
  if (!piece) throw new Error(`no piece called ${job.piece}`);
  const width = job.width || piece.width, height = job.height || piece.height;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true, colorSpace: 'srgb' });
  fs.mkdirSync(job.out, { recursive: true });
  const result = { frames: 0, written: 0, files: [] };

  if (job.stills) {
    // Single frames by time (seconds), or named states for checking the drawing.
    for (const still of job.stills) {
      if (still.state) { const data = pieces.state(ctx, still.state, job.lang, still); if (data) { result[still.name] = data; continue; } }
      else piece.render(ctx, still.t, job.lang);
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
    piece.render(ctx, n / piece.fps, job.lang);
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
