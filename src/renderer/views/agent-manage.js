// AgentDesk — the Agent dossier dialog: its context and the run locations
// it lists (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js
// unchanged.

// 猫的档案：一页五段（资料、位置、账号、调用、送走）。位置段列出这只猫在当前设备视角下的每个运行位置，
// 展开哪个，下面那排动作就作用于哪个；子流程叠在档案上面，做完回到这一页。
function renderAgentManageContext() {
  const group = identityGroups().find((item) => item.key === actionAgentId()) || null;
  if (els.agentManageDialog?.open && !group) {
    // 这只猫已经不在了（被送走或并入别的猫）。
    els.agentManageDialog.close();
    return;
  }
  const profile = selectedProfile();
  const localProfile = Boolean(profile && profile._remote !== true);
  const agent = catalogAgentById(actionAgentId());
  const agentName = agent?.displayName || group?.primary?.name || profile?.name || tr('account.noneAgent');
  if (els.agentManageName) els.agentManageName.textContent = agentName;
  if (els.agentManageSummary) els.agentManageSummary.textContent = tr('account.manageHint');
  renderAgentManageLocations(group, profile);
  renderHubCalling(group, profile);
  if (els.agentManageAccountsNote) {
    els.agentManageAccountsNote.hidden = state.mesh.overview?.initialized === true;
  }
  if (els.stopProfileBtn) els.stopProfileBtn.disabled = !localProfile;
  if (els.cleanCrashpadBtn) els.cleanCrashpadBtn.disabled = !localProfile;
}

function agentManageLocationLabel(member) {
  const device = member._remote ? member._meshDeviceName : tr('devices.device.local');
  return [device, appLabel(member.appId), member.name].filter(Boolean).join(' · ');
}

function renderAgentManageLocations(group, profile) {
  const list = els.agentManageLocations;
  const actions = els.yardManageActions;
  if (!list || !actions) return;
  const members = group?.members || [];
  if (els.agentManageRuntimeLabel) {
    // 有位置时下面的行已经写明了，段标题旁只在还没有位置时说明状态。
    els.agentManageRuntimeLabel.textContent = members.length
      ? ''
      : (group ? deploymentStateLabel(group.readiness?.state) : tr('devices.slot.choose'));
  }
  // 先把共用的那排动作挪回段尾，再重建位置行，避免它跟着旧行一起被移除。
  list.after(actions);
  list.replaceChildren();
  for (const member of members) {
    const expanded = Boolean(profile && member.id === profile.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dossier-location';
    row.dataset.profileId = member.id;
    row.setAttribute('aria-expanded', String(expanded));
    row.setAttribute('aria-controls', 'yardManageActions');
    const label = document.createElement('span');
    label.textContent = agentManageLocationLabel(member);
    const hint = document.createElement('small');
    hint.textContent = member._remote
      ? tr(member._deviceStatus === 'online' ? 'dossier.location.remoteOnline' : 'dossier.location.remoteOffline')
      : tr('dossier.location.local');
    const toggle = document.createElement('b');
    toggle.textContent = tr(expanded ? 'dossier.location.expanded' : 'dossier.location.expand');
    row.append(label, hint, toggle);
    row.addEventListener('click', () => {
      if (member.id !== currentProfileId()) selectSlot(member.id);
      renderAgentManageContext();
      els.agentManageLocations.querySelector('[aria-expanded="true"]')?.focus({ preventScroll: true });
    });
    list.append(row);
    if (expanded) row.after(actions);
  }
  actions.hidden = !profile;
  if (els.agentManageNoLocation) {
    els.agentManageNoLocation.hidden = members.length > 0;
    els.agentManageNoLocation.textContent = group
      ? tr('dossier.location.none', { state: deploymentStateLabel(group.readiness?.state) })
      : '';
  }
}

function openAgentManageDialog() {
  if (!els.agentManageDialog) return;
  if (els.agentManageStatus) els.agentManageStatus.textContent = '';
  renderAgentManageContext();
  if (!els.agentManageDialog.open) openDialog(els.agentManageDialog);
}

// 从卡片打开档案：作用于这只猫，不选中它，所以正在看的会话列表不变。
function openAgentDossier(agentId) {
  if (!identityGroups().some((group) => group.key === agentId)) return;
  els.quotaPopover?.hidePopover();
  setActionAgent(agentId);
  openAgentManageDialog();
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { renderAgentManageContext, agentManageLocationLabel, renderAgentManageLocations, openAgentManageDialog, openAgentDossier };
Object.assign(window, { renderAgentManageContext, agentManageLocationLabel, renderAgentManageLocations, openAgentManageDialog, openAgentDossier });
