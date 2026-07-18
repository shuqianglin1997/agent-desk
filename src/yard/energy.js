/*
 * AgentDesk — quota energy axis for yard cats.
 *
 * Activity (working / resting / sleeping) remains owned by cats.js. Energy is
 * intentionally orthogonal, so a cat may be working while also looking tired.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YardEnergy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MINUTE = 60e3;
  const DEFAULT_MAX_AGE_MS = 15 * MINUTE;

  const ENERGY_META = {
    fresh: { label: '元气满满', hint: '最紧额度窗口仍剩 60% 以上' },
    steady: { label: '状态稳定', hint: '最紧额度窗口剩余 30%〜60%' },
    tired: { label: '有点累', hint: '最紧额度窗口只剩 10%〜30%' },
    exhausted: { label: '快没电', hint: '最紧额度窗口不足 10%' },
    unknown: { label: '额度未知', hint: '尚无可信的新鲜额度数据' }
  };

  function validTime(value) {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  function activeWindows(snapshot, now) {
    const windows = snapshot && Array.isArray(snapshot.windows) ? snapshot.windows : [];
    return windows.filter((window_) => {
      if (!window_ || !Number.isFinite(window_.remainingPercent)) return false;
      const resetAt = validTime(window_.resetsAt);
      // A snapshot from before the reset boundary must not make a cat look
      // exhausted after the provider has already started a fresh window.
      return resetAt === null || resetAt > now;
    });
  }

  function constrainingWindow(snapshot, now = Date.now()) {
    const candidates = activeWindows(snapshot, now);
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => (
      a.remainingPercent - b.remainingPercent ||
      (a.windowMinutes || Infinity) - (b.windowMinutes || Infinity)
    ))[0];
  }

  function deriveEnergy(snapshot, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS) {
    if (!snapshot || snapshot.status !== 'ok') return 'unknown';
    const observedAt = validTime(snapshot.observedAt);
    if (observedAt === null || now - observedAt < 0 || now - observedAt > maxAgeMs) return 'unknown';
    if (snapshot.rateLimitReachedType) return 'exhausted';

    const window_ = constrainingWindow(snapshot, now);
    if (!window_) return 'unknown';
    const remaining = window_.remainingPercent;
    if (remaining < 10) return 'exhausted';
    if (remaining < 30) return 'tired';
    if (remaining < 60) return 'steady';
    return 'fresh';
  }

  return { ENERGY_META, DEFAULT_MAX_AGE_MS, activeWindows, constrainingWindow, deriveEnergy };
});
