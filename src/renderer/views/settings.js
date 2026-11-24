// AgentDesk — stable settings, theme and language (docs/ARCHITECTURE_PLAN.md
// phase 6). Moved from src/renderer.js unchanged.

import { setStatus } from './common.js';
import { currentDeviceLensId, renderTopbarContext } from './context.js';
import { renderDeviceCenter } from './devices.js';
import { openChildDialog, openUtilityDialog } from './dialogs.js';
import { prepareWelcomeGuide, renderFirstUse } from './first-use.js';
import { renderHubSystem } from './hub.js';
import { renderAttentionInbox } from './inbox.js';
import { offersMainEvent, onMainEvent } from './main-events.js';
import { renderQuotaSummary } from './quota.js';
import { renderAccountHeader, renderAccounts } from './roster.js';
import { renderSessions } from './sessions.js';
import { els, handleToolProgress, recruitDialog, refreshToolInventory, renderToolCenter, state } from './shared.js';

// localStorage keys an older build may still hold. The yard view, reminder,
// scene and ledger keys belong to retired features and are no longer read.
const LEGACY_SETTING_KEYS = {
  theme: 'agentdesk-theme',
  welcomed: 'agentdesk-welcomed'
};

let settingsWriteQueue = Promise.resolve();

function localSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function legacyUserSettings() {
  const legacy = {};
  const theme = localSetting(LEGACY_SETTING_KEYS.theme);
  const welcomed = localSetting(LEGACY_SETTING_KEYS.welcomed);
  if (theme !== null) legacy.theme = theme;
  if (welcomed !== null) legacy.welcomed = welcomed === '1';
  return legacy;
}

function applyUserSettings(value = {}) {
  state.agentOrder = Array.isArray(value.agentOrder) ? value.agentOrder : [];
  state.theme = value.theme === 'light' || value.theme === 'dark' ? value.theme : null;
  state.ui = window.UiContext.create({
    ...state.ui,
    selectedDeviceLensId: value.selectedDeviceLensId || 'all',
    selectedAgentIdByDeviceLens: value.selectedAgentIdByDeviceLens,
    selectedSlotKeyByAgentAndLens: value.selectedSlotKeyByAgentAndLens,
    agentScope: value.sessionScope === 'all' ? 'all' : 'current'
  });
  state.sessionView = value.sessionView === 'detail' ? 'detail' : 'compact';
  state.sessionOrder = ['recent', 'fresh', 'tag'].includes(value.sessionOrder) ? value.sessionOrder : 'recent';
  state.profileQuitBehavior = value.profileQuitBehavior === 'keep' ? 'keep' : 'close';
  if (els.profileQuitBehavior) els.profileQuitBehavior.value = state.profileQuitBehavior;
  window.PixelUi?.setSound?.(value);
  state.welcomed = value.welcomed === true;
  state.onboardingProgress = window.OnboardingState
    ? window.OnboardingState.normalizeProgress(value.onboarding)
    : { completedVersion: 0, completedAt: null };
  // i18n：优先用户存过的语言，否则跟随系统；init 会替换所有 data-i18n 静态文案
  if (window.I18N) window.I18N.init(value.lang);
  updateLangToggle();
}

async function loadUserSettings() {
  const legacy = legacyUserSettings();
  try {
    applyUserSettings(await window.manager.getSettings(legacy));
  } catch (_error) {
    applyUserSettings(legacy);
  }
}

function mirrorLegacySettings(patch) {
  try {
    if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
      if (patch.theme) localStorage.setItem(LEGACY_SETTING_KEYS.theme, patch.theme);
      else localStorage.removeItem(LEGACY_SETTING_KEYS.theme);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'welcomed')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.welcomed, patch.welcomed ? '1' : '0');
    }
  } catch (_error) {
    // The stable userData JSON store remains canonical if localStorage fails.
  }
}

function persistSettings(patch) {
  mirrorLegacySettings(patch);
  let request;
  try {
    // Dispatch immediately so a quick window close cannot strand the change
    // behind a renderer microtask. Main-process handlers merge patches
    // synchronously, so multiple in-flight calls remain non-destructive.
    request = Promise.resolve(window.manager.updateSettings(patch)).catch(() => null);
  } catch (_error) {
    request = Promise.resolve(null);
  }
  settingsWriteQueue = Promise.all([
    settingsWriteQueue.catch(() => null),
    request
  ]).then(([, saved]) => saved);
  return request;
}

function uiSelectionSettingsPatch() {
  return {
    selectedDeviceLensId: currentDeviceLensId(),
    selectedAgentIdByDeviceLens: { ...state.ui.selectedAgentIdByDeviceLens },
    selectedSlotKeyByAgentAndLens: { ...state.ui.selectedSlotKeyByAgentAndLens }
  };
}

function persistUiSelectionMemory(extra = {}) {
  return persistSettings({ ...uiSelectionSettingsPatch(), ...extra });
}

function initTheme() {
  const theme = state.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  updateThemeToggle();
}

// i18n 便捷取词（window.I18N 由 src/i18n/ 提供；未加载时回退到 key，永不抛错）
function tr(key, params) {
  return window.I18N ? window.I18N.t(key, params) : key;
}

// 日期格式跟随界面语言（BCP-47）；新增语言时在此登记
function dateLocale() {
  const map = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' };
  const lang = window.I18N ? window.I18N.getLang() : 'zh';
  return map[lang] || 'zh-CN';
}

// 顶栏语言按钮显示当前语言缩写（中 / EN / 日）
function updateLangToggle() {
  if (!els.langToggle || !window.I18N) return;
  const map = { zh: '中文', en: 'English', ja: '日本語' };
  els.langToggle.textContent = map[window.I18N.getLang()] || '文';
  updateThemeToggle();
}

// 外观按钮上写的是现在的样子，点一下换成另一个。
function updateThemeToggle() {
  const label = els.themeToggle?.querySelector('span');
  if (!label) return;
  label.removeAttribute('data-i18n');
  label.textContent = tr(document.documentElement.dataset.theme === 'dark' ? 'system.theme.dark' : 'system.theme.light');
}

// 语言切换后重刷所有「运行时用 tr 生成」的文案（静态 data-i18n 由 I18N.apply 处理）
function rerenderLocalizedText() {
  renderTopbarContext();
  renderAccounts();
  renderAccountHeader();
  renderSessions();
  renderQuotaSummary();
  renderAttentionInbox();
  renderToolCenter();
  renderDeviceCenter();
  renderHubSystem();
  if (els.recruitDialog?.open) recruitDialog.render();
  if (els.welcomeDialog?.open) {
    if (state.firstUse.mode === 'onboarding') renderFirstUse();
    else prepareWelcomeGuide();
  }
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindSettingsEvents() {
  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    state.theme = next;
    document.documentElement.dataset.theme = next;
    persistSettings({ theme: next });
    updateThemeToggle();
  });

  els.profileQuitBehavior?.addEventListener('change', () => {
    state.profileQuitBehavior = els.profileQuitBehavior.value === 'keep' ? 'keep' : 'close';
    persistSettings({ profileQuitBehavior: state.profileQuitBehavior });
    setStatus(tr(state.profileQuitBehavior === 'keep'
      ? 'status.profileQuitKeep'
      : 'status.profileQuitClose'));
  });

  // 语言切换：循环 中 → EN → 日 → 中，持久化到 settings；setLang 已替换静态文案，
  els.langToggle?.addEventListener('click', () => {
    if (!window.I18N) return;
    const next = window.I18N.setLang(window.I18N.next(), { persist: true });
    persistSettings({ lang: next });
    updateLangToggle();
    rerenderLocalizedText(); // apply() 只换静态 data-i18n；动态渲染的文案也要重刷一遍
  });

  els.helpBtn.addEventListener('click', () => {
    prepareWelcomeGuide();
    openChildDialog(els.welcomeDialog, els.helpBtn);
  });
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindSystemEvents() {
  // 「系统」入口：这台电脑上的工具和 AgentDesk 自己的设置在同一页。
  els.systemBtn?.addEventListener('click', async () => {
    openUtilityDialog('system');
    renderToolCenter();
    await refreshToolInventory(false);
  });

  els.checkToolsBtn?.addEventListener('click', async () => {
    await refreshToolInventory(true);
  });

  if (offersMainEvent('onToolProgress')) {
    onMainEvent('onToolProgress', handleToolProgress);
  }
}

export { localSetting, legacyUserSettings, applyUserSettings, loadUserSettings, mirrorLegacySettings, persistSettings, uiSelectionSettingsPatch, persistUiSelectionMemory, initTheme, tr, dateLocale, updateLangToggle, updateThemeToggle, rerenderLocalizedText, bindSettingsEvents, bindSystemEvents };
