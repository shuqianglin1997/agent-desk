/*
 * AgentDesk — session table view model.
 *
 * Pure UMD helper shared by renderer and node:test. It owns stable cross-account
 * session keys and deterministic sorting; DOM rendering stays in renderer.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SessionTable = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DATE_FIELDS = new Set(['createdAt', 'updatedAt']);

  function keyOf(session) {
    if (!session || typeof session !== 'object') return '';
    if (session.conversationId) return `mesh::${String(session.conversationId)}`;
    const profileId = String(session._profileId || '');
    const identity = session.address || session.id || session.filePath || '';
    return `${profileId}::${String(identity)}`;
  }

  /*
   * 标签、“看过”和“在跑”用的会话键（docs/SESSION_MARKS_PLAN.md 第 5.3 节）。
   * 本机扫到的这一行用 keyOf 的本机口径“运行位置::会话地址”，所以开没开设备网、密钥延后时退回本机扫描，
   * 同一条会话的键都不变，主进程的活动探测也能算出同一个键；只在别的设备上的会话用 mesh 逻辑会话键。
   * 后台对话的行（_hubRun）不是一条会话，没有键。
   */
  function markKeyOf(session) {
    if (!session || typeof session !== 'object' || session._hubRun) return '';
    if (session._remote === true) return session.conversationId ? `mesh::${String(session.conversationId)}` : '';
    const profileId = String(session._profileId || '');
    const identity = session.address || session.id || session.filePath || '';
    return profileId && identity ? `${profileId}::${String(identity)}` : '';
  }

  function fieldValue(session, key) {
    if (!session) return null;
    switch (key) {
      case 'account':
        return session._accountName || session._profileName || '';
      case 'app':
        return session._appLabel || session.appId || '';
      case 'project':
        return session.projectPath || '';
      case 'id':
        return session.address || session.id || '';
      default:
        return session[key];
    }
  }

  function defaultDirection(key) {
    return DATE_FIELDS.has(key) ? 'desc' : 'asc';
  }

  function sortableValue(session, key) {
    const value = fieldValue(session, key);
    if (value === null || value === undefined || value === '') return null;
    if (DATE_FIELDS.has(key)) {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    return String(value);
  }

  function sort(records, sortState = {}, locale = 'zh-CN') {
    const key = sortState.key || 'updatedAt';
    const direction = sortState.direction === 'asc' ? 'asc' : 'desc';
    const sign = direction === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: 'base'
    });

    // Each row's value is read once, before sorting (not in every
    // comparison), and the positions are sorted rather than wrapper objects;
    // the comparison answers as before, so the order is the same.
    const list = Array.isArray(records) ? records : [];
    const values = list.map((record) => sortableValue(record, key));
    return list.map((_record, index) => index)
      .sort((left, right) => {
        const a = values[left];
        const b = values[right];
        // Missing values stay at the bottom in both directions.
        if (a === null && b === null) return left - right;
        if (a === null) return 1;
        if (b === null) return -1;

        const compared = typeof a === 'number' && typeof b === 'number'
          ? a - b
          : collator.compare(String(a), String(b));
        return compared === 0 ? left - right : compared * sign;
      })
      .map((index) => list[index]);
  }

  // Rows from several accounts, newest first (updatedAt, else createdAt):
  // each row's time is read once, then compared as the session list always
  // compared them, so ties and unreadable times keep the same order.
  function byRecent(records) {
    const list = Array.isArray(records) ? records : [];
    const times = list.map((record) => new Date(record.updatedAt || record.createdAt || 0).getTime());
    return list.map((_record, index) => index)
      .sort((a, b) => times[b] - times[a])
      .map((index) => list[index]);
  }

  return {
    DATE_FIELDS,
    keyOf,
    markKeyOf,
    fieldValue,
    defaultDirection,
    sort,
    byRecent
  };
});
