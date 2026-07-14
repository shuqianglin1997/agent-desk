/*
 * AgentDesk — 庭院场景引擎。
 *
 * 挂到 window.YardScene。职责：
 *  - 在 480×132 的逻辑画布上画庭院（天空/栅栏/工作亭/池塘/树/花圃/邮筒）
 *  - 按分组把猫（账号槽位）排进各自的区域，干活的猫坐进工作亭书桌
 *  - 常驻名牌（DOM 覆盖层，名字 = 账号名称，中文清晰可点）
 *  - 8fps 心跳做环境动画；点击选中、按住撸猫
 * 数据从 renderer.js 喂入（update），本文件不碰 IPC、不碰业务状态。
 */
(function (root) {
  'use strict';

  const W = 480;
  const H = 132;
  const LINE = '#33261a';
  const WOOD = '#8a5c34';
  const WOODL = '#b9854e';
  const WOODD = '#6b4526';
  const STONE = '#b8b2a2';

  const TIMES = {
    day: {
      skyA: '#8fd0e8', skyB: '#c8ecf2', orb: '#ffd870',
      grass: '#77b455', grassD: '#639c46', hedge: '#8cc064', hedge2: '#7ab254',
      wallIn: '#7a5a3a', wallBack: '#6b4e33', window: '#cfe8f0',
      pondDeep: '#3e7fae', pondLite: '#5aa0c8', pondCore: '#4a90bc',
      leaf1: '#4f8a3c', leaf2: '#66a44c',
      overlay: null, stars: false
    },
    night: {
      skyA: '#171d3e', skyB: '#2c3a6a', orb: '#f2eccb',
      grass: '#41635a', grassD: '#37544c', hedge: '#3c5c50', hedge2: '#345348',
      wallIn: '#54422f', wallBack: '#4a3a2c', window: '#f4c76a',
      pondDeep: '#25406a', pondLite: '#31527f', pondCore: '#2b4a75',
      leaf1: '#2e4a40', leaf2: '#3a5a4c',
      overlay: 'rgba(16,20,54,.32)', stars: true
    }
  };

  const SEATS = [34, 60, 86];      // 工作亭三张书桌（猫脚 y=70）
  const SEAT_FOOT_Y = 70;
  const GROUND_X0 = 14;
  const GROUND_X1 = 466;

  // ── 内部状态 ─────────────────────────────────────────
  let canvas = null;
  let ctx = null;
  let overlay = null;
  let onSelect = null;
  let onPet = null;

  let data = { profiles: [], statesById: {}, selectedId: null, night: false };
  let layout = [];          // [{ profile, state, x, y, seat, topY }]
  let zones = [];           // [{ label, x, count }]
  let particles = [];
  let tick = 0;
  let timer = null;
  let active = false;
  let hoveredId = null;
  let pressTimer = null;
  let pressed = false;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 确定性散点（草地噪点/星星/萤火虫）
  function scatter(n, seed, x0, y0, x1, y1) {
    const out = [];
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      const rx = s / 233280;
      s = (s * 9301 + 49297) % 233280;
      const ry = s / 233280;
      out.push([Math.floor(x0 + rx * (x1 - x0)), Math.floor(y0 + ry * (y1 - y0))]);
    }
    return out;
  }
  const GRASS_DOTS = scatter(190, 7, 2, 52, W - 2, H - 4);
  const STAR_DOTS = scatter(30, 12, 4, 2, W - 4, 32);
  const FIREFLIES = scatter(6, 23, 60, 60, W - 40, H - 16);

  function seedOf(profile) {
    let h = 0;
    const text = String(profile.id || '');
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h % 97;
  }

  // ── 布局：分组 → 区域，猫 → 位置 ─────────────────────
  function groupOf(profile) {
    return (profile.group || '').trim();
  }

  function computeLayout() {
    const profiles = data.profiles;
    layout = [];
    zones = [];
    if (!profiles.length) return;

    const groupsMap = new Map();
    for (const profile of profiles) {
      const key = groupOf(profile);
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key).push(profile);
    }
    const groups = [...groupsMap.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b, 'zh-CN');
    });

    const totalW = GROUND_X1 - GROUND_X0;
    const total = profiles.length;
    // 每组保底宽度：组多时按可用宽度收缩，保证所有组都留在画布内
    const minShare = Math.min(70, Math.floor(totalW / groups.length));
    let cursor = GROUND_X0;
    let seatIndex = 0;

    groups.forEach(([groupName, members], gi) => {
      const share = Math.max(minShare, Math.round(totalW * (members.length / total)));
      const remaining = groups.length - 1 - gi;
      const x0 = cursor;
      const x1 = gi === groups.length - 1
        ? GROUND_X1
        : Math.min(GROUND_X1 - remaining * minShare, cursor + share);
      cursor = x1;
      const bandW = x1 - x0;

      const hasSign = groups.length > 1 || Boolean(groupName);
      if (hasSign) {
        zones.push({ label: groupName || '草坪', x: x0 + 6, count: members.length });
      }

      // 猫尽量摊开（34〜64px 间距），给名牌留出并排展示的空间
      const startX = Math.min(x0 + (hasSign ? 44 : 20), x1 - 12);
      const usable = Math.max(20, x1 - 12 - startX);
      const spacing = Math.max(34, Math.min(64, Math.floor(usable / Math.max(1, members.length))));
      const perRow = Math.max(1, Math.floor(usable / spacing) + 1);

      members.forEach((profile, i) => {
        const state = data.statesById[profile.id] || 'rest';
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        let x = Math.min(startX + col * spacing, GROUND_X1 - 10);
        let y = 98 + Math.min(1, row) * 16;
        if (row > 1) { x = Math.min(x + 12, GROUND_X1 - 10); y = 106; } // 溢出兜底，轻微叠放
        let seat = false;
        let tier = col % 2; // 名牌高低交错，避免相邻名牌互相盖住
        if ((state === 'working' || state === 'arriving') && seatIndex < SEATS.length) {
          x = SEATS[seatIndex];
          y = SEAT_FOOT_Y;
          seat = true;
          tier = seatIndex % 2;
          seatIndex += 1;
        }
        const pose = poseFor(state);
        const topY = y - pose.length - (seat ? 6 : 0);
        layout.push({ profile, state, x, y, seat, tier, topY });
      });
    });
  }

  function poseFor(state) {
    const S = root.YardSprites;
    if (state === 'working' || state === 'arriving' || state === 'confused') return S.SIT;
    if (state === 'nap' || state === 'hibernate') return S.SLEEP;
    return S.LOAF;
  }

  // ── 覆盖层：常驻名牌 + 区域木牌标签 ──────────────────
  function syncChips() {
    if (!overlay) return;
    const meta = root.YardCats ? root.YardCats.STATE_META : {};
    const seen = new Set();

    for (const entry of layout) {
      const id = entry.profile.id;
      seen.add(id);
      let chip = overlay.querySelector(`.yard-nameplate[data-id="${id}"]`);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'yard-nameplate';
        chip.dataset.id = id;
        chip.addEventListener('click', () => { if (onSelect) onSelect(id); });
        // 指名牌 = 指猫：双向联动高亮
        chip.addEventListener('mouseenter', () => setHoverId(id));
        chip.addEventListener('mouseleave', () => setHoverId(null));
        overlay.appendChild(chip);
      }
      const stateLabel = meta[entry.state] ? meta[entry.state].label : entry.state;
      chip.textContent = entry.profile.name;
      const dot = document.createElement('span');
      dot.className = 'app-dot';
      dot.style.background = entry.profile.appId === 'codex' ? '#2f9e8f' : '#d96f33';
      chip.prepend(dot);
      chip.title = `${entry.profile.name} · ${stateLabel}${entry.profile.group ? ' · ' + entry.profile.group : ''}`;
      chip.classList.toggle('selected', id === data.selectedId);
      chip.classList.toggle('hovered', id === hoveredId);
      chip.classList.toggle('tier1', entry.tier === 1);
      const lift = entry.tier === 1 ? 15 : 3;
      chip.style.left = `${((entry.x) / W * 100).toFixed(2)}%`;
      chip.style.top = `${((entry.topY - lift) / H * 100).toFixed(2)}%`;
    }
    overlay.querySelectorAll('.yard-nameplate').forEach((chip) => {
      if (!seen.has(chip.dataset.id)) chip.remove();
    });

    const zoneSeen = new Set();
    zones.forEach((zone, i) => {
      const key = `${i}-${zone.label}`;
      zoneSeen.add(key);
      let el = overlay.querySelector(`.yard-zone[data-key="${key}"]`);
      if (!el) {
        el = document.createElement('span');
        el.className = 'yard-zone';
        el.dataset.key = key;
        overlay.appendChild(el);
      }
      el.textContent = zone.label;
      el.style.left = `${((zone.x + 17) / W * 100).toFixed(2)}%`;
      el.style.top = `${(83 / H * 100).toFixed(2)}%`;
    });
    overlay.querySelectorAll('.yard-zone').forEach((el) => {
      if (!zoneSeen.has(el.dataset.key)) el.remove();
    });
  }

  // ── 基础画笔 ─────────────────────────────────────────
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function frameRect(x, y, w, h, fill, line) { rect(x, y, w, h, line); rect(x + 1, y + 1, w - 2, h - 2, fill); }
  function mix(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function drawZ(x, y, c) { rect(x, y, 3, 1, c); rect(x + 1, y + 1, 1, 1, c); rect(x, y + 2, 3, 1, c); }
  function drawHeart(x, y, c) { rect(x, y, 1, 1, c); rect(x + 2, y, 1, 1, c); rect(x - 1, y + 1, 5, 1, c); rect(x, y + 2, 3, 1, c); rect(x + 1, y + 3, 1, 1, c); }
  function drawQBubble(x, y) {
    frameRect(x, y, 9, 9, '#fdf8ec', LINE);
    rect(x + 3, y + 9, 2, 2, LINE);
    const q = '#8a4630';
    rect(x + 3, y + 2, 3, 1, q); rect(x + 6, y + 3, 1, 1, q); rect(x + 4, y + 4, 2, 1, q); rect(x + 4, y + 6, 1, 1, q);
  }

  // ── 场景各部件 ───────────────────────────────────────
  function drawSky(P) {
    rect(0, 0, W, 12, P.skyA);
    rect(0, 12, W, 10, mix(P.skyA, P.skyB, 0.4));
    rect(0, 22, W, 8, mix(P.skyA, P.skyB, 0.75));
    rect(0, 30, W, 8, P.skyB);
    if (P.stars) STAR_DOTS.forEach(([x, y], i) => { if ((tick + i) % 16 < 12) rect(x, y, 1, 1, i % 3 ? '#cdd3ee' : '#ffffff'); });
    const ox = 356, oy = 10;
    rect(ox - 4, oy - 3, 8, 6, P.orb); rect(ox - 3, oy - 4, 6, 8, P.orb); rect(ox - 5, oy - 1, 10, 2, P.orb);
    if (P.stars) rect(ox - 2, oy - 2, 3, 3, mix(P.orb, P.skyA, 0.55));
    const cx = Math.round((tick * 0.2) % (W + 80)) - 40;
    [[cx, 5], [(cx + 220) % (W + 80) - 40, 16]].forEach(([x, y]) => {
      const c = P.stars ? 'rgba(190,198,232,.25)' : 'rgba(255,255,255,.85)';
      rect(x, y + 2, 24, 3, c); rect(x + 4, y, 12, 3, c); rect(x + 15, y + 1, 8, 2, c);
    });
  }

  function drawGround(P) {
    rect(0, 34, W, 6, P.hedge);
    for (let x = 0; x < W; x += 16) rect(x + 4, 31, 8, 4, P.hedge2);
    rect(0, 40, W, H - 40, P.grass);
    GRASS_DOTS.forEach(([x, y], i) => rect(x, y, i % 4 ? 2 : 1, 1, P.grassD));
    const path = mix(P.grass, '#d8c49a', P.stars ? 0.35 : 0.6);
    rect(52, 78, 12, 26, path);
    rect(52, 96, 144, 12, path);
    for (let i = 0; i < 5; i++) rect(55 + (i % 2) * 5, 80 + i * 5, 3, 2, mix(path, LINE, 0.18));
    for (let i = 0; i < 9; i++) rect(70 + i * 14, 100 + (i % 2) * 3, 3, 2, mix(path, LINE, 0.18));
  }

  function drawFence() {
    for (let x = 4; x < W; x += 22) {
      rect(x, 36, 3, 12, WOOD);
      rect(x, 36, 3, 1, WOODD);
    }
    rect(0, 39, W, 2, WOODL);
    rect(0, 44, W, 2, WOODL);
  }

  function drawFlowers(P) {
    rect(302, 58, 48, 10, mix(P.grass, '#4a7034', 0.5));
    [[306, 60, '#e8a0b8'], [313, 63, '#f0d060'], [320, 59, '#f8f0e0'], [328, 62, '#e8a0b8'], [336, 60, '#f0d060'], [343, 63, '#f8f0e0']].forEach(([x, y, c]) => {
      rect(x, y, 2, 2, c); rect(x, y + 2, 1, 2, '#4a7034');
    });
    if (!reduced) {
      const bt = tick * 0.1;
      const bx = Math.round(326 + Math.cos(bt) * 14);
      const by = Math.round(52 + Math.sin(bt * 1.7) * 4);
      const open = tick % 4 < 2;
      rect(bx, by, 1, 2, '#d97a3a');
      if (open) { rect(bx - 1, by, 1, 1, '#f0b060'); rect(bx + 1, by, 1, 1, '#f0b060'); } else rect(bx, by - 1, 1, 1, '#f0b060');
    }
  }

  function drawMailbox() {
    rect(116, 54, 3, 16, WOODD);
    frameRect(110, 46, 15, 9, '#c05a3a', LINE);
    rect(111, 47, 4, 7, '#d97a52');
    rect(123, 48, 1, 4, '#e8c04a');
  }

  function drawPond(P) {
    rect(198, 92, 84, 32, LINE); rect(196, 94, 88, 28, LINE);
    rect(200, 94, 80, 28, P.pondDeep); rect(198, 96, 84, 24, P.pondDeep);
    rect(202, 96, 76, 24, P.pondLite); rect(200, 98, 80, 20, P.pondLite);
    rect(206, 100, 68, 16, P.pondCore);
    rect(204, 97, 20, 1, 'rgba(255,255,255,.22)');
    const t = tick * 0.06;
    const kx = Math.round(238 + Math.cos(t) * 20);
    const ky = Math.round(106 + Math.sin(t * 1.3) * 5);
    rect(kx, ky, 3, 2, '#e07a3a'); rect(kx + 3, ky, 1, 1, '#ffffff');
    const kx2 = Math.round(240 + Math.cos(t + 3) * 16);
    const ky2 = Math.round(108 + Math.sin(t * 1.1 + 2) * 4);
    rect(kx2, ky2, 3, 2, '#f0f0e8'); rect(kx2 - 1, ky2 + 1, 1, 1, '#e07a3a');
    [[214, 100], [252, 112], [230, 117], [266, 101]].forEach(([sx, sy], i) => {
      if ((tick + i * 7) % 20 < 10) {
        ctx.fillStyle = 'rgba(255,255,255,.3)';
        ctx.fillRect(sx + (((tick >> 3) + i) % 3), sy, 4, 1);
      }
    });
  }

  function drawTree(P) {
    rect(424, 28, 7, 60, WOODD); rect(421, 84, 14, 4, WOODD);
    rect(402, 8, 52, 22, P.leaf1);
    rect(410, 2, 36, 12, P.leaf2);
    rect(394, 16, 16, 14, P.leaf2);
    rect(446, 14, 14, 14, P.leaf2);
    ctx.fillStyle = 'rgba(20,30,20,.14)';
    ctx.fillRect(400, 88, 52, 8);
  }

  function drawHut(P) {
    frameRect(12, 68, 92, 10, STONE, LINE);
    frameRect(18, 30, 80, 40, P.wallBack, LINE);
    rect(20, 32, 76, 36, P.wallIn);
    frameRect(80, 38, 13, 12, P.window, LINE);
    rect(86, 39, 1, 10, LINE); rect(81, 43, 11, 1, LINE);
    rect(10, 24, 96, 8, WOODD); rect(14, 18, 88, 8, WOOD); rect(22, 12, 72, 8, WOODL);
    rect(10, 24, 96, 2, LINE); rect(14, 18, 88, 1, 'rgba(255,255,255,.2)');
    rect(18, 30, 4, 44, WOODD); rect(94, 30, 4, 44, WOODD);
  }

  function drawDesk(cx) {
    frameRect(cx - 12, 61, 24, 9, WOOD, LINE);
    rect(cx - 11, 62, 22, 2, WOODL);
    rect(cx - 8, 55, 10, 6, '#3a3f4a');
    rect(cx - 7, 56, 8, 4, (tick % 8 < 4) ? '#9fd4e8' : '#b8e4f0');
    rect(cx + 5, 58, 3, 3, '#c05a3a');
    if (!reduced && tick % 8 < 4) {
      rect(cx + 6, 55, 1, 1, 'rgba(255,255,255,.7)');
      rect(cx + 5, 53, 1, 1, 'rgba(255,255,255,.4)');
    }
  }

  function drawSign(x) {
    rect(x + 15, 84, 3, 12, WOODD);
    frameRect(x, 76, 34, 11, WOODL, LINE);
    rect(x + 2, 78, 30, 1, 'rgba(255,255,255,.25)');
  }

  // ── 猫 ───────────────────────────────────────────────
  function drawYardCat(entry, P) {
    const S = root.YardSprites;
    const pose = poseFor(entry.state);
    const pal = S.BREEDS[entry.profile.cat && entry.profile.cat.breed] || S.BREEDS.orange;
    const pw = pose[0].length;
    const ph = pose.length;
    const seed = seedOf(entry.profile);
    let dx = Math.round(entry.x - pw / 2);
    let dy = Math.round(entry.y - ph);
    if (entry.seat) dy -= 6; // 坐小凳，头露出书桌
    if (entry.state === 'confused') dx += (tick % 8 < 4) ? 0 : 1;
    if (entry.state === 'play') dy -= Math.abs(Math.sin((tick + seed) * 0.5)) > 0.7 ? 2 : 0;

    // 选中 / 悬停圈（虚线）
    const isSel = entry.profile.id === data.selectedId;
    if (isSel || entry.profile.id === hoveredId) {
      ctx.fillStyle = isSel
        ? (entry.profile.appId === 'codex' ? '#2f9e8f' : '#d96f33')
        : 'rgba(255,255,255,.55)';
      for (let i = 0; i < pw + 4; i += 3) ctx.fillRect(dx - 2 + i, entry.y + 1, 2, 1);
    }

    const cat = entry.profile.cat || {};
    S.drawCat(ctx, pose, pal, {
      dx, dy, scale: 1, seed,
      blink: ((tick + seed) % 40) < 3,
      collar: cat.collar,
      bell: entry.profile.isProtected,
      tag: entry.profile.isProtected ? null : entry.profile.appId,
      accessory: cat.accessory === 'none' ? null : cat.accessory,
      tail: (tick + seed) % 24 < 12
    });

    if (entry.state === 'working') {
      if (entry.seat) drawDesk(entry.x);
      else { // 没抢到书桌的加班猫：草地办公
        rect(dx + 2, entry.y - 6, 10, 5, '#3a3f4a');
        rect(dx + 3, entry.y - 5, 8, 3, (tick % 8 < 4) ? '#9fd4e8' : '#b8e4f0');
      }
    }
    if (entry.state === 'arriving') {
      rect(dx + pw, dy - 6, 2, 5, '#e8c04a');
      rect(dx + pw, dy - 7, 2, 1, LINE);
    }
    if (entry.state === 'confused' && (tick % 20) < 14) drawQBubble(dx + pw - 2, dy - 11);
    if (entry.state === 'play') {
      const yx = dx - 7 + (((tick + seed) >> 3) % 2);
      rect(yx, entry.y - 4, 4, 4, '#d05a7a');
      rect(yx + 1, entry.y - 3, 2, 1, '#f0a0b8');
    }
    if (entry.state === 'hibernate') {
      frameRect(dx - 3, dy + 2, pw + 6, ph + 4, '#c9a25f', LINE);
      rect(dx - 2, dy + 3, pw + 4, 3, '#b8894a');
      rect(dx - 1, dy + 4, pw + 2, 1, cat.collar || '#8a6bb8');
    }
    if ((entry.state === 'nap' || entry.state === 'hibernate') && !reduced && (tick + seed) % 16 === 0 && particles.length < 48) {
      particles.push({ kind: 'z', x: dx + pw - 2, y: dy - 2, age: 0 });
    }
  }

  function drawParticles() {
    particles = particles.filter((p) => p.age < 26);
    particles.forEach((p) => {
      p.age += 1;
      ctx.globalAlpha = Math.max(0, 1 - p.age / 24);
      if (p.kind === 'z') drawZ(Math.round(p.x + ((p.age >> 2) % 2)), Math.round(p.y - p.age * 0.5), '#faf5e6');
      if (p.kind === 'heart') drawHeart(Math.round(p.x + Math.sin(p.age * 0.4) * 2), Math.round(p.y - p.age * 0.8), '#e06a8a');
      ctx.globalAlpha = 1;
    });
  }

  // ── 主渲染 ───────────────────────────────────────────
  function render() {
    if (!ctx) return;
    const P = TIMES[data.night ? 'night' : 'day'];
    ctx.clearRect(0, 0, W, H);
    drawSky(P);
    drawGround(P);
    drawFence();
    drawFlowers(P);
    drawMailbox();
    drawPond(P);
    drawTree(P);
    drawHut(P);
    zones.forEach((zone) => drawSign(zone.x));
    [...layout].sort((a, b) => a.y - b.y).forEach((entry) => drawYardCat(entry, P));
    drawParticles();
    for (let x = 0; x < W; x += 10) rect(x + (x % 20 ? 3 : 6), H - 4, 2, 4, P.grassD);

    if (P.overlay) { ctx.fillStyle = P.overlay; ctx.fillRect(0, 0, W, H); }
    if (P.stars) {
      ctx.fillStyle = 'rgba(244,199,106,.9)'; ctx.fillRect(81, 39, 11, 10);
      ctx.fillStyle = 'rgba(244,199,106,.18)'; ctx.fillRect(74, 34, 26, 20);
      layout.forEach((entry) => {
        if (entry.state === 'working') {
          ctx.fillStyle = 'rgba(244,199,106,.14)';
          ctx.fillRect(entry.x - 16, entry.y - 26, 32, 26);
        }
      });
      FIREFLIES.forEach(([fx, fy], i) => {
        if ((tick + i * 5) % 22 < 14) {
          const t = tick * 0.08 + i;
          ctx.fillStyle = 'rgba(220,240,140,.95)';
          ctx.fillRect(Math.round(fx + Math.cos(t) * 6), Math.round(fy + Math.sin(t * 1.4) * 4), 1, 1);
        }
      });
    }
  }

  // ── 指针交互 ─────────────────────────────────────────
  function logicalXY(event) {
    const r = canvas.getBoundingClientRect();
    return [(event.clientX - r.left) / r.width * W, (event.clientY - r.top) / r.height * H];
  }
  function catAt(lx, ly) {
    let best = null;
    let bd = Infinity;
    for (const entry of layout) {
      // 命中区：猫身 + 向上延伸到名牌吊线，消除猫和高位名牌之间的 hover 死区
      const reach = entry.tier === 1 ? 18 : 6;
      const inBox = Math.abs(lx - entry.x) <= 13 && ly >= entry.topY - reach && ly <= entry.y + 3;
      if (!inBox) continue;
      const d = Math.hypot(lx - entry.x, ly - (entry.y - 6));
      // <=：同距离时取数组靠后者，与绘制层级（后画在上）一致
      if (d <= bd) { bd = d; best = entry; }
    }
    return best;
  }

  function setHoverId(id) {
    if (id === hoveredId) return;
    hoveredId = id;
    if (canvas) canvas.style.cursor = id ? 'pointer' : 'default';
    if (overlay) {
      overlay.querySelectorAll('.yard-nameplate').forEach((chip) => {
        chip.classList.toggle('hovered', chip.dataset.id === id);
      });
    }
    if (reduced || !active) render();
  }

  function bindPointer() {
    canvas.addEventListener('pointermove', (event) => {
      const [lx, ly] = logicalXY(event);
      const hit = catAt(lx, ly);
      setHoverId(hit ? hit.profile.id : null);
    });
    canvas.addEventListener('pointerleave', () => setHoverId(null));
    canvas.addEventListener('pointerdown', (event) => {
      const [lx, ly] = logicalXY(event);
      const hit = catAt(lx, ly);
      pressed = false;
      if (!hit) return;
      pressTimer = setTimeout(() => {
        pressed = true;
        for (let i = 0; i < 5; i++) {
          particles.push({ kind: 'heart', x: hit.x - 6 + i * 4, y: hit.topY - 2 - (i % 2) * 4, age: i * 2 });
        }
        if (onPet) onPet(hit.profile);
        if (reduced || !active) render();
      }, 400);
    });
    window.addEventListener('pointerup', () => clearTimeout(pressTimer));
    canvas.addEventListener('click', () => {
      if (pressed) { pressed = false; return; }
      const hit = hoveredId && layout.find((entry) => entry.profile.id === hoveredId);
      if (hit && onSelect) onSelect(hit.profile.id);
    });
  }

  // ── 心跳 ─────────────────────────────────────────────
  function startLoop() {
    if (timer || reduced) return;
    timer = setInterval(() => {
      if (!active || document.hidden) return;
      tick += 1;
      render();
    }, 125);
  }
  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // ── 对外 API ─────────────────────────────────────────
  root.YardScene = {
    mount(options) {
      canvas = options.canvas;
      overlay = options.overlay;
      onSelect = options.onSelect || null;
      onPet = options.onPet || null;
      ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      bindPointer();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && active) render(); });
      render();
    },
    update(next) {
      data = { ...data, ...next };
      computeLayout();
      syncChips();
      render();
    },
    setActive(value) {
      active = Boolean(value);
      if (active) { startLoop(); render(); } else stopLoop();
    }
  };
})(typeof self !== 'undefined' ? self : this);
