const { URL } = require('node:url');

const MAIN_DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function canonicalDocumentUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    parsed.hash = '';
    return parsed.href;
  } catch (_error) {
    return '';
  }
}

function isTrustedMainSender(event, options = {}) {
  const window = options.getWindow?.();
  if (!event || !window || window.isDestroyed?.()) return false;
  const webContents = window.webContents;
  if (!webContents || webContents.isDestroyed?.()) return false;
  if (event.sender !== webContents) return false;

  const senderFrame = event.senderFrame;
  const mainFrame = webContents.mainFrame;
  if (!senderFrame || !mainFrame || senderFrame !== mainFrame) return false;

  const allowedUrl = canonicalDocumentUrl(options.allowedUrl);
  const senderUrl = canonicalDocumentUrl(senderFrame.url);
  return Boolean(allowedUrl && senderUrl === allowedUrl);
}

function createTrustedIpcMain(options = {}) {
  const rawIpcMain = options.ipcMain;
  if (!rawIpcMain || typeof rawIpcMain.handle !== 'function') {
    throw new TypeError('ipcMain.handle is required');
  }
  return {
    handle(channel, listener) {
      if (typeof channel !== 'string' || !channel || typeof listener !== 'function') {
        throw new TypeError('trusted IPC channel and listener are required');
      }
      rawIpcMain.handle(channel, (event, ...args) => {
        if (!isTrustedMainSender(event, options)) {
          throw new Error('ipc-untrusted-sender');
        }
        return listener(event, ...args);
      });
    }
  };
}

function withContentSecurityPolicy(responseHeaders = {}, csp = MAIN_DOCUMENT_CSP) {
  const next = { ...responseHeaders };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === 'content-security-policy') delete next[key];
  }
  next['Content-Security-Policy'] = [csp];
  return next;
}

function installMainWindowSecurity(window, options = {}) {
  if (!window?.webContents) throw new TypeError('BrowserWindow webContents is required');
  const webContents = window.webContents;
  const allowedUrl = canonicalDocumentUrl(options.allowedUrl);
  if (!allowedUrl) throw new TypeError('allowedUrl is required');

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const denyUnexpectedNavigation = (event, targetUrl) => {
    if (canonicalDocumentUrl(targetUrl) !== allowedUrl) event.preventDefault();
  };
  webContents.on('will-navigate', denyUnexpectedNavigation);
  webContents.on('will-redirect', denyUnexpectedNavigation);
  webContents.on('will-attach-webview', (event) => event.preventDefault());

  const webRequest = webContents.session?.webRequest;
  if (webRequest?.onHeadersReceived) {
    webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
      if (canonicalDocumentUrl(details.url) !== allowedUrl) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: withContentSecurityPolicy(details.responseHeaders, options.csp)
      });
    });
  }
}

module.exports = {
  MAIN_DOCUMENT_CSP,
  canonicalDocumentUrl,
  isTrustedMainSender,
  createTrustedIpcMain,
  withContentSecurityPolicy,
  installMainWindowSecurity
};
