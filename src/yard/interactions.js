/*
 * AgentDesk — semantic yard zones and drag/drop intent resolution.
 *
 * Rectangles are interaction hit areas, not artwork. They are only revealed
 * while dragging a cat. A drop produces an intent; the renderer decides
 * whether to execute, confirm, or explain it. This keeps animation completion
 * from accidentally launching/stopping an app or approving a request.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YardInteractions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WIDTH = 480;
  const HEIGHT = 236; // 与 scene.js 的逻辑画布同步（前景草坪带）
  const ZONES = Object.freeze([
    Object.freeze({ id: 'workshop', label: '工作亭', hint: '打开账号', x0: 10, y0: 16, x1: 108, y1: 78, priority: 6 }),
    Object.freeze({ id: 'mailbox', label: '邮筒', hint: '复制交接', x0: 104, y0: 40, x1: 132, y1: 76, priority: 8 }),
    Object.freeze({ id: 'queue', label: '任务道', hint: '任务排队', x0: 50, y0: 78, x1: 194, y1: 111, priority: 3 }),
    Object.freeze({ id: 'attention', label: '池塘', hint: '查看会话', x0: 190, y0: 87, x1: 290, y1: 130, priority: 7 }),
    Object.freeze({ id: 'remote', label: '瞭望点', hint: '打开终端', x0: 354, y0: 34, x1: 470, y1: 91, priority: 5 }),
    Object.freeze({ id: 'meadow', label: '树下草坪', hint: '保存位置', x0: 288, y0: 88, x1: 470, y1: 130, priority: 2 })
  ]);

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

  function zoneAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return ZONES
      .filter((zone) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1)
      .sort((a, b) => b.priority - a.priority)[0] || null;
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

  function resolveDropIntent(zoneId, context = {}) {
    const zone = ZONES.find((item) => item.id === zoneId) || null;
    const base = { zoneId: zone ? zone.id : 'ground', zoneLabel: zone ? zone.label : '自家庭院' };
    if (!zone || zone.id === 'meadow') {
      return { ...base, action: 'save-position', enabled: true, requiresConfirmation: false, title: '把猫放在这里' };
    }
    if (zone.id === 'workshop') {
      if (context.activityState === 'working' || context.activityState === 'onduty') {
        return { ...base, action: 'focus-running', enabled: true, requiresConfirmation: false, title: '账号已经在运行' };
      }
      return { ...base, action: 'launch-profile', enabled: true, requiresConfirmation: true, title: '打开这个账号' };
    }
    if (zone.id === 'mailbox') {
      return context.hasSession
        ? { ...base, action: 'copy-handoff', enabled: true, requiresConfirmation: true, title: '复制当前会话的交接信息' }
        : { ...base, action: 'copy-handoff', enabled: false, requiresConfirmation: false, title: '先选择一个会话' };
    }
    if (zone.id === 'attention') {
      return context.hasSession
        ? { ...base, action: 'focus-session', enabled: true, requiresConfirmation: false, title: '查看当前会话详情' }
        : { ...base, action: 'focus-session', enabled: false, requiresConfirmation: false, title: '这个账号还没有可查看的会话' };
    }
    if (zone.id === 'remote') {
      return context.terminalSupported
        ? { ...base, action: 'open-terminal', enabled: true, requiresConfirmation: false, title: '在内置终端打开这个 Agent' }
        : { ...base, action: 'open-terminal', enabled: false, requiresConfirmation: false, title: '该账号暂时没有可用的终端适配器' };
    }
    if (zone.id === 'queue') {
      if (!context.hasSession) {
        return { ...base, action: 'queue-task', enabled: false, requiresConfirmation: false, title: '先选择一个会话' };
      }
      return context.taskQueueSupported
        ? { ...base, action: 'queue-task', enabled: true, requiresConfirmation: true, title: '把当前会话加入 Agent 待办' }
        : { ...base, action: 'queue-task', enabled: false, requiresConfirmation: false, title: '需要先安装可用的 Agent CLI' };
    }
    return { ...base, action: 'save-position', enabled: true, requiresConfirmation: false, title: '把猫放在这里' };
  }

  return {
    WIDTH,
    HEIGHT,
    ZONES,
    normalizePoint,
    normalizePositions,
    zoneAt,
    resolveDropIntent
  };
});
