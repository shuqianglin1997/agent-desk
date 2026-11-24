// AgentDesk — the selection context: device lens, Agent, run location and
// profile, their validity checks, the top bar, and opening an Agent
// (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 11.11). Moved from
// src/renderer.js unchanged.

function currentDeviceLensId() {
  return state.ui.selectedDeviceLensId || 'all';
}

function currentAgentId() {
  return window.UiContext.selectedAgentId(state.ui);
}

// 卡片上的动作作用于哪只猫：档案或额度打开时可以不是正在看的那只，
// 这样在别的猫身上做事不会带动下面的会话列表。
function actionAgentId() {
  const id = state.actionAgentId;
  if (id && id !== currentAgentId() && identityGroups().some((group) => group.key === id)) return id;
  return currentAgentId();
}

function setActionAgent(agentId) {
  const next = agentId && agentId !== currentAgentId() ? agentId : null;
  if (state.actionAgentId === next) return;
  state.actionAgentId = next;
  renderAccountHeader();
}

function currentSlotKey() {
  return window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), actionAgentId());
}

function activeOutgoingRemoteSessions() {
  return state.mesh.remoteSessions.filter((item) => (
    item.direction === 'outgoing'
    && !['error', 'rejected', 'disconnected'].includes(item.state)
  ));
}

function currentProfileId() {
  const group = identityGroups().find((item) => item.key === actionAgentId());
  return cardActionProfile(group)?.id || null;
}

function updateUi(next) {
  state.ui = next;
}

function renderTopbarContext() {
  if (!els.topbarContext) return;
  const deviceContext = selectedDeviceLensLabel();
  if (state.ui.workspaceMode === 'remote') {
    const session = state.mesh.remoteSessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId)
      || state.mesh.remoteSessions.find((item) => item.direction === 'outgoing');
    els.topbarContext.textContent = [deviceContext, tr('remote.workspace.context', {
      name: session?.deviceName || '-'
    })].filter(Boolean).join(' · ');
    return;
  }
  const profile = selectedProfile();
  const selectedGroup = identityGroups().find((group) => group.key === currentAgentId()) || null;
  if (!profile) {
    const remoteCount = activeOutgoingRemoteSessions().length;
    els.topbarContext.textContent = [
      deviceContext,
      selectedGroup?.agent?.displayName || selectedGroup?.primary?.name || tr('ctx.noAgent'),
      selectedGroup ? deploymentStateLabel(selectedGroup.readiness?.state) : null,
      remoteCount ? tr('remote.workspace.activeCount', { n: remoteCount }) : null
    ].filter(Boolean).join(' · ');
    return;
  }
  const activityState = window.YardCats
    ? window.YardCats.deriveState(Date.now(), profile, state.activity[profile.id])
    : 'rest';
  const remoteCount = activeOutgoingRemoteSessions().length;
  els.topbarContext.textContent = [
    deviceContext,
    profile.name,
    tr('state.' + activityState),
    remoteCount ? tr('remote.workspace.activeCount', { n: remoteCount }) : null
  ].filter(Boolean).join(' · ');
}

// 账号身份分组：同一登录账号的多个槽位归为一组（identityKey 或指纹关联）。
// 庭院一只猫 = 一个账号组；会话与额度也按组聚合。
function identityGroups() {
  return identityGroupsForLens(currentDeviceLensId());
}

function identityGroupsForLens(lensId = 'all') {
  const overview = state.mesh.overview;
  if (overview?.initialized) {
    return window.AgentWorkspace.projectMeshAgentGroups({
      overview,
      profiles: state.profiles,
      lensId: lensId || 'all'
    });
  }
  if (!window.IdentityGroups) return state.profiles.map((profile) => ({ key: profile.id, primary: profile, members: [profile] }));
  return window.IdentityGroups.groupProfilesByIdentity(state.profiles);
}

function groupOfProfile(profileId) {
  if (!profileId) return null;
  return identityGroups().find((group) => group.members.some((member) => member.id === profileId)) || null;
}

function selectedGroupProfile(group) {
  if (!group) return null;
  const key = window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), group.key);
  return group.members.find((member) => member._meshSlotKey === key || member.id === key)
    || (group.members.length === 1 ? group.members[0] : null);
}

function preferredGroupSlot(group) {
  const key = window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), group.key);
  return preferredSlot(group.members, key);
}

function preferredSlot(members, key = currentSlotKey()) {
  return (members || []).find((member) => member._meshSlotKey === key || member.id === key)
    || (members || []).find((member) => !member._remote && member._deviceStatus !== 'offline')
    || (members || []).find((member) => member._deviceStatus === 'online')
    || (members || [])[0]
    || null;
}

function setProfileContext(profileId) {
  const group = groupOfProfile(profileId);
  if (!group) return false;
  const member = group.members.find((item) => item.id === profileId) || preferredSlot(group.members);
  if (!member) return false;
  if (state.actionAgentId && group.key === state.actionAgentId && group.key !== currentAgentId()) {
    // 正在别的猫的档案里做事：只更新它的运行位置，正在看的那只不变。
    state.ui = window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id);
    return true;
  }
  state.ui = window.UiContext.setAgent(state.ui, group.key, {
    slotKey: member._meshSlotKey || member.id
  });
  return true;
}

function setAgentContext(agentId) {
  const group = identityGroups().find((item) => item.key === agentId);
  if (!group) return false;
  const member = preferredGroupSlot(group);
  state.ui = window.UiContext.setAgent(state.ui, group.key, {
    slotKey: member?._meshSlotKey || member?.id || null
  });
  if (!member) state.ui = window.UiContext.setSlot(state.ui, null);
  return true;
}

function validateUiContext() {
  const overview = state.mesh.overview;
  if (!overview?.initialized) {
    const groups = identityGroupsForLens('all');
    const validAgentIdsByLens = { all: groups.map((group) => group.key) };
    const validSlotKeysByAgentAndLens = Object.fromEntries(groups.map((group) => [
      window.UiContext.slotMemoryKey('all', group.key),
      group.members.map((member) => member._meshSlotKey || member.id)
    ]));
    state.ui = window.UiContext.clearInvalid(state.ui, {
      validLensIds: ['all'],
      validAgentIdsByLens,
      validSlotKeysByAgentAndLens,
      validDeviceDetailIds: [],
      validRemoteSessionIds: []
    });
    return;
  }

  const lensIds = ['all', ...(overview.devices || []).map((device) => device.deviceId)];
  const validAgentIdsByLens = {};
  const validSlotKeysByAgentAndLens = {};
  for (const lens of lensIds) {
    const groups = identityGroupsForLens(lens);
    validAgentIdsByLens[lens] = groups.map((group) => group.key);
    for (const group of groups) {
      validSlotKeysByAgentAndLens[window.UiContext.slotMemoryKey(lens, group.key)] = group.members.map((member) => (
        member._meshSlotKey || member.id
      ));
    }
  }
  state.ui = window.UiContext.clearInvalid(state.ui, {
    validLensIds: lensIds,
    validAgentIdsByLens,
    validSlotKeysByAgentAndLens,
    validDeviceDetailIds: (overview.devices || []).map((device) => device.deviceId),
    validRemoteSessionIds: state.mesh.remoteSessions
      .filter((session) => session.direction === 'outgoing')
      .map((session) => session.sessionId)
  });
}

function validateSessionContext() {
  const validConversationIds = state.sessions.map(sessionKey);
  const validReplicaIdsByConversation = Object.fromEntries(state.sessions.map((session) => [
    sessionKey(session),
    (session.replicas || []).map((replica) => replica.replicaId)
  ]));
  state.ui = window.UiContext.clearInvalid(state.ui, {
    validConversationIds,
    validReplicaIdsByConversation
  });
}

async function selectDeviceLens(lensId) {
  const groups = identityGroupsForLens(lensId);
  updateUi(window.UiContext.setDeviceLens(state.ui, lensId, {
    validAgentIds: groups.map((group) => group.key)
  }));
  persistUiSelectionMemory();
  renderDeviceLens(state.mesh.overview);
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(lensId);
}

function selectedDeviceLensLabel() {
  const overview = state.mesh.overview;
  if (!overview?.initialized) return null;
  if (currentDeviceLensId() === 'all') return tr('devices.lens.all');
  return overview.devices?.find((device) => device.deviceId === currentDeviceLensId())?.name
    || tr('devices.lens.all');
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
  if (!setProfileContext(profileId)) return;
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

async function selectAgent(agentId) {
  if (!setAgentContext(agentId)) return;
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

function selectSlot(profileId) {
  const group = groupOfProfile(profileId);
  const member = group?.members.find((item) => item.id === profileId);
  if (!group || !member || group.key !== actionAgentId()) return;
  updateUi(window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id));
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
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

function provisioningChoiceKey(agentId, deviceId) {
  return `${String(agentId || '')}::${String(deviceId || '')}`;
}

function supportedProvisioningApps() {
  return Object.entries(state.appMeta)
    .filter(([, meta]) => meta.canProvision === true)
    .map(([appId, meta]) => ({
      appId,
      clientForm: meta.provisioningClientForm || 'desktop',
      label: meta.label || appId
    }));
}

function selectedProvisioningApp(group, deviceId, profile = null) {
  if (!group || !deviceId) return null;
  const remembered = state.mesh.provisioningAppByAgentAndDevice[
    provisioningChoiceKey(group.key, deviceId)
  ];
  const deployment = group.deployments?.find((item) => item.deviceId === deviceId) || null;
  const fromExistingSlot = (group.allMembers || group.members || []).find((member) => (
    member._meshDeviceId === deviceId && state.appMeta[member.appId]?.canProvision === true
  )) || (group.allMembers || group.members || []).find((member) => state.appMeta[member.appId]?.canProvision === true);
  const appId = profile?.appId
    || remembered?.appId
    || deployment?.adapterId
    || group.blueprint?.preferredAppId
    || fromExistingSlot?.appId
    || null;
  if (!appId) return null;
  return {
    appId,
    clientForm: remembered?.clientForm
      || profile?._clientForm
      || group.blueprint?.preferredClientForm
      || 'desktop'
  };
}

function currentAgentActionContext(group = null, profile = selectedProfile()) {
  const selectedGroup = group || identityGroups().find((item) => item.key === actionAgentId()) || null;
  const overview = state.mesh.overview;
  if (!overview?.initialized || !selectedGroup) {
    return { group: selectedGroup, profile, meshMode: false };
  }
  const lensId = currentDeviceLensId();
  const deviceId = profile?._meshDeviceId
    || (lensId !== 'all' ? lensId : overview.localDeviceId);
  const device = (overview.devices || []).find((item) => item.deviceId === deviceId) || null;
  const deployment = (selectedGroup.deployments || []).find((item) => item.deviceId === deviceId) || null;
  const readiness = window.AgentWorkspace.resolveReadiness({
    overview,
    agentId: selectedGroup.key,
    lensId: deviceId,
    deployments: selectedGroup.deployments,
    allMembers: selectedGroup.allMembers,
    members: (selectedGroup.allMembers || []).filter((member) => member._meshDeviceId === deviceId)
  });
  const requested = selectedProvisioningApp(selectedGroup, deviceId, profile);
  const activeJob = (overview.provisioningJobs || []).find((job) => (
    job.agentId === selectedGroup.key
    && job.deviceId === deviceId
    && (!requested?.appId || job.requestedAppId === requested.appId)
  )) || null;
  return {
    meshMode: true,
    group: selectedGroup,
    profile,
    agent: selectedGroup.agent,
    device,
    deviceId,
    deployment,
    readiness,
    requested,
    activeJob,
    isRemote: deviceId !== overview.localDeviceId,
    busy: state.mesh.provisioningBusyKey === provisioningChoiceKey(selectedGroup.key, deviceId)
  };
}

function rememberProvisioningChoice(group, deviceId, appId, clientForm = 'desktop') {
  if (!group || !deviceId || !appId) return;
  state.mesh.provisioningAppByAgentAndDevice = {
    ...state.mesh.provisioningAppByAgentAndDevice,
    [provisioningChoiceKey(group.key, deviceId)]: { appId, clientForm }
  };
}

function provisioningButtonLabel(action) {
  if (action?.busy) return tr('deployment.action.preparing');
  const deploymentState = action?.readiness?.state || 'absent';
  if (deploymentState === 'ready' && action.profile) return tr('account.open');
  if (deploymentState === 'waiting-login') return tr('deployment.action.continueLogin');
  if (deploymentState === 'waiting-install') return tr('deployment.action.continueInstall');
  if (deploymentState === 'error' || deploymentState === 'unsupported') return tr('deployment.action.retry');
  if (window.AgentWorkspace?.isPreparationActive(deploymentState)) return tr('deployment.action.continue');
  return tr('deployment.action.firstOpen');
}

function provisioningResultMessage(result = {}, name = null) {
  const agentName = name || currentAgentActionContext()?.agent?.displayName || tr('account.noneAgent');
  if (result.state === 'ready' && result.ok) return tr('status.opened', { name: agentName });
  if (result.state === 'waiting-install') return tr('status.provisioning.waitingInstall', { name: agentName });
  if (result.state === 'waiting-login') return tr('status.provisioning.waitingLogin', { name: agentName });
  if (result.state === 'verifying') return tr('status.provisioning.verifying', { name: agentName });
  if (result.state === 'waiting-consent') return tr('status.provisioning.waitingConsent', { name: agentName });
  if (result.state === 'planning' || result.state === 'preparing') {
    return tr('status.provisioning.preparing', { name: agentName });
  }
  if (result.reasonCode === 'provisioning-client-required') return tr('status.provisioning.chooseClient');
  if (result.reasonCode === 'target-declined') return tr('status.provisioning.targetDeclined');
  if (String(result.reasonCode || '').startsWith('capability-denied:')) {
    return tr('status.provisioning.remotePermission');
  }
  if (String(result.reasonCode || '').startsWith('capability-unsupported:')) {
    return tr('status.provisioning.remoteUnsupported');
  }
  return tr('status.provisioning.failed', { code: result.reasonCode || result.reason || 'provisioning-failed' });
}

// 打开落在这只猫卡片上显示的那个运行位置。它不是正在看的那只时，
// 刷新账号数据但不把选择带过去，所以下面的会话列表不会跟着变。
async function openAgent(agentId) {
  const group = identityGroups().find((item) => item.key === agentId) || null;
  if (!group) return { ok: false, reasonCode: 'agent-required' };
  const profile = cardActionProfile(group);
  const viewing = agentId === currentAgentId();
  const reselect = (profileId) => (viewing ? profileId : null);
  const meshMode = state.mesh.overview?.initialized === true;
  if (!meshMode) {
    if (!profile) return { ok: false, reasonCode: 'profile-required' };
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.openFail'));
      return result;
    }
    await loadProfiles(reselect(profile.id));
    setStatus(result.warning || tr('status.opened', { name: profile.name }));
    return result;
  }

  const action = currentAgentActionContext(group, profile);
  if (!action.agent || !action.deviceId) return { ok: false, reasonCode: 'agent-required' };
  if (!action.requested?.appId) {
    const result = { ok: false, reasonCode: 'provisioning-client-required' };
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    accountCardControl(agentId, '.account-card-runtime select')?.focus();
    return result;
  }
  if (action.isRemote) {
    const busyKey = provisioningChoiceKey(action.group.key, action.deviceId);
    if (state.mesh.provisioningBusyKey === busyKey) return { ok: false, reasonCode: 'provisioning-busy' };
    state.mesh.provisioningBusyKey = busyKey;
    renderAccountHeader();
    let result;
    try {
      result = profile
        ? await window.manager.launchRemoteAgent({
            agentId: action.group.key,
            deviceId: action.deviceId,
            profileId: profile.id
          })
        : await window.manager.prepareRemoteAgent({
            agentId: action.group.key,
            deviceId: action.deviceId,
            requestedAppId: action.requested.appId,
            requestedClientForm: action.requested.clientForm || 'desktop'
          });
      if (result?.overview) state.mesh.overview = result.overview;
      validateUiContext();
      renderAccounts();
      renderDeviceCenter();
      setStatus(provisioningResultMessage(result, action.agent.displayName));
      if (result?.state === 'ready') requestDeviceOverviewReload();
      return result;
    } catch (error) {
      result = { ok: false, reasonCode: error?.message || 'remote-agent-action-failed' };
      setStatus(provisioningResultMessage(result, action.agent.displayName));
      return result;
    } finally {
      if (state.mesh.provisioningBusyKey === busyKey) state.mesh.provisioningBusyKey = null;
      renderAccountHeader();
    }
  }

  if (profile && state.appMeta[profile.appId]?.canProvision !== true) {
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.openFail'));
      return result;
    }
    await loadProfiles(reselect(profile.id));
    setStatus(result.warning || tr('status.opened', { name: action.agent.displayName }));
    return result;
  }

  const busyKey = provisioningChoiceKey(action.group.key, action.deviceId);
  if (state.mesh.provisioningBusyKey === busyKey) return { ok: false, reasonCode: 'provisioning-busy' };
  state.mesh.provisioningBusyKey = busyKey;
  renderAccountHeader();
  let result;
  try {
    result = await window.manager.ensureAgentReady({
      agentId: action.group.key,
      deviceId: action.deviceId,
      requestedAppId: action.requested.appId,
      requestedClientForm: action.requested.clientForm || 'desktop'
    });
    if (result?.overview) state.mesh.overview = result.overview;
    if (result?.state === 'ready') {
      await loadProfiles(reselect(result.slot?.profileId || profile?.id || null));
    } else {
      await loadDeviceOverview({ silent: true });
    }
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    return result;
  } catch (error) {
    result = { ok: false, reasonCode: error?.message || 'provisioning-failed' };
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    return result;
  } finally {
    if (state.mesh.provisioningBusyKey === busyKey) state.mesh.provisioningBusyKey = null;
    renderAccountHeader();
  }
}

function selectedProfile() {
  const profileId = currentProfileId();
  for (const group of identityGroups()) {
    const profile = group.members.find((member) => member.id === profileId);
    if (profile) return profile;
  }
  return null;
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { currentDeviceLensId, currentAgentId, actionAgentId, setActionAgent, currentSlotKey, activeOutgoingRemoteSessions, currentProfileId, updateUi, renderTopbarContext, identityGroups, identityGroupsForLens, groupOfProfile, selectedGroupProfile, preferredGroupSlot, preferredSlot, setProfileContext, setAgentContext, validateUiContext, validateSessionContext, selectDeviceLens, selectedDeviceLensLabel, populateIdentityDatalist, selectProfile, selectAgent, selectSlot, populateGroupDatalist, provisioningChoiceKey, supportedProvisioningApps, selectedProvisioningApp, currentAgentActionContext, rememberProvisioningChoice, provisioningButtonLabel, provisioningResultMessage, openAgent, selectedProfile };
Object.assign(window, { currentDeviceLensId, currentAgentId, actionAgentId, setActionAgent, currentSlotKey, activeOutgoingRemoteSessions, currentProfileId, updateUi, renderTopbarContext, identityGroups, identityGroupsForLens, groupOfProfile, selectedGroupProfile, preferredGroupSlot, preferredSlot, setProfileContext, setAgentContext, validateUiContext, validateSessionContext, selectDeviceLens, selectedDeviceLensLabel, populateIdentityDatalist, selectProfile, selectAgent, selectSlot, populateGroupDatalist, provisioningChoiceKey, supportedProvisioningApps, selectedProvisioningApp, currentAgentActionContext, rememberProvisioningChoice, provisioningButtonLabel, provisioningResultMessage, openAgent, selectedProfile });
