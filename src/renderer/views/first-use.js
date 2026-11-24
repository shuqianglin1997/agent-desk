// AgentDesk — first use: the welcome guide, choosing the first Agent's client,
// the lossless migration preview, and preparing the first Agent
// (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 10.1). Moved from
// src/renderer.js unchanged.

function onboardingNeedsPresentation() {
  return Boolean(window.OnboardingState?.needsPresentation(
    state.onboardingProgress,
    window.OnboardingState.CURRENT_VERSION
  ));
}

function onboardingClientValue(appId, clientForm = 'desktop') {
  return `${String(appId || '')}\u001f${String(clientForm || 'desktop')}`;
}

function parseOnboardingClientValue(value) {
  const [appId = '', clientForm = 'desktop'] = String(value || '').split('\u001f');
  return { appId, clientForm: clientForm || 'desktop' };
}

function prepareWelcomeGuide() {
  state.firstUse.mode = 'guide';
  state.firstUse.model = null;
  if (els.welcomeDialogCloseBtn) els.welcomeDialogCloseBtn.disabled = false;
  if (els.welcomeDialogKicker) els.welcomeDialogKicker.textContent = 'AGENTDESK GUIDE';
  if (els.welcomeDialogTitle) els.welcomeDialogTitle.textContent = tr('welcome.title');
  if (els.welcomeDialogLead) els.welcomeDialogLead.textContent = tr('welcome.lead');
  if (els.welcomeGuideContent) els.welcomeGuideContent.hidden = false;
  if (els.onboardingContent) els.onboardingContent.hidden = true;
  if (els.onboardingFooter) els.onboardingFooter.hidden = true;
  els.welcomeDialog?.classList.remove('is-onboarding');
}

function createFirstUseModel(options = {}) {
  const progress = options.force === true
    ? { completedVersion: 0, completedAt: null }
    : state.onboardingProgress;
  return window.OnboardingState.create({
    progress,
    profiles: state.profiles,
    clients: supportedProvisioningApps(),
    overview: state.mesh.overview
  });
}

function openFirstUseDialog(options = {}) {
  if (!window.OnboardingState || !els.welcomeDialog) return false;
  const model = createFirstUseModel(options);
  if (model.phase === 'done') return false;
  state.firstUse.mode = 'onboarding';
  state.firstUse.model = model;
  state.firstUse.busy = false;
  renderFirstUse();
  if (!els.welcomeDialog.open) openDialog(els.welcomeDialog);
  focusFirstUseControl();
  return true;
}

// 全新安装从空台面上的“招募第一只猫”开始，不再一启动就弹窗。
// 台面上已经有东西时仍在启动时出现：旧安装要确认无损迁移，中途退出的首次使用要回到原来的步骤。
function maybeShowWelcome() {
  if (!onboardingNeedsPresentation()) return;
  const emptyDesk = !state.profiles.length && !(state.mesh.overview?.agents || []).length;
  if (emptyDesk) return;
  openFirstUseDialog();
}

function firstUseErrorText(reasonCode) {
  if (!reasonCode) return '';
  const known = {
    'agent-name-required': 'onboarding.error.nameRequired',
    'supported-client-required': 'onboarding.error.clientRequired',
    'first-agent-api-unavailable': 'onboarding.error.contractUnavailable',
    'first-agent-result-incomplete': 'onboarding.error.incompleteResult'
  };
  const key = known[reasonCode];
  return key ? tr(key) : tr('onboarding.error.generic', { code: reasonCode });
}

function preparationStateText(preparation = {}) {
  const key = `onboarding.prepare.state.${preparation.state || 'planning'}`;
  const fallback = tr('onboarding.prepare.state.preparing');
  const label = tr(key);
  return label === key ? fallback : label;
}

function preparationDetailText(preparation = {}) {
  const key = `onboarding.prepare.detail.${preparation.state || 'planning'}`;
  const fallback = tr('onboarding.prepare.detail.preparing');
  const label = tr(key);
  if (label !== key) return label;
  return preparation.reasonCode
    ? tr('onboarding.error.generic', { code: preparation.reasonCode })
    : fallback;
}

function renderOnboardingProgress(model) {
  if (!els.onboardingProgress) return;
  const order = { migration: 0, agent: 1, submitting: 1, preparing: 2, existing: 3, complete: 3 };
  const current = order[model.phase] ?? 0;
  const hasMigration = model.profiles.length > 0 && !model.initialized;
  for (const item of els.onboardingProgress.querySelectorAll('[data-step]')) {
    const step = item.dataset.step;
    const index = step === 'migration' ? 0 : (step === 'agent' ? 1 : 2);
    const skipped = step === 'migration' && !hasMigration;
    item.dataset.state = skipped || index < current ? 'complete' : (index === current ? 'current' : 'pending');
    item.setAttribute('aria-current', index === current && !skipped ? 'step' : 'false');
  }
}

function renderOnboardingMigration(model) {
  if (!els.onboardingMigrationList) return;
  els.onboardingMigrationList.replaceChildren();
  const selected = new Set(model.selectedProfileIds);
  for (const profile of model.profiles) {
    const label = document.createElement('label');
    label.className = 'onboarding-migration-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(profile.profileId);
    checkbox.disabled = state.firstUse.busy;
    checkbox.addEventListener('change', () => {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'toggle-profile',
        profileId: profile.profileId,
        selected: checkbox.checked
      });
      renderFirstUse();
    });
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const meta = document.createElement('small');
    meta.textContent = [appLabel(profile.appId), profile.group].filter(Boolean).join(' · ');
    identity.append(name, meta);
    const stateLabel = document.createElement('b');
    stateLabel.textContent = tr(checkbox.checked
      ? 'onboarding.migration.included'
      : 'onboarding.migration.keptLocal');
    label.append(checkbox, identity, stateLabel);
    els.onboardingMigrationList.append(label);
  }
}

function renderOnboardingClientSelect(model) {
  if (!els.onboardingAgentClient) return;
  const expected = onboardingClientValue(
    model.draft.requestedAppId,
    model.draft.requestedClientForm
  );
  els.onboardingAgentClient.replaceChildren();
  for (const client of model.clients) {
    const option = document.createElement('option');
    option.value = onboardingClientValue(client.appId, client.clientForm);
    option.textContent = client.label;
    els.onboardingAgentClient.append(option);
  }
  if (!model.clients.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = tr('onboarding.agent.noClient');
    option.disabled = true;
    option.selected = true;
    els.onboardingAgentClient.append(option);
  } else {
    els.onboardingAgentClient.value = model.clients.some((item) => (
      onboardingClientValue(item.appId, item.clientForm) === expected
    )) ? expected : onboardingClientValue(model.clients[0].appId, model.clients[0].clientForm);
  }
  els.onboardingAgentClient.disabled = state.firstUse.busy || !model.clients.length;
}

function renderOnboardingExisting(model) {
  if (!els.onboardingExistingAgents) return;
  els.onboardingExistingAgents.replaceChildren();
  for (const agent of model.agents.slice(0, 8)) {
    const item = document.createElement('span');
    item.textContent = agent.displayName;
    els.onboardingExistingAgents.append(item);
  }
  if (model.agents.length > 8) {
    const more = document.createElement('span');
    more.textContent = tr('onboarding.existing.more', { n: model.agents.length - 8 });
    els.onboardingExistingAgents.append(more);
  }
}

function renderFirstUseActions(model) {
  const primary = els.onboardingPrimaryBtn;
  const secondary = els.onboardingSecondaryBtn;
  const back = els.onboardingBackBtn;
  const advanced = els.onboardingAdvancedBtn;
  if (!primary || !secondary || !back || !advanced) return;

  primary.hidden = false;
  primary.disabled = state.firstUse.busy;
  secondary.hidden = true;
  secondary.disabled = state.firstUse.busy;
  back.hidden = !(model.phase === 'agent' && model.originPhase === 'migration');
  back.disabled = state.firstUse.busy;
  advanced.hidden = !['migration', 'agent'].includes(model.phase);
  advanced.disabled = state.firstUse.busy;
  if (els.onboardingCodexImportBtn) {
    els.onboardingCodexImportBtn.hidden = !['migration', 'agent'].includes(model.phase);
    els.onboardingCodexImportBtn.disabled = state.firstUse.busy;
  }
  if (els.welcomeDialogCloseBtn) els.welcomeDialogCloseBtn.disabled = state.firstUse.busy;

  if (model.phase === 'migration') {
    primary.dataset.action = 'migration';
    primary.textContent = tr('onboarding.action.confirmMigration');
  } else if (model.phase === 'agent') {
    primary.dataset.action = 'create';
    primary.textContent = tr('onboarding.action.create');
    primary.disabled = state.firstUse.busy || !window.OnboardingState.canSubmit(model);
  } else if (model.phase === 'existing') {
    primary.dataset.action = 'review';
    primary.textContent = tr('onboarding.action.review');
  } else if (model.phase === 'preparing') {
    primary.dataset.action = 'prepare';
    primary.textContent = tr(['error', 'unsupported'].includes(model.preparation?.state)
      ? 'onboarding.action.retry'
      : 'onboarding.action.continuePrepare');
    secondary.hidden = false;
    secondary.dataset.action = 'later';
    secondary.textContent = tr('onboarding.action.later');
  } else if (model.phase === 'complete') {
    primary.dataset.action = 'finish';
    primary.textContent = tr('onboarding.action.enter');
    primary.disabled = state.firstUse.busy || model.completeShown !== true;
  } else {
    primary.dataset.action = '';
    primary.textContent = tr('onboarding.action.working');
    primary.disabled = true;
  }
}

function renderFirstUse() {
  const model = state.firstUse.model;
  if (!model || !els.onboardingContent) return;
  state.firstUse.mode = 'onboarding';
  els.welcomeDialog?.classList.add('is-onboarding');
  if (els.welcomeDialogKicker) els.welcomeDialogKicker.textContent = 'FIRST USE · V' + model.version;
  if (els.welcomeDialogTitle) els.welcomeDialogTitle.textContent = tr('onboarding.title');
  if (els.welcomeDialogLead) els.welcomeDialogLead.textContent = tr('onboarding.lead');
  if (els.welcomeGuideContent) els.welcomeGuideContent.hidden = true;
  els.onboardingContent.hidden = false;
  if (els.onboardingFooter) els.onboardingFooter.hidden = false;

  renderOnboardingProgress(model);
  for (const [element, phase] of [
    [els.onboardingMigration, 'migration'],
    [els.onboardingAgent, 'agent'],
    [els.onboardingExisting, 'existing'],
    [els.onboardingPreparation, 'preparing'],
    [els.onboardingComplete, 'complete']
  ]) {
    if (element) element.hidden = model.phase !== phase;
  }

  if (model.phase === 'migration') renderOnboardingMigration(model);
  if (model.phase === 'agent') {
    if (els.onboardingAgentName && els.onboardingAgentName.value !== model.draft.displayName) {
      els.onboardingAgentName.value = model.draft.displayName;
    }
    renderOnboardingClientSelect(model);
    if (els.onboardingMigrationSummary) {
      els.onboardingMigrationSummary.hidden = model.originPhase !== 'migration';
      els.onboardingMigrationSummary.textContent = tr('onboarding.migration.selected', {
        n: model.selectedProfileIds.length
      });
    }
  }
  if (model.phase === 'existing') renderOnboardingExisting(model);
  if (model.phase === 'preparing') {
    const preparation = model.preparation || { state: 'planning' };
    if (els.onboardingPreparationState) els.onboardingPreparationState.textContent = preparationStateText(preparation);
    if (els.onboardingPreparationDetail) els.onboardingPreparationDetail.textContent = preparationDetailText(preparation);
    if (els.onboardingPreparationIcon) {
      els.onboardingPreparationIcon.textContent = ['error', 'unsupported'].includes(preparation.state) ? '!' : '⋯';
      els.onboardingPreparationIcon.dataset.state = preparation.state || 'planning';
    }
  }

  const message = firstUseErrorText(model.errorCode);
  if (els.onboardingStatus) {
    els.onboardingStatus.hidden = !message;
    els.onboardingStatus.textContent = message;
  }
  renderFirstUseActions(model);

  if (model.phase === 'complete' && model.completeShown !== true) {
    requestAnimationFrame(() => {
      if (!els.welcomeDialog?.open || els.onboardingComplete?.hidden) return;
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'rendered',
        phase: 'complete'
      });
      renderFirstUseActions(state.firstUse.model);
    });
  }
}

function focusFirstUseControl() {
  const model = state.firstUse.model;
  if (!model || !els.welcomeDialog?.open) return;
  requestAnimationFrame(() => {
    if (model.phase === 'migration') els.onboardingMigrationList?.querySelector('input')?.focus();
    else if (model.phase === 'agent') els.onboardingAgentName?.focus();
    else els.onboardingPrimaryBtn?.focus();
  });
}

async function startFirstAgentSetup() {
  let model = state.firstUse.model;
  if (!model || model.phase !== 'agent' || state.firstUse.busy) return;
  model = window.OnboardingState.transition(model, {
    type: 'draft',
    displayName: els.onboardingAgentName?.value,
    ...parseOnboardingClientValue(els.onboardingAgentClient?.value)
  });
  model = window.OnboardingState.transition(model, { type: 'submit' });
  state.firstUse.model = model;
  if (model.phase !== 'submitting') {
    renderFirstUse();
    focusFirstUseControl();
    return;
  }

  state.firstUse.busy = true;
  renderFirstUse();
  try {
    const input = {
      displayName: model.draft.displayName,
      requestedAppId: model.draft.requestedAppId,
      requestedClientForm: model.draft.requestedClientForm,
      migrationProfileIds: [...model.selectedProfileIds],
      baseRevision: currentCatalogRevision()
    };
    let result;
    if (state.mesh.overview?.initialized) {
      result = await window.manager.createAgent({
        displayName: input.displayName,
        group: '',
        note: '',
        baseRevision: input.baseRevision
      });
    } else if (typeof window.manager.initializeFirstAgent === 'function') {
      result = await window.manager.initializeFirstAgent(input);
    } else {
      throw new Error('first-agent-api-unavailable');
    }
    if (!result?.ok) throw new Error(result?.reasonCode || 'first-agent-create-failed');
    const overview = result.overview;
    const agentId = result.agent?.agentId;
    const deviceId = result.deviceId || overview?.localDeviceId;
    const resultHasAgent = Array.isArray(overview?.agents)
      && overview.agents.some((agent) => agent.agentId === agentId);
    if (overview?.initialized !== true || !agentId || !deviceId || !resultHasAgent) {
      throw new Error('first-agent-result-incomplete');
    }
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'initialized',
      agentId,
      deviceId
    });
    if (state.firstUse.model.phase !== 'preparing') {
      renderFirstUse();
      return;
    }
    state.mesh.overview = overview;
    rememberProvisioningChoice({ key: agentId }, deviceId, input.requestedAppId, input.requestedClientForm);
    await refreshCatalogWorkspace(overview, { agentId });
    renderFirstUse();
    const initialPreparation = result.preparation || result.provisioning || null;
    if (initialPreparation?.state) {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'preparation-result',
        result: initialPreparation
      });
      renderFirstUse();
    } else {
      state.firstUse.busy = false;
      await continueFirstPreparation();
      return;
    }
  } catch (error) {
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'failed',
      returnPhase: state.firstUse.model?.agentId ? 'preparing' : 'agent',
      reasonCode: error?.message || 'first-agent-create-failed'
    });
  } finally {
    state.firstUse.busy = false;
    renderFirstUse();
  }
}

async function continueFirstPreparation() {
  const model = state.firstUse.model;
  if (!model || model.phase !== 'preparing' || state.firstUse.busy) return;
  if (!model.agentId || !model.deviceId || typeof window.manager.ensureAgentReady !== 'function') {
    state.firstUse.model = window.OnboardingState.transition(model, {
      type: 'failed',
      returnPhase: 'preparing',
      reasonCode: 'first-agent-result-incomplete'
    });
    renderFirstUse();
    return;
  }
  state.firstUse.busy = true;
  state.firstUse.model = window.OnboardingState.transition(model, { type: 'retry' });
  renderFirstUse();
  try {
    const result = await window.manager.ensureAgentReady({
      agentId: model.agentId,
      deviceId: model.deviceId,
      requestedAppId: model.draft.requestedAppId,
      requestedClientForm: model.draft.requestedClientForm || 'desktop'
    });
    if (result?.overview) state.mesh.overview = result.overview;
    if (result?.state === 'ready') {
      await loadProfiles(result.slot?.profileId || null, { skipDeviceOverview: true });
    } else if (result?.overview) {
      await refreshCatalogWorkspace(result.overview, { agentId: model.agentId });
    }
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'preparation-result',
      result
    });
    setStatus(provisioningResultMessage(result, model.draft.displayName));
  } catch (error) {
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'failed',
      returnPhase: 'preparing',
      reasonCode: error?.message || 'provisioning-failed'
    });
  } finally {
    state.firstUse.busy = false;
    renderFirstUse();
  }
}

function finishFirstUseLater() {
  if (!state.firstUse.model || state.firstUse.busy) return;
  state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
    type: 'finish-later'
  });
  renderFirstUse();
}

function finishFirstUse() {
  const patch = window.OnboardingState?.completionPatch(state.firstUse.model);
  if (!patch) return;
  recordFirstUseCompletion(patch);
  els.welcomeDialog?.close();
  setStatus(tr('onboarding.status.complete'));
}

function recordFirstUseCompletion(patch) {
  state.welcomed = true;
  state.onboardingProgress = patch.onboarding;
  persistSettings(patch);
}

// The acceptance run swaps the next preparation step for one that stops at
// waiting-login (window.AgentDeskInspect.replace); both this module and the
// callers that reach it by name get the new one. Returns the previous one.
function replaceContinueFirstPreparation(fn) {
  const previous = continueFirstPreparation;
  continueFirstPreparation = fn;
  window.continueFirstPreparation = fn;
  return previous;
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindFirstUseEvents() {
  els.onboardingAgentName?.addEventListener('input', () => {
    if (!state.firstUse.model) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'draft',
      displayName: els.onboardingAgentName.value
    });
    renderFirstUseActions(state.firstUse.model);
    if (els.onboardingStatus && state.firstUse.model.errorCode === null) {
      els.onboardingStatus.hidden = true;
      els.onboardingStatus.textContent = '';
    }
  });
  els.onboardingAgentClient?.addEventListener('change', () => {
    if (!state.firstUse.model) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'draft',
      ...parseOnboardingClientValue(els.onboardingAgentClient.value)
    });
    renderFirstUseActions(state.firstUse.model);
  });
  els.onboardingBackBtn?.addEventListener('click', () => {
    if (!state.firstUse.model || state.firstUse.busy) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'back' });
    renderFirstUse();
    focusFirstUseControl();
  });
  els.onboardingSecondaryBtn?.addEventListener('click', () => {
    if (els.onboardingSecondaryBtn.dataset.action === 'later') finishFirstUseLater();
  });
  els.onboardingPrimaryBtn?.addEventListener('click', () => {
    if (!state.firstUse.model || state.firstUse.busy) return;
    const action = els.onboardingPrimaryBtn.dataset.action;
    if (action === 'migration') {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'continue' });
      renderFirstUse();
      focusFirstUseControl();
    } else if (action === 'create') {
      void startFirstAgentSetup();
    } else if (action === 'review') {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'review-complete' });
      renderFirstUse();
    } else if (action === 'prepare') {
      void continueFirstPreparation();
    } else if (action === 'finish') {
      finishFirstUse();
    }
  });
  els.onboardingAdvancedBtn?.addEventListener('click', () => {
    if (state.firstUse.busy) return;
    recruitDialog.open('existing');
  });
  els.welcomeDialogCloseBtn?.addEventListener('click', () => {
    if (state.firstUse.busy) return;
    els.welcomeDialog?.close();
  });
  els.welcomeDialog?.addEventListener('cancel', (event) => {
    if (state.firstUse.busy) event.preventDefault();
  });
  els.welcomeDialog?.querySelector('form')?.addEventListener('submit', (event) => {
    if (state.firstUse.mode !== 'onboarding') return;
    event.preventDefault();
    if (!els.onboardingPrimaryBtn?.disabled) els.onboardingPrimaryBtn?.click();
  });
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { onboardingNeedsPresentation, onboardingClientValue, parseOnboardingClientValue, prepareWelcomeGuide, createFirstUseModel, openFirstUseDialog, maybeShowWelcome, firstUseErrorText, preparationStateText, preparationDetailText, renderOnboardingProgress, renderOnboardingMigration, renderOnboardingClientSelect, renderOnboardingExisting, renderFirstUseActions, renderFirstUse, focusFirstUseControl, startFirstAgentSetup, continueFirstPreparation, finishFirstUseLater, finishFirstUse, recordFirstUseCompletion, replaceContinueFirstPreparation, bindFirstUseEvents };
Object.assign(window, { onboardingNeedsPresentation, onboardingClientValue, parseOnboardingClientValue, prepareWelcomeGuide, createFirstUseModel, openFirstUseDialog, maybeShowWelcome, firstUseErrorText, preparationStateText, preparationDetailText, renderOnboardingProgress, renderOnboardingMigration, renderOnboardingClientSelect, renderOnboardingExisting, renderFirstUseActions, renderFirstUse, focusFirstUseControl, startFirstAgentSetup, continueFirstPreparation, finishFirstUseLater, finishFirstUse, recordFirstUseCompletion, replaceContinueFirstPreparation, bindFirstUseEvents });
