/*
 * AgentDesk — 桌面上走的东西：信封、结果、一圈小火星。
 *
 * 按“动效总览”：位置落在 2px 的格子上，走先快后慢的路（12 步、约一秒、轻轻拱起）；
 * 落地时一圈八个小方块三帧散开。同时最多演三处，其余直接到位；窗口不在前台时不演，
 * 系统要求减少动态效果时也不演，都直接给最终的样子；任何真实的点按或按键让正在飞的东西立刻落地。
 * 这里不认识业务对象：调用方给起点、终点和落地后要做的事。
 */
(function (root) {
  'use strict';

  const STEPS = 12;
  const STEP_MS = 84;
  const RING_FRAMES = 3;
  const RING_MS = 67;
  const MAX_AT_ONCE = 3;

  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(motion && motion.matches);
  const foreground = () => typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus());
  const flights = new Set();
  const snap = (value) => Math.round(value / 2) * 2;
  const layer = () => document.getElementById('fxFloaters');

  // 这一刻能不能演：前台、没要求减少动态效果、同时不超过三处
  function canPlay() {
    return Boolean(layer()) && !reduced() && foreground() && flights.size < MAX_AT_ONCE;
  }

  // 元素中心（窗口坐标）；dy 往下挪
  function center(element, dy = 0) {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (!box.width && !box.height) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 + dy };
  }

  // 信封：10×7 格、一格 2px，深色边、纸色底、V 形封口和一枚封印（坏消息是墨色的印）
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function sprite(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 10 7');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '14');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('class', `desk-envelope desk-envelope-${kind}`);
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, w, h, cls) => {
      const node = document.createElementNS(SVG_NS, 'rect');
      for (const [key, value] of Object.entries({ x, y, width: w, height: h })) node.setAttribute(key, String(value));
      node.setAttribute('class', cls);
      svg.append(node);
    };
    rect(0, 0, 10, 7, 'desk-edge');
    rect(1, 1, 8, 5, 'desk-paper');
    for (const [x, y] of [[1, 1], [8, 1], [2, 2], [7, 2], [3, 3], [6, 3]]) rect(x, y, 1, 1, 'desk-edge');
    rect(4, 3, 2, 2, kind === 'bad' ? 'desk-seal-bad' : 'desk-seal');
    return svg;
  }

  function place(node, x, y, width, height) {
    node.style.left = `${snap(x - width / 2)}px`;
    node.style.top = `${snap(y - height / 2)}px`;
  }

  /*
   * 飞一封信：from/to 是窗口坐标 {x, y}。onLand(played) 在落地时调用一次：
   * played=false 表示没有演（后台、减少动态效果、超过三处或被打断），直接到最终状态。
   */
  function fly({ from, to, arc = 16, kind = 'mail', delayMs = 0, onLand }) {
    let landed = false;
    const land = (played) => {
      if (landed) return;
      landed = true;
      try { onLand?.(played); } catch (_error) { /* presentation only */ }
    };
    if (!from || !to || !canPlay()) { land(false); return null; }
    const node = sprite(kind);
    node.style.position = 'absolute';
    node.style.visibility = 'hidden';
    layer().append(node);
    let step = 0;
    let timer = null;
    const flight = {
      finish(played = false) {
        clearTimeout(timer);
        node.remove();
        flights.delete(flight);
        land(played);
      }
    };
    flights.add(flight);
    const tick = () => {
      step += 1;
      const t = step / STEPS;
      const p = 1 - Math.pow(1 - t, 3);
      const x = from.x + (to.x - from.x) * p;
      const y = from.y + (to.y - from.y) * p - Math.sin(t * Math.PI) * arc;
      place(node, x, y, 20, 14);
      node.style.visibility = 'visible';
      if (step >= STEPS) { flight.finish(true); return; }
      timer = setTimeout(tick, STEP_MS);
    };
    place(node, from.x, from.y, 20, 14);
    timer = setTimeout(() => { node.style.visibility = 'visible'; tick(); }, Math.max(0, delayMs));
    return flight;
  }

  // 一圈八个 4×4 的小方块，半径 8 → 14 → 20，三帧后消失
  function ring(point, tone = 'brand') {
    if (!point || !layer() || reduced() || !foreground()) return;
    const dots = [];
    for (let k = 0; k < 8; k += 1) {
      const dot = document.createElement('i');
      dot.className = `desk-spark desk-spark-${tone}`;
      dot.setAttribute('aria-hidden', 'true');
      layer().append(dot);
      dots.push(dot);
    }
    let frame = 0;
    const draw = () => {
      const radius = 8 + frame * 6;
      dots.forEach((dot, k) => place(dot, point.x + Math.cos(k * Math.PI / 4) * radius, point.y + Math.sin(k * Math.PI / 4) * radius, 4, 4));
      frame += 1;
      if (frame > RING_FRAMES) { dots.forEach((dot) => dot.remove()); return; }
      setTimeout(draw, RING_MS);
    };
    draw();
  }

  function finishAll() {
    for (const flight of [...flights]) flight.finish(false);
  }

  if (typeof document !== 'undefined') {
    // 随时可以打断：真实的点按或按键让飞着的东西直接落地
    document.addEventListener('pointerdown', (event) => { if (event.isTrusted) finishAll(); }, true);
    document.addEventListener('keydown', (event) => { if (event.isTrusted) finishAll(); }, true);
    // 不在前台时不演：离开前台的一刻全部落地
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') finishAll(); });
    if (typeof window !== 'undefined') window.addEventListener('blur', finishAll);
  }

  root.PixelDesk = { fly, ring, finishAll, center, canPlay, reduced, foreground, MAX_AT_ONCE, STEPS, STEP_MS };
})(typeof self !== 'undefined' ? self : this);
