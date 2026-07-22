/*
 * AgentDesk — 庭院场景引擎。
 *
 * 挂到 window.YardScene。职责：
 *  - 在 480×132 的逻辑画布上画庭院（天空/栅栏/工作亭/池塘/树/花圃/邮筒）
 *  - 按分组把猫（账号槽位）排进各自的区域，干活的猫走到工作亭书桌
 *  - 角色化：每只猫有持续位置，会走路、散步、看锦鲤，状态变化时走去新岗位
 *  - 常驻名牌（DOM 覆盖层，名字 = 账号名称，中文清晰可点，跟随猫移动）
 *  - 8fps 心跳做环境动画；点击选中、按住撸猫；邮筒投信、摇铃等反馈
 * 数据从 renderer.js 喂入（update），本文件不碰 IPC、不碰业务状态。
 */
(function (root) {
  'use strict';

  const W = 480;
  // 236 = 原 132 横带 + 前景草坪带；既有元素坐标全部不动，新增高度都给草地，
  // 让庭院在宽屏下占满左列而不是留一条空白。
  const H = 236;
  const LINE = '#33261a';
  const WOOD = '#8a5c34';
  const WOODL = '#b9854e';
  const WOODD = '#6b4526';
  const STONE = '#b8b2a2';

  const { TIMES, WEATHERS, TIME_KEYS } = root.YardPalettes;
  const pmod = (a, m) => ((a % m) + m) % m; // 正数取模，避免粒子开局负数弹入

  const SEATS = [34, 60, 86];      // 工作亭三张书桌（猫脚 y=70）
  const SEAT_FOOT_Y = 70;
  const GROUND_X0 = 14;
  const GROUND_X1 = 466;
  const MAILBOX = { x: 117, y: 48 };
  const POND = { x0: 196, x1: 284, cx: 240 };
  const WALK_SPEED = 1.6;

  // ── 内部状态 ─────────────────────────────────────────
  let canvas = null;
  let ctx = null;
  let overlay = null;
  let onSelect = null;
  let onPet = null;
  let onDrop = null;
  let terrainCanvas = null;     // 离屏缓存：地面/栅栏/花圃/树/工作亭，只随昼夜变
  let terrainCtx = null;
  let terrainKey = null;

  let data = {
    profiles: [],
    statesById: {},
    energyById: {},
    positionsById: {},
    attentionById: {},
    selectedId: null,
    night: false
  };
  let timeOverride = 'auto';     // auto|day|dusk|night；auto 跟随本地时钟
  let weatherOverride = 'auto';  // auto|clear|cloudy|rain|snow
  let weather = 'clear';         // 当前渲染帧的有效天气
  const rainDrops = scatter(60, 41, 0, -20, W, H);   // 雨滴起始点（x,y 基点）
  const snowFlakes = scatter(50, 61, 0, -20, W, H);  // 雪花起始点
  let layout = [];              // [{ profile, state, seat, tier, home, band, actor, topY }]
  const actors = new Map();     // profileId -> 持续的位置与行为状态
  let zones = [];
  let particles = [];
  let tick = 0;
  let timer = null;
  let active = false;
  let hoveredId = null;
  let pressTimer = null;
  let pressed = false;
  let pointerCandidate = null;
  let suppressClick = false;
  let activeDropZoneId = null;
  const speechById = new Map();
  let mailboxFlagUntil = 0;
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
  const GRASS_DOTS = scatter(430, 7, 2, 52, W - 2, H - 4); // 草地变深，噪点按面积等比补足
  const STAR_DOTS = scatter(30, 12, 4, 2, W - 4, 32);
  const FIREFLIES = scatter(6, 23, 60, 60, W - 40, H - 16);

  function seedOf(profile) {
    let h = 0;
    const text = String(profile.id || '');
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h % 97;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 解析当前时段：手动覆盖优先，auto 跟随本地时钟。
  // data.night 只作为旧环境/模块缺失时的兼容回退。
  function effectiveTimeKey() {
    if (timeOverride === 'day' || timeOverride === 'dusk' || timeOverride === 'night') return timeOverride;
    if (root.YardAtmosphere) return root.YardAtmosphere.timeForDate(new Date());
    return data.night ? 'night' : 'day';
  }

  function effectiveWeatherKey() {
    if (WEATHERS.includes(weatherOverride)) return weatherOverride;
    if (root.YardAtmosphere) return root.YardAtmosphere.weatherForDate(new Date()).weather;
    return 'clear';
  }

  // 深夜（23:00〜05:00）且处于夜晚时段：没在干活的猫都睡了。
  // 手动把时段调成 night 但不是真实深夜时，猫不会睡（尊重真实作息）。
  function sleepAllNow() {
    if (effectiveTimeKey() !== 'night') return false;
    const hour = new Date().getHours();
    return hour >= 23 || hour < 5;
  }

  // ── 布局：分组 → 区域，猫 → 家的位置 ─────────────────
  function groupOf(profile) {
    return (profile.group || '').trim();
  }

  function computeLayout() {
    const profiles = data.profiles;
    layout = [];
    zones = [];
    const seen = new Set();
    if (!profiles.length) { actors.clear(); return; }

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
        const energy = data.energyById[profile.id] || 'unknown';
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        let homeX = Math.min(startX + col * spacing, GROUND_X1 - 10);
        // 前景草坪带打开后按行往下排（行距 42 给名牌留高度），底部封顶
        let homeY = Math.min(98 + row * 42, H - 26);
        const saved = root.YardInteractions
          ? root.YardInteractions.normalizePoint(data.positionsById[profile.id])
          : null;
        if (saved) {
          homeX = saved.x;
          homeY = saved.y;
        }

        let targetX = homeX;
        let targetY = homeY;
        let seat = false;
        let tier = col % 3; // 名牌三档高低交错：横带缩小后相邻名牌更密，两档不够分开
        if (seatEligible(state) && seatIndex < SEATS.length) {
          targetX = SEATS[seatIndex];
          targetY = SEAT_FOOT_Y;
          seat = true;
          tier = seatIndex % 3; // 工作亭三席错成三档，任意两名牌不同高
          seatIndex += 1;
        }

        seen.add(profile.id);
        let actor = actors.get(profile.id);
        if (!actor) {
          actor = {
            x: targetX,
            y: targetY,
            tx: targetX,
            ty: targetY,
            flip: false,
            walking: false,
            dragging: false,
            behaveAt: 0,
            watchUntil: 0
          };
          actors.set(profile.id, actor);
        }

        const entry = {
          profile, state, energy, seat, tier,
          home: { x: homeX, y: homeY },
          // 书桌、电脑和坐姿猫必须共用座位锚点；home 是草坪/分组位置，二者不能混用。
          seatAnchor: seat ? { x: targetX, y: targetY } : null,
          band: saved
            ? { x0: clamp(homeX - 38, GROUND_X0, GROUND_X1), x1: clamp(homeX + 38, GROUND_X0, GROUND_X1) }
            : { x0: x0 + 8, x1: x1 - 8 },
          actor,
          topY: targetY - 16
        };

        // 目标：坐席优先；非漫步态一律回家；漫步态目标出界也回家
        const wander = (state === 'play' || state === 'rest') && !seat;
        if (actor.dragging) {
          // 指针持有角色时，轮询刷新不能把猫从鼠标下拉走。
        } else if (!wander) {
          actor.tx = targetX; actor.ty = targetY;
          actor.watchUntil = 0;
        } else if (actor.tx < entry.band.x0 || actor.tx > entry.band.x1) {
          actor.tx = homeX; actor.ty = homeY;
        }
        if (reduced) { actor.x = actor.tx; actor.y = actor.ty; actor.walking = false; }

        layout.push(entry);
      });
    });

    for (const id of [...actors.keys()]) {
      if (!seen.has(id)) actors.delete(id);
    }
  }

  function poseFor(state) {
    const S = root.YardSprites;
    if (state === 'working' || state === 'onduty' || state === 'arriving' || state === 'confused') return S.SIT;
    if (state === 'nap' || state === 'hibernate') return S.SLEEP;
    return S.LOAF;
  }
  // 只有「真在生成」和「刚开工」的猫才坐进工作亭书桌；在岗(空闲)不占书桌
  const seatEligible = (state) => state === 'working' || state === 'arriving';

  function poseOf(entry, sleepAll) {
    const S = root.YardSprites;
    if (entry.actor.walking) return S.LOAF;
    if (entry.actor.watchUntil > tick) return S.SIT; // 坐在池边看锦鲤
    if (sleepAll && (entry.state === 'play' || entry.state === 'rest')) return S.SLEEP;
    return poseFor(entry.state);
  }

  // ── 行为池：散步 / 看锦鲤 / 原地待着 ─────────────────
  function chooseBehavior(entry) {
    const a = entry.actor;
    const r = Math.random();
    if (r < 0.45) {
      a.tx = clamp(entry.home.x + (Math.random() * 56 - 28), entry.band.x0, entry.band.x1);
      a.ty = clamp(entry.home.y + (Math.random() * 24 - 9), 96, H - 26);
    } else if (r < 0.62 && Math.abs(entry.home.x - POND.cx) < 190) {
      a.tx = POND.x0 + 6 + Math.random() * (POND.x1 - POND.x0 - 12);
      a.ty = 90;
      a.watchUntil = tick + 70 + Math.floor(Math.random() * 80);
    }
    // 其余：原地待着
    a.behaveAt = tick + 90 + Math.floor(Math.random() * 170); // 11〜32 秒后再想下一件事
  }

  function stepActors(sleepAll) {
    for (const entry of layout) {
      const a = entry.actor;
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1.2) {
        const step = Math.min(WALK_SPEED, dist);
        a.x += (dx / dist) * step;
        a.y += (dy / dist) * step;
        if (dx > 0.3) a.flip = true;
        else if (dx < -0.3) a.flip = false;
        a.walking = true;
        continue;
      }
      if (a.walking) { a.x = a.tx; a.y = a.ty; a.walking = false; }
      const wander = (entry.state === 'play' || entry.state === 'rest') && !entry.seat;
      if (wander && !sleepAll && a.watchUntil <= tick && tick >= a.behaveAt) {
        chooseBehavior(entry);
      }
    }
  }

  // ── 覆盖层：常驻名牌 + 区域木牌标签 ──────────────────
  function syncChips() {
    if (!overlay) return;
    const meta = root.YardCats ? root.YardCats.STATE_META : {};
    const energyMeta = root.YardEnergy ? root.YardEnergy.ENERGY_META : {};
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
        const dot = document.createElement('span');
        dot.className = 'app-dot';
        const energy = document.createElement('span');
        energy.className = 'energy-pip';
        energy.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'plate-name';
        chip.append(dot, label, energy);
        chip.addEventListener('click', () => { if (onSelect) onSelect(id); });
        // 指名牌 = 指猫：双向联动高亮
        chip.addEventListener('mouseenter', () => setHoverId(id));
        chip.addEventListener('mouseleave', () => setHoverId(null));
        overlay.appendChild(chip);
      }
      const stateLabel = meta[entry.state] ? meta[entry.state].label : entry.state;
      const energyLabel = energyMeta[entry.energy] ? energyMeta[entry.energy].label : '额度未知';
      chip.querySelector('.plate-name').textContent = entry.profile.name;
      chip.querySelector('.app-dot').style.background = (root.YardSprites.APP_TAG[entry.profile.appId]) || '#d96f33';
      chip.title = `${entry.profile.name} · ${stateLabel} · ${energyLabel}${entry.profile.group ? ' · ' + entry.profile.group : ''}`;
      chip.dataset.energy = entry.energy;
      chip.classList.toggle('selected', id === data.selectedId);
      chip.classList.toggle('hovered', id === hoveredId);
      chip.classList.toggle('tier1', entry.tier === 1);
      chip.classList.toggle('tier2', entry.tier === 2);
      entry.actor._chip = chip;
      entry.actor._chipKey = '';
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

    syncDropZones(Boolean(pointerCandidate && pointerCandidate.dragging));
    syncSpeech();
    syncChipPositions();
  }

  function syncDropZones(visible) {
    if (!overlay || !root.YardInteractions) return;
    const seen = new Set();
    root.YardInteractions.ZONES.forEach((zone) => {
      seen.add(zone.id);
      let el = overlay.querySelector(`.yard-drop-zone[data-zone="${zone.id}"]`);
      if (!el) {
        el = document.createElement('span');
        el.className = 'yard-drop-zone';
        el.dataset.zone = zone.id;
        const label = document.createElement('b');
        label.textContent = zone.label;
        const hint = document.createElement('small');
        hint.textContent = zone.hint;
        el.append(label, hint);
        overlay.appendChild(el);
      }
      el.hidden = !visible;
      el.classList.toggle('active', visible && activeDropZoneId === zone.id);
      el.style.left = `${(zone.x0 / W * 100).toFixed(2)}%`;
      el.style.top = `${(zone.y0 / H * 100).toFixed(2)}%`;
      el.style.width = `${((zone.x1 - zone.x0) / W * 100).toFixed(2)}%`;
      el.style.height = `${((zone.y1 - zone.y0) / H * 100).toFixed(2)}%`;
    });
    overlay.querySelectorAll('.yard-drop-zone').forEach((el) => {
      if (!seen.has(el.dataset.zone)) el.remove();
    });
  }

  function currentSpeech(entry) {
    const attention = data.attentionById && data.attentionById[entry.profile.id];
    if (attention && attention.text) {
      return { text: String(attention.text), kind: attention.kind || 'system', persistent: true };
    }
    const ambient = speechById.get(entry.profile.id);
    if (!ambient) return null;
    if (ambient.expiresAt <= Date.now()) {
      speechById.delete(entry.profile.id);
      return null;
    }
    return ambient;
  }

  function syncSpeech() {
    if (!overlay) return;
    const seen = new Set();
    for (const entry of layout) {
      const speech = currentSpeech(entry);
      const id = entry.profile.id;
      if (!speech) continue;
      seen.add(id);
      let bubble = overlay.querySelector(`.yard-speech[data-id="${id}"]`);
      if (!bubble) {
        bubble = document.createElement('button');
        bubble.type = 'button';
        bubble.className = 'yard-speech';
        bubble.dataset.id = id;
        bubble.addEventListener('click', () => { if (onSelect) onSelect(id); });
        overlay.appendChild(bubble);
      }
      bubble.textContent = speech.text.slice(0, 42);
      bubble.dataset.kind = speech.kind || 'ambient';
      bubble.title = `${entry.profile.name}：${speech.text}`;
      entry.actor._speech = bubble;
      entry.actor._speechKey = '';
    }
    overlay.querySelectorAll('.yard-speech').forEach((bubble) => {
      if (!seen.has(bubble.dataset.id)) bubble.remove();
    });
    syncSpeechPositions();
  }

  // 名牌跟随猫移动（每帧只写有变化的）
  function syncChipPositions() {
    for (const entry of layout) {
      const a = entry.actor;
      const chip = a._chip;
      if (!chip) continue;
      const lift = [3, 15, 27][entry.tier] || 3; // 三档抬高，与 CSS 的 tier1/tier2 吊线对应
      const key = `${a.x.toFixed(1)}|${entry.topY}|${lift}`;
      if (a._chipKey === key) continue;
      a._chipKey = key;
      chip.style.left = `${(a.x / W * 100).toFixed(2)}%`;
      chip.style.top = `${((entry.topY - lift) / H * 100).toFixed(2)}%`;
    }
    syncSpeechPositions();
  }

  function syncSpeechPositions() {
    for (const entry of layout) {
      const a = entry.actor;
      const bubble = a._speech;
      if (!bubble || !bubble.isConnected) continue;
      const lift = [30, 47, 59][entry.tier] || 30;
      const key = `${a.x.toFixed(1)}|${entry.topY}|${lift}`;
      if (a._speechKey === key) continue;
      a._speechKey = key;
      bubble.style.left = `${(a.x / W * 100).toFixed(2)}%`;
      bubble.style.top = `${((entry.topY - lift) / H * 100).toFixed(2)}%`;
    }
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
  function drawNote(x, y, c) { rect(x + 2, y, 1, 4, c); rect(x + 2, y, 2, 1, c); rect(x, y + 3, 2, 2, c); }
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
    if (P.stars && weather === 'clear') {
      STAR_DOTS.forEach(([x, y], i) => { if ((tick + i) % 16 < 12) rect(x, y, 1, 1, i % 3 ? '#cdd3ee' : '#ffffff'); });
    }
    // 多云 / 雨天不见日月
    if (weather !== 'cloudy' && weather !== 'rain') {
      const [ox, oy] = P.orbXY;
      rect(ox - 4, oy - 3, 8, 6, P.orb); rect(ox - 3, oy - 4, 6, 8, P.orb); rect(ox - 5, oy - 1, 10, 2, P.orb);
      if (P.stars) rect(ox - 2, oy - 2, 3, 3, mix(P.orb, P.skyA, 0.55));
    }
    // 云：多云 / 雨天更多更密
    const cloudColor = P.stars ? 'rgba(190,198,232,.25)' : 'rgba(255,255,255,.85)';
    const cloudN = (weather === 'cloudy' || weather === 'rain') ? 4 : 2;
    const cx = Math.round((tick * 0.2) % (W + 80)) - 40;
    for (let k = 0; k < cloudN; k++) {
      const x = (cx + k * 130) % (W + 80) - 40;
      const y = 3 + (k % 2) * 11;
      const c = (weather === 'rain') ? 'rgba(150,158,178,.8)' : cloudColor;
      rect(x, y + 2, 24, 3, c); rect(x + 4, y, 12, 3, c); rect(x + 15, y + 1, 8, 2, c);
    }
  }

  // 天气特效：逐帧粒子 + 光照 overlay（画在猫和地形之上）
  function drawWeather(P) {
    if (weather === 'rain') {
      ctx.fillStyle = P.stars ? 'rgba(150,170,210,.5)' : 'rgba(180,200,235,.55)';
      for (let i = 0; i < rainDrops.length; i++) {
        const base = rainDrops[i];
        const y = pmod(base[1] + tick * 9 + i * 7, H + 24) - 12;
        const x = pmod(base[0] - tick * 3, W);
        ctx.fillRect(Math.round(x), Math.round(y), 1, 4);
        ctx.fillRect(Math.round(x) + 1, Math.round(y) + 2, 1, 2);
      }
    } else if (weather === 'snow') {
      ctx.fillStyle = '#f4f8ff';
      for (let i = 0; i < snowFlakes.length; i++) {
        const base = snowFlakes[i];
        const y = pmod(base[1] + tick * 2 + i * 5, H + 24) - 12;
        const x = pmod(base[0] + Math.sin((tick * 0.05) + i) * 6, W);
        ctx.fillRect(Math.round(x), Math.round(y), i % 4 ? 1 : 2, i % 4 ? 1 : 2);
      }
    }
  }

  // 天气整体光照罩（叠在最上层，和夜幕叠加）
  function weatherOverlay() {
    if (weather === 'cloudy') return 'rgba(108,114,132,.16)';
    if (weather === 'rain') return 'rgba(46,58,86,.24)';
    if (weather === 'snow') return 'rgba(214,224,240,.10)';
    return null;
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

  function drawFlowerBed(P) {
    rect(302, 58, 48, 10, mix(P.grass, '#4a7034', 0.5));
    [[306, 60, '#e8a0b8'], [313, 63, '#f0d060'], [320, 59, '#f8f0e0'], [328, 62, '#e8a0b8'], [336, 60, '#f0d060'], [343, 63, '#f8f0e0']].forEach(([x, y, c]) => {
      rect(x, y, 2, 2, c); rect(x, y + 2, 1, 2, '#4a7034');
    });
  }

  function drawButterfly() {
    if (reduced) return;
    const bt = tick * 0.1;
    const bx = Math.round(326 + Math.cos(bt) * 14);
    const by = Math.round(52 + Math.sin(bt * 1.7) * 4);
    const open = tick % 4 < 2;
    rect(bx, by, 1, 2, '#d97a3a');
    if (open) { rect(bx - 1, by, 1, 1, '#f0b060'); rect(bx + 1, by, 1, 1, '#f0b060'); } else rect(bx, by - 1, 1, 1, '#f0b060');
  }

  function drawMailbox() {
    rect(116, 54, 3, 16, WOODD);
    frameRect(110, 46, 15, 9, '#c05a3a', LINE);
    rect(111, 47, 4, 7, '#d97a52');
    if (tick < mailboxFlagUntil) {
      rect(123, 42, 1, 6, '#e8c04a');
      rect(122, 42, 3, 2, '#e05a3a'); // 小旗升起：有信！
    } else {
      rect(123, 48, 1, 4, '#e8c04a');
    }
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

  // 远景：地平线后的山丘剪影 + 几棵小树，给宽横带补纵深
  function drawBackdrop(P) {
    const hill = mix(P.hedge, P.skyB, 0.35);
    const hill2 = mix(P.hedge2, P.skyB, 0.25);
    // 缓丘（阶梯像素弧）
    [[-10, 30, 90, hill], [110, 27, 120, hill2], [250, 31, 110, hill], [360, 28, 130, hill2]].forEach(([x0, top, w, c]) => {
      for (let s = 0; s < 4; s++) rect(x0 + s * 4, top + s, w - s * 8, 40 - top - s, c);
    });
    // 远处小树（简化圆冠）
    const far = mix(P.leaf1, P.skyB, 0.4);
    [[150, 22], [300, 20], [78, 24]].forEach(([tx, ty]) => {
      rect(tx + 2, ty + 6, 2, 6, mix(WOODD, P.skyB, 0.3));
      rect(tx - 3, ty, 12, 8, far); rect(tx - 1, ty - 3, 8, 5, far);
    });
  }

  // 前景草坪带（y≥132）：小径延伸、踏石、灌木、花圃、石块与草簇。
  // 与上半场同一像素语言：同调色、2px 网格、硬阴影。
  function drawForeground(P) {
    const path = mix(P.grass, '#d8c49a', P.stars ? 0.35 : 0.6);
    // 主径向下延伸，再向右岔到前景中部
    rect(52, 104, 12, 96, path);
    rect(52, 188, 96, 12, path);
    for (let i = 0; i < 11; i++) rect(55 + (i % 2) * 5, 108 + i * 8, 3, 2, mix(path, LINE, 0.18));
    for (let i = 0; i < 6; i++) rect(66 + i * 14, 192 + (i % 2) * 3, 3, 2, mix(path, LINE, 0.18));
    // 踏石：池塘下方一串
    [[210, 150], [232, 162], [254, 152], [276, 164]].forEach(([x, y]) => {
      rect(x, y, 8, 4, STONE);
      rect(x + 1, y + 4, 6, 1, mix(STONE, LINE, 0.35));
    });
    // 左下灌木丛
    rect(24, 196, 26, 12, P.leaf1);
    rect(28, 192, 18, 8, P.leaf2);
    rect(20, 200, 32, 8, P.leaf1);
    ctx.fillStyle = 'rgba(20,30,20,.12)'; ctx.fillRect(22, 206, 30, 3);
    // 右下花圃（与上半场花圃同款）
    rect(376, 178, 48, 10, mix(P.grass, '#4a7034', 0.5));
    [[380, 180, '#e8a0b8'], [387, 183, '#f0d060'], [394, 179, '#f8f0e0'], [402, 182, '#e8a0b8'], [410, 180, '#f0d060'], [417, 183, '#f8f0e0']].forEach(([x, y, c]) => {
      rect(x, y, 2, 2, c); rect(x, y + 2, 1, 2, '#4a7034');
    });
    // 零星石块
    [[150, 170], [330, 146], [430, 214], [96, 158]].forEach(([x, y]) => {
      rect(x, y, 5, 3, STONE);
      rect(x + 1, y - 1, 3, 1, mix(STONE, '#ffffff', 0.25));
    });
    // 草簇（比噪点大一号的三叶草叶）
    [[120, 200], [200, 216], [300, 190], [360, 210], [70, 146], [250, 176]].forEach(([x, y], i) => {
      const g = i % 2 ? P.grassD : mix(P.grassD, '#ffffff', 0.1);
      rect(x, y, 1, 3, g); rect(x + 2, y + 1, 1, 2, g); rect(x - 2, y + 1, 1, 2, g);
    });
  }

  function drawBush(P) {
    // 池塘右侧一丛灌木，填补空旷
    const b1 = P.leaf1, b2 = P.leaf2;
    rect(300, 112, 26, 12, b1);
    rect(304, 108, 18, 8, b2);
    rect(298, 116, 30, 8, b1);
    rect(308, 106, 8, 5, b2);
    ctx.fillStyle = 'rgba(20,30,20,.12)'; ctx.fillRect(298, 122, 30, 3);
  }

  function drawTree(P) {
    // 更大更满的树冠（对齐设计稿的大树感）
    rect(424, 30, 8, 58, WOODD); rect(420, 84, 16, 4, WOODD);
    rect(426, 44, 3, 20, mix(WOODD, LINE, 0.3)); // 树皮纹
    rect(392, 6, 76, 26, P.leaf1);
    rect(400, 0, 60, 12, P.leaf2);
    rect(384, 14, 18, 18, P.leaf2);
    rect(458, 12, 18, 18, P.leaf2);
    rect(410, 26, 40, 8, P.leaf1);
    ctx.fillStyle = mix(P.leaf2, '#ffffff', 0.12); // 高光
    rect(404, 3, 20, 4, ctx.fillStyle); rect(430, 8, 16, 3, ctx.fillStyle);
    ctx.fillStyle = 'rgba(20,30,20,.14)';
    ctx.fillRect(398, 88, 56, 8);
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

  function drawDesk(cx, typing) {
    frameRect(cx - 12, 61, 24, 9, WOOD, LINE);
    rect(cx - 11, 62, 22, 2, WOODL);
    rect(cx - 8, 55, 10, 6, '#3a3f4a');
    // 干活中屏幕闪烁；在岗（idle）屏幕常亮
    rect(cx - 7, 56, 8, 4, typing ? ((tick % 8 < 4) ? '#9fd4e8' : '#b8e4f0') : '#7fb8cc');
    rect(cx + 5, 58, 3, 3, '#c05a3a');
    if (!reduced && tick % 8 < 4) { // 咖啡热气（两态都有）
      rect(cx + 6, 55, 1, 1, 'rgba(255,255,255,.7)');
      rect(cx + 5, 53, 1, 1, 'rgba(255,255,255,.4)');
    }
  }

  function drawSign(x) {
    rect(x + 15, 84, 3, 12, WOODD);
    frameRect(x, 76, 34, 11, WOODL, LINE);
    rect(x + 2, 78, 30, 1, 'rgba(255,255,255,.25)');
  }

  function drawEnergyCue(entry, dx, dy, pw, seed) {
    if (entry.actor.walking || entry.state === 'confused') return;
    if (entry.energy === 'fresh') {
      // A tiny, intermittent four-pixel sparkle: visible without turning the
      // yard into a dashboard or changing the cat's activity pose.
      if ((tick + seed) % 32 < 10) {
        const sx = dx + pw + 2;
        const sy = dy - 3 - (((tick + seed) >> 2) % 2);
        rect(sx, sy - 1, 1, 3, '#f4c76a');
        rect(sx - 1, sy, 3, 1, '#f4c76a');
      }
      return;
    }
    if (entry.energy === 'tired') {
      if ((tick + seed) % 24 < 16) {
        const dropY = dy + 1 + (((tick + seed) >> 3) % 2);
        rect(dx + pw + 1, dropY, 1, 2, '#78bfd7');
        rect(dx + pw, dropY + 2, 2, 1, '#78bfd7');
      }
      return;
    }
    if (entry.energy === 'exhausted') {
      const bx = dx + pw - 1;
      const by = dy - 7;
      frameRect(bx, by, 7, 4, '#f7f1dd', LINE);
      rect(bx + 7, by + 1, 1, 2, LINE);
      rect(bx + 1, by + 1, 1, 2, '#c94f2e');
    }
  }

  // ── 猫 ───────────────────────────────────────────────
  function drawYardCat(entry, sleepAll) {
    const S = root.YardSprites;
    const a = entry.actor;
    const pose = poseOf(entry, sleepAll);
    const pal = S.BREEDS[entry.profile.cat && entry.profile.cat.breed] || S.BREEDS.orange;
    const pw = pose[0].length;
    const ph = pose.length;
    const seed = seedOf(entry.profile);
    const energy = entry.energy || 'unknown';
    const seated = entry.seat && !a.walking && !a.dragging;
    let dx = Math.round(a.x - pw / 2);
    let dy = Math.round(a.y - ph);
    if (seated) dy -= 6; // 坐小凳，头露出书桌
    if (a.walking) dy -= (tick + seed) % 2;                          // 小碎步
    if (seated && entry.state === 'working') {
      // 额度疲劳只调节动作节奏，不改变 working/onduty 等活动状态。
      const pace = energy === 'tired' || energy === 'exhausted' ? 5 : 3;
      dy -= ((tick + seed) >> pace) % 2;
    }
    if (!a.walking && entry.state === 'confused') dx += (tick % 8 < 4) ? 0 : 1;
    if (!a.walking && !sleepAll && entry.state === 'play' && a.watchUntil <= tick) {
      dy -= Math.abs(Math.sin((tick + seed) * 0.5)) > 0.7 ? 2 : 0;   // 扑线团小跳
    }
    entry.topY = dy;

    // 选中 / 悬停圈（虚线）
    const isSel = entry.profile.id === data.selectedId;
    if (isSel || entry.profile.id === hoveredId) {
      ctx.fillStyle = isSel
        ? (root.YardSprites.APP_TAG[entry.profile.appId] || '#d96f33')
        : 'rgba(255,255,255,.55)';
      for (let i = 0; i < pw + 4; i += 3) ctx.fillRect(dx - 2 + i, Math.round(a.y) + 1, 2, 1);
    }

    const cat = entry.profile.cat || {};
    S.drawCat(ctx, pose, pal, {
      dx, dy, scale: 1, seed,
      blink: ((tick + seed) % 40) < 3,
      collar: cat.collar,
      bell: entry.profile.isProtected,
      tag: entry.profile.isProtected ? null : entry.profile.appId,
      accessory: cat.accessory === 'none' ? null : cat.accessory,
      flip: a.flip,
      tail: (tick + seed) % 24 < 12
    });
    drawEnergyCue(entry, dx, dy, pw, seed);

    if (entry.state === 'working' && !a.walking) {
      if (entry.seatAnchor) drawDesk(entry.seatAnchor.x, true);
      else { // 没抢到书桌的加班猫：草地办公
        rect(dx + 2, Math.round(a.y) - 6, 10, 5, '#3a3f4a');
        rect(dx + 3, Math.round(a.y) - 5, 8, 3, (tick % 8 < 4) ? '#9fd4e8' : '#b8e4f0');
      }
    }
    // 在岗：App 开着但空闲。醒着端坐在自家区域，头顶偶尔冒个小气泡，明确区别于「干活中」
    if (entry.state === 'onduty' && !a.walking && (tick + seed) % 40 < 3) {
      rect(dx + pw, dy - 4, 2, 2, 'rgba(120,140,170,.7)');
    }
    if (entry.state === 'arriving') {
      rect(dx + pw, dy - 6, 2, 5, '#e8c04a');
      rect(dx + pw, dy - 7, 2, 1, LINE);
    }
    if (!a.walking && entry.state === 'confused' && (tick % 20) < 14) drawQBubble(dx + pw - 2, dy - 11);
    if (!a.walking && !sleepAll && entry.state === 'play' && a.watchUntil <= tick) {
      const yx = dx - 7 + (((tick + seed) >> 3) % 2);
      rect(yx, Math.round(a.y) - 4, 4, 4, '#d05a7a');
      rect(yx + 1, Math.round(a.y) - 3, 2, 1, '#f0a0b8');
    }
    if (!a.walking && entry.state === 'hibernate') {
      frameRect(dx - 3, dy + 2, pw + 6, ph + 4, '#c9a25f', LINE);
      rect(dx - 2, dy + 3, pw + 4, 3, '#b8894a');
      rect(dx - 1, dy + 4, pw + 2, 1, cat.collar || '#8a6bb8');
    }
    if (pose === S.SLEEP && !reduced && (tick + seed) % 16 === 0 && particles.length < 48) {
      particles.push({ kind: 'z', x: dx + pw - 2, y: dy - 2, age: 0 });
    }
  }

  function drawParticles() {
    particles = particles.filter((p) => p.age < (p.dur || 26));
    particles.forEach((p) => {
      p.age += 1;
      if (p.age < 0) return; // 错峰出场
      if (p.kind === 'mail') {
        const k = p.age / p.dur;
        const mx = Math.round(p.sx + (MAILBOX.x - p.sx) * k);
        const my = Math.round(p.sy + (MAILBOX.y - p.sy) * k - Math.sin(Math.PI * k) * 12);
        ctx.globalAlpha = 1;
        frameRect(mx, my, 8, 6, '#fdf8ec', LINE);
        rect(mx + 1, my + 1, 6, 1, '#d9c9a8');
        return;
      }
      ctx.globalAlpha = Math.max(0, 1 - p.age / 24);
      if (p.kind === 'z') drawZ(Math.round(p.x + ((p.age >> 2) % 2)), Math.round(p.y - p.age * 0.5), '#faf5e6');
      if (p.kind === 'heart') drawHeart(Math.round(p.x + Math.sin(p.age * 0.4) * 2), Math.round(p.y - p.age * 0.8), '#e06a8a');
      if (p.kind === 'note') drawNote(Math.round(p.x + Math.sin(p.age * 0.5) * 2), Math.round(p.y - p.age * 0.7), '#f7ecd0');
      ctx.globalAlpha = 1;
    });
  }

  // 静态地形离屏缓存：只随昼夜重建，其余帧直接 blit
  function ensureTerrain(P) {
    if (!terrainCanvas) {
      terrainCanvas = document.createElement('canvas');
      terrainCanvas.width = W;
      terrainCanvas.height = H;
      terrainCtx = terrainCanvas.getContext('2d');
      terrainCtx.imageSmoothingEnabled = false;
    }
    const key = effectiveTimeKey();
    if (key === terrainKey) return terrainCanvas;

    // 临时把画笔指向离屏 ctx，复用现有 draw* 函数，画完复位
    const mainCtx = ctx;
    ctx = terrainCtx;
    try {
      ctx.clearRect(0, 0, W, H);
      drawBackdrop(P);
      drawGround(P);
      drawForeground(P);
      drawFence();
      drawFlowerBed(P);
      drawBush(P);
      drawTree(P);
      drawHut(P);
    } finally {
      ctx = mainCtx;
    }
    terrainKey = key;
    return terrainCanvas;
  }

  // ── 主渲染 ───────────────────────────────────────────
  function render() {
    if (!ctx) return;
    weather = effectiveWeatherKey();
    const P = TIMES[effectiveTimeKey()];
    const sleepAll = sleepAllNow();
    ctx.clearRect(0, 0, W, H);
    drawSky(P);
    // 静态地形一次性 blit（先于邮筒/池塘）。不变式：地形层（工作亭/树）与逐帧的
    // 邮筒/池塘在 x 上不重叠——否则调整坐标会静默改变遮挡关系。改坐标时留意。
    ctx.drawImage(ensureTerrain(P), 0, 0);
    drawButterfly();
    drawMailbox();
    drawPond(P);
    zones.forEach((zone) => drawSign(zone.x));
    [...layout].sort((a, b) => a.actor.y - b.actor.y).forEach((entry) => drawYardCat(entry, sleepAll));
    drawParticles();
    for (let x = 0; x < W; x += 10) rect(x + (x % 20 ? 3 : 6), H - 4, 2, 4, P.grassD);
    drawWeather(P); // 雨/雪落在前景

    if (P.overlay) { ctx.fillStyle = P.overlay; ctx.fillRect(0, 0, W, H); }
    const wOverlay = weatherOverlay();
    if (wOverlay) { ctx.fillStyle = wOverlay; ctx.fillRect(0, 0, W, H); }
    if (P.stars) {
      ctx.fillStyle = 'rgba(244,199,106,.9)'; ctx.fillRect(81, 39, 11, 10);
      ctx.fillStyle = 'rgba(244,199,106,.18)'; ctx.fillRect(74, 34, 26, 20);
      layout.forEach((entry) => {
        if (entry.state === 'working' && !entry.actor.walking) {
          ctx.fillStyle = 'rgba(244,199,106,.14)';
          ctx.fillRect(Math.round(entry.actor.x) - 16, Math.round(entry.actor.y) - 26, 32, 26);
        }
      });
      if (weather === 'clear') {
        FIREFLIES.forEach(([fx, fy], i) => {
          if ((tick + i * 5) % 22 < 14) {
            const t = tick * 0.08 + i;
            ctx.fillStyle = 'rgba(220,240,140,.95)';
            ctx.fillRect(Math.round(fx + Math.cos(t) * 6), Math.round(fy + Math.sin(t * 1.4) * 4), 1, 1);
          }
        });
      }
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
      const a = entry.actor;
      // 命中区：猫身 + 向上延伸到名牌吊线，消除猫和高位名牌之间的 hover 死区
      const reach = entry.tier === 1 ? 18 : 6;
      const inBox = Math.abs(lx - a.x) <= 13 && ly >= entry.topY - reach && ly <= a.y + 3;
      if (!inBox) continue;
      const d = Math.hypot(lx - a.x, ly - (a.y - 6));
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
      if (pointerCandidate && pointerCandidate.pointerId === event.pointerId) {
        const dx = lx - pointerCandidate.startX;
        const dy = ly - pointerCandidate.startY;
        if (!pointerCandidate.dragging && Math.hypot(dx, dy) >= 3) {
          clearTimeout(pressTimer);
          pointerCandidate.dragging = true;
          pointerCandidate.entry.actor.dragging = true;
          pointerCandidate.entry.actor.walking = false;
          canvas.classList.add('is-dragging');
          syncDropZones(true);
        }
        if (pointerCandidate.dragging) {
          event.preventDefault();
          const actor = pointerCandidate.entry.actor;
          actor.x = clamp(lx, 10, W - 10);
          actor.y = clamp(ly, 68, H - 6);
          actor.tx = actor.x;
          actor.ty = actor.y;
          const zone = root.YardInteractions ? root.YardInteractions.zoneAt(actor.x, actor.y) : null;
          activeDropZoneId = zone ? zone.id : null;
          setHoverId(pointerCandidate.entry.profile.id);
          syncDropZones(true);
          render();
          syncChipPositions();
          return;
        }
      }
      const hit = catAt(lx, ly);
      setHoverId(hit ? hit.profile.id : null);
    });
    canvas.addEventListener('pointerleave', () => {
      if (!pointerCandidate || !pointerCandidate.dragging) setHoverId(null);
    });
    canvas.addEventListener('pointerdown', (event) => {
      const [lx, ly] = logicalXY(event);
      const hit = catAt(lx, ly);
      pressed = false;
      suppressClick = false;
      clearTimeout(pressTimer); // 清掉上一次未结束的长按计时，避免幽灵撸猫
      if (!hit) return;
      pointerCandidate = {
        pointerId: event.pointerId,
        entry: hit,
        startX: lx,
        startY: ly,
        dragging: false
      };
      try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* best effort */ }
      pressTimer = setTimeout(() => {
        if (!pointerCandidate || pointerCandidate.dragging) return;
        pressed = true;
        for (let i = 0; i < 5; i++) {
          particles.push({ kind: 'heart', x: hit.actor.x - 6 + i * 4, y: hit.topY - 2 - (i % 2) * 4, age: i * 2 });
        }
        if (onPet) onPet(hit.profile);
        if (reduced || !active) render();
      }, 400);
    });
    const finishPointer = (event, cancelled = false) => {
      clearTimeout(pressTimer);
      if (!pointerCandidate || pointerCandidate.pointerId !== event.pointerId) return;
      const candidate = pointerCandidate;
      pointerCandidate = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_error) { /* best effort */ }

      if (candidate.dragging) {
        suppressClick = true;
        candidate.entry.actor.dragging = false;
        canvas.classList.remove('is-dragging');
        const point = root.YardInteractions
          ? root.YardInteractions.normalizePoint({ x: candidate.entry.actor.x, y: candidate.entry.actor.y })
          : { x: candidate.entry.actor.x, y: candidate.entry.actor.y };
        const zone = !cancelled && root.YardInteractions
          ? root.YardInteractions.zoneAt(point.x, point.y)
          : null;
        let keepPosition = false;
        if (!cancelled && onDrop) {
          try {
            const result = onDrop({
              profile: candidate.entry.profile,
              state: candidate.entry.state,
              point,
              zone
            });
            keepPosition = result === true || Boolean(result && result.keepPosition);
          } catch (_error) {
            keepPosition = false;
          }
        }
        if (keepPosition) {
          candidate.entry.home = { ...point };
          candidate.entry.actor.tx = point.x;
          candidate.entry.actor.ty = point.y;
        } else {
          const returnPoint = candidate.entry.seatAnchor || candidate.entry.home;
          candidate.entry.actor.tx = returnPoint.x;
          candidate.entry.actor.ty = returnPoint.y;
        }
        activeDropZoneId = null;
        syncDropZones(false);
        render();
        syncChipPositions();
      }
    };
    canvas.addEventListener('pointerup', (event) => finishPointer(event, false));
    canvas.addEventListener('pointercancel', (event) => finishPointer(event, true));
    canvas.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
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
      stepActors(sleepAllNow());
      render();
      syncChipPositions();
      if (tick % 8 === 0) syncSpeech();
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
      onDrop = options.onDrop || null;
      ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      bindPointer();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && active) render(); });
      render();
    },
    update(next) {
      data = { ...data, ...next };
      computeLayout();
      render();
      syncChips();
    },
    setActive(value) {
      active = Boolean(value);
      if (active) { startLoop(); render(); } else stopLoop();
    },
    // 设置时段 / 天气。auto 分别跟随系统时钟与本地慢速氛围调度。
    setAtmosphere(next) {
      if (next && TIME_KEYS.includes(next.time)) timeOverride = next.time;
      if (next && (next.weather === 'auto' || WEATHERS.includes(next.weather))) {
        weatherOverride = next.weather;
      }
      terrainKey = null;
      render();
      return this.getAtmosphere();
    },
    refreshAtmosphere() {
      const before = `${effectiveTimeKey()}:${weather}`;
      weather = effectiveWeatherKey();
      const after = `${effectiveTimeKey()}:${weather}`;
      if (before !== after) terrainKey = null;
      render();
      return this.getAtmosphere();
    },
    getAtmosphere() {
      const autoWeather = root.YardAtmosphere
        ? root.YardAtmosphere.weatherForDate(new Date())
        : { weather: 'clear', nextChangeAt: null };
      return {
        timeMode: timeOverride,
        time: effectiveTimeKey(),
        weatherMode: weatherOverride,
        weather: effectiveWeatherKey(),
        nextWeatherAt: weatherOverride === 'auto' ? autoWeather.nextChangeAt : null
      };
    },
    say(profileId, message = {}) {
      if (!profileId || !message.text) return false;
      speechById.set(profileId, {
        text: String(message.text),
        kind: message.kind || 'ambient',
        expiresAt: Date.now() + clamp(Number(message.duration) || 2600, 800, 10_000)
      });
      syncSpeech();
      return true;
    },
    // 场景反馈：handoff = 选中的猫把交接信投进邮筒；bell = 摇铃，全体猫头上冒音符
    fx(kind) {
      if (kind === 'handoff') {
        const entry = layout.find((e) => e.profile.id === data.selectedId);
        if (entry) {
          particles.push({ kind: 'mail', sx: entry.actor.x, sy: entry.topY - 4, age: 0, dur: 22 });
          mailboxFlagUntil = tick + 44;
        }
      }
      if (kind === 'bell') {
        layout.forEach((entry, i) => {
          if (particles.length < 48) particles.push({ kind: 'note', x: entry.actor.x + 6, y: entry.topY - 4, age: -i * 2 });
        });
      }
      if (kind === 'stretch') {
        // 伸懒腰：干活的猫头顶冒音符，提示该起身活动了
        layout.filter((e) => e.state === 'working').forEach((entry, i) => {
          if (particles.length < 47) {
            particles.push({ kind: 'note', x: entry.actor.x + 5, y: entry.topY - 4, age: -i * 3 });
            particles.push({ kind: 'note', x: entry.actor.x - 6, y: entry.topY - 2, age: -i * 3 - 6 });
          }
        });
      }
      if (reduced || !active) render();
    }
  };
})(typeof self !== 'undefined' ? self : this);
