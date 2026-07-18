/*
 * AgentDesk — quota orchestration and cache.
 *
 * Quota polling is deliberately separate from the 8-second activity probe:
 * provider requests are cached for five minutes, deduplicated per profile and
 * limited to two concurrent Codex processes.
 */

const { readCodexQuota, readCachedCodexQuota } = require('./codex-quota');
const { quotaUnavailable } = require('./quota');

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

function unsupportedQuota(profile) {
  if (profile.appId === 'claude') {
    return quotaUnavailable(
      profile.id,
      'claude',
      'unsupported',
      'Claude 个人订阅暂无公开额度 API；为保护账号，AgentDesk 不读取浏览器 Cookie'
    );
  }
  if (profile.appId === 'cursor') {
    return quotaUnavailable(
      profile.id,
      'cursor',
      'unsupported',
      'Cursor 个人账号暂无公开额度 API；团队版后续可接入 Admin API'
    );
  }
  return quotaUnavailable(profile.id, profile.appId, 'unsupported', '这个客户端暂不支持额度查询');
}

function friendlyCodexFailure(error) {
  if (error?.code === 'CODEX_CLI_NOT_FOUND') {
    return '未找到 Codex CLI；安装或更新 Codex CLI 后即可读取实时额度';
  }
  if (error?.code === 'CODEX_RPC_UNSUPPORTED') {
    return '当前 Codex CLI 版本不支持额度协议，请先更新 Codex';
  }
  if (error?.code === 'CODEX_RPC_TIMEOUT') {
    return 'Codex 额度服务响应超时，请稍后刷新';
  }
  if (error?.code === 'CODEX_RATE_LIMITS_FAILED') {
    return '无法连接 Codex 额度服务，请检查网络或稍后刷新';
  }
  return '暂时无法读取 Codex 实时额度';
}

async function fetchProfileQuota(profile, options = {}) {
  if (profile.appId !== 'codex') return unsupportedQuota(profile);
  try {
    return await (options.readCodexQuota || readCodexQuota)(profile, options);
  } catch (error) {
    let cached = null;
    try {
      cached = (options.readCachedCodexQuota || readCachedCodexQuota)(profile);
    } catch (_cacheError) {
      // A damaged/unreadable rollout must not make the whole IPC request fail.
    }
    if (cached) return { ...cached, reason: `${friendlyCodexFailure(error)}；${cached.reason}` };
    return quotaUnavailable(profile.id, 'codex', 'error', friendlyCodexFailure(error));
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
    if (running?.key === key) return running.promise;

    const promise = Promise.resolve()
      .then(() => this.fetchQuota(profile, { ...this.fetchOptions, ...options }))
      .then((value) => {
        this.cache.set(id, { key, at: this.now(), value });
        return value;
      })
      .finally(() => {
        const current = this.inFlight.get(id);
        if (current?.promise === promise) this.inFlight.delete(id);
      });
    this.inFlight.set(id, { key, promise });
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
  friendlyCodexFailure,
  fetchProfileQuota,
  mapWithConcurrency,
  QuotaService
};
