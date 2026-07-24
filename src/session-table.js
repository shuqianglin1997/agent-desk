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
    const profileId = String(session._profileId || '');
    const identity = session.address || session.id || session.filePath || '';
    return `${profileId}::${String(identity)}`;
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

    return (Array.isArray(records) ? records : [])
      .map((record, index) => ({ record, index }))
      .sort((left, right) => {
        const a = sortableValue(left.record, key);
        const b = sortableValue(right.record, key);
        // Missing values stay at the bottom in both directions.
        if (a === null && b === null) return left.index - right.index;
        if (a === null) return 1;
        if (b === null) return -1;

        const compared = typeof a === 'number' && typeof b === 'number'
          ? a - b
          : collator.compare(String(a), String(b));
        return compared === 0 ? left.index - right.index : compared * sign;
      })
      .map((entry) => entry.record);
  }

  return {
    DATE_FIELDS,
    keyOf,
    fieldValue,
    defaultDirection,
    sort
  };
});
