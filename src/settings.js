/*
 * AgentDesk — stable user-interface settings.
 *
 * These values used to live only in renderer localStorage. Keeping the
 * canonical copy in Electron's userData directory makes them independent of
 * the packaged executable path and safe across portable updates.
 */

const SETTINGS_VERSION = 1;
const THEMES = new Set(['light', 'dark']);
const VIEWS = new Set(['yard', 'classic']);
const YARD_TIMES = new Set(['auto', 'day', 'dusk', 'night']);
const YARD_WEATHER = new Set(['clear', 'cloudy', 'rain', 'snow']);

const DEFAULT_SETTINGS = Object.freeze({
  theme: null,
  view: 'yard',
  remindersOn: true,
  atmosTime: 'auto',
  atmosWeather: 'clear',
  welcomed: false,
  ledger: null
});

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function settingsFromPayload(payload) {
  if (!isPlainObject(payload)) return null;
  if (Object.prototype.hasOwnProperty.call(payload, 'settings')) {
    return isPlainObject(payload.settings) ? payload.settings : null;
  }
  // A versioned object without a settings body is a damaged wrapper, not a
  // legacy raw settings object. Let the caller fall back to a backup.
  if (Object.prototype.hasOwnProperty.call(payload, 'version')) return null;
  return payload;
}

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeLedger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.date !== 'string') {
    return null;
  }

  const active = {};
  const entries = value.active && typeof value.active === 'object' && !Array.isArray(value.active)
    ? Object.entries(value.active).slice(0, 100)
    : [];
  for (const [id, item] of entries) {
    if (!item || typeof item !== 'object') continue;
    if (!Number.isFinite(item.start) || !Number.isFinite(item.last)) continue;
    active[String(id)] = { start: item.start, last: item.last };
  }

  return {
    ...value,
    date: value.date,
    completed: finiteNonNegative(value.completed),
    workedMs: finiteNonNegative(value.workedMs),
    active,
    lastStretchAt: finiteNonNegative(value.lastStretchAt)
  };
}

function normalizeSettings(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    ...input,
    theme: THEMES.has(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    view: VIEWS.has(input.view) ? input.view : DEFAULT_SETTINGS.view,
    remindersOn: typeof input.remindersOn === 'boolean'
      ? input.remindersOn
      : DEFAULT_SETTINGS.remindersOn,
    atmosTime: YARD_TIMES.has(input.atmosTime) ? input.atmosTime : DEFAULT_SETTINGS.atmosTime,
    atmosWeather: YARD_WEATHER.has(input.atmosWeather)
      ? input.atmosWeather
      : DEFAULT_SETTINGS.atmosWeather,
    welcomed: input.welcomed === true,
    ledger: normalizeLedger(input.ledger)
  };
}

function mergeSettings(current, patch) {
  const base = isPlainObject(current) ? current : {};
  const next = isPlainObject(patch) ? patch : {};
  return normalizeSettings({ ...base, ...next });
}

module.exports = {
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  settingsFromPayload,
  normalizeLedger,
  normalizeSettings,
  mergeSettings
};
