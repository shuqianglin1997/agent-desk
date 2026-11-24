/*
 * AgentDesk — 像素猫的放映机。
 *
 * 所有画猫的画布共用一个钟：每只看得见的猫按它当前动作自己的帧率往前走，帧号变了才重画；
 * 窗口藏起来时钟就停；系统要求减少动态效果时，每只猫只画它当前状态的第一帧，不动。
 * 一次性的动作（跳一下、被摸、炸毛、好了、摇头、跳上来、跳下去、睡下、醒来）播一遍就回到当前状态；
 * hold 的一次性动作停在最后一帧，直到 release（关灯时睡下、开灯时醒来就是这么用的）。
 *
 * 画什么由 yard/cat-art.js（批准的像素与动作）决定，演哪一个由 yard/cats.js 的 actionFor 决定，这里只管放。
 * 浏览器里挂到 window.PixelCats；Node 里可以 require，放映核心不碰 DOM，测试注入时钟和画笔。
 *
 * 对外（开灯与关灯的编排、界面层都只用这几个）：
 *   PixelCats.show(canvas, spec)            spec: { cat, seed, state, energy } 或 { look, accessory, collar, action }，
 *                                           另可带 scale（默认 4）、headroom（默认 2 行）、still（true = 只画一帧，不进钟）
 *   PixelCats.play(canvas, name, { hold })  播一次性动作，返回 Promise<boolean>：播完为 true，被别的动作打断或画布没登记为 false
 *   PixelCats.release(canvas, { wake })     放开 hold；wake 为 true 时先播“醒来”再回到状态
 *   PixelCats.drawStill(canvas, spec)       画一帧就走（编辑器里的小样、“全部”那张的合影）
 *   PixelCats.reduced()                     现在是不是要减少动态效果
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root, require('../yard/cat-art'), require('../yard/cats'));
  } else {
    root.PixelCats = factory(root, root.CatArt, root.YardCats);
  }
})(typeof self !== 'undefined' ? self : this, function (root, art, cats) {
  'use strict';

  const HEADROOM = 2;
  const DEFAULT_SCALE = 4;
  // 它自己的状态从醒着变成睡着时先“睡下”，从睡着变成醒着时先“醒来”。揣手和摊成饼不算两头。
  const AWAKE = new Set(['onduty', 'working', 'arriving', 'play', 'confused', 'tired']);
  const ASLEEP = new Set(['nap', 'hibernate']);

  function hashText(text) {
    let h = 2166136261;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const OLD_POSE_STATE = { sit: 'onduty', loaf: 'rest', sleep: 'nap' };
  const OLD_ACCESSORY = { hat: 'straw' };

  // 外观：认新的三项，也认旧调用方传来的 { breed, collar, accessory }。
  function resolveLook(spec) {
    const input = spec || {};
    if (input.look && art.LOOKS[input.look]) {
      const accessory = art.ACCESSORIES[input.accessory] ? input.accessory : (OLD_ACCESSORY[input.accessory] || 'none');
      return { look: input.look, accessory, collar: input.collar || null };
    }
    if (input.cat !== undefined || input.seed !== undefined) return cats.resolveCat(input.cat, input.seed);
    const look = art.LOOKS[input.breed] ? input.breed : 'orange';
    const accessory = art.ACCESSORIES[input.accessory] ? input.accessory : (OLD_ACCESSORY[input.accessory] || 'none');
    return { look, accessory, collar: input.collar || null };
  }

  // 该演哪个循环动作：明确给了 action 就用它，否则由活动与能量决定（规则在 yard/cats.js 的 actionFor）。
  function resolveState(spec) {
    const input = spec || {};
    if (input.action && art.ACTIONS[input.action] && art.ACTIONS[input.action].loop) return input.action;
    if (input.state || input.energy) return cats.actionFor(input.state, input.energy);
    if (input.pose && OLD_POSE_STATE[input.pose]) return OLD_POSE_STATE[input.pose];
    return 'onduty';
  }

  const frameCache = new Map();
  function grid(actionName, index, accessory, headroom) {
    const key = `${actionName}|${index}|${accessory}|${headroom}`;
    let value = frameCache.get(key);
    if (!value) {
      value = art.frame(art.ACTIONS[actionName].frames[index], { accessory }, { headroom });
      if (frameCache.size > 4000) frameCache.clear();
      frameCache.set(key, value);
    }
    return value;
  }

  // 某个动作在开始后 elapsed 毫秒时该是第几帧。循环的取模；一次性的超过最后一帧返回 -1（播完了）。
  function frameIndex(actionName, elapsed) {
    const action = art.ACTIONS[actionName];
    const count = action.frames.length;
    const index = Math.floor(Math.max(0, elapsed) * action.fps / 1000);
    if (action.loop) return index % count;
    return index < count ? index : -1;
  }

  function durationOf(actionName) {
    const action = art.ACTIONS[actionName];
    return action ? Math.ceil(action.frames.length * 1000 / action.fps) : 0;
  }

  /*
   * 放映核心。options:
   *   now()            当前毫秒
   *   paint(target, grid, look, scale, headroom)  真的去画
   *   reduced()        是否减少动态效果
   *   visible(target)  这块画布现在看不看得见（看不见的不往前走，回来时按时钟接上）
   *   later(fn, ms)    定时器（一次性动作按时结束，不依赖有没有在画）
   */
  function createPlayer(options) {
    const now = options.now;
    const paint = options.paint;
    const reduced = options.reduced || (() => false);
    const visible = options.visible || (() => true);
    const later = options.later || ((fn, ms) => setTimeout(fn, ms));
    const entries = new Map();

    function settleShot(entry, finished) {
      const shot = entry.shot;
      if (!shot) return;
      entry.shot = null;
      if (shot.resolve) shot.resolve(finished);
    }

    function current(entry, at) {
      const shot = entry.shot;
      if (shot) {
        const count = art.ACTIONS[shot.name].frames.length;
        if (reduced()) {
          if (shot.hold) return { action: shot.name, index: count - 1 };
        } else {
          const index = frameIndex(shot.name, at - shot.since);
          if (index >= 0) return { action: shot.name, index };
          if (shot.hold) return { action: shot.name, index: count - 1 };
        }
        settleShot(entry, true);
      }
      if (reduced()) return { action: entry.state, index: 0 };
      return { action: entry.state, index: frameIndex(entry.state, at - entry.stateSince) };
    }

    function render(entry, at, force) {
      const { action, index } = current(entry, at);
      const key = `${entry.lookKey}|${entry.scale}|${entry.headroom}|${action}|${index}`;
      if (!force && key === entry.drawn) return false;
      entry.drawn = key;
      paint(entry.target, grid(action, index, entry.look.accessory, entry.headroom), entry.look, entry.scale, entry.headroom);
      return true;
    }

    function set(target, spec) {
      const look = resolveLook(spec);
      const state = resolveState(spec);
      const at = now();
      let entry = entries.get(target);
      if (!entry) {
        // 每只猫的循环错开一点，整排猫不会齐步走。
        const phase = hashText(spec && spec.seed !== undefined ? spec.seed : entries.size) % 997;
        entry = { target, phase, shot: null, drawn: null };
        entries.set(target, entry);
      }
      entry.look = look;
      entry.lookKey = `${look.look}|${look.accessory}|${look.collar || ''}`;
      entry.scale = (spec && spec.scale) || DEFAULT_SCALE;
      entry.headroom = spec && Number.isInteger(spec.headroom) ? spec.headroom : HEADROOM;
      const previous = entry.state;
      if (previous !== state) {
        entry.state = state;
        entry.stateSince = at - entry.phase;
        if (previous && !entry.shot && !reduced()) {
          if (AWAKE.has(previous) && ASLEEP.has(state)) start(entry, 'settle', false);
          else if (ASLEEP.has(previous) && AWAKE.has(state)) start(entry, 'wake', false);
        }
      }
      render(entry, at, false);
      return entry;
    }

    function play(target, name, opts) {
      const entry = entries.get(target);
      const action = art.ACTIONS[name];
      if (!entry || !action || action.loop) return Promise.resolve(false);
      return start(entry, name, Boolean(opts && opts.hold));
    }

    function start(entry, name, hold) {
      settleShot(entry, false);
      return new Promise((resolve) => {
        const shot = { name, since: now(), hold, resolve };
        entry.shot = shot;
        render(entry, shot.since, false);
        // 减少动态效果时不演过程：hold 的直接停在最后一帧，别的立刻算播完。
        const wait = reduced() ? 0 : durationOf(name);
        later(() => {
          if (entry.shot !== shot) return;
          if (hold) { if (shot.resolve) { shot.resolve(true); shot.resolve = null; } return; }
          settleShot(entry, true);
          render(entry, now(), false);
        }, wait);
      });
    }

    function release(target) {
      const entry = entries.get(target);
      if (!entry || !entry.shot) return false;
      settleShot(entry, false);
      render(entry, now(), false);
      return true;
    }

    // 往前走一步：画该换帧的猫，返回这一步画了几只。
    function tick() {
      const at = now();
      let painted = 0;
      for (const entry of entries.values()) {
        if (!visible(entry.target)) continue;
        if (render(entry, at, false)) painted += 1;
      }
      return painted;
    }

    // 离下一次有猫换帧还有多久；没有会动的猫时返回 Infinity（钟可以停）。
    function nextChange() {
      if (reduced()) return Infinity;
      const at = now();
      let soonest = Infinity;
      for (const entry of entries.values()) {
        if (!visible(entry.target)) continue;
        const shot = entry.shot;
        const name = shot ? shot.name : entry.state;
        const since = shot ? shot.since : entry.stateSince;
        const action = art.ACTIONS[name];
        if (shot && shot.hold && frameIndex(name, at - since) < 0) continue;
        if (!shot && action.frames.length < 2) continue;
        const step = 1000 / action.fps;
        const elapsed = Math.max(0, at - since);
        soonest = Math.min(soonest, step - (elapsed % step));
      }
      return soonest;
    }

    function redrawAll() {
      const at = now();
      for (const entry of entries.values()) render(entry, at, true);
    }

    function forget(target) {
      const entry = entries.get(target);
      if (entry) settleShot(entry, false);
      entries.delete(target);
    }

    function stateOf(target) {
      const entry = entries.get(target);
      if (!entry) return null;
      const { action, index } = current(entry, now());
      return { state: entry.state, action, index, look: entry.look, shot: entry.shot ? entry.shot.name : null };
    }

    return { set, play, release, tick, nextChange, redrawAll, forget, stateOf, entries };
  }

  /* ── 浏览器：一块画布一只猫，一个钟 ─────────────────── */
  function paintCanvas(canvas, frameGrid, look, scale, headroom, extra) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const o = extra || {};
    ctx.imageSmoothingEnabled = false;
    if (o.clear !== false) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = art.LOOKS[look.look] || art.LOOKS.orange;
    const width = art.W * scale;
    const height = (art.H + headroom) * scale;
    // 横向居中、脚踩画布底边：画布比猫大时（编辑器的预览）猫仍坐在底上。
    const dx = (o.dx !== undefined ? o.dx : Math.floor((canvas.width - width) / 2));
    const dy = (o.dy !== undefined ? o.dy : canvas.height - height);
    try {
      art.draw(ctx, frameGrid, data, { scale, collar: look.collar || undefined, dx, dy });
    } catch (_error) { /* 画不出一只猫不影响别的 */ }
  }

  function browser() {
    if (typeof document === 'undefined' || !art || !cats) return null;
    const motion = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = () => Boolean(motion && motion.matches);
    const seen = new WeakMap();
    let observer = null;
    if (typeof root.IntersectionObserver === 'function') {
      observer = new root.IntersectionObserver((records) => {
        for (const record of records) seen.set(record.target, record.isIntersecting);
        schedule(0);
      });
    }
    const visible = (canvas) => {
      if (!canvas.isConnected) return false;
      if (document.hidden) return false;
      return seen.has(canvas) ? seen.get(canvas) : true;
    };
    const clock = () => (root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now());
    const player = createPlayer({
      now: clock,
      reduced,
      visible,
      paint: (canvas, frameGrid, look, scale, headroom) => paintCanvas(canvas, frameGrid, look, scale, headroom),
      later: (fn, ms) => setTimeout(fn, ms)
    });

    let timer = 0;
    function schedule(delay) {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (document.hidden) return;
      const wait = delay === undefined ? player.nextChange() : delay;
      if (!Number.isFinite(wait)) return;
      timer = setTimeout(run, Math.max(0, Math.ceil(wait)));
    }
    function run() {
      timer = 0;
      // 从页面上拿掉的画布不再放
      for (const canvas of player.entries.keys()) if (!canvas.isConnected) { player.forget(canvas); if (observer) observer.unobserve(canvas); }
      player.tick();
      schedule();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (timer) clearTimeout(timer); timer = 0; return; }
      run();
    });
    if (motion && typeof motion.addEventListener === 'function') {
      motion.addEventListener('change', () => { player.redrawAll(); schedule(); });
    }

    function show(canvas, spec) {
      if (!canvas) return null;
      if (spec && spec.still) { drawStill(canvas, spec); return null; }
      const fresh = !player.entries.has(canvas);
      player.set(canvas, spec || {});
      if (fresh && observer) observer.observe(canvas);
      schedule();
      return player.stateOf(canvas);
    }
    function play(canvas, name, opts) {
      const done = player.play(canvas, name, opts);
      schedule();
      return done;
    }
    function release(canvas, opts) {
      const held = player.release(canvas);
      schedule();
      if (held && opts && opts.wake) return play(canvas, 'wake');
      return Promise.resolve(held);
    }
    function drawStill(canvas, spec) {
      const input = spec || {};
      const look = resolveLook(input);
      const name = input.action && art.ACTIONS[input.action] ? input.action : resolveState(input);
      const action = art.ACTIONS[name];
      const index = Math.max(0, Math.min(action.frames.length - 1, input.frame || 0));
      const headroom = Number.isInteger(input.headroom) ? input.headroom : HEADROOM;
      const scale = input.scale || DEFAULT_SCALE;
      paintCanvas(canvas, grid(name, index, look.accessory, headroom), look, scale, headroom, input);
    }
    function forget(canvas) {
      player.forget(canvas);
      if (observer) observer.unobserve(canvas);
    }

    return {
      show, play, release, drawStill, forget, reduced,
      stateOf: (canvas) => player.stateOf(canvas),
      redrawAll: () => player.redrawAll(),
      canvases: () => [...player.entries.keys()]
    };
  }

  const api = {
    HEADROOM,
    DEFAULT_SCALE,
    createPlayer,
    frameIndex,
    durationOf,
    resolveLook,
    resolveState,
    actionFor: (activity, energy) => cats.actionFor(activity, energy)
  };
  const live = browser();
  if (live) Object.assign(api, live);
  return api;
});
