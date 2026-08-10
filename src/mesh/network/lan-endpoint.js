const http = require('node:http');
const os = require('node:os');

const DEFAULT_PORT = 45831;
const MAX_REQUEST_BYTES = 384 * 1024;

class LanEndpoint {
  constructor(options = {}) {
    this.host = options.host || '0.0.0.0';
    this.port = Number.isSafeInteger(options.port) ? options.port : DEFAULT_PORT;
    this.onPairClaim = options.onPairClaim || null;
    this.onSignal = options.onSignal || null;
    this.server = null;
    this.boundPort = null;
    this.rate = new Map();
    this.now = options.now || Date.now;
  }

  async start() {
    if (this.server) return this.endpoints();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        sendJson(response, statusForError(error), {
          ok: false,
          reasonCode: safeError(error)
        });
      });
    });
    this.server.keepAliveTimeout = 5_000;
    this.server.headersTimeout = 10_000;
    await listen(this.server, this.port, this.host);
    const address = this.server.address();
    this.boundPort = typeof address === 'object' && address ? address.port : this.port;
    return this.endpoints();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  endpoints() {
    if (!this.boundPort) return [];
    const addresses = new Set(['127.0.0.1']);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item.internal || !item.address) continue;
        if (item.family === 'IPv4' || item.family === 4) addresses.add(item.address);
        if (item.family === 'IPv6' || item.family === 6) {
          const clean = String(item.address).split('%')[0];
          if (clean && !clean.startsWith('fe80:')) addresses.add(`[${clean}]`);
        }
      }
    }
    return [...addresses].map((address) => `http://${address}:${this.boundPort}`);
  }

  async handle(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && request.url === '/v1/health') {
      sendJson(response, 200, { ok: true, protocolVersion: '1.0' });
      return;
    }
    if (request.method !== 'POST') throw codeError('endpoint-not-found', 404);
    this.checkRate(request.socket.remoteAddress || 'unknown');
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw codeError('endpoint-content-type', 415);
    }
    const body = await readJson(request);
    if (request.url === '/v1/pair/claim') {
      if (typeof this.onPairClaim !== 'function') throw codeError('pairing-unavailable', 503);
      const result = await this.onPairClaim(body);
      sendJson(response, 200, { ok: true, response: result?.response || result });
      return;
    }
    if (request.url === '/v1/signal') {
      if (typeof this.onSignal !== 'function') throw codeError('signal-unavailable', 503);
      const result = await this.onSignal(body);
      sendJson(response, 200, { ok: true, response: result || null });
      return;
    }
    throw codeError('endpoint-not-found', 404);
  }

  checkRate(address) {
    const now = Number(this.now());
    const previous = this.rate.get(address) || [];
    const recent = previous.filter((time) => now - time < 60_000);
    if (recent.length >= 30) throw codeError('endpoint-rate-limited', 429);
    recent.push(now);
    this.rate.set(address, recent);
    if (this.rate.size > 512) this.rate.delete(this.rate.keys().next().value);
  }
}

async function claimPairing(invite, request, options = {}) {
  return postEndpoints(invite.endpoints, '/v1/pair/claim', { request }, {
    ...options,
    timeoutMs: finiteTimeout(options.timeoutMs, 12_000),
    failureCode: 'pairing-endpoint-unreachable',
    responseCode: 'pairing-response-too-large'
  });
}

async function sendPeerSignal(endpoints, signal, options = {}) {
  return postEndpoints(endpoints, '/v1/signal', signal, {
    ...options,
    timeoutMs: finiteTimeout(options.timeoutMs, 28_000),
    failureCode: 'peer-endpoint-unreachable',
    responseCode: 'peer-response-too-large'
  });
}

async function postEndpoints(endpoints, requestPath, body, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('endpoint-fetch-unavailable');
  const timeoutMs = finiteTimeout(options.timeoutMs, 12_000);
  const failures = [];
  for (const endpoint of Array.isArray(endpoints) ? endpoints : []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = normalizeEndpoint(endpoint);
      const response = await fetchImpl(`${base}${requestPath}`, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (text.length > MAX_REQUEST_BYTES) throw new Error(options.responseCode || 'endpoint-response-too-large');
      const payload = JSON.parse(text);
      if (!response.ok || payload?.ok !== true || !payload.response) {
        throw new Error(payload?.reasonCode || `endpoint-http-${response.status}`);
      }
      return payload.response;
    } catch (error) {
      failures.push(safeError(error));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(failures[0] || options.failureCode || 'endpoint-unreachable');
}

function normalizeEndpoint(value) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('endpoint-url-protocol');
  if (url.username || url.password || url.search || url.hash) throw new Error('endpoint-url-invalid');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('endpoint-url-path');
  return url.origin;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(codeError('endpoint-request-too-large', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch (_error) {
        reject(codeError('endpoint-json-invalid', 400));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function codeError(code, status) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function statusForError(error) {
  const status = Number(error?.status);
  return Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 400;
}

function safeError(error) {
  return String(error?.message || error || 'endpoint-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'endpoint-failed';
}

function finiteTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1_000, Math.min(number, 30_000)) : fallback;
}

module.exports = {
  DEFAULT_PORT,
  MAX_REQUEST_BYTES,
  LanEndpoint,
  claimPairing,
  sendPeerSignal,
  normalizeEndpoint
};
