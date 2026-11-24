/*
 * AgentDesk — the time windows that decide what counts as "now".
 *
 * Defined once here; Main (activity probe) and the renderer (cat state, card
 * count, quota energy and overview) read the same values. UMD: window global
 * AgentDeskTimeWindows in the renderer, require() in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgentDeskTimeWindows = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  return Object.freeze({
    // A session with new content this recently is running: the cat works and
    // the name tag counts it as "N 条在跑".
    RUNNING_WINDOW_MS: 90 * SECOND,
    // A session file touched this recently counts as active now (activeNow).
    ACTIVE_NOW_MS: 5 * MINUTE,
    // A quota snapshot older than this is not trusted for energy or overview.
    QUOTA_FRESH_MS: 15 * MINUTE
  });
});
