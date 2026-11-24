/*
 * AgentDesk — 8×8 像素图标。
 *
 * 位图是唯一来源：浏览器里启动时把每个图标生成成一条 CSS 蒙版变量，
 * 任何 <i class="pxi" data-i="名字"> 或在样式里引用 var(--pxi-名字) 的元素都跟随文字颜色。
 * 和猫一样零外部图片。UMD：Node 里可以 require 做单测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PixelIcons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ICONS = {
    plus: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
    device: ['########', '#......#', '#......#', '#......#', '########', '...##...', '..####..', '........'],
    tool: ['..####..', '..#..#..', '########', '#......#', '###..###', '#......#', '########', '........'],
    inbox: ['........', '#......#', '#......#', '##....##', '#.####.#', '#......#', '########', '........'],
    gear: ['.#.##.#.', '########', '.##..##.', '##....##', '##....##', '.##..##.', '########', '.#.##.#.'],
    play: ['.#......', '.###....', '.#####..', '.#######', '.#####..', '.###....', '.#......', '........'],
    copy: ['...#####', '...#...#', '#####..#', '#...#..#', '#...####', '#...#...', '#####...', '........'],
    folder: ['.###....', '#####...', '########', '#......#', '#......#', '#......#', '########', '........'],
    box: ['...##...', '..####..', '.######.', '...##...', '#..##..#', '#......#', '########', '........'],
    send: ['...#....', '...##...', '#######.', '########', '#######.', '...##...', '...#....', '........'],
    search: ['.####...', '#....#..', '#....#..', '#....#..', '.####...', '....###.', '.....###', '......#.'],
    pin: ['..####..', '.##..##.', '.#....#.', '.##..##.', '..####..', '...##...', '...##...', '........'],
    check: ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'],
    caret: ['........', '........', '########', '.######.', '..####..', '...##...', '........', '........'],
    x: ['##....##', '.##..##.', '..####..', '...##...', '..####..', '.##..##.', '##....##', '........'],
    key: ['.###....', '#...#...', '#...####', '#...#.#.', '.###..#.', '........', '........', '........'],
    cloud: ['........', '..###...', '.#...##.', '#......#', '#......#', '.######.', '........', '........'],
    q: ['.####...', '#....#..', '....#...', '...#....', '...#....', '........', '...#....', '........'],
    dots: ['........', '........', '........', '##.##.##', '##.##.##', '........', '........', '........'],
    dl: ['...##...', '...##...', '...##...', '.######.', '..####..', '...##...', '........', '########'],
    ban: ['..####..', '.#...##.', '#...##.#', '#..##..#', '#.##...#', '.##...#.', '..####..', '........'],
    bang: ['...##...', '...##...', '...##...', '...##...', '...##...', '........', '...##...', '...##...'],
    refresh: ['..####..', '.#....#.', '#.....##', '#....###', '#.......', '.#....#.', '..####..', '........'],
    swap: ['..#.....', '.##.....', '#######.', '........', '.#######', '.....##.', '.....#..', '........'],
    sound: ['...#....', '..##.#..', '####..#.', '####.#.#', '####.#.#', '####..#.', '..##.#..', '...#....'],
    mute: ['...#....', '..##....', '####.#.#', '####..#.', '####.#.#', '####....', '..##....', '...#....']
  };

  const names = Object.keys(ICONS);

  function rects(name) {
    const map = ICONS[name];
    if (!map) return '';
    let out = '';
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (map[y][x] === '#') out += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
    return out;
  }

  function svg(name, size = 16, fill = 'currentColor') {
    if (!ICONS[name]) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" fill="${fill}" aria-hidden="true">${rects(name)}</svg>`;
  }

  function dataUri(name) {
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg(name, 8, '#000'))}")`;
  }

  // 溶解条：有序抖动（4×4 拜耳矩阵，2px 一格），64px 里从实到空。名册两头拿它当蒙版，
  // 卡片滑出去时一格一格化进桌面，而不是被一刀切掉。toward 是“空”的那一头：end 在右，start 在左。
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const DISSOLVE_STEPS = 32;
  function dissolveCells(toward) {
    return BAYER.map((thresholds) => {
      const row = new Array(DISSOLVE_STEPS);
      for (let step = 0; step < DISSOLVE_STEPS; step += 1) {
        const solid = 1 - (step + 0.5) / DISSOLVE_STEPS > (thresholds[step % 4] + 0.5) / 16;
        row[toward === 'start' ? DISSOLVE_STEPS - 1 - step : step] = solid;
      }
      return row;
    });
  }

  function dissolveUri(toward) {
    let cells = '';
    dissolveCells(toward).forEach((row, y) => row.forEach((solid, x) => {
      if (solid) cells += `<rect x="${x * 2}" y="${y * 2}" width="2" height="2"/>`;
    }));
    const image = `<svg xmlns="http://www.w3.org/2000/svg" width="${DISSOLVE_STEPS * 2}" height="8" shape-rendering="crispEdges">${cells}</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(image)}")`;
  }

  // 生成一份样式：--pxi-名字 变量、.pxi[data-i] 到变量的映射，以及两条溶解蒙版。
  function stylesheet() {
    const vars = names.map((name) => `--pxi-${name}:${dataUri(name)}`)
      .concat([`--px-dissolve-start:${dissolveUri('start')}`, `--px-dissolve-end:${dissolveUri('end')}`]).join(';');
    const rules = names.map((name) => `[data-i="${name}"]{--pxi:var(--pxi-${name})}`).join('');
    return `:root{${vars}}${rules}`;
  }

  function install(doc) {
    if (!doc || doc.getElementById('pixelIconStyles')) return;
    const style = doc.createElement('style');
    style.id = 'pixelIconStyles';
    style.textContent = stylesheet();
    doc.head.append(style);
  }

  if (typeof document !== 'undefined') install(document);

  return { ICONS, names, svg, dataUri, dissolveCells, stylesheet, install };
});
