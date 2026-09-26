/* AgentDesk — bounded, persistent cat placement. No account or session actions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YardInteractions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WIDTH = 480;
  const HEIGHT = 236; // 与 scene.js 的逻辑画布同步（前景草坪带）

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizePoint(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return {
      x: Math.round(clamp(value.x, 10, WIDTH - 10) * 10) / 10,
      y: Math.round(clamp(value.y, 68, HEIGHT - 6) * 10) / 10
    };
  }


  function normalizePositions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output = {};
    for (const [profileId, item] of Object.entries(value).slice(0, 200)) {
      const point = normalizePoint(item);
      if (!point) continue;
      output[String(profileId)] = {
        ...point,
        zoneId: typeof item.zoneId === 'string' ? item.zoneId.slice(0, 40) : 'ground',
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0
      };
    }
    return output;
  }


  return {
    WIDTH,
    HEIGHT,
    normalizePoint,
    normalizePositions
  };
});
