const state = {
  profiles: [],
  sessions: [],
  filteredSessions: [],
  selectedProfileId: null,
  selectedSessionId: null,
  query: '',
  view: localStorage.getItem('agentdesk-view') || 'yard',
  activity: {},
  ledger: null,
  remindersOn: localStorage.getItem('agentdesk-reminders') !== '0',
  atmosTime: localStorage.getItem('agentdesk-yard-time') || 'auto',
  atmosWeather: localStorage.getItem('agentdesk-yard-weather') || 'clear',
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
  yardStage: document.querySelector('#yardStage'),
  yardCanvas: document.querySelector('#yardCanvas'),
  yardOverlay: document.querySelector('#yardOverlay'),
  viewToggle: document.querySelector('#viewToggle'),
  accountActions: document.querySelector('#accountActions'),
  sidebarActions: document.querySelector('#sidebarActions'),
  ledgerDone: document.querySelector('#ledgerDone'),
  ledgerMin: document.querySelector('#ledgerMin'),
  reminderToggle: document.querySelector('#reminderToggle'),
  atmosTime: document.querySelector('#atmosTime'),
  atmosWeather: document.querySelector('#atmosWeather'),
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

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  bindEvents();
  await loadApps();
  initYard();
  initCompanion();
  applyView();
  loadProfiles();
  loadActivity();
  // 庭院可见、或排行榜开着时轮询（排行榜按钮在经典视图也可点，要保证它也实时刷新）。
  // 8 秒一轮：干活/在岗要跟得上会话节奏，60 秒太钝会漏掉短生成。仅可见时轮询，后台不扫。
  setInterval(() => {
    if (!document.hidden && (state.view === 'yard' || els.leaderboardDialog.open)) loadActivity();
  }, 8000);
  // 从最小化/后台切回前台时立刻刷新一次，别等下一轮
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (state.view === 'yard' || els.leaderboardDialog.open)) loadActivity();
  });
  maybeShowWelcome();
});

function initTheme() {
  const saved = localStorage.getItem('agentdesk-theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

function maybeShowWelcome() {
  if (localStorage.getItem('agentdesk-welcomed')) return;
  localStorage.setItem('agentdesk-welcomed', '1');
  els.welcomeDialog.showModal();
}

function bindEvents() {
  els.addProfileBtn.addEventListener('click', () => {
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
    document.documentElement.dataset.theme = next;
    localStorage.setItem('agentdesk-theme', next);
    syncYard();
  });

  els.viewToggle.addEventListener('click', () => {
    state.view = state.view === 'yard' ? 'classic' : 'yard';
    localStorage.setItem('agentdesk-view', state.view);
    applyView();
  });

  els.reminderToggle.addEventListener('click', () => {
    state.remindersOn = !state.remindersOn;
    localStorage.setItem('agentdesk-reminders', state.remindersOn ? '1' : '0');
    els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
    els.reminderToggle.textContent = state.remindersOn ? '🔔 提醒 开' : '🔕 提醒 关';
    setStatus(state.remindersOn ? '休息提醒已开启。' : '休息提醒已关闭，猫照常陪你干活。');
  });

  els.helpBtn.addEventListener('click', () => {
    els.welcomeDialog.showModal();
  });

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
  els.updateBtn.textContent = '…';
  els.updateBtn.title = '正在查询 GitHub Releases';
  setStatus('正在检查 GitHub 更新…');

  const result = await window.manager.checkForUpdates();
  if (!result.ok) {
    setStatus(result.reason || '检查更新失败。');
    finishUpdateButton('!', '检查更新失败，点击重试', 'update-error');
    return;
  }

  state.updateInfo = result;
  if (!result.updateAvailable) {
    setStatus(`当前已是最新版 v${result.currentVersion}。`);
    finishUpdateButton('✓', `当前版本 v${result.currentVersion}`, '');
    return;
  }

  els.updateBtn.classList.add('update-available');
  els.updateBtn.textContent = '↑';
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
    setStatus(`发现新版本 v${result.latestVersion}，随时点击左上角 ↑ 更新。`);
    return;
  }

  els.updateBtn.disabled = true;
  els.updateBtn.textContent = result.installSupported ? '0' : '↗';
  const installed = await window.manager.installUpdate();
  if (!installed.ok) {
    setStatus(installed.reason || '更新失败。');
    finishUpdateButton('!', '更新失败，点击重试', 'update-error');
    return;
  }
  if (installed.manual) {
    setStatus(installed.message || '已打开 GitHub Release 页面。');
    finishUpdateButton('↗', '已打开 GitHub Release', '');
    return;
  }
  if (installed.upToDate) {
    setStatus(installed.message || '当前已是最新版。');
    finishUpdateButton('✓', '当前已是最新版', '');
    return;
  }
  if (installed.restarting) {
    els.updateBtn.textContent = '✓';
    els.updateBtn.title = '更新完成，正在重启';
    setStatus(installed.message || '更新完成，正在重启…');
  }
}

function handleUpdateProgress(progress = {}) {
  if (progress.message) setStatus(progress.message);
  if (progress.stage === 'downloading' && Number.isFinite(progress.percent)) {
    els.updateBtn.textContent = String(progress.percent);
    els.updateBtn.title = `正在下载更新：${progress.percent}%`;
  } else if (progress.stage === 'installing') {
    els.updateBtn.textContent = '✓';
    els.updateBtn.title = '校验完成，准备重启';
  } else if (progress.stage === 'error') {
    els.updateBtn.textContent = '!';
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
      els.updateBtn.textContent = '↑';
      els.updateBtn.title = `发现 v${state.updateInfo.latestVersion}，点击更新`;
      els.updateBtn.classList.add('update-available');
    } else {
      els.updateBtn.textContent = '↻';
      els.updateBtn.title = '检查 GitHub 更新';
      els.updateBtn.classList.remove('update-available', 'update-error');
    }
  }, 2200);
}

async function loadProfiles(preferredId = null) {
  state.profiles = await window.manager.listProfiles();
  state.selectedProfileId = preferredId || state.selectedProfileId || state.profiles[0]?.id || null;
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.profiles[0]?.id || null;
  }
  renderAccounts();
  renderAccountHeader();
  await loadSessions(true);
}

async function loadSessions(selectFirst = false) {
  const profile = selectedProfile();
  state.sessions = profile ? await window.manager.listSessions(profile) : [];
  applySessionFilter(selectFirst);
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
    onPet: (profile) => setStatus(`${profile.name}：呼噜呼噜呼噜……`)
  });
  yardMounted = true;
  initAtmosphere();
}

// 时间 / 天气控件：从 localStorage 恢复，点击切换并持久化
function initAtmosphere() {
  const TIME_LABEL = { auto: '跟随主题', day: '白天', dusk: '黄昏', night: '夜晚' };
  const WEATHER_LABEL = { clear: '晴天', cloudy: '多云', rain: '下雨', snow: '下雪' };
  const syncPressed = () => {
    els.atmosTime.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === state.atmosTime)));
    els.atmosWeather.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === state.atmosWeather)));
  };
  els.atmosTime.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosTime = btn.dataset.time;
    localStorage.setItem('agentdesk-yard-time', state.atmosTime);
    window.YardScene.setAtmosphere({ time: state.atmosTime });
    syncPressed();
    setStatus(`庭院时间：${TIME_LABEL[state.atmosTime]}。`);
  });
  els.atmosWeather.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosWeather = btn.dataset.weather;
    localStorage.setItem('agentdesk-yard-weather', state.atmosWeather);
    window.YardScene.setAtmosphere({ weather: state.atmosWeather });
    syncPressed();
    setStatus(`庭院天气：${WEATHER_LABEL[state.atmosWeather]}。`);
  });
  window.YardScene.setAtmosphere({ time: state.atmosTime, weather: state.atmosWeather });
  syncPressed();
}

function applyView() {
  const yard = state.view === 'yard' && yardMounted;
  document.body.dataset.view = yard ? 'yard' : 'classic';
  els.yardStage.hidden = !yard;
  els.viewToggle.textContent = yard ? '⇄ 经典视图' : '⇄ 猫猫庭院';
  // 新增/编辑/移除按钮在两个视图间移动（同一批节点，事件不变）
  const host = yard ? els.accountActions : els.sidebarActions;
  host.append(els.addProfileBtn, els.editProfileBtn, els.removeProfileBtn);
  if (yardMounted) window.YardScene.setActive(yard);
  if (yard) loadActivity(); // 切回庭院时立刻刷新猫的状态
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
  try {
    const saved = JSON.parse(localStorage.getItem('agentdesk-ledger') || 'null');
    if (saved && saved.date) state.ledger = saved;
  } catch (_error) {
    state.ledger = null;
  }
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
    try {
      localStorage.setItem('agentdesk-ledger', JSON.stringify(ledger));
    } catch (_error) {
      // localStorage 满/不可用：账本仍在内存里工作，忽略
    }
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
    for (const profile of state.profiles) {
      statesById[profile.id] = window.YardCats.deriveState(now, profile, state.activity[profile.id]);
    }
    window.YardScene.update({
      profiles: state.profiles,
      statesById,
      selectedId: state.selectedProfileId,
      night: document.documentElement.dataset.theme === 'dark'
    });
  }
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
  syncYard();
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
    return;
  }

  els.accountTitle.textContent = profile.name;
  const groupLabel = profile.group ? ` · ${profile.group}` : '';
  els.accountMeta.textContent = `${appLabel(profile.appId)} · ${profile.isProtected ? '默认槽位' : '独立槽位'}${groupLabel} · 上次打开 ${compactDate(profile.lastLaunchedAt)}`;
  els.accountPath.textContent = `账号 ${shortPath(profile.profilePath)} · 会话 ${shortPath(profile.sessionRoot)}`;
  els.accountNote.textContent = profile.note || '';
  els.accountNote.style.display = profile.note ? '' : 'none';
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
