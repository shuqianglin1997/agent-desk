// AgentDesk — the Agent catalog dialogs: create an Agent, register a
// location, edit, remove (location, binding, Agent), merge and split, and
// assign a Slot (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 10.9, 11.6).
// Moved from src/renderer.js unchanged.

// Each binding records the client's providerNamespace, declared by its adapter
// and sent with the app list; an id this build does not know (a remote client)
// keeps its own name, as in Main (src/mesh/domain/agent-catalog.js).
function catalogProviderForApp(appId) {
  const value = String(appId || '').trim().toLowerCase();
  return state.appMeta?.[value]?.providerNamespace || value || 'unknown';
}

function catalogSlotKey(slot) {
  return slot ? `${slot.deviceId}:${slot.profileId}` : '';
}

function catalogSlotByKey(slotKey) {
  return (state.mesh.overview?.slots || []).find((slot) => catalogSlotKey(slot) === slotKey) || null;
}

function catalogAgentById(agentId) {
  return (state.mesh.overview?.agents || []).find((agent) => agent.agentId === agentId) || null;
}

function catalogBindingById(accountBindingId) {
  return (state.mesh.overview?.accountBindings || []).find((binding) => (
    binding.accountBindingId === accountBindingId
  )) || null;
}

function currentCatalogRevision() {
  return Number(state.mesh.overview?.mesh?.catalogRevision) || 0;
}

function appendSelectOption(select, value, label, options = {}) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.disabled = options.disabled === true;
  select.append(option);
  return option;
}

function fillAgentAssignmentSelect(select, preferredAgentId = null, excludeAgentId = null) {
  if (!select) return [];
  const previous = preferredAgentId || select.value;
  const agents = (state.mesh.overview?.agents || []).filter((agent) => agent.agentId !== excludeAgentId);
  select.replaceChildren();
  appendSelectOption(select, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const agent of agents) appendSelectOption(select, agent.agentId, agent.displayName);
  if (!agents.length) {
    select.options[0].textContent = tr('catalog.assignment.noAgent');
    select.value = '';
    return agents;
  }
  select.value = agents.some((agent) => agent.agentId === previous) ? previous : '';
  return agents;
}

function bindingOptionLabel(binding) {
  const agent = catalogAgentById(binding.agentId);
  return [agent?.displayName, binding.providerNamespace, binding.displayAlias].filter(Boolean).join(' · ');
}

function fillBindingAssignmentSelect(select, appId, preferredBindingId = null) {
  if (!select) return [];
  const previous = preferredBindingId || select.value;
  const provider = catalogProviderForApp(appId);
  const bindings = (state.mesh.overview?.accountBindings || []).filter((binding) => (
    binding.providerNamespace === provider
  ));
  select.replaceChildren();
  appendSelectOption(select, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const binding of bindings) {
    appendSelectOption(select, binding.accountBindingId, bindingOptionLabel(binding));
  }
  if (!bindings.length) {
    select.options[0].textContent = tr('catalog.assignment.noCompatibleBinding');
    select.value = '';
    return bindings;
  }
  select.value = bindings.some((binding) => binding.accountBindingId === previous)
    ? previous
    : '';
  return bindings;
}

function openAgentCreationDialog() {
  if (!state.mesh.overview?.initialized || !els.agentCreateDialog) return;
  els.newAgentName.value = '';
  els.newAgentGroup.value = '';
  els.newAgentNote.value = '';
  els.newAgentApp.replaceChildren();
  for (const app of supportedProvisioningApps()) {
    const option = document.createElement('option');
    option.value = app.appId;
    option.textContent = app.label;
    els.newAgentApp.append(option);
  }
  els.confirmAddAgentBtn.disabled = !els.newAgentApp.value;
  openDialog(els.agentCreateDialog);
  els.newAgentName.focus();
}

async function confirmAgentCreation() {
  const displayName = els.newAgentName.value.trim();
  if (!displayName) {
    setStatus(tr('status.agentNameFirst'));
    els.newAgentName.focus();
    return;
  }
  const requestedAppId = els.newAgentApp.value;
  if (!state.appMeta[requestedAppId]?.canProvision) return;
  els.confirmAddAgentBtn.disabled = true;
  try {
    const message = await createAgentAndPrepare({
      displayName,
      requestedAppId,
      group: els.newAgentGroup.value,
      note: els.newAgentNote.value,
      onCreated: () => els.agentCreateDialog.close()
    });
    setStatus(message);
  } finally {
    if (els.agentCreateDialog.open) els.confirmAddAgentBtn.disabled = false;
  }
}

// 新建全局 Agent 并在本机首次准备（打开官方客户端登录）。返回给用户看的一句话。
async function createAgentAndPrepare({ displayName, requestedAppId, group = '', note = '', onCreated = null }) {
  if (!state.appMeta[requestedAppId]?.canProvision) return tr('catalog.error.generic', { code: 'client-form-unsupported' });
  try {
    const result = await window.manager.createAgent({
      displayName,
      group,
      note,
      baseRevision: currentCatalogRevision()
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'agent-create-failed');
    onCreated?.();
    // The dialog explicitly prepares on this device, including when opened from a remote Lens.
    const agentId = result.agent.agentId;
    const deviceId = result.overview.localDeviceId;
    await refreshCatalogWorkspace(result.overview, { agentId, deviceLensId: deviceId });
    rememberProvisioningChoice({ key: agentId }, deviceId, requestedAppId);
    const preparation = await window.manager.ensureAgentReady({
      agentId, deviceId, requestedAppId, requestedClientForm: 'desktop'
    });
    if (preparation?.overview) await refreshCatalogWorkspace(preparation.overview, { agentId });
    return provisioningResultMessage(preparation, result.agent.displayName);
  } catch (error) {
    return tr('catalog.error.generic', { code: error?.message || 'agent-create-failed' });
  }
}

// 招募里登记、导入或新建成功之后：首次使用中途进来的就记下完成并收起首次使用，
// 刷新设备视角和账号列表，选中这个账号。
async function afterRecruitedAccount(profileId) {
  try {
    if (els.welcomeDialog?.open && state.firstUse.mode === 'onboarding') {
      const patch = window.OnboardingState.localImportCompletionPatch(state.firstUse.model);
      if (patch) recordFirstUseCompletion(patch);
      els.welcomeDialog.close();
    }
    if (state.mesh.overview?.initialized) {
      await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
      const localDeviceId = state.mesh.overview?.localDeviceId;
      if (localDeviceId && !['all', localDeviceId].includes(currentDeviceLensId())) {
        state.ui = window.UiContext.setDeviceLens(state.ui, localDeviceId);
        renderDeviceLens(state.mesh.overview);
      }
    }
    await loadProfiles(profileId || null);
  } catch (_error) {
    setStatus(tr('codexImport.refreshError'));
  }
}

function openProfileCreationDialog(options = {}) {
  const meshMode = state.mesh.overview?.initialized === true;
  els.profileDialogTitle.textContent = tr(meshMode ? 'dialog.addProfile.slotTitle' : 'dialog.addProfile.title');
  els.newProfileMeshAssignment.hidden = !meshMode;
  els.newProfileApp.value = selectedProfile()?.appId
    || (els.newProfileApp.options[0] ? els.newProfileApp.options[0].value : 'claude');
  els.newProfileName.value = '';
  els.newProfileGroup.value = '';
  els.newProfileNote.value = '';
  if (meshMode) {
    els.newProfileMode.value = options.agentId ? 'existing-agent' : '';
    els.newProfileAgent.value = options.agentId || '';
    els.newProfileBinding.value = '';
  }
  syncProfileAssignmentControls();
  if (meshMode && options.agentId) {
    els.newProfileAgent.value = options.agentId;
    syncProfileAssignmentControls();
  }
  openDialog(els.profileDialog);
  (meshMode && !options.agentId ? els.newProfileMode : els.newProfileName).focus();
}

function syncProfileAssignmentControls() {
  const meshMode = state.mesh.overview?.initialized === true;
  if (!meshMode) {
    els.newProfileMeshAssignment.hidden = true;
    els.confirmAddProfileBtn.disabled = false;
    return;
  }
  els.newProfileMeshAssignment.hidden = false;
  const mode = els.newProfileMode.value;
  const agents = fillAgentAssignmentSelect(els.newProfileAgent);
  const bindings = fillBindingAssignmentSelect(els.newProfileBinding, els.newProfileApp.value);
  els.newProfileAgentField.hidden = mode !== 'existing-agent';
  els.newProfileBindingField.hidden = mode !== 'existing-binding';
  const hintKey = {
    'new-agent': 'catalog.assignment.hintNew',
    'existing-agent': agents.length ? 'catalog.assignment.hintExistingAgent' : 'catalog.assignment.noAgent',
    'existing-binding': bindings.length
      ? 'catalog.assignment.hintExistingBinding'
      : 'catalog.assignment.noCompatibleBinding'
  }[mode];
  els.newProfileAssignmentHint.textContent = hintKey ? tr(hintKey) : '';
  els.confirmAddProfileBtn.disabled = !mode
    || (mode === 'existing-agent' && !els.newProfileAgent.value)
    || (mode === 'existing-binding' && !els.newProfileBinding.value);
}

async function confirmProfileCreation() {
  const name = els.newProfileName.value.trim();
  if (!name) {
    setStatus(tr('status.nameFirst'));
    els.newProfileName.focus();
    return;
  }
  const meshMode = state.mesh.overview?.initialized === true;
  const mode = els.newProfileMode.value;
  if (meshMode && !mode) {
    setStatus(tr('catalog.add.choiceTitle'));
    els.newProfileMode.focus();
    return;
  }
  els.confirmAddProfileBtn.disabled = true;
  try {
    if (!meshMode) {
      const profile = await window.manager.addProfile({
        appId: els.newProfileApp.value,
        name,
        group: els.newProfileGroup.value,
        note: els.newProfileNote.value
      });
      els.profileDialog.close();
      await loadProfiles(profile.id);
      setStatus(tr('status.created', { name: profile.name }));
      return;
    }

    const result = await window.manager.addLocalAgentSlot({
      appId: els.newProfileApp.value,
      name,
      group: els.newProfileGroup.value,
      note: els.newProfileNote.value,
      mode,
      agentId: mode === 'existing-agent' ? els.newProfileAgent.value : undefined,
      accountBindingId: mode === 'existing-binding' ? els.newProfileBinding.value : undefined
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'slot-add-failed');
    state.mesh.overview = result.overview;
    els.profileDialog.close();
    await loadProfiles(result.profile.id);
    setStatus(tr('catalog.status.created'));
  } catch (error) {
    setStatus(tr('catalog.error.generic', { code: error?.message || 'slot-add-failed' }));
  } finally {
    if (els.profileDialog.open) syncProfileAssignmentControls();
  }
}

function openAgentOrProfileEditor() {
  const meshMode = state.mesh.overview?.initialized === true;
  if (meshMode) {
    const agent = catalogAgentById(actionAgentId());
    if (!agent) return;
    const profile = selectedProfile();
    const group = identityGroups().find((item) => item.key === agent.agentId);
    state.mesh.editingAgentId = agent.agentId;
    els.editDialogTitle.textContent = tr('catalog.edit.title');
    els.editAgentHint.hidden = false;
    els.editAgentHint.textContent = tr('catalog.edit.hint');
    els.editIdentityField.hidden = true;
    els.editName.value = agent.displayName;
    els.editGroup.value = agent.group || '';
    els.editIdentity.value = '';
    els.editNote.value = agent.note || '';
    openCatCustomizer({
      id: group?.primary?.id || agent.agentId,
      appId: profile?.appId || group?.primary?.appId || 'unknown',
      cat: agent.catAppearance || group?.primary?.cat || null,
      isProtected: false
    });
  } else {
    const profile = selectedProfile();
    if (!profile) return;
    state.mesh.editingAgentId = null;
    els.editDialogTitle.textContent = tr('dialog.editProfile.title');
    els.editAgentHint.hidden = true;
    els.editIdentityField.hidden = false;
    els.editName.value = profile.name;
    els.editGroup.value = profile.group || '';
    els.editIdentity.value = profile.identityKey || '';
    els.editNote.value = profile.note || '';
    populateIdentityDatalist();
    openCatCustomizer(profile);
  }
  openDialog(els.editDialog);
  els.editName.focus();
}

async function confirmAgentOrProfileEdit() {
  const name = els.editName.value.trim();
  if (!name) {
    setStatus(tr('status.nameEmpty'));
    els.editName.focus();
    return;
  }
  if (state.mesh.overview?.initialized && state.mesh.editingAgentId) {
    const result = await window.manager.renameAgent({
      agentId: state.mesh.editingAgentId,
      displayName: name,
      group: els.editGroup.value,
      note: els.editNote.value,
      catAppearance: storedCatDraft(),
      baseRevision: currentCatalogRevision()
    });
    if (!result?.ok) {
      setStatus(tr('catalog.error.generic', { code: result?.reasonCode || 'agent-update-failed' }));
      return;
    }
    const agentId = state.mesh.editingAgentId;
    state.mesh.editingAgentId = null;
    els.editDialog.close();
    await refreshCatalogWorkspace(result.overview, { agentId });
    setStatus(tr('catalog.status.saved'));
    return;
  }

  const profile = selectedProfile();
  if (!profile) return;
  await window.manager.updateProfile({
    id: profile.id,
    name,
    group: els.editGroup.value,
    identityKey: els.editIdentity.value,
    note: els.editNote.value,
    cat: storedCatDraft()
  });
  els.editDialog.close();
  await loadProfiles(profile.id);
  setStatus(tr('status.savedProfileCat'));
}

async function refreshCatalogWorkspace(overview, options = {}) {
  state.mesh.overview = overview;
  if (options.deviceLensId) {
    state.ui = window.UiContext.setDeviceLens(state.ui, options.deviceLensId, {
      validAgentIds: identityGroupsForLens(options.deviceLensId).map((group) => group.key)
    });
    renderDeviceLens(overview);
  }
  if (options.agentId && catalogAgentById(options.agentId)) {
    const group = identityGroupsForLens(currentDeviceLensId()).find((item) => item.key === options.agentId);
    const member = (group?.members || []).find((item) => item._meshSlotKey === options.slotKey)
      || preferredSlot(group?.members || []);
    if (group) {
      state.ui = window.UiContext.setAgent(state.ui, group.key, {
        slotKey: member?._meshSlotKey || member?.id
      });
      if (!member) state.ui = window.UiContext.setSlot(state.ui, null);
      persistUiSelectionMemory();
    }
  }
  validateUiContext();
  renderDeviceCenter();
  renderAccounts();
  renderAccountHeader();
  renderSessionControls();
  await loadSessions();
  renderAttentionInbox();
}

async function openAgentOrProfileRemoval() {
  const profile = selectedProfile();
  if (!state.mesh.overview?.initialized) {
    if (!profile) return;
    if (!window.confirm(tr('status.removeConfirm', { name: profile.name }))) return;
    const result = await window.manager.removeProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.removeFail'));
      return;
    }
    await loadProfiles();
    setStatus(tr('status.removedSlot'));
    return;
  }

  const agent = catalogAgentById(actionAgentId());
  if (!agent) return;
  const slot = catalogSlotByKey(profile?._meshSlotKey || currentSlotKey());
  state.mesh.removingAgentId = agent.agentId;
  state.mesh.removingSlotKey = slot ? catalogSlotKey(slot) : null;
  els.removeCatalogIntro.textContent = tr('catalog.remove.intro', { name: agent.displayName });
  const radios = [...els.removeCatalogDialog.querySelectorAll('input[name="catalogRemoveScope"]')];
  const bindingRadio = radios.find((radio) => radio.value === 'account-binding');
  if (bindingRadio) bindingRadio.disabled = !slot?.accountBindingId;
  const slotRadio = radios.find((radio) => radio.value === 'slot');
  if (slotRadio) slotRadio.disabled = !slot;
  const agentRadio = radios.find((radio) => radio.value === 'agent');
  if (slotRadio && slot) slotRadio.checked = true;
  else if (agentRadio) agentRadio.checked = true;
  els.removeLocalRegistration.checked = false;
  renderCatalogRemovalImpact();
  openDialog(els.removeCatalogDialog);
}

function catalogRemovalContext() {
  const overview = state.mesh.overview;
  const agent = catalogAgentById(state.mesh.removingAgentId);
  const slot = catalogSlotByKey(state.mesh.removingSlotKey);
  const binding = catalogBindingById(slot?.accountBindingId);
  const agentSlots = (overview?.slots || []).filter((item) => item.agentId === agent?.agentId);
  const bindingSlots = (overview?.slots || []).filter((item) => item.accountBindingId === binding?.accountBindingId);
  const bindings = (overview?.accountBindings || []).filter((item) => item.agentId === agent?.agentId);
  return { overview, agent, slot, binding, agentSlots, bindingSlots, bindings };
}

function renderCatalogRemovalImpact() {
  const context = catalogRemovalContext();
  if (!context.agent) return;
  let scope = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"]:checked')?.value || 'agent';
  if (!context.slot && scope !== 'agent') {
    scope = 'agent';
    const agentRadio = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"][value="agent"]');
    if (agentRadio) agentRadio.checked = true;
  }
  const devices = new Map((context.overview.devices || []).map((device) => [device.deviceId, device]));
  const affectedSlots = scope === 'agent'
    ? context.agentSlots
    : (scope === 'account-binding' ? context.bindingSlots : [context.slot]);
  const deviceCount = new Set(affectedSlots.map((slot) => slot.deviceId)).size;
  const sessionCount = affectedSlots.reduce((sum, slot) => sum + (Number(slot.sessionCount) || 0), 0);
  let message;
  if (scope === 'agent') {
    message = tr('catalog.remove.impactAgent', {
      name: context.agent.displayName,
      bindings: context.bindings.length,
      devices: deviceCount,
      slots: affectedSlots.length,
      sessions: sessionCount
    });
  } else if (scope === 'account-binding') {
    message = tr('catalog.remove.impactBinding', {
      binding: context.binding?.displayAlias || context.binding?.providerNamespace || '-',
      devices: deviceCount,
      slots: affectedSlots.length,
      sessions: sessionCount
    });
  } else {
    message = tr('catalog.remove.impactSlot', {
      device: devices.get(context.slot.deviceId)?.name || context.slot.deviceId,
      app: appLabel(context.slot.appId)
    });
  }
  const remaining = context.agentSlots.filter((slot) => !affectedSlots.includes(slot));
  if (scope !== 'agent' && remaining.length === 0) message += ` ${tr('catalog.remove.disappear')}`;
  els.removeCatalogImpact.dataset.state = 'idle';
  els.removeCatalogImpact.textContent = message;
  const localSlot = context.slot?.deviceId === context.overview.localDeviceId;
  els.removeLocalRegistrationField.hidden = !(scope === 'slot' && localSlot);
  if (scope !== 'slot') els.removeLocalRegistration.checked = false;
}

async function confirmCatalogRemoval() {
  const context = catalogRemovalContext();
  if (!context.agent) return;
  const scope = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"]:checked')?.value || 'slot';
  if (scope !== 'agent' && !context.slot) return;
  els.confirmRemoveCatalogBtn.disabled = true;
  try {
    let result;
    if (scope === 'agent') {
      result = await window.manager.deleteAgent({
        agentId: context.agent.agentId,
        baseRevision: currentCatalogRevision()
      });
    } else if (scope === 'account-binding') {
      result = await window.manager.removeAccountBinding({
        accountBindingId: context.binding?.accountBindingId,
        baseRevision: currentCatalogRevision()
      });
    } else {
      result = await window.manager.removeLocalAgentSlot({
        deviceId: context.slot.deviceId,
        profileId: context.slot.profileId,
        baseRevision: currentCatalogRevision()
      });
    }
    if (!result?.ok) throw new Error(result?.reasonCode || 'catalog-remove-failed');
    state.mesh.overview = result.overview;
    let registrationError = null;
    const removeRegistration = scope === 'slot'
      && context.slot.deviceId === context.overview.localDeviceId
      && els.removeLocalRegistration.checked;
    if (removeRegistration) {
      const localResult = await window.manager.removeProfile(context.slot.profileId);
      if (!localResult?.ok) registrationError = localResult?.reason || 'profile-remove-failed';
    }
    state.mesh.removingAgentId = null;
    state.mesh.removingSlotKey = null;
    els.removeCatalogDialog.close();
    if (removeRegistration) {
      await loadProfiles();
    } else {
      await refreshCatalogWorkspace(result.overview);
    }
    setStatus(registrationError
      ? tr('catalog.error.generic', { code: registrationError })
      : tr('catalog.status.removed'));
  } catch (error) {
    els.removeCatalogImpact.dataset.state = 'error';
    els.removeCatalogImpact.textContent = tr('catalog.error.generic', {
      code: error?.message || 'catalog-remove-failed'
    });
  } finally {
    els.confirmRemoveCatalogBtn.disabled = false;
  }
}

function openAgentRelationsDialog() {
  const agent = catalogAgentById(actionAgentId());
  if (!agent || !state.mesh.overview?.initialized) return;
  state.mesh.relationAgentId = agent.agentId;
  const bindings = state.mesh.overview.accountBindings.filter((binding) => binding.agentId === agent.agentId);
  const slots = state.mesh.overview.slots.filter((slot) => slot.agentId === agent.agentId);
  els.agentRelationsSummary.textContent = tr('catalog.relations.summary', {
    name: agent.displayName,
    bindings: bindings.length,
    slots: slots.length
  });
  els.mergeAgentTarget.value = '';
  const targets = fillAgentAssignmentSelect(els.mergeAgentTarget, null, agent.agentId);
  els.confirmMergeAgentBtn.disabled = true;
  if (!targets.length) els.mergeAgentTarget.title = tr('catalog.merge.noTarget');
  else els.mergeAgentTarget.title = '';
  els.splitAccountBinding.replaceChildren();
  appendSelectOption(els.splitAccountBinding, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const binding of bindings) {
    appendSelectOption(els.splitAccountBinding, binding.accountBindingId, bindingOptionLabel(binding));
  }
  if (!bindings.length) {
    els.splitAccountBinding.options[0].textContent = tr('catalog.split.noBinding');
  }
  els.splitAccountBinding.value = '';
  els.confirmSplitBindingBtn.disabled = true;
  syncSplitAgentName();
  els.agentRelationsStatus.dataset.state = 'idle';
  els.agentRelationsStatus.textContent = tr('catalog.remove.safety');
  openDialog(els.agentRelationsDialog);
}

function syncSplitAgentName() {
  const binding = catalogBindingById(els.splitAccountBinding?.value);
  if (els.splitAgentName) {
    if (binding) els.splitAgentName.value = binding.displayAlias || binding.providerNamespace || '';
    else els.splitAgentName.value = '';
  }
  syncSplitConfirmState();
}

function syncSplitConfirmState() {
  const binding = catalogBindingById(els.splitAccountBinding?.value);
  if (els.confirmSplitBindingBtn) {
    els.confirmSplitBindingBtn.disabled = !binding || !els.splitAgentName?.value.trim();
  }
}

async function confirmAgentMerge() {
  const source = catalogAgentById(state.mesh.relationAgentId);
  const target = catalogAgentById(els.mergeAgentTarget.value);
  if (!source || !target) return;
  const bindings = state.mesh.overview.accountBindings.filter((binding) => binding.agentId === source.agentId);
  const slots = state.mesh.overview.slots.filter((slot) => slot.agentId === source.agentId);
  const confirmed = window.confirm(tr('catalog.merge.prompt', {
    source: source.displayName,
    target: target.displayName,
    bindings: bindings.length,
    slots: slots.length
  }));
  if (!confirmed) return;
  els.confirmMergeAgentBtn.disabled = true;
  const result = await window.manager.mergeAgents({
    sourceAgentId: source.agentId,
    targetAgentId: target.agentId,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.agentRelationsStatus.dataset.state = 'error';
    els.agentRelationsStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'agent-merge-failed'
    });
    els.confirmMergeAgentBtn.disabled = false;
    return;
  }
  state.mesh.relationAgentId = null;
  els.agentRelationsDialog.close();
  await refreshCatalogWorkspace(result.overview, { agentId: target.agentId });
  setStatus(tr('catalog.status.merged'));
}

async function confirmBindingSplit() {
  const binding = catalogBindingById(els.splitAccountBinding.value);
  const name = els.splitAgentName.value.trim();
  if (!binding || !name) {
    els.splitAgentName.focus();
    return;
  }
  const slots = state.mesh.overview.slots.filter((slot) => slot.accountBindingId === binding.accountBindingId);
  if (!window.confirm(tr('catalog.split.prompt', {
    binding: binding.displayAlias || binding.providerNamespace,
    slots: slots.length,
    name
  }))) return;
  els.confirmSplitBindingBtn.disabled = true;
  const previousAgentIds = new Set(state.mesh.overview.agents.map((agent) => agent.agentId));
  const result = await window.manager.splitAccountBinding({
    accountBindingId: binding.accountBindingId,
    displayName: name,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.agentRelationsStatus.dataset.state = 'error';
    els.agentRelationsStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'binding-split-failed'
    });
    els.confirmSplitBindingBtn.disabled = false;
    return;
  }
  const nextBinding = result.overview.accountBindings.find((item) => item.accountBindingId === binding.accountBindingId);
  const newAgent = result.overview.agents.find((agent) => !previousAgentIds.has(agent.agentId))
    || result.overview.agents.find((agent) => agent.agentId === nextBinding?.agentId);
  state.mesh.relationAgentId = null;
  els.agentRelationsDialog.close();
  await refreshCatalogWorkspace(result.overview, { agentId: newAgent?.agentId });
  setStatus(tr('catalog.status.split'));
}

function openSlotAssignmentDialog(slot) {
  const overview = state.mesh.overview;
  if (!overview?.initialized || !slot) return;
  state.mesh.assigningSlotKey = catalogSlotKey(slot);
  const device = overview.devices.find((item) => item.deviceId === slot.deviceId);
  els.slotAssignmentSummary.textContent = tr('catalog.assign.summary', {
    device: device?.name || slot.deviceId,
    app: appLabel(slot.appId),
    label: slot.localLabel || slot.profileId,
    state: slot.assignmentState || 'pending'
  });
  els.slotAssignmentName.value = slot.localLabel || appLabel(slot.appId);
  els.slotAssignmentGroup.value = '';
  els.slotAssignmentNote.value = '';
  els.slotAssignmentMode.value = '';
  els.slotAssignmentAgent.value = '';
  els.slotAssignmentBinding.value = '';
  els.slotAssignmentStatus.dataset.state = 'idle';
  els.slotAssignmentStatus.textContent = tr('catalog.remove.safety');
  document.querySelector('#removeUnassignedSlotBtn').hidden = slot.deviceId !== overview.localDeviceId
    || !state.profiles.some(profile => profile.id === slot.profileId);
  syncSlotAssignmentControls();
  openDialog(els.slotAssignmentDialog);
  els.slotAssignmentMode.focus();
}

function syncSlotAssignmentControls() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const mode = els.slotAssignmentMode?.value || '';
  const agents = fillAgentAssignmentSelect(els.slotAssignmentAgent);
  const bindings = fillBindingAssignmentSelect(els.slotAssignmentBinding, slot?.appId);
  els.slotAssignmentAgentField.hidden = mode !== 'existing-agent';
  els.slotAssignmentBindingField.hidden = mode !== 'existing-binding';
  els.confirmSlotAssignmentBtn.disabled = !slot || !mode
    || (mode === 'existing-agent' && (!agents.length || !els.slotAssignmentAgent.value))
    || (mode === 'existing-binding' && (!bindings.length || !els.slotAssignmentBinding.value));
}

async function removeUnassignedLocalSlot() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const overview = state.mesh.overview;
  if (!slot || slot.deviceId !== overview?.localDeviceId || slot.assignmentState === 'linked') return;
  const profile = state.profiles.find(item => item.id === slot.profileId);
  if (!profile || !window.confirm(tr('status.removeConfirm', { name: profile.name }))) return;
  const button = document.querySelector('#removeUnassignedSlotBtn');
  button.disabled = true;
  try {
    const result = await window.manager.removeProfile(profile.id);
    if (!result?.ok) {
      els.slotAssignmentStatus.dataset.state = 'error';
      els.slotAssignmentStatus.textContent = result?.reason || tr('status.removeFail');
      return;
    }
    els.slotAssignmentDialog.close();
    await loadProfiles(null, { skipDeviceOverview: true });
    await loadDeviceOverview({ silent: true });
    renderAttentionInbox();
    setStatus(tr('status.removedSlot'));
  } catch (_error) {
    els.slotAssignmentStatus.dataset.state = 'error';
    els.slotAssignmentStatus.textContent = tr('status.removeFail');
  } finally {
    button.disabled = false;
  }
}

async function confirmSlotAssignment() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const mode = els.slotAssignmentMode.value;
  const name = els.slotAssignmentName.value.trim();
  if (!slot || !mode || !name) return;
  els.confirmSlotAssignmentBtn.disabled = true;
  const result = await window.manager.assignAgentSlot({
    deviceId: slot.deviceId,
    profileId: slot.profileId,
    mode,
    agentId: mode === 'existing-agent' ? els.slotAssignmentAgent.value : undefined,
    accountBindingId: mode === 'existing-binding' ? els.slotAssignmentBinding.value : undefined,
    displayName: name,
    displayAlias: name,
    group: els.slotAssignmentGroup.value,
    note: els.slotAssignmentNote.value,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.slotAssignmentStatus.dataset.state = 'error';
    els.slotAssignmentStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'slot-assignment-failed'
    });
    syncSlotAssignmentControls();
    return;
  }
  const assigned = result.overview.slots.find((item) => (
    item.deviceId === slot.deviceId && item.profileId === slot.profileId
  ));
  state.mesh.assigningSlotKey = null;
  els.slotAssignmentDialog.close();
  await refreshCatalogWorkspace(result.overview, {
    agentId: assigned?.agentId,
    slotKey: catalogSlotKey(assigned)
  });
  setStatus(tr('catalog.status.assigned'));
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { catalogProviderForApp, catalogSlotKey, catalogSlotByKey, catalogAgentById, catalogBindingById, currentCatalogRevision, appendSelectOption, fillAgentAssignmentSelect, bindingOptionLabel, fillBindingAssignmentSelect, openAgentCreationDialog, confirmAgentCreation, createAgentAndPrepare, afterRecruitedAccount, openProfileCreationDialog, syncProfileAssignmentControls, confirmProfileCreation, openAgentOrProfileEditor, confirmAgentOrProfileEdit, refreshCatalogWorkspace, openAgentOrProfileRemoval, catalogRemovalContext, renderCatalogRemovalImpact, confirmCatalogRemoval, openAgentRelationsDialog, syncSplitAgentName, syncSplitConfirmState, confirmAgentMerge, confirmBindingSplit, openSlotAssignmentDialog, syncSlotAssignmentControls, removeUnassignedLocalSlot, confirmSlotAssignment };
Object.assign(window, { catalogProviderForApp, catalogSlotKey, catalogSlotByKey, catalogAgentById, catalogBindingById, currentCatalogRevision, appendSelectOption, fillAgentAssignmentSelect, bindingOptionLabel, fillBindingAssignmentSelect, openAgentCreationDialog, confirmAgentCreation, createAgentAndPrepare, afterRecruitedAccount, openProfileCreationDialog, syncProfileAssignmentControls, confirmProfileCreation, openAgentOrProfileEditor, confirmAgentOrProfileEdit, refreshCatalogWorkspace, openAgentOrProfileRemoval, catalogRemovalContext, renderCatalogRemovalImpact, confirmCatalogRemoval, openAgentRelationsDialog, syncSplitAgentName, syncSplitConfirmState, confirmAgentMerge, confirmBindingSplit, openSlotAssignmentDialog, syncSlotAssignmentControls, removeUnassignedLocalSlot, confirmSlotAssignment });
