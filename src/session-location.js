/*
 * Minimal session locator formatting shared by renderer and node:test.
 *
 * A copied locator is intentionally data-only: one path and one coordinate.
 * It must never grow titles, summaries, priorities, prompts, or handoff prose.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SessionLocation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function clean(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function pathOf(session) {
    if (!session || typeof session !== 'object') return '';
    return clean(session.projectPath) || clean(session.filePath);
  }

  function coordinateOf(session) {
    if (!session || typeof session !== 'object') return '';
    const filePath = clean(session.filePath);
    const id = clean(session.address) || clean(session.id);
    if (filePath && id) return `${filePath}#${id}`;
    return filePath || id;
  }

  function formatLocations(locations, labels = {}) {
    const list = (Array.isArray(locations) ? locations : [locations])
      .filter((location) => location && typeof location === 'object');
    const pathLabel = clean(labels.path) || 'Path';
    const coordinateLabel = clean(labels.coordinate) || 'Coordinate';
    const emptyLabel = clean(labels.empty) || '-';
    const many = list.length > 1;

    return list.map((location, index) => {
      const lines = [
        `${pathLabel}: ${clean(location.path) || emptyLabel}`,
        `${coordinateLabel}: ${clean(location.coordinate) || emptyLabel}`
      ];
      return many ? `${index + 1}.\n${lines.join('\n')}` : lines.join('\n');
    }).join('\n\n');
  }

  function format(sessions, labels = {}) {
    const list = (Array.isArray(sessions) ? sessions : [sessions])
      .filter((session) => session && typeof session === 'object')
      .map((session) => ({ path: pathOf(session), coordinate: coordinateOf(session) }));
    return formatLocations(list, labels);
  }

  return { pathOf, coordinateOf, format, formatLocations };
});
