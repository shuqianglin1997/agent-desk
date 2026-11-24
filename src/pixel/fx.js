/*
 * AgentDesk — 动效引擎。
 *
 * 管三件事：一张全窗口的粒子画布、头顶冒字、元素的逐帧动作（跳、跑、摇头、沉下去、蹦上来）。
 * 全部只改位移和透明度，可以被下一次操作打断；系统开了“减少动态效果”时一律不动。
 * 这里不认识任何业务对象，只接收元素和坐标。
 */
(function (root) {
  'use strict';

  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(motion && motion.matches);

  let canvas = null;
  let ctx = null;
  let floaters = null;
  let particles = [];
  let raf = 0;
  let frame = 0;

  function ensure() {
    if (!canvas) {
      canvas = document.getElementById('fxCanvas');
      floaters = document.getElementById('fxFloaters');
      if (canvas) ctx = canvas.getContext('2d');
    }
    if (canvas && (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight)) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    return Boolean(canvas && ctx && floaters);
  }

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
  }

  function sparkColors() {
    return [token('--accent'), token('--warn'), token('--ink-primary')];
  }

  // edge: 'top' | 'bottom' | 'left' | undefined(中心)
  function point(element, edge) {
    const rect = element.getBoundingClientRect();
    return {
      x: edge === 'left' ? rect.left + 10 : rect.left + rect.width / 2,
      y: edge === 'top' ? rect.top : edge === 'bottom' ? rect.bottom : rect.top + rect.height / 2
    };
  }

  function step() {
    frame += 1;
    // 每两帧走一步，看起来像逐帧动画而不是平滑运动。
    if (frame % 2 === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((item) => item.life > 0);
      for (const item of particles) {
        item.x += item.vx;
        item.y += item.vy;
        item.vy += item.gravity;
        item.life -= 1;
        const size = item.life < 4 ? 2 : item.size;
        ctx.fillStyle = item.color;
        ctx.fillRect(Math.round(item.x / 2) * 2, Math.round(item.y / 2) * 2, size, size);
      }
    }
    if (particles.length) {
      raf = requestAnimationFrame(step);
    } else {
      raf = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function burst(x, y, count, colors, options = {}) {
    if (reduced() || !ensure()) return;
    const palette = colors && colors.length ? colors : sparkColors();
    for (let index = 0; index < count; index += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (options.spread || 9),
        vy: -Math.random() * (options.up === undefined ? 8 : options.up) - (options.up === 0 ? 0 : 2),
        gravity: options.gravity === undefined ? 0.9 : options.gravity,
        life: options.life || 14,
        size: options.size || 4,
        color: palette[index % palette.length]
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function floatText(x, y, text, tone) {
    if (reduced() || !ensure() || !text) return;
    const element = document.createElement('div');
    element.className = `fx-float${tone ? ` ${tone}` : ''}`;
    element.textContent = text;
    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(y)}px`;
    floaters.append(element);
    element.addEventListener('animationend', () => element.remove(), { once: true });
  }

  // 一张小纸片沿弧线从 from 飞到 to。
  function fly(from, to, index = 0, icon = 'copy') {
    if (reduced() || !ensure() || !from || !to || typeof from.animate !== 'function') return;
    const start = point(from, 'left');
    const end = point(to);
    const element = document.createElement('i');
    element.className = 'fx-paper pxi';
    element.dataset.i = icon;
    element.style.left = `${Math.round(start.x)}px`;
    element.style.top = `${Math.round(start.y)}px`;
    floaters.append(element);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const animation = element.animate([
      { transform: 'translate(0, 0)' },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.3 - 70}px)`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px)` }
    ], { duration: 400, delay: index * 60, easing: 'steps(7, end)', fill: 'both' });
    animation.onfinish = () => element.remove();
  }

  function quake(element = document.querySelector('.app-shell')) {
    if (reduced() || !element) return;
    element.classList.remove('fx-quake');
    void element.offsetWidth;
    element.classList.add('fx-quake');
    setTimeout(() => element.classList.remove('fx-quake'), 240);
  }

  const ACTIONS = ['fx-idle', 'fx-hop', 'fx-happy', 'fx-no', 'fx-run', 'fx-sink', 'fx-rise'];

  // 给元素换一个动作；duration 到了回到待机。duration 为 0 表示一直保持，直到下一次调用。
  function act(element, name, duration = 0) {
    if (!element) return;
    if (reduced()) return;
    element.classList.remove(...ACTIONS);
    void element.offsetWidth;
    element.classList.add(`fx-${name}`);
    if (duration > 0) {
      setTimeout(() => {
        if (!element.classList.contains(`fx-${name}`)) return;
        element.classList.remove(`fx-${name}`);
        element.classList.add('fx-idle');
      }, duration);
    }
  }

  function once(element, className, duration = 200) {
    if (!element || reduced()) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    setTimeout(() => element.classList.remove(className), duration);
  }

  // 数字从旧值跳到新值。
  function roll(element, to) {
    if (!element) return;
    const target = Number(to) || 0;
    const from = Number.parseInt(element.textContent, 10);
    clearInterval(element._fxRoll);
    if (reduced() || !Number.isFinite(from) || from === target) {
      element.textContent = String(target);
      return;
    }
    let tick = 0;
    element._fxRoll = setInterval(() => {
      tick += 1;
      element.textContent = String(Math.round(from + ((target - from) * tick) / 6));
      if (tick >= 6) clearInterval(element._fxRoll);
    }, 28);
  }

  // 逐字打出。onTick 每走一步调用一次，onDone 打完调用。
  function type(element, text, hooks = {}) {
    if (!element) return;
    clearInterval(element._fxType);
    const value = String(text || '');
    if (reduced() || !value) {
      element.textContent = value;
      if (hooks.onDone) hooks.onDone();
      return;
    }
    let index = 0;
    element.textContent = '';
    element._fxType = setInterval(() => {
      index += 2;
      element.textContent = value.slice(0, index);
      if (hooks.onTick) hooks.onTick();
      if (index >= value.length) {
        clearInterval(element._fxType);
        if (hooks.onDone) hooks.onDone();
      }
    }, 18);
  }

  // 一排竖帘从合上到打开，用在换主题之后。
  function wipe(host = document.querySelector('.app-shell')) {
    if (reduced() || !host) return;
    const layer = document.createElement('div');
    layer.className = 'fx-wipe';
    for (let index = 0; index < 13; index += 1) {
      const bar = document.createElement('i');
      bar.style.setProperty('--i', String(index));
      layer.append(bar);
    }
    host.append(layer);
    setTimeout(() => layer.remove(), 420);
  }

  root.PixelFx = { reduced, point, burst, floatText, fly, quake, act, once, roll, type, wipe, sparkColors, token };
})(typeof self !== 'undefined' ? self : this);
