#!/usr/bin/env node
'use strict';

// The covers at the size they are first seen, side by side on one sheet, to look at before posting:
// can the two lines still be read, can the cats still be told apart?
//
//   node media/launch-video/tools/thumbs.js [out.png]        (default out/covers-as-seen.png)
//
// Widths are what the places show: 小红书 a third of a phone's width; B 站's list about 320px, and its 4:3 crop of
// the middle; YouTube's list on a phone about 170px; 公众号 about 100px high, and the square it is cropped to when
// shared; the picture a link to the repository shows, about 400px wide. One that has not been rendered is left out.

const fs = require('node:fs');
const path = require('node:path');
const png = require('./png.js');
const { FORMATS, SOCIAL } = require('../film/poster.js');

const OUT = path.join(__dirname, '..', 'out');
// [cover, language, width it is seen at, cropped to its safe middle first]
const SEEN = [['xiaohongshu', 'zh', 360, false], ['bilibili', 'zh', 320, false], ['bilibili', 'zh', 240, true], ['youtube', 'en', 170, false],
  ['wechat', 'zh', 235, false], ['wechat', 'zh', 100, true], ['wechat-square', 'zh', 100, false]];

const shown = [];
for (const [name, lang, width, cropped] of SEEN) {
  const spec = FORMATS[name], file = path.join(OUT, `${spec.file(lang)}.png`);
  if (!fs.existsSync(file)) continue;
  const small = png.fit(png.read(file), width, cropped ? spec.safe : null);
  shown.push(small);
  process.stdout.write(`${spec.file(lang)}.png${cropped ? ` cropped to ${spec.safe[0]}…${spec.safe[1]}` : ''} → ${small.width}×${small.height}\n`);
}
// The picture a link to the repository shows: about 400px wide in a card.
const socialFile = path.join(OUT, `${SOCIAL.file}.png`);
if (fs.existsSync(socialFile)) { const small = png.fit(png.read(socialFile), 400); shown.push(small); process.stdout.write(`${SOCIAL.file}.png → ${small.width}×${small.height}\n`); }
const target = path.resolve(process.argv[2] || path.join(OUT, 'covers-as-seen.png'));
// One row, each at its own size, on the grey of a contact sheet.
const gap = 12, width = shown.reduce((sum, image) => sum + image.width + gap, gap), height = Math.max(...shown.map((image) => image.height)) + gap * 2;
const sheet = { width, height, pixels: Buffer.alloc(width * height * 4, 0x30) };
for (let i = 3; i < sheet.pixels.length; i += 4) sheet.pixels[i] = 255;
let x = gap;
for (const image of shown) {
  for (let y = 0; y < image.height; y += 1) image.pixels.copy(sheet.pixels, ((gap + y) * width + x) * 4, y * image.width * 4, (y + 1) * image.width * 4);
  x += image.width + gap;
}
png.write(target, sheet);
process.stdout.write(`${target}\n`);
