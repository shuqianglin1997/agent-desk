/*
 * 像素猫 第二版：同一只猫，更多的动作。
 *
 * 画布是 20×18 格（应用里一格 4 像素，80×72）。所有姿势共用同一个头，所以不管它在干什么都是同一只猫。
 * 字符：. 透明  o 轮廓  f 毛色  w 浅色（口鼻、肚子）  s 爪子（默认浅色）  t 重点色（耳朵、尾尖）
 *       a b 两块花斑  m 条纹  p 耳内  n 鼻  e 眼  c 项圈
 *       A B x 眼睛四周的一圈：平时就是花斑或毛色，只有带眼圈的毛色（熊猫）才单独上色
 * 花斑和条纹是画在每个姿势里的，不是按坐标算出来的，所以猫动的时候花纹跟着身体走，不会闪。
 * 动作是一串帧；每帧 = 姿势 + 位移（整格）+ 眼睛 + 尾巴 + 道具。没有缩放，没有旋转。
 *
 * AgentDesk 里的这份与所有者批准的图鉴（test/fixtures/cats2-approved.source）只差三处，像素一格没动：
 * 1. 全局名是 CatArt。
 * 2. frame() 可以在格子上方多留几行透明的空（options.headroom）。原来 20×18 的格子里，跳到最高
 *    （跳一下、好了）和赶来的第二步，头顶在第 0 或第 1 行，草帽、贝雷帽、斗笠的上沿会被格子切掉。
 *    多留两行就都画得下；不留时（默认）结果和批准的那份逐格相同，测试守着这一点。
 * 3. draw() 按传进来的格子画，不再假定只有 18 行；另外导出 colour() 给测试核对每个字符都有颜色。
 * 毛色数据另有两处按要求改过：“跟着客户端”一组的色值按各家官方资料校正；其中四种因品牌规定不许这样用而拿掉。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 20, H = 18;
  const blank = () => '.'.repeat(W);

  const HEAD = [
    '....oo........oo....',
    '...otto......otto...',
    '...otpto....otpto...',
    '...oaafmoooomfbbo...',
    '...oaAAffffffxBbo...',
    '...oaAeffffffeBbo...',
    '...oaxxffnnffxxfo...',
    '...offffwwwwffffo...',
    '....offffffffffo....'
  ];
  const SIT_BODY = [
    '....occcccccccco....',
    '...ofmfffffffmbbo...',
    '...oaffwwwwwwfbbo...',
    '...oaafwwwwwwffmo...',
    '...oaafwwwwwwfffo...',
    '...offssffffssffo...',
    '...oooooooooooooo...'
  ];
  const LOAF_BODY = [
    '..oofccccccccccfoo..',
    '.oaafmwwwwwwwwmfbbo.',
    '.oafssffffffffssfbo.',
    '.oooooooooooooooooo.'
  ];
  const WALK_BODY = [
    '....occcccccccco....',
    '...ofmfffffffmbbo...',
    '...oaffwwwwwwfbbo...',
    '...oaafoooooofffo...'
  ];
  const LEGS = {
    both:  ['...offo......offo...', '...osso......osso...', '...oooo......oooo...'],
    left:  ['...offo......osso...', '...osso......oooo...', '...oooo.............'],
    right: ['...osso......offo...', '...oooo......osso...', '.............oooo...']
  };
  const SLEEP_ROWS = [
    '....oo........oo....',
    '...otto......otto...',
    '...otpto....otpto...',
    '...oaafmoooomfbbo...',
    '.oooaAAffffffxBbooo.',
    'oaaoaA-ffffff-Bbobbo',
    'oafoaxxffnnffxxfoffo',
    'offoffffwwwwffffoffo',
    'offfoffffffffffofffo',
    'offfsssffffffsssfffo',
    '.oooooooooooooooooo.'
  ];
  const FLAT_ROWS = [
    '....oo........oo....',
    '...otto......otto...',
    'ooooaAxmffffmxBboooo',
    'ossfaA-ffnnff-Bbfsso',
    'offffxxffwwffxxffffo',
    'oooooooooooooooooooo'
  ];

  const place = (rows, top) => { const out = Array.from({ length: H }, blank); rows.forEach((row, i) => { if (top + i >= 0 && top + i < H) out[top + i] = row; }); return out; };
  // 每个姿势：格子、头顶在第几行（配饰和眼睛跟着它）、项圈在第几行（没有就是 -1）、能不能换眼睛
  const POSES = {
    sit:    { rows: place(HEAD.concat(SIT_BODY), 2), head: 2, collar: 11, eyes: true, tail: true },
    crouch: { rows: place(HEAD.concat([SIT_BODY[0], SIT_BODY[1], SIT_BODY[2], SIT_BODY[5], SIT_BODY[6]]), 4), head: 4, collar: 13, eyes: true, tail: true },
    leap:   { rows: place(HEAD.concat([SIT_BODY[0], SIT_BODY[1], SIT_BODY[2], SIT_BODY[2], '...oaafoooooofffo...'], LEGS.both), 1), head: 1, collar: 10, eyes: true },
    loaf:   { rows: place(HEAD.concat(LOAF_BODY), 5), head: 5, collar: 14, eyes: true },
    walkA:  { rows: place(HEAD.concat(WALK_BODY, LEGS.left), 2), head: 2, collar: 11, eyes: true },
    walkB:  { rows: place(HEAD.concat(WALK_BODY, LEGS.right), 1), head: 1, collar: 10, eyes: true },
    sleep:  { rows: place(SLEEP_ROWS, 7), head: 7, collar: -1, eyes: false },
    flat:   { rows: place(FLAT_ROWS, 12), head: 12, collar: -1, eyes: false }
  };

  /* ── 往格子上贴小块 ───────────────────────────────── */
  const put = (grid, x, y, ch) => { if (y >= 0 && y < grid.length && x >= 0 && x < W && ch !== ' ') grid[y] = grid[y].slice(0, x) + ch + grid[y].slice(x + 1); };
  const stamp = (grid, x, y, rows) => rows.forEach((row, j) => [...row].forEach((ch, i) => put(grid, x + i, y + j, ch)));

  const EYES = {
    open: () => {},
    closed: (g, r) => { stamp(g, 5, r, ['--']); stamp(g, 13, r, ['--']); },
    happy: (g, r) => { stamp(g, 5, r - 1, [' - ', '-x-']); stamp(g, 12, r - 1, [' - ', '-x-']); },
    wide: (g, r) => { stamp(g, 5, r - 1, ['WW', 'We']); stamp(g, 13, r - 1, ['WW', 'eW']); }
  };
  const TAIL = [
    (g, top = 0) => { stamp(g, 17, 15 + top, ['oo ', 'fto', 'ooo']); },                 // 贴着身体
    (g, top = 0) => { stamp(g, 17, 14 + top, [' o ', 'oto', 'ffo', 'ooo']); },          // 尾尖翘起来
    (g, top = 0) => { stamp(g, 17, 13 + top, [' oo', 'oto', 'ofo', 'ffo', 'ooo']); }    // 翘得更高
  ];
  const PROPS = {
    z1: ['zzz', ' z ', 'zzz'],
    z2: ['zzzz', '  z ', ' z  ', 'zzzz'],
    ask: ['qq ', '  q', ' q ', '   ', ' q '],
    bang: ['y', 'y', 'y', ' ', 'y'],
    spark: [' y ', 'yyy', ' y '],
    heart: ['r r', 'rrr', ' r '],
    sweat: [' u', 'uu', 'uu'],
    ball: [' kk ', 'krrk', 'krrk', ' kk '],
    laptop: ['kkkkkkkkkk', 'kggggggggk', 'kgggllgggk', 'kkkkkkkkkk'],
    fuzz: ['o', ' ', 'o', ' ', 'o']
  };
  // 配饰：贴在头上（相对头顶那一行）或项圈上（相对项圈那一行）
  const ACCESSORIES = {
    none: { label: '不戴' },
    scarf: { label: '围巾', on: 'collar', at: [3, 0], rows: ['occcccccccccco', ' cc', ' cc'] },
    bow: { label: '蝴蝶结', on: 'collar', at: [7, 0], rows: ['RrrrrR', 'R    R'] },
    tie: { label: '领带', on: 'collar', at: [9, 0], rows: ['rr', 'rr', 'rr', 'rr'] },
    bell: { label: '铃铛', on: 'collar', at: [9, 0], rows: ['GG', 'GG'] },
    glasses: { label: '眼镜', on: 'head', at: [5, 5], rows: ['k kkkkkk k'] },
    shades: { label: '墨镜', on: 'head', at: [5, 5], rows: ['kkkkkkkkkk', 'kkk    kkk'] },
    straw: { label: '草帽', on: 'head', at: [3, -1], rows: ['   yyyyyyyy   ', '   yYYYYYYy   ', 'yyyyyyyyyyyyyy'] },
    beret: { label: '贝雷帽', on: 'head', at: [5, -1], rows: ['    k     ', ' rrrrrrrr ', 'rrrrrrrrrr'] },
    bamboo: { label: '斗笠', on: 'head', at: [2, -2], rows: ['      yyyy      ', '    yyYYYYyy    ', '  yyYYyyyyYYyy  ', 'yyyyyyyyyyyyyyyy'] },
    phones: { label: '耳机', on: 'head', at: [2, 2], rows: ['     kkkkkk     ', '                ', 'kk            kk', 'kk            kk', 'kk            kk'] },
    flower: { label: '小花', on: 'head', at: [2, 0], rows: [' W ', 'WyW', ' W '] }
  };

  /* ── 一帧 ─────────────────────────────────────────── */
  // spec: { pose, dx, dy, eyes, tail, props: [[name, x, y]], hide }
  // options.headroom：格子上方多留几行（默认 0）。返回的格子有 H + headroom 行，猫的脚仍在最后一行。
  function frame(spec, look, options) {
    const top = Math.max(0, Math.floor((options && options.headroom) || 0));
    const pose = POSES[spec.pose];
    let grid = Array.from({ length: top }, blank).concat(pose.rows);
    const rows = grid.length, head = pose.head + top, collar = pose.collar >= 0 ? pose.collar + top : -1;
    if (pose.eyes && spec.eyes && EYES[spec.eyes]) EYES[spec.eyes](grid, head + 5);
    if (pose.tail && spec.tail !== undefined) TAIL[spec.tail](grid, top);
    const acc = look && ACCESSORIES[look.accessory];
    if (acc && acc.rows) {
      const anchor = acc.on === 'head' ? head : collar;
      if (anchor >= 0 && !(acc.on === 'head' && !pose.eyes && acc.at[1] >= 4)) stamp(grid, acc.at[0], anchor + acc.at[1], acc.rows);
    }
    if (spec.dy || spec.dx) {
      const dy = spec.dy || 0, dx = spec.dx || 0, moved = Array.from({ length: rows }, blank);
      grid.forEach((row, y) => { if (y + dy >= 0 && y + dy < rows) moved[y + dy] = dx > 0 ? ('.'.repeat(dx) + row).slice(0, W) : dx < 0 ? (row + '.'.repeat(-dx)).slice(-dx) : row; });
      grid = moved;
    }
    (spec.props || []).forEach(([name, x, y]) => stamp(grid, x, y + top, PROPS[name]));
    return grid;
  }

  const F = (pose, more) => Object.assign({ pose }, more || {});
  const rep = (spec, count) => Array(count).fill(spec);
  /* ── 动作 ─────────────────────────────────────────── */
  // loop: 一直循环（状态）；否则播一遍回到状态。fps 是每秒几帧。
  const ACTIONS = {
    // 状态
    onduty: { label: '在岗', when: '客户端开着，最近没在生成', loop: true, fps: 4,
      frames: rep(F('sit', { tail: 0 }), 5).concat(F('sit', { tail: 1 }), F('sit', { tail: 2 }), F('sit', { tail: 1 }), rep(F('sit', { tail: 0 }), 3), F('sit', { tail: 0, eyes: 'closed' })) },
    working: { label: '干活', when: '有会话正在生成', loop: true, fps: 6,
      frames: [F('sit', { tail: 0, props: [['laptop', 5, 13], ['spark', 0, 12]] }), F('sit', { tail: 0, dy: 0, props: [['laptop', 5, 13]] }),
        F('sit', { tail: 0, props: [['laptop', 5, 13], ['spark', 17, 11]] }), F('sit', { tail: 1, props: [['laptop', 5, 13]] })] },
    arriving: { label: '赶来', when: '刚点了打开，客户端还在启动', loop: true, fps: 6, frames: [F('walkA'), F('walkB')] },
    play: { label: '玩耍', when: '一天内用过，现在闲着', loop: true, fps: 4,
      frames: [F('sit', { tail: 1, props: [['ball', 0, 14]] }), F('sit', { tail: 2, props: [['ball', 0, 14]] }), F('sit', { tail: 1, eyes: 'happy', props: [['ball', 0, 13]] }), F('sit', { tail: 0, eyes: 'happy', props: [['ball', 0, 12]] }), F('sit', { tail: 1, props: [['ball', 0, 13]] })] },
    rest: { label: '揣手', when: '三天内用过', loop: true, fps: 2,
      frames: rep(F('loaf'), 3).concat(F('loaf', { dy: 1 }), F('loaf', { dy: 1 }), F('loaf'), F('loaf', { eyes: 'closed' })) },
    nap: { label: '打盹', when: '一周内用过', loop: true, fps: 2,
      frames: [F('sleep', { props: [['z1', 15, 4]] }), F('sleep', { props: [['z1', 15, 3], ['z2', 16, 0]] }), F('sleep', { dy: 1, props: [['z2', 16, 0]] }), F('sleep', { dy: 1 })] },
    hibernate: { label: '冬眠', when: '一周以上没动过', loop: true, fps: 1, frames: [F('sleep'), F('sleep', { dy: 1 })] },
    confused: { label: '迷糊', when: '找不到它的目录，或需要你处理', loop: true, fps: 2,
      frames: [F('sit', { tail: 0, dx: -1, props: [['ask', 16, 0]] }), F('sit', { tail: 0, dx: -1 }), F('sit', { tail: 1, dx: 0, props: [['ask', 16, 0]] }), F('sit', { tail: 0, eyes: 'closed', props: [['ask', 16, 0]] })] },
    tired: { label: '累了', when: '额度掉到最低一档', loop: true, fps: 2,
      frames: [F('sit', { tail: 0, eyes: 'closed', props: [['sweat', 17, 3]] }), F('sit', { tail: 0, eyes: 'closed', dy: 1, props: [['sweat', 17, 5]] }), F('sit', { tail: 0, eyes: 'closed', dy: 1 })] },
    spent: { label: '摊成饼', when: '额度用完了', loop: true, fps: 1, frames: [F('flat'), F('flat', { props: [['sweat', 17, 8]] })] },
    // 一次性的动作
    hop: { label: '跳一下', when: '被选中', fps: 12, frames: [F('crouch', { tail: 0 }), F('leap', { dy: -1 }), F('leap', { dy: -1 }), F('leap'), F('crouch', { tail: 1 }), F('sit', { tail: 1 })] },
    pet: { label: '被摸', when: '点猫本身', fps: 8, frames: [F('sit', { tail: 2, eyes: 'happy' }), F('sit', { tail: 2, eyes: 'happy', dy: -1, props: [['heart', 16, 0]] }), F('sit', { tail: 1, eyes: 'happy', props: [['heart', 16, 1]] }), F('sit', { tail: 2, eyes: 'happy', dy: -1 }), F('sit', { tail: 1, eyes: 'happy' })] },
    zap: { label: '炸毛', when: '电一下', fps: 10, frames: [F('sit', { tail: 2, eyes: 'wide', props: [['fuzz', 2, 5], ['fuzz', 17, 5]] }), F('sit', { tail: 2, eyes: 'wide', dy: -1 }), F('sit', { tail: 2, eyes: 'wide', props: [['fuzz', 2, 6], ['fuzz', 17, 6]] }), F('sit', { tail: 2, eyes: 'wide', dy: -1 }), F('sit', { tail: 1, eyes: 'closed' })] },
    cheer: { label: '好了', when: '客户端起来了，导出完成', fps: 8, frames: [F('crouch', { tail: 1, eyes: 'happy' }), F('leap', { dy: -1, eyes: 'happy', props: [['spark', 0, 3]] }), F('leap', { dy: -1, eyes: 'happy', props: [['spark', 17, 2], ['spark', 0, 5]] }), F('crouch', { tail: 2, eyes: 'happy' }), F('sit', { tail: 2, eyes: 'happy', props: [['bang', 18, 1]] }), F('sit', { tail: 1, eyes: 'happy' })] },
    no: { label: '摇头', when: '出错了', fps: 10, frames: [F('sit', { tail: 0, dx: -1, eyes: 'closed' }), F('sit', { tail: 0, dx: 1, eyes: 'closed' }), F('sit', { tail: 0, dx: -1, eyes: 'closed' }), F('sit', { tail: 0, dx: 1, eyes: 'closed' }), F('sit', { tail: 0 })] },
    arrive: { label: '跳上来', when: '启动时，或新来的猫', fps: 12, frames: [F('leap', { dy: 12 }), F('leap', { dy: 6 }), F('leap', { dy: 1 }), F('leap', { dy: -1 }), F('crouch', { tail: 0 }), F('sit', { tail: 1 })] },
    leave: { label: '跳下去', when: '被送走', fps: 12, frames: [F('sit', { tail: 1 }), F('crouch', { tail: 0 }), F('leap', { dy: -1 }), F('leap', { dy: 4 }), F('leap', { dy: 10 }), F('leap', { dy: 16 })] },
    settle: { label: '睡下', when: '关闭应用，或闲下来', fps: 6, frames: [F('sit', { tail: 0 }), F('crouch', { tail: 0, eyes: 'closed' }), F('loaf', { eyes: 'closed' }), F('sleep')] },
    wake: { label: '醒来', when: '又开始用它', fps: 6, frames: [F('sleep'), F('loaf', { eyes: 'closed' }), F('loaf'), F('crouch', { tail: 1 }), F('sit', { tail: 2, eyes: 'happy' }), F('sit', { tail: 1 })] }
  };

  /* ── 毛色 ─────────────────────────────────────────── */
  // f 毛 w 浅色 o 轮廓；可选：t 重点色 a b 花斑 m 条纹 s 爪 e 眼 n 鼻 p 耳内 ring 眼圈 collar 默认项圈
  const LOOKS = {
    // 家猫
    orange:  { group: '家猫', label: '橘猫', f: '#e8944a', w: '#f6e2bd', o: '#57351f', m: '#c9742f' },
    cream:   { group: '家猫', label: '奶油', f: '#f1d9a8', w: '#fbf3df', o: '#7a5a36', m: '#e2c186' },
    tabby:   { group: '家猫', label: '狸花', f: '#a5834f', w: '#dcc9a2', o: '#4f3a20', m: '#6d5230', t: '#8a6a3c' },
    silver:  { group: '家猫', label: '银虎斑', f: '#b9bec7', w: '#eef0f3', o: '#3d424c', m: '#6f7682' },
    black:   { group: '家猫', label: '玄猫', f: '#3b4050', w: '#565c6e', o: '#1d2029', e: '#f2c14e' },
    white:   { group: '家猫', label: '白猫', f: '#f4efe2', w: '#fffdf6', o: '#8d8474', e: '#4a8fd0' },
    tuxedo:  { group: '家猫', label: '礼服', f: '#33363f', w: '#fbf8ef', o: '#17191f', s: '#fbf8ef', e: '#8ccf6a' },
    cow:     { group: '家猫', label: '奶牛', f: '#f3efe6', w: '#ffffff', o: '#3a3a42', a: '#3a3a42', b: '#3a3a42' },
    calico:  { group: '家猫', label: '三花', f: '#f3ead6', w: '#fbf6e8', o: '#57351f', a: '#e8944a', b: '#4a4f5a' },
    tortie:  { group: '家猫', label: '玳瑁', f: '#4a3c36', w: '#6a564a', o: '#221a16', a: '#d98a3d', b: '#a8763f', e: '#e8c04a' },
    siamese: { group: '家猫', label: '暹罗', f: '#ecdfc4', w: '#f7f0e2', o: '#54412e', t: '#5f4a3b', s: '#5f4a3b', e: '#4a8fd0' },
    blue:    { group: '家猫', label: '蓝灰', f: '#8b98ae', w: '#bcc6d6', o: '#3e4658', e: '#e8a13a' },
    // 有来历的
    maneki:  { group: '有来历的', label: '招财', note: '白身、红耳、金铃', f: '#fbf6ea', w: '#ffffff', o: '#7a3a2a', t: '#d0483a', p: '#f2c14e', collar: '#d0483a', accessory: 'bell' },
    qinghua: { group: '有来历的', label: '青花', note: '白瓷上的钴蓝', f: '#f6f7f4', w: '#ffffff', o: '#1f3f8a', a: '#2f5fc4', b: '#2f5fc4', m: '#6f93dd', t: '#2f5fc4', e: '#1f3f8a', n: '#6f93dd', p: '#b8cbf0', collar: '#2f5fc4' },
    ink:     { group: '有来历的', label: '水墨', note: '宣纸、浓墨、淡墨', f: '#efe9da', w: '#f8f4ea', o: '#2a2622', a: '#8f8a80', b: '#2a2622', t: '#2a2622', m: '#b9b3a6', n: '#8f8a80', collar: '#b5383a' },
    koi:     { group: '有来历的', label: '锦鲤', note: '白底、朱红、金', f: '#fbf5ea', w: '#ffffff', o: '#8a4a2a', a: '#e0522f', b: '#f2a03a', collar: '#f2c14e' },
    tiger:   { group: '有来历的', label: '虎头', note: '布老虎的黄和黑', f: '#f2a53a', w: '#fbefc8', o: '#3a2413', m: '#3a2413', t: '#3a2413', collar: '#d0483a' },
    panda:   { group: '有来历的', label: '熊猫', note: '黑耳朵、黑眼圈、黑爪子', f: '#f6f4ee', w: '#ffffff', o: '#4a4a52', t: '#2a2a30', ring: '#2a2a30', s: '#2a2a30', e: '#ffffff', collar: '#6ba84f' },
    handheld: { group: '有来历的', label: '掌机绿', note: '老掌机屏幕的四阶绿', f: '#8bac0f', w: '#9bbc0f', o: '#0f380f', a: '#306230', b: '#306230', m: '#306230', t: '#306230', e: '#0f380f', n: '#306230', p: '#306230', collar: '#0f380f' },
    // 跟着客户端走的（只取颜色，不画任何标志）。色值 2026-11-24 对过各家官方资料，来源记在 docs/PRODUCT.md「猫的毛色」。
    // 图鉴里还有 Claude、DeepSeek、Kimi、Gemini 四种：它们的品牌规定不允许未经许可用品牌颜色（或要求事先批准），已拿掉。
    codex:   { group: '跟着客户端', label: 'Codex', note: '黑和白', f: '#f9f9f9', w: '#ffffff', o: '#0d0d0d', t: '#0d0d0d', s: '#0d0d0d', e: '#0d0d0d', collar: '#181818' },
    cursor:  { group: '跟着客户端', label: 'Cursor', note: '暖石墨，橙项圈', f: '#26251e', w: '#f7f7f4', o: '#14120b', t: '#72716d', m: '#43413c', e: '#f7f7f4', collar: '#f54e00' },
    qwen:    { group: '跟着客户端', label: 'Qwen', note: '蓝', f: '#082dff', w: '#f7f8fc', o: '#232326', m: '#0008c9', e: '#ffffff', collar: '#f7f8fc' },
    copilot: { group: '跟着客户端', label: 'Copilot', note: 'GitHub 的深灰和绿', f: '#232925', w: '#f2f5f3', o: '#101411', a: '#08872b', b: '#08872b', e: '#5fed83', collar: '#0fbf3e', accessory: 'shades' },
    opencode: { group: '跟着客户端', label: 'OpenCode', note: '墨色三档', f: '#626262', w: '#d2d2d2', o: '#1f1f1f', e: '#1f1f1f', collar: '#1f1f1f' }
  };
  const INK = { W: '#ffffff', k: '#2b2018', g: '#8d8f98', l: '#d7f0ff', y: '#f2c14e', Y: '#d9a53a', r: '#d0483a', R: '#f0a0b8', z: '#6b5a52', q: '#b5383a', u: '#6fb7e8', G: '#e8c04a' };
  function colour(ch, look, collar) {
    if (ch === 'o') return look.o; if (ch === 'f') return look.f; if (ch === 'w') return look.w;
    if (ch === '-') return look.ring ? (look.e || '#ffffff') : look.o;   // 闭着的眼：在黑眼圈里要画成亮的
    if (ch === 'A') return look.ring || look.a || look.f; if (ch === 'B') return look.ring || look.b || look.f; if (ch === 'x') return look.ring || look.f;
    if (ch === 's') return look.s || look.w; if (ch === 't') return look.t || look.f;
    if (ch === 'a') return look.a || look.f; if (ch === 'b') return look.b || look.f; if (ch === 'm') return look.m || look.f;
    if (ch === 'p') return look.p || '#e8a0a0'; if (ch === 'n') return look.n || '#d97a7a'; if (ch === 'e') return look.e || '#2b2018';
    if (ch === 'c') return collar || look.collar || '#c94f2e';
    return INK[ch] || null;
  }
  function draw(ctx, grid, look, options) {
    const o = options || {}, s = o.scale || 4, dx = o.dx || 0, dy = o.dy || 0;
    for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[y].length; x += 1) {
      const c = colour(grid[y][x], look, o.collar);
      if (c) { ctx.fillStyle = c; ctx.fillRect(dx + x * s, dy + y * s, s, s); }
    }
  }
  // 自检：每一格都是合法字符，每一行都是 20 格
  function check() {
    const bad = [];
    for (const [name, pose] of Object.entries(POSES)) pose.rows.forEach((row, y) => { if (row.length !== W) bad.push(name + ' 第 ' + y + ' 行长 ' + row.length); });
    for (const [name, action] of Object.entries(ACTIONS)) action.frames.forEach((spec, i) => frame(spec, { accessory: 'none' }).forEach((row, y) => {
      if (row.length !== W) bad.push(name + ' 第 ' + i + ' 帧第 ' + y + ' 行长 ' + row.length);
      for (const ch of row) if (ch !== '.' && !colour(ch, LOOKS.orange)) bad.push(name + ' 第 ' + i + ' 帧有不认识的字符 ' + ch);
    }));
    return bad;
  }
  return { W, H, POSES, ACTIONS, LOOKS, ACCESSORIES, frame, draw, colour, check };
});
