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

  return { buildQuotaOverview, tightestWindow };
});
