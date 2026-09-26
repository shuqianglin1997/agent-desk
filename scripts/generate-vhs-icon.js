// Original pixel artwork. Integer rectangles preserve crisp edges at Dock sizes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 512;
const pixels = Buffer.alloc(size * size * 4);
function rect(x, y, w, h, hex) {
  const color = Buffer.from(hex.replace('#', '') + 'ff', 'hex');
  for (let py = y * 4; py < (y + h) * 4; py++) {
    for (let px = x * 4; px < (x + w) * 4; px++) color.copy(pixels, (py * size + px) * 4);
  }
}
rect(16, 8, 96, 112, '#09051c');
rect(8, 16, 112, 96, '#09051c');
rect(12, 12, 104, 104, '#09051c');
// One cassette silhouette, two reels and one label; readable at small Dock sizes.
rect(24, 36, 80, 56, '#00eaff');
rect(28, 40, 72, 48, '#09051c');
for (const x of [36, 72]) {
  rect(x, 48, 20, 20, '#00eaff');
  rect(x + 4, 52, 12, 12, '#09051c');
}
rect(44, 76, 40, 4, '#ff2cbd');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const scanlines = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) pixels.copy(scanlines, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon-vhs.png'), Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
]));
