const crypto = require('node:crypto');
const http = require('node:http');
const {
  verifySignalingRequest
} = require('../../src/mesh/protocol/signaling-auth');

const MAX_REQUEST_BYTES = 384 * 1024;
const MAX_QUEUED_MESSAGE_BYTES = 256 * 1024;
const MAX_POLL_RESPONSE_BYTES = 352 * 1024;
const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_POLL_TIMEOUT_MS = 20_000;
const MAX_QUEUE_MESSAGES = 64;
const SIGNAL_TTL_MS = 45_000;

class SignalingGateway {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = Number.isSafeInteger(options.port) ? options.port : 8787;
    this.now = options.now || Date.now;
    this.leaseTtlMs = clamp(options.leaseTtlMs, 20_000, 120_000, DEFAULT_LEASE_TTL_MS);
    this.pollTimeoutMs = clamp(options.pollTimeoutMs, 1_000, 25_000, DEFAULT_POLL_TIMEOUT_MS);
    this.turnSecret = cleanText(options.turnSecret, 4096);
    this.turnUrls = normalizeTurnUrls(options.turnUrls);
    this.turnTtlSeconds = clamp(options.turnTtlSeconds, 60, 86_400, 3_600);
    this.server = null;
    this.routes = new Map();
    this.seenRequests = new Map();
    this.pairWaiters = new Map();
    this.rate = new Map();
  }

  async start() {
    if (this.server) return this.address();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        sendJson(response, statusForError(error), {
          ok: false,
          reasonCode: safeError(error)
        });
      });
    });
    this.server.keepAliveTimeout = 30_000;
    this.server.headersTimeout = 35_000;
    await listen(this.server, this.port, this.host);
    return this.address();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    for (const route of this.routes.values()) this.wakePollers(route);
    for (const waiter of this.pairWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(codeError('signaling-stopped', 503));
    }
    this.pairWaiters.clear();
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  address() {
    if (!this.server) return null;
    const bound = this.server.address();
    const port = typeof bound === 'object' && bound ? bound.port : this.port;
    const host = this.host === '0.0.0.0' || this.host === '::' ? '127.0.0.1' : this.host;
    return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  }

  async handle(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method === 'GET' && request.url === '/v1/health') {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: '1.0',
        turnCredentials: Boolean(this.turnSecret && this.turnUrls.length)
      });
      return;
    }
    if (request.method !== 'POST') throw codeError('signaling-route-not-found', 404);
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw codeError('signaling-content-type', 415);
    }
    const address = request.socket.remoteAddress || 'unknown';
    this.checkRate(address, request.url === '/v1/pair/claim' ? 12 : 180);
    const body = await readJson(request);
    let result;
    if (request.url === '/v1/lease') result = this.handleLease(body);
    else if (request.url === '/v1/poll') result = await this.handlePoll(body);
    else if (request.url === '/v1/signal/send') result = this.handleSignal(body);
    else if (request.url === '/v1/pair/claim') result = await this.handlePairClaim(body);
    else if (request.url === '/v1/pair/respond') result = this.handlePairResponse(body);
    else if (request.url === '/v1/turn-credentials') result = this.handleTurnCredentials(body);
    else throw codeError('signaling-route-not-found', 404);
    sendJson(response, 200, { ok: true, ...result });
  }

  handleLease(request) {
    const deviceId = requiredIdentifier(request.deviceId, 'deviceId');
    const publicKey = validatePublicKey(request.devicePublicKey);
    this.verifyRequest(request, publicKey, 'lease', deviceId);
    const route = this.bindRoute(deviceId, publicKey);
    route.leaseExpiresAt = this.nowMs() + this.leaseTtlMs;
    return {
      lease: {
        expiresAt: new Date(route.leaseExpiresAt).toISOString(),
        pollTimeoutMs: this.pollTimeoutMs,
        turnCredentials: Boolean(this.turnSecret && this.turnUrls.length)
      }
    };
  }

  async handlePoll(request) {
    const { route } = this.verifyBoundRequest(request, 'poll', { requireLease: true });
    this.pruneQueue(route);
    if (!route.queue.length) await this.waitForMessage(route);
    this.pruneQueue(route);
    return { messages: this.takeMessages(route) };
  }

  handleSignal(request) {
    const { deviceId } = this.verifyBoundRequest(request, 'signal.send', { requireLease: true });
    const targetDeviceId = requiredIdentifier(request.targetDeviceId, 'targetDeviceId');
    if (deviceId === targetDeviceId) throw codeError('signaling-self-target', 400);
    const kind = String(request.kind || '');
    if (!['peer.offer', 'peer.answer'].includes(kind)) throw codeError('signaling-kind-invalid', 400);
    const correlationId = requiredIdentifier(request.correlationId, 'correlationId');
    validatePeerEnvelope(request.payload, kind, deviceId, targetDeviceId, correlationId);
    this.enqueue(targetDeviceId, {
      messageId: request.requestId,
      kind,
      sourceDeviceId: deviceId,
      targetDeviceId,
      correlationId,
      payload: request.payload,
      expiresAt: new Date(this.nowMs() + SIGNAL_TTL_MS).toISOString()
    });
    return { accepted: true };
  }

  async handlePairClaim(request) {
    const deviceId = requiredIdentifier(request.deviceId, 'deviceId');
    const targetDeviceId = requiredIdentifier(request.targetDeviceId, 'targetDeviceId');
    const publicKey = validatePublicKey(request.devicePublicKey);
    this.verifyRequest(request, publicKey, 'pair.claim', deviceId);
    if (request.payload?.deviceId !== deviceId || request.payload?.devicePublicKey !== request.devicePublicKey) {
      throw codeError('pairing-device-mismatch', 400);
    }
    if (String(request.payload?.inviteId || '') !== String(request.inviteId || '')) {
      throw codeError('pairing-invite-mismatch', 400);
    }
    const pairRequestId = request.requestId;
    if (this.pairWaiters.has(pairRequestId)) throw codeError('pairing-request-duplicate', 409);
    const response = this.waitForPairResponse(pairRequestId, targetDeviceId, deviceId);
    try {
      this.enqueue(targetDeviceId, {
        messageId: pairRequestId,
        kind: 'pair.claim',
        sourceDeviceId: deviceId,
        targetDeviceId,
        correlationId: pairRequestId,
        payload: request.payload,
        expiresAt: new Date(this.nowMs() + SIGNAL_TTL_MS).toISOString()
      });
    } catch (error) {
      const waiter = this.pairWaiters.get(pairRequestId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pairWaiters.delete(pairRequestId);
        waiter.reject(error);
      }
      throw error;
    }
    return response;
  }

  handlePairResponse(request) {
    const { deviceId } = this.verifyBoundRequest(request, 'pair.respond', { requireLease: true });
    const pairRequestId = requiredIdentifier(request.pairRequestId, 'pairRequestId');
    const waiter = this.pairWaiters.get(pairRequestId);
    if (!waiter || waiter.targetDeviceId !== deviceId) throw codeError('pairing-response-stale', 404);
    if (String(request.targetDeviceId || '') !== waiter.joiningDeviceId) {
      throw codeError('pairing-response-target', 400);
    }
    clearTimeout(waiter.timer);
    this.pairWaiters.delete(pairRequestId);
    if (request.errorCode) waiter.reject(codeError(safeError(request.errorCode), 400));
    else if (!request.response || typeof request.response !== 'object') {
      waiter.reject(codeError('pairing-response-invalid', 400));
    } else {
      waiter.resolve({ response: request.response });
    }
    return { accepted: true };
  }

  handleTurnCredentials(request) {
    const { deviceId } = this.verifyBoundRequest(request, 'turn.credentials', { requireLease: true });
    if (!this.turnSecret || !this.turnUrls.length) throw codeError('turn-credentials-unavailable', 503);
    const expires = Math.floor(this.nowMs() / 1000) + this.turnTtlSeconds;
    const username = `${expires}:${deviceId}`;
    const credential = crypto.createHmac('sha1', this.turnSecret).update(username).digest('base64');
    return {
      iceServer: {
        urls: this.turnUrls,
        username,
        credential,
        expiresAt: new Date(expires * 1000).toISOString()
      }
    };
  }

  verifyBoundRequest(request, operation, options = {}) {
    const deviceId = requiredIdentifier(request.deviceId, 'deviceId');
    let route = this.routes.get(deviceId);
    if (!route && options.allowUnleasedBinding) {
      const publicKey = validatePublicKey(request.devicePublicKey);
      route = this.bindRoute(deviceId, publicKey);
    }
    if (!route) throw codeError('signaling-device-not-leased', 404);
    if (request.devicePublicKey && normalizePublicKey(request.devicePublicKey) !== route.publicKey) {
      throw codeError('signaling-device-key-mismatch', 403);
    }
    this.verifyRequest(request, route.publicKey, operation, deviceId);
    if (options.requireLease && route.leaseExpiresAt <= this.nowMs()) {
      throw codeError('signaling-lease-expired', 409);
    }
    return { route, deviceId };
  }

  verifyRequest(request, publicKey, operation, deviceId) {
    const verified = verifySignalingRequest(request, publicKey, {
      operation,
      now: new Date(this.nowMs()).toISOString()
    });
    if (!verified.ok) throw codeError(verified.reason, 403);
    if (String(request.deviceId || '') !== deviceId) throw codeError('signaling-device-mismatch', 403);
    this.pruneSeen();
    const replayKey = `${deviceId}:${request.requestId}`;
    if (this.seenRequests.has(replayKey)) throw codeError('signaling-request-replay', 409);
    this.seenRequests.set(replayKey, Date.parse(request.expiresAt));
  }

  bindRoute(deviceId, publicKey) {
    const normalized = normalizePublicKey(publicKey);
    const current = this.routes.get(deviceId);
    if (current && current.publicKey !== normalized) throw codeError('signaling-device-key-mismatch', 403);
    if (current) return current;
    const route = { deviceId, publicKey: normalized, leaseExpiresAt: 0, queue: [], pollers: new Set() };
    this.routes.set(deviceId, route);
    return route;
  }

  enqueue(targetDeviceId, message) {
    const route = this.routes.get(targetDeviceId);
    if (!route || route.leaseExpiresAt <= this.nowMs()) throw codeError('signaling-target-offline', 409);
    this.pruneQueue(route);
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_QUEUED_MESSAGE_BYTES) {
      throw codeError('signaling-message-too-large', 413);
    }
    if (route.queue.length >= MAX_QUEUE_MESSAGES) throw codeError('signaling-target-busy', 429);
    route.queue.push(message);
    this.wakePollers(route);
  }

  takeMessages(route) {
    const messages = [];
    let bytes = Buffer.byteLength('{"ok":true,"messages":[]}');
    while (route.queue.length && messages.length < 8) {
      const next = route.queue[0];
      const nextBytes = Buffer.byteLength(JSON.stringify(next)) + (messages.length ? 1 : 0);
      if (messages.length && bytes + nextBytes > MAX_POLL_RESPONSE_BYTES) break;
      route.queue.shift();
      messages.push(next);
      bytes += nextBytes;
    }
    return messages;
  }

  waitForMessage(route) {
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        route.pollers.delete(waiter);
        resolve();
      }, this.pollTimeoutMs);
      route.pollers.add(waiter);
    });
  }

  wakePollers(route) {
    for (const waiter of route.pollers) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    route.pollers.clear();
  }

  waitForPairResponse(pairRequestId, targetDeviceId, joiningDeviceId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pairWaiters.delete(pairRequestId);
        reject(codeError('pairing-response-timeout', 504));
      }, Math.min(25_000, this.pollTimeoutMs + 5_000));
      this.pairWaiters.set(pairRequestId, { targetDeviceId, joiningDeviceId, resolve, reject, timer });
    });
  }

  pruneQueue(route) {
    const now = this.nowMs();
    route.queue = route.queue.filter((message) => Date.parse(message.expiresAt) > now);
  }

  pruneSeen() {
    const now = this.nowMs();
    for (const [key, expiresAt] of this.seenRequests) {
      if (!Number.isFinite(expiresAt) || expiresAt <= now) this.seenRequests.delete(key);
    }
    if (this.seenRequests.size > 10_000) this.seenRequests.delete(this.seenRequests.keys().next().value);
  }

  checkRate(address, maximum) {
    const now = this.nowMs();
    const previous = this.rate.get(address) || [];
    const recent = previous.filter((time) => now - time < 60_000);
    if (recent.length >= maximum) throw codeError('signaling-rate-limited', 429);
    recent.push(now);
    this.rate.set(address, recent);
    if (this.rate.size > 2_048) this.rate.delete(this.rate.keys().next().value);
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }
}

function validatePeerEnvelope(envelope, kind, sourceDeviceId, targetDeviceId, correlationId) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw codeError('signaling-envelope-invalid', 400);
  }
  const expectedType = kind === 'peer.offer' ? 'webrtc.offer' : 'webrtc.answer';
  if (
    envelope.messageType !== expectedType ||
    envelope.sourceDeviceId !== sourceDeviceId ||
    envelope.targetDeviceId !== targetDeviceId ||
    envelope.connectionId !== correlationId
  ) {
    throw codeError('signaling-envelope-mismatch', 400);
  }
}

function validatePublicKey(value) {
  const normalized = normalizePublicKey(value);
  try {
    const key = crypto.createPublicKey(normalized);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error();
    return normalized;
  } catch (_error) {
    throw codeError('signaling-public-key-invalid', 400);
  }
}

function normalizePublicKey(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 16_384) throw codeError('signaling-public-key-invalid', 400);
  return text;
}

function normalizeTurnUrls(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item || '').trim())
    .filter((item) => /^(turn|turns):/i.test(item)))]
    .slice(0, 8);
}

function requiredIdentifier(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 160 || !/^[a-z0-9._:-]+$/i.test(text)) {
    throw codeError(`${field}-invalid`, 400);
  }
  return text;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(codeError('signaling-request-too-large', 413));
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
        reject(codeError('signaling-json-invalid', 400));
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
  return String(error?.message || error || 'signaling-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'signaling-failed';
}

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

module.exports = {
  MAX_REQUEST_BYTES,
  MAX_QUEUED_MESSAGE_BYTES,
  MAX_POLL_RESPONSE_BYTES,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  MAX_QUEUE_MESSAGES,
  SIGNAL_TTL_MS,
  SignalingGateway,
  normalizeTurnUrls,
  validatePeerEnvelope
};
