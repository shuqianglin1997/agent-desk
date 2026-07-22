const state = {
  profiles: [],
  sessions: [],
  filteredSessions: [],
  selectedProfileId: null,
  selectedSessionId: null,
  query: '',
  theme: null,
  view: 'yard',
  activity: {},
  quotas: {},
  quotaError: null,
  quotaSelfOpen: false,     // 「本号」chip 展开额度 Beta 详情块
  quotaOverviewOpen: false, // 「全院」chip 展开跨账号额度总览带
  ledger: null,
  remindersOn: true,
  atmosTime: 'auto',
  atmosWeather: 'auto',
  yardPositions: {},
  runtime: {
    adapters: [],
    selectedAdapterId: null,
    selectedIdentityId: null,
    workspaceGrant: null,
    customAgents: [],
    executableGrant: null,
    runtimes: [],
    selectedRuntimeId: null,
    outputs: {},
    notice: null,
    queue: []
  },
  welcomed: false,
  updateInfo: null,
  appMeta: { claude: { label: 'Claude', tagColor: '#d96f33' }, codex: { label: 'Codex', tagColor: '#2f9e8f' } }
};

// 受管客户端元数据（label / 配色）由主进程注册表提供，UI 不再写死 claude/codex
async function loadApps() {
  try {
    const list = await window.manager.listApps();
    if (Array.isArray(list) && list.length) {
      state.appMeta = Object.fromEntries(list.map((a) => [
        a.id,
        {
          label: a.label,
          tagColor: a.tagColor,
          canExportTranscript: Boolean(a.canExportTranscript),
          canLaunch: a.canLaunch !== false
        }
      ]));
    }
  } catch (_error) {
    // 保留内置默认
  }
  // 把配色喂给像素猫（浏览器侧模块无法 require 注册表）
  if (window.YardSprites) {
    for (const [id, meta] of Object.entries(state.appMeta)) window.YardSprites.APP_TAG[id] = meta.tagColor;
  }
  // 新增对话框的「应用」下拉按注册表填充
  if (els.newProfileApp) {
    els.newProfileApp.replaceChildren();
    for (const [id, meta] of Object.entries(state.appMeta)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = meta.label;
      els.newProfileApp.append(option);
    }
  }
}

function appLabel(appId) {
  return (state.appMeta[appId] && state.appMeta[appId].label) || appId;
}
function appColor(appId) {
  return (state.appMeta[appId] && state.appMeta[appId].tagColor) || '#d96f33';
}

const els = {
  accountRoster: document.querySelector('#accountRoster'),
  accountId: document.querySelector('#accountId'),
  accountBadge: document.querySelector('#accountBadge'),
  quotaChipSelf: document.querySelector('#quotaChipSelf'),
  quotaChipAll: document.querySelector('#quotaChipAll'),
  atmosWeatherToggle: document.querySelector('#atmosWeatherToggle'),
  topbarContext: document.querySelector('#topbarContext'),
  yardStage: document.querySelector('#yardStage'),
  yardCanvas: document.querySelector('#yardCanvas'),
  yardOverlay: document.querySelector('#yardOverlay'),
  viewToggle: document.querySelector('#viewToggle'),
  accountActions: document.querySelector('#accountActions'),
  accountManage: document.querySelector('#accountManage'),
  yardManageActions: document.querySelector('#yardManageActions'),
  ledgerDone: document.querySelector('#ledgerDone'),
  ledgerMin: document.querySelector('#ledgerMin'),
  reminderToggle: document.querySelector('#reminderToggle'),
  consoleToggle: document.querySelector('#consoleToggle'),
  atmosTime: document.querySelector('#atmosTime'),
  atmosWeather: document.querySelector('#atmosWeather'),
  runtimeDock: document.querySelector('#runtimeDock'),
  runtimeCount: document.querySelector('#runtimeCount'),
  runtimeList: document.querySelector('#runtimeList'),
  runtimeStatus: document.querySelector('#runtimeStatus'),
  runtimeRegistryBtn: document.querySelector('#runtimeRegistryBtn'),
  runtimeAdapter: document.querySelector('#runtimeAdapter'),
  runtimeIdentity: document.querySelector('#runtimeIdentity'),
  runtimeCwd: document.querySelector('#runtimeCwd'),
  runtimeWorkspaceBtn: document.querySelector('#runtimeWorkspaceBtn'),
  runtimeWorkspaceResetBtn: document.querySelector('#runtimeWorkspaceResetBtn'),
  runtimeSelectedTitle: document.querySelector('#runtimeSelectedTitle'),
  runtimeSelectedMeta: document.querySelector('#runtimeSelectedMeta'),
  runtimeStartBtn: document.querySelector('#runtimeStartBtn'),
  runtimeStopBtn: document.querySelector('#runtimeStopBtn'),
  runtimeOutput: document.querySelector('#runtimeOutput'),
  runtimeForm: document.querySelector('#runtimeForm'),
  runtimeInput: document.querySelector('#runtimeInput'),
  runtimeSendBtn: document.querySelector('#runtimeSendBtn'),
  runtimeHint: document.querySelector('#runtimeHint'),
  agentRegistryDialog: document.querySelector('#agentRegistryDialog'),
  discoveredAgentList: document.querySelector('#discoveredAgentList'),
  customAgentList: document.querySelector('#customAgentList'),
  customAgentName: document.querySelector('#customAgentName'),
  customAgentExecutable: document.querySelector('#customAgentExecutable'),
  customAgentArguments: document.querySelector('#customAgentArguments'),
  pickCustomAgentExecutableBtn: document.querySelector('#pickCustomAgentExecutableBtn'),
  confirmAddCustomAgentBtn: document.querySelector('#confirmAddCustomAgentBtn'),
  attentionInbox: document.querySelector('#attentionInbox'),
  attentionCount: document.querySelector('#attentionCount'),
  attentionItems: document.querySelector('#attentionItems'),
  leaderboardBtn: document.querySelector('#leaderboardBtn'),
  leaderboardDialog: document.querySelector('#leaderboardDialog'),
  leaderboardBody: document.querySelector('#leaderboardBody'),
  themeToggle: document.querySelector('#themeToggle'),
  updateBtn: document.querySelector('#updateBtn'),
  helpBtn: document.querySelector('#helpBtn'),
  addProfileBtn: document.querySelector('#addProfileBtn'),
  editProfileBtn: document.querySelector('#editProfileBtn'),
  removeProfileBtn: document.querySelector('#removeProfileBtn'),
  launchBtn: document.querySelector('#launchBtn'),
  pathConfigBtn: document.querySelector('#pathConfigBtn'),
  diagnosticsBtn: document.querySelector('#diagnosticsBtn'),
  profileFolderBtn: document.querySelector('#profileFolderBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  accountTitle: document.querySelector('#accountTitle'),
  accountMeta: document.querySelector('#accountMeta'),
  accountPath: document.querySelector('#accountPath'),
  accountNote: document.querySelector('#accountNote'),
  quotaOverview: document.querySelector('#quotaOverview'),
  quotaOverviewList: document.querySelector('#quotaOverviewList'),
  quotaOverviewMeta: document.querySelector('#quotaOverviewMeta'),
  quotaSummary: document.querySelector('#quotaSummary'),
  quotaPlan: document.querySelector('#quotaPlan'),
  quotaStateBadge: document.querySelector('#quotaStateBadge'),
  quotaRefreshBtn: document.querySelector('#quotaRefreshBtn'),
  quotaMeters: document.querySelector('#quotaMeters'),
  quotaMessage: document.querySelector('#quotaMessage'),
  sessionCount: document.querySelector('#sessionCount'),
  searchInput: document.querySelector('#searchInput'),
  sessionRows: document.querySelector('#sessionRows'),
  statusBar: document.querySelector('#statusBar'),
  detailTitle: document.querySelector('#detailTitle'),
  detailId: document.querySelector('#detailId'),
  detailCreated: document.querySelector('#detailCreated'),
  detailUpdated: document.querySelector('#detailUpdated'),
  detailSource: document.querySelector('#detailSource'),
  detailProject: document.querySelector('#detailProject'),
  detailFile: document.querySelector('#detailFile'),
  detailAddress: document.querySelector('#detailAddress'),
  copySummaryBtn: document.querySelector('#copySummaryBtn'),
  copyAddressBtn: document.querySelector('#copyAddressBtn'),
  copyProjectBtn: document.querySelector('#copyProjectBtn'),
  openSessionFileBtn: document.querySelector('#openSessionFileBtn'),
  exportSessionBtn: document.querySelector('#exportSessionBtn'),
  profileDialog: document.querySelector('#profileDialog'),
  newProfileApp: document.querySelector('#newProfileApp'),
  newProfileName: document.querySelector('#newProfileName'),
  newProfileGroup: document.querySelector('#newProfileGroup'),
  newProfileNote: document.querySelector('#newProfileNote'),
  confirmAddProfileBtn: document.querySelector('#confirmAddProfileBtn'),
  editDialog: document.querySelector('#editDialog'),
  editName: document.querySelector('#editName'),
  editIdentity: document.querySelector('#editIdentity'),
  editGroup: document.querySelector('#editGroup'),
  editNote: document.querySelector('#editNote'),
  confirmEditBtn: document.querySelector('#confirmEditBtn'),
  editCatCanvas: document.querySelector('#editCatCanvas'),
  editCatRandom: document.querySelector('#editCatRandom'),
  editBreedSwatches: document.querySelector('#editBreedSwatches'),
  editCollarSwatches: document.querySelector('#editCollarSwatches'),
  editAccSwatches: document.querySelector('#editAccSwatches'),
  groupOptions: document.querySelector('#groupOptions'),
  welcomeDialog: document.querySelector('#welcomeDialog'),
  pathDialog: document.querySelector('#pathDialog'),
  profilePathInput: document.querySelector('#profilePathInput'),
  sessionRootInput: document.querySelector('#sessionRootInput'),
  executablePathInput: document.querySelector('#executablePathInput'),
  pickProfilePathBtn: document.querySelector('#pickProfilePathBtn'),
  pickSessionRootBtn: document.querySelector('#pickSessionRootBtn'),
  pickExecutablePathBtn: document.querySelector('#pickExecutablePathBtn'),
  confirmPathBtn: document.querySelector('#confirmPathBtn'),
  diagnosticsDialog: document.querySelector('#diagnosticsDialog'),
  diagnosticsBody: document.querySelector('#diagnosticsBody'),
  copyDiagnosticsBtn: document.querySelector('#copyDiagnosticsBtn')
};

let lastDiagnostics = null;
let yardMounted = false;
let updateBusy = false;
let updateButtonTimer = null;
let quotaRequest = null;
let quotaHasLoaded = false;
let quotaRequestedAt = 0;
const QUOTA_REFRESH_INTERVAL = 5 * 60_000;

window.addEventListener('DOMContentLoaded', async () => {
  await loadUserSettings();
  initTheme();
  bindEvents();
  await loadApps();
  initYard();
  initCompanion();
  applyView();
  await loadProfiles();
  loadActivity();
  loadQuotas();
  // 庭院可见、或排行榜开着时轮询（排行榜按钮在经典视图也可点，要保证它也实时刷新）。
  // 8 秒一轮：干活/在岗要跟得上会话节奏，60 秒太钝会漏掉短生成。仅可见时轮询，后台不扫。
  setInterval(() => {
    if (!document.hidden && (state.view === 'yard' || els.leaderboardDialog.open)) loadActivity();
  }, 8000);
  // 额度查询走独立的慢轮询和主进程缓存，绝不混入 8 秒活跃度探测。
  setInterval(() => {
    if (!document.hidden) loadQuotas();
  }, QUOTA_REFRESH_INTERVAL);
  // Auto time follows the clock; auto weather advances on a calm 20–45 minute
  // deterministic schedule. A one-minute UI tick is enough and avoids work in
  // the background.
  setInterval(() => {
    if (!document.hidden && isYardView()) {
      window.YardScene.refreshAtmosphere();
      updateAtmosphereReadout();
    }
  }, 60_000);
  // 从最小化/后台切回前台时立刻刷新一次，别等下一轮
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.view === 'yard' || els.leaderboardDialog.open) loadActivity();
    if (Date.now() - quotaRequestedAt >= QUOTA_REFRESH_INTERVAL) loadQuotas();
  });
  maybeShowWelcome();
});

const LEGACY_SETTING_KEYS = {
  theme: 'agentdesk-theme',
  view: 'agentdesk-view',
  remindersOn: 'agentdesk-reminders',
  atmosTime: 'agentdesk-yard-time',
  atmosWeather: 'agentdesk-yard-weather',
  welcomed: 'agentdesk-welcomed',
  ledger: 'agentdesk-ledger'
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
  const view = localSetting(LEGACY_SETTING_KEYS.view);
  const reminders = localSetting(LEGACY_SETTING_KEYS.remindersOn);
  const atmosTime = localSetting(LEGACY_SETTING_KEYS.atmosTime);
  const atmosWeather = localSetting(LEGACY_SETTING_KEYS.atmosWeather);
  const welcomed = localSetting(LEGACY_SETTING_KEYS.welcomed);
  const ledger = localSetting(LEGACY_SETTING_KEYS.ledger);

  if (theme !== null) legacy.theme = theme;
  if (view !== null) legacy.view = view;
  if (reminders !== null) legacy.remindersOn = reminders !== '0';
  if (atmosTime !== null) legacy.atmosTime = atmosTime;
  if (atmosWeather !== null) legacy.atmosWeather = atmosWeather;
  if (welcomed !== null) legacy.welcomed = welcomed === '1';
  if (ledger !== null) {
    try {
      legacy.ledger = JSON.parse(ledger);
    } catch (_error) {
      // Invalid legacy localStorage is ignored; the stable store will repair it.
    }
  }
  return legacy;
}

function applyUserSettings(value = {}) {
  state.theme = value.theme === 'light' || value.theme === 'dark' ? value.theme : null;
  state.view = value.view === 'classic' ? 'classic' : 'yard';
  state.remindersOn = value.remindersOn !== false;
  state.agentConsoleOn = value.agentConsoleOn === true;
  state.atmosTime = ['auto', 'day', 'dusk', 'night'].includes(value.atmosTime)
    ? value.atmosTime
    : 'auto';
  state.atmosWeather = ['auto', 'clear', 'cloudy', 'rain', 'snow'].includes(value.atmosWeather)
    ? value.atmosWeather
    : 'auto';
  state.welcomed = value.welcomed === true;
  state.ledger = value.ledger && typeof value.ledger === 'object' ? value.ledger : null;
  state.yardPositions = window.YardInteractions
    ? window.YardInteractions.normalizePositions(value.yardPositions)
    : {};
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
    if (Object.prototype.hasOwnProperty.call(patch, 'view')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.view, patch.view);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'remindersOn')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.remindersOn, patch.remindersOn ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'atmosTime')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.atmosTime, patch.atmosTime);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'atmosWeather')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.atmosWeather, patch.atmosWeather);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'welcomed')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.welcomed, patch.welcomed ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'ledger')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.ledger, JSON.stringify(patch.ledger));
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

function initTheme() {
  const theme = state.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

function maybeShowWelcome() {
  if (state.welcomed) return;
  state.welcomed = true;
  persistSettings({ welcomed: true });
  els.welcomeDialog.showModal();
}

function bindEvents() {
  els.addProfileBtn.addEventListener('click', () => {
    els.accountManage.open = false;
    els.newProfileApp.value = els.newProfileApp.options[0] ? els.newProfileApp.options[0].value : 'claude';
    els.newProfileName.value = '';
    els.newProfileGroup.value = '';
    els.newProfileNote.value = '';
    els.profileDialog.showModal();
    els.newProfileName.focus();
  });

  els.confirmAddProfileBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const name = els.newProfileName.value.trim();
    if (!name) {
      setStatus('先给账号槽位起一个名字。');
      return;
    }
    const profile = await window.manager.addProfile({
      appId: els.newProfileApp.value,
      name,
      group: els.newProfileGroup.value,
      note: els.newProfileNote.value
    });
    els.profileDialog.close();
    await loadProfiles(profile.id);
    setStatus(`已创建 ${profile.name}。`);
  });

  els.editProfileBtn.addEventListener('click', () => {
    els.accountManage.open = false;
    const profile = selectedProfile();
    if (!profile) return;
    els.editName.value = profile.name;
    els.editGroup.value = profile.group || '';
    els.editIdentity.value = profile.identityKey || '';
    els.editNote.value = profile.note || '';
    populateIdentityDatalist();
    openCatCustomizer(profile);
    els.editDialog.showModal();
    els.editName.focus();
  });

  els.confirmEditBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const profile = selectedProfile();
    if (!profile) return;
    const name = els.editName.value.trim();
    if (!name) {
      setStatus('名称不能为空。');
      return;
    }
    await window.manager.updateProfile({
      id: profile.id,
      name,
      group: els.editGroup.value,
      identityKey: els.editIdentity.value,
      note: els.editNote.value,
      cat: { ...catDraft }
    });
    els.editDialog.close();
    await loadProfiles(profile.id);
    setStatus('已保存账号资料和猫咪外观。');
  });

  els.editCatRandom.addEventListener('click', () => {
    const breeds = window.YardCats.BREED_KEYS;
    const collars = window.YardCats.COLLAR_COLORS;
    const accs = window.YardCats.ACCESSORIES;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    catDraft = { breed: pick(breeds), collar: pick(collars), accessory: pick(accs) };
    syncCatSwatches();
    renderCatPreview();
  });

  els.removeProfileBtn.addEventListener('click', async () => {
    els.accountManage.open = false;
    const profile = selectedProfile();
    if (!profile || profile.isProtected) return;
    if (!window.confirm(`移除「${profile.name}」？本地目录不会删除。`)) return;
    const result = await window.manager.removeProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || '移除失败。');
      return;
    }
    await loadProfiles();
    setStatus('已移除账号槽位。');
  });

  els.launchBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || '打开失败。');
      return;
    }
    await loadProfiles(profile.id);
    setStatus(result.warning || `已打开 ${profile.name}。`);
  });

  els.updateBtn.addEventListener('click', async () => {
    await handleUpdateClick();
  });

  window.manager.onUpdateProgress((progress) => {
    handleUpdateProgress(progress);
  });

  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    state.theme = next;
    document.documentElement.dataset.theme = next;
    persistSettings({ theme: next });
    syncYard();
  });

  els.viewToggle.addEventListener('click', () => {
    state.view = state.view === 'yard' ? 'classic' : 'yard';
    persistSettings({ view: state.view });
    applyView();
  });

  els.reminderToggle.addEventListener('click', () => {
    state.remindersOn = !state.remindersOn;
    persistSettings({ remindersOn: state.remindersOn });
    els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
    els.reminderToggle.textContent = state.remindersOn ? '🔔 提醒 开' : '🔕 提醒 关';
    setStatus(state.remindersOn ? '休息提醒已开启。' : '休息提醒已关闭，猫照常陪你干活。');
  });

  els.consoleToggle.addEventListener('click', () => {
    state.agentConsoleOn = !state.agentConsoleOn;
    persistSettings({ agentConsoleOn: state.agentConsoleOn });
    applyAgentConsole();
    setStatus(state.agentConsoleOn
      ? '内嵌控制台已展开。'
      : '内嵌控制台已收起 —— 你自己终端里的会话照常被识别。');
  });

  els.helpBtn.addEventListener('click', () => {
    els.welcomeDialog.showModal();
  });

  els.runtimeAdapter.addEventListener('change', () => {
    state.runtime.selectedAdapterId = els.runtimeAdapter.value || null;
    const adapter = state.runtime.adapters.find((item) => item.id === state.runtime.selectedAdapterId);
    const profile = selectedProfile();
    state.runtime.selectedIdentityId = adapter?.identityAppId && profile?.appId === adapter.identityAppId
      ? profile.id
      : null;
    renderRuntimeDock();
  });

  els.runtimeIdentity.addEventListener('change', () => {
    state.runtime.selectedIdentityId = els.runtimeIdentity.value || null;
    renderRuntimeDock();
  });

  els.runtimeRegistryBtn.addEventListener('click', async () => {
    await loadRuntimeAdapters();
    renderDiscoveredAgentList();
    renderCustomAgentList();
    els.agentRegistryDialog.showModal();
  });

  els.pickCustomAgentExecutableBtn.addEventListener('click', async () => {
    if (!window.manager.pickAgentExecutable) return;
    const result = await window.manager.pickAgentExecutable({
      defaultPath: state.runtime.executableGrant?.path
    });
    if (!result?.ok) {
      if (!result?.cancelled) setStatus(result?.reason || '无法选择 Agent 可执行文件。');
      return;
    }
    state.runtime.executableGrant = result;
    els.customAgentExecutable.value = result.path;
  });

  els.confirmAddCustomAgentBtn.addEventListener('click', async () => {
    await addCustomAgent();
  });

  els.runtimeWorkspaceBtn.addEventListener('click', async () => {
    if (!window.manager.pickTerminalWorkspace) return;
    const profile = selectedProfile();
    const session = selectedSession();
    const defaultPath = state.runtime.workspaceGrant?.path
      || session?.projectPath
      || profile?.sessionRoot
      || profile?.profilePath;
    const result = await window.manager.pickTerminalWorkspace({ defaultPath });
    if (!result?.ok) {
      if (!result?.cancelled) setStatus(result?.reason || '无法选择 Agent 工作目录。');
      return;
    }
    state.runtime.workspaceGrant = result;
    renderRuntimeDock();
    setStatus(`Agent 新实例将使用 ${result.path}`);
  });

  els.runtimeWorkspaceResetBtn.addEventListener('click', () => {
    state.runtime.workspaceGrant = null;
    renderRuntimeDock();
    setStatus('Agent 工作目录已恢复为跟随当前会话。');
  });

  els.runtimeStartBtn.addEventListener('click', async () => {
    await startRuntimeForSelectedProfile();
  });

  els.runtimeStopBtn.addEventListener('click', async () => {
    await stopCurrentRuntime();
  });

  els.runtimeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendRuntimeInput();
  });

  els.runtimeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    els.runtimeForm.requestSubmit();
  });

  if (window.manager.onTerminalEvent) {
    window.manager.onTerminalEvent(handleRuntimeEvent);
  }

  els.pathConfigBtn.addEventListener('click', () => {
    const profile = selectedProfile();
    if (!profile) return;
    els.profilePathInput.value = profile.profilePath || '';
    els.sessionRootInput.value = profile.sessionRoot || '';
    els.executablePathInput.value = profile.executablePath || '';
    els.pathDialog.showModal();
    els.profilePathInput.focus();
  });

  els.pickProfilePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: '选择账号数据目录',
      defaultPath: els.profilePathInput.value
    });
    if (picked) els.profilePathInput.value = picked;
  });

  els.pickSessionRootBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: '选择会话根目录',
      defaultPath: els.sessionRootInput.value
    });
    if (picked) els.sessionRootInput.value = picked;
  });

  els.pickExecutablePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickFile({
      title: '选择官方 App 可执行文件',
      defaultPath: els.executablePathInput.value || undefined
    });
    if (picked) els.executablePathInput.value = picked;
  });

  els.confirmPathBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const profile = selectedProfile();
    if (!profile) return;
    const profilePath = els.profilePathInput.value.trim();
    const sessionRoot = els.sessionRootInput.value.trim();
    if (!profilePath || !sessionRoot) {
      setStatus('账号目录和会话根目录都不能为空。');
      return;
    }
    await window.manager.updateProfile({
      id: profile.id,
      profilePath,
      sessionRoot,
      executablePath: els.executablePathInput.value.trim()
    });
    els.pathDialog.close();
    await loadProfiles(profile.id);
    setStatus('路径已保存，会话已重新扫描。');
  });

  els.diagnosticsBtn.addEventListener('click', async () => {
    await showDiagnostics();
  });

  els.copyDiagnosticsBtn.addEventListener('click', async () => {
    if (!lastDiagnostics) return;
    await window.manager.writeClipboard(formatDiagnosticsText(lastDiagnostics));
    setStatus('已复制诊断信息。');
  });

  els.profileFolderBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    const result = await window.manager.openPath(profile.profilePath);
    setStatus(result.message || result.reason || (result.ok ? '已打开账号目录。' : '无法打开账号目录。'));
  });

  els.refreshBtn.addEventListener('click', async () => {
    if (isYardView()) window.YardScene.fx('bell');
    await loadSessions(true);
    await loadActivity();
    setStatus(isYardView() ? '♪ 摇铃 —— 全体猫竖起耳朵，会话已重新扫描。' : '会话列表已刷新。');
  });

  // 额度 chips：本号 chip 开合额度 Beta 详情；全院 chip 开合跨账号总览带（原型交互）
  els.quotaChipSelf?.addEventListener('click', () => {
    state.quotaSelfOpen = !state.quotaSelfOpen;
    renderQuotaSummary();
  });
  els.quotaChipAll?.addEventListener('click', () => {
    state.quotaOverviewOpen = !state.quotaOverviewOpen;
    renderQuotaOverview();
  });

  // 「管理」下拉遵循业界惯例：点菜单外任意处或按 Esc 关闭
  document.addEventListener('pointerdown', (event) => {
    if (els.accountManage.open && !els.accountManage.contains(event.target)) {
      els.accountManage.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.accountManage.open) els.accountManage.open = false;
  });

  els.quotaRefreshBtn.addEventListener('click', async () => {
    if (!selectedProfile()) return;
    setStatus('正在从官方服务刷新额度…');
    await loadQuotas(true);
    const quota = selectedQuota();
    if (state.quotaError) {
      setStatus(`额度刷新失败：${state.quotaError}`);
    } else if (quota?.status === 'ok') {
      setStatus(`额度已刷新：${quotaHeadline(quota)}。`);
    } else {
      setStatus(quota?.reason || state.quotaError || '额度暂不可用。');
    }
  });

  els.leaderboardBtn.addEventListener('click', () => {
    renderLeaderboard();
    els.leaderboardDialog.showModal();
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    applySessionFilter(true);
  });

  els.copySummaryBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    const session = selectedSession();
    if (!profile || !session) return;
    await window.manager.writeClipboard(makeHandoffText(sessionOwnerProfile(session), session));
    if (isYardView()) {
      window.YardScene.fx('handoff');
      setStatus(`${profile.name} 把交接信投进了邮筒 —— 已复制，粘给新会话即可。`);
    } else {
      setStatus('已复制会话交接信息。');
    }
  });

  els.copyAddressBtn.addEventListener('click', async () => {
    const session = selectedSession();
    if (!session) return;
    await window.manager.writeClipboard(session.address || session.filePath || session.id);
    setStatus('已复制会话标识。');
  });

  els.copyProjectBtn.addEventListener('click', async () => {
    const session = selectedSession();
    if (!session?.projectPath) return;
    await window.manager.writeClipboard(session.projectPath);
    setStatus('已复制项目目录。');
  });

  els.openSessionFileBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    const session = selectedSession();
    if (!profile || !session?.filePath) return;
    // 合流列表中会话可能属于组内另一个槽位，操作按归属槽位走
    const result = await window.manager.revealSession({
      profileId: sessionOwnerProfile(session).id,
      sessionId: session.id,
      filePath: session.filePath
    });
    setStatus(result.message || result.reason || (result.ok ? '已打开会话位置。' : '无法打开会话位置。'));
  });

  els.exportSessionBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    const session = selectedSession();
    if (!profile || !session || !window.manager.exportSession) return;
    const result = await window.manager.exportSession({
      profileId: sessionOwnerProfile(session).id,
      sessionId: session.id
    });
    if (result?.canceled) return;
    setStatus(result?.message || result?.reason || (result?.ok ? '已导出会话。' : '导出失败。'));
  });
}

async function handleUpdateClick() {
  if (updateBusy) return;
  updateBusy = true;
  clearTimeout(updateButtonTimer);
  els.updateBtn.disabled = true;
  els.updateBtn.classList.remove('update-available', 'update-error');
  els.updateBtn.textContent = '检查中…';
  els.updateBtn.title = '正在查询 GitHub Releases';
  setStatus('正在检查 GitHub 更新…');

  const result = await window.manager.checkForUpdates();
  if (!result.ok) {
    setStatus(result.reason || '检查更新失败。');
    finishUpdateButton('! 重试', '检查更新失败，点击重试', 'update-error');
    return;
  }

  state.updateInfo = result;
  renderAttentionInbox();
  if (!result.updateAvailable) {
    setStatus(`当前已是最新版 v${result.currentVersion}。`);
    finishUpdateButton('✓ 最新', `当前版本 v${result.currentVersion}`, '');
    return;
  }

  els.updateBtn.classList.add('update-available');
  els.updateBtn.textContent = '↑ 更新';
  els.updateBtn.title = `发现 v${result.latestVersion}，点击更新`;
  const size = result.assetSize ? `（${formatBytes(result.assetSize)}）` : '';
  const action = result.installSupported
    ? `将从 GitHub 下载 ${result.assetName || 'Windows portable 更新包'}${size}，通过 SHA-256 校验后替换当前程序并重启。`
    : `${result.manualReason || '当前环境不能自动覆盖。'}\n将打开 GitHub Release 页面。`;
  const confirmed = window.confirm(
    `发现 AgentDesk v${result.latestVersion}\n当前版本：v${result.currentVersion}\n\n${action}\n\n继续吗？`
  );
  if (!confirmed) {
    updateBusy = false;
    els.updateBtn.disabled = false;
    setStatus(`发现新版本 v${result.latestVersion}，随时点击账号操作栏中的“↑ 更新”。`);
    return;
  }

  els.updateBtn.disabled = true;
  els.updateBtn.textContent = result.installSupported ? '0%' : '↗ 打开';
  const installed = await window.manager.installUpdate();
  if (!installed.ok) {
    setStatus(installed.reason || '更新失败。');
    finishUpdateButton('! 重试', '更新失败，点击重试', 'update-error');
    return;
  }
  if (installed.manual) {
    setStatus(installed.message || '已打开 GitHub Release 页面。');
    finishUpdateButton('↗ 已打开', '已打开 GitHub Release', '');
    return;
  }
  if (installed.upToDate) {
    setStatus(installed.message || '当前已是最新版。');
    finishUpdateButton('✓ 最新', '当前已是最新版', '');
    return;
  }
  if (installed.restarting) {
    els.updateBtn.textContent = '✓ 重启';
    els.updateBtn.title = '更新完成，正在重启';
    setStatus(installed.message || '更新完成，正在重启…');
  }
}

function handleUpdateProgress(progress = {}) {
  if (progress.message) setStatus(progress.message);
  if (progress.stage === 'downloading' && Number.isFinite(progress.percent)) {
    els.updateBtn.textContent = `${progress.percent}%`;
    els.updateBtn.title = `正在下载更新：${progress.percent}%`;
  } else if (progress.stage === 'installing') {
    els.updateBtn.textContent = '✓ 安装';
    els.updateBtn.title = '校验完成，准备重启';
  } else if (progress.stage === 'error') {
    els.updateBtn.textContent = '! 重试';
    els.updateBtn.classList.add('update-error');
    els.updateBtn.title = progress.message || '更新失败';
  }
}

function finishUpdateButton(label, title, className) {
  updateBusy = false;
  els.updateBtn.disabled = false;
  els.updateBtn.textContent = label;
  els.updateBtn.title = title;
  els.updateBtn.classList.remove('update-available', 'update-error');
  if (className) els.updateBtn.classList.add(className);
  updateButtonTimer = setTimeout(() => {
    if (state.updateInfo?.updateAvailable) {
      els.updateBtn.textContent = '↑ 更新';
      els.updateBtn.title = `发现 v${state.updateInfo.latestVersion}，点击更新`;
      els.updateBtn.classList.add('update-available');
    } else {
      els.updateBtn.textContent = '↻ 更新';
      els.updateBtn.title = '检查 GitHub 更新';
      els.updateBtn.classList.remove('update-available', 'update-error');
    }
  }, 2200);
}

async function loadProfiles(preferredId = null) {
  state.profiles = await window.manager.listProfiles();
  const liveIds = new Set(state.profiles.map((profile) => profile.id));
  state.quotas = Object.fromEntries(
    Object.entries(state.quotas).filter(([profileId]) => liveIds.has(profileId))
  );
  state.selectedProfileId = preferredId || state.selectedProfileId || state.profiles[0]?.id || null;
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.profiles[0]?.id || null;
  }
  renderAccounts();
  renderAccountHeader();
  await loadSessions(true);
  await loadRuntimeAdapters();
  renderAttentionInbox();
  // Profile edits invalidate the main-process cache. Refresh in the background
  // after the first quota request, without making profile/session UI wait.
  if (quotaHasLoaded) loadQuotas();
}

async function loadSessions(selectFirst = false) {
  const profile = selectedProfile();
  if (!profile) {
    state.sessions = [];
    applySessionFilter(selectFirst);
    return;
  }
  // 会话按「账号」合流：同一登录身份的所有槽位（桌面 / CLI / Work…）一起列。
  // 每条记录带上归属槽位 id，定位 / 导出仍指向正确的槽位；「来源」列区分形态。
  const group = groupOfProfile(profile.id);
  const members = group ? group.members : [profile];
  // allSettled：某个槽位扫描失败只丢它自己的会话，不清空整组的合并列表
  const settled = await Promise.allSettled(members.map(async (member) => {
    const records = await window.manager.listSessions(member);
    return (Array.isArray(records) ? records : []).map((record) => ({ ...record, _profileId: member.id }));
  }));
  state.sessions = settled
    .filter((entry) => entry.status === 'fulfilled')
    .flatMap((entry) => entry.value)
    .sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    ));
  applySessionFilter(selectFirst);
}

// 合流列表里每条会话真正归属的槽位（操作要用它，不能用当前选中槽位）
function sessionOwnerProfile(session) {
  return state.profiles.find((item) => item.id === session?._profileId) || selectedProfile();
}

// ── 账号额度（Beta）────────────────────────────────────
async function loadQuotas(force = false) {
  if (!window.manager.listQuotas) return null;
  if (quotaRequest) return quotaRequest;

  quotaRequestedAt = Date.now();
  state.quotaError = null;
  renderQuotaSummary();
  quotaRequest = (async () => {
    try {
      const list = await window.manager.listQuotas({ force: force === true });
      if (!Array.isArray(list)) throw new Error('额度服务返回格式异常');
      state.quotas = Object.fromEntries(
        list.filter((item) => item?.profileId).map((item) => [item.profileId, item])
      );
      return list;
    } catch (error) {
      state.quotaError = error?.message || '额度查询失败';
      return null;
    } finally {
      quotaHasLoaded = true;
      quotaRequest = null;
      // 刷整个控制条（含 ⚡ 能量徽章），renderAccountHeader 内部会级联 renderQuotaSummary → chips
      renderAccountHeader();
      syncYard();
    }
  })();
  // Render once more after quotaRequest becomes truthy so the loading marker
  // appears even when a previous snapshot is still on screen.
  renderQuotaSummary();
  return quotaRequest;
}

function selectedQuota() {
  return state.selectedProfileId ? state.quotas[state.selectedProfileId] || null : null;
}

function quotaPlanLabel(value) {
  const labels = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    pro: 'Pro',
    prolite: 'Pro Lite',
    team: 'Team',
    self_serve_business_usage_based: 'Business',
    business: 'Business',
    enterprise_cbp_usage_based: 'Enterprise',
    enterprise: 'Enterprise',
    edu: 'Edu',
    unknown: 'Unknown'
  };
  return value ? (labels[value] || String(value)) : '';
}

function formatQuotaReset(value, now = Date.now()) {
  const resetAt = Date.parse(value);
  if (!Number.isFinite(resetAt)) return '重置时间未知';
  const remaining = resetAt - now;
  if (remaining <= 0) return '已到重置点，等待刷新';
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分后重置`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天 ${hours % 24} 小时后重置`;
  return `${new Date(resetAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置`;
}

function quotaHeadline(snapshot) {
  if (!snapshot || !window.YardEnergy) return '额度未知';
  const window_ = window.YardEnergy.constrainingWindow(snapshot, Date.now());
  if (!window_) return snapshot.reason || '额度未知';
  return `${window_.label}剩余 ${Math.round(window_.remainingPercent)}%`;
}

function renderQuotaMeters(snapshot) {
  els.quotaMeters.replaceChildren();
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  if (!windows.length) return;
  const labelCounts = windows.reduce((map, item) => {
    map.set(item.label, (map.get(item.label) || 0) + 1);
    return map;
  }, new Map());

  for (const window_ of windows) {
    const remaining = Number(window_.remainingPercent);
    if (!Number.isFinite(remaining)) continue;
    const level = window.YardEnergy?.energyForRemaining(remaining) || 'unknown';
    const meter = document.createElement('div');
    meter.className = 'quota-meter';
    meter.dataset.level = level;

    const head = document.createElement('div');
    head.className = 'quota-meter-head';
    const label = document.createElement('span');
    label.className = 'quota-meter-label';
    const scope = String(window_.scope || '').trim();
    const showScope = scope && (scope.toLowerCase() !== 'codex' || labelCounts.get(window_.label) > 1);
    label.textContent = `${showScope ? `${scope} · ` : ''}${window_.label || '额度周期'}`;
    const value = document.createElement('span');
    value.className = 'quota-meter-value';
    value.textContent = `剩 ${Math.round(remaining)}%`;
    head.append(label, value);

    const track = document.createElement('div');
    track.className = 'quota-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label.textContent);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(remaining)));
    const fill = document.createElement('div');
    fill.className = 'quota-fill';
    fill.style.width = `${Math.max(0, Math.min(100, remaining))}%`;
    track.append(fill);

    const foot = document.createElement('div');
    foot.className = 'quota-meter-foot';
    foot.textContent = formatQuotaReset(window_.resetsAt);
    meter.title = `${label.textContent}：已用 ${Math.round(window_.usedPercent)}%，${foot.textContent}`;
    meter.append(head, track, foot);
    els.quotaMeters.append(meter);
  }
}

function renderQuotaSummary() {
  // 总览与单账号额度共用同一批刷新时机（loadQuotas / selectProfile / refreshAll）。
  renderQuotaOverview();
  const profile = selectedProfile();
  els.quotaSummary.hidden = !profile;
  els.quotaRefreshBtn.disabled = !profile || Boolean(quotaRequest);
  if (!profile) return;

  // 额度 Beta 详情块默认收起（原型）：控制条上只留「本号」chip，点击 chip 展开本块
  els.quotaSummary.hidden = !state.quotaSelfOpen;
  const snapshot = selectedQuota();
  const loading = Boolean(quotaRequest);
  els.quotaSummary.classList.toggle('is-loading', loading);
  const refreshFailed = Boolean(state.quotaError) && snapshot?.status === 'ok';
  els.quotaSummary.dataset.status = refreshFailed ? 'stale' : (snapshot?.status || (loading ? 'loading' : 'unknown'));
  els.quotaSummary.dataset.energy = 'unknown';
  els.quotaPlan.textContent = quotaPlanLabel(snapshot?.planType);
  els.quotaMeters.replaceChildren();

  if (!snapshot) {
    els.quotaStateBadge.textContent = loading ? '查询中' : (state.quotaError ? '读取失败' : '等待查询');
    els.quotaMessage.textContent = loading
      ? '正在读取官方额度；首次冷启动可能需要十几秒…'
      : (state.quotaError || '选择账号后会自动查询，额度不会混入高频活跃度轮询。');
    els.quotaSummary.title = els.quotaMessage.textContent;
    return;
  }

  const statusLabels = {
    unsupported: '暂不支持',
    signed_out: '未登录',
    stale: '本地缓存',
    error: '读取失败'
  };
  if (refreshFailed) {
    els.quotaStateBadge.textContent = '上次数据';
    renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = `刷新失败：${state.quotaError}。已保留上次数据。`;
  } else if (snapshot.status === 'ok') {
    const energy = window.YardEnergy ? window.YardEnergy.deriveEnergy(snapshot, Date.now()) : 'unknown';
    const meta = window.YardEnergy?.ENERGY_META?.[energy];
    els.quotaSummary.dataset.energy = energy;
    els.quotaStateBadge.textContent = loading ? `${meta?.label || '额度可用'} · 刷新中` : (meta?.label || '额度可用');
    renderQuotaMeters(snapshot);
    const extras = [];
    if (snapshot.credits?.unlimited) extras.push('加购额度不限');
    else if (snapshot.credits?.hasCredits && snapshot.credits?.balance !== null && snapshot.credits?.balance !== undefined) {
      extras.push(`加购余额 ${snapshot.credits.balance}`);
    }
    extras.push('官方实时数据');
    els.quotaMessage.textContent = extras.join(' · ');
  } else {
    els.quotaStateBadge.textContent = loading
      ? `${statusLabels[snapshot.status] || '额度未知'} · 刷新中`
      : (statusLabels[snapshot.status] || '额度未知');
    if (snapshot.status === 'stale') renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = snapshot.reason || '当前没有可展示的额度数据。';
  }
  els.quotaSummary.title = snapshot.reason || `${quotaPlanLabel(snapshot.planType)} ${quotaHeadline(snapshot)}`.trim();
}

function renderQuotaOverview() {
  // 总览按「账号」而不是槽位：同一登录身份的多个槽位只出一行，
  // 行代表取组内有真实额度快照的那个（额度只在部分客户端有官方 API）。
  const groups = identityGroups();
  const representatives = groups.map((group) => {
    const holder = group.members.find((member) => state.quotas[member.id]?.status === 'ok') || group.primary;
    return { ...holder, name: group.primary.name };
  });
  const rows = window.QuotaOverview
    ? window.QuotaOverview.buildQuotaOverview(representatives, state.quotas, Date.now())
    : [];

  // 控制条 chips（本号/全院）永远刷新，且不依赖总览带/聚合模块是否存在
  // （code-review：控制条核心 UI 不能被可选模块的守卫连带闸住）
  renderQuotaChips(groups, rows);
  if (!els.quotaOverview || !window.QuotaOverview) return;
  els.quotaOverview.hidden = !state.quotaOverviewOpen || groups.length < 2;
  if (els.quotaOverview.hidden) return;
  const withQuota = rows.filter((row) => row.hasQuota).length;
  if (els.quotaOverviewMeta) {
    els.quotaOverviewMeta.textContent = withQuota
      ? `${withQuota}/${rows.length} 个账号有实时额度`
      : `${rows.length} 个账号`;
  }

  els.quotaOverviewList.replaceChildren();
  const unsupported = [];
  for (const row of rows) {
    if (row.status === 'unsupported') {
      unsupported.push(row);
      continue; // 折叠到尾部一行，不再一账号一行灰字刷屏
    }
    const item = document.createElement('li');
    item.className = 'quota-overview-item';
    item.dataset.status = row.status;

    const name = document.createElement('span');
    name.className = 'quota-overview-name';
    name.textContent = row.name;

    const value = document.createElement('span');
    value.className = 'quota-overview-value';
    if (row.hasQuota) {
      const level = window.YardEnergy?.energyForRemaining(row.tightest.remainingPercent) || 'unknown';
      item.dataset.level = level;
      value.textContent = `${row.tightest.label} 剩 ${Math.round(row.tightest.remainingPercent)}%`;
      item.title = `${row.name} · ${formatQuotaReset(row.tightest.resetsAt)}`;
    } else {
      value.textContent = row.status === 'loading' ? '查询中…' : (row.reason || '无额度数据');
      item.title = row.reason || value.textContent;
    }

    item.append(name, value);
    els.quotaOverviewList.append(item);
  }

  if (unsupported.length) {
    const rest = document.createElement('li');
    rest.className = 'quota-overview-rest';
    rest.textContent = `其余 ${unsupported.length} 个账号暂无官方额度接口`;
    rest.title = unsupported.map((row) => row.name).join('、');
    els.quotaOverviewList.append(rest);
  }
}

// ── 控制条额度 chips（原型：本号 / 全院 各一枚，条形量表 + 百分比）────────
// 本号 = 选中账号（组）的最紧窗口剩余；全院 = 全部账号里最紧的那个（一眼看底线）。
function renderQuotaChips(groups, rows) {
  if (!els.quotaChipSelf || !els.quotaChipAll) return;
  const rowById = new Map(rows.map((row) => [String(row.profileId), row]));
  const selectedGroup = groupOfProfile(state.selectedProfileId);
  let selfRow = null;
  if (selectedGroup) {
    for (const member of selectedGroup.members) {
      const row = rowById.get(String(member.id));
      if (row && (!selfRow || (row.hasQuota && !selfRow.hasQuota))) selfRow = row;
    }
  }
  setQuotaChip(els.quotaChipSelf, selfRow, '点击展开本号额度详情');

  const known = rows.filter((row) => row.hasQuota);
  const allRow = known.length
    ? known.reduce((a, b) => (a.tightest.remainingPercent <= b.tightest.remainingPercent ? a : b))
    : null;
  setQuotaChip(els.quotaChipAll, allRow, '点击展开全院额度总览', allRow ? `全院最紧 ${allRow.name}` : null);

  // 可展开控件惯例：aria-expanded 反映面板实际可见态；单账号没有总览可展，置灰
  els.quotaChipSelf.setAttribute('aria-expanded', String(Boolean(selectedGroup) && state.quotaSelfOpen));
  els.quotaChipAll.disabled = groups.length < 2;
  els.quotaChipAll.setAttribute('aria-expanded', String(groups.length >= 2 && state.quotaOverviewOpen));
  if (els.quotaChipAll.disabled) els.quotaChipAll.title = '只有一个账号时没有全院总览';
}

function setQuotaChip(chip, row, hint, prefix = null) {
  const fill = chip.querySelector('.mtr i');
  const value = chip.querySelector('b');
  if (!fill || !value) return; // chip 内部结构被改动时安静降级，别抛 TypeError（code-review 加固）
  const loading = Boolean(quotaRequest);
  if (row && row.hasQuota) {
    const percent = Math.max(0, Math.min(100, Math.round(row.tightest.remainingPercent)));
    chip.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    fill.style.width = `${percent}%`;
    value.textContent = `${percent}%`;
    chip.title = `${prefix || row.name} · ${row.tightest.label} 剩 ${percent}% · ${hint}`;
  } else {
    chip.dataset.level = 'unknown';
    fill.style.width = '0%';
    value.textContent = loading ? '…' : '—';
    chip.title = `${row?.reason || (loading ? '额度查询中…' : '暂无额度数据')} · ${hint}`;
  }
}

function applySessionFilter(selectFirst = false) {
  const query = state.query;
  state.filteredSessions = query
    ? state.sessions.filter((session) => {
        return [
          session.title,
          session.id,
          session.projectPath,
          session.source,
          session.status,
          session.model
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
    : [...state.sessions];

  if (selectFirst || !state.filteredSessions.some((session) => session.id === state.selectedSessionId)) {
    state.selectedSessionId = state.filteredSessions[0]?.id || null;
  }

  renderSessions();
  renderInspector();
  renderRuntimeDock();
}

// ── 猫咪档案卡（编辑对话框换装） ─────────────────────
const COLLAR_LABELS = { '#c94f2e': '绯红', '#2f9e8f': '松石', '#d9a53a': '姜黄', '#3d6aa8': '黛蓝', '#8a6bb8': '藤紫', '#6d9440': '茶绿' };
const ACC_LABELS = { none: '无', scarf: '围巾', glasses: '眼镜', bow: '蝴蝶结', hat: '草帽' };
let catDraft = { breed: 'orange', collar: '#c94f2e', accessory: 'none' };
let editingProfile = null;
let catSwatchesBuilt = false;

function openCatCustomizer(profile) {
  if (!window.YardCats || !window.YardSprites) return;
  editingProfile = profile;
  catDraft = window.YardCats.normalizeCat(profile.cat, profile.id);
  if (!catSwatchesBuilt) { buildCatSwatches(); catSwatchesBuilt = true; }
  syncCatSwatches();
  renderCatPreview();
}

function buildCatSwatches() {
  const breeds = window.YardSprites.BREEDS;
  window.YardCats.BREED_KEYS.forEach((key) => {
    els.editBreedSwatches.append(makeSwatch({
      dot: breeds[key].f, label: breeds[key].label,
      pressed: () => catDraft.breed === key,
      pick: () => { catDraft = { ...catDraft, breed: key }; }
    }));
  });
  window.YardCats.COLLAR_COLORS.forEach((color) => {
    els.editCollarSwatches.append(makeSwatch({
      dot: color, label: COLLAR_LABELS[color] || color,
      pressed: () => catDraft.collar === color,
      pick: () => { catDraft = { ...catDraft, collar: color }; }
    }));
  });
  window.YardCats.ACCESSORIES.forEach((id) => {
    els.editAccSwatches.append(makeSwatch({
      label: ACC_LABELS[id] || id,
      pressed: () => catDraft.accessory === id,
      pick: () => { catDraft = { ...catDraft, accessory: id }; }
    }));
  });
}

function makeSwatch({ dot, label, pressed, pick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cc-swatch';
  btn._pressed = pressed;
  if (dot) {
    const swatchDot = document.createElement('span');
    swatchDot.className = 'cc-dot';
    swatchDot.style.background = dot;
    btn.append(swatchDot);
  }
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(text);
  btn.addEventListener('click', () => {
    pick();
    syncCatSwatches();
    renderCatPreview();
  });
  return btn;
}

function syncCatSwatches() {
  els.editDialog.querySelectorAll('.cc-swatch').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(Boolean(btn._pressed && btn._pressed())));
  });
}

function renderCatPreview() {
  const canvas = els.editCatCanvas;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 草地投影
  ctx.fillStyle = 'rgba(90, 130, 70, 0.28)';
  ctx.fillRect(24, 98, 64, 6);
  ctx.fillRect(30, 104, 52, 3);
  const S = window.YardSprites;
  const pal = S.BREEDS[catDraft.breed] || S.BREEDS.orange;
  const protectedSlot = Boolean(editingProfile && editingProfile.isProtected);
  S.drawCat(ctx, S.SIT, pal, {
    dx: 8, dy: 14, scale: 6, seed: 5,
    collar: catDraft.collar,
    bell: protectedSlot,
    tag: protectedSlot ? null : (editingProfile ? editingProfile.appId : 'claude'),
    accessory: catDraft.accessory === 'none' ? null : catDraft.accessory
  });
}

// ── 庭院视图 ─────────────────────────────────────────
function isYardView() {
  return yardMounted && document.body.dataset.view === 'yard';
}

function initYard() {
  if (!window.YardScene || !window.YardCats || !els.yardCanvas) return;
  window.YardScene.mount({
    canvas: els.yardCanvas,
    overlay: els.yardOverlay,
    onSelect: async (profileId) => {
      await selectProfile(profileId);
      const profile = selectedProfile();
      if (profile) setStatus(`已选中 ${profile.name} —— 下方是它的会话。`);
    },
    onPet: (profile) => {
      window.YardScene.say(profile.id, { text: '喵～ 呼噜呼噜', kind: 'ambient', duration: 2800 });
      setStatus(`${profile.name}：呼噜呼噜呼噜……`);
    },
    onDrop: handleYardDrop
  });
  yardMounted = true;
  // 固定窗口 + 满铺裁剪横带：场景用固定逻辑尺寸（原生 480×236），CSS 满铺整宽、
  // 木框裁掉底部空草坪 —— 不再按容器宽响应式重算（回退改动①的 ResizeObserver）。
  initAtmosphere();
}

// 时间 / 天气控件：从稳定设置恢复，点击切换并持久化
function initAtmosphere() {
  const TIME_LABEL = { auto: '跟随系统', day: '白天', dusk: '黄昏', night: '夜晚' };
  const WEATHER_LABEL = { auto: '自动变化', clear: '晴天', cloudy: '多云', rain: '下雨', snow: '下雪' };
  const syncPressed = () => {
    els.atmosTime.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === state.atmosTime)));
    els.atmosWeather.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === state.atmosWeather)));
  };
  els.atmosTime.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosTime = btn.dataset.time;
    persistSettings({ atmosTime: state.atmosTime });
    window.YardScene.setAtmosphere({ time: state.atmosTime });
    syncPressed();
    updateAtmosphereReadout();
    setStatus(`庭院时间：${TIME_LABEL[state.atmosTime]}。`);
  });
  els.atmosWeather.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosWeather = btn.dataset.weather;
    persistSettings({ atmosWeather: state.atmosWeather });
    window.YardScene.setAtmosphere({ weather: state.atmosWeather });
    syncPressed();
    updateAtmosphereReadout();
    setStatus(`庭院天气：${WEATHER_LABEL[state.atmosWeather]}。`);
  });
  // 天气行默认收起（原型只显时间行）；⛅ 展开，或用户存过非自动天气时自动展开
  const syncWeatherToggle = () => {
    if (els.atmosWeatherToggle) {
      els.atmosWeatherToggle.setAttribute('aria-expanded', String(!els.atmosWeather.hidden));
    }
  };
  els.atmosWeatherToggle?.addEventListener('click', () => {
    els.atmosWeather.hidden = !els.atmosWeather.hidden;
    syncWeatherToggle();
  });
  if (state.atmosWeather !== 'auto') els.atmosWeather.hidden = false;
  syncWeatherToggle();

  window.YardScene.setAtmosphere({ time: state.atmosTime, weather: state.atmosWeather });
  syncPressed();
  updateAtmosphereReadout();
}

function updateAtmosphereReadout() {
  if (!window.YardScene?.getAtmosphere) return;
  const current = window.YardScene.getAtmosphere();
  els.yardStage.dataset.time = current.time;
  els.yardStage.dataset.weather = current.weather;
  const timeLabels = { day: '白天', dusk: '黄昏', night: '夜晚' };
  const weatherLabels = { clear: '晴', cloudy: '多云', rain: '雨', snow: '雪' };
  const autoTime = els.atmosTime.querySelector('[data-time="auto"]');
  const autoWeather = els.atmosWeather.querySelector('[data-weather="auto"]');
  if (autoTime) autoTime.title = `系统时间：当前${timeLabels[current.time] || current.time}`;
  if (autoWeather) {
    const next = current.nextWeatherAt ? compactDate(current.nextWeatherAt) : '稍后';
    autoWeather.title = `自动天气：当前${weatherLabels[current.weather] || current.weather}，${next}后更新`;
  }
}

// ── 多 Agent Fleet ───────────────────────────────────
// Agent 类型、登录身份、工作区与运行实例是四个独立维度。Renderer 只能
// 组合主进程登记过的适配器与账号；可执行文件和 argv 始终由 main 决定。
const pendingRuntimeEvents = [];
let runtimeQueueSending = false;

function selectedRuntime() {
  return state.runtime.runtimes.find((item) => item.id === state.runtime.selectedRuntimeId) || null;
}

function runtimeIsActive(runtime = selectedRuntime()) {
  return Boolean(runtime && ['starting', 'running', 'ready'].includes(runtime.status));
}

function runtimeStatusLabel(runtime) {
  const labels = {
    idle: '未选择',
    starting: '启动中',
    running: runtime?.mode === 'agent' ? '处理中' : '运行中',
    ready: '可输入',
    error: '出错',
    exited: '已退出',
    stopped: '已停止'
  };
  return labels[runtime?.status || 'idle'] || runtime?.status || '未选择';
}

function upsertRuntime(value) {
  if (!value?.id) return null;
  const index = state.runtime.runtimes.findIndex((item) => item.id === value.id);
  if (index < 0) state.runtime.runtimes.push(value);
  else state.runtime.runtimes[index] = { ...state.runtime.runtimes[index], ...value };
  return state.runtime.runtimes.find((item) => item.id === value.id) || null;
}

async function loadCustomAgents() {
  if (!window.manager.listCustomAgents) {
    state.runtime.customAgents = [];
    return;
  }
  try {
    const agents = await window.manager.listCustomAgents();
    state.runtime.customAgents = Array.isArray(agents) ? agents : [];
  } catch (_error) {
    state.runtime.customAgents = [];
  }
}

function renderDiscoveredAgentList() {
  if (!els.discoveredAgentList) return;
  els.discoveredAgentList.replaceChildren();
  const builtIns = state.runtime.adapters.filter((adapter) => !adapter.custom);
  for (const adapter of builtIns) {
    const item = document.createElement('div');
    item.className = 'discovered-agent-item';
    item.dataset.available = String(Boolean(adapter.available));
    const name = document.createElement('strong');
    name.textContent = adapter.label;
    const protocol = document.createElement('span');
    protocol.textContent = adapter.protocol === 'acp'
      ? 'ACP'
      : adapter.protocol === 'shell'
        ? '终端'
        : '直连';
    const stateLabel = document.createElement('b');
    stateLabel.textContent = adapter.available ? '可用' : '未发现';
    const detail = document.createElement('small');
    detail.textContent = adapter.detail || adapter.source || '';
    item.append(name, protocol, stateLabel, detail);
    els.discoveredAgentList.append(item);
  }
}

function renderCustomAgentList() {
  if (!els.customAgentList) return;
  els.customAgentList.replaceChildren();
  if (!state.runtime.customAgents.length) {
    const empty = document.createElement('p');
    empty.textContent = '还没有自定义 Agent；上面的常用 Agent 会自动发现，不需要重复添加。';
    els.customAgentList.append(empty);
    return;
  }
  for (const agent of state.runtime.customAgents) {
    const row = document.createElement('div');
    row.className = 'custom-agent-item';
    const name = document.createElement('strong');
    name.textContent = agent.name;
    const executable = document.createElement('code');
    executable.textContent = [shortPath(agent.executable), ...(agent.args || [])].join(' ');
    executable.title = [agent.executable, ...(agent.args || [])].join(' ');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '移除';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`移除自定义 Agent「${agent.name}」？已运行的实例不会被中断。`)) return;
      const result = await window.manager.removeCustomAgent(agent.id);
      if (!result?.ok) {
        setStatus(result?.reason || '无法移除自定义 Agent。');
        return;
      }
      await loadCustomAgents();
      await loadRuntimeAdapters();
      renderDiscoveredAgentList();
      renderCustomAgentList();
      setStatus(`已移除「${agent.name}」；正在运行的实例不受影响。`);
    });
    row.append(name, executable, remove);
    els.customAgentList.append(row);
  }
}

async function addCustomAgent() {
  if (!window.manager.addCustomAgent) return;
  const name = els.customAgentName.value.trim();
  if (!name) {
    setStatus('请填写自定义 Agent 名称。');
    els.customAgentName.focus();
    return;
  }
  if (!state.runtime.executableGrant?.grantId) {
    setStatus('请先通过系统选择器选择 Agent 可执行文件。');
    return;
  }
  els.confirmAddCustomAgentBtn.disabled = true;
  const result = await window.manager.addCustomAgent({
    name,
    executableGrantId: state.runtime.executableGrant.grantId,
    arguments: els.customAgentArguments.value
  });
  els.confirmAddCustomAgentBtn.disabled = false;
  if (!result?.ok) {
    setStatus(result?.reason || '无法添加自定义 Agent。');
    return;
  }
  state.runtime.executableGrant = null;
  els.customAgentName.value = '';
  els.customAgentExecutable.value = '';
  els.customAgentArguments.value = '';
  await loadCustomAgents();
  await loadRuntimeAdapters();
  renderDiscoveredAgentList();
  renderCustomAgentList();
  setStatus(`已接入 ACP Agent「${result.agent.name}」。`);
}

async function loadRuntimeAdapters() {
  const profile = selectedProfile();
  if (!window.manager.listTerminalAdapters) {
    state.runtime.adapters = [];
    renderRuntimeDock();
    return;
  }
  try {
    const [adapters, liveRuntimes, customAgents] = await Promise.all([
      window.manager.listTerminalAdapters(profile?.id || null),
      window.manager.listTerminalRuntimes ? window.manager.listTerminalRuntimes() : [],
      window.manager.listCustomAgents ? window.manager.listCustomAgents() : []
    ]);
    state.runtime.adapters = Array.isArray(adapters) ? adapters : [];
    state.runtime.customAgents = Array.isArray(customAgents) ? customAgents : [];
    for (const runtime of Array.isArray(liveRuntimes) ? liveRuntimes : []) upsertRuntime(runtime);
    const selectedStillExists = state.runtime.adapters.some((item) => item.id === state.runtime.selectedAdapterId);
    state.runtime.selectedAdapterId = selectedStillExists
      ? state.runtime.selectedAdapterId
      : (state.runtime.adapters.find((item) => item.available && item.mode === 'agent')?.id
        || state.runtime.adapters.find((item) => item.available)?.id
        || state.runtime.adapters[0]?.id
        || null);
    const adapter = state.runtime.adapters.find((item) => item.id === state.runtime.selectedAdapterId);
    if (adapter?.identityAppId && profile?.appId === adapter.identityAppId && !state.runtime.selectedIdentityId) {
      state.runtime.selectedIdentityId = profile.id;
    }
    if (!state.runtime.selectedRuntimeId && state.runtime.runtimes.length) {
      state.runtime.selectedRuntimeId = state.runtime.runtimes.at(-1).id;
    }
  } catch (error) {
    state.runtime.adapters = [];
    state.runtime.notice = {
      kind: 'error',
      title: 'Agent 发现失败',
      detail: error?.message || '无法读取本机 Agent CLI',
      action: 'runtime'
    };
  }
  renderRuntimeDock();
}

function renderRuntimeAdapterPicker() {
  const previous = state.runtime.selectedAdapterId || els.runtimeAdapter.value;
  els.runtimeAdapter.replaceChildren();
  if (!state.runtime.adapters.length) {
    const option = document.createElement('option');
    option.textContent = '没有发现 Agent';
    option.disabled = true;
    option.selected = true;
    els.runtimeAdapter.append(option);
    return null;
  }
  for (const adapter of state.runtime.adapters) {
    const option = document.createElement('option');
    option.value = adapter.id;
    option.disabled = !adapter.available;
    option.textContent = `${adapter.label}${adapter.available ? '' : '（未安装）'}`;
    els.runtimeAdapter.append(option);
  }
  if (state.runtime.adapters.some((item) => item.id === previous)) els.runtimeAdapter.value = previous;
  const selected = state.runtime.adapters.find((item) => item.id === els.runtimeAdapter.value) || null;
  if (selected) state.runtime.selectedAdapterId = selected.id;
  return selected;
}

function renderRuntimeIdentityPicker(adapter) {
  els.runtimeIdentity.replaceChildren();
  if (!adapter?.identityAppId) {
    const option = document.createElement('option');
    option.textContent = '不需要身份';
    option.selected = true;
    els.runtimeIdentity.append(option);
    els.runtimeIdentity.disabled = true;
    state.runtime.selectedIdentityId = null;
    return;
  }

  els.runtimeIdentity.disabled = false;
  const machine = document.createElement('option');
  machine.value = '';
  machine.textContent = `本机默认 ${adapter.label} 登录`;
  els.runtimeIdentity.append(machine);
  const identities = state.profiles.filter((profile) => profile.appId === adapter.identityAppId);
  for (const profile of identities) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    els.runtimeIdentity.append(option);
  }
  if (identities.some((item) => item.id === state.runtime.selectedIdentityId)) {
    els.runtimeIdentity.value = state.runtime.selectedIdentityId;
  } else {
    state.runtime.selectedIdentityId = null;
    els.runtimeIdentity.value = '';
  }
}

function renderRuntimeList() {
  els.runtimeList.replaceChildren();
  if (!state.runtime.runtimes.length) {
    const empty = document.createElement('p');
    empty.className = 'runtime-list-empty';
    empty.textContent = '还没有运行实例';
    els.runtimeList.append(empty);
    return;
  }

  const ordered = [...state.runtime.runtimes].sort((left, right) => right.startedAt - left.startedAt);
  for (const runtime of ordered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `runtime-card${runtime.id === state.runtime.selectedRuntimeId ? ' selected' : ''}`;
    button.dataset.status = runtime.status || 'idle';

    const top = document.createElement('span');
    top.className = 'runtime-card-top';
    const adapter = document.createElement('b');
    adapter.textContent = runtime.adapterLabel || runtime.adapterId;
    const status = document.createElement('em');
    status.textContent = runtimeStatusLabel(runtime);
    top.append(adapter, status);

    const title = document.createElement('strong');
    title.textContent = runtime.title || runtime.adapterLabel || 'Agent';
    const meta = document.createElement('small');
    meta.textContent = [runtime.identityName || '默认身份', shortPath(runtime.cwd)].filter(Boolean).join(' · ');
    button.append(top, title, meta);
    button.addEventListener('click', () => {
      state.runtime.selectedRuntimeId = runtime.id;
      renderRuntimeDock();
      if (!els.runtimeInput.disabled) els.runtimeInput.focus();
    });
    els.runtimeList.append(button);
  }
}

function renderSelectedRuntimeOutput(runtime) {
  els.runtimeOutput.replaceChildren();
  const chunks = runtime ? (state.runtime.outputs[runtime.id] || []) : [];
  if (!runtime || !chunks.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'runtime-placeholder';
    placeholder.textContent = runtime
      ? '这个实例还没有输出。发送第一条消息即可开始。'
      : '左侧是全部运行实例。新建后可随时切换，其他 Agent 会继续在后台工作。';
    els.runtimeOutput.append(placeholder);
    return;
  }
  for (const item of chunks) {
    const chunk = document.createElement('span');
    chunk.dataset.stream = item.stream || 'stdout';
    chunk.textContent = item.text;
    els.runtimeOutput.append(chunk);
  }
  els.runtimeOutput.scrollTop = els.runtimeOutput.scrollHeight;
}

function renderRuntimeDock() {
  if (!els.runtimeDock) return;
  const profile = selectedProfile();
  const session = selectedSession();
  const adapter = renderRuntimeAdapterPicker();
  renderRuntimeIdentityPicker(adapter);
  renderRuntimeList();

  const runtime = selectedRuntime();
  const activeCount = state.runtime.runtimes.filter(runtimeIsActive).length;
  els.runtimeCount.textContent = `${activeCount} 运行中 · ${state.runtime.runtimes.length} 个实例`;

  const status = runtime?.status || 'idle';
  els.runtimeStatus.dataset.status = status;
  els.runtimeStatus.textContent = runtimeStatusLabel(runtime);
  els.runtimeSelectedTitle.textContent = runtime?.title || '选择或新建一个 Agent';
  els.runtimeSelectedMeta.textContent = runtime
    ? [runtime.adapterLabel, runtime.identityName || '默认身份', shortPath(runtime.cwd)].filter(Boolean).join(' · ')
    : '多个 Agent 可在不同身份与工作区并行运行';

  const expectedCwd = state.runtime.workspaceGrant?.path
    || session?.projectPath
    || profile?.sessionRoot
    || profile?.profilePath
    || '用户主目录';
  els.runtimeCwd.textContent = shortPath(expectedCwd);
  els.runtimeCwd.title = expectedCwd;
  els.runtimeWorkspaceResetBtn.hidden = !state.runtime.workspaceGrant;
  els.runtimeWorkspaceBtn.textContent = state.runtime.workspaceGrant ? '更换' : '选择目录';

  const canSend = Boolean(runtime && (
    (runtime.mode === 'shell' && runtime.status === 'running') ||
    (runtime.mode === 'agent' && runtime.status === 'ready')
  ));
  els.runtimeAdapter.disabled = !state.runtime.adapters.length;
  els.runtimeStartBtn.disabled = !adapter?.available || activeCount >= 12;
  els.runtimeStopBtn.disabled = !runtimeIsActive(runtime);
  els.runtimeInput.disabled = !canSend;
  els.runtimeSendBtn.disabled = !canSend;
  els.runtimeInput.placeholder = !runtime
    ? '选择一个实例后输入…'
    : runtime.mode === 'shell'
      ? '输入一行本机命令；Enter 执行，Shift+Enter 换行…'
      : '对这个 Agent 说话；Enter 发送，Shift+Enter 换行…';
  renderSelectedRuntimeOutput(runtime);

  const queueHint = state.runtime.queue.length ? `待办 ${state.runtime.queue.length}` : '';
  els.runtimeHint.textContent = adapter
    ? [adapter.detail, adapter.caution, queueHint].filter(Boolean).join(' · ')
    : '客户端账号只是可选身份；Agent 类型、身份、工作区和运行实例彼此独立。';
}

async function startRuntimeForSelectedProfile() {
  const workspaceProfile = selectedProfile();
  const adapterId = state.runtime.selectedAdapterId;
  if (!adapterId || !window.manager.startTerminal) return;

  els.runtimeStartBtn.disabled = true;
  const result = await window.manager.startTerminal({
    adapterId,
    identityProfileId: state.runtime.selectedIdentityId,
    workspaceGrantId: state.runtime.workspaceGrant?.grantId || null,
    workspaceProfileId: state.runtime.workspaceGrant ? null : (workspaceProfile?.id || null),
    sessionId: state.runtime.workspaceGrant ? null : (selectedSession()?.id || null)
  });
  if (!result?.ok) {
    renderRuntimeDock();
    if (!result?.cancelled) {
      state.runtime.notice = {
        kind: 'error',
        title: 'Agent 实例无法开启',
        detail: result?.reason || '启动失败',
        profileId: workspaceProfile?.id || null,
        action: 'runtime'
      };
      setStatus(result?.reason || 'Agent 实例启动失败。');
      renderAttentionInbox();
    } else {
      setStatus('已取消新建 Agent 实例。');
    }
    return;
  }

  upsertRuntime(result);
  state.runtime.selectedRuntimeId = result.id;
  state.runtime.outputs[result.id] = [];
  state.runtime.notice = null;
  for (let index = 0; index < pendingRuntimeEvents.length;) {
    const event = pendingRuntimeEvents[index];
    if (event.runtimeId === result.id) {
      pendingRuntimeEvents.splice(index, 1);
      applyRuntimeEvent(event);
    } else {
      index += 1;
    }
  }
  renderRuntimeDock();
  renderAttentionInbox();
  setStatus(`已新建 ${result.adapterLabel} 实例；其他 Agent 会继续运行。`);
  if (!els.runtimeInput.disabled) els.runtimeInput.focus();
}

async function sendRuntimeInput() {
  const runtime = selectedRuntime();
  const text = els.runtimeInput.value.trim();
  if (!runtime || !text || !window.manager.sendTerminal) return false;
  els.runtimeInput.disabled = true;
  els.runtimeSendBtn.disabled = true;
  const result = await window.manager.sendTerminal({ runtimeId: runtime.id, text });
  if (!result?.ok) {
    state.runtime.notice = {
      kind: 'error',
      title: `${runtime.title || runtime.adapterLabel} 发送失败`,
      detail: result?.reason || 'Agent 没有响应',
      profileId: runtime.workspaceProfileId || runtime.profileId,
      runtimeId: runtime.id,
      action: 'runtime'
    };
    setStatus(result?.reason || '无法发送到 Agent。');
    renderAttentionInbox();
    renderRuntimeDock();
    return false;
  }
  upsertRuntime(result);
  els.runtimeInput.value = '';
  renderRuntimeDock();
  return true;
}

async function stopCurrentRuntime() {
  const runtime = selectedRuntime();
  if (!runtime || !window.manager.stopTerminal) return;
  const result = await window.manager.stopTerminal({ runtimeId: runtime.id });
  if (!result?.ok) {
    setStatus(result?.reason || '无法停止 Agent 实例。');
    return;
  }
  upsertRuntime(result);
  renderRuntimeDock();
  setStatus(`已停止「${runtime.title || runtime.adapterLabel}」，其他实例不受影响。`);
}

function handleRuntimeEvent(event) {
  if (!event?.runtimeId) return;
  if (!state.runtime.runtimes.some((item) => item.id === event.runtimeId)) {
    pendingRuntimeEvents.push(event);
    if (pendingRuntimeEvents.length > 200) pendingRuntimeEvents.shift();
    return;
  }
  applyRuntimeEvent(event);
}

function applyRuntimeEvent(event) {
  const runtime = state.runtime.runtimes.find((item) => item.id === event.runtimeId);
  if (!runtime) return;
  if (event.type === 'output' && event.text) appendRuntimeOutput(event.runtimeId, event.text, event.stream);
  if (event.type === 'state') {
    upsertRuntime({ ...runtime, status: event.status || runtime.status });
    if (event.status === 'error' || (Number.isInteger(event.exitCode) && event.exitCode !== 0)) {
      state.runtime.notice = {
        kind: 'error',
        title: `${runtime.title || runtime.adapterLabel || 'Agent'} 已异常退出`,
        detail: Number.isInteger(event.exitCode) ? `退出码 ${event.exitCode}` : '请查看该实例输出',
        profileId: runtime.workspaceProfileId || runtime.profileId,
        runtimeId: runtime.id,
        action: 'runtime'
      };
      renderAttentionInbox();
    }
    renderRuntimeDock();
    if (event.status === 'ready') void runNextQueuedTask(event.runtimeId);
  }
}

function appendRuntimeOutput(runtimeId, text, stream = 'stdout') {
  const chunks = state.runtime.outputs[runtimeId] || (state.runtime.outputs[runtimeId] = []);
  chunks.push({ text, stream: stream || 'stdout' });
  if (chunks.length > 500) chunks.splice(0, chunks.length - 500);
  if (state.runtime.selectedRuntimeId !== runtimeId) return;
  els.runtimeOutput.querySelector('.runtime-placeholder')?.remove();
  const chunk = document.createElement('span');
  chunk.dataset.stream = stream || 'stdout';
  chunk.textContent = text;
  els.runtimeOutput.append(chunk);
  els.runtimeOutput.scrollTop = els.runtimeOutput.scrollHeight;
}

async function openTerminalForProfile(profile) {
  if (!profile) return;
  if (profile.id !== state.selectedProfileId) await selectProfile(profile.id);
  const matchingAdapter = state.runtime.adapters.find((item) => item.identityAppId === profile.appId && item.available);
  if (matchingAdapter) {
    state.runtime.selectedAdapterId = matchingAdapter.id;
    state.runtime.selectedIdentityId = profile.id;
  }
  const matchingRuntime = [...state.runtime.runtimes]
    .reverse()
    .find((item) => item.workspaceProfileId === profile.id || item.profileId === profile.id);
  if (matchingRuntime) state.runtime.selectedRuntimeId = matchingRuntime.id;
  renderRuntimeDock();
  els.runtimeDock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!state.runtime.adapters.some((item) => item.available)) {
    setStatus('本机没有可用的终端或 Agent CLI，请先查看诊断。');
    return;
  }
  setStatus(`已定位到 ${profile.name} 的 Agent Fleet；可以新建，也可以切换其他实例。`);
  if (!els.runtimeInput.disabled) els.runtimeInput.focus();
  else els.runtimeStartBtn.focus();
}

async function queueSessionForRuntime(profile, session) {
  const preferredId = profile.appId === 'codex' ? 'codex' : profile.appId === 'claude' ? 'claude' : null;
  const agent = state.runtime.adapters.find((item) => item.id === preferredId && item.available)
    || state.runtime.adapters.find((item) => item.mode === 'agent' && item.available);
  if (!agent) {
    window.YardScene?.say(profile.id, { text: '先安装 Agent CLI，喵。', kind: 'warning', duration: 4200 });
    setStatus('任务道需要至少一个可用的 Agent CLI；Shell 不会冒充 Agent 自动执行任务。');
    return;
  }
  if (state.runtime.queue.length >= 20) {
    setStatus('Agent 待办已满（最多 20 条），先处理或清理现有任务。');
    return;
  }

  state.runtime.selectedAdapterId = agent.id;
  state.runtime.selectedIdentityId = agent.identityAppId === profile.appId ? profile.id : null;
  state.runtime.queue.push({
    id: `${profile.id}:${session.id}:${Date.now()}`,
    profileId: profile.id,
    title: session.title,
    text: `${makeHandoffText(profile, session)}\n\n这是从猫猫庭院任务道加入的待办。请先确认你理解当前项目，再继续处理尚未完成的工作。`
  });
  await openTerminalForProfile(profile);
  renderAttentionInbox();

  const ready = [...state.runtime.runtimes]
    .reverse()
    .find((item) => item.mode === 'agent'
      && item.status === 'ready'
      && (item.workspaceProfileId === profile.id || item.profileId === profile.id));
  if (ready) {
    state.runtime.selectedRuntimeId = ready.id;
    renderRuntimeDock();
    await runNextQueuedTask(ready.id);
  } else {
    setStatus(`已把「${session.title}」排队；新建一个 ${agent.label} 实例后会自动发送。`);
  }
}

async function runNextQueuedTask(runtimeId = state.runtime.selectedRuntimeId) {
  if (runtimeQueueSending) return;
  const runtime = state.runtime.runtimes.find((item) => item.id === runtimeId);
  if (!runtime || runtime.mode !== 'agent' || runtime.status !== 'ready') return;
  const index = state.runtime.queue.findIndex((item) =>
    item.profileId === runtime.workspaceProfileId || item.profileId === runtime.profileId);
  if (index < 0) return;

  runtimeQueueSending = true;
  state.runtime.selectedRuntimeId = runtime.id;
  const [task] = state.runtime.queue.splice(index, 1);
  els.runtimeInput.value = task.text;
  renderRuntimeDock();
  renderAttentionInbox();
  const sent = await sendRuntimeInput();
  if (!sent) state.runtime.queue.splice(index, 0, task);
  else setStatus(`「${runtime.title}」开始处理待办：${task.title}。`);
  runtimeQueueSending = false;
  renderRuntimeDock();
  renderAttentionInbox();
}

// ── 统一提醒入口 ─────────────────────────────────────
function collectAttentionItems() {
  const items = [];
  const now = Date.now();
  if (window.YardCats) {
    for (const profile of state.profiles) {
      const activityState = window.YardCats.deriveState(now, profile, state.activity[profile.id]);
      if (activityState === 'confused') {
        items.push({
          kind: 'error',
          title: `${profile.name} 的会话路径需要检查`,
          detail: '打开诊断',
          profileId: profile.id,
          action: 'diagnostics'
        });
      }
      const energy = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotas[profile.id], now)
        : 'unknown';
      if (energy === 'exhausted') {
        items.push({
          kind: 'warning',
          title: `${profile.name} 的可用额度已经很低`,
          detail: '查看额度',
          profileId: profile.id,
          action: 'quota'
        });
      }
    }
  }
  if (state.runtime.notice) items.push(state.runtime.notice);
  if (state.runtime.queue.length) {
    items.push({
      kind: 'info',
      title: `${state.runtime.queue.length} 个任务正在等待 Agent`,
      detail: '打开工作台',
      action: 'runtime'
    });
  }
  if (state.updateInfo?.updateAvailable) {
    items.push({
      kind: 'info',
      title: `AgentDesk v${state.updateInfo.latestVersion} 可以更新`,
      detail: '立即更新',
      action: 'update'
    });
  }
  return items.slice(0, 8);
}

function renderAttentionInbox() {
  if (!els.attentionInbox) return;
  const items = collectAttentionItems();
  els.attentionInbox.hidden = items.length === 0;
  els.attentionCount.textContent = String(items.length);
  els.attentionItems.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attention-item';
    button.dataset.kind = item.kind || 'info';
    const title = document.createElement('b');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = item.detail || '查看';
    button.append(title, detail);
    button.addEventListener('click', async () => {
      if (item.profileId && item.profileId !== state.selectedProfileId) await selectProfile(item.profileId);
      if (item.action === 'diagnostics') await showDiagnostics();
      else if (item.action === 'quota') els.quotaSummary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      else if (item.action === 'runtime') {
        els.runtimeDock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (!els.runtimeInput.disabled) els.runtimeInput.focus();
      } else if (item.action === 'update') await handleUpdateClick();
    });
    els.attentionItems.append(button);
  }
}

function saveYardPosition(profileId, point, zoneId = 'ground') {
  if (!window.YardInteractions) return false;
  const normalized = window.YardInteractions.normalizePoint(point);
  if (!normalized) return false;
  state.yardPositions = {
    ...state.yardPositions,
    [profileId]: { ...normalized, zoneId, updatedAt: Date.now() }
  };
  persistSettings({ yardPositions: state.yardPositions });
  return true;
}

function handleYardDrop({ profile, state: activityState, point, zone }) {
  if (!profile || !window.YardInteractions) return false;
  const zoneId = zone?.id || 'ground';
  const hasSelectedSession = profile.id === state.selectedProfileId && Boolean(selectedSession());
  const intent = window.YardInteractions.resolveDropIntent(zoneId, {
    activityState,
    hasSession: hasSelectedSession,
    terminalSupported: Boolean(window.manager.listTerminalAdapters),
    taskQueueSupported: profile.id === state.selectedProfileId && state.runtime.adapters.some((item) => item.mode === 'agent' && item.available)
  });

  if (intent.action === 'save-position') {
    saveYardPosition(profile.id, point, zoneId);
    window.YardScene.say(profile.id, { text: '这里不错，喵。', kind: 'ambient' });
    setStatus(`已保存 ${profile.name} 在庭院里的位置。`);
    return { keepPosition: true };
  }

  // Semantic drops create an intent. They never execute inside the canvas
  // pointer handler, so animation completion cannot become an unsafe action.
  void executeYardIntent(profile, intent);
  return { keepPosition: false };
}

async function executeYardIntent(profile, initialIntent) {
  await selectProfile(profile.id);
  const activityState = window.YardCats
    ? window.YardCats.deriveState(Date.now(), profile, state.activity[profile.id])
    : 'rest';
  const intent = window.YardInteractions.resolveDropIntent(initialIntent.zoneId, {
    activityState,
    hasSession: Boolean(selectedSession()),
    terminalSupported: Boolean(window.manager.listTerminalAdapters),
    taskQueueSupported: state.runtime.adapters.some((item) => item.mode === 'agent' && item.available)
  });

  if (!intent.enabled) {
    window.YardScene.say(profile.id, { text: intent.title, kind: 'system', duration: 4200 });
    setStatus(intent.title);
    return;
  }
  if (intent.action === 'focus-running') {
    setStatus(`${profile.name} 已经在运行，右侧是它的账号和会话。`);
    return;
  }
  if (intent.action === 'focus-session') {
    document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setStatus(`已打开 ${profile.name} 的当前会话详情。`);
    return;
  }
  if (intent.action === 'launch-profile') {
    if (!window.confirm(`把「${profile.name}」送到工作亭并打开官方 App？`)) return;
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      window.YardScene.say(profile.id, { text: result.reason || '打开失败', kind: 'error', duration: 5000 });
      setStatus(result.reason || '打开失败。');
      return;
    }
    await loadProfiles(profile.id);
    setStatus(result.warning || `已打开 ${profile.name}。`);
    return;
  }
  if (intent.action === 'copy-handoff') {
    const session = selectedSession();
    if (!session) return;
    if (!window.confirm(`把「${session.title}」的交接信息投进邮筒并复制？`)) return;
    await window.manager.writeClipboard(makeHandoffText(profile, session));
    window.YardScene.fx('handoff');
    setStatus(`${profile.name} 已把交接信投进邮筒。`);
    return;
  }
  if (intent.action === 'open-terminal' && typeof openTerminalForProfile === 'function') {
    await openTerminalForProfile(profile);
    return;
  }
  if (intent.action === 'queue-task') {
    const session = selectedSession();
    if (!session) return;
    if (!window.confirm(`把「${session.title}」加入 ${profile.name} 的 Agent 待办？`)) return;
    await queueSessionForRuntime(profile, session);
  }
}

function applyView() {
  const yard = state.view === 'yard' && yardMounted;
  document.body.dataset.view = yard ? 'yard' : 'classic';
  // 统一骨架：账号呈现层随视图切换 —— 庭院视图显示场景，经典视图显示账号名册（CSS 控制显隐）。
  // 新增/编辑/移除按钮固定在控制条（新增紧跟打开账号，编辑/移除在「管理」菜单），两视图共用、不再搬家。
  els.yardStage.hidden = !yard;
  els.viewToggle.textContent = yard ? '⇄ 经典' : '⇄ 庭院';
  els.accountManage.open = false;
  if (yardMounted) window.YardScene.setActive(yard);
  if (yard) loadActivity(); // 切回庭院时立刻刷新猫的状态
  renderTopbarContext();
}

let activityLoading = false;
let busySignature = '';

async function loadActivity() {
  if (activityLoading) return; // 上一轮还没回来就跳过，避免请求堆积
  activityLoading = true;
  try {
    const list = await window.manager.listActivity();
    state.activity = Object.fromEntries(list.map((item) => [item.profileId, item]));
  } catch (_error) {
    state.activity = {};
  } finally {
    activityLoading = false;
  }
  // 并行会话数变化时刷新账号列表徽章（签名不变就不重建 DOM，避免 8 秒一闪）
  const signature = Object.values(state.activity)
    .map((item) => `${item.profileId}:${item.activeNow || 0}`)
    .join('|');
  if (signature !== busySignature) {
    busySignature = signature;
    renderAccounts();
    renderAccountHeader();
  }
  runCompanion();
  syncYard();
}

// 内嵌控制台显隐（默认收起：识别用户自己终端里的会话即可，不必在这里跑）
function applyAgentConsole() {
  if (!els.runtimeDock || !els.consoleToggle) return;
  els.runtimeDock.hidden = !state.agentConsoleOn;
  els.consoleToggle.setAttribute('aria-pressed', String(state.agentConsoleOn));
  els.consoleToggle.textContent = state.agentConsoleOn ? '🖥 控制台 开' : '🖥 控制台 关';
}

// ── 陪伴账本 ─────────────────────────────────────────
function initCompanion() {
  els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
  els.reminderToggle.textContent = state.remindersOn ? '🔔 提醒 开' : '🔕 提醒 关';
  applyAgentConsole();
  if (window.YardCompanion) {
    state.ledger = state.ledger || window.YardCompanion.emptyLedger(Date.now());
  }
  renderLedger();
}

function runCompanion() {
  if (!window.YardCompanion || !window.YardCats) return;
  // 整段包起来：账本出任何岔子都不能连累每次轮询的庭院刷新
  try {
    const now = Date.now();
    const workingIds = state.profiles
      .filter((profile) => window.YardCats.deriveState(now, profile, state.activity[profile.id]) === 'working')
      .map((profile) => profile.id);

    const { ledger, events } = window.YardCompanion.tick(state.ledger, {
      now,
      workingIds,
      remindersOn: state.remindersOn
    });
    state.ledger = ledger;
    persistSettings({ ledger });
    renderLedger();

    for (const event of events) {
      if (event.type === 'clockoff') {
        setStatus(`一只猫收工了 —— 今日完成 +1（这轮陪你干了 ${event.minutes} 分钟）。`);
      } else if (event.type === 'stretch') {
        setStatus(`已经陪你干了 ${event.minutes} 分钟，要不要一起伸个懒腰？ ☕`);
        if (isYardView()) window.YardScene.fx('stretch');
      }
    }
  } catch (_error) {
    // 账本坏了就从零重建，别卡住庭院
    state.ledger = window.YardCompanion.emptyLedger(Date.now());
  }
}

function renderLedger() {
  if (!state.ledger) return;
  els.ledgerDone.textContent = String(state.ledger.completed);
  els.ledgerMin.textContent = String(Math.round(state.ledger.workedMs / 60000));
}

function syncYard() {
  if (yardMounted) {
    const now = Date.now();
    const groups = identityGroups();
    const statesById = {};
    const energyById = {};
    const attentionById = {};
    // 一只猫 = 一个账号（组）：状态吃组内所有形态的聚合活跃，
    // 任一形态在干活猫就在打字；额度取组内有真实快照的那个槽位。
    for (const group of groups) {
      const primary = group.primary;
      const merged = window.IdentityGroups
        ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
        : state.activity[primary.id];
      statesById[primary.id] = window.YardCats.deriveState(now, primary, merged);
      const snapshot = group.members
        .map((member) => state.quotas[member.id])
        .find((quota) => quota && quota.status === 'ok') || state.quotas[primary.id];
      energyById[primary.id] = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotaError ? null : snapshot, now)
        : 'unknown';
      const broken = group.members.find(
        (member) => window.YardCats.deriveState(now, member, state.activity[member.id]) === 'confused'
      );
      if (broken) {
        attentionById[primary.id] = { kind: 'error', text: `${broken.name} 的会话路径需要检查` };
      } else if (group.members.some((member) => member.id === state.selectedProfileId) && energyById[primary.id] === 'exhausted') {
        attentionById[primary.id] = { kind: 'warning', text: '额度快用完了' };
      }
    }
    const selectedGroup = groupOfProfile(state.selectedProfileId);
    window.YardScene.update({
      profiles: groups.map((group) => group.primary),
      statesById,
      energyById,
      positionsById: state.yardPositions,
      attentionById,
      selectedId: selectedGroup ? selectedGroup.primary.id : state.selectedProfileId,
      night: document.documentElement.dataset.theme === 'dark'
    });
  }
  renderAccountRoster();
  renderTopbarContext();
  renderAttentionInbox();
  // 排行榜打开时随轮询实时刷新
  if (els.leaderboardDialog.open) renderLeaderboard();
}

// 工作量排行榜：各账号（组）今日活跃/新建场次 + 实时干活状态，算分排序
function renderLeaderboard() {
  if (!window.YardWorkload || !window.YardCats || !window.YardSprites) return;
  const now = Date.now();
  const rows = identityGroups().map((group) => {
    const primary = group.primary;
    const act = (window.IdentityGroups
      ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
      : state.activity[primary.id]) || {};
    return {
      name: primary.name,
      appId: primary.appId,
      cat: primary.cat,
      isProtected: primary.isProtected,
      activeToday: act.activeToday || 0,
      createdToday: act.createdToday || 0,
      working: window.YardCats.deriveState(now, primary, act) === 'working'
    };
  });
  const ranked = window.YardWorkload.rankAccounts(rows);
  els.leaderboardBody.replaceChildren();
  if (!ranked.length) {
    els.leaderboardBody.textContent = '还没有账号。';
    return;
  }
  ranked.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = `lb-row${i === 0 && row.score > 0 ? ' lb-top' : ''}${row.working ? ' lb-working' : ''}`;

    const rank = document.createElement('div');
    rank.className = 'lb-rank';
    rank.textContent = (i === 0 && row.score > 0) ? '👑' : String(i + 1);

    const avatar = document.createElement('canvas');
    avatar.width = 36; avatar.height = 36; avatar.className = 'lb-avatar';
    const c2 = avatar.getContext('2d');
    c2.imageSmoothingEnabled = false;
    const S = window.YardSprites;
    const pal = S.BREEDS[row.cat && row.cat.breed] || S.BREEDS.orange;
    S.drawCat(c2, S.SIT, pal, {
      dx: 2, dy: 2, scale: 2, seed: 5,
      collar: row.cat && row.cat.collar,
      bell: row.isProtected,
      tag: row.isProtected ? null : row.appId,
      accessory: (row.cat && row.cat.accessory !== 'none') ? row.cat.accessory : null
    });

    const who = document.createElement('div');
    who.className = 'lb-who';
    const name = document.createElement('b');
    name.textContent = row.name + (row.working ? ' 🔥' : '');
    const sub = document.createElement('small');
    sub.textContent = `${appLabel(row.appId)} · 今日活跃 ${row.activeToday} · 新建 ${row.createdToday}`;
    who.append(name, sub);

    const score = document.createElement('div');
    score.className = 'lb-score';
    score.textContent = String(row.score);

    el.append(rank, avatar, who, score);
    els.leaderboardBody.append(el);
  });
}

// 账号名册（经典视图的账号呈现层）：一个卡片 = 一个账号（身份组），带真像素猫头像、
// 名称、分组、活跃状态。与庭院的猫是同一批账号的两种呈现（庭院靠 syncYard 喂场景）。
const CARD_STATE_DOT = {
  working: '#6d9440', onduty: '#3d6aa8', arriving: '#e0a63a', confused: '#c94f2e',
  play: '#d05a7a', rest: '#9a8b6a', nap: '#8a7fa8', hibernate: '#6a6a8a'
};

function renderAccounts() {
  renderAccountRoster();
  populateGroupDatalist();
  syncYard();
}

function renderAccountRoster() {
  if (!els.accountRoster) return;
  els.accountRoster.replaceChildren();
  const now = Date.now();
  for (const group of identityGroups()) {
    els.accountRoster.append(buildAccountCard(group, now));
  }
}

function buildAccountCard(group, now) {
  const primary = group.primary;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'account-card';
  card.classList.toggle('selected', group.members.some((member) => member.id === state.selectedProfileId));

  const merged = window.IdentityGroups
    ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
    : state.activity[primary.id];
  const activityState = window.YardCats ? window.YardCats.deriveState(now, primary, merged) : 'rest';
  const stateLabel = window.YardCats?.STATE_META?.[activityState]?.label || activityState;

  const top = document.createElement('div');
  top.className = 'account-card-top';
  const avatar = document.createElement('canvas');
  avatar.className = 'account-card-avatar';
  avatar.width = 52;
  avatar.height = 48;
  drawAccountAvatar(avatar, primary);
  const meta = document.createElement('div');
  meta.className = 'account-card-meta';
  const name = document.createElement('div');
  name.className = 'account-card-name';
  name.textContent = primary.name;
  const activeNow = group.members.reduce((acc, member) => acc + (state.activity[member.id]?.activeNow || 0), 0);
  if (activeNow > 0) {
    const busy = document.createElement('span');
    busy.className = 'account-card-busy';
    busy.textContent = ` ⌨${activeNow}`;
    busy.title = `${activeNow} 个会话正在进行`;
    name.append(busy);
  }
  if (group.members.length > 1) {
    const link = document.createElement('span');
    link.className = 'account-card-link';
    link.textContent = ' ⛓';
    link.title = `一个账号 ${group.members.length} 个形态`;
    name.append(link);
  }
  const gp = document.createElement('div');
  gp.className = 'account-card-group';
  gp.textContent = primary.group ? `分组 · ${primary.group}` : appLabel(primary.appId);
  meta.append(name, gp);
  top.append(avatar, meta);

  const st = document.createElement('div');
  st.className = 'account-card-state';
  const dot = document.createElement('span');
  dot.className = 'account-card-dot';
  dot.style.background = CARD_STATE_DOT[activityState] || '#9a9a9a';
  st.append(dot, document.createTextNode(`${stateLabel} · ${appLabel(primary.appId)}`));

  // 原型 qbar：卡片底部额度条（组内取有官方额度快照的成员；未知则空条）
  const quotaTrack = document.createElement('div');
  quotaTrack.className = 'account-card-quota';
  const quotaFill = document.createElement('i');
  quotaTrack.append(quotaFill);
  const holder = group.members.find((member) => state.quotas[member.id]?.status === 'ok');
  const tightest = holder && window.QuotaOverview
    ? window.QuotaOverview.tightestWindow(state.quotas[holder.id], now)
    : null;
  if (tightest) {
    const percent = Math.max(0, Math.min(100, Math.round(tightest.remainingPercent)));
    quotaTrack.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    quotaFill.style.width = `${percent}%`;
    quotaTrack.title = `${tightest.label} 剩 ${percent}%`;
  } else {
    quotaTrack.dataset.level = 'unknown';
    quotaFill.style.width = '0%';
    quotaTrack.title = '暂无额度数据';
  }

  card.append(top, st, quotaTrack);
  card.addEventListener('click', () => selectProfile(primary.id));
  return card;
}

function drawAccountAvatar(canvas, profile) {
  const S = window.YardSprites;
  if (!S) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  try {
    const pal = S.BREEDS[profile.cat && profile.cat.breed] || S.BREEDS.orange;
    S.drawCat(ctx, S.SIT, pal, {
      dx: 11, dy: 9, scale: 2, seed: 0,
      collar: profile.cat && profile.cat.collar,
      bell: profile.isProtected,
      tag: profile.isProtected ? null : profile.appId,
      flip: false
    });
  } catch (_error) { /* best effort：头像画不出不影响卡片 */ }
}

function renderTopbarContext() {
  if (!els.topbarContext) return;
  const profile = selectedProfile();
  if (!profile) {
    els.topbarContext.textContent = state.view === 'yard' ? '猫猫庭院 · 尚未选择账号' : '经典工作台 · 尚未选择账号';
    return;
  }
  const activityState = window.YardCats
    ? window.YardCats.deriveState(Date.now(), profile, state.activity[profile.id])
    : 'rest';
  const label = window.YardCats?.STATE_META?.[activityState]?.label || activityState;
  els.topbarContext.textContent = `${state.view === 'yard' ? '猫猫庭院' : '经典工作台'} · ${profile.name} · ${label}`;
}

// （旧侧栏行渲染器 appendAccountRow 已随侧栏移除，账号呈现改为 renderAccountRoster 卡片）

// 账号身份分组：同一登录账号的多个槽位归为一组（identityKey 或指纹关联）。
// 庭院一只猫 = 一个账号组；会话与额度也按组聚合。
function identityGroups() {
  if (!window.IdentityGroups) return state.profiles.map((profile) => ({ key: profile.id, primary: profile, members: [profile] }));
  return window.IdentityGroups.groupProfilesByIdentity(state.profiles);
}

function groupOfProfile(profileId) {
  if (!profileId) return null;
  return identityGroups().find((group) => group.members.some((member) => member.id === profileId)) || null;
}

function populateIdentityDatalist() {
  const datalist = document.querySelector('#identityOptions');
  if (!datalist) return;
  datalist.replaceChildren();
  const keys = [...new Set(state.profiles.map((item) => item.identityKey).filter(Boolean))];
  for (const key of keys) {
    const option = document.createElement('option');
    option.value = key;
    datalist.append(option);
  }
}

async function selectProfile(profileId) {
  state.selectedProfileId = profileId;
  state.query = '';
  els.searchInput.value = '';
  renderAccounts();
  renderAccountHeader();
  await loadSessions(true);
  await loadRuntimeAdapters();
  renderAttentionInbox();
}

function populateGroupDatalist() {
  const groups = [...new Set(state.profiles.map((profile) => profile.group).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  els.groupOptions.replaceChildren();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group;
    els.groupOptions.append(option);
  }
}

function renderAccountHeader() {
  const profile = selectedProfile();
  const disabled = !profile;

  const canLaunch = !profile || state.appMeta[profile.appId]?.canLaunch !== false;
  els.launchBtn.disabled = disabled || !canLaunch;
  els.launchBtn.title = canLaunch
    ? ''
    : '这个客户端在你自己的终端里运行；AgentDesk 负责识别和索引它的会话。';
  els.pathConfigBtn.disabled = disabled;
  els.diagnosticsBtn.disabled = disabled;
  els.profileFolderBtn.disabled = disabled;
  els.refreshBtn.disabled = disabled;
  els.editProfileBtn.disabled = disabled;
  els.removeProfileBtn.disabled = disabled || profile?.isProtected;

  if (!profile) {
    els.accountTitle.textContent = '未选择账号';
    if (els.accountBadge) els.accountBadge.hidden = true;
    if (els.accountId) els.accountId.title = '';
    els.accountMeta.textContent = '';
    els.accountPath.textContent = '';
    els.accountNote.textContent = '';
    els.accountNote.style.display = 'none';
    renderQuotaSummary();
    renderTopbarContext();
    return;
  }

  // 名牌（原型）：`名字 · App`；徽章 = ⌨并行 / ⛓形态 / ⚡能量；
  // 长信息（槽位/分组/上次打开/路径/备注）收进名牌 tooltip，不再占控制条版面。
  els.accountTitle.textContent = `${profile.name} · ${appLabel(profile.appId)}`;
  const groupLabel = profile.group && profile.group !== appLabel(profile.appId) ? ` · ${profile.group}` : '';
  const identityGroup = groupOfProfile(profile.id);
  const members = identityGroup ? identityGroup.members : [profile];
  // 并行会话数按整个账号（组）聚合：桌面在跑 + 终端在跑 = 一起数
  const activeNow = members.reduce((acc, member) => acc + (state.activity[member.id]?.activeNow || 0), 0);
  const badgeParts = [];
  if (activeNow > 0) badgeParts.push(`⌨ ${activeNow} 并行`);
  if (members.length > 1) badgeParts.push(`⛓ ${members.length} 形态`);
  const quotaSnapshot = selectedQuota();
  if (quotaSnapshot?.status === 'ok' && window.YardEnergy) {
    const energyMeta = window.YardEnergy.ENERGY_META?.[window.YardEnergy.deriveEnergy(quotaSnapshot, Date.now())];
    if (energyMeta) badgeParts.push(`⚡ ${energyMeta.label}`);
  }
  if (els.accountBadge) {
    els.accountBadge.textContent = badgeParts.join(' · ');
    els.accountBadge.hidden = badgeParts.length === 0;
  }

  const metaLine = `${appLabel(profile.appId)} · ${profile.isProtected ? '默认槽位' : '独立槽位'}${groupLabel} · 上次打开 ${compactDate(profile.lastLaunchedAt)}`;
  const pathLine = `账号 ${shortPath(profile.profilePath)} · 会话 ${shortPath(profile.sessionRoot)}`;
  if (els.accountId) {
    els.accountId.title = [metaLine, pathLine, profile.note ? `备注 ${profile.note}` : ''].filter(Boolean).join('\n');
  }
  // 隐藏源（.account-legacy）：保留旧字段写入，作为 tooltip 之外的读取兜底
  els.accountMeta.textContent = metaLine;
  els.accountPath.textContent = pathLine;
  els.accountNote.textContent = profile.note || '';
  els.accountNote.style.display = profile.note ? '' : 'none';
  renderQuotaSummary();
  renderTopbarContext();
}

function renderSessions() {
  els.sessionRows.replaceChildren();
  els.sessionCount.textContent = `${state.filteredSessions.length} 个`;

  if (!state.filteredSessions.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = state.sessions.length
      ? '没有匹配的会话，换个关键词试试。'
      : '这个账号还没有会话。点「打开账号」登录官方 App，用过之后会话会自动出现在这里；读不到时可点「诊断」。';
    row.append(cell);
    els.sessionRows.append(row);
    return;
  }

  for (const session of state.filteredSessions) {
    const row = document.createElement('tr');
    row.className = session.id === state.selectedSessionId ? 'selected' : '';
    row.innerHTML = `
      <td class="title-cell"></td>
      <td></td>
      <td></td>
      <td class="mono path-cell"></td>
      <td></td>
    `;
    row.children[0].textContent = session.title;
    row.children[1].textContent = compactDate(session.updatedAt);
    row.children[2].textContent = compactDate(session.createdAt);
    row.children[3].textContent = session.projectPath ? shortPath(session.projectPath) : '-';
    row.children[4].textContent = session.source;
    row.addEventListener('click', () => {
      state.selectedSessionId = session.id;
      renderSessions();
      renderInspector();
      renderRuntimeDock();
    });
    els.sessionRows.append(row);
  }
}

function renderInspector() {
  const session = selectedSession();
  const disabled = !session;
  els.copySummaryBtn.disabled = disabled;
  els.copyAddressBtn.disabled = disabled;
  els.copyProjectBtn.disabled = disabled || !session?.projectPath;
  els.openSessionFileBtn.disabled = disabled;
  // 导出能力按客户端注册表声明（目前 Kimi Code 支持）
  const canExport = Boolean(session && state.appMeta[session.appId]?.canExportTranscript);
  els.exportSessionBtn.disabled = !canExport;
  els.exportSessionBtn.title = canExport
    ? '把这段对话导出成 Markdown 文件'
    : (session ? '这个客户端的会话暂不支持导出 Markdown' : '');

  if (!session) {
    setDetail(els.detailTitle, '未选择', { keep: true });
    for (const dd of [els.detailId, els.detailCreated, els.detailUpdated, els.detailSource, els.detailProject, els.detailFile, els.detailAddress]) {
      setDetail(dd, '');
    }
    return;
  }

  setDetail(els.detailTitle, session.title, { keep: true });
  setDetail(els.detailId, session.id);
  setDetail(els.detailCreated, fullDate(session.createdAt));
  setDetail(els.detailUpdated, fullDate(session.updatedAt));
  setDetail(els.detailSource, [session.source, session.status, session.model].filter(Boolean).join(' · '));
  setDetail(els.detailProject, session.projectPath ? shortPath(session.projectPath) : '');
  setDetail(els.detailFile, shortPath(session.filePath));
  setDetail(els.detailAddress, shortPath(session.address || session.id));
}

// 会话详情：空字段连同标签一起折叠，详情栏更紧凑（keep=true 的字段始终保留）
function setDetail(dd, value, { keep = false } = {}) {
  const empty = !keep && (!value || value === '-' || value === '未记录');
  dd.textContent = value || '-';
  dd.hidden = empty;
  const dt = dd.previousElementSibling;
  if (dt && dt.tagName === 'DT') dt.hidden = empty;
}

async function showDiagnostics() {
  const profile = selectedProfile();
  if (!profile) return;
  lastDiagnostics = await window.manager.getDiagnostics(profile);
  renderDiagnostics(lastDiagnostics);
  els.diagnosticsDialog.showModal();
}

function renderDiagnostics(diagnostics) {
  els.diagnosticsBody.replaceChildren();
  if (!diagnostics) return;

  const summary = document.createElement('div');
  summary.className = 'diagnostics-summary';
  summary.append(
    diagnosticBadge(diagnostics.executable.launchable ? 'ok' : 'warn', diagnostics.executable.launchable ? 'App 可启动' : 'App 未找到'),
    diagnosticBadge(diagnostics.profilePath.exists ? 'ok' : 'warn', diagnostics.profilePath.exists ? '账号目录存在' : '账号目录未创建'),
    diagnosticBadge(diagnostics.sessionRoot.exists && diagnostics.sessionRoot.readable ? 'ok' : 'warn', diagnostics.sessionRoot.exists ? '会话目录可读' : '会话目录不存在'),
    diagnosticBadge(diagnostics.sessionCount > 0 ? 'ok' : 'warn', `${diagnostics.sessionCount} 个会话`)
  );
  els.diagnosticsBody.append(summary);

  if (diagnostics.warnings.length) {
    const warningList = document.createElement('ul');
    warningList.className = 'diagnostics-warnings';
    diagnostics.warnings.forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    });
    els.diagnosticsBody.append(warningList);
  }

  if (diagnostics.migration?.needed) {
    const repair = document.createElement('div');
    repair.className = 'diagnostics-repair';
    const text = document.createElement('span');
    text.textContent = `建议迁移到 ${diagnostics.migration.recommendedPath}。迁移会复制登录态和会话数据，旧目录保留为备份。`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = '一键迁移 Windows 路径';
    button.addEventListener('click', async () => {
      const profile = selectedProfile();
      if (!profile) return;
      if (!window.confirm(`请先完全关闭「${profile.name}」对应的官方 App。确认已经关闭并开始复制迁移？`)) {
        return;
      }
      button.disabled = true;
      button.textContent = '迁移中…';
      setStatus('正在迁移账号数据，请先不要打开官方 App。');
      const result = await window.manager.migrateWindowsProfilePath(profile.id);
      if (!result.ok) {
        button.disabled = false;
        button.textContent = '一键迁移 Windows 路径';
        setStatus(result.reason || '路径迁移失败。');
        return;
      }
      await loadProfiles(profile.id);
      lastDiagnostics = await window.manager.getDiagnostics(selectedProfile());
      renderDiagnostics(lastDiagnostics);
      setStatus(result.message || 'Windows 路径迁移完成。');
    });
    repair.append(text, button);
    els.diagnosticsBody.append(repair);
  }

  const table = document.createElement('table');
  table.className = 'diagnostics-table';
  const tbody = document.createElement('tbody');
  [
    ['平台', [diagnostics.platform, diagnostics.arch, diagnostics.osRelease].filter(Boolean).join(' · ')],
    ['官方 App', diagnostics.executable.path || '未找到'],
    ['启动方式', diagnostics.executable.source || (diagnostics.executable.protocolUsable ? 'Windows 协议（仅自动默认账号）' : '未找到')],
    ['手动路径', diagnostics.executable.configuredPath
      ? `${diagnostics.executable.configuredPath}${diagnostics.executable.explicitMissing ? '（已失效）' : ''}`
      : '未设置'],
    ['账号目录', diagnostics.profilePath.path],
    ['会话根目录', diagnostics.sessionRoot.path],
    ['系统默认目录', `${diagnostics.defaultProfile.source} · ${diagnostics.defaultProfile.path}`],
    ['配置文件', diagnostics.storeFile]
  ].forEach(([label, value]) => appendDiagnosticRow(tbody, label, value));
  const executableCandidates = diagnostics.executable.candidateDetails || [];
  if (executableCandidates.length) {
    appendDiagnosticRow(
      tbody,
      '启动候选',
      executableCandidates.map((item) => `${item.exists ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  if (diagnostics.executable.discoveryChannels?.length) {
    appendDiagnosticRow(
      tbody,
      'Windows 发现通道',
      diagnostics.executable.discoveryChannels
        .map((item) => `${item.source}：${item.count} 个候选`)
        .join('\n')
    );
  }
  if (diagnostics.defaultProfile?.candidates?.length) {
    appendDiagnosticRow(
      tbody,
      '数据目录候选',
      diagnostics.defaultProfile.candidates.map((item) => `${item.score >= 0 ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  diagnostics.sessionAreas.forEach((area) => {
    appendDiagnosticRow(tbody, area.label, `${area.exists ? '存在' : '不存在'} · ${area.path}`);
  });
  table.append(tbody);
  els.diagnosticsBody.append(table);
}

function diagnosticBadge(kind, text) {
  const badge = document.createElement('span');
  badge.className = `diagnostic-badge ${kind}`;
  badge.textContent = text;
  return badge;
}

function appendDiagnosticRow(tbody, label, value) {
  const row = document.createElement('tr');
  const key = document.createElement('th');
  const val = document.createElement('td');
  key.textContent = label;
  val.textContent = value || '-';
  row.append(key, val);
  tbody.append(row);
}

function formatDiagnosticsText(diagnostics) {
  const lines = [
    'AgentDesk 诊断',
    '',
    `平台：${diagnostics.platform}`,
    `系统：${diagnostics.arch || '-'} · ${diagnostics.osRelease || '-'}`,
    `应用：${diagnostics.appName}`,
    `官方 App：${diagnostics.executable.path || '未找到'}`,
    `启动方式：${diagnostics.executable.source || (diagnostics.executable.protocolUsable ? 'Windows 协议（仅自动默认账号）' : '未找到')}`,
    `手动路径：${diagnostics.executable.configuredPath || '未设置'}${diagnostics.executable.explicitMissing ? '（已失效）' : ''}`,
    `账号目录：${diagnostics.profilePath.path}`,
    `会话根目录：${diagnostics.sessionRoot.path}`,
    `会话数量：${diagnostics.sessionCount}`,
    `配置文件：${diagnostics.storeFile}`
  ];

  if (diagnostics.warnings.length) {
    lines.push('', '警告：', ...diagnostics.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('', '扫描位置：');
  diagnostics.sessionAreas.forEach((area) => {
    lines.push(`- ${area.label}: ${area.exists ? '存在' : '不存在'} · ${area.path}`);
  });

  lines.push('', '启动候选：');
  (diagnostics.executable.candidateDetails || []).forEach((item) => {
    lines.push(`- ${item.exists ? '可用' : '不可用'} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.executable.discoveryChannels?.length) {
    lines.push('', 'Windows 发现通道：');
    diagnostics.executable.discoveryChannels.forEach((item) => {
      lines.push(`- ${item.source}: ${item.count} 个候选`);
    });
  }

  lines.push('', '数据目录候选：');
  (diagnostics.defaultProfile?.candidates || []).forEach((item) => {
    lines.push(`- ${item.score >= 0 ? '存在' : '不存在'} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.migration?.needed) {
    lines.push('', `建议迁移：${diagnostics.migration.recommendedPath}`);
  }

  return lines.join('\n');
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedProfileId) || null;
}

function selectedSession() {
  return state.filteredSessions.find((session) => session.id === state.selectedSessionId) || null;
}

function makeHandoffText(profile, session) {
  const appName = appLabel(profile.appId);
  return [
    '请帮我继续理解这个会话：',
    '',
    `应用：${appName}`,
    `账号槽位：${profile.name}`,
    `标题：${session.title}`,
    `新建时间：${fullDate(session.createdAt)}`,
    `最后活跃：${fullDate(session.updatedAt)}`,
    `来源：${session.source}`,
    `状态：${session.status}`,
    `项目目录：${session.projectPath || '未记录'}`,
    `会话标识：${session.address || session.id}`,
    `会话文件：${session.filePath}`,
    `线程 ID：${session.id}`,
    '',
    '请基于这些信息判断这个会话在做什么，并继续处理。'
  ].join('\n');
}

function compactDate(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = date.toDateString() === now.toDateString();
  const options = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : sameYear
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function fullDate(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function shortPath(value) {
  if (!value) return '-';
  return String(value).replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~');
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message) {
  els.statusBar.textContent = message;
}
