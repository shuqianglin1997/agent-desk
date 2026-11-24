// AgentDesk — the hub on the desk: who may be called, folders and limit, and
// background runs on cards and in the ledger (docs/ARCHITECTURE_PLAN.md
// phase 6, docs/AGENT_HUB_PLAN.md). Moved from src/renderer.js unchanged.

import { renderAgentManageContext } from './agent-manage.js';
import { compactDate, fullDate, sessionKey, setStatus } from './common.js';
import { currentAgentId, currentDeviceLensId, identityGroups } from './context.js';
import { appLabel } from './data.js';
import { offersMainEvent, onMainEvent } from './main-events.js';
import { renderAccountRoster } from './roster.js';
import { applySessionFilter, focusSession, renderSessions, sessionColumns, setSessionChecked } from './sessions.js';
import { tr } from './settings.js';
import { HUB_ACTIVE, els, state } from './shared.js';

// ── 调度中枢：后台对话在台面上的样子 ─────────────────────
// 只演 AgentDesk 知道的事：调用经过它中转，开始、在跑、结束都是确切的，由 Main 在每次变化时推过来，这里不轮询。
// 发起方只有在 AgentDesk 知道是哪只猫时（它中转的上一段对话，或发起的进程就在那个账号的目录里）才从那只猫飞出；
// 否则信封从桌子边缘进来，自报的名字只当标签显示。动效规矩在 pixel/desk.js：后台不演、减少动态效果时不演、可打断。
const HUB_AFTERGLOW_MS = 15000;

async function loadHub() {
  let result = null;
  try { result = await window.manager.hubState(); } catch (_error) { result = null; }
  if (!result || !Array.isArray(result.runs)) return;
  state.hub.runs = new Map(result.runs.map((run) => [run.id, run]));
  applyHubSettings(result);
  hubRefresh();
}

// ── 调度中枢：档案里的两个开关、系统页的文件夹与上限 ─────────
// 这些只在桌面窗口里由人来改；命令行没有对应的命令，所以一个 Agent 不能给自己或别人开门。
// 文件夹只能从 Main 打开的系统选择框里来，这里只送编号。
function applyHubSettings(result) {
  if (!result || typeof result !== 'object') return;
  // 开关正在保存时不拿中途读到的旧值盖掉人刚点的样子；保存的结果会补上
  if (Array.isArray(result.accounts) && !state.hub.saving) state.hub.accounts = result.accounts;
  if (result.clients && typeof result.clients === 'object') state.hub.clients = result.clients;
  if (Array.isArray(result.folders)) state.hub.folders = result.folders;
  if (Number.isInteger(result.maxConcurrent)) state.hub.maxConcurrent = result.maxConcurrent;
  renderHubSystem();
  if (els.agentManageDialog?.open) renderAgentManageContext();
}

function hubNameKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

const HUB_UNSUPPORTED_NOTES = {
  'desktop-only': 'hub.dossier.desktopOnly',
  'prompt-argument-only': 'hub.dossier.promptArgOnly',
  'no-read-only-mode': 'hub.dossier.noReadOnly'
};

// 档案的“调用”一段跟着展开的那个位置走；只对本机位置有意义（调用只在这台电脑上）。
function renderHubCalling(group, profile) {
  const section = els.hubCallingSection;
  if (!section) return;
  const profileId = profile && profile._remote !== true ? String(profile._meshProfileId || profile.id) : '';
  const account = profileId ? state.hub.accounts.find((item) => item.id === profileId) || null : null;
  section.hidden = !group || !account;
  if (section.hidden) {
    delete section.dataset.profileId;
    return;
  }
  section.dataset.profileId = profileId;
  const support = state.hub.clients[profile.appId] || { callable: false, reason: null, via: null };
  const supported = support.callable === true;
  const callable = supported && account.callable === true;
  const writable = callable && account.writable === true;
  els.hubCallingName.textContent = tr('hub.dossier.name', { name: account.name });
  els.hubAllowCall.checked = callable;
  els.hubAllowCall.disabled = !supported;
  els.hubAllowWrite.checked = writable;
  els.hubAllowWrite.disabled = !callable;
  els.hubAllowCallState.textContent = tr(callable ? 'hub.dossier.on' : 'hub.dossier.off');
  els.hubAllowWriteState.textContent = tr(writable ? 'hub.dossier.on' : 'hub.dossier.off');
  const notes = [];
  if (!supported) {
    notes.push(tr(HUB_UNSUPPORTED_NOTES[support.reason] || 'hub.dossier.notVerified', { client: appLabel(profile.appId) }));
  } else {
    notes.push(tr('hub.dossier.via', { where: `${tr('hub.dossier.here')} · ${support.via || appLabel(profile.appId)}` }));
    if (callable) {
      // 同名的可被调用的位置不止一个时，调用方只能用编号
      const key = hubNameKey(account.name);
      const same = state.hub.accounts.filter((item) => item.callable && hubNameKey(item.name) === key);
      if (same.length > 1) {
        const cats = new Set(same.map((item) => hubGroupKey(item.id) || item.id));
        notes.push(cats.size > 1
          ? tr('hub.dossier.duplicate', { n: cats.size, id: profileId })
          : tr('hub.dossier.duplicateSelf', { n: same.length, id: profileId }));
      }
      if (!state.hub.folders.length) notes.push(tr('hub.dossier.noFolder'));
    }
  }
  els.hubCallingNotes.replaceChildren(...notes.map((text) => {
    const note = document.createElement('p');
    note.className = 'dossier-note';
    note.textContent = text;
    return note;
  }));
}

// 开关先按人点的样子显示，Main 存好后以它返回的为准；没存上就退回原样并说一声。
async function saveHubAccess(next) {
  const profileId = els.hubCallingSection?.dataset.profileId;
  if (!profileId || !window.manager.hubSetAccess) return;
  const before = state.hub.accounts.find((item) => item.id === profileId);
  if (!before || state.hub.saving) {
    renderAgentManageContext();
    return;
  }
  const patch = (value) => {
    state.hub.accounts = state.hub.accounts.map((item) => (item.id === profileId ? { ...item, ...value } : item));
  };
  state.hub.saving = true;
  patch({ callable: next.callable === true, writable: next.callable === true && next.writable === true });
  renderAgentManageContext();
  let result = null;
  try { result = await window.manager.hubSetAccess({ profileId, callable: next.callable === true, writable: next.writable === true }); } catch (_error) { result = null; }
  state.hub.saving = false;
  if (result?.ok) {
    patch({ callable: result.hub?.callable === true, writable: result.hub?.writable === true });
  } else {
    patch({ callable: before.callable, writable: before.writable });
    setStatus(tr('hub.dossier.saveFailed'), 'error');
  }
  renderAgentManageContext();
}

function renderHubSystem() {
  const list = els.hubFolderList;
  if (!list) return;
  const items = state.hub.folders.map((folder) => {
    const item = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = folder.name;
    const where = document.createElement('code');
    where.textContent = folder.displayPath;
    where.title = folder.displayPath;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.folderId = folder.id;
    remove.textContent = tr('hub.system.remove');
    remove.setAttribute('aria-label', `${tr('hub.system.remove')} ${folder.name}`);
    item.append(name, where, remove);
    return item;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'hub-folder-empty';
    empty.textContent = tr('hub.system.noFolders');
    items.push(empty);
  }
  list.replaceChildren(...items);
  if (els.hubMaxConcurrent) els.hubMaxConcurrent.value = String(state.hub.maxConcurrent);
}

async function addHubFolder() {
  if (!window.manager.hubAddFolder) return;
  let result = null;
  try { result = await window.manager.hubAddFolder(); } catch (_error) { result = null; }
  if (result?.ok) {
    applyHubSettings(result.state);
    return;
  }
  if (result?.reasonCode === 'cancelled') return;
  setStatus(tr(result?.reasonCode === 'folder-limit' ? 'hub.system.folderLimit'
    : (result?.reasonCode === 'folder-invalid' ? 'hub.system.folderInvalid' : 'hub.system.saveFailed')), 'error');
}

async function removeHubFolder(id) {
  if (!id || !window.manager.hubRemoveFolder) return;
  let result = null;
  try { result = await window.manager.hubRemoveFolder(id); } catch (_error) { result = null; }
  if (result?.state) applyHubSettings(result.state);
  if (!result?.ok) setStatus(tr('hub.system.saveFailed'), 'error');
}

async function setHubLimit(value) {
  if (!window.manager.hubSetMaxConcurrent) return;
  let result = null;
  try { result = await window.manager.hubSetMaxConcurrent(value); } catch (_error) { result = null; }
  if (result?.state) applyHubSettings(result.state);
  else {
    renderHubSystem();
    setStatus(tr('hub.system.saveFailed'), 'error');
  }
}

function hubRefresh() {
  applySessionFilter();
  renderAccountRoster();
  renderHubFooter();
  ensureHubTicker();
}

function applyHubChange(run) {
  if (!run || typeof run.id !== 'string') {
    void loadHub();
    return;
  }
  if (state.hub.pending.has(run.id)) {
    // 信封还在路上：落地时用最新的这一份
    state.hub.pending.set(run.id, run);
    return;
  }
  const previous = state.hub.runs.get(run.id) || null;
  if (!previous && HUB_ACTIVE.has(run.state)) {
    hubStart(run);
    return;
  }
  state.hub.runs.set(run.id, run);
  if (previous && previous.state !== run.state) hubEnd(run, previous.state);
  hubRefresh();
}

function hubGroupKey(profileId) {
  if (!profileId) return null;
  const group = identityGroups().find((item) => item.members.some((member) => (
    !member._remote && String(member._meshProfileId || member.id) === String(profileId)
  )));
  return group?.key || null;
}

function hubNameOf(profileId) {
  const key = hubGroupKey(profileId);
  return identityGroups().find((group) => group.key === key)?.primary?.name || null;
}

function hubCardOf(groupKey) {
  return groupKey ? [...(els.accountRoster?.children || [])].find((card) => card.dataset.agentId === groupKey) || null : null;
}

// 猫胸口的位置；卡片被滚出名册可见区时，停在名册靠它那一侧的边上
function hubCatPoint(groupKey) {
  const canvas = hubCardOf(groupKey)?.querySelector('.account-card-avatar');
  const point = window.PixelDesk?.center(canvas, 10);
  if (!point || !els.accountRoster) return point || null;
  const box = els.accountRoster.getBoundingClientRect();
  return { x: Math.max(box.left + 16, Math.min(box.right - 16, point.x)), y: point.y };
}

// 台面外面：Agent 区的左上角
function hubEdgePoint(near) {
  const panel = els.accountRoster?.closest('.agent-panel') || els.accountRoster;
  const box = panel?.getBoundingClientRect();
  if (!box) return null;
  return { x: box.left - 12, y: Math.max(box.top + 8, (near?.y || box.top + 60) - 40) };
}

function hubCue(kind) {
  try { window.PixelUi?.hubSound?.(kind); } catch (_error) { /* sound is optional */ }
}

function hubCatAct(groupKey, action) {
  if (!groupKey || !window.PixelDesk?.foreground() || window.PixelDesk.reduced()) return;
  window.PixelUi?.catAct(groupKey, action);
}

function hubOverride(groupKey, catState, ms) {
  if (!groupKey) return;
  state.hub.overrides.set(groupKey, { state: catState, until: Date.now() + ms });
  setTimeout(() => renderAccountRoster(), ms + 60);
}

// 卡片上这只猫此刻因为后台对话该是什么样：被叫在跑的在干活；同时叫着两只以上的那只戴上领结
// 一只猫同时在跑几条对话：本机各运行位置的探测结果（同一份数据根只算一次），和调度中枢正在跑的、
// 目标是它的那几段，两者可能是同一条，所以取较大的而不相加。远端位置没有这项数据，不计；都不知道时返回 null。
function cardRunningCount(group, merged) {
  const ids = new Set((group?.members || []).filter((member) => !member._remote).map((member) => String(member._meshProfileId || member.id)));
  let hub = 0;
  for (const run of state.hub.runs.values()) {
    if (HUB_ACTIVE.has(run.state) && ids.has(String(run.target?.id))) hub += 1;
  }
  const files = merged && Number.isFinite(merged.writingNow) ? merged.writingNow : null;
  if (files === null && hub === 0) return null;
  return Math.max(files || 0, hub);
}

function hubCardState(group) {
  const ids = new Set((group?.members || []).filter((member) => !member._remote).map((member) => String(member._meshProfileId || member.id)));
  let working = false;
  let calling = 0;
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state)) continue;
    if (ids.has(String(run.target.id))) working = true;
    if (run.caller && ids.has(String(run.caller.id))) calling += 1;
  }
  const override = state.hub.overrides.get(group?.key);
  const after = override && override.until > Date.now() ? override.state : null;
  return { state: working ? 'working' : after, accessory: calling >= 2 ? 'bow' : null };
}

function hubStart(run) {
  const callee = hubGroupKey(run.target.id);
  const caller = run.caller ? hubGroupKey(run.caller.id) : null;
  hubCue(caller ? 'start' : 'outside');
  state.hub.pending.set(run.id, run);
  renderHubFooter();
  const to = hubCatPoint(callee);
  const from = caller ? hubCatPoint(caller) : hubEdgePoint(to);
  // 同一只同时叫几只：信封错开 150 毫秒
  const last = state.hub.lastStartByCaller.get(caller || 'outside') || 0;
  const delayMs = Math.max(0, last + 150 - Date.now());
  state.hub.lastStartByCaller.set(caller || 'outside', Date.now() + delayMs);
  const land = (played) => {
    const latest = state.hub.pending.get(run.id) || run;
    state.hub.pending.delete(run.id);
    state.hub.runs.set(latest.id, latest);
    state.hub.fresh.add(latest.id);
    if (played) window.PixelDesk.ring(to, 'brand');
    const from = caller ? hubNameOf(run.caller.id) : null;
    setStatus(from
      ? tr('hub.say.started', { from, to: latest.target.name })
      : tr('hub.say.startedOutside', { label: latest.from ? tr('hub.from.label', { label: latest.from }) : tr('hub.from.unknown'), to: latest.target.name }));
    hubRefresh();
    if (!HUB_ACTIVE.has(latest.state)) hubEnd(latest, 'running');
  };
  if (!window.PixelDesk || caller === callee) land(false);
  else window.PixelDesk.fly({ from, to, arc: caller ? 16 : 10, delayMs, onLand: land });
}

function hubEnd(run, before) {
  if (!HUB_ACTIVE.has(before) || HUB_ACTIVE.has(run.state)) return;
  const callee = hubGroupKey(run.target.id);
  const caller = run.caller ? hubGroupKey(run.caller.id) : null;
  const back = (kind, onArrive) => {
    if (!window.PixelDesk || caller === callee) return;
    const from = hubCatPoint(callee);
    const to = caller ? hubCatPoint(caller) : hubEdgePoint(from);
    window.PixelDesk.fly({ from, to, arc: 16, kind, delayMs: 200, onLand: (played) => { if (played) onArrive?.(to); } });
  };
  if (run.state === 'completed') {
    hubCue('done');
    hubOverride(callee, 'onduty', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'cheer');
    back('mail', (point) => {
      window.PixelDesk.ring(point, 'ok');
      if (caller) hubCatAct(caller, 'hop');
    });
    setStatus(tr('hub.say.done', { to: run.target.name }));
  } else if (run.state === 'failed') {
    hubOverride(callee, 'onduty', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'no');
    back('bad', () => {
      if (caller) {
        hubOverride(caller, 'confused', 2500);
        renderAccountRoster();
      }
    });
    // 红字的状态行本身会带出“出错”的声音（pixel/ui.js 认这个标记），这里不再另响
    const reason = run.reasonCode ? tr(`hub.reason.${run.reasonCode}`) : '';
    setStatus(tr('hub.say.failed', { to: run.target.name, reason: reason.startsWith('hub.reason.') ? '' : reason }), 'error');
  } else if (run.state === 'stopped') {
    hubOverride(callee, 'rest', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'settle');
    setStatus(tr('hub.say.stopped', { to: run.target.name }));
  }
}

async function hubStop(runId) {
  if (!window.manager.hubStopRun) return;
  const result = await window.manager.hubStopRun(runId);
  if (!result?.ok) setStatus(tr('hub.stopFailed'), 'error');
}

// 一段后台对话在账本里只占一行：被叫账号自己的那条会话找到以后，就用那一行
function withHubRuns(sessions) {
  if (!state.hub.runs.size) return sessions;
  const byKey = new Map();
  for (const run of state.hub.runs.values()) {
    if (run.session?.id) byKey.set(`${run.target.id}::${run.session.id}`, run);
  }
  const used = new Set();
  const out = sessions.map((session) => {
    if (session._remote) return session;
    const run = byKey.get(`${session._meshProfileId || session._profileId}::${session.address || session.id}`);
    if (!run) return session;
    used.add(run.id);
    return { ...session, _hubRun: run };
  });
  const lens = currentDeviceLensId();
  const localLens = !state.mesh.overview?.initialized || lens === 'all' || lens === state.mesh.overview?.localDeviceId;
  if (!localLens) return out;
  for (const run of state.hub.runs.values()) {
    if (used.has(run.id)) continue;
    if (state.ui.agentScope !== 'all' && hubGroupKey(run.target.id) !== currentAgentId()) continue;
    out.push({
      id: run.id,
      address: run.id,
      title: run.title,
      _hubRun: run,
      _hubOnly: true,
      _profileId: run.target.id,
      _accountName: run.target.name,
      appId: run.target.app,
      createdAt: run.startedAt || run.createdAt,
      updatedAt: HUB_ACTIVE.has(run.state) ? new Date().toISOString() : (run.endedAt || run.createdAt)
    });
  }
  return out;
}

function hubRowContext() {
  return {
    t: tr,
    nameOf: (profileId) => hubNameOf(profileId),
    appLabel: (appId) => appLabel(appId),
    compactDate,
    fullDate,
    onStop: (runId) => void hubStop(runId)
  };
}

function renderHubRow(session) {
  const run = session._hubRun;
  const row = document.createElement('tr');
  row.className = 'hub-run-row';
  row.dataset.runId = run.id;
  row.dataset.runState = run.state;
  if (state.hub.fresh.has(run.id)) {
    state.hub.fresh.delete(run.id);
    if (!window.PixelDesk?.reduced()) row.classList.add('fx-in');
  }
  const selectCell = document.createElement('td');
  selectCell.className = 'select-cell';
  row.append(selectCell);
  if (!session._hubOnly) {
    const key = sessionKey(session);
    row.dataset.sessionKey = key;
    const checked = state.ui.checkedConversationIds.has(key);
    row.classList.toggle('selected', checked);
    row.classList.toggle('session-active', key === state.ui.focusedConversationId);
    row.setAttribute('aria-selected', String(checked || key === state.ui.focusedConversationId));
    const checkbox = document.createElement('input');
    checkbox.className = 'session-select-box';
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', tr('session.selectOne', { title: run.title }));
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => setSessionChecked(session, checkbox.checked));
    selectCell.append(checkbox);
    row.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) setSessionChecked(session, !state.ui.checkedConversationIds.has(key));
      else {
        focusSession(session);
        renderSessions();
      }
    });
  }
  const context = hubRowContext();
  for (const column of sessionColumns()) row.append(window.AgentHubUi.cellFor(run, column, context));
  return row;
}

function renderHubLinks() {
  if (!els.hubLinks || !window.AgentHubUi) return;
  const links = [];
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state) || !run.caller) continue;
    const from = hubGroupKey(run.caller.id);
    const to = hubGroupKey(run.target.id);
    if (from && to && from !== to) links.push({ from, to });
  }
  window.AgentHubUi.renderLinks(els.hubLinks, els.accountRoster, links);
}

function renderHubFooter() {
  if (!els.hubFooter) return;
  let active = state.hub.pending.size;
  for (const run of state.hub.runs.values()) if (HUB_ACTIVE.has(run.state)) active += 1;
  els.hubFooter.hidden = active === 0;
  if (!active) {
    els.hubFooter.replaceChildren();
    return;
  }
  els.hubFooter.replaceChildren(window.AgentHubUi.lamp('running', tr), document.createTextNode(tr('hub.footer.running', { n: active })));
}

// 用时每秒走一格；没有在跑的就不留计时器。只读本地的钟，不向 Main 要数据。
function ensureHubTicker() {
  const any = [...state.hub.runs.values()].some((run) => run.state === 'running');
  if (!any) {
    clearInterval(state.hub.ticker);
    state.hub.ticker = null;
    return;
  }
  if (state.hub.ticker) return;
  state.hub.ticker = setInterval(() => {
    for (const cell of document.querySelectorAll('#sessionRows td[data-hub-elapsed]')) {
      const run = state.hub.runs.get(cell.dataset.hubElapsed);
      if (run) window.AgentHubUi.timeCell(run, hubRowContext(), cell);
    }
  }, 1000);
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindHubEvents() {
  if (window.manager.hubState) void loadHub();
  if (offersMainEvent('onHubChanged')) onMainEvent('onHubChanged', (payload) => applyHubChange(payload?.run));
  window.AgentHubUi?.installTips?.(document, tr);
  els.hubAllowCall?.addEventListener('change', () => {
    const callable = els.hubAllowCall.checked;
    void saveHubAccess({ callable, writable: callable && els.hubAllowWrite.checked });
  });
  els.hubAllowWrite?.addEventListener('change', () => {
    void saveHubAccess({ callable: els.hubAllowCall.checked, writable: els.hubAllowCall.checked && els.hubAllowWrite.checked });
  });
  els.hubAddFolderBtn?.addEventListener('click', () => void addHubFolder());
  els.hubFolderList?.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-folder-id]');
    if (button) void removeHubFolder(button.dataset.folderId);
  });
  els.hubMaxConcurrent?.addEventListener('change', () => void setHubLimit(Number(els.hubMaxConcurrent.value)));
  els.accountRoster?.addEventListener('scroll', () => renderHubLinks(), { passive: true });
  window.addEventListener('resize', () => renderHubLinks());
}

export { loadHub, applyHubSettings, hubNameKey, renderHubCalling, saveHubAccess, renderHubSystem, addHubFolder, removeHubFolder, setHubLimit, hubRefresh, applyHubChange, hubGroupKey, hubNameOf, hubCardOf, hubCatPoint, hubEdgePoint, hubCue, hubCatAct, hubOverride, cardRunningCount, hubCardState, hubStart, hubEnd, hubStop, withHubRuns, hubRowContext, renderHubRow, renderHubLinks, renderHubFooter, ensureHubTicker, bindHubEvents };
