const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const icon = require('../scripts/make-rounded-icons.js');

const root = path.join(__dirname, '..');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function entries(ico) {
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, '必须是图标而不是光标');
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const at = 6 + index * 16;
    return { size: ico[at] || 256, bits: ico.readUInt16LE(at + 6), length: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });
}

test('Windows 图标四角是真的圆角：角上透明，中间不透明，猫没有被切到', () => {
  const cells = icon.master();
  for (const size of [16, 48, 256]) {
    const rgba = icon.render(cells, size);
    const alpha = (x, y) => rgba[(y * size + x) * 4 + 3];
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) assert.equal(alpha(x, y), 0, `${size}px 的角应当透明`);
    assert.equal(alpha(size >> 1, size >> 1), 255);
    assert.equal(alpha(size >> 1, 0), 255, '四条边的中段不应被裁掉');
  }
  const rgba = icon.render(cells, 256);
  let clipped = 0;
  for (let i = 0; i < 256 * 256; i += 1) {
    const background = rgba[i * 4] === 0xf6 && rgba[i * 4 + 1] === 0xf0 && rgba[i * 4 + 2] === 0xd7;
    if (!background && rgba[i * 4 + 3] < 255) clipped += 1;
  }
  assert.equal(clipped, 0, '圆角不能切到猫');
});

test('生成的 ico 含全部尺寸，每一张都是带透明度的 PNG；随仓库的那份与生成器一致', () => {
  const built = icon.build();
  for (const ico of [built.ico, fs.readFileSync(path.join(root, 'assets', 'icon.ico'))]) {
    const list = entries(ico);
    assert.deepEqual(list.map((entry) => entry.size), icon.ICO_SIZES);
    for (const entry of list) {
      assert.equal(entry.bits, 32);
      const data = ico.subarray(entry.offset, entry.offset + entry.length);
      assert.ok(data.subarray(0, 8).equals(PNG), `${entry.size}px 不是 PNG`);
      assert.equal(data.readUInt32BE(16), entry.size);
      assert.equal(data[25], 6, '必须带透明通道');
    }
  }
  assert.ok(built.rounded.subarray(0, 8).equals(PNG));
  assert.equal(built.rounded.readUInt32BE(16), 1024);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  assert.equal(pkg.build.mac.icon, 'assets/icon.icns');
});

test('macOS 图标按苹果的图标格子画：圆角方块居中、四周留白，新旧系统用同一份', () => {
  const cells = icon.master();
  for (const size of [32, 128, 1024]) {
    const rgba = icon.renderMac(cells, size);
    const alpha = (x, y) => rgba[(y * size + x) * 4 + 3];
    const inset = Math.round(size * (1 - icon.MAC_BODY) / 2), mid = size >> 1;
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [mid, 0], [0, mid]]) assert.equal(alpha(x, y), 0, `${size}px 的画布边缘应当透明`);
    assert.equal(alpha(mid, mid), 255);
    assert.equal(alpha(mid, inset + 1), 255, '方块上边的中段是实的');
    assert.ok(alpha(inset + 1, inset + 1) < 255, '方块的角是圆的');
    assert.ok(alpha(mid, Math.max(0, inset - 2)) < 255, '方块以外不是实的');
  }
  // 方块里的猫和铺满版是同一张底稿：每一格猫的四个角都落在圆角方块里面，没有被圆角切到
  const size = 1024, body = size * icon.MAC_BODY, offset = (size - body) / 2, radius = body * 185.4 / 824, step = body / icon.GRID;
  let clipped = 0;
  cells.forEach((cell, index) => {
    if (cell[0] === 0xf6 && cell[1] === 0xf0 && cell[2] === 0xd7) return;
    const x = offset + (index % icon.GRID) * step, y = offset + Math.floor(index / icon.GRID) * step;
    for (const [px, py] of [[x, y], [x + step, y], [x, y + step], [x + step, y + step]]) if (icon.distance(px, py, size, body, radius) > 0) clipped += 1;
  });
  assert.equal(clipped, 0, '圆角不能切到猫');
  const built = icon.build();
  assert.deepEqual(built.iconset.map((image) => image.name), icon.MAC_ICONSET.map(([, name]) => name + '.png'));
  for (const image of built.iconset) assert.equal(image.data.readUInt32BE(16), image.size);
  // 随仓库的那份 icns：含 1024 那一张，而且它的四角是透明的（不是旧的方形铺满版）
  const icns = fs.readFileSync(path.join(root, 'assets', 'icon.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  let at = 8, large = null;
  while (at < icns.length) { const type = icns.toString('ascii', at, at + 4), length = icns.readUInt32BE(at + 4); if (type === 'ic10') large = icns.subarray(at + 8, at + length); at += length; }
  assert.ok(large && large.subarray(0, 8).equals(PNG), 'icns 里应当有 1024 的 PNG');
  assert.equal(large.readUInt32BE(16), 1024);
  assert.equal(large[25], 6, '必须带透明通道');
});
