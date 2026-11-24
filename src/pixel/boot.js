/*
 * AgentDesk — 开灯与关灯。
 *
 * 启动是“开灯”：窗口出现时桌子是暗的，灯分三档亮起来，搁板从左向右伸出去，名牌顺着绳子落下来回弹一下，
 * 每只猫在自己的数据到了以后从搁板后面跳上来、落地压一下身子，账本摊开、会话一行行从左写进来（最多演十二行），
 * 最后页脚说第一句话。每扇窗只演一次；后台刷新不再演。macOS 关窗后重新打开只短短地开一下灯。
 * 数据还没到时不转圈、不放进度条：搁板和空白名牌先在，猫是一个网点影子，账本摊开着只有点线空行，
 * 等过两秒页脚如实说在等哪一步（取自 renderer 派发的 'agentdesk:startup'）。
 * 打开之后：新来的猫让后面的卡片挪出位置、搁板长一截、名牌落下、猫跳上来；送走的猫跳下去、名牌被提上去、后面的卡片挪过来补位。
 * 关闭是“关灯”：猫一只接一只趴下睡，账本合上，灯分三档暗下去，窗口关闭。主进程先关它启动的客户端时，灯留一档、
 * 页脚写着在关哪几个，每关好一个对应的猫先睡下；关不掉时灯重新亮起来。主进程从不等这里：它有自己的硬上限。
 *
 * 动的规矩：位置落在 2px 的格子上，走先快后慢的路，一段六到八帧、步子一帧比一帧小；落下的回弹一次，
 * 跳起来的落地压扁一帧；明暗只用台阶，不用透明度渐变；一组东西错开 40–60ms、整组不超过半秒（行太多时间隔缩短以守住半秒）；
 * 任何指针或按键直接跳到最后的样子；系统要求减少动态效果时一律直接出现。
 *
 * 它不拥有任何业务状态，只读 DOM。每一步在 document 上派发 'agentdesk:lamp'（CustomEvent，detail.step 见 STEPS），
 * 声音之类的呈现层可以挂上去。这个文件放在 <head> 里先执行，第一帧之前就把窗口盖成夜色。
 */
(function (root) {
  'use strict';

  const FRAME = 32;
  // 启动时间表（毫秒，从灯开始亮算起）。
  const TIMELINE = Object.freeze({ lamp: [60, 140, 220], shelf: 160, tags: 300, cats: 420, ledger: 700, wait: 2000, giveUp: 15000 });
  const SHORT_LAMP = Object.freeze([0, 40, 80]);
  const LIMIT = Object.freeze({ budget: 500, minGap: 24, maxGap: 60, rows: 12, seats: 8 });
  const DROP = 112;
  const STEPS = Object.freeze([
    'boot-start', 'lamp', 'shelf', 'tag', 'cat', 'ledger-open', 'rows', 'waiting', 'ready', 'skip',
    'cat-join', 'cat-leave', 'folder-open', 'folder-close',
    'closing', 'client-closed', 'sleep', 'ledger-close', 'lamp-off', 'relight', 'window-close'
  ]);

  /* ── 逐帧的路：值落在 2px 的格子上，先快后慢 ─────────────── */
  function snap(value) {
    const result = Math.round(Number(value) / 2) * 2;
    return Object.is(result, -0) ? 0 : result;
  }

  // 把一段距离分成若干帧的步子（px），步子一帧比一帧小；距离太短时末尾是 0（停一帧），不会出现两步一样大。
  function stepSizes(distance, frames) {
    const units = Math.round(Math.abs(Number(distance) || 0) / 2);
    const count = Math.max(1, Math.floor(Number(frames) || 1));
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const ideal = [];
    for (let k = 1; k <= count; k += 1) ideal.push(units * (ease(k / count) - ease((k - 1) / count)));
    const steps = ideal.map(Math.floor);
    let left = units - steps.reduce((sum, value) => sum + value, 0);
    const order = ideal.map((value, index) => [value - Math.floor(value), index]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, index] of order) {
      if (left <= 0) break;
      steps[index] += 1;
      left -= 1;
    }
    steps.sort((a, b) => b - a);
    for (let guard = 0; guard < 4096; guard += 1) {
      const index = steps.findIndex((value, k) => k > 0 && value > 0 && value >= steps[k - 1]);
      if (index < 0) break;
      steps[index] -= 1;
      steps[0] += 1;
      steps.sort((a, b) => b - a);
    }
    return steps.map((value) => value * 2);
  }

  // 从 from 走到 to 的每一帧位置（含起点和终点，共 frames + 1 个值）。
  function path(from, to, frames) {
    const start = snap(from);
    const end = snap(to);
    const direction = end >= start ? 1 : -1;
    const values = [start];
    let position = start;
    for (const step of stepSizes(end - start, frames)) {
      position += direction * step;
      values.push(position);
    }
    values[values.length - 1] = end;
    return values;
  }

  // 一组错开出现的间隔：40–60ms 为宜，整组不超过半秒；放不下时缩短到最少 24ms。
  function stagger(count, moveMs, budget = LIMIT.budget) {
    if (count <= 1) return 0;
    const fit = Math.floor((budget - moveMs) / (count - 1));
    return Math.max(LIMIT.minGap, Math.min(LIMIT.maxGap, fit));
  }

  // 每个动作的帧值（px）。
  const MOVES = Object.freeze({
    tag: Object.freeze([...path(-DROP, 4, 5), 0]),                  // 名牌落下，落过头 4px 再回一下
    cat: Object.freeze([...path(40, 0, 5), -6, -2, 0]),             // 猫从搁板后面跳上来
    row: Object.freeze(path(-24, 0, 6)),                            // 一行从左写进来
    shelf: 8, ledgerOpen: 6, ledgerClose: 4, grow: 7, slide: 7,
    leaveCat: Object.freeze([0, -6, ...path(-8, 68, 6)]),            // 送走：猫轻轻一跳，落到搁板后面
    pull: Object.freeze(path(0, -DROP, 6))                          // 名牌被提上去
  });

  const api = { FRAME, TIMELINE, LIMIT, STEPS, MOVES, snap, stepSizes, path, stagger };

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.PixelLamp = api;
    return;
  }

  /* ── 页面里的部分 ─────────────────────────────────────── */
  const html = document.documentElement;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(motionQuery && motionQuery.matches);
  const now = () => (document.timeline && typeof document.timeline.currentTime === 'number' ? document.timeline.currentTime : performance.now());
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
  const t = (key, params) => (root.I18N ? root.I18N.t(key, params) : key);

  function emit(step, detail = {}) {
    try {
      document.dispatchEvent(new CustomEvent('agentdesk:lamp', { detail: { step, ...detail } }));
    } catch (_error) { /* 呈现层的监听出错不影响开灯 */ }
  }

  // 第一帧之前：整扇窗是夜色（窗口自己的底色也是这个颜色），灯是关的。
  html.dataset.boot = 'cover';
  html.dataset.lamp = '0';

  let mode = 'full';            // full：完整开灯；short：重新打开时只开灯；instant：减少动态效果或被打断以后
  let phase = 'cover';          // cover → run（只在 full）→ done
  let t0 = null;
  let showingKind = null;
  let themeReady = false;
  let startupStage = 'created';
  let startupStep = null;
  let waitRoster = true;
  let waitSessions = true;
  let waitShown = false;
  let lastInputAt = -Infinity;
  const jobs = new Set();
  const running = new Set();

  /* 排程：full 模式按时间表走；其他模式或被打断以后立刻执行。打断时按时间顺序把没走完的一步步做完。 */
  function at(ms, fn) {
    if (mode !== 'full' || t0 === null) { fn(); return; }
    const due = t0 + ms;
    const delay = due - now();
    if (delay <= 0) { fn(); return; }
    const job = { due, fn, id: 0 };
    job.id = setTimeout(() => { jobs.delete(job); fn(); }, delay);
    jobs.add(job);
  }
  const rel = () => (t0 === null ? 0 : now() - t0);

  function flushJobs() {
    const pending = [...jobs].sort((a, b) => a.due - b.due);
    jobs.clear();
    for (const job of pending) {
      clearTimeout(job.id);
      try { job.fn(); } catch (_error) { /* 跳到最后的样子时一步出错不影响其他 */ }
    }
  }

  function finishAnimations() {
    for (const animation of [...running]) {
      try { animation.finish(); } catch (_error) { try { animation.cancel(); } catch (_ignored) { /* gone */ } }
    }
    running.clear();
  }

  // 逐帧播放：每一帧的值保持一帧（steps），最后一帧是落定的样子。startTime 用文档时间轴对齐，换下来的占位卡和真卡接得上。
  function play(element, keys, duration, options = {}) {
    if (!element || typeof element.animate !== 'function' || reduced()) return null;
    let animation;
    try {
      const timing = { duration, fill: options.fill || 'backwards' };
      if (options.pseudo) timing.pseudoElement = options.pseudo;
      animation = element.animate(keys, timing);
    } catch (_error) {
      return null;
    }
    if (typeof options.start === 'number') animation.startTime = options.start;
    running.add(animation);
    const forget = () => running.delete(animation);
    animation.addEventListener('finish', forget);
    animation.addEventListener('cancel', forget);
    return animation;
  }

  function frames(element, values, toProps, options = {}) {
    const keys = values.map((value, index) => (index < values.length - 1
      ? { ...toProps(value, index), easing: 'steps(1, end)' }
      : toProps(value, index)));
    return play(element, keys, (values.length - 1) * FRAME, options);
  }

  function squash(element, options = {}) {
    return play(element, [
      { transform: 'scale(1.08, 0.86)', transformOrigin: '50% 100%', easing: 'steps(1, end)' },
      { transform: 'none', transformOrigin: '50% 100%' }
    ], FRAME, options);
  }

  function setLamp(level, kind) {
    const value = String(level);
    if (html.dataset.lamp === value) return;
    html.dataset.lamp = value;
    emit('lamp', { level, kind });
  }

  /* ── 名册、账本、页脚的读法 ──────────────────────────── */
  const roster = () => $('#accountRoster');
  const allCard = () => $('#rosterAllCard');
  const isSeat = (card) => card.classList.contains('lamp-seat');
  const realCards = () => $$('#accountRoster > .account-card[data-agent-id]').filter((card) => !isSeat(card) && !card.classList.contains('lamp-leaving'));
  const rosterHasData = () => realCards().length > 0 || Boolean($('#accountRoster .account-roster-empty'));
  const sessionRows = () => $$('#sessionRows > tr').filter((row) => !row.classList.contains('lamp-blank-row'));
  const sessionsHaveData = () => sessionRows().length > 0;

  function slots() {
    const list = [];
    const all = allCard();
    if (all && !all.hidden) list.push(all);
    for (const card of $$('#accountRoster > .account-card')) list.push(card);
    return list;
  }

  function inView(card) {
    const view = roster();
    if (!view || !view.contains(card)) return true;
    const box = view.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return rect.right > box.left && rect.left < box.right;
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(html).getPropertyValue(name).trim();
    return value || fallback;
  }

  // 搁板那一条在名册里的高度：名册两头化进桌面时，这一条不化（见 pixel.css“开灯与关灯”）。
  let shelfFrame = 0;
  function placeShelfBand() {
    shelfFrame = 0;
    const view = roster();
    const ledge = view && $('.account-card-ledge', view);
    if (!view || !ledge) return;
    const y = Math.round(ledge.getBoundingClientRect().top - view.getBoundingClientRect().top) - 2;
    if (Number.isFinite(y)) html.style.setProperty('--shelf-y', `${y}px`);
  }
  const queueShelfBand = () => { if (!shelfFrame) shelfFrame = requestAnimationFrame(placeShelfBand); };

  /* ── 数据还没到：空白名牌、网点影子、点线空行、两秒后说在等什么 ── */
  function rememberSeats(count) {
    try { localStorage.setItem('agentdesk-lamp-seats', String(Math.max(0, Math.min(LIMIT.seats, count)))); } catch (_error) { /* 只是下次占位的张数 */ }
  }
  function rememberedSeats() {
    try {
      const value = Number.parseInt(localStorage.getItem('agentdesk-lamp-seats') || '0', 10);
      return Number.isFinite(value) ? Math.max(0, Math.min(LIMIT.seats, value)) : 0;
    } catch (_error) {
      return 0;
    }
  }

  function drawGhost(canvas) {
    const sprites = root.YardSprites;
    if (!sprites || !canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    const map = sprites.SIT;
    const scale = 4;
    try {
      sprites.drawCat(ctx, map, sprites.BREEDS.orange, {
        dx: Math.floor((width - map[0].length * scale) / 2), dy: height - map.length * scale, scale, seed: 0, tail: true
      });
    } catch (_error) {
      return;
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = cssVar('--px-mute', '#C1A78B');
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < height; y += 2) {
      for (let x = (y / 2) % 2 ? 0 : 2; x < width; x += 4) ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function makeSeat(index) {
    const template = $('#accountCardTemplate');
    const card = template && template.content && template.content.firstElementChild ? template.content.firstElementChild.cloneNode(true) : null;
    if (!card) return null;
    card.classList.add('lamp-seat', 'lamp-blank');
    card.dataset.agentId = `lamp-seat-${index}`;
    card.setAttribute('aria-hidden', 'true');
    card.inert = true;
    const cat = $('.account-card-cat', card);
    if (cat) cat.className = 'lamp-seat-cat';
    for (const element of $$('.account-card-name, .account-card-state-label, .account-card-launch, .account-card-quota-summary', card)) element.textContent = ' ';
    const single = $('.account-card-runtime-single', card);
    if (single) { single.hidden = false; single.textContent = ' '; }
    const select = $('select', card);
    if (select) select.hidden = true;
    drawGhost($('canvas', card));
    return card;
  }

  function placeSeats() {
    const view = roster();
    if (!view || view.children.length) return;
    const count = rememberedSeats();
    const seats = [];
    for (let index = 0; index < count; index += 1) {
      const seat = makeSeat(index);
      if (seat) seats.push(seat);
    }
    if (seats.length) view.append(...seats);
  }

  function placeBlankRows() {
    const body = $('#sessionRows');
    if (!body || body.children.length) return;
    const columns = Math.max(1, $$('#sessionHead th').length);
    const rows = [];
    for (let index = 0; index < 11; index += 1) {
      const row = document.createElement('tr');
      row.className = 'lamp-blank-row';
      row.setAttribute('aria-hidden', 'true');
      const cell = document.createElement('td');
      cell.colSpan = columns;
      cell.textContent = ' ';
      row.append(cell);
      rows.push(row);
    }
    body.append(...rows);
  }

  function waitKey() {
    if (!waitRoster && !waitSessions) return null;
    if (/^first-use/.test(startupStage)) return null;
    if (startupStage === 'created' || startupStage === 'settings-loading') return startupStep === 'devices' ? 'lamp.wait.devices' : 'lamp.wait.settings';
    if (waitRoster) return 'lamp.wait.profiles';
    return 'lamp.wait.sessions';
  }

  function footerLine(text) {
    const host = $('.footer-status');
    let line = host && $('.lamp-wait', host);
    if (!text) {
      if (line) line.remove();
      return;
    }
    if (!host) return;
    if (!line) {
      line = document.createElement('span');
      line.className = 'status-typed lamp-wait';
      line.setAttribute('aria-live', 'polite');
      host.append(line);
    }
    if (line.textContent !== text) line.textContent = text;
  }

  function updateWait() {
    if (!waitShown || quit.active) return;
    const key = waitKey();
    if (!key) { footerLine(''); return; }
    const text = t(key);
    const line = $('.footer-status .lamp-wait');
    if (!line || line.textContent !== text) emit('waiting', { stage: startupStage, part: startupStep });
    footerLine(text);
  }

  function markWaiting() {
    if (waitRoster) html.dataset.waitRoster = ''; else delete html.dataset.waitRoster;
    if (waitSessions) html.dataset.waitSessions = ''; else delete html.dataset.waitSessions;
  }

  /* ── 开灯：full 模式的编排 ─────────────────────────────── */
  const shelf = { start: null, origin: 0, width: 0, front: null, tagGap: 48, catGap: 48, end: 0 };
  let ledgerOpened = false;
  let ledgerOpenEnd = 0;
  let rowsScheduled = false;
  let rowsWritten = 0;
  let catsEnd = 0;
  let rowsEnd = 0;
  let finishScheduled = false;
  const pendingArrivals = new Set();
  let arrivalQueued = false;

  function ledgeOf(card) {
    return $('.account-card-ledge', card);
  }

  function slotIndex(card) {
    return Math.max(0, slots().indexOf(card));
  }

  function tagStart(slot) {
    return TIMELINE.tags + slot * shelf.tagGap;
  }
  const TAG_MS = (MOVES.tag.length - 1) * FRAME;
  const CAT_MS = (MOVES.cat.length - 1) * FRAME;
  const ROW_MS = (MOVES.row.length - 1) * FRAME;

  function startShelf() {
    const list = slots().filter(inView);
    const first = list.length ? ledgeOf(list[0]) : null;
    if (!first) {
      // 空台面：没有搁板要伸，那只趴着的猫按猫上场的时间出来。
      shelf.start = t0 + TIMELINE.shelf;
      const empty = $('#accountRoster .account-roster-empty');
      if (empty) dressEmpty(empty);
      return;
    }
    const view = roster();
    const viewRight = view ? view.getBoundingClientRect().right : Infinity;
    const last = ledgeOf(list[list.length - 1]);
    shelf.origin = first.getBoundingClientRect().left;
    shelf.width = Math.max(2, Math.min(last.getBoundingClientRect().right, viewRight) - shelf.origin);
    shelf.front = path(0, shelf.width, MOVES.shelf);
    shelf.start = t0 + TIMELINE.shelf;
    shelf.end = TIMELINE.shelf + MOVES.shelf * FRAME;
    // 间隔按名册看得见的位置数算（数据可能比搁板晚到），保证看得见的那一组在半秒内落完。
    const capacity = (allCard() && !allCard().hidden ? 1 : 0) + Math.ceil((view ? view.clientWidth : 0) / 196);
    const count = Math.max(list.length, capacity);
    shelf.tagGap = stagger(count, TAG_MS);
    shelf.catGap = stagger(count, CAT_MS + FRAME);
    emit('shelf');
    for (const card of slots()) dress(card);
    const empty = $('#accountRoster .account-roster-empty');
    if (empty) dressEmpty(empty);
  }

  function shelfPiece(ledge) {
    if (!ledge) return;
    const rect = ledge.getBoundingClientRect();
    const width = Math.round(rect.width);
    const left = Math.round(rect.left - shelf.origin);
    const clip = (visible) => (visible >= width ? 'inset(-4px 0 -10px 0)' : `inset(-4px ${width - visible}px -10px 0)`);
    if (!shelf.front || left >= shelf.width - 1) {
      // 后来才到、在原先那段搁板以外的卡片：自己这一截接着长出来。
      const begin = Math.max(rel(), shelf.end);
      frames(ledge, path(0, width, MOVES.grow), (visible) => ({ clipPath: clip(visible) }), { start: t0 + begin });
      return;
    }
    const values = shelf.front.map((front) => Math.max(0, Math.min(width, front - left)));
    frames(ledge, values, (visible) => ({ clipPath: clip(visible) }), { start: shelf.start });
  }

  // 名牌的纸从搁板下沿（卡片里 80px 处）往下才看得见；整张纸都在线上面时，连它下沿的影子也裁掉，不在搁板下露出一条线。
  function paperClip(card) {
    const paper = Math.max(0, Math.round(card.getBoundingClientRect().height) - 82);
    return (value) => `inset(${value < 0 ? -value : -2}px -10px ${-value >= paper ? 0 : -12}px -10px)`;
  }

  function dropTag(card, start) {
    const clip = paperClip(card);
    frames(card, MOVES.tag, (value) => ({
      transform: `translateY(${value}px)`,
      clipPath: clip(value)
    }), { start, pseudo: '::before' });
    frames(card, MOVES.tag, (value) => ({ height: `${Math.max(0, 10 + value)}px` }), { start, pseudo: '::after' });
  }

  function dress(card) {
    if (!card || card.classList.contains('lamp-dressed')) return;
    const slot = slotIndex(card);
    const seat = isSeat(card);
    if (!inView(card)) {
      // 名册外面看不见的卡片不演，直接是最后的样子（占位卡仍是空白的）。
      card.classList.add('lamp-dressed');
      return;
    }
    if (!seat) card.classList.add('lamp-blank', 'lamp-cat-wait');
    card.classList.add('lamp-dressed');
    shelfPiece(ledgeOf(card));
    const start = tagStart(slot);
    dropTag(card, t0 + start);
    // 占位卡换成真卡片时名牌接着落，不再报一次。
    if (start > rel()) at(start, () => { if (card.isConnected) emit('tag', { index: slot }); });
    if (!seat) queueArrival(card);
  }

  function dressEmpty(empty) {
    if (empty.classList.contains('lamp-dressed')) return;
    at(Math.max(TIMELINE.cats, rel()), () => {
      empty.classList.add('lamp-dressed');
      emit('cat', { index: 0 });
    });
  }

  // 猫“到了”才跳上来：真卡片（以及“全部”）在名册的数据到了以后排队，一只晚一点。
  function queueArrival(card) {
    pendingArrivals.add(card);
    if (arrivalQueued) return;
    arrivalQueued = true;
    Promise.resolve().then(runArrivals);
  }

  function runArrivals() {
    arrivalQueued = false;
    if (waitRoster) return;
    const cards = [...pendingArrivals].filter((card) => card.isConnected).sort((a, b) => slotIndex(a) - slotIndex(b));
    pendingArrivals.clear();
    const base = rel();
    cards.forEach((card, order) => {
      const slot = slotIndex(card);
      const jump = Math.max(TIMELINE.cats + slot * shelf.catGap, base + order * shelf.catGap);
      const land = tagStart(slot) + TAG_MS;
      catsEnd = Math.max(catsEnd, jump + CAT_MS + FRAME, land);
      at(jump, () => {
        if (!card.isConnected) return;
        card.classList.remove('lamp-cat-wait');
        const avatar = $('.account-card-avatar', card);
        frames(avatar, MOVES.cat, (value) => ({ transform: `translateY(${value}px)` }));
        at(jump + CAT_MS, () => squash(avatar));
        emit('cat', { index: slot });
      });
      at(Math.max(jump, land), () => card.classList.remove('lamp-blank'));
    });
    maybeFinish();
  }

  function openLedger() {
    const pane = $('.session-pane');
    if (!pane) return;
    if (!sessionsHaveData()) placeBlankRows();
    pane.classList.add('lamp-open');
    ledgerOpened = true;
    ledgerOpenEnd = TIMELINE.ledger + MOVES.ledgerOpen * FRAME;
    const height = snap(pane.getBoundingClientRect().height);
    frames(pane, path(0, height, MOVES.ledgerOpen), (visible) => ({
      clipPath: `inset(-4px -6px ${visible >= height ? -8 : height - visible}px -6px)`
    }));
    emit('ledger-open');
    scheduleRows();
  }

  function markWritten() {
    const rows = sessionRows();
    rows.forEach((row, index) => {
      if (index < rowsWritten || (rowsWritten > 0 && index >= LIMIT.rows)) row.classList.add('lamp-written');
    });
  }

  function scheduleRows() {
    if (rowsScheduled || !ledgerOpened || waitSessions) return;
    rowsScheduled = true;
    const start = Math.max(rel(), ledgerOpenEnd);
    const count = Math.min(LIMIT.rows, sessionRows().length);
    const gap = stagger(count, ROW_MS);
    rowsEnd = start + Math.max(0, count - 1) * gap + ROW_MS;
    at(start, () => {
      emit('rows', { count });
      for (const row of sessionRows().slice(LIMIT.rows)) row.classList.add('lamp-written');
    });
    for (let index = 0; index < count; index += 1) {
      at(start + index * gap, () => {
        rowsWritten = Math.max(rowsWritten, index + 1);
        const row = sessionRows()[index];
        if (!row) return;
        row.classList.add('lamp-written');
        frames(row, MOVES.row, (value) => ({ translate: `${value}px 0` }));
      });
    }
    maybeFinish();
  }

  function maybeFinish() {
    if (phase !== 'run' || finishScheduled || waitRoster || waitSessions || !rowsScheduled || pendingArrivals.size) return;
    finishScheduled = true;
    const end = Math.max(catsEnd, rowsEnd, ledgerOpenEnd, shelf.end) + 60;
    at(end, finalize);
  }

  const LAMP_CLASSES = ['lamp-dressed', 'lamp-open', 'lamp-written'];
  function finalize() {
    if (phase !== 'run') return;
    phase = 'done';
    flushJobs();
    finishAnimations();
    setLamp(3, 'start');
    html.dataset.boot = 'done';
    for (const element of $$('.lamp-dressed, .lamp-open, .lamp-written')) element.classList.remove(...LAMP_CLASSES);
    for (const card of slots()) {
      if (!isSeat(card) && !(card === allCard() && waitRoster)) card.classList.remove('lamp-blank', 'lamp-cat-wait');
    }
    if (mode === 'full') {
      // 页脚的猫说第一句话：到这里才算可以用了。
      const typed = $('#statusTyped');
      const source = $('#statusText');
      if (typed && source && root.PixelFx) root.PixelFx.type(typed, source.textContent);
    }
    emit('ready', { kind: mode });
  }

  // 任何指针或按键：直接跳到最后的样子。数据还没到的地方仍是空位，到了就直接出现。
  function skip() {
    if (phase !== 'run') return;
    mode = 'instant';
    emit('skip');
    flushJobs();
    finishAnimations();
    finalize();
  }

  /* ── 开始：知道了用哪套颜色（data-theme）以后开灯 ─────────── */
  function lift() {
    if (phase !== 'cover' || !themeReady || showingKind === null) return;
    clearTimeout(coverFailsafe);
    mode = reduced() ? 'instant' : showingKind === 'reopen' ? 'short' : 'full';
    t0 = now();
    emit('boot-start', { kind: mode });
    waitRoster = !rosterHasData();
    waitSessions = !sessionsHaveData();
    markWaiting();
    if (waitRoster) placeSeats();
    if (waitRoster) markAllCardWaiting();
    if (waitSessions) placeBlankRows();
    setTimeout(() => { waitShown = true; updateWait(); }, TIMELINE.wait);
    setTimeout(() => { if (phase === 'run') skip(); }, TIMELINE.giveUp);
    if (mode === 'full') {
      phase = 'run';
      html.dataset.boot = 'run';
      TIMELINE.lamp.forEach((ms, index) => at(ms, () => setLamp(index + 1, 'start')));
      at(TIMELINE.shelf, startShelf);
      at(TIMELINE.ledger, openLedger);
      return;
    }
    phase = 'done';
    html.dataset.boot = 'done';
    if (mode === 'short') SHORT_LAMP.forEach((ms, index) => setTimeout(() => setLamp(index + 1, 'reopen'), ms));
    else setLamp(3, 'start');
    emit('ready', { kind: mode });
  }

  function markAllCardWaiting() {
    const all = allCard();
    if (all) all.classList.add('lamp-blank', 'lamp-cat-wait');
  }

  // 名册的数据到了：占位卡被 renderer 换成真卡片，“全部”写上数字；以后不再算“启动”。
  function rosterArrived() {
    if (!waitRoster || !rosterHasData()) return;
    waitRoster = false;
    markWaiting();
    rememberSeats(realCards().length);
    const all = allCard();
    if (phase === 'run' && all && all.classList.contains('lamp-dressed') && inView(all)) queueArrival(all);
    else if (all) all.classList.remove('lamp-blank', 'lamp-cat-wait');
    if (phase === 'run') {
      for (const card of realCards()) if (card.classList.contains('lamp-dressed') && card.classList.contains('lamp-cat-wait')) queueArrival(card);
      const empty = $('#accountRoster .account-roster-empty');
      if (empty && shelf.start !== null) dressEmpty(empty);
      if (pendingArrivals.size) Promise.resolve().then(runArrivals);
    }
    updateWait();
    maybeFinish();
  }

  function sessionsArrived() {
    if (!waitSessions || !sessionsHaveData()) return;
    waitSessions = false;
    markWaiting();
    if (phase === 'run') scheduleRows();
    updateWait();
    maybeFinish();
  }

  /* ── 打开之后：新来的猫、送走的猫 ──────────────────────── */
  let known = [];
  let selfMutating = false;

  function snapshot() {
    known = $$('#accountRoster > .account-card[data-agent-id]').filter((card) => !isSeat(card) && !card.classList.contains('lamp-leaving'))
      .map((card) => ({ id: card.dataset.agentId, node: card }));
  }

  function dragging() {
    const view = roster();
    return Boolean(view && view.classList.contains('roster-reordering'));
  }

  function rosterChanged() {
    queueShelfBand();
    if (selfMutating) return;
    const arriving = waitRoster && rosterHasData();
    if (arriving) rosterArrived();
    if (phase === 'run') {
      if (shelf.start !== null) {
        for (const card of slots()) dress(card);
        const empty = $('#accountRoster .account-roster-empty');
        if (empty) dressEmpty(empty);
      }
      snapshot();
      return;
    }
    // 第一次拿到名册数据是“加载完成”，不是“新来了一只猫”。
    if (arriving || waitRoster) { snapshot(); return; }
    const before = known;
    snapshot();
    const ids = new Set(known.map((item) => item.id));
    const previous = new Set(before.map((item) => item.id));
    const added = known.filter((item) => !previous.has(item.id));
    const removed = before.map((item, index) => ({ ...item, index })).filter((item) => !ids.has(item.id));
    if (added.length || removed.length) rememberSeats(known.length);
    if (reduced() || dragging() || added.length + removed.length > 2 || quit.active) return;
    removed.forEach((item) => leave(item, before));
    added.forEach((item) => join(item.node));
  }

  function join(card) {
    if (!card || !card.isConnected || reduced()) return;
    const followers = Boolean(card.nextElementSibling);
    card.classList.add('lamp-blank', 'lamp-cat-wait');
    const begin = now();
    emit('cat-join');
    if (followers) {
      // 后面的卡片挪出一个位置，搁板跟着长出一截。
      frames(card, path(-194, 2, MOVES.slide), (value) => ({ marginRight: `${value}px` }));
    } else {
      const ledge = ledgeOf(card);
      const width = ledge ? Math.round(ledge.getBoundingClientRect().width) : 196;
      frames(ledge, path(0, width, MOVES.grow), (visible) => ({ clipPath: visible >= width ? 'inset(-4px 0 -10px 0)' : `inset(-4px ${width - visible}px -10px 0)` }));
    }
    const tagAt = begin + (followers ? MOVES.slide * FRAME : 4 * FRAME);
    dropTag(card, tagAt);
    const land = tagAt + TAG_MS;
    const avatar = $('.account-card-avatar', card);
    later(land - begin, () => {
      card.classList.remove('lamp-blank', 'lamp-cat-wait');
      frames(avatar, MOVES.cat, (value) => ({ transform: `translateY(${value}px)` }));
      later(CAT_MS, () => squash(avatar));
    });
  }

  function leave(item, before) {
    const view = roster();
    const card = item.node;
    if (!view || !card || card.isConnected) return;
    // 刚被 renderer 拿掉的卡片放回原处演完再走：跳下去、名牌提上去、后面的卡片挪过来补位。
    const next = before.slice(item.index + 1).map((entry) => entry.node).find((node) => node.isConnected && node.parentElement === view) || null;
    selfMutating = true;
    card.classList.remove('selected');
    card.classList.add('lamp-leaving');
    card.setAttribute('aria-hidden', 'true');
    card.inert = true;
    view.insertBefore(card, next);
    Promise.resolve().then(() => { selfMutating = false; });
    emit('cat-leave');
    const avatar = $('.account-card-avatar', card);
    frames(avatar, MOVES.leaveCat, (value) => ({ transform: `translateY(${value}px)` }), { fill: 'forwards' });
    const pullAt = (MOVES.leaveCat.length - 1) * FRAME;
    later(pullAt, () => {
      card.classList.add('lamp-blank', 'lamp-cat-wait');
      const clip = paperClip(card);
      frames(card, MOVES.pull, (value) => ({ transform: `translateY(${value}px)`, clipPath: clip(value) }), { pseudo: '::before', fill: 'forwards' });
      frames(card, MOVES.pull, (value) => ({ height: `${Math.max(0, 10 + value)}px` }), { pseudo: '::after', fill: 'forwards' });
    });
    const closeAt = pullAt + (MOVES.pull.length - 1) * FRAME;
    later(closeAt, () => {
      if (!card.isConnected) return;
      if (card.nextElementSibling) {
        frames(card, path(2, -194, MOVES.slide), (value) => ({ marginRight: `${value}px` }), { fill: 'forwards' });
      } else {
        const ledge = ledgeOf(card);
        const width = ledge ? Math.round(ledge.getBoundingClientRect().width) : 196;
        frames(ledge, path(width, 0, MOVES.slide), (visible) => ({ clipPath: `inset(-4px ${width - visible}px -10px 0)` }), { fill: 'forwards' });
      }
      later(MOVES.slide * FRAME, () => {
        selfMutating = true;
        card.remove();
        Promise.resolve().then(() => { selfMutating = false; snapshot(); });
      });
    });
  }

  // 打开之后的小编排用的计时（可被打断，也被关灯打断）。
  const laterJobs = new Set();
  function later(ms, fn) {
    if (reduced()) { fn(); return; }
    const job = { fn, id: 0 };
    job.id = setTimeout(() => { laterJobs.delete(job); fn(); }, Math.max(0, ms));
    laterJobs.add(job);
  }
  function flushLater() {
    const pending = [...laterJobs];
    laterJobs.clear();
    for (const job of pending) {
      clearTimeout(job.id);
      try { job.fn(); } catch (_error) { /* 跳到最后 */ }
    }
  }

  /* ── 关灯 ────────────────────────────────────────────── */
  const quit = { active: false, clients: new Map(), token: null, kind: null, acked: false, jobs: new Set(), ledger: null };

  function quitLater(ms, fn) {
    if (reduced()) { fn(); return; }
    const job = { fn, id: 0 };
    job.id = setTimeout(() => { quit.jobs.delete(job); fn(); }, Math.max(0, ms));
    quit.jobs.add(job);
  }
  function flushQuit() {
    const pending = [...quit.jobs];
    quit.jobs.clear();
    for (const job of pending) { clearTimeout(job.id); try { job.fn(); } catch (_error) { /* 跳到最后 */ } }
  }
  function cancelQuitJobs() {
    for (const job of quit.jobs) clearTimeout(job.id);
    quit.jobs.clear();
  }

  function cardFor(profileId) {
    const id = String(profileId);
    return realCards().find((card) => $$('select option', card).some((option) => option.value === id)) || null;
  }

  function sleep(card, index) {
    if (!card || card.dataset.lampAsleep) return;
    card.dataset.lampAsleep = '1';
    const avatar = $('.account-card-avatar', card);
    if (root.PixelUi && avatar) root.PixelUi.pose(avatar, 'sleep');
    squash(avatar);
    emit('sleep', { index });
  }

  function wake() {
    for (const card of $$('[data-lamp-asleep]')) {
      delete card.dataset.lampAsleep;
      const avatar = $('.account-card-avatar', card);
      if (root.PixelUi && avatar) root.PixelUi.pose(avatar, null);
    }
  }

  function closingLine() {
    const names = [...quit.clients.values()].map((name) => name || '…');
    if (!names.length) { footerLine(''); return; }
    const shown = names.slice(0, 3).join(t('lamp.closing.join')) + (names.length > 3 ? t('lamp.closing.more') : '');
    footerLine(t('lamp.closing', { n: names.length, names: shown }));
  }

  function beginQuit() {
    if (phase === 'run') skip();
    flushLater();
    quit.active = true;
  }

  function onClosing(clients) {
    beginQuit();
    quit.clients = new Map((Array.isArray(clients) ? clients : []).map((client) => [String(client.profileId), String(client.name || '')]));
    setLamp(2, 'quit');
    emit('closing', { count: quit.clients.size });
    closingLine();
    const waiting = new Set([...quit.clients.keys()].map(cardFor).filter(Boolean));
    const idle = realCards().filter((card) => inView(card) && !waiting.has(card));
    const gap = stagger(idle.length, 2 * FRAME, 200);
    idle.forEach((card, index) => quitLater(index * gap, () => sleep(card, index)));
  }

  function onClosed(profileId) {
    const id = String(profileId);
    if (!quit.clients.has(id)) return;
    quit.clients.delete(id);
    emit('client-closed', { remaining: quit.clients.size });
    sleep(cardFor(id), 0);
    closingLine();
  }

  function ack() {
    if (quit.acked || quit.token === null) return;
    quit.acked = true;
    try { root.manager?.windowLampDone?.(quit.token); } catch (_error) { /* 主进程按上限继续 */ }
  }

  function lightsOut() {
    setLamp(0, quit.kind);
    html.dataset.boot = 'off';
    footerLine('');
    emit(quit.kind === 'close' ? 'window-close' : 'lamp-off');
    ack();
  }

  function onLampOff(token, kind) {
    beginQuit();
    quit.token = token;
    quit.kind = kind;
    quit.acked = false;
    if (reduced() || document.hidden) { lightsOut(); return; }
    const level = Number(html.dataset.lamp) || 3;
    if (kind === 'close') {
      // macOS 关窗不退出：只短短地关一下灯。
      let delay = 0;
      for (let next = level - 1; next >= 1; next -= 1) { quitLater(delay, () => setLamp(next, kind)); delay += 40; }
      quitLater(delay, lightsOut);
      return;
    }
    const awake = realCards().filter((card) => inView(card) && !card.dataset.lampAsleep);
    const gap = stagger(awake.length, 2 * FRAME, 200);
    awake.forEach((card, index) => quitLater(index * gap, () => sleep(card, index)));
    const ledgerAt = Math.max(0, awake.length - 1) * gap + FRAME;
    quitLater(ledgerAt, () => {
      const pane = $('.session-pane');
      if (!pane) return;
      const height = snap(pane.getBoundingClientRect().height);
      quit.ledger = frames(pane, path(height, 0, MOVES.ledgerClose), (visible) => ({
        clipPath: `inset(-4px -6px ${visible >= height ? -8 : height - visible}px -6px)`
      }), { fill: 'forwards' });
      emit('ledger-close');
    });
    let delay = ledgerAt + MOVES.ledgerClose * FRAME + 8;
    for (let next = Math.min(2, level - 1); next >= 1; next -= 1) { quitLater(delay, () => setLamp(next, kind)); delay += 56; }
    quitLater(delay, lightsOut);
  }

  function onRelight() {
    cancelQuitJobs();
    if (quit.ledger) { try { quit.ledger.cancel(); } catch (_error) { /* gone */ } quit.ledger = null; }
    quit.active = false;
    quit.clients.clear();
    quit.token = null;
    html.dataset.boot = 'done';
    footerLine('');
    wake();
    const from = Number(html.dataset.lamp) || 0;
    let delay = 0;
    for (let next = from + 1; next <= 3; next += 1) {
      const level = next;
      if (reduced()) setLamp(level, 'relight'); else setTimeout(() => setLamp(level, 'relight'), delay);
      delay += 56;
    }
    emit('relight');
  }

  function receive(payload) {
    if (!payload || typeof payload !== 'object') return;
    switch (payload.step) {
      case 'closing': onClosing(payload.clients); break;
      case 'closed': onClosed(payload.profileId); break;
      case 'quit': onLampOff(Number(payload.token) || 0, 'quit'); break;
      case 'close': onLampOff(Number(payload.token) || 0, 'close'); break;
      case 'relight': onRelight(); break;
      default: break;
    }
  }

  /* ── 输入：直接跳到最后的样子 ──────────────────────────── */
  function onInput(event) {
    if (event && event.isTrusted === false) return;
    lastInputAt = now();
    if (phase === 'run') skip();
    if (laterJobs.size) { flushLater(); finishAnimations(); }
    if (quit.jobs.size) { flushQuit(); finishAnimations(); }
  }

  function userCaused() {
    return phase === 'done' && !quit.active && now() - lastInputAt < 1500;
  }

  /* ── 装上 ────────────────────────────────────────────── */
  const coverFailsafe = setTimeout(() => {
    // 3 秒还不知道颜色（设置读不出来之类），照常把窗口亮出来，不让人对着一片黑。
    themeReady = true;
    if (showingKind === null) showingKind = 'first';
    lift();
  }, 3000);

  try {
    const pending = root.manager && typeof root.manager.windowShowing === 'function' ? root.manager.windowShowing() : null;
    if (pending && typeof pending.then === 'function') {
      pending.then((result) => { showingKind = result && result.kind === 'reopen' ? 'reopen' : 'first'; lift(); }, () => { showingKind = 'first'; lift(); });
      setTimeout(() => { if (showingKind === null) { showingKind = 'first'; lift(); } }, 400);
    } else {
      showingKind = 'first';
    }
  } catch (_error) {
    showingKind = 'first';
  }

  new MutationObserver(() => {
    if (!html.dataset.theme || themeReady) return;
    themeReady = true;
    lift();
  }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });

  document.addEventListener('agentdesk:startup', (event) => {
    const detail = event.detail || {};
    startupStage = String(detail.stage || startupStage);
    startupStep = detail.step ? String(detail.step) : null;
    updateWait();
    if (startupStage === 'ready' && phase === 'run') {
      // 数据读完（或读失败）以后不再等：缺的地方直接是最后的样子。
      setTimeout(() => {
        if (phase !== 'run') return;
        if (waitRoster || waitSessions) skip();
      }, 1200);
    }
  });

  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, onInput, true);

  function bindDom() {
    const view = roster();
    if (view) new MutationObserver(rosterChanged).observe(view, { childList: true });
    const all = allCard();
    if (all) new MutationObserver(rosterChanged).observe(all, { attributes: true, attributeFilter: ['hidden'] });
    const body = $('#sessionRows');
    if (body) {
      new MutationObserver(() => {
        if (waitSessions) sessionsArrived();
        if (phase === 'run') markWritten();
      }).observe(body, { childList: true });
    }
    // 弹窗开合时也说一声（档案夹的样子在 pixel.css）。
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target.tagName !== 'DIALOG') continue;
        const open = record.target.hasAttribute('open');
        if (open && phase === 'run') skip();
        emit(open ? 'folder-open' : 'folder-close', { id: record.target.id || null });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    if (root.manager && typeof root.manager.onWindowLamp === 'function') root.manager.onWindowLamp(receive);
    window.addEventListener('resize', queueShelfBand);
    queueShelfBand();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindDom, { once: true });
  else bindDom();

  root.PixelLamp = { ...api, userCaused, receive, skip, state: () => ({ mode, phase, lamp: html.dataset.lamp, waitRoster, waitSessions, quit: quit.active, gaps: [shelf.tagGap, shelf.catGap] }) };
})(typeof self !== 'undefined' ? self : this);
