const crypto = require('node:crypto');
const path = require('node:path');

const RESULT_CHANNEL = 'mesh-probe:result';
let activeProbe = null;

function runWebRtcProbe(options = {}) {
  if (activeProbe) return activeProbe;
  activeProbe = runProbeOnce(options).finally(() => {
    activeProbe = null;
  });
  return activeProbe;
}

function runProbeOnce(options) {
  const BrowserWindow = options.BrowserWindow;
  const ipcMain = options.ipcMain;
  const probeDirectory = options.probeDirectory;
  const timeoutMs = finiteTimeout(options.timeoutMs);
  if (typeof BrowserWindow !== 'function' || !ipcMain || !probeDirectory) {
    return Promise.reject(new TypeError('webrtc-probe-runtime-missing'));
  }

  const token = crypto.randomBytes(24).toString('hex');
  const probeWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(probeDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--mesh-probe-token=${token}`]
    }
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener(RESULT_CHANNEL, onResult);
      if (!probeWindow.isDestroyed()) probeWindow.destroy();
      callback(value);
    };
    const onResult = (event, envelope = {}) => {
      if (event.sender.id !== probeWindow.webContents.id || envelope.token !== token) return;
      try {
        const result = normalizeProbeResult(envelope.result);
        if (!result.ok) {
          finish(reject, new Error(result.errorCode));
          return;
        }
        finish(resolve, result);
      } catch (error) {
        finish(reject, error);
      }
    };
    const timer = setTimeout(() => finish(reject, new Error('webrtc-probe-timeout')), timeoutMs);
    ipcMain.on(RESULT_CHANNEL, onResult);
    probeWindow.webContents.once('render-process-gone', (_event, details) => {
      finish(reject, new Error(`webrtc-probe-renderer-${details?.reason || 'gone'}`));
    });
    probeWindow.webContents.once('did-fail-load', (_event, code) => {
      finish(reject, new Error(`webrtc-probe-load-${code}`));
    });
    probeWindow.loadFile(path.join(probeDirectory, 'index.html')).catch((error) => {
      finish(reject, new Error(`webrtc-probe-load-${error?.message || 'failed'}`));
    });
  });
}

function normalizeProbeResult(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('webrtc-probe-result-invalid');
  }
  if (value.ok !== true) {
    return {
      ok: false,
      errorCode: safeEnum(value.errorCode, 'webrtc-probe-failed', 100)
    };
  }
  const elapsedMs = Number(value.elapsedMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 60_000) {
    throw new TypeError('webrtc-probe-duration-invalid');
  }
  return {
    ok: true,
    elapsedMs: Math.round(elapsedMs),
    channel: value.channel === 'control.reliable' ? value.channel : 'control.reliable',
    ordered: value.ordered === true,
    candidateTypes: safeEnums(value.candidateTypes, ['host', 'srflx', 'prflx', 'relay']),
    protocols: safeEnums(value.protocols, ['udp', 'tcp']),
    selectedPairState: safeEnum(value.selectedPairState, 'unknown', 24)
  };
}

function safeEnums(value, allowed) {
  if (!Array.isArray(value)) return [];
  const allow = new Set(allowed);
  return [...new Set(value.map((item) => String(item || '').toLowerCase()).filter((item) => allow.has(item)))];
}

function safeEnum(value, fallback, maxLength) {
  const text = String(value || '').trim().replace(/[^a-z0-9._-]/gi, '-').slice(0, maxLength);
  return text || fallback;
}

function finiteTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) ? Math.max(3_000, Math.min(timeout, 30_000)) : 12_000;
}

module.exports = {
  RESULT_CHANNEL,
  normalizeProbeResult,
  runWebRtcProbe
};
