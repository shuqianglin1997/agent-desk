const test = require('node:test');
const assert = require('node:assert/strict');
const { attach, normalizeOrder, moveId } = require('../src/roster-interactions');

function fixture() {
  function events(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); },
      emit(type, values = {}) {
        const event = { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 30, deltaX: 0, deltaY: 0,
          preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
        for (const fn of listeners.get(type) || []) { fn(event); if (event.stopped) break; }
        return event;
      },
    });
  }
  let sequence = 0;
  const timers = new Map();
  const frames = new Map();
  const win = events({
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    timers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  });
  const classes = () => ({ add() {}, remove() {} });
  const container = events({ ownerDocument: { defaultView: win }, children: [], classList: classes(), scrollLeft: 0, scrollWidth: 500, clientWidth: 300,
    querySelectorAll() { return this.children; }, contains(card) { return this.children.includes(card); },
    appendChild(card) { this.children = this.children.filter(item => item !== card); this.children.push(card); },
    insertBefore(card, next) { this.children = this.children.filter(item => item !== card); this.children.splice(this.children.indexOf(next), 0, card); },
    getBoundingClientRect() { return { left: 0, right: 300, width: 300 }; }, setPointerCapture() {}, releasePointerCapture() {},
  });
  const cards = ['a', 'b', 'c'].map(id => ({ dataset: { agentId: id }, classList: classes(),
    closest() { return this; }, setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {},
    getBoundingClientRect() { return { left: container.children.indexOf(this) * 100 - container.scrollLeft, width: 100 }; },
  }));
  container.children = [...cards];
  const saved = [];
  const control = attach(container, { onReorder: (order, details) => saved.push({ order, details }) });
  return { win, container, cards, control, saved, order: () => container.children.map(card => card.dataset.agentId), down: () => container.emit('pointerdown', { target: cards[0] }) };
}

test('saved order discards removed/duplicate IDs, appends new IDs and accepts no malformed order', () => {
  assert.deepEqual(normalizeOrder(['b', 'gone', 'b'], ['a', 'b', 'c', 'a']), ['b', 'a', 'c']);
  assert.deepEqual(normalizeOrder('a', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 99), ['a', 'c', 'b']);
});

test('short press preserves normal click and does not save or reorder', () => {
  const f = fixture(); f.down();
  f.win.emit('pointerup'); f.win.timers();
  assert.equal(f.control.isInteracting(), false);
  assert.equal(f.container.emit('click', { target: f.cards[0] }).prevented, undefined);
  assert.deepEqual(f.saved, []);
});

test('long press reorders live, commits once on release and consumes resulting click', () => {
  const f = fixture(); f.down(); f.win.timers();
  f.win.emit('pointermove', { clientX: 260 });
  assert.deepEqual(f.order(), ['b', 'c', 'a']); assert.equal(f.saved.length, 0);
  f.win.emit('pointerup'); f.win.emit('pointerup');
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].details.position, 3);
  assert.equal(f.container.emit('click', { target: f.cards[0] }).prevented, true);
  assert.equal(f.control.isInteracting(), false);
});

for (const cancellation of ['escape', 'blur', 'pointercancel', 'api']) {
  test(`${cancellation} restores original order without saving`, () => {
    const f = fixture(); f.down(); f.win.timers(); f.win.emit('pointermove', { clientX: 260 });
    if (cancellation === 'escape') f.win.emit('keydown', { key: 'Escape' });
    else if (cancellation === 'api') f.control.cancel();
    else f.win.emit(cancellation);
    assert.deepEqual(f.order(), ['a', 'b', 'c']); assert.deepEqual(f.saved, []);
    assert.equal(f.control.isInteracting(), false);
  });
}

test('movement before long press cancels; edge scroll continues only during drag', () => {
  const f = fixture(); f.down(); f.win.emit('pointermove', { clientX: 75 }); f.win.timers();
  assert.equal(f.control.isInteracting(), false); assert.deepEqual(f.saved, []);
  f.down(); f.win.timers(); f.win.emit('pointermove', { clientX: 299 }); f.win.frame();
  assert.ok(f.container.scrollLeft > 0);
  f.control.cancel(); const scroll = f.container.scrollLeft; f.win.frame();
  assert.equal(f.container.scrollLeft, scroll);
});

test('Alt+arrow moves focused card and does not wrap at boundary', () => {
  const f = fixture();
  f.container.emit('keydown', { target: f.cards[0], key: 'ArrowRight', altKey: true });
  assert.deepEqual(f.saved[0].order, ['b', 'a', 'c']);
  assert.equal(f.saved[0].details.method, 'keyboard');
  f.container.emit('keydown', { target: f.cards[1], key: 'ArrowLeft', altKey: true });
  assert.equal(f.saved.length, 1);
});

test('vertical wheel scrolls horizontally but preserves trackpad, zoom and boundary behavior', () => {
  const f = fixture();
  assert.equal(f.container.emit('wheel', { deltaY: 2, deltaMode: 1 }).prevented, true);
  assert.equal(f.container.scrollLeft, 32);
  assert.equal(f.container.emit('wheel', { deltaX: 10, deltaY: 10 }).prevented, undefined);
  assert.equal(f.container.emit('wheel', { ctrlKey: true, deltaY: 20 }).prevented, undefined);
  f.container.scrollLeft = 200;
  assert.equal(f.container.emit('wheel', { deltaY: 20 }).prevented, undefined);
  f.container.scrollWidth = 300;
  assert.equal(f.container.emit('wheel', { deltaY: -20 }).prevented, undefined);
  f.control.destroy(); f.container.scrollWidth = 500;
  assert.equal(f.container.emit('wheel', { deltaY: -20 }).prevented, undefined);
});
