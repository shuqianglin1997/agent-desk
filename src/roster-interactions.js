(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RosterInteractions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeOrder(order, available) {
    const ids = [...new Set(available.filter(id => typeof id === 'string' && id))];
    const allowed = new Set(ids);
    const saved = [...new Set((Array.isArray(order) ? order : []).filter(id => allowed.has(id)))];
    return [...saved, ...ids.filter(id => !saved.includes(id))];
  }

  function moveId(order, id, position) {
    const result = [...order];
    const from = result.indexOf(id);
    if (from < 0) return result;
    result.splice(from, 1);
    result.splice(Math.max(0, Math.min(result.length, position)), 0, id);
    return result;
  }

  function attach(container, options = {}) {
    const doc = container.ownerDocument;
    const win = doc.defaultView;
    const selector = '.account-card[data-agent-id]';
    const cards = () => [...container.querySelectorAll(selector)];
    const ids = () => cards().map(card => card.dataset.agentId);
    let gesture = null;
    let timer = null;
    let frame = null;
    let suppressClick = false;
    let suppressTimer = null;
    let destroyed = false;
    const listeners = [];
    function listen(target, type, fn, config) {
      target.addEventListener(type, fn, config);
      listeners.push(() => target.removeEventListener(type, fn, config));
    }
    function consume(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function blockClick() {
      suppressClick = true;
      win.clearTimeout(suppressTimer);
      suppressTimer = win.setTimeout(() => { suppressClick = false; }, 600);
    }
    function restoreOrder(order) {
      const map = new Map(cards().map(card => [card.dataset.agentId, card]));
      for (const id of order) if (map.has(id)) container.appendChild(map.get(id));
    }
    function finish(cancelled) {
      if (!gesture) return;
      const current = gesture;
      gesture = null;
      win.clearTimeout(timer);
      timer = null;
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      if (current.active) {
        blockClick();
        if (cancelled) restoreOrder(current.order);
        container.classList.remove('roster-reordering');
        current.card.classList.remove('roster-dragging');
        current.card.removeAttribute('aria-grabbed');
        try { container.releasePointerCapture(current.pointerId); } catch (_) { /* Already released by the browser. */ }
      }
      const result = ids();
      const changed = !cancelled && current.active && result.join('\0') !== current.order.join('\0');
      if (changed) options.onReorder?.(result, {
        agentId: current.card.dataset.agentId,
        position: result.indexOf(current.card.dataset.agentId) + 1,
        total: result.length,
        method: 'pointer',
      });
      // A short press must leave the original button alive until its click fires.
      if (current.active) options.onEnd?.({ cancelled, changed });
    }
    function reposition() {
      if (!gesture?.active) return;
      const card = gesture.card;
      const others = cards().filter(item => item !== card);
      const next = others.find(item => {
        const rect = item.getBoundingClientRect();
        return gesture.x < rect.left + rect.width / 2;
      });
      if (next) container.insertBefore(card, next);
      else container.appendChild(card);
    }
    function tick() {
      frame = null;
      if (!gesture?.active) return;
      const rect = container.getBoundingClientRect();
      const edge = Math.min(48, rect.width / 4);
      const left = Math.max(0, Math.min(1, (rect.left + edge - gesture.x) / edge));
      const right = Math.max(0, Math.min(1, (gesture.x - rect.right + edge) / edge));
      container.scrollLeft += (right - left) * 12;
      reposition();
      frame = win.requestAnimationFrame(tick);
    }
    function targetCard(event) {
      const card = event.target.closest?.(selector);
      return card && container.contains(card) ? card : null;
    }
    listen(container, 'pointerdown', event => {
      if (destroyed || gesture || event.button !== 0 || event.isPrimary === false || (event.pointerType && event.pointerType !== 'mouse')) return;
      const card = targetCard(event);
      if (!card || cards().length < 2) return;
      suppressClick = false;
      win.clearTimeout(suppressTimer);
      gesture = { card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, order: ids(), active: false };
      timer = win.setTimeout(() => {
        if (!gesture || !container.contains(card)) return finish(true);
        gesture.active = true;
        container.classList.add('roster-reordering');
        card.classList.add('roster-dragging');
        card.setAttribute('aria-grabbed', 'true');
        try { container.setPointerCapture(gesture.pointerId); } catch (_) { /* Window listeners still complete the gesture. */ }
        options.onStart?.({ agentId: card.dataset.agentId });
        frame = win.requestAnimationFrame(tick);
      }, options.holdDelay ?? 350);
    });
    listen(win, 'pointermove', event => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      if (!gesture.active) {
        if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) > 8) {
          blockClick();
          finish(true);
        }
        return;
      }
      consume(event);
      reposition();
    }, true);
    listen(win, 'pointerup', event => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.active) consume(event);
      finish(false);
    }, true);
    listen(win, 'pointercancel', event => {
      if (gesture && event.pointerId === gesture.pointerId) finish(true);
    }, true);
    listen(container, 'lostpointercapture', () => { if (gesture?.active) finish(true); });
    listen(win, 'blur', () => finish(true));
    listen(win, 'keydown', event => {
      if (event.key === 'Escape' && gesture) { consume(event); finish(true); }
    }, true);
    listen(container, 'click', event => {
      if (suppressClick || gesture?.active) { consume(event); suppressClick = false; }
    }, true);
    listen(container, 'dragstart', event => { if (targetCard(event)) consume(event); });
    listen(container, 'keydown', event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || gesture) return;
      const card = targetCard(event);
      if (!card) return;
      consume(event);
      const order = ids();
      const id = card.dataset.agentId;
      const result = moveId(order, id, order.indexOf(id) + (event.key === 'ArrowLeft' ? -1 : 1));
      if (result.join('\0') === order.join('\0')) return;
      restoreOrder(result);
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      options.onReorder?.(result, { agentId: id, position: result.indexOf(id) + 1, total: result.length, method: 'keyboard' });
      options.onEnd?.({ cancelled: false, changed: true });
    });
    listen(container, 'wheel', event => {
      if (event.ctrlKey || event.deltaX !== 0 || !event.deltaY || container.scrollWidth <= container.clientWidth + 1) return;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientWidth : 1;
      const before = container.scrollLeft;
      const next = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, before + event.deltaY * multiplier));
      if (next === before) return;
      event.preventDefault();
      container.scrollLeft = next;
    }, { passive: false });
    return {
      isInteracting: () => gesture !== null,
      cancel: () => finish(true),
      destroy() {
        finish(true);
        destroyed = true;
        win.clearTimeout(suppressTimer);
        for (const remove of listeners) remove();
      },
    };
  }
  return { attach, normalizeOrder, moveId };
}));
