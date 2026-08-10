const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeRemoteInput } = require('../domain/remote-input');

const HELPER_NAMES = Object.freeze({
  darwin: 'AgentDeskInputHelper',
  win32: 'AgentDeskInputHelper.exe'
});

class RemoteInputAdapter {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.screen = options.screen;
    this.systemPreferences = options.systemPreferences;
    this.helperPath = options.helperPath || '';
    this.spawn = options.spawn || spawn;
    this.fs = options.fs || fs;
    this.child = null;
    this.heartbeat = null;
    this.lastError = null;
    this.stderrTail = '';
  }

  status(options = {}) {
    const helperName = HELPER_NAMES[this.platform];
    if (!helperName) return { supported: false, helper: false, permission: 'unsupported' };
    const helper = Boolean(this.helperPath && this.fs.existsSync(this.helperPath));
    let permission = 'available';
    if (this.platform === 'darwin') {
      try {
        permission = this.systemPreferences?.isTrustedAccessibilityClient?.(options.prompt === true)
          ? 'granted'
          : 'denied';
      } catch (_error) {
        permission = 'unknown';
      }
    }
    return {
      supported: true,
      helper,
      permission,
      ready: helper && (permission === 'granted' || this.platform === 'win32')
    };
  }

  ensureReady(options = {}) {
    const status = this.status(options);
    if (!status.supported) throw new Error('input-platform-unsupported');
    if (!status.helper) throw new Error('input-helper-unavailable');
    if (this.platform === 'darwin' && status.permission !== 'granted') throw new Error('input-accessibility-denied');
    this.ensureChild();
    return status;
  }

  inject(value, options = {}) {
    const event = normalizeRemoteInput(value);
    if (event.type === 'releaseAll') return this.releaseAll();
    this.ensureReady({ prompt: false });
    const line = helperLine(event, {
      point: event.type === 'pointer' ? this.resolvePoint(options.displayId, event.x, event.y) : null
    });
    this.writeLine(line);
    return true;
  }

  releaseAll() {
    if (!this.child || this.child.killed || !this.child.stdin?.writable) return false;
    this.writeLine('RELEASE');
    return true;
  }

  stop() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      if (child.stdin?.writable) child.stdin.write('RELEASE\n');
      child.stdin?.end();
    } catch (_error) {
      // Process exit is the final fallback; helper releases on EOF.
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_error) { /* already exited */ }
    }, 800);
    timer.unref?.();
  }

  resolvePoint(displayId, x, y) {
    if (!this.screen || typeof this.screen.getAllDisplays !== 'function') throw new Error('input-display-api-unavailable');
    const displays = this.screen.getAllDisplays();
    const display = displays.find((item) => String(item.id) === String(displayId || ''));
    if (!display) throw new Error('input-display-not-found');
    const bounds = display.bounds || {};
    const width = finitePositive(bounds.width, 'input-display-width');
    const height = finitePositive(bounds.height, 'input-display-height');
    const point = {
      x: Math.round(Number(bounds.x || 0) + Number(x) * Math.max(0, width - 1)),
      y: Math.round(Number(bounds.y || 0) + Number(y) * Math.max(0, height - 1))
    };
    if (this.platform === 'win32' && typeof this.screen.dipToScreenPoint === 'function') {
      const physical = this.screen.dipToScreenPoint(point);
      if (Number.isFinite(physical?.x) && Number.isFinite(physical?.y)) {
        return { x: Math.round(physical.x), y: Math.round(physical.y) };
      }
    }
    return point;
  }

  ensureChild() {
    if (this.child && !this.child.killed && this.child.stdin?.writable) return this.child;
    const child = this.spawn(this.helperPath, [], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    this.lastError = null;
    this.stderrTail = '';
    child.stderr?.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk || '')}`.slice(-2048);
    });
    child.on('error', (error) => {
      this.lastError = safeError(error);
      if (this.child === child) this.child = null;
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (code !== 0 && code !== null) this.lastError = `input-helper-exit-${code}`;
      if (signal) this.lastError = `input-helper-signal-${safeError(signal)}`;
    });
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.child || this.child.killed || !this.child.stdin?.writable) return;
      try { this.child.stdin.write('PING\n'); } catch (_error) { /* exit handler owns state */ }
    }, 1_000);
    this.heartbeat.unref?.();
    return child;
  }

  writeLine(line) {
    if (!this.child || this.child.killed || !this.child.stdin?.writable) throw new Error('input-helper-not-running');
    if (!/^[A-Z]+(?:\t[^\r\n]*)*$/.test(line) || Buffer.byteLength(line) > 16 * 1024) {
      throw new Error('input-helper-protocol');
    }
    const accepted = this.child.stdin.write(`${line}\n`);
    if (!accepted && this.child.stdin.writableLength > 64 * 1024) throw new Error('input-helper-backpressure');
  }
}

function helperLine(event, options = {}) {
  if (event.type === 'pointer') {
    const point = options.point;
    if (!point || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) throw new Error('input-pointer-point');
    if (event.action === 'move') return `MOVE\t${point.x}\t${point.y}`;
    return `BUTTON\t${event.action.toUpperCase()}\t${event.button.toUpperCase()}\t${point.x}\t${point.y}`;
  }
  if (event.type === 'scroll') return `SCROLL\t${event.deltaX}\t${event.deltaY}`;
  if (event.type === 'key') {
    return `KEY\t${event.action.toUpperCase()}\t${event.code}\t${modifierMask(event.modifiers)}\t${event.repeat ? 1 : 0}`;
  }
  if (event.type === 'text') return `TEXT\t${Buffer.from(event.text, 'utf8').toString('base64')}`;
  if (event.type === 'releaseAll') return 'RELEASE';
  throw new Error('input-helper-event');
}

function modifierMask(modifiers) {
  const set = new Set(Array.isArray(modifiers) ? modifiers : []);
  return (set.has('Shift') ? 1 : 0)
    | (set.has('Control') ? 2 : 0)
    | (set.has('Alt') ? 4 : 0)
    | (set.has('Meta') ? 8 : 0);
}

function defaultInputHelperPath(options = {}) {
  const platform = options.platform || process.platform;
  const name = HELPER_NAMES[platform];
  if (!name) return '';
  if (options.isPackaged) return path.join(options.resourcesPath, 'native', name);
  return path.join(options.appPath, 'native', 'bin', name);
}

function finitePositive(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 32768) throw new Error(code);
  return number;
}

function safeError(error) {
  return String(error?.message || error || 'input-helper-failed')
    .trim().replace(/[^a-z0-9._:-]/gi, '-').slice(0, 120) || 'input-helper-failed';
}

module.exports = {
  HELPER_NAMES,
  RemoteInputAdapter,
  helperLine,
  modifierMask,
  defaultInputHelperPath
};
