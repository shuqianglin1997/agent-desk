/*
 * AgentDesk — cross-account quota overview aggregation.
 *
 * A pure, side-effect-free reducer over the already-normalized per-profile
 * quota snapshots the renderer keeps in state.quotas. It issues no provider
 * requests and copies only a credential-free subset of each snapshot, so the
 * overview can never leak account e-mail or tokens. "Tightest window" reuses
 * YardEnergy.constrainingWindow so the overview and the yard energy axis agree
 * on which window is the binding one.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./yard/energy'));
  } else {
    root.QuotaOverview = factory(root.YardEnergy);
  }
})(typeof self !== 'undefined' ? self : this, function (energy) {
  const constrainingWindow = energy && energy.constrainingWindow;
  const DEFAULT_MAX_AGE_MS = Number(energy && energy.DEFAULT_MAX_AGE_MS) || 15 * 60_000;
  const TRUSTED_SOURCES = {
    codex: new Set(['codex-app-server'])
  };

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function tightestWindow(snapshot, now) {
    if (typeof constrainingWindow !== 'function') return null;
    if (!snapshot || snapshot.status !== 'ok') return null;
    const window_ = constrainingWindow(snapshot, now);
    if (!window_ || !Number.isFinite(window_.remainingPercent)) return null;
    return {
      label: window_.label || '额度周期',
      remainingPercent: window_.remainingPercent,
      usedPercent: Number.isFinite(window_.usedPercent) ? window_.usedPercent : null,
      windowMinutes: Number.isFinite(window_.windowMinutes) ? window_.windowMinutes : null,
      resetsAt: window_.resetsAt || null
    };
  }

  function overviewRow(profile, snapshot, now) {
    const tightest = tightestWindow(snapshot, now);
    const status = snapshot && typeof snapshot.status === 'string' ? snapshot.status : 'loading';
    return {
      profileId: String(profile.id),
      name: profile.name || String(profile.id),
      appId: profile.appId || null,
      provider: snapshot && snapshot.provider ? String(snapshot.provider) : (profile.appId || null),
      status,
      planType: snapshot && snapshot.planType ? String(snapshot.planType) : null,
      tightest,
      hasQuota: status === 'ok' && tightest !== null,
      reason: snapshot && snapshot.reason ? String(snapshot.reason) : null
    };
  }

  function buildQuotaOverview(profiles, quotasById, now = Date.now()) {
    const list = Array.isArray(profiles) ? profiles : [];
    const quotas = isPlainObject(quotasById) ? quotasById : {};

    const rows = list
      .filter((profile) => profile && profile.id !== undefined && profile.id !== null)
      .map((profile, index) => ({
        row: overviewRow(profile, quotas[String(profile.id)] || quotas[profile.id] || null, now),
        index
      }));

    rows.sort((a, b) => {
      if (a.row.hasQuota !== b.row.hasQuota) return a.row.hasQuota ? -1 : 1;
      if (a.row.hasQuota && b.row.hasQuota) {
        const diff = a.row.tightest.remainingPercent - b.row.tightest.remainingPercent;
        if (diff !== 0) return diff;
      }
      return a.index - b.index;
    });

    return rows.map((entry) => entry.row);
  }

  function activeCardWindows(snapshot, now) {
    return (Array.isArray(snapshot?.windows) ? snapshot.windows : []).filter((window_) => {
      if (!window_ || !Number.isFinite(window_.remainingPercent)) return false;
      const resetsAt = Date.parse(window_.resetsAt);
      return Number.isFinite(resetsAt) && resetsAt > now;
    });
  }

  function quotaProviderForMember(member) {
    return String(member?._providerNamespace || member?.appId || '').trim().toLowerCase();
  }

  function quotaWindowIdentity(window_) {
    return [
      window_.limitId || '',
      window_.kind || '',
      Number.isFinite(window_.windowMinutes) ? window_.windowMinutes : '',
      window_.label || '',
      window_.resetsAt || ''
    ].join('\u0000');
  }

  function quotaWindowsConflict(left, right) {
    if (String(left.snapshot.provider || '') !== String(right.snapshot.provider || '')) return true;
    if (String(left.snapshot.planType || '') !== String(right.snapshot.planType || '')) return true;
    if (String(left.snapshot.rateLimitReachedType || '') !== String(right.snapshot.rateLimitReachedType || '')) return true;
    const leftWindows = [...left.windows].sort((a, b) => quotaWindowIdentity(a).localeCompare(quotaWindowIdentity(b)));
    const rightWindows = [...right.windows].sort((a, b) => quotaWindowIdentity(a).localeCompare(quotaWindowIdentity(b)));
    if (leftWindows.length !== rightWindows.length) return true;
    return leftWindows.some((window_, index) => {
      const candidate = rightWindows[index];
      if (quotaWindowIdentity(window_) !== quotaWindowIdentity(candidate)) return true;
      if (Math.abs(window_.remainingPercent - candidate.remainingPercent) > 1) return true;
      const leftUsed = Number.isFinite(window_.usedPercent) ? window_.usedPercent : null;
      const rightUsed = Number.isFinite(candidate.usedPercent) ? candidate.usedPercent : null;
      return leftUsed !== null && rightUsed !== null && Math.abs(leftUsed - rightUsed) > 1;
    });
  }

  function selectTrustedAccountQuota(group, quotasById, now = Date.now(), options = {}) {
    if (options.quotaError) return { status: 'unknown', reason: 'refresh-error' };
    const quotas = isPlainObject(quotasById) ? quotasById : {};
    const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
    const conflictWindowMs = Number.isFinite(options.conflictWindowMs) ? options.conflictWindowMs : 2 * 60_000;
    const candidates = (Array.isArray(group?.members) ? group.members : [])
      .filter((member) => member && member._remote !== true)
      .map((member) => {
        const snapshot = quotas[member.id];
        if (!snapshot || snapshot.status !== 'ok') return null;
        const provider = quotaProviderForMember(member);
        if (!provider || String(snapshot.provider || '').toLowerCase() !== provider) return null;
        if (!TRUSTED_SOURCES[provider]?.has(String(snapshot.source || ''))) return null;
        const observedAt = Date.parse(snapshot.observedAt);
        const ageMs = now - observedAt;
        if (!Number.isFinite(observedAt) || ageMs < 0 || ageMs > maxAgeMs) return null;
        const windows = activeCardWindows(snapshot, now);
        if (!windows.length) return null;
        const tightest = tightestWindow({ ...snapshot, windows }, now);
        if (!tightest) return null;
        return {
          member,
          snapshot,
          windows,
          tightest,
          observedAt,
          bindingKey: member._accountBindingId || `local:${group?.key || member.id}`
        };
      })
      .filter(Boolean);

    const byBinding = new Map();
    for (const candidate of candidates) {
      if (!byBinding.has(candidate.bindingKey)) byBinding.set(candidate.bindingKey, []);
      byBinding.get(candidate.bindingKey).push(candidate);
    }

    const resolved = [];
    for (const [bindingKey, rows] of byBinding) {
      rows.sort((left, right) => (
        right.observedAt - left.observedAt
        || String(left.member.id).localeCompare(String(right.member.id))
      ));
      const latest = rows[0];
      const conflict = rows.slice(1).some((candidate) => (
        Math.abs(latest.observedAt - candidate.observedAt) <= conflictWindowMs
        && quotaWindowsConflict(latest, candidate)
      ));
      if (conflict) return { status: 'conflict', reason: 'source-conflict', bindingKey };
      resolved.push(latest);
    }

    resolved.sort((left, right) => (
      left.tightest.remainingPercent - right.tightest.remainingPercent
      || right.observedAt - left.observedAt
      || String(left.member.id).localeCompare(String(right.member.id))
    ));
    return resolved[0] ? { status: 'ok', ...resolved[0] } : { status: 'unknown', reason: 'no-trusted-snapshot' };
  }

  return { buildQuotaOverview, tightestWindow, selectTrustedAccountQuota };
});
