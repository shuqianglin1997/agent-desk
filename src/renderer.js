// AgentDesk — the window's start-up (docs/ARCHITECTURE_PLAN.md phase 6): load
// the settings, data and views in order, bind every view's events, follow
// language changes, and list what the acceptance run may reach. The views
// are the modules under src/renderer/views/.

import { bindAgentManageEvents } from './renderer/views/agent-manage.js';
import { catLookName, catSwatchesBuilt, syncCatSwatches } from './renderer/views/cat-customizer.js';
import { bindAgentCreationEvents, bindCatalogDialogEvents, currentCatalogRevision, openAgentOrProfileEditor, openAgentOrProfileRemoval, openAgentRelationsDialog, openProfileCreationDialog, openSlotAssignmentDialog } from './renderer/views/catalog-dialogs.js';
import { bindClientUpdateEvents, loadClientUpdates } from './renderer/views/client-updates.js';
import { actionAgentId, bindEntryEvents, currentAgentId, currentSlotKey, renderTopbarContext, selectAgent, validateSessionContext, validateUiContext } from './renderer/views/context.js';
import { enrichMeshSession, loadActivity, loadApps, loadProfiles, refreshSessionsOnForeground, sessionAtReplica } from './renderer/views/data.js';
import { bindRemoteEvents, mountWorkspaceSurfaces, renderRemoteActivity } from './renderer/views/detail.js';
import { bindDeviceEvents, bindMeshChangeEvents, loadDeviceOverview, renderDeviceLens, renderMeshAgentList, renderSelectedDeviceDetail } from './renderer/views/devices.js';
import { bindContextMenuRules, bindUtilityDialogEvents, openUtilityDialog } from './renderer/views/dialogs.js';
import { bindFirstUseEvents, renderFirstUse, replaceContinueFirstPreparation } from './renderer/views/first-use.js';
import { bindHubEvents } from './renderer/views/hub.js';
import { collectAttentionItems } from './renderer/views/inbox.js';
import { bindMainEvents } from './renderer/views/main-events.js';
import { bindQuotaEvents, bindQuotaRefreshEvents, loadQuotas, quotaRequestedAt } from './renderer/views/quota.js';
import { renderAccountHeader, renderAccountRoster, renderAccounts, rosterIsInteracting } from './renderer/views/roster.js';
import { bindSessionActionEvents, bindSessionFileEvents } from './renderer/views/session-actions.js';
import { applySessionFilter, bindSessionTableEvents, focusSession, renderSessions } from './renderer/views/sessions.js';
import { bindSettingsEvents, bindSystemEvents, initTheme, loadUserSettings, rerenderLocalizedText, tr, updateLangToggle } from './renderer/views/settings.js';
import { ACTIVITY_POLL_INTERVAL, QUOTA_REFRESH_INTERVAL, els, sessionMarks, setStartupStage, state } from './renderer/views/shared.js';
import { bindTaskPackageEvents, loadTaskPackageHistory, renderIncomingTaskPackages } from './renderer/views/task-packages.js';
import { bindTransferChangeEvents, bindTransferDialogEvents, bindTransferEvents, openFileSendDialog, openTransferCenter } from './renderer/views/transfers.js';
import { bindUpdateEvents, startAutomaticUpdateChecks } from './renderer/views/updates.js';

window.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.dataset.windowPlatform = window.manager.windowPlatform || 'browser';
  setStartupStage('settings-loading');
  await loadUserSettings();
  await sessionMarks.load();
  sessionMarks.setOrder(state.sessionOrder);
  initTheme();
  mountWorkspaceSurfaces();
  bindEvents();
  await loadApps();
  setStartupStage('settings-loading', 'devices');
  await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
  setStartupStage('profiles-loading');
  await loadProfiles(null, { presentFirstUseBeforeSessions: true });
  setStartupStage('task-package-history-loading');
  await loadTaskPackageHistory();
  setStartupStage('ready');
  loadActivity();
  loadClientUpdates();
  loadQuotas();
  // 打开后自动检查一次猫架自己的更新，开着的话每天最多再查一次；只提醒，不下载。
  startAutomaticUpdateChecks();
  // 卡片中的活动和最近活跃在可见时定时刷新。
  // 8 秒一轮：干活/在岗要跟得上会话节奏，60 秒太钝会漏掉短生成；应用在后台时不扫。
  setInterval(() => {
    if (!document.hidden) loadActivity();
  }, ACTIVITY_POLL_INTERVAL);
  // 有序更新的状态用同样的节奏（只看几个文件的状态，变了才重画）。
  setInterval(() => {
    if (!document.hidden) loadClientUpdates();
  }, ACTIVITY_POLL_INTERVAL);
  // 额度查询走独立的慢轮询和主进程缓存，绝不混入 8 秒活跃度探测。
  setInterval(() => {
    if (!document.hidden) loadQuotas();
  }, QUOTA_REFRESH_INTERVAL);
  // 从最小化/后台切回前台时立刻刷新一次，别等下一轮
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshSessionsOnForeground();
    loadActivity();
    loadClientUpdates();
    if (Date.now() - quotaRequestedAt >= QUOTA_REFRESH_INTERVAL) loadQuotas();
  });
  window.addEventListener('focus', refreshSessionsOnForeground);
});

function bindEvents() {
  // Main's change notifications become store topics; the handlers below subscribe.
  bindMainEvents();
  bindEntryEvents();
  bindAgentCreationEvents();
  bindFirstUseEvents();
  bindCatalogDialogEvents();
  bindUpdateEvents();
  bindSettingsEvents();
  bindUtilityDialogEvents();
  bindDeviceEvents();
  bindSystemEvents();
  bindMeshChangeEvents();
  bindHubEvents();
  bindClientUpdateEvents();
  bindTransferChangeEvents();
  bindRemoteEvents();
  bindAgentManageEvents();
  bindQuotaEvents();
  bindContextMenuRules();
  bindQuotaRefreshEvents();
  bindSessionTableEvents();
  bindSessionActionEvents();
  bindTransferEvents();
  bindTaskPackageEvents();
  bindTransferDialogEvents();
  bindSessionFileEvents();
}

// 换语言时，编辑器里的组名和小样说明跟着换
window.addEventListener('i18n:changed', () => {
  if (!catSwatchesBuilt) return;
  els.editBreedSwatches.querySelectorAll('[data-cat-group]').forEach((title) => { title.textContent = tr('cat.group.' + title.dataset.catGroup); });
  els.editBreedSwatches.querySelectorAll('.cc-tile[data-look]').forEach((tile) => {
    const label = catLookName(tile.dataset.look);
    tile.setAttribute('aria-label', label);
    tile.title = label;
  });
  els.editAccSwatches.querySelectorAll('.cc-tile[data-accessory]').forEach((tile) => {
    const label = tr('cat.acc.' + tile.dataset.accessory);
    tile.setAttribute('aria-label', label);
    tile.title = label;
  });
  els.editCollarSwatches.dataset.choices = '';
  syncCatSwatches();
});

// What the acceptance run, the hidden-window check and the snapshot tool may
// read or call in this window (docs/ARCHITECTURE_PLAN.md phase 6). They reach
// the renderer only through this object, so its code can move into modules
// without them noticing. Each entry is looked up when it is called.
// replace(name, fn) swaps one listed function for the rest of the run and
// returns the previous one; only continueFirstPreparation can be swapped
// (the acceptance run holds the official-client launch at waiting-login).
const INSPECT_REPLACEABLE = new Set(['continueFirstPreparation']);
window.AgentDeskInspect = Object.freeze({
  get state() { return state; },
  actionAgentId: (...args) => actionAgentId(...args),
  applySessionFilter: (...args) => applySessionFilter(...args),
  collectAttentionItems: (...args) => collectAttentionItems(...args),
  currentAgentId: (...args) => currentAgentId(...args),
  currentCatalogRevision: (...args) => currentCatalogRevision(...args),
  currentSlotKey: (...args) => currentSlotKey(...args),
  enrichMeshSession: (...args) => enrichMeshSession(...args),
  focusSession: (...args) => focusSession(...args),
  loadDeviceOverview: (...args) => loadDeviceOverview(...args),
  openAgentOrProfileEditor: (...args) => openAgentOrProfileEditor(...args),
  openAgentOrProfileRemoval: (...args) => openAgentOrProfileRemoval(...args),
  openAgentRelationsDialog: (...args) => openAgentRelationsDialog(...args),
  openFileSendDialog: (...args) => openFileSendDialog(...args),
  openProfileCreationDialog: (...args) => openProfileCreationDialog(...args),
  openSlotAssignmentDialog: (...args) => openSlotAssignmentDialog(...args),
  openTransferCenter: (...args) => openTransferCenter(...args),
  openUtilityDialog: (...args) => openUtilityDialog(...args),
  renderAccountHeader: (...args) => renderAccountHeader(...args),
  renderAccountRoster: (...args) => renderAccountRoster(...args),
  renderAccounts: (...args) => renderAccounts(...args),
  renderDeviceLens: (...args) => renderDeviceLens(...args),
  renderFirstUse: (...args) => renderFirstUse(...args),
  renderIncomingTaskPackages: (...args) => renderIncomingTaskPackages(...args),
  renderMeshAgentList: (...args) => renderMeshAgentList(...args),
  renderRemoteActivity: (...args) => renderRemoteActivity(...args),
  renderSelectedDeviceDetail: (...args) => renderSelectedDeviceDetail(...args),
  renderSessions: (...args) => renderSessions(...args),
  renderTopbarContext: (...args) => renderTopbarContext(...args),
  rerenderLocalizedText: (...args) => rerenderLocalizedText(...args),
  rosterIsInteracting: (...args) => rosterIsInteracting(...args),
  selectAgent: (...args) => selectAgent(...args),
  sessionAtReplica: (...args) => sessionAtReplica(...args),
  updateLangToggle: (...args) => updateLangToggle(...args),
  validateSessionContext: (...args) => validateSessionContext(...args),
  validateUiContext: (...args) => validateUiContext(...args),
  replace(name, fn) {
    if (!INSPECT_REPLACEABLE.has(name) || typeof fn !== 'function') throw new TypeError('inspect-not-replaceable');
    return replaceContinueFirstPreparation(fn);
  }
});
