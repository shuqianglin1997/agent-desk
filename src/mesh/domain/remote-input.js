const MAX_TEXT_UNITS = 2048;
const MAX_INPUT_MESSAGE_BYTES = 16 * 1024;

const MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const POINTER_BUTTONS = new Set(['left', 'middle', 'right']);
const KEY_CODES = new Set([
  'Backquote', 'Backslash', 'BracketLeft', 'BracketRight', 'Comma', 'Equal', 'IntlBackslash',
  'IntlRo', 'IntlYen', 'Minus', 'Period', 'Quote', 'Semicolon', 'Slash',
  'Backspace', 'CapsLock', 'ContextMenu', 'Delete', 'End', 'Enter', 'Escape', 'Home', 'Insert',
  'PageDown', 'PageUp', 'Space', 'Tab',
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight',
  'NumLock', 'NumpadAdd', 'NumpadComma', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter',
  'NumpadEqual', 'NumpadMultiply', 'NumpadSubtract',
  ...Array.from({ length: 26 }, (_value, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_value, index) => `Digit${index}`),
  ...Array.from({ length: 10 }, (_value, index) => `Numpad${index}`),
  ...Array.from({ length: 24 }, (_value, index) => `F${index + 1}`)
]);

function normalizeRemoteInput(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('remote-input-schema');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_MESSAGE_BYTES) throw new Error('remote-input-size');
  const type = String(value.type || '');
  if (type === 'pointer') {
    const action = String(value.action || '');
    if (!['move', 'down', 'up'].includes(action)) throw new Error('remote-pointer-action');
    const result = {
      type,
      action,
      x: normalizedCoordinate(value.x, 'remote-pointer-x'),
      y: normalizedCoordinate(value.y, 'remote-pointer-y')
    };
    if (action !== 'move') {
      const button = String(value.button || '');
      if (!POINTER_BUTTONS.has(button)) throw new Error('remote-pointer-button');
      result.button = button;
    }
    return result;
  }
  if (type === 'scroll') {
    return {
      type,
      deltaX: boundedDelta(value.deltaX),
      deltaY: boundedDelta(value.deltaY)
    };
  }
  if (type === 'key') {
    const action = String(value.action || '');
    if (!['down', 'up'].includes(action)) throw new Error('remote-key-action');
    const code = String(value.code || '');
    if (!KEY_CODES.has(code)) throw new Error('remote-key-code');
    return {
      type,
      action,
      code,
      key: cleanKey(value.key),
      modifiers: normalizeModifiers(value.modifiers),
      repeat: action === 'down' && value.repeat === true
    };
  }
  if (type === 'text') {
    const text = String(value.text || '').normalize('NFC');
    if (!text || text.length > MAX_TEXT_UNITS) throw new Error('remote-text-size');
    if (/\u0000/.test(text)) throw new Error('remote-text-null');
    return { type, text };
  }
  if (type === 'releaseAll') return { type };
  throw new Error('remote-input-type');
}

class InputRateGuard {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.buckets = new Map();
    this.limits = {
      pointer: Number(options.pointerLimit) || 240,
      scroll: Number(options.scrollLimit) || 120,
      key: Number(options.keyLimit) || 180,
      text: Number(options.textLimit) || 24,
      releaseAll: 12
    };
  }

  accept(sessionId, event) {
    const id = String(sessionId || '');
    if (!id) throw new Error('remote-input-session');
    const type = String(event?.type || '');
    const limit = this.limits[type];
    if (!limit) throw new Error('remote-input-rate-type');
    const key = `${id}:${type}`;
    const now = Number(this.now());
    const recent = (this.buckets.get(key) || []).filter((time) => now - time < 1_000);
    if (recent.length >= limit) throw new Error(`remote-input-rate:${type}`);
    recent.push(now);
    this.buckets.set(key, recent);
    if (this.buckets.size > 128) this.buckets.delete(this.buckets.keys().next().value);
    return true;
  }

  clear(sessionId) {
    const prefix = `${String(sessionId || '')}:`;
    for (const key of this.buckets.keys()) if (key.startsWith(prefix)) this.buckets.delete(key);
  }
}

function normalizeModifiers(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(String)
    .filter((item) => MODIFIERS.has(item)))].sort();
}

function cleanKey(value) {
  const key = String(value || '');
  if (!key || key.length > 64 || /\u0000/.test(key)) return '';
  return key;
}

function normalizedCoordinate(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(field);
  return Math.round(number * 1_000_000) / 1_000_000;
}

function boundedDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('remote-scroll-delta');
  return Math.max(-4096, Math.min(4096, Math.round(number)));
}

module.exports = {
  MAX_TEXT_UNITS,
  MAX_INPUT_MESSAGE_BYTES,
  MODIFIERS,
  POINTER_BUTTONS,
  KEY_CODES,
  normalizeRemoteInput,
  InputRateGuard,
  normalizeModifiers
};
