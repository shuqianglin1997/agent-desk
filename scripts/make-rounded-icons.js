#!/usr/bin/env node
/*
 * 生成带真圆角的应用图标：和原来那张是同一只猫、同一个底色。
 *
 * 为什么要圆角版：
 *   Windows 不会替应用裁圆角，方图在任务栏和桌面上就是一个直角方块。
 *   macOS 11 到 15 也不会：方图在程序坞里是一个比别人大一圈的直角方块。macOS 26 起系统才自己处理图标的外形。
 * 做法：
 *   Windows 用 assets/icon.ico：整张铺满，四角透明。
 *   macOS 用 assets/icon.icns：按苹果从 macOS 11 起沿用的图标格子画——圆角方块占画布的 824/1024，四周留白，带一点投影。
 *   另出 assets/icon-rounded.png（铺满、圆角、透明），给网页和商店用。assets/icon.png 仍是方形原图。
 *
 * 不依赖任何第三方库：像素直接算出来，PNG 和 ICO 自己写；icns 用系统自带的 iconutil 打包（只在 macOS 上生成）。
 * 用法：node scripts/make-rounded-icons.js [--out 目录]
 */
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const { YardSprites } = require(path.join(ROOT, 'src', 'yard', 'sprites.js'));

const GRID = 20;                       // 和 make-icons.py 一样的 20×20 底稿，猫四周各留两格
const BACKGROUND = [0xf6, 0xf0, 0xd7];
const RADIUS = 0.2237;                 // 圆角半径占边长的比例，和 macOS 的图标轮廓接近
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const MAC_BODY = 824 / 1024;           // 苹果的图标格子：圆角方块占画布的比例
const MAC_RADIUS = 185.4 / 824;        // 圆角半径占方块边长的比例
const MAC_ICONSET = [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'], [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512'], [1024, 'icon_512x512@2x']];

function master() {
  const cells = Array.from({ length: GRID * GRID }, () => BACKGROUND);
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y) {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
      const hex = this.fillStyle.replace('#', '');
      cells[y * GRID + x] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
    }
  };
  YardSprites.drawCat(ctx, YardSprites.SIT, YardSprites.BREEDS.orange, { dx: 2, dy: 2, scale: 1 });
  return cells;
}

// 这个像素有多少落在圆角矩形里：每个像素取 4×4 个点，边缘因此是平滑的
function coverage(px, py, size) {
  const r = RADIUS * size;
  let inside = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const x = px + (sx + 0.5) / 4, y = py + (sy + 0.5) / 4;
      const cx = Math.max(r, Math.min(size - r, x)), cy = Math.max(r, Math.min(size - r, y));
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) inside += 1;
    }
  }
  return inside / 16;
}

function render(cells, size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = cells[Math.min(GRID - 1, Math.floor(y * GRID / size)) * GRID + Math.min(GRID - 1, Math.floor(x * GRID / size))];
      const at = (y * size + x) * 4;
      rgba[at] = cell[0]; rgba[at + 1] = cell[1]; rgba[at + 2] = cell[2];
      rgba[at + 3] = Math.round(coverage(x, y, size) * 255);
    }
  }
  return rgba;
}

// 到圆角方块边缘的距离：里面是负的，外面是正的
function distance(x, y, size, body, radius) {
  const half = body / 2, qx = Math.abs(x - size / 2) - (half - radius), qy = Math.abs(y - size / 2) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

// macOS 的画法：圆角方块居中、四周留白，下面一点柔和的投影
function renderMac(cells, size) {
  const body = size * MAC_BODY, offset = (size - body) / 2, radius = MAC_RADIUS * body, blur = size * 0.022, drop = size * 0.012;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) if (distance(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4, size, body, radius) <= 0) inside += 1;
      const cover = inside / 16;
      const far = distance(x + 0.5, y + 0.5 - drop, size, body, radius), fade = Math.max(0, Math.min(1, far / blur));
      const shadow = 0.3 * (1 - fade * fade * (3 - 2 * fade));
      const cx = Math.max(0, Math.min(GRID - 1, Math.floor((x + 0.5 - offset) * GRID / body))), cy = Math.max(0, Math.min(GRID - 1, Math.floor((y + 0.5 - offset) * GRID / body)));
      const cell = cells[cy * GRID + cx], alpha = cover + (1 - cover) * shadow, at = (y * size + x) * 4;
      if (alpha <= 0) continue;
      for (let k = 0; k < 3; k += 1) rgba[at + k] = Math.round(cell[k] * cover / alpha);
      rgba[at + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function png(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;      // 8 位、带透明度的真彩色
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ICO：一个目录加若干张 PNG。256 那一张在目录里的宽高写 0。
function ico(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, data }, index) => {
    const at = 6 + index * 16;
    directory[at] = size >= 256 ? 0 : size; directory[at + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8); directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

function build() {
  const cells = master();
  return {
    ico: ico(ICO_SIZES.map((size) => ({ size, data: png(render(cells, size), size) }))),
    rounded: png(render(cells, 1024), 1024),
    iconset: MAC_ICONSET.map(([size, name]) => ({ name: name + '.png', size, data: png(renderMac(cells, size), size) }))
  };
}

// icns 交给系统自带的 iconutil 打包；不在 macOS 上就跳过，保留仓库里已有的那份
function writeIcns(iconset, target) {
  if (process.platform !== 'darwin') return false;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-icon-')), set = path.join(folder, 'icon.iconset');
  try {
    fs.mkdirSync(set);
    iconset.forEach((image) => fs.writeFileSync(path.join(set, image.name), image.data));
    childProcess.execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', target, set]);
    return true;
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

if (require.main === module) {
  const at = process.argv.indexOf('--out'), outDir = at > 0 ? path.resolve(process.argv[at + 1]) : ASSETS;
  const out = build();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.ico'), out.ico);
  fs.writeFileSync(path.join(outDir, 'icon-rounded.png'), out.rounded);
  const mac = writeIcns(out.iconset, path.join(outDir, 'icon.icns'));
  process.stdout.write(`icon.ico ${out.ico.length} bytes, icon-rounded.png ${out.rounded.length} bytes, icon.icns ${mac ? 'written' : 'skipped (not macOS)'} -> ${outDir}\n`);
}

module.exports = { build, render, renderMac, coverage, distance, master, ICO_SIZES, MAC_ICONSET, MAC_BODY, RADIUS, GRID };
