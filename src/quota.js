/*
 * AgentDesk — provider quota normalization.
 *
 * Provider responses stay in the main process. The renderer only receives this
 * small, credential-free shape; account e-mail, OAuth tokens and raw payloads
 * are deliberately never copied into it.
 */

const VALID_STATUSES = new Set(['ok', 'unsupported', 'signed_out', 'stale', 'error']);

function finiteNumber(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.min(100, Math.max(0, number));
}

function timestampToIso(value) {
  if (value === null || value === undefined || value === '') return null;
  let milliseconds = finiteNumber(value);
  if (milliseconds !== null) {
    // Codex app-server uses Unix seconds. Accept milliseconds as well so the
    // normalized contract remains tolerant of future provider adapters.
    if (Math.abs(milliseconds) < 1e12) milliseconds *= 1000;
  } else {
    milliseconds = Date.parse(value);
  }
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function durationLabel(minutes) {
  const value = finiteNumber(minutes);
  if (value === null || value <= 0) return '额度周期';
  const rounded = Math.round(value);
  if (rounded === 7 * 24 * 60) return '每周';
  if (rounded === 24 * 60) return '每天';
  if (rounded % (24 * 60) === 0) return `${rounded / (24 * 60)} 天`;
  if (rounded % 60 === 0) return `${rounded / 60} 小时`;
  return `${rounded} 分钟`;
}

function normalizeCredits(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    hasCredits: value.hasCredits === true,
    unlimited: value.unlimited === true,
    balance: value.balance === null || value.balance === undefined
      ? null
      : String(value.balance)
  };
}

function normalizeWindow(value, meta = {}) {
  if (!value || typeof value !== 'object') return null;
  const usedPercent = clampPercent(value.usedPercent ?? value.used_percent);
  if (usedPercent === null) return null;

  const windowMinutesValue = finiteNumber(value.windowDurationMins ?? value.window_minutes);
  const windowMinutes = windowMinutesValue !== null && windowMinutesValue > 0
    ? Math.round(windowMinutesValue)
    : null;
  const limitId = meta.limitId || null;
  const kind = meta.kind || 'window';

  return {
    id: [limitId || 'default', kind, windowMinutes || 'unknown'].join(':'),
    label: durationLabel(windowMinutes),
    scope: meta.limitName || limitId || 'Codex',
    limitId,
    kind,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowMinutes,
    resetsAt: timestampToIso(value.resetsAt ?? value.resets_at)
  };
}

function rateLimitBuckets(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const byId = input.rateLimitsByLimitId ?? input.rate_limits_by_limit_id;
  if (byId && typeof byId === 'object' && !Array.isArray(byId)) {
    const entries = Object.entries(byId).filter(([, value]) => value && typeof value === 'object');
    if (entries.length) return entries.map(([limitId, value]) => ({ limitId, value }));
  }

  const legacy = input.rateLimits ?? input.rate_limits ?? input;
  if (!legacy || typeof legacy !== 'object') return [];
  return [{ limitId: legacy.limitId ?? legacy.limit_id ?? null, value: legacy }];
}

function normalizeCodexRateLimits(payload, options = {}) {
  const buckets = rateLimitBuckets(payload);
  const windows = [];
  let planType = null;
  let credits = null;
  let rateLimitReachedType = null;

  for (const bucket of buckets) {
    const value = bucket.value;
    const limitId = value.limitId ?? value.limit_id ?? bucket.limitId ?? null;
    const limitName = value.limitName ?? value.limit_name ?? null;
    planType ||= value.planType ?? value.plan_type ?? null;
    credits ||= normalizeCredits(value.credits);
    rateLimitReachedType ||= value.rateLimitReachedType ?? value.rate_limit_reached_type ?? null;

    for (const kind of ['primary', 'secondary']) {
      const normalized = normalizeWindow(value[kind], { limitId, limitName, kind });
      if (normalized) windows.push(normalized);
    }
  }

  // A server can expose the same logical window in more than one compatibility
  // bucket. Keep the first occurrence and avoid a misleading duplicate meter.
  const uniqueWindows = windows.filter((item, index, all) => (
    all.findIndex((candidate) => (
      candidate.limitId === item.limitId &&
      candidate.kind === item.kind &&
      candidate.windowMinutes === item.windowMinutes &&
      candidate.resetsAt === item.resetsAt
    )) === index
  ));

  const status = VALID_STATUSES.has(options.status) ? options.status : 'ok';
  return {
    profileId: options.profileId === undefined ? null : String(options.profileId),
    provider: 'codex',
    status,
    planType: planType ? String(planType) : null,
    windows: uniqueWindows,
    credits,
    rateLimitReachedType: rateLimitReachedType ? String(rateLimitReachedType) : null,
    source: options.source || 'codex-app-server',
    observedAt: timestampToIso(options.observedAt ?? Date.now())
  };
}

function quotaUnavailable(profileId, provider, status = 'unsupported', reason = null, observedAt = Date.now()) {
  return {
    profileId: profileId === undefined ? null : String(profileId),
    provider: String(provider || 'unknown'),
    status: VALID_STATUSES.has(status) ? status : 'error',
    planType: null,
    windows: [],
    credits: null,
    rateLimitReachedType: null,
    source: 'agentdesk',
    observedAt: timestampToIso(observedAt),
    reason: reason ? String(reason) : null
  };
}

module.exports = {
  VALID_STATUSES,
  clampPercent,
  timestampToIso,
  durationLabel,
  normalizeWindow,
  normalizeCodexRateLimits,
  quotaUnavailable
};
