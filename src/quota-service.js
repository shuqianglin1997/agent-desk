/*
 * AgentDesk — quota orchestration and cache.
 *
 * Quota polling is deliberately separate from the 8-second activity probe:
 * provider requests are cached for five minutes, deduplicated per profile and
 * limited to two concurrent Codex processes.
 */

const apps = require('./apps');
const { quotaUnavailable, quotaReasonFields, isReasonKey } = require('./quota');

const SUCCESS_TTL_MS = 5 * 60_000;
const STALE_TTL_MS = 60_000;
const ERROR_TTL_MS = 30_000;
const UNSUPPORTED_TTL_MS = 10 * 60_000;

function profileCacheKey(profile) {
  return [profile.id, profile.appId, profile.sessionRoot || ''].join('\u0000');
}

function ttlForSnapshot(snapshot) {
  if (snapshot?.status === 'ok') return SUCCESS_TTL_MS;
  if (snapshot?.status === 'stale') return STALE_TTL_MS;
  if (snapshot?.status === 'unsupported') return UNSUPPORTED_TTL_MS;
  return ERROR_TTL_MS;
}

// What the client's adapter says about quota (`quota`): a reader, or the reason
// it has none. Clients without either are simply not supported yet.
function quotaOf(profile) {
  return apps.isKnownApp(profile?.appId) ? apps.getApp(profile.appId).quota || null : null;
}

function unsupportedQuota(profile) {
  return quotaUnavailable(profile.id, profile.appId, 'unsupported', quotaOf(profile)?.unsupportedReason || 'quota.reason.unsupported');
}

async function fetchProfileQuota(profile, options = {}) {
  const quota = quotaOf(profile);
  if (typeof quota?.read !== 'function') return unsupportedQuota(profile);
  try {
    return await (options.readQuota || quota.read)(profile, options);
  } catch (error) {
    let cached = null;
    try {
      cached = (options.readCachedQuota || quota.readCached)?.(profile) || null;
    } catch (_cacheError) {
      // A damaged/unreadable rollout must not make the whole IPC request fail.
    }
    const reason = quota.failureReason(error);
    if (cached) {
      const keys = [reason, ...(Array.isArray(cached.reasonKeys) ? cached.reasonKeys : [])];
      if (isReasonKey(reason) && keys.every(isReasonKey)) return { ...cached, ...quotaReasonFields(...keys) };
      return { ...cached, reason: `${reason}；${cached.reason}` };
    }
    return quotaUnavailable(profile.id, profile.appId, 'error', reason);
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

class QuotaService {
  constructor(options = {}) {
    this.fetchQuota = options.fetchQuota || fetchProfileQuota;
    this.now = options.now || Date.now;
    this.maxConcurrency = options.maxConcurrency || 2;
    this.fetchOptions = options.fetchOptions || {};
    this.cache = new Map();
    this.inFlight = new Map();
  }

  invalidate(profileId = null) {
    if (profileId === null || profileId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(String(profileId));
  }

  // The last cached snapshot, without starting a request (调度中枢 roster).
  peek(profile) {
    const cached = this.cache.get(String(profile.id));
    return cached?.key === profileCacheKey(profile) ? cached.value : null;
  }

  async get(profile, options = {}) {
    const id = String(profile.id);
    const key = profileCacheKey(profile);
    const cached = this.cache.get(id);
    if (
      options.force !== true &&
      cached?.key === key &&
      this.now() - cached.at < ttlForSnapshot(cached.value)
    ) {
      return cached.value;
    }

    const running = this.inFlight.get(id);
    const forced = options.force === true;
    // An ordinary request joins whatever is running. A forced one ("refresh
    // now") joins only another forced one; otherwise it waits for the running
    // request and then fetches again, so the answer is never older than the click.
    if (running?.key === key && (!forced || running.forced)) return running.promise;
    const after = running?.key === key ? running.promise.catch(() => {}) : Promise.resolve();

    const promise = after
      .then(() => this.fetchQuota(profile, { ...this.fetchOptions, ...options }))
      .then((value) => {
        this.cache.set(id, { key, at: this.now(), value });
        return value;
      })
      .finally(() => {
        const current = this.inFlight.get(id);
        if (current?.promise === promise) this.inFlight.delete(id);
      });
    this.inFlight.set(id, { key, promise, forced });
    return promise;
  }

  async getAll(profiles, options = {}) {
    const list = Array.isArray(profiles) ? profiles : [];
    const liveIds = new Set(list.map((profile) => String(profile.id)));
    for (const id of this.cache.keys()) {
      if (!liveIds.has(id)) this.cache.delete(id);
    }
    return mapWithConcurrency(list, this.maxConcurrency, (profile) => this.get(profile, options));
  }
}

module.exports = {
  SUCCESS_TTL_MS,
  STALE_TTL_MS,
  ERROR_TTL_MS,
  UNSUPPORTED_TTL_MS,
  profileCacheKey,
  ttlForSnapshot,
  unsupportedQuota,
  fetchProfileQuota,
  mapWithConcurrency,
  QuotaService
};
