// AgentDesk — the Agent dossier dialog: its context and the run locations
// it lists (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js
// unchanged.

import { catalogAgentById } from './catalog-dialogs.js';
import { setStatus } from './common.js';
import { actionAgentId, currentProfileId, identityGroups, selectSlot, selectedProfile, setActionAgent } from './context.js';
import { appLabel, loadActivity, loadProfiles, loadSessions } from './data.js';
import { refreshRemoteInventoryForDevice } from './devices.js';
import { formatDiagnosticsText, lastDiagnostics, showDiagnostics } from './diagnostics.js';
import { openDialog } from './dialogs.js';
import { renderHubCalling } from './hub.js';
import { deploymentStateLabel } from './roster.js';
import { tr } from './settings.js';
import { els, state } from './shared.js';

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

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindAgentManageEvents() {
  els.pathConfigBtn.addEventListener('click', () => {
    const profile = selectedProfile();
    if (!profile) return;
    els.profilePathInput.value = profile.profilePath || '';
    els.sessionRootInput.value = profile.sessionRoot || '';
    els.executablePathInput.value = profile.executablePath || '';
    openDialog(els.pathDialog);
    els.profilePathInput.focus();
  });

  els.pickProfilePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: tr('picker.profileDir'),
      defaultPath: els.profilePathInput.value
    });
    if (picked) els.profilePathInput.value = picked;
  });

  els.pickSessionRootBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: tr('picker.sessionRoot'),
      defaultPath: els.sessionRootInput.value
    });
    if (picked) els.sessionRootInput.value = picked;
  });

  els.pickExecutablePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickFile({
      title: tr('picker.executable'),
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
      setStatus(tr('status.pathEmpty'));
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
    setStatus(tr('status.pathSaved'));
  });

  els.diagnosticsBtn.addEventListener('click', async () => {
    await showDiagnostics();
  });

  els.stopProfileBtn?.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    if (!window.confirm(tr('status.stopProfileConfirm', { name: profile.name }))) return;
    const result = await window.manager.stopProfile(profile.id);
    setStatus(result.ok
      ? tr('status.profileStopped', { name: profile.name })
      : tr('status.profileStopFailed', { code: result.reasonCode || 'profile-stop-failed' }));
    await loadActivity();
  });

  els.cleanCrashpadBtn?.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    if (!window.confirm(tr('status.cleanCrashpadConfirm', { name: profile.name }))) return;
    const result = await window.manager.cleanProfileCrashpad(profile.id);
    setStatus(result.ok
      ? tr('status.crashpadCleaned', { n: result.removedFiles || 0 })
      : tr('status.crashpadCleanFailed', { code: result.reasonCode || 'crashpad-clean-failed' }));
  });

  els.copyDiagnosticsBtn.addEventListener('click', async () => {
    if (!lastDiagnostics) return;
    await window.manager.writeClipboard(formatDiagnosticsText(lastDiagnostics));
    setStatus(tr('status.diagCopied'));
  });

  els.profileFolderBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    const result = await window.manager.openPath(profile.profilePath);
    setStatus(result.message || result.reason || (result.ok ? tr('status.openAcctDirOk') : tr('status.openAcctDirFail')));
  });

  els.refreshBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (profile?._remote === true && window.manager.refreshMeshInventory) {
      await refreshRemoteInventoryForDevice(profile._meshDeviceId);
      return;
    }
    await loadSessions();
    await loadActivity();
    setStatus(tr('status.refreshList'));
  });
}

export { renderAgentManageContext, agentManageLocationLabel, renderAgentManageLocations, openAgentManageDialog, openAgentDossier, bindAgentManageEvents };
