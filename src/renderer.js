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
  ledger: null,
  remindersOn: true,
  atmosTime: 'auto',
  atmosWeather: 'auto',
  yardPositions: {},
  runtime: {
    adapters: [],
    selectedAdapterId: null,
    current: null,
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
      state.appMeta = Object.fromEntries(list.map((a) => [a.id, { label: a.label, tagColor: a.tagColor }]));
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
  accountList: document.querySelector('#accountList'),
  yardAccountStrip: document.querySelector('#yardAccountStrip'),
  topbarContext: document.querySelector('#topbarContext'),
  yardStage: document.querySelector('#yardStage'),
  yardCanvas: document.querySelector('#yardCanvas'),
  yardOverlay: document.querySelector('#yardOverlay'),
  viewToggle: document.querySelector('#viewToggle'),
  accountActions: document.querySelector('#accountActions'),
  accountManage: document.querySelector('#accountManage'),
  yardManageActions: document.querySelector('#yardManageActions'),
  sidebarActions: document.querySelector('#sidebarActions'),
  ledgerDone: document.querySelector('#ledgerDone'),
  ledgerMin: document.querySelector('#ledgerMin'),
  reminderToggle: document.querySelector('#reminderToggle'),
  atmosTime: document.querySelector('#atmosTime'),
  atmosWeather: document.querySelector('#atmosWeather'),
  runtimeDock: document.querySelector('#runtimeDock'),
  runtimeStatus: document.querySelector('#runtimeStatus'),
  runtimeAdapter: document.querySelector('#runtimeAdapter'),
  runtimeCwd: document.querySelector('#runtimeCwd'),
  runtimeStartBtn: document.querySelector('#runtimeStartBtn'),
  runtimeStopBtn: document.querySelector('#runtimeStopBtn'),
  runtimeOutput: document.querySelector('#runtimeOutput'),
  runtimeForm: document.querySelector('#runtimeForm'),
  runtimeInput: document.querySelector('#runtimeInput'),
  runtimeSendBtn: document.querySelector('#runtimeSendBtn'),
  runtimeHint: document.querySelector('#runtimeHint'),
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
  profileDialog: document.querySelector('#profileDialog'),
  newProfileApp: document.querySelector('#newProfileApp'),
  newProfileName: document.querySelector('#newProfileName'),
  newProfileGroup: document.querySelector('#newProfileGroup'),
  newProfileNote: document.querySelector('#newProfileNote'),
  confirmAddProfileBtn: document.querySelector('#confirmAddProfileBtn'),
  editDialog: document.querySelector('#editDialog'),
  editName: document.querySelector('#editName'),
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
    els.editNote.value = profile.note || '';
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

  els.helpBtn.addEventListener('click', () => {
    els.welcomeDialog.showModal();
  });

  els.runtimeAdapter.addEventListener('change', () => {
    state.runtime.selectedAdapterId = els.runtimeAdapter.value || null;
    renderRuntimeDock();
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
    await window.manager.writeClipboard(makeHandoffText(profile, session));
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
    const result = await window.manager.revealSession({
      profileId: profile.id,
      sessionId: session.id,
      filePath: session.filePath
    });
    setStatus(result.message || result.reason || (result.ok ? '已打开会话位置。' : '无法打开会话位置。'));
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
  state.sessions = profile ? await window.manager.listSessions(profile) : [];
  applySessionFilter(selectFirst);
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
      renderQuotaSummary();
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
  const profile = selectedProfile();
  els.quotaSummary.hidden = !profile;
  els.quotaRefreshBtn.disabled = !profile || Boolean(quotaRequest);
  if (!profile) return;

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
  initAtmosphere();
}

// 时间 / 天气控件：从稳定设置恢复，点击切换并持久化
function initAtmosphere() {
  const TIME_LABEL = { auto: '跟随主题', day: '白天', dusk: '黄昏', night: '夜晚' };
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

// ── 内嵌 Agent / 终端 ────────────────────────────────
// Pipe-mode MVP: the main process owns executable discovery, argv, env and
// cwd. The renderer only selects a registered adapter and sends user text.
const pendingRuntimeEvents = [];
let runtimeQueueSending = false;

function runtimeIsActive(runtime = state.runtime.current) {
  return Boolean(runtime && ['starting', 'running', 'ready'].includes(runtime.status));
}

async function loadRuntimeAdapters() {
  const profile = selectedProfile();
  if (!profile || !window.manager.listTerminalAdapters) {
    state.runtime.adapters = [];
    state.runtime.selectedAdapterId = null;
    renderRuntimeDock();
    return;
  }
  try {
    const list = await window.manager.listTerminalAdapters(profile.id);
    state.runtime.adapters = Array.isArray(list) ? list : [];
    const currentSelection = state.runtime.selectedAdapterId;
    const selectedStillExists = state.runtime.adapters.some((item) => item.id === currentSelection);
    state.runtime.selectedAdapterId = selectedStillExists
      ? currentSelection
      : (state.runtime.adapters.find((item) => item.available)?.id || state.runtime.adapters[0]?.id || null);
  } catch (error) {
    state.runtime.adapters = [];
    state.runtime.selectedAdapterId = null;
    state.runtime.notice = {
      kind: 'error',
      title: '运行环境发现失败',
      detail: error?.message || '无法读取本机 CLI',
      action: 'runtime'
    };
  }
  renderRuntimeDock();
}

function renderRuntimeDock() {
  if (!els.runtimeDock) return;
  const profile = selectedProfile();
  const runtime = state.runtime.current;
  const active = runtimeIsActive(runtime);
  const previous = els.runtimeAdapter.value;
  els.runtimeAdapter.replaceChildren();

  if (!profile) {
    const option = document.createElement('option');
    option.textContent = '先选择账号';
    option.disabled = true;
    option.selected = true;
    els.runtimeAdapter.append(option);
  } else if (!state.runtime.adapters.length) {
    const option = document.createElement('option');
    option.textContent = '没有可用运行方式';
    option.disabled = true;
    option.selected = true;
    els.runtimeAdapter.append(option);
  } else {
    for (const adapter of state.runtime.adapters) {
      const option = document.createElement('option');
      option.value = adapter.id;
      option.disabled = !adapter.available;
      option.textContent = `${adapter.label}${adapter.available ? '' : '（未安装）'}`;
      els.runtimeAdapter.append(option);
    }
    const desired = active && runtime.profileId === profile.id
      ? runtime.adapterId
      : (state.runtime.selectedAdapterId || previous);
    if (state.runtime.adapters.some((item) => item.id === desired)) els.runtimeAdapter.value = desired;
  }

  const selectedAdapter = state.runtime.adapters.find((item) => item.id === els.runtimeAdapter.value)
    || state.runtime.adapters.find((item) => item.id === state.runtime.selectedAdapterId)
    || null;
  if (selectedAdapter) state.runtime.selectedAdapterId = selectedAdapter.id;

  const status = runtime?.status || 'idle';
  const statusLabels = {
    idle: '未开启',
    starting: '启动中',
    running: runtime?.mode === 'agent' ? '处理中' : '运行中',
    ready: '可输入',
    error: '出错',
    exited: '已退出',
    stopped: '已停止'
  };
  els.runtimeStatus.dataset.status = status;
  els.runtimeStatus.textContent = statusLabels[status] || status;

  const session = selectedSession();
  const expectedCwd = session?.projectPath || profile?.sessionRoot || profile?.profilePath || '';
  els.runtimeCwd.textContent = runtime?.cwd ? shortPath(runtime.cwd) : shortPath(expectedCwd);
  els.runtimeCwd.title = runtime?.cwd || expectedCwd || '';

  const canSend = Boolean(runtime && (
    (runtime.mode === 'shell' && runtime.status === 'running') ||
    (runtime.mode === 'agent' && runtime.status === 'ready')
  ));
  els.runtimeAdapter.disabled = active || !profile || !state.runtime.adapters.length;
  els.runtimeStartBtn.disabled = active || !profile || !selectedAdapter?.available;
  els.runtimeStartBtn.textContent = runtime && !active ? '重新开启' : '开启';
  els.runtimeStopBtn.disabled = !active;
  els.runtimeInput.disabled = !canSend;
  els.runtimeSendBtn.disabled = !canSend;
  els.runtimeInput.placeholder = runtime?.mode === 'shell'
    ? '输入一行本机命令；Enter 执行，Shift+Enter 换行…'
    : '对 Agent 说话；Enter 发送，Shift+Enter 换行…';

  const activeProfile = runtime ? state.profiles.find((item) => item.id === runtime.profileId) : null;
  if (active && runtime.profileId !== profile?.id) {
    els.runtimeHint.textContent = `当前仍属于「${activeProfile?.name || '另一个账号'}」；停止后才能切到此账号。`;
  } else if (selectedAdapter) {
    const queueHint = state.runtime.queue.length ? `待办 ${state.runtime.queue.length}` : '';
    els.runtimeHint.textContent = [selectedAdapter.detail, selectedAdapter.caution, queueHint].filter(Boolean).join(' · ');
  } else {
    els.runtimeHint.textContent = '不使用远程网页；运行环境由本机 CLI 提供。';
  }
}

async function startRuntimeForSelectedProfile() {
  const profile = selectedProfile();
  const adapterId = state.runtime.selectedAdapterId;
  if (!profile || !adapterId || !window.manager.startTerminal) return;
  if (runtimeIsActive()) {
    setStatus('先停止当前内嵌运行环境，再开启新的账号。');
    return;
  }

  els.runtimeStartBtn.disabled = true;
  els.runtimeStatus.dataset.status = 'starting';
  els.runtimeStatus.textContent = '等待确认';
  const result = await window.manager.startTerminal({
    profileId: profile.id,
    adapterId,
    sessionId: selectedSession()?.id || null
  });
  if (!result?.ok) {
    renderRuntimeDock();
    if (!result?.cancelled) {
      state.runtime.notice = {
        kind: 'error',
        title: '内嵌运行环境无法开启',
        detail: result?.reason || '启动失败',
        profileId: profile.id,
        action: 'runtime'
      };
      setStatus(result?.reason || '内嵌运行环境启动失败。');
      renderAttentionInbox();
    } else {
      setStatus('已取消开启内嵌终端。');
    }
    return;
  }

  state.runtime.current = result;
  state.runtime.notice = null;
  els.runtimeOutput.replaceChildren();
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
  setStatus(`已开启 ${result.adapterLabel}，工作目录：${shortPath(result.cwd)}。`);
  if (!els.runtimeInput.disabled) els.runtimeInput.focus();
}

async function sendRuntimeInput() {
  const runtime = state.runtime.current;
  const text = els.runtimeInput.value.trim();
  if (!runtime || !text || !window.manager.sendTerminal) return false;
  els.runtimeInput.disabled = true;
  els.runtimeSendBtn.disabled = true;
  const result = await window.manager.sendTerminal({
    profileId: runtime.profileId,
    runtimeId: runtime.id,
    text
  });
  if (!result?.ok) {
    state.runtime.notice = {
      kind: 'error',
      title: '发送失败',
      detail: result?.reason || '运行环境没有响应',
      profileId: runtime.profileId,
      action: 'runtime'
    };
    setStatus(result?.reason || '无法发送到内嵌运行环境。');
    renderAttentionInbox();
    renderRuntimeDock();
    return false;
  } else {
    state.runtime.current = { ...state.runtime.current, ...result };
    els.runtimeInput.value = '';
  }
  renderRuntimeDock();
  return true;
}

async function stopCurrentRuntime() {
  const runtime = state.runtime.current;
  if (!runtime || !window.manager.stopTerminal) return;
  const result = await window.manager.stopTerminal({
    profileId: runtime.profileId,
    runtimeId: runtime.id
  });
  if (!result?.ok) {
    setStatus(result?.reason || '无法停止内嵌运行环境。');
    return;
  }
  state.runtime.current = { ...state.runtime.current, ...result };
  renderRuntimeDock();
  setStatus('内嵌运行环境已停止。');
}

function handleRuntimeEvent(event) {
  if (!event?.runtimeId) return;
  if (!state.runtime.current || state.runtime.current.id !== event.runtimeId) {
    pendingRuntimeEvents.push(event);
    if (pendingRuntimeEvents.length > 40) pendingRuntimeEvents.shift();
    return;
  }
  applyRuntimeEvent(event);
}

function applyRuntimeEvent(event) {
  const runtime = state.runtime.current;
  if (!runtime || runtime.id !== event.runtimeId) return;
  if (event.type === 'output' && event.text) appendRuntimeOutput(event.text, event.stream);
  if (event.type === 'state') {
    state.runtime.current = { ...runtime, status: event.status || runtime.status };
    if (event.status === 'error' || (Number.isInteger(event.exitCode) && event.exitCode !== 0)) {
      state.runtime.notice = {
        kind: 'error',
        title: `${runtime.adapterLabel || '运行环境'} 已异常退出`,
        detail: Number.isInteger(event.exitCode) ? `退出码 ${event.exitCode}` : '请查看终端输出',
        profileId: runtime.profileId,
        action: 'runtime'
      };
      renderAttentionInbox();
    }
    renderRuntimeDock();
    if (!els.runtimeInput.disabled && document.activeElement !== els.runtimeInput) els.runtimeInput.focus();
    if (event.status === 'ready') void runNextQueuedTask();
  }
}

function appendRuntimeOutput(text, stream = 'stdout') {
  els.runtimeOutput.querySelector('.runtime-placeholder')?.remove();
  const chunk = document.createElement('span');
  chunk.dataset.stream = stream || 'stdout';
  chunk.textContent = text;
  els.runtimeOutput.append(chunk);
  while (els.runtimeOutput.childElementCount > 500) els.runtimeOutput.firstElementChild?.remove();
  els.runtimeOutput.scrollTop = els.runtimeOutput.scrollHeight;
}

async function openTerminalForProfile(profile) {
  if (!profile) return;
  if (profile.id !== state.selectedProfileId) await selectProfile(profile.id);
  els.runtimeDock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const available = state.runtime.adapters.some((item) => item.available);
  if (!available) {
    setStatus('本机没有可用的终端或 Agent CLI，请先查看诊断。');
    return;
  }
  setStatus(`已定位到 ${profile.name} 的内嵌 Agent 工作台。`);
  if (runtimeIsActive()) {
    if (!els.runtimeInput.disabled) els.runtimeInput.focus();
  } else {
    els.runtimeStartBtn.focus();
  }
}

async function queueSessionForRuntime(profile, session) {
  const agent = state.runtime.adapters.find((item) => item.mode === 'agent' && item.available);
  if (!agent) {
    window.YardScene?.say(profile.id, { text: '先安装 Agent CLI，喵。', kind: 'warning', duration: 4200 });
    setStatus('任务道需要 Codex 或 Claude Code CLI；Shell 不会代替 Agent 自动执行任务。');
    return;
  }
  if (state.runtime.queue.length >= 20) {
    setStatus('Agent 待办已满（最多 20 条），先处理或清理现有任务。');
    return;
  }

  state.runtime.selectedAdapterId = agent.id;
  state.runtime.queue.push({
    id: `${profile.id}:${session.id}:${Date.now()}`,
    profileId: profile.id,
    title: session.title,
    text: `${makeHandoffText(profile, session)}\n\n这是从猫猫庭院任务道加入的待办。请先确认你理解当前项目，再继续处理尚未完成的工作。`
  });
  renderRuntimeDock();
  renderAttentionInbox();
  await openTerminalForProfile(profile);

  const runtime = state.runtime.current;
  if (runtime?.profileId === profile.id && runtime.mode === 'agent' && runtime.status === 'ready') {
    await runNextQueuedTask();
  } else if (runtimeIsActive(runtime)) {
    setStatus(`已把「${session.title}」排队；当前运行环境结束或切回 ${profile.name} 后继续。`);
  } else {
    setStatus(`已把「${session.title}」排队；点“开启”启动 ${agent.label} 后会自动发送。`);
  }
}

async function runNextQueuedTask() {
  if (runtimeQueueSending) return;
  const runtime = state.runtime.current;
  if (!runtime || runtime.mode !== 'agent' || runtime.status !== 'ready') return;
  const index = state.runtime.queue.findIndex((item) => item.profileId === runtime.profileId);
  if (index < 0) return;

  runtimeQueueSending = true;
  const [task] = state.runtime.queue.splice(index, 1);
  els.runtimeInput.value = task.text;
  renderRuntimeDock();
  renderAttentionInbox();
  const sent = await sendRuntimeInput();
  if (!sent) state.runtime.queue.splice(index, 0, task);
  else setStatus(`Agent 开始处理待办：「${task.title}」。`);
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
  els.yardStage.hidden = !yard;
  els.viewToggle.textContent = yard ? '⇄ 经典' : '⇄ 庭院';
  // 新增/编辑/移除按钮在两个视图间移动（同一批节点，事件不变）
  const host = yard ? els.yardManageActions : els.sidebarActions;
  host.append(els.addProfileBtn, els.editProfileBtn, els.removeProfileBtn);
  if (!yard) els.accountManage.open = false;
  if (yardMounted) window.YardScene.setActive(yard);
  if (yard) loadActivity(); // 切回庭院时立刻刷新猫的状态
  renderTopbarContext();
}

let activityLoading = false;

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
  runCompanion();
  syncYard();
}

// ── 陪伴账本 ─────────────────────────────────────────
function initCompanion() {
  els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
  els.reminderToggle.textContent = state.remindersOn ? '🔔 提醒 开' : '🔕 提醒 关';
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
    const statesById = {};
    const energyById = {};
    const attentionById = {};
    for (const profile of state.profiles) {
      statesById[profile.id] = window.YardCats.deriveState(now, profile, state.activity[profile.id]);
      energyById[profile.id] = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotaError ? null : state.quotas[profile.id], now)
        : 'unknown';
      if (statesById[profile.id] === 'confused') {
        attentionById[profile.id] = { kind: 'error', text: '会话路径需要检查' };
      } else if (profile.id === state.selectedProfileId && energyById[profile.id] === 'exhausted') {
        attentionById[profile.id] = { kind: 'warning', text: '额度快用完了' };
      }
    }
    window.YardScene.update({
      profiles: state.profiles,
      statesById,
      energyById,
      positionsById: state.yardPositions,
      attentionById,
      selectedId: state.selectedProfileId,
      night: document.documentElement.dataset.theme === 'dark'
    });
  }
  renderYardAccountStrip();
  renderTopbarContext();
  renderAttentionInbox();
  // 排行榜打开时随轮询实时刷新
  if (els.leaderboardDialog.open) renderLeaderboard();
}

// 工作量排行榜：各账号今日活跃/新建场次 + 实时干活状态，算分排序
function renderLeaderboard() {
  if (!window.YardWorkload || !window.YardCats || !window.YardSprites) return;
  const now = Date.now();
  const rows = state.profiles.map((profile) => {
    const act = state.activity[profile.id] || {};
    return {
      name: profile.name,
      appId: profile.appId,
      cat: profile.cat,
      isProtected: profile.isProtected,
      activeToday: act.activeToday || 0,
      createdToday: act.createdToday || 0,
      working: window.YardCats.deriveState(now, profile, act) === 'working'
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

function renderAccounts() {
  els.accountList.replaceChildren();

  if (state.profiles.some((profile) => profile.group)) {
    for (const [groupName, profiles] of groupProfiles(state.profiles)) {
      const header = document.createElement('div');
      header.className = 'group-header';
      const label = document.createElement('span');
      label.textContent = groupName || '未分组';
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = String(profiles.length);
      header.append(label, count);
      els.accountList.append(header);
      profiles.forEach(appendAccountRow);
    }
  } else {
    state.profiles.forEach(appendAccountRow);
  }

  populateGroupDatalist();
  renderYardAccountStrip();
  syncYard();
}

function renderYardAccountStrip() {
  if (!els.yardAccountStrip) return;
  els.yardAccountStrip.replaceChildren();
  const now = Date.now();
  for (const profile of state.profiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'yard-account-chip';
    button.classList.toggle('selected', profile.id === state.selectedProfileId);
    const activityState = window.YardCats
      ? window.YardCats.deriveState(now, profile, state.activity[profile.id])
      : 'rest';
    button.dataset.state = activityState;
    const dot = document.createElement('span');
    dot.className = 'yard-account-dot';
    dot.style.background = appColor(profile.appId);
    const name = document.createElement('b');
    name.textContent = profile.name;
    button.append(dot, name);
    button.title = `${profile.name} · ${window.YardCats?.STATE_META?.[activityState]?.label || activityState}`;
    button.addEventListener('click', () => selectProfile(profile.id));
    els.yardAccountStrip.append(button);
  }
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

function appendAccountRow(profile) {
  const button = document.createElement('button');
  button.className = `account-row ${profile.id === state.selectedProfileId ? 'selected' : ''}`;
  button.type = 'button';
  button.innerHTML = `
    <span class="account-app"></span>
    <strong></strong>
    <small></small>
  `;
  button.querySelector('.account-app').textContent = appLabel(profile.appId);
  button.querySelector('strong').textContent = profile.name;
  const small = button.querySelector('small');
  if (profile.note) {
    small.textContent = profile.note;
    small.classList.add('is-note');
  } else {
    small.textContent = shortPath(profile.profilePath);
  }
  button.addEventListener('click', () => selectProfile(profile.id));
  els.accountList.append(button);
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

function groupProfiles(profiles) {
  const map = new Map();
  for (const profile of profiles) {
    const key = profile.group || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(profile);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b, 'zh-CN');
  });
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

  els.launchBtn.disabled = disabled;
  els.pathConfigBtn.disabled = disabled;
  els.diagnosticsBtn.disabled = disabled;
  els.profileFolderBtn.disabled = disabled;
  els.refreshBtn.disabled = disabled;
  els.editProfileBtn.disabled = disabled;
  els.removeProfileBtn.disabled = disabled || profile?.isProtected;

  if (!profile) {
    els.accountTitle.textContent = '未选择账号';
    els.accountMeta.textContent = '';
    els.accountPath.textContent = '';
    els.accountNote.textContent = '';
    els.accountNote.style.display = 'none';
    renderQuotaSummary();
    renderTopbarContext();
    return;
  }

  els.accountTitle.textContent = profile.name;
  const groupLabel = profile.group ? ` · ${profile.group}` : '';
  els.accountMeta.textContent = `${appLabel(profile.appId)} · ${profile.isProtected ? '默认槽位' : '独立槽位'}${groupLabel} · 上次打开 ${compactDate(profile.lastLaunchedAt)}`;
  els.accountPath.textContent = `账号 ${shortPath(profile.profilePath)} · 会话 ${shortPath(profile.sessionRoot)}`;
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

  if (!session) {
    els.detailTitle.textContent = '未选择';
    els.detailId.textContent = '-';
    els.detailCreated.textContent = '-';
    els.detailUpdated.textContent = '-';
    els.detailSource.textContent = '-';
    els.detailProject.textContent = '-';
    els.detailFile.textContent = '-';
    els.detailAddress.textContent = '-';
    return;
  }

  els.detailTitle.textContent = session.title;
  els.detailId.textContent = session.id;
  els.detailCreated.textContent = fullDate(session.createdAt);
  els.detailUpdated.textContent = fullDate(session.updatedAt);
  els.detailSource.textContent = [session.source, session.status, session.model].filter(Boolean).join(' · ');
  els.detailProject.textContent = session.projectPath ? shortPath(session.projectPath) : '未记录';
  els.detailFile.textContent = shortPath(session.filePath);
  els.detailAddress.textContent = shortPath(session.address || session.id);
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
