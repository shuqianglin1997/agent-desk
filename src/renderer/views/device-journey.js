// AgentDesk — the add-device journey: invitation, identity confirmation,
// membership trust, connection, catalog and inventory steps (docs/ARCHITECTURE_PLAN.md
// phase 6, Mesh plan 10.2). Moved from src/renderer.js unchanged.

let deviceJourneyPollTimer = null;

let deviceJourneyPollPromise = null;

function deviceJourneyErrorText(code) {
  if (!code) return '';
  const known = {
    'device-invite-inspection-unavailable': 'deviceJourney.error.inspectionUnavailable',
    'device-invite-preview-incomplete': 'deviceJourney.error.previewIncomplete',
    'device-identity-confirmation-required': 'deviceJourney.error.identityRequired',
    'device-invitation-incomplete': 'deviceJourney.error.invitationIncomplete'
  };
  return known[code]
    ? tr(known[code])
    : tr('deviceJourney.error.generic', { code });
}

function deviceJourneyModel() {
  const model = state.mesh.deviceJourney;
  if (!model || !window.DeviceJourney) return null;
  state.mesh.deviceJourney = window.DeviceJourney.transition(model, {
    type: 'overview'
  }, state.mesh.overview);
  return state.mesh.deviceJourney;
}

function openDeviceJourney(role, trigger = document.activeElement, options = {}) {
  if (!els.deviceJourneyDialog || !window.DeviceJourney) return;
  const existing = state.mesh.deviceJourney;
  const resume = existing && existing.role === role && existing.phase !== 'complete';
  if (!resume) {
    state.mesh.deviceJourney = window.DeviceJourney.create({
      role,
      baselineDeviceIds: role === 'host'
        ? (state.mesh.overview?.devices || []).map((device) => device.deviceId)
        : [],
      targetDeviceId: options.targetDeviceId,
      invitation: role === 'host' ? state.mesh.invitation : null,
      overview: state.mesh.overview
    });
  }
  renderDeviceJourney();
  openChildDialog(els.deviceJourneyDialog, trigger);
  startDeviceJourneyPolling();
  if (role === 'host') void refreshPairingClaims();
  requestAnimationFrame(() => {
    const model = deviceJourneyModel();
    if (model?.role === 'join' && !model.preview) els.meshJoinCode?.focus();
    else els.deviceJourneyPrimaryBtn?.focus();
  });
}

function applyPairingClaims(claims, options = {}) {
  const list = Array.isArray(claims) ? claims : [];
  const inviteId = state.mesh.deviceJourney?.invitation?.inviteId || state.mesh.invitation?.inviteId;
  const claim = list.find((item) => !inviteId || item?.inviteId === inviteId) || null;
  if (!claim || !window.DeviceJourney) return;
  if (!state.mesh.deviceJourney || state.mesh.deviceJourney.role !== 'host') {
    state.mesh.deviceJourney = window.DeviceJourney.create({
      role: 'host',
      baselineDeviceIds: (state.mesh.overview?.devices || []).map((device) => device.deviceId),
      invitation: state.mesh.invitation,
      overview: state.mesh.overview
    });
  }
  state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
    type: 'claim',
    claim
  }, state.mesh.overview);
  renderDeviceJourney();
  if (options.open === true && !els.deviceJourneyDialog?.open) {
    openDeviceJourney('host', els.createDeviceInviteBtn || document.activeElement);
  }
}

async function refreshPairingClaims() {
  if (typeof window.manager.listPairingClaims !== 'function') return;
  try {
    const result = await window.manager.listPairingClaims();
    if (result?.ok) applyPairingClaims(result.claims);
  } catch (_error) {
    // A missing approval list cannot be treated as trust.
  }
}

function stopDeviceJourneyPolling() {
  clearInterval(deviceJourneyPollTimer);
  deviceJourneyPollTimer = null;
}

function startDeviceJourneyPolling() {
  stopDeviceJourneyPolling();
  if (!els.deviceJourneyDialog?.open) return;
  deviceJourneyPollTimer = setInterval(() => {
    void refreshDeviceJourneyFacts();
  }, 2500);
}

async function refreshDeviceJourneyFacts() {
  if (
    !els.deviceJourneyDialog?.open
    || !window.manager.listDevices
    || deviceJourneyPollPromise
  ) return;
  const operation = (async () => {
    try {
      const result = await window.manager.listDevices();
      if (!result?.ok || !result.overview) return;
      state.mesh.overview = result.overview;
      validateUiContext();
      state.mesh.deviceJourney = window.DeviceJourney.transition(
        state.mesh.deviceJourney,
        { type: 'overview' },
        result.overview
      );
      renderDeviceCenter();
      renderDeviceJourney();
    } catch (_error) {
      // The current facts remain visible; explicit actions surface errors.
    }
  })();
  deviceJourneyPollPromise = operation;
  try {
    await operation;
  } finally {
    if (deviceJourneyPollPromise === operation) deviceJourneyPollPromise = null;
  }
}

function renderDeviceJourneyProgress(model) {
  if (!els.deviceJourneyProgress) return;
  const states = window.DeviceJourney.stepStates(model, state.mesh.overview);
  for (const item of els.deviceJourneyProgress.querySelectorAll('[data-step]')) {
    const value = states[item.dataset.step] || 'pending';
    item.dataset.state = value;
    if (value === 'current') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

function deviceJourneyIdentity(model, value) {
  if (model.role === 'join' && model.preview) {
    return {
      kind: tr('deviceJourney.identity.inviter'),
      name: model.preview.sourceDeviceName || tr('devices.value.unknown'),
      meta: [
        platformLabel(model.preview.platform),
        model.preview.appVersion ? `AgentDesk ${model.preview.appVersion}` : null,
        model.preview.expiresAt ? tr('deviceJourney.identity.expires', { time: compactDate(model.preview.expiresAt) }) : null
      ].filter(Boolean).join(' · '),
      fingerprint: model.preview.sourceFingerprint || '—'
    };
  }
  if (model.role === 'host' && model.claim) {
    return {
      kind: tr('deviceJourney.identity.joiner'),
      name: model.claim.name || tr('devices.value.unknown'),
      meta: [
        platformLabel(model.claim.platform),
        model.claim.arch,
        model.claim.appVersion ? `AgentDesk ${model.claim.appVersion}` : null,
        model.claim.expiresAt ? tr('deviceJourney.identity.expires', { time: compactDate(model.claim.expiresAt) }) : null
      ].filter(Boolean).join(' · '),
      fingerprint: model.claim.fingerprint || '—'
    };
  }
  if (value.target) {
    return {
      kind: tr('deviceJourney.identity.joiner'),
      name: value.target.name,
      meta: [
        platformLabel(value.target.platform),
        value.target.arch,
        value.target.appVersion ? `AgentDesk ${value.target.appVersion}` : null
      ].filter(Boolean).join(' · '),
      fingerprint: value.target.fingerprint || '—'
    };
  }
  return null;
}

function renderDeviceJourneyIdentity(model, value) {
  if (els.deviceJourneyHost) els.deviceJourneyHost.hidden = model.role !== 'host';
  if (els.deviceJourneyJoin) els.deviceJourneyJoin.hidden = model.role !== 'join' || Boolean(model.preview);
  if (els.deviceJourneyIdentityLead) {
    els.deviceJourneyIdentityLead.textContent = tr(model.role === 'host'
      ? 'deviceJourney.host.lead'
      : 'deviceJourney.join.lead');
  }
  if (els.deviceJourneyInviteEmpty) els.deviceJourneyInviteEmpty.hidden = Boolean(model.invitation);
  if (els.deviceJourneyInvite) els.deviceJourneyInvite.hidden = !model.invitation;
  if (model.invitation) {
    if (els.deviceJourneyShortCode) els.deviceJourneyShortCode.textContent = model.invitation.shortCode || '—';
    if (els.deviceJourneyInviteExpiry) {
      els.deviceJourneyInviteExpiry.textContent = model.invitation.expiresAt
        ? tr('deviceJourney.host.expires', { time: compactDate(model.invitation.expiresAt) })
        : '';
    }
    if (els.deviceJourneyInviteCode) els.deviceJourneyInviteCode.value = model.invitation.code;
  }

  const identity = deviceJourneyIdentity(model, value);
  if (els.deviceJourneyIdentityCard) els.deviceJourneyIdentityCard.hidden = !identity;
  if (!identity) return;
  if (els.deviceJourneyIdentityKind) els.deviceJourneyIdentityKind.textContent = identity.kind;
  if (els.deviceJourneyDeviceName) els.deviceJourneyDeviceName.textContent = identity.name;
  if (els.deviceJourneyDeviceMeta) els.deviceJourneyDeviceMeta.textContent = identity.meta;
  if (els.deviceJourneyFingerprint) els.deviceJourneyFingerprint.textContent = identity.fingerprint;
  if (els.deviceJourneyIdentityConfirm) {
    els.deviceJourneyIdentityConfirm.checked = model.identityConfirmed;
    els.deviceJourneyIdentityConfirm.disabled = model.busy;
  }
}

function deviceJourneyFactState(complete, current, unavailable = false) {
  if (complete) return 'complete';
  if (unavailable) return 'error';
  return current ? 'current' : 'pending';
}

function renderDeviceJourneyFacts(model, value) {
  if (!els.deviceJourneyFactList) return;
  const rows = [
    ['trust', value.trusted, model.identityConfirmed, false],
    ['connect', value.connected, value.trusted, false],
    ['catalog', value.catalogReady, value.connected, value.catalogUnavailable],
    ['inventory', value.inventoryReady, value.connected, false]
  ];
  els.deviceJourneyFactList.replaceChildren();
  for (const [key, complete, current, unavailable] of rows) {
    const row = document.createElement('div');
    const status = deviceJourneyFactState(complete, current, unavailable);
    row.dataset.state = status;
    const mark = document.createElement('span');
    mark.textContent = complete ? '✓' : (unavailable ? '!' : (current ? '⋯' : '·'));
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = tr(`deviceJourney.fact.${key}`);
    const detail = document.createElement('small');
    detail.textContent = tr(`deviceJourney.fact.${key}.${status}`);
    copy.append(title, detail);
    row.append(mark, copy);
    els.deviceJourneyFactList.append(row);
  }
  if (els.deviceJourneyFactsLead) {
    els.deviceJourneyFactsLead.textContent = tr(`deviceJourney.phase.${model.phase}`);
  }
}

function renderDeviceJourneyActions(model, value) {
  const primary = els.deviceJourneyPrimaryBtn;
  const secondary = els.deviceJourneySecondaryBtn;
  if (!primary || !secondary) return;
  primary.hidden = false;
  primary.disabled = model.busy;
  secondary.hidden = true;
  secondary.disabled = model.busy;
  if (els.deviceJourneyCloseBtn) els.deviceJourneyCloseBtn.disabled = model.busy;
  if (els.deviceJourneyAdvancedBtn) els.deviceJourneyAdvancedBtn.disabled = model.busy;

  if (model.role === 'host' && !model.invitation && !value.target && !model.claim) {
    primary.dataset.action = 'invite';
    primary.textContent = tr('deviceJourney.action.invite');
  } else if (model.role === 'host' && !value.target && !model.claim) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.waitingDevice');
    primary.disabled = true;
    secondary.hidden = false;
    secondary.dataset.action = 'cancel-invite';
    secondary.textContent = tr('deviceJourney.action.cancelInvite');
  } else if (model.role === 'join' && !model.preview) {
    primary.dataset.action = 'inspect';
    primary.textContent = tr('deviceJourney.action.inspect');
    primary.disabled = model.busy || !String(els.meshJoinCode?.value || '').trim();
  } else if (!model.identityConfirmed) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.confirmIdentity');
    primary.disabled = true;
    if (model.role === 'join') {
      secondary.hidden = false;
      secondary.dataset.action = 'edit-code';
      secondary.textContent = tr('deviceJourney.action.editCode');
    } else if (model.claim) {
      secondary.hidden = false;
      secondary.dataset.action = 'reject-claim';
      secondary.textContent = tr('deviceJourney.action.rejectClaim');
    }
  } else if (!value.trusted && model.role === 'join') {
    primary.dataset.action = 'join';
    primary.textContent = tr('deviceJourney.action.join');
  } else if (!value.trusted && model.role === 'host' && model.claim && !model.approvalSubmitted) {
    primary.dataset.action = 'approve-claim';
    primary.textContent = tr('deviceJourney.action.approveClaim');
    secondary.hidden = false;
    secondary.dataset.action = 'reject-claim';
    secondary.textContent = tr('deviceJourney.action.rejectClaim');
  } else if (!value.trusted) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.waitingTrust');
    primary.disabled = true;
  } else if (!value.connected) {
    primary.dataset.action = 'connect';
    primary.textContent = tr('deviceJourney.action.connect');
  } else if (!value.catalogReady || !value.inventoryReady) {
    primary.dataset.action = 'sync';
    primary.textContent = tr(value.catalogUnavailable
      ? 'deviceJourney.action.recheck'
      : 'deviceJourney.action.continueSync');
  } else {
    primary.dataset.action = 'finish';
    primary.textContent = tr('deviceJourney.action.viewDevice');
  }
}

function renderDeviceJourney() {
  const model = deviceJourneyModel();
  if (!model || !els.deviceJourneyDialog) return;
  const value = window.DeviceJourney.facts(model, state.mesh.overview);
  renderDeviceJourneyProgress(model);
  if (els.deviceJourneyIdentity) els.deviceJourneyIdentity.hidden = model.identityConfirmed && Boolean(value.target);
  if (els.deviceJourneyFacts) els.deviceJourneyFacts.hidden = !model.identityConfirmed || value.usable;
  if (els.deviceJourneyComplete) els.deviceJourneyComplete.hidden = !value.usable;
  renderDeviceJourneyIdentity(model, value);
  renderDeviceJourneyFacts(model, value);
  if (els.deviceJourneyCompleteLead) {
    els.deviceJourneyCompleteLead.textContent = tr('deviceJourney.complete.lead', {
      name: value.target?.name || tr('devices.value.unknown')
    });
  }
  const error = deviceJourneyErrorText(model.errorCode);
  if (els.deviceJourneyStatus) {
    els.deviceJourneyStatus.hidden = !error;
    els.deviceJourneyStatus.textContent = error;
  }
  renderDeviceJourneyActions(model, value);
}

function setDeviceJourneyBusy(busy) {
  if (!state.mesh.deviceJourney) return;
  state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
    type: 'busy',
    busy
  }, state.mesh.overview);
  renderDeviceJourney();
}

async function createDeviceJourneyInvitation() {
  const model = deviceJourneyModel();
  if (!model || model.busy || !window.manager.createDeviceInvite) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.createDeviceInvite();
    if (!result?.ok || !result.invitation) throw new Error(result?.reasonCode || 'pairing-invite-failed');
    state.mesh.invitation = result.invitation;
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'invitation',
      invitation: result.invitation
    }, state.mesh.overview);
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-invite-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

async function inspectDeviceJourneyInvitation() {
  const model = deviceJourneyModel();
  const code = String(els.meshJoinCode?.value || '').trim();
  if (!model || model.busy || !code) return;
  if (typeof window.manager.inspectDeviceInvitation !== 'function') {
    state.mesh.deviceJourney = window.DeviceJourney.transition(model, {
      type: 'failed',
      reasonCode: 'device-invite-inspection-unavailable'
    }, state.mesh.overview);
    renderDeviceJourney();
    return;
  }
  state.mesh.deviceJourney = window.DeviceJourney.transition(model, { type: 'code', code }, state.mesh.overview);
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.inspectDeviceInvitation({ code });
    if (!result?.ok || !result.preview) throw new Error(result?.reasonCode || 'device-invite-preview-incomplete');
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'preview',
      preview: result.preview
    }, state.mesh.overview);
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'device-invite-preview-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
  }
}

async function joinFromDeviceJourney() {
  const model = deviceJourneyModel();
  if (!model || model.busy || !model.identityConfirmed || !model.preview || !window.manager.joinDeviceMesh) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.joinDeviceMesh({
      code: model.inviteCode,
      inviteId: model.preview.inviteId,
      confirmationToken: model.preview.confirmationToken
    });
    if (!result?.ok || !result.overview) throw new Error(result?.reasonCode || 'pairing-join-failed');
    state.mesh.overview = result.overview;
    const target = (result.overview.devices || []).find((device) => !device.isLocal);
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'target',
      deviceId: target?.deviceId
    }, result.overview);
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: Boolean(result.connection),
      reasonCode: result.connectionError
    }, result.overview);
    validateUiContext();
    renderTopbarContext();
    await loadProfiles(currentProfileId(), { skipDeviceOverview: true });
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-join-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

async function decideDeviceJourneyClaim(confirmed) {
  const model = deviceJourneyModel();
  const claim = model?.claim;
  if (!model || model.busy || !claim || typeof window.manager.decidePairingClaim !== 'function') return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.decidePairingClaim({
      approvalId: claim.approvalId,
      confirmed: confirmed === true
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'pairing-approval-failed');
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'claim-decision',
      confirmed: confirmed === true
    }, state.mesh.overview);
    if (!confirmed) setStatus(tr('deviceJourney.status.claimRejected'));
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-approval-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    void refreshDeviceJourneyFacts();
  }
}

async function connectFromDeviceJourney() {
  const model = deviceJourneyModel();
  const value = model ? window.DeviceJourney.facts(model, state.mesh.overview) : null;
  if (!model || model.busy || !value?.target || !window.manager.connectDevice) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.connectDevice(value.target.deviceId);
    if (!result?.ok || !result.overview) throw new Error(result?.reasonCode || 'peer-connect-failed');
    state.mesh.overview = result.overview;
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: true
    }, result.overview);
    validateUiContext();
    await loadSessions();
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: false,
      reasonCode: error?.message || 'peer-connect-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

function finishDeviceJourney() {
  const model = deviceJourneyModel();
  const value = model ? window.DeviceJourney.facts(model, state.mesh.overview) : null;
  if (!value?.usable || !value.target) return;
  state.ui = window.UiContext.selectDeviceDetail(state.ui, value.target.deviceId);
  renderDeviceCenter();
  els.deviceJourneyDialog?.close();
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { deviceJourneyErrorText, deviceJourneyModel, openDeviceJourney, applyPairingClaims, refreshPairingClaims, stopDeviceJourneyPolling, startDeviceJourneyPolling, refreshDeviceJourneyFacts, renderDeviceJourneyProgress, deviceJourneyIdentity, renderDeviceJourneyIdentity, deviceJourneyFactState, renderDeviceJourneyFacts, renderDeviceJourneyActions, renderDeviceJourney, setDeviceJourneyBusy, createDeviceJourneyInvitation, inspectDeviceJourneyInvitation, joinFromDeviceJourney, decideDeviceJourneyClaim, connectFromDeviceJourney, finishDeviceJourney };
Object.assign(window, { deviceJourneyErrorText, deviceJourneyModel, openDeviceJourney, applyPairingClaims, refreshPairingClaims, stopDeviceJourneyPolling, startDeviceJourneyPolling, refreshDeviceJourneyFacts, renderDeviceJourneyProgress, deviceJourneyIdentity, renderDeviceJourneyIdentity, deviceJourneyFactState, renderDeviceJourneyFacts, renderDeviceJourneyActions, renderDeviceJourney, setDeviceJourneyBusy, createDeviceJourneyInvitation, inspectDeviceJourneyInvitation, joinFromDeviceJourney, decideDeviceJourneyClaim, connectFromDeviceJourney, finishDeviceJourney });
