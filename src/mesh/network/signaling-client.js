const {
  createSignalingRequest,
  normalizeServiceUrls
} = require('../protocol/signaling-auth');
const net = require('node:net');

const MAX_RESPONSE_BYTES = 384 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const SIGNAL_TIMEOUT_MS = 30_000;

class SignalingClient {
  constructor(options = {}) {
    this.allowInsecure = options.allowInsecure === true;
    this.serviceUrls = normalizeServiceUrls(options.serviceUrls, { allowInsecure: this.allowInsecure });
    this.identityProvider = options.identityProvider;
    this.onPeerSignal = options.onPeerSignal || null;
    this.onPairClaim = options.onPairClaim || null;
    this.onState = options.onState || (() => {});
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.running = false;
    this.starting = null;
    this.services = new Map(this.serviceUrls.map((url) => [url, serviceState(url)]));
    this.controllers = new Set();
    this.pendingSignals = new Map();
    this.turnIceServer = null;
    this.turnCredentialSource = null;
    this.turnCredentialExpiresAt = null;
  }

  async start() {
    if (!this.serviceUrls.length) return false;
    if (this.starting) return this.starting;
    if (this.running) return true;
    if (typeof this.fetch !== 'function') throw new Error('signaling-fetch-unavailable');
    this.running = true;
    this.emitState();
    this.starting = this.startInitial();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async startInitial() {
    const results = await Promise.all(this.serviceUrls.map(async (url) => {
      try {
        await this.lease(url);
        return true;
      } catch (error) {
        this.markFailure(url, error);
        return false;
      }
    }));
    for (const url of this.serviceUrls) void this.serviceLoop(url);
    if (!results.some(Boolean)) throw new Error(this.latestError() || 'signaling-unreachable');
    return true;
  }

  async stop(reason = 'signaling-stopped') {
    this.running = false;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    for (const pending of this.pendingSignals.values()) pending.reject(new Error(reason));
    this.pendingSignals.clear();
    for (const service of this.services.values()) {
      service.state = 'stopped';
      service.leaseExpiresAt = null;
    }
    this.turnIceServer = null;
    this.turnCredentialSource = null;
    this.turnCredentialExpiresAt = null;
    this.emitState();
  }

  async requestPeerSignal(remote, envelope) {
    if (!this.running) await this.start();
    const context = this.identity();
    const targetDeviceId = requiredIdentifier(remote?.deviceId, 'targetDeviceId');
    const advertisedUrls = normalizeServiceUrls(remote?.signalUrls || [], {
      allowInsecure: this.allowInsecure
    });
    const urls = advertisedUrls.length
      ? this.serviceUrls.filter((url) => advertisedUrls.includes(url))
      : [...this.serviceUrls];
    if (!urls.length) throw new Error('peer-signaling-service-unavailable');
    const correlationId = requiredIdentifier(envelope?.connectionId, 'correlationId');
    const pending = deferred(SIGNAL_TIMEOUT_MS, 'peer-signaling-answer-timeout');
    const existing = this.pendingSignals.get(correlationId);
    if (existing) throw new Error('peer-signaling-request-duplicate');
    this.pendingSignals.set(correlationId, pending);
    const request = createSignalingRequest('signal.send', {
      deviceId: context.local.deviceId,
      devicePublicKey: context.local.devicePublicKey,
      targetDeviceId,
      kind: 'peer.offer',
      correlationId,
      payload: envelope
    }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 45_000 });
    let acceptedUrl = null;
    const failures = [];
    for (const url of urls) {
      try {
        await this.post(url, '/v1/signal/send', request, REQUEST_TIMEOUT_MS);
        acceptedUrl = url;
        break;
      } catch (error) {
        failures.push(safeError(error));
      }
    }
    if (!acceptedUrl) {
      this.pendingSignals.delete(correlationId);
      pending.reject(new Error(failures[0] || 'peer-signaling-unreachable'));
      throw new Error(failures[0] || 'peer-signaling-unreachable');
    }
    try {
      return {
        responseEnvelope: await pending.promise,
        path: 'signaling',
        service: publicServiceName(acceptedUrl)
      };
    } finally {
      this.pendingSignals.delete(correlationId);
    }
  }

  iceServers() {
    if (!this.turnIceServer || Date.parse(this.turnCredentialExpiresAt) <= this.nowMs() + 30_000) return [];
    return [{
      urls: [...this.turnIceServer.urls],
      username: this.turnIceServer.username,
      credential: this.turnIceServer.credential
    }];
  }

  publicStatus() {
    const serviceStates = [...this.services.values()];
    const online = serviceStates.filter((item) => item.state === 'online');
    const configured = this.serviceUrls.length > 0;
    let state = 'disabled';
    if (configured && this.running && online.length === serviceStates.length) state = 'online';
    else if (configured && this.running && online.length) state = 'degraded';
    else if (configured && this.running && serviceStates.some((item) => item.state === 'connecting')) state = 'connecting';
    else if (configured) state = 'offline';
    const turnAvailable = this.iceServers().length > 0;
    return {
      configured,
      state,
      serviceCount: serviceStates.length,
      onlineServiceCount: online.length,
      services: serviceStates.map((item) => ({
        service: publicServiceName(item.url),
        state: item.state,
        leaseExpiresAt: item.leaseExpiresAt,
        lastConnectedAt: item.lastConnectedAt,
        lastError: item.lastError
      })),
      lastError: this.latestError(),
      turnCredentials: turnAvailable ? 'available' : 'unavailable',
      turnCredentialSource: turnAvailable ? this.turnCredentialSource : null,
      turnCredentialExpiresAt: turnAvailable ? this.turnCredentialExpiresAt : null
    };
  }

  async serviceLoop(url) {
    const service = this.services.get(url);
    let retryMs = 500;
    while (this.running) {
      try {
        const expiresAt = Date.parse(service.leaseExpiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= this.nowMs() + 20_000) await this.lease(url);
        const context = this.identity();
        const request = createSignalingRequest('poll', {
          deviceId: context.local.deviceId,
          devicePublicKey: context.local.devicePublicKey
        }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 40_000 });
        const result = await this.post(url, '/v1/poll', request, 28_000);
        const messages = Array.isArray(result.messages) ? result.messages.slice(0, 8) : [];
        for (const message of messages) await this.handleMessage(url, message);
        retryMs = 500;
      } catch (error) {
        if (!this.running || error?.name === 'AbortError') break;
        this.markFailure(url, error);
        await delay(retryMs);
        retryMs = Math.min(retryMs * 2, 5_000);
      }
    }
  }

  async lease(url) {
    const service = this.services.get(url);
    if (!service) throw new Error('signaling-service-unknown');
    service.state = 'connecting';
    this.emitState();
    const context = this.identity();
    const request = createSignalingRequest('lease', {
      deviceId: context.local.deviceId,
      devicePublicKey: context.local.devicePublicKey
    }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 30_000 });
    const result = await this.post(url, '/v1/lease', request, REQUEST_TIMEOUT_MS);
    const expiresAt = Date.parse(result.lease?.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.nowMs()) throw new Error('signaling-lease-invalid');
    service.state = 'online';
    service.leaseExpiresAt = new Date(expiresAt).toISOString();
    service.lastConnectedAt = this.nowIso();
    service.lastError = null;
    this.emitState();
    if (result.lease?.turnCredentials === true && this.turnNeedsRefresh()) {
      try {
        await this.refreshTurnCredentials(url);
      } catch (error) {
        service.lastError = safeError(error);
        this.emitState();
      }
    }
    return result.lease;
  }

  async refreshTurnCredentials(url) {
    const context = this.identity();
    const request = createSignalingRequest('turn.credentials', {
      deviceId: context.local.deviceId,
      devicePublicKey: context.local.devicePublicKey
    }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 30_000 });
    const result = await this.post(url, '/v1/turn-credentials', request, REQUEST_TIMEOUT_MS);
    const iceServer = result.iceServer;
    const urls = (Array.isArray(iceServer?.urls) ? iceServer.urls : [iceServer?.urls])
      .map((value) => String(value || '').trim())
      .filter((value) => /^(turn|turns):/i.test(value))
      .slice(0, 8);
    const expiresAt = Date.parse(iceServer?.expiresAt);
    if (!urls.length || !iceServer?.username || !iceServer?.credential || expiresAt <= this.nowMs()) {
      throw new Error('turn-credentials-invalid');
    }
    this.turnIceServer = {
      urls,
      username: String(iceServer.username).slice(0, 256),
      credential: String(iceServer.credential).slice(0, 512)
    };
    this.turnCredentialSource = 'signaling';
    this.turnCredentialExpiresAt = new Date(expiresAt).toISOString();
    this.emitState();
  }

  async handleMessage(serviceUrl, message) {
    if (!message || Date.parse(message.expiresAt) <= this.nowMs()) return;
    const context = this.identity();
    if (message.targetDeviceId !== context.local.deviceId) return;
    if (message.kind === 'peer.answer') {
      const pending = this.pendingSignals.get(String(message.correlationId || ''));
      if (pending) pending.resolve(message.payload);
      return;
    }
    if (message.kind === 'peer.offer') {
      if (typeof this.onPeerSignal !== 'function') return;
      const answer = await this.onPeerSignal(message.payload);
      await this.sendAnswer([serviceUrl], message, answer);
      return;
    }
    if (message.kind === 'pair.claim') await this.respondPairClaim(serviceUrl, message);
  }

  async sendAnswer(urls, message, answerEnvelope) {
    const context = this.identity();
    const request = createSignalingRequest('signal.send', {
      deviceId: context.local.deviceId,
      devicePublicKey: context.local.devicePublicKey,
      targetDeviceId: requiredIdentifier(message.sourceDeviceId, 'targetDeviceId'),
      kind: 'peer.answer',
      correlationId: requiredIdentifier(message.correlationId, 'correlationId'),
      payload: answerEnvelope
    }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 45_000 });
    await postFirst(this, urls, '/v1/signal/send', request, REQUEST_TIMEOUT_MS, 'peer-signaling-answer-unreachable');
  }

  async respondPairClaim(serviceUrl, message) {
    const context = this.identity();
    let response = null;
    let errorCode = null;
    try {
      if (typeof this.onPairClaim !== 'function') throw new Error('pairing-unavailable');
      const result = await this.onPairClaim({ request: message.payload });
      response = result?.response || result;
      if (!response || typeof response !== 'object') throw new Error('pairing-response-invalid');
    } catch (error) {
      errorCode = safeError(error);
    }
    const request = createSignalingRequest('pair.respond', {
      deviceId: context.local.deviceId,
      devicePublicKey: context.local.devicePublicKey,
      pairRequestId: requiredIdentifier(message.correlationId, 'pairRequestId'),
      targetDeviceId: requiredIdentifier(message.sourceDeviceId, 'targetDeviceId'),
      ...(errorCode ? { errorCode } : { response })
    }, context.secrets.devicePrivateKey, { now: this.nowIso(), ttlMs: 30_000 });
    await this.post(serviceUrl, '/v1/pair/respond', request, REQUEST_TIMEOUT_MS);
  }

  async post(base, requestPath, body, timeoutMs) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const encoded = JSON.stringify(body);
      if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('signaling-request-too-large');
      const response = await this.fetch(`${base}${requestPath}`, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: encoded,
        signal: controller.signal
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('signaling-response-too-large');
      let payload;
      try { payload = JSON.parse(text); } catch (_error) { throw new Error('signaling-response-invalid'); }
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.reasonCode || `signaling-http-${response.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  identity() {
    if (typeof this.identityProvider !== 'function') throw new Error('signaling-identity-unavailable');
    const context = this.identityProvider();
    if (!context?.local?.deviceId || !context?.local?.devicePublicKey || !context?.secrets?.devicePrivateKey) {
      throw new Error('signaling-identity-incomplete');
    }
    return context;
  }

  turnNeedsRefresh() {
    return !this.turnIceServer || Date.parse(this.turnCredentialExpiresAt) <= this.nowMs() + 5 * 60_000;
  }

  markFailure(url, error) {
    const service = this.services.get(url);
    if (!service) return;
    service.state = 'offline';
    service.lastError = safeError(error);
    this.emitState();
  }

  latestError() {
    return [...this.services.values()].map((item) => item.lastError).find(Boolean) || null;
  }

  emitState() {
    try { this.onState(this.publicStatus()); } catch (_error) { /* diagnostics must not break signaling */ }
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  nowIso() {
    return new Date(this.nowMs()).toISOString();
  }
}

async function claimPairingViaSignaling(invite, joinRequest, identity, options = {}) {
  const urls = normalizeServiceUrls(invite?.signalUrls, { allowInsecure: options.allowInsecure === true });
  if (!urls.length) throw new Error('pairing-signaling-unavailable');
  if (!identity?.devicePrivateKey) throw new Error('pairing-device-key-unavailable');
  const now = options.now || (() => new Date().toISOString());
  const request = createSignalingRequest('pair.claim', {
    deviceId: requiredIdentifier(joinRequest?.deviceId, 'deviceId'),
    devicePublicKey: String(joinRequest?.devicePublicKey || '').trim(),
    targetDeviceId: requiredIdentifier(invite?.sourceDeviceId, 'targetDeviceId'),
    inviteId: requiredIdentifier(invite?.inviteId, 'inviteId'),
    payload: joinRequest
  }, identity.devicePrivateKey, { now: now(), ttlMs: 45_000 });
  const client = {
    post: (base, requestPath, body, timeoutMs) => postJson(
      options.fetch || globalThis.fetch,
      base,
      requestPath,
      body,
      timeoutMs
    )
  };
  const payload = await postFirst(client, urls, '/v1/pair/claim', request, SIGNAL_TIMEOUT_MS, 'pairing-signaling-unreachable');
  if (!payload.response || typeof payload.response !== 'object') throw new Error('pairing-response-invalid');
  return payload.response;
}

async function postJson(fetchImpl, base, requestPath, body, timeoutMs) {
  if (typeof fetchImpl !== 'function') throw new Error('signaling-fetch-unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) throw new Error('signaling-request-too-large');
    const response = await fetchImpl(`${base}${requestPath}`, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: encoded,
      signal: controller.signal
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('signaling-response-too-large');
    let payload;
    try { payload = JSON.parse(text); } catch (_error) { throw new Error('signaling-response-invalid'); }
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.reasonCode || `signaling-http-${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function postFirst(client, urls, requestPath, body, timeoutMs, failureCode) {
  const failures = [];
  for (const url of urls) {
    try {
      return await client.post(url, requestPath, body, timeoutMs);
    } catch (error) {
      failures.push(safeError(error));
    }
  }
  throw new Error(failures[0] || failureCode);
}

function serviceState(url) {
  return {
    url,
    state: 'stopped',
    leaseExpiresAt: null,
    lastConnectedAt: null,
    lastError: null
  };
}

function publicServiceName(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) return 'ip-address';
    return url.host;
  } catch (_error) {
    return 'invalid';
  }
}

function requiredIdentifier(value, field) {
  const text = String(value || '').trim();
  if (!text || text.length > 160 || !/^[a-z0-9._:-]+$/i.test(text)) {
    throw new TypeError(`${field} is invalid`);
  }
  return text;
}

function deferred(timeoutMs, timeoutCode) {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((res, rej) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res(value);
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(error instanceof Error ? error : new Error(String(error)));
    };
  });
  const timer = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error?.message || error || 'signaling-failed')
    .trim()
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 160) || 'signaling-failed';
}

module.exports = {
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  SIGNAL_TIMEOUT_MS,
  SignalingClient,
  claimPairingViaSignaling,
  postJson,
  publicServiceName
};
