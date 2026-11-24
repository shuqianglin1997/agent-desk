/*
 * AgentDesk — stable user-interface settings.
 *
 * These values used to live only in renderer localStorage. Keeping the
 * canonical copy in Electron's userData directory makes them independent of
 * the packaged executable path and safe across portable updates.
 */

const { normalizeServiceUrls } = require('./mesh/protocol/signaling-auth');
const { normalizeStunUrls } = require('./mesh/protocol/ice-urls');
const { normalizeProgress: normalizeOnboardingProgress } = require('./onboarding-state');

// Version 5 retires the yard-scene, reminder and ledger fields (see RETIRED_FIELDS).
const SETTINGS_VERSION = 5;
const THEMES = new Set(['light', 'dark']);
const LANGS = new Set(['zh', 'en', 'ja']);
const SESSION_SCOPES = new Set(['current', 'all']);
const SESSION_VIEWS = new Set(['compact', 'detail']);
// 会话列表的三种排序（docs/SESSION_MARKS_PLAN.md 第 5.2 节）；筛选只是这一次看的方式，不记进设置。
const SESSION_ORDERS = new Set(['recent', 'fresh', 'tag']);
const PROFILE_QUIT_BEHAVIORS = new Set(['close', 'keep']);
// 声音三档：全部 / 只要要紧的 / 静音；默认只要要紧的。音量 0–100，默认 55（与所有者试听时的默认值相同）。
const SOUND_LEVELS = new Set(['all', 'key', 'off']);

const DEFAULT_SETTINGS = Object.freeze({
  theme: null,
  agentOrder: Object.freeze([]),
  lang: null, // null = 跟随系统语言（中 / 英 / 日）
  sessionScope: 'current',
  sessionView: 'compact',
  sessionOrder: 'recent',
  selectedDeviceLensId: 'all',
  selectedAgentIdByDeviceLens: Object.freeze({}),
  selectedSlotKeyByAgentAndLens: Object.freeze({}),
  profileQuitBehavior: 'close',
  soundLevel: 'key',
  soundVolume: 55,
  welcomed: false,
  onboarding: Object.freeze({ completedVersion: 0, completedAt: null }),
  // null preserves the compatibility inference for installations created
  // before explicit network enrollment existed. First-use initialization
  // writes false; only an explicit device/network action may turn it on.
  meshNetworkEnrollmentEnabled: null,
  meshSignalingUrls: Object.freeze([]),
  meshStunUrls: Object.freeze([])
});

// Fields of retired features (yard scene, reminders, completion ledger). Version 5
// moves them, untouched, under `retired`: nothing is lost, nothing reads them,
// and older builds still load the file. A value already kept there wins over a
// top-level one, so an older build's defaults cannot overwrite it after a downgrade.
const RETIRED_FIELDS = Object.freeze(['view', 'remindersOn', 'atmosTime', 'atmosWeather', 'ledger', 'yardPositions']);

function retireFields(value) {
  const input = isPlainObject(value) ? value : {};
  const moving = RETIRED_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!moving.length) return input;
  const next = { ...input };
  const retired = isPlainObject(input.retired) ? { ...input.retired } : {};
  for (const key of moving) {
    if (!Object.prototype.hasOwnProperty.call(retired, key)) retired[key] = next[key];
    delete next[key];
  }
  return { ...next, retired };
}

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

function boundedId(value, maxLength = 256) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeSelectionMap(value, options = {}) {
  if (!isPlainObject(value)) return {};
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : 200;
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maxEntries)) {
    const key = boundedId(rawKey);
    const selection = boundedId(rawValue);
    if (key && selection) normalized[key] = selection;
  }
  return normalized;
}

function normalizeAgentOrder(value) {
  return [...new Set((Array.isArray(value) ? value : []).slice(0, 1000)
    .map(id => boundedId(id)).filter(Boolean))];
}

function normalizeSoundVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.soundVolume;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSettings(value) {
  const { retired, ...input } = retireFields(value);
  return {
    ...input,
    ...(isPlainObject(retired) ? { retired } : {}),
    theme: THEMES.has(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    agentOrder: normalizeAgentOrder(input.agentOrder),
    lang: LANGS.has(input.lang) ? input.lang : DEFAULT_SETTINGS.lang,
    sessionScope: SESSION_SCOPES.has(input.sessionScope)
      ? input.sessionScope
      : DEFAULT_SETTINGS.sessionScope,
    sessionView: SESSION_VIEWS.has(input.sessionView)
      ? input.sessionView
      : DEFAULT_SETTINGS.sessionView,
    sessionOrder: SESSION_ORDERS.has(input.sessionOrder) ? input.sessionOrder : DEFAULT_SETTINGS.sessionOrder,
    selectedDeviceLensId: boundedId(input.selectedDeviceLensId) || DEFAULT_SETTINGS.selectedDeviceLensId,
    selectedAgentIdByDeviceLens: normalizeSelectionMap(input.selectedAgentIdByDeviceLens),
    selectedSlotKeyByAgentAndLens: normalizeSelectionMap(input.selectedSlotKeyByAgentAndLens),
    profileQuitBehavior: PROFILE_QUIT_BEHAVIORS.has(input.profileQuitBehavior)
      ? input.profileQuitBehavior
      : DEFAULT_SETTINGS.profileQuitBehavior,
    soundLevel: SOUND_LEVELS.has(input.soundLevel) ? input.soundLevel : DEFAULT_SETTINGS.soundLevel,
    soundVolume: normalizeSoundVolume(input.soundVolume),
    welcomed: input.welcomed === true,
    // `welcomed` is retained only for old builds. A legacy boolean never
    // suppresses a newer first-use contract: each onboarding revision must be
    // completed explicitly after its completion screen was actually shown.
    onboarding: normalizeOnboardingProgress(input.onboarding),
    meshNetworkEnrollmentEnabled: typeof input.meshNetworkEnrollmentEnabled === 'boolean'
      ? input.meshNetworkEnrollmentEnabled
      : null,
    meshSignalingUrls: normalizeServiceUrls(input.meshSignalingUrls),
    meshStunUrls: normalizeStunUrls(input.meshStunUrls)
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
  RETIRED_FIELDS,
  settingsFromPayload,
  retireFields,
  normalizeSettings,
  mergeSettings
};
