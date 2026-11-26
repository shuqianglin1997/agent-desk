'use strict';

// A small PNG reader and writer (8-bit RGB/RGBA, not interlaced), for looking
// at rendered frames and reference captures without any dependency.

const fs = require('node:fs');
const zlib = require('node:zlib');

function read(file) {
  const data = fs.readFileSync(file);
  let offset = 8, width = 0, height = 0, colorType = 0;
  const chunks = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${file}: unsupported PNG`);
      colorType = body[9];
    } else if (type === 'IDAT') chunks.push(body);
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`${file}: unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const flat = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? flat[y * stride + x - channels] : 0;
      const up = y > 0 ? flat[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? flat[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      flat[y * stride + x] = value & 0xff;
    }
  }
  // Always hand back RGBA.
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1) {
    pixels[i * 4] = flat[j]; pixels[i * 4 + 1] = flat[j + 1]; pixels[i * 4 + 2] = flat[j + 2];
    pixels[i * 4 + 3] = channels === 4 ? flat[j + 3] : 255;
    j += channels;
  }
  return { width, height, pixels };
}

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0); head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function write(file, image) {
  const { width, height, pixels } = image;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

function crop(image, x, y, w, h) {
  const pixels = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    for (let col = 0; col < w; col += 1) {
      const sx = x + col;
      if (sx < 0 || sx >= image.width) continue;
      image.pixels.copy(pixels, (row * w + col) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return { width: w, height: h, pixels };
}

// Nearest-neighbour enlargement by a whole factor.
function enlarge(image, factor) {
  const width = image.width * factor, height = image.height * factor;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const from = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
    image.pixels.copy(pixels, (y * width + x) * 4, from, from + 4);
  }
  return { width, height, pixels };
}

// Two images side by side with a gap, for comparing a drawing with a capture.
function beside(a, b, gap = 8) {
  const width = a.width + gap + b.width, height = Math.max(a.height, b.height);
  const pixels = Buffer.alloc(width * height * 4, 0x80);
  for (let y = 0; y < a.height; y += 1) a.pixels.copy(pixels, y * width * 4, y * a.width * 4, (y + 1) * a.width * 4);
  for (let y = 0; y < b.height; y += 1) b.pixels.copy(pixels, (y * width + a.width + gap) * 4, y * b.width * 4, (y + 1) * b.width * 4);
  return { width, height, pixels };
}

// Reduction by a whole factor, averaging each block (for contact sheets).
function shrink(image, factor) {
  const width = Math.floor(image.width / factor), height = Math.floor(image.height / factor);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sum = [0, 0, 0, 0];
    for (let j = 0; j < factor; j += 1) for (let i = 0; i < factor; i += 1) {
      const from = ((y * factor + j) * image.width + x * factor + i) * 4;
      for (let c = 0; c < 4; c += 1) sum[c] += image.pixels[from + c];
    }
    for (let c = 0; c < 4; c += 1) pixels[(y * width + x) * 4 + c] = Math.round(sum[c] / (factor * factor));
  }
  return { width, height, pixels };
}

// Images laid out in rows of `columns`, for looking at a run of frames at once.
// Reduced to `width` px wide as a page shows a large picture small: each output pixel is the average of the part
// of the picture that falls in it. crop: [left, right] keeps only that part of the picture first.
function fit(image, width, crop) {
  const left = crop ? crop[0] : 0, right = crop ? crop[1] : image.width, scale = (right - left) / width, height = Math.round(image.height / scale);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const x0 = left + x * scale, x1 = left + (x + 1) * scale, y0 = y * scale, y1 = Math.min(image.height, (y + 1) * scale), sum = [0, 0, 0, 0];
    let area = 0;
    for (let j = Math.floor(y0); j < Math.ceil(y1); j += 1) for (let i = Math.floor(x0); i < Math.ceil(x1); i += 1) {
      const weight = (Math.min(i + 1, x1) - Math.max(i, x0)) * (Math.min(j + 1, y1) - Math.max(j, y0)), from = (j * image.width + i) * 4;
      for (let c = 0; c < 4; c += 1) sum[c] += image.pixels[from + c] * weight;
      area += weight;
    }
    for (let c = 0; c < 4; c += 1) pixels[(y * width + x) * 4 + c] = Math.round(sum[c] / area);
  }
  return { width, height, pixels };
}
function grid(images, columns, gap = 6) {
  const cellW = Math.max(...images.map((image) => image.width)), cellH = Math.max(...images.map((image) => image.height));
  const rows = Math.ceil(images.length / columns), width = columns * cellW + (columns + 1) * gap, height = rows * cellH + (rows + 1) * gap;
  const pixels = Buffer.alloc(width * height * 4, 0x30);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  images.forEach((image, n) => {
    const ox = gap + (n % columns) * (cellW + gap), oy = gap + Math.floor(n / columns) * (cellH + gap);
    for (let y = 0; y < image.height; y += 1) image.pixels.copy(pixels, ((oy + y) * width + ox) * 4, y * image.width * 4, (y + 1) * image.width * 4);
  });
  return { width, height, pixels };
}

const pixelAt = (image, x, y) => { const i = (y * image.width + x) * 4; return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]]; };

module.exports = { read, write, crop, enlarge, beside, shrink, grid, pixelAt, fit };

// node tools/png.js crop <in> <out> x y w h [factor]
// node tools/png.js beside <a> <b> <out> x y w h [factor]   (same region of both)
if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'crop') {
    const [input, output, x, y, w, h, factor = 1] = rest;
    write(output, enlarge(crop(read(input), +x, +y, +w, +h), +factor));
  } else if (command === 'beside') {
    const [a, b, output, x, y, w, h, factor = 1] = rest;
    write(output, beside(enlarge(crop(read(a), +x, +y, +w, +h), +factor), enlarge(crop(read(b), +x, +y, +w, +h), +factor)));
  } else if (command === 'at') {
    const [input, x, y] = rest;
    process.stdout.write(`${pixelAt(read(input), +x, +y).join(',')}\n`);
  } else {
    process.stderr.write('usage: png.js crop|beside|at …\n');
    process.exitCode = 1;
  }
}
