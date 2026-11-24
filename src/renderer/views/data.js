// AgentDesk — loading the window's data: the client list, profiles, local and
// Mesh sessions, the session scope, and the activity probe with the list's
// refreshes (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js
// unchanged.

import { setStatus } from './common.js';
import { currentAgentId, currentDeviceLensId, identityGroups, renderTopbarContext, selectedGroupProfile, setProfileContext, validateSessionContext, validateUiContext } from './context.js';
import { loadDeviceOverview } from './devices.js';
import { maybeShowWelcome } from './first-use.js';
import { renderAttentionInbox } from './inbox.js';
import { loadQuotas, quotaHasLoaded } from './quota.js';
import { renderAccountHeader, renderAccountRoster, renderAccounts } from './roster.js';
import { applySessionFilter, renderSessionControls } from './sessions.js';
import { persistSettings, persistUiSelectionMemory, tr } from './settings.js';
import { ACTIVITY_POLL_INTERVAL, FOREGROUND_SESSION_REFRESH_INTERVAL, HUB_ACTIVE, els, sessionMarks, state } from './shared.js';

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
          providerNamespace: a.providerNamespace || null,
          recruitDefault: a.recruitDefault === true,
          canExportTranscript: Boolean(a.canExportTranscript),
          taskPackageMode: ['native', 'transcript'].includes(a.taskPackageMode) ? a.taskPackageMode : 'unsupported',
          canLaunch: a.canLaunch !== false,
          canProvision: a.canProvision === true,
          provisioningClientForm: a.provisioningClientForm || null,
          signIn: a.signIn && typeof a.signIn === 'object' ? a.signIn : null,
          discoveryKind: a.discoveryKind || null,
          defaultOnly: a.defaultOnly === true
        }
      ]));
    }
  } catch (_error) {
    // 保留内置默认
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

// Each list load takes the next number; an answer applies only while its
// number is still the latest, so a slower earlier load cannot overwrite it.
let sessionsLoadGeneration = 0;

let foregroundSessionRefreshAt = 0;

let activitySessionRefreshAt = 0;

const listedActivityAt = new Map();

// Local accounts whose sessions the list currently shows.
function listedProfileIds() {
  const local = new Set(state.profiles.map((profile) => String(profile.id)));
  const groups = identityGroups();
  const scoped = state.ui.agentScope === 'all' ? groups : groups.filter((group) => group.key === currentAgentId());
  return scoped.flatMap((group) => group.members.map((member) => String(member.id))).filter((id) => local.has(id));
}

function refreshSessionsOnActivity() {
  if (document.hidden || state.startupStage !== 'ready') return;
  let advanced = false;
  for (const id of listedProfileIds()) {
    const at = Number(state.activity[id]?.latestMtime) || 0;
    const known = listedActivityAt.get(id);
    if (known === undefined) listedActivityAt.set(id, at);
    else if (at > known) advanced = true;
  }
  if (!advanced) return;
  const now = Date.now();
  // Once per round: half a round apart, so a timer that fires a little early
  // never skips a round, and a second probe in the same round (the window
  // coming back to the front) does not reload twice.
  if (now - activitySessionRefreshAt < ACTIVITY_POLL_INTERVAL / 2) return;
  activitySessionRefreshAt = now;
  for (const id of listedProfileIds()) listedActivityAt.set(id, Number(state.activity[id]?.latestMtime) || 0);
  void loadSessions();
}

function refreshSessionsOnForeground() {
  if (document.hidden || state.startupStage !== 'ready') return;
  const now = Date.now();
  if (now - foregroundSessionRefreshAt < FOREGROUND_SESSION_REFRESH_INTERVAL) return;
  foregroundSessionRefreshAt = now;
  void loadSessions();
}

async function loadProfiles(preferredId = null, options = {}) {
  state.profiles = await window.manager.listProfiles();
  const liveIds = new Set(state.profiles.map((profile) => profile.id));
  state.quotas = Object.fromEntries(
    Object.entries(state.quotas).filter(([profileId]) => liveIds.has(profileId))
  );
  if (preferredId) {
    if (setProfileContext(preferredId)) persistUiSelectionMemory();
  } else if (!state.mesh.overview?.initialized && !currentAgentId() && state.profiles[0]) {
    // Pure-local mode keeps the released product's first-slot startup behavior.
    // Mesh mode intentionally starts with no implicit Agent selection.
    setProfileContext(state.profiles[0].id);
  } else if (
    state.mesh.overview?.initialized
    && !currentAgentId()
    && ['all', state.mesh.overview.localDeviceId].includes(currentDeviceLensId())
  ) {
    const selection = window.AgentWorkspace.resolveUnambiguousLocalSelection({
      overview: state.mesh.overview,
      profiles: state.profiles
    });
    if (selection) {
      state.ui = window.UiContext.setAgent(state.ui, selection.agentId, {
        slotKey: selection.slotKey
      });
      persistUiSelectionMemory();
    }
  }
  validateUiContext();
  if (options.presentFirstUseBeforeSessions === true) {
    // Profiles are the last fact required for migration preview. Present first
    // use before workspace rendering, session scans, TaskPackage history,
    // activity or quota work so none of those secondary tasks can strand a
    // fresh user on an empty workspace.
    state.startupStage = 'first-use-presenting';
    maybeShowWelcome();
    state.startupStage = els.welcomeDialog?.open
      ? 'first-use-presented'
      : 'first-use-not-required';
  }
  renderAccounts();
  renderAccountHeader();
  renderSessionControls();
  await loadSessions();
  renderAttentionInbox();
  // Profile edits invalidate the main-process cache. Refresh in the background
  // after the first quota request, without making profile/session UI wait.
  if (quotaHasLoaded) loadQuotas();
  // Mesh 目录由本机 Profile 派生；新增、编辑或删除运行位置后同步刷新设备摘要。
  if (options.skipDeviceOverview !== true) void loadDeviceOverview({ silent: true });
}

async function loadSessions() {
  const generation = ++sessionsLoadGeneration;
  if (!currentAgentId() && state.ui.agentScope === 'current') {
    // 没有选中的猫就是看全部：名册上高亮“全部”，不留一张要解释的空表。
    state.ui = window.UiContext.setAgentScope(state.ui, 'all');
    renderSessionControls();
    renderAccounts();
  }

  if (state.mesh.overview?.initialized && window.manager.listMeshSessions) {
    const keyState = state.mesh.overview?.keyState || 'available';
    const meshResult = keyState === 'available'
      ? await loadMeshSessions(null, { generation })
      : { ok: false, reasonCode: keyState };
    if (meshResult.ok || generation !== sessionsLoadGeneration) return;

    const lens = currentDeviceLensId();
    const canShowLocal = lens === 'all' || lens === state.mesh.overview.localDeviceId;
    if (canShowLocal) {
      const localResult = await loadLocalSessions({ source: 'local-fallback', generation });
      if (localResult.stale) return;
      state.mesh.sessionErrorCode = meshResult.reasonCode;
      setStatus(tr('status.sessionsLocalFallback', {
        n: localResult.count
      }), 'warning');
      return;
    }

    // A local fallback must never masquerade as the selected remote device.
    // Retain only rows already proven to belong to that lens; otherwise show
    // an honest empty result until the encrypted inventory is available.
    state.sessions = state.sessions.filter((row) => row._deviceId === lens && row._localFallback !== true);
    state.mesh.sessionSource = 'remote-unavailable';
    state.mesh.sessionErrorCode = meshResult.reasonCode;
    validateSessionContext();
    applySessionFilter();
    setStatus(tr('status.sessionsRemoteUnavailable', { code: meshResult.reasonCode }), 'warning');
    return;
  }

  await loadLocalSessions({ source: 'local', generation });
}

async function loadLocalSessions(options = {}) {
  const generation = options.generation ?? ++sessionsLoadGeneration;
  // 当前账号：合流同一登录身份的全部形态；全部账号：一次扫描所有身份组。
  // 每条记录都带归属槽位 + 账号组元数据，跨账号排序、选择和操作仍能回到正确槽位。
  const groups = identityGroups();
  const currentGroup = groups.find((group) => group.key === currentAgentId()) || null;
  const scopedGroups = state.ui.agentScope === 'all'
    ? groups
    : (currentGroup ? [currentGroup] : []);
  const localProfileIds = new Set(state.profiles.map((profile) => String(profile.id)));
  const descriptors = new Map();
  for (const group of scopedGroups) {
    for (const member of group.members) {
      if (!localProfileIds.has(String(member.id))) continue;
      descriptors.set(member.id, {
        member,
        accountKey: group.key,
        accountName: group.primary.name
      });
    }
  }

  // 一个槽位扫描失败只丢它自己的会话，不清空其它账号。
  const results = await Promise.all([...descriptors.values()].map(async (descriptor) => {
    const { member, accountKey, accountName } = descriptor;
    try {
      const records = await window.manager.listSessions(member);
      const owned = (Array.isArray(records) ? records : [])
        .map((record) => ({ ...record, _profileId: member.id }));
      return {
        ok: true,
        profileId: member.id,
        records: owned.map((record) => ({
          ...record,
          _accountKey: accountKey,
          _accountName: accountName,
          _profileName: member.name,
          _appLabel: appLabel(record.appId || member.appId),
          _agentId: accountKey,
          _accountBindingId: member._accountBindingId || null,
          _deviceId: member._meshDeviceId || state.mesh.overview?.localDeviceId || null,
          _deviceName: member._meshDeviceName || tr('devices.device.local'),
          _replicaId: member._meshDeviceId
            ? `${member._meshDeviceId}:${member.id}:${record.address || record.id || record.filePath || ''}`
            : null,
          _remote: false,
          _stale: false,
          _localFallback: options.source === 'local-fallback'
        }))
      };
    } catch (_error) {
      // A failed scan is not "no sessions": keep this account's last rows.
      return {
        ok: false,
        profileId: member.id,
        records: state.sessions.filter((row) => String(row._profileId) === String(member.id) && row._remote !== true)
      };
    }
  }));

  if (generation !== sessionsLoadGeneration) return { ok: true, stale: true, count: state.sessions.length };
  const loaded = results.flatMap((result) => result.records);

  state.sessions = loaded
    .sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    ));
  validateSessionContext();
  applySessionFilter();
  state.mesh.sessionSource = options.source === 'local-fallback' ? 'local-fallback' : 'local';
  if (options.source !== 'local-fallback') state.mesh.sessionErrorCode = null;
  return { ok: true, count: state.sessions.length };
}

async function loadMeshSessions(prefetchedRows = null, options = {}) {
  const generation = options.generation ?? ++sessionsLoadGeneration;
  let rows = Array.isArray(prefetchedRows) ? prefetchedRows : [];
  if (!Array.isArray(prefetchedRows)) {
    try {
      const result = await window.manager.listMeshSessions();
      if (generation !== sessionsLoadGeneration) return { ok: true, stale: true, count: state.sessions.length };
      if (!result?.ok || !Array.isArray(result.sessions)) {
        return { ok: false, reasonCode: result?.reasonCode || 'inventory-list-failed' };
      }
      rows = result.sessions;
    } catch (error) {
      return { ok: false, reasonCode: error?.message || 'inventory-list-failed' };
    }
  }
  const overview = state.mesh.overview;
  const lens = currentDeviceLensId();
  if (lens !== 'all') {
    rows = rows.flatMap((row) => {
      const replicas = (row.replicas || []).filter((item) => item.deviceId === lens);
      if (!replicas.length) return [];
      return [{ ...sessionAtReplica(row, replicas[0], overview), replicas }];
    });
  }
  if (state.ui.agentScope === 'current') {
    const agentId = currentAgentId();
    rows = agentId ? rows.filter((row) => row._agentId === agentId) : [];
  }
  state.sessions = rows.map((row) => enrichMeshSession(row, overview));
  state.mesh.sessionSource = 'mesh';
  state.mesh.sessionErrorCode = null;
  validateSessionContext();
  applySessionFilter();
  return { ok: true, count: state.sessions.length };
}

function sessionAtReplica(row, replica, overview) {
  const device = overview?.devices?.find((item) => item.deviceId === replica.deviceId);
  return {
    ...row,
    id: replica.adapterConversationKey || row.id,
    address: replica.adapterConversationKey || row.address,
    appId: replica.appId,
    title: replica.title,
    createdAt: replica.createdAt,
    updatedAt: replica.updatedAt,
    projectPath: replica.projectPathHint,
    filePath: replica.sourceFileHint,
    source: replica.source,
    status: replica.status,
    model: replica.model,
    _agentId: replica.agentId,
    _accountBindingId: replica.accountBindingId,
    _profileId: replica.profileId,
    _deviceId: replica.deviceId,
    _deviceName: replica.deviceName || device?.name || replica.deviceId,
    _replicaId: replica.replicaId,
    _remote: replica.deviceId !== overview?.localDeviceId,
    _stale: replica.stale === true
  };
}

function enrichMeshSession(row, overview) {
  const agent = overview?.agents?.find((item) => item.agentId === row._agentId);
  const slot = overview?.slots?.find((item) => (
    item.deviceId === row._deviceId && String(item.profileId) === String(row._profileId)
  ));
  const device = overview?.devices?.find((item) => item.deviceId === row._deviceId);
  return {
    ...row,
    _accountKey: row._agentId,
    _accountName: agent?.displayName || slot?.localLabel || '-',
    _profileName: slot?.localLabel || row._profileId,
    _appLabel: appLabel(row.appId || slot?.appId),
    _deviceName: row._deviceName || device?.name || row._deviceId
  };
}

// 合流列表里每条会话真正归属的槽位（操作要用它，不能用当前选中槽位）
function sessionOwnerProfile(session) {
  for (const group of identityGroups()) {
    const profile = group.members.find((item) => (
      String(item._meshProfileId || item.id) === String(session?._profileId)
      && (!session?._deviceId || item._meshDeviceId === session._deviceId)
    ));
    if (profile) return profile;
  }
  return selectedGroupProfile(identityGroups().find((group) => group.key === currentAgentId()) || null);
}

async function setSessionScope(scope) {
  const next = scope === 'all' ? 'all' : 'current';
  if (next === state.ui.agentScope) {
    renderSessionControls();
    return;
  }
  state.ui = window.UiContext.setAgentScope(state.ui, next);
  persistSettings({ sessionScope: next });
  renderSessionControls();
  await loadSessions();
}

let activityLoading = false;

let busySignature = '';

async function loadActivity() {
  if (activityLoading) return; // 上一轮还没回来就跳过，避免请求堆积
  activityLoading = true;
  let polled = false;
  try {
    const list = await window.manager.listActivity();
    state.activity = Object.fromEntries(list.map((item) => [item.profileId, item]));
    polled = true;
  } catch (_error) {
    // A failed probe is not "every cat idle": keep the last known activity.
  } finally {
    activityLoading = false;
  }
  if (polled) refreshSessionsOnActivity();
  // 新回复与在跑：探测结果交给会话记号；这一轮新冒出来的新回复交给声音层（它决定响不响）。
  const added = sessionMarks.updateFromActivity(Object.values(state.activity), hubWritingKeys());
  if (added > 0) document.dispatchEvent(new CustomEvent('agentdesk:replies', { detail: { added } }));
  const marksSignature = Object.values(state.activity)
    .map((item) => `${(item.writingKeys || []).join(',')};${(item.freshKeys || []).map((entry) => entry.key).join(',')}`)
    .join('|');
  const signature = Object.values(state.activity)
    .map((item) => `${item.profileId}:${item.activeNow || 0}:${item.writingNow ?? ''}`)
    .join('|');
  if (signature !== busySignature) {
    busySignature = signature;
    renderAccountHeader();
  } else {
    renderAccountRoster();
    renderTopbarContext();
  }
  if (marksSignature !== replySignature) {
    replySignature = marksSignature;
    applySessionFilter();
  }
  renderAttentionInbox();
}

let replySignature = '';

// 调度中枢正在跑的那几段：AgentDesk 亲手中转的，知道是哪一条会话就给它画“在跑”。
function hubWritingKeys() {
  const keys = [];
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state) || !run.session?.id || !run.target?.id) continue;
    keys.push(`${run.target.id}::${run.session.id}`);
  }
  return keys;
}

export { loadApps, appLabel, listedProfileIds, refreshSessionsOnActivity, refreshSessionsOnForeground, loadProfiles, loadSessions, loadLocalSessions, loadMeshSessions, sessionAtReplica, enrichMeshSession, sessionOwnerProfile, setSessionScope, loadActivity, hubWritingKeys };
