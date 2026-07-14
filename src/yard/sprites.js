/*
 * AgentDesk — 像素猫资产（庭院视图）。
 *
 * 三个姿势底图 + 8 套毛色调色板 + 分层合成（花纹/项圈/吊牌/配饰）。
 * 字符含义：. 透明  o 轮廓  f 毛色  w 浅色  p 耳内粉  n 鼻  e 眼  c 项圈  - 闭眼
 * 全部程序化绘制，零外部图片；后续可整体替换为手绘 atlas。
 */
(function (root) {
  'use strict';

  const SIT = [
    '..oo........oo..',
    '.offo......offo.',
    '.ofpfo....ofpfo.',
    '.offffooooffffo.',
    '.offffffffffffo.',
    '.offeffffffeffo.',
    '.offfffnnffffffo',
    '.offffwwwwffffo.',
    '..offffffffffo..',
    '..occcccccccco..',
    '.offffffffffffo.',
    '.offfwwwwwwfffo.',
    '.offfwwwwwwfffo.',
    '.offfwwwwwwfffo.',
    '.offwwffffwwffo.',
    '.oooooooooooooo.'
  ];
  const LOAF = [
    '.oo...oo............',
    '.ofo..ofo...........',
    '.ofpo.ofpo..........',
    '.offfffffoooooooooo.',
    '.ofeffffffffffffffo.',
    '.offffffffffffffffo.',
    '.owfffffffffffffffo.',
    '.offfffffffffffffoo.',
    '..offwwwwwwwwwwfffo.',
    '..oooooooooooooooo..'
  ];
  const SLEEP = [
    '....oooooo..oo..',
    '..ooffffffooffo.',
    '.offffffffffffo.',
    '.offffffffff-fo.',
    '.offffffffffffo.',
    '.offffffffffffo.',
    '..ofwwwwwwwwfo..',
    '...oooooooooo...'
  ];

  const BREEDS = {
    orange:  { label: '橘猫', f: '#e8944a', w: '#f6e2bd', o: '#57351f', patch: null },
    calico:  { label: '三花', f: '#f0e8d4', w: '#faf5e6', o: '#57351f', patch: 'calico' },
    cow:     { label: '奶牛', f: '#f0ede4', w: '#ffffff', o: '#3a3a42', patch: 'cow' },
    black:   { label: '黑猫', f: '#454b58', w: '#5d6472', o: '#23272f', patch: null },
    white:   { label: '白猫', f: '#f2ecdc', w: '#fdfaf0', o: '#8d8474', patch: null },
    tabby:   { label: '狸花', f: '#a5834f', w: '#dcc9a2', o: '#4f3a20', patch: 'tabby' },
    blue:    { label: '蓝灰', f: '#8b98ae', w: '#bcc6d6', o: '#3e4658', patch: null },
    siamese: { label: '暹罗', f: '#e9dcc0', w: '#f6efe0', o: '#54412e', patch: 'siamese' }
  };

  const APP_TAG = { claude: '#d96f33', codex: '#2f9e8f' };

  const hash = (x, y, s) => ((x * 31 + y * 17 + s * 7) % 12 + 12) % 12;

  /*
   * 在 ctx 上画一只猫。
   * opts: { dx, dy, scale, seed, blink, collar, bell, tag('claude'|'codex'), accessory, flip, tail }
   */
  function drawCat(ctx, map, pal, opts) {
    const o = opts || {};
    const s = o.scale || 1;
    const seed = o.seed || 0;
    const W = map[0].length;
    const H = map.length;
    const horiz = W > H; // 侧卧姿势：花纹避开脸部
    const px = (x, y, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(o.dx + (o.flip ? W - 1 - x : x) * s, o.dy + y * s, s, s);
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = map[y][x];
        if (ch === '.') continue;
        let c = null;
        if (ch === 'o' || ch === '-') c = pal.o;
        else if (ch === 'f') {
          c = pal.f;
          if (pal.patch === 'cow' && hash(x >> 2, y >> 2, seed) < 4) c = '#3a3a42';
          else if (pal.patch === 'calico') {
            const h = hash(x >> 2, y >> 2, seed + 3);
            if (h < 3) c = '#e8944a';
            else if (h < 5) c = '#4a4f5a';
          } else if (pal.patch === 'tabby' && (horiz ? x >= 10 : (y <= 2 || y >= 8)) && (x % 4 === 0 || (x + 2) % 7 === 0)) {
            c = '#7a5c34';
          } else if (pal.patch === 'siamese' && (y < 3 || y >= H - 2)) {
            c = '#6b5442';
          }
        } else if (ch === 'w') c = pal.w;
        else if (ch === 'p') c = '#e8a0a0';
        else if (ch === 'n') c = '#d97a7a';
        else if (ch === 'e') c = o.blink ? pal.f : '#2b2018';
        else if (ch === 'c') c = o.collar || '#c94f2e';
        if (c) px(x, y, c);
      }
    }

    if (map === SIT) {
      if (o.bell) { px(7, 10, '#e8c04a'); px(8, 10, '#e8c04a'); }
      else if (o.tag && APP_TAG[o.tag]) { px(7, 10, APP_TAG[o.tag]); }
      if (o.accessory === 'scarf') {
        for (let x = 3; x <= 12; x++) px(x, 9, o.collar || '#c94f2e');
        px(4, 10, o.collar || '#c94f2e'); px(4, 11, o.collar || '#c94f2e');
      }
      if (o.accessory === 'glasses') {
        [3, 4, 5, 10, 11, 12].forEach((x) => px(x, 5, '#2b2018'));
        px(7, 5, '#2b2018'); px(8, 5, '#2b2018');
      }
      if (o.accessory === 'bow') {
        px(6, 10, '#d05a7a'); px(7, 10, '#f0a0b8'); px(8, 10, '#f0a0b8'); px(9, 10, '#d05a7a');
        px(6, 11, '#d05a7a'); px(9, 11, '#d05a7a');
      }
      if (o.accessory === 'hat') {
        for (let x = 2; x <= 13; x++) px(x, 1, '#d9b45a');
        for (let x = 4; x <= 11; x++) { px(x, 0, '#c9a24a'); px(x, -1, '#d9b45a'); }
      }
    }
    if (map === LOAF && o.tail) px(17, 6, pal.f);
  }

  root.YardSprites = { SIT, LOAF, SLEEP, BREEDS, APP_TAG, drawCat };
})(typeof self !== 'undefined' ? self : this);
