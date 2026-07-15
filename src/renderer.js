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
  atmosWeather: localStorage.getItem('agentdesk-yard-weather') || 'clear'
};

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
  themeToggle: document.querySelector('#themeToggle'),
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
  pickProfilePathBtn: document.querySelector('#pickProfilePathBtn'),
  pickSessionRootBtn: document.querySelector('#pickSessionRootBtn'),
  confirmPathBtn: document.querySelector('#confirmPathBtn'),
  diagnosticsDialog: document.querySelector('#diagnosticsDialog'),
  diagnosticsBody: document.querySelector('#diagnosticsBody'),
  copyDiagnosticsBtn: document.querySelector('#copyDiagnosticsBtn')
};

let lastDiagnostics = null;
let yardMounted = false;

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  bindEvents();
  initYard();
  initCompanion();
  applyView();
  loadProfiles();
  loadActivity();
  // 只在庭院可见时轮询，避免后台白扫
  setInterval(() => {
    if (state.view === 'yard' && !document.hidden) loadActivity();
  }, 60000);
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
    els.newProfileApp.value = 'claude';
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
    setStatus(`已打开 ${profile.name}。`);
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
      sessionRoot
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

  els.profileFolderBtn.addEventListener('click', () => {
    const profile = selectedProfile();
    if (profile) window.manager.showItem(profile.profilePath);
  });

  els.refreshBtn.addEventListener('click', async () => {
    if (isYardView()) window.YardScene.fx('bell');
    await loadSessions(true);
    await loadActivity();
    setStatus(isYardView() ? '♪ 摇铃 —— 全体猫竖起耳朵，会话已重新扫描。' : '会话列表已刷新。');
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
    setStatus('已复制会话地址。');
  });

  els.copyProjectBtn.addEventListener('click', async () => {
    const session = selectedSession();
    if (!session?.projectPath) return;
    await window.manager.writeClipboard(session.projectPath);
    setStatus('已复制项目目录。');
  });

  els.openSessionFileBtn.addEventListener('click', () => {
    const session = selectedSession();
    if (session?.filePath) window.manager.showItem(session.filePath);
  });
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
  if (!yardMounted) return;
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
  button.querySelector('.account-app').textContent = profile.appId === 'codex' ? 'Codex' : 'Claude';
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
  els.accountMeta.textContent = `${profile.appId === 'codex' ? 'Codex' : 'Claude'} · ${profile.isProtected ? '默认槽位' : '独立槽位'}${groupLabel} · 上次打开 ${compactDate(profile.lastLaunchedAt)}`;
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
    diagnosticBadge(diagnostics.executable.found ? 'ok' : 'warn', diagnostics.executable.found ? 'App 已找到' : 'App 未找到'),
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

  const table = document.createElement('table');
  table.className = 'diagnostics-table';
  const tbody = document.createElement('tbody');
  [
    ['平台', diagnostics.platform],
    ['官方 App', diagnostics.executable.path || '未找到'],
    ['账号目录', diagnostics.profilePath.path],
    ['会话根目录', diagnostics.sessionRoot.path],
    ['配置文件', diagnostics.storeFile]
  ].forEach(([label, value]) => appendDiagnosticRow(tbody, label, value));
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
    `应用：${diagnostics.appName}`,
    `官方 App：${diagnostics.executable.path || '未找到'}`,
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

  return lines.join('\n');
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedProfileId) || null;
}

function selectedSession() {
  return state.filteredSessions.find((session) => session.id === state.selectedSessionId) || null;
}

function makeHandoffText(profile, session) {
  const appName = profile.appId === 'codex' ? 'Codex' : 'Claude';
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
    `会话地址：${session.address || session.id}`,
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

function setStatus(message) {
  els.statusBar.textContent = message;
}
