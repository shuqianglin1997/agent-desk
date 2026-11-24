// AgentDesk — task packages: export, import, the incoming packages and the
// local history (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 10.6.1). Moved
// from src/renderer.js unchanged.

function directTaskPackageTargets() {
  if (crossDeviceActionsPaused()) return [];
  const overview = state.mesh.overview || {};
  const connections = new Map((overview.connections || [])
    .filter((connection) => connection?.authenticated === true)
    .map((connection) => [connection.deviceId, connection]));
  return (overview.devices || []).filter((device) => {
    if (!device || device.isLocal) return false;
    const connection = connections.get(device.deviceId);
    return Array.isArray(device.capabilities)
      && device.capabilities.includes('task.package.receive')
      && Array.isArray(device.permissions)
      && device.permissions.includes('task.package.receive')
      && Array.isArray(connection?.protocolFeatures)
      && connection.protocolFeatures.includes('task.package.transfer.v1');
  });
}

function renderTaskPackageDeliveryOptions() {
  const targets = directTaskPackageTargets();
  const hasDirectTarget = targets.length > 0;
  if (state.taskPackages.exportDelivery === 'direct' && !hasDirectTarget) {
    state.taskPackages.exportDelivery = 'portable';
    state.taskPackages.directTargetDeviceId = null;
  }
  if (els.taskPackageDeliveryPortable) {
    els.taskPackageDeliveryPortable.checked = state.taskPackages.exportDelivery !== 'direct';
  }
  if (els.taskPackageDeliveryDirect) {
    els.taskPackageDeliveryDirect.disabled = !hasDirectTarget;
    els.taskPackageDeliveryDirect.checked = state.taskPackages.exportDelivery === 'direct';
  }
  if (els.taskPackageDirectTarget) {
    const preferred = targets.some((item) => item.deviceId === state.taskPackages.directTargetDeviceId)
      ? state.taskPackages.directTargetDeviceId
      : targets[0]?.deviceId;
    els.taskPackageDirectTarget.replaceChildren();
    for (const device of targets) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = `${device.name} · ${tr('devices.status.online')}`;
      option.selected = device.deviceId === preferred;
      els.taskPackageDirectTarget.append(option);
    }
    state.taskPackages.directTargetDeviceId = preferred || null;
  }
  const direct = state.taskPackages.exportDelivery === 'direct';
  if (els.taskPackageDirectTargetField) els.taskPackageDirectTargetField.hidden = !direct;
  if (els.taskPackageDirectAvailability) {
    els.taskPackageDirectAvailability.textContent = hasDirectTarget
      ? tr('taskPackage.delivery.available', { n: targets.length })
      : tr('taskPackage.delivery.unavailable');
  }
  if (els.taskPackageSecurity) {
    els.taskPackageSecurity.textContent = tr(direct
      ? 'taskPackage.security.direct'
      : 'taskPackage.security');
  }
  if (els.exportTaskPackageBtn && !state.taskPackages.exportBusy) {
    els.exportTaskPackageBtn.textContent = tr(direct
      ? 'taskPackage.direct.send'
      : 'taskPackage.export');
    els.exportTaskPackageBtn.disabled = !state.taskPackages.exportPreview || (direct && !state.taskPackages.directTargetDeviceId);
  }
}

async function openTaskPackageExportDialog(returnFocus = document.activeElement) {
  const sessions = resolvedActionSessions();
  if (sessions.length !== 1) return;
  const session = sessions[0];
  const profile = sessionOwnerProfile(session);
  if (!session || !profile || !els.taskPackageDialog || !window.manager.previewTaskPackageExport) return;
  resetTaskPackageExportState();
  state.taskPackages.exportBusy = true;
  lockTaskPackageDialog('export', true);
  setTaskPackageStatus('export', tr('taskPackage.status.reading'), 'busy');
  openChildDialog(els.taskPackageDialog, returnFocus);
  let result;
  try {
    result = await window.manager.previewTaskPackageExport({
      profileId: profile.id,
      sessionId: session.id
    });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-preview-failed' };
  } finally {
    state.taskPackages.exportBusy = false;
    lockTaskPackageDialog('export', false);
  }
  if (!result?.ok || !result.preview?.supported) {
    state.taskPackages.exportPreview = null;
    setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode || 'task-package-source-unsupported'), 'error');
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = true;
    return;
  }
  state.taskPackages.exportPreview = result.preview;
  state.taskPackages.exportSource = {
    profileId: profile.id,
    sessionId: session.id,
    conversationId: session.conversationId || null
  };
  renderTaskPackageExportPreview();
  renderTaskPackageDeliveryOptions();
  setTaskPackageStatus('export', tr(
    result.preview.mode === 'native' ? 'taskPackage.status.nativeReady' : 'taskPackage.status.transcriptReady'
  ), 'idle');
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
}

function resetTaskPackageExportState() {
  if (els.taskPackageDialog) delete els.taskPackageDialog.dataset.flow;
  state.taskPackages.exportPreview = null;
  state.taskPackages.exportSource = null;
  state.taskPackages.exportBusy = false;
  state.taskPackages.exportCode = null;
  state.taskPackages.exportDelivery = 'portable';
  state.taskPackages.directTargetDeviceId = null;
  state.taskPackages.directTransfer = null;
  if (els.taskPackagePreview) els.taskPackagePreview.replaceChildren();
  for (const field of [
    els.taskPackageSender,
    els.taskPackageObjective,
    els.taskPackageCompleted,
    els.taskPackageNext,
    els.taskPackageBlockers,
    els.taskPackageAcceptance
  ]) {
    if (field) field.value = '';
  }
  if (els.taskPackageIncludeProject) els.taskPackageIncludeProject.checked = true;
  if (els.taskPackageIncludeAttachments) els.taskPackageIncludeAttachments.checked = false;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = true;
  if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
  if (els.taskPackageDirectResultDetail) els.taskPackageDirectResultDetail.textContent = '';
  if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = '';
  if (els.taskPackageStatus) {
    els.taskPackageStatus.textContent = '';
    els.taskPackageStatus.dataset.state = 'idle';
  }
  if (els.exportTaskPackageBtn) {
    els.exportTaskPackageBtn.hidden = false;
    els.exportTaskPackageBtn.disabled = true;
    els.exportTaskPackageBtn.textContent = tr('taskPackage.export');
  }
  renderTaskPackageDeliveryOptions();
  lockTaskPackageDialog('export', false);
}

function renderTaskPackageExportPreview() {
  if (!els.taskPackagePreview) return;
  els.taskPackagePreview.replaceChildren();
  const preview = state.taskPackages.exportPreview;
  if (!preview) return;
  const title = document.createElement('strong');
  title.textContent = preview.title;
  const meta = document.createElement('span');
  meta.textContent = [preview.sourceAgentName, preview.appLabel, preview.projectName].filter(Boolean).join(' · ');
  const badge = document.createElement('b');
  badge.textContent = preview.mode === 'native'
    ? tr('taskPackage.mode.nativeCount', { n: preview.nativeRecordCount })
    : tr('taskPackage.mode.transcript');
  els.taskPackagePreview.append(title, meta, badge);
}

async function exportCurrentTaskPackage() {
  if (state.taskPackages.exportBusy || !state.taskPackages.exportPreview || !state.taskPackages.exportSource) return;
  if (!els.taskPackageObjective?.value.trim()) {
    setTaskPackageStatus('export', tr('taskPackage.status.objectiveRequired'), 'error');
    els.taskPackageObjective?.focus();
    return;
  }
  const source = state.taskPackages.exportSource;
  const direct = state.taskPackages.exportDelivery === 'direct';
  const targetDeviceId = state.taskPackages.directTargetDeviceId;
  if (direct && crossDeviceActionsPaused()) {
    state.taskPackages.exportDelivery = 'portable';
    state.taskPackages.directTargetDeviceId = null;
    renderTaskPackageDeliveryOptions();
    setTaskPackageStatus('export', tr('status.crossDevicePaused'), 'error');
    return;
  }
  if (direct && !targetDeviceId) {
    setTaskPackageStatus('export', tr('taskPackage.delivery.unavailable'), 'error');
    return;
  }
  state.taskPackages.exportBusy = true;
  lockTaskPackageDialog('export', true);
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = true;
  setTaskPackageStatus('export', tr(direct
    ? 'taskPackage.direct.status.preparing'
    : 'taskPackage.status.exporting'), 'busy');
  let result;
  const input = {
    profileId: source.profileId,
    sessionId: source.sessionId,
    conversationId: source.conversationId,
    senderLabel: els.taskPackageSender?.value || '',
    checkpoint: {
      objective: els.taskPackageObjective?.value || '',
      completed: els.taskPackageCompleted?.value || '',
      next: els.taskPackageNext?.value || '',
      blockers: els.taskPackageBlockers?.value || '',
      acceptance: els.taskPackageAcceptance?.value || ''
    },
    includeProject: els.taskPackageIncludeProject?.checked !== false,
    includeAttachments: els.taskPackageIncludeAttachments?.checked === true
  };
  try {
    result = direct
      ? await window.manager.sendTaskPackageToDevice({ ...input, targetDeviceId })
      : await window.manager.exportTaskPackage(input);
  } catch (_error) {
    result = { ok: false, reasonCode: direct
      ? 'task-package-direct-send-failed'
      : 'task-package-export-failed' };
  } finally {
    state.taskPackages.exportBusy = false;
    lockTaskPackageDialog('export', false);
  }
  if (result?.cancelled) {
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
    setTaskPackageStatus('export', tr('taskPackage.status.cancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
    setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode), 'error');
    if (direct && els.taskPackageDirectResult) {
      els.taskPackageDirectResult.hidden = false;
      if (els.taskPackageDirectResultDetail) {
        els.taskPackageDirectResultDetail.textContent = tr('taskPackage.direct.status.fallback', {
          reason: taskPackageErrorText(result?.reasonCode)
        });
      }
      if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = false;
    }
    return;
  }
  if (direct) {
    state.taskPackages.directTransfer = result.transfer || null;
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    state.taskPackages.history = result.history || state.taskPackages.history;
    if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = false;
    if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = true;
    const target = directTaskPackageTargets().find((item) => item.deviceId === targetDeviceId);
    const failed = result.transfer?.state === 'failed';
    if (els.taskPackageDirectResultDetail) {
      els.taskPackageDirectResultDetail.textContent = failed
        ? tr('taskPackage.direct.status.fallback', {
            reason: taskPackageErrorText(result.transfer?.lastError)
          })
        : tr('taskPackage.direct.status.queued', { name: target?.name || '-' });
    }
    if (els.taskPackageSwitchPortableBtn) {
      els.taskPackageSwitchPortableBtn.hidden = !failed;
    }
    if (els.exportTaskPackageBtn) {
      els.exportTaskPackageBtn.disabled = true;
      els.exportTaskPackageBtn.textContent = tr('taskPackage.direct.sent');
    }
    setTaskPackageStatus('export', failed
      ? tr('taskPackage.direct.status.failed')
      : tr('taskPackage.direct.status.waiting'), failed ? 'error' : 'idle');
    renderTransferList();
    renderIncomingTaskPackages();
    renderTaskPackageHistory();
    return;
  }
  state.taskPackages.exportCode = result.exported.unlockCode;
  state.taskPackages.history = result.history || state.taskPackages.history;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = result.exported.unlockCode;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
  if (els.exportTaskPackageBtn) {
    els.exportTaskPackageBtn.disabled = true;
    els.exportTaskPackageBtn.textContent = tr('taskPackage.export.done');
  }
  setTaskPackageStatus('export', tr('taskPackage.status.exported'), 'idle');
  renderTaskPackageHistory();
}

async function saveOrSwitchTaskPackageToPortable() {
  const transfer = state.taskPackages.directTransfer;
  if (transfer?.canSavePortable && window.manager.saveTaskPackageFallback) {
    state.taskPackages.exportBusy = true;
    lockTaskPackageDialog('export', true);
    setTaskPackageStatus('export', tr('taskPackage.direct.status.savingFallback'), 'busy');
    let result;
    try {
      result = await window.manager.saveTaskPackageFallback(transfer.transferId);
    } catch (_error) {
      result = { ok: false, reasonCode: 'task-package-portable-fallback-failed' };
    } finally {
      state.taskPackages.exportBusy = false;
      lockTaskPackageDialog('export', false);
    }
    if (result?.cancelled) {
      setTaskPackageStatus('export', tr('taskPackage.status.cancelled'), 'idle');
      return;
    }
    if (!result?.ok) {
      setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode), 'error');
      return;
    }
    state.taskPackages.exportCode = result.saved.unlockCode;
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = result.saved.unlockCode;
    if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
    if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
    if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
    setTaskPackageStatus('export', tr('taskPackage.direct.status.fallbackSaved'), 'idle');
    renderTransferList();
    return;
  }
  state.taskPackages.exportDelivery = 'portable';
  state.taskPackages.directTransfer = null;
  if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
  if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
  renderTaskPackageDeliveryOptions();
  setTaskPackageStatus('export', tr('taskPackage.direct.status.switchedPortable'), 'idle');
}

function openTaskPackageImportDialog(returnFocus = document.activeElement, options = {}) {
  if (!els.taskPackageImportDialog) return;
  resetTaskPackageImportState();
  if (options.mode === 'direct' && options.prepared?.draft && options.prepared?.inspected) {
    state.taskPackages.importMode = 'direct';
    state.taskPackages.importTransferId = options.transfer?.transferId || null;
    state.taskPackages.importDraft = options.prepared.draft;
    state.taskPackages.importPreview = options.prepared.inspected;
    if (els.taskPackagePortableImportSource) els.taskPackagePortableImportSource.hidden = true;
    if (els.taskPackageDirectImportSource) els.taskPackageDirectImportSource.hidden = false;
    const manifest = options.prepared.inspected.manifest;
    if (els.taskPackageDirectImportTitle) {
      els.taskPackageDirectImportTitle.textContent = manifest.session.originalTitle;
    }
    if (els.taskPackageDirectImportMeta) {
      els.taskPackageDirectImportMeta.textContent = [
        options.transfer?.receivedFromName,
        manifest.source.agentName,
        formatBytes(manifest.bytesTotal)
      ].filter(Boolean).join(' · ');
    }
    renderTaskPackageImportPreview();
    setTaskPackageStatus('import', options.prepared.inspected.compatibleProfiles.length
      ? tr('taskPackage.import.status.verified')
      : tr('taskPackage.import.status.noTarget'), options.prepared.inspected.compatibleProfiles.length ? 'idle' : 'error');
  }
  openChildDialog(els.taskPackageImportDialog, returnFocus);
}

function resetTaskPackageImportState() {
  state.taskPackages.importDraft = null;
  state.taskPackages.importPreview = null;
  state.taskPackages.importBusy = false;
  state.taskPackages.importMode = 'portable';
  state.taskPackages.importTransferId = null;
  if (els.taskPackagePortableImportSource) els.taskPackagePortableImportSource.hidden = false;
  if (els.taskPackageDirectImportSource) els.taskPackageDirectImportSource.hidden = true;
  if (els.taskPackageDirectImportTitle) els.taskPackageDirectImportTitle.textContent = '';
  if (els.taskPackageDirectImportMeta) els.taskPackageDirectImportMeta.textContent = '';
  if (els.taskPackageImportFile) els.taskPackageImportFile.textContent = tr('taskPackage.import.noFile');
  if (els.taskPackageImportCode) els.taskPackageImportCode.value = '';
  if (els.taskPackageImportPreview) {
    els.taskPackageImportPreview.hidden = true;
    els.taskPackageImportPreview.replaceChildren();
  }
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = true;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = true;
  if (els.taskPackageTargetProfile) els.taskPackageTargetProfile.replaceChildren();
  if (els.taskPackageOpenAfter) els.taskPackageOpenAfter.checked = true;
  if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = false;
  if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = false;
  if (els.commitTaskPackageBtn) {
    els.commitTaskPackageBtn.disabled = true;
    els.commitTaskPackageBtn.textContent = tr('taskPackage.import.commit');
  }
  lockTaskPackageDialog('import', false);
  if (els.taskPackageImportStatus) {
    els.taskPackageImportStatus.textContent = tr('taskPackage.import.status.choose');
    els.taskPackageImportStatus.dataset.state = 'idle';
  }
}

async function chooseTaskPackageImportFile() {
  if (state.taskPackages.importBusy || !window.manager.chooseTaskPackageImport) return;
  await cancelTaskPackageImportDraft();
  clearTaskPackageImportInspection();
  if (els.taskPackageImportFile) els.taskPackageImportFile.textContent = tr('taskPackage.import.noFile');
  if (els.taskPackageImportCode) els.taskPackageImportCode.value = '';
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.choosing'), 'busy');
  let result;
  try {
    result = await window.manager.chooseTaskPackageImport();
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-choose-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
    if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = false;
  }
  if (result?.cancelled) {
    setTaskPackageStatus('import', tr('taskPackage.status.cancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.importDraft = result.draft;
  state.taskPackages.importPreview = null;
  if (els.taskPackageImportFile) {
    els.taskPackageImportFile.textContent = `${result.draft.fileName} · ${formatBytes(result.draft.size)}`;
  }
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.enterCode'), 'idle');
}

async function inspectTaskPackageImport() {
  const draft = state.taskPackages.importDraft;
  if (!draft || state.taskPackages.importBusy) return;
  const unlockCode = els.taskPackageImportCode?.value || '';
  if (!unlockCode.trim()) {
    setTaskPackageStatus('import', tr('taskPackage.import.status.codeRequired'), 'error');
    return;
  }
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.inspecting'), 'busy');
  let result;
  try {
    result = await window.manager.inspectTaskPackageImport({ token: draft.token, unlockCode });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-inspect-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
    if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = false;
  }
  if (!result?.ok) {
    state.taskPackages.importPreview = null;
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.importPreview = result.inspected;
  renderTaskPackageImportPreview();
  setTaskPackageStatus('import', result.inspected.compatibleProfiles.length
    ? tr('taskPackage.import.status.verified')
    : tr('taskPackage.import.status.noTarget'), result.inspected.compatibleProfiles.length ? 'idle' : 'error');
}

function renderTaskPackageImportPreview() {
  const inspected = state.taskPackages.importPreview;
  if (!inspected || !els.taskPackageImportPreview) return;
  const manifest = inspected.manifest;
  els.taskPackageImportPreview.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = manifest.session.originalTitle;
  const meta = document.createElement('span');
  meta.textContent = [
    manifest.source.senderLabel,
    manifest.source.agentName,
    manifest.project?.name,
    formatBytes(manifest.bytesTotal)
  ].filter(Boolean).join(' · ');
  const badge = document.createElement('b');
  badge.textContent = tr(manifest.session.mode === 'native' ? 'taskPackage.mode.native' : 'taskPackage.mode.transcript');
  els.taskPackageImportPreview.append(title, meta, badge);
  const details = document.createElement('div');
  details.className = 'task-package-import-preview-details';
  appendTaskPackagePreviewSection(details, tr('taskPackage.objective'), manifest.checkpoint.objective
    ? [manifest.checkpoint.objective]
    : []);
  appendTaskPackagePreviewSection(details, tr('taskPackage.completed'), manifest.checkpoint.completed);
  appendTaskPackagePreviewSection(details, tr('taskPackage.next'), manifest.checkpoint.next);
  appendTaskPackagePreviewSection(details, tr('taskPackage.blockers'), manifest.checkpoint.blockers);
  appendTaskPackagePreviewSection(details, tr('taskPackage.acceptance'), manifest.checkpoint.acceptance);
  if (manifest.project) {
    const projectFacts = [
      manifest.project.name,
      manifest.project.branch,
      manifest.project.head ? manifest.project.head.slice(0, 12) : null,
      tr(manifest.project.dirty ? 'taskPackage.import.preview.gitDirty' : 'taskPackage.import.preview.gitClean')
    ].filter(Boolean);
    appendTaskPackagePreviewSection(details, tr('taskPackage.import.preview.project'), projectFacts);
  }
  const attachmentCount = manifest.entries.filter((entry) => entry.kind === 'attachment').length;
  if (attachmentCount) {
    appendTaskPackagePreviewSection(details, tr('taskPackage.import.preview.attachments'), [
      tr('taskPackage.import.preview.attachmentCount', { n: attachmentCount })
    ]);
  }
  els.taskPackageImportPreview.append(details);
  els.taskPackageImportPreview.hidden = false;

  if (els.taskPackageTargetProfile) {
    els.taskPackageTargetProfile.replaceChildren();
    for (const profile of inspected.compatibleProfiles) {
      const option = document.createElement('option');
      option.value = profile.profileId;
      option.textContent = [
        profile.agentName,
        profile.name !== profile.agentName ? profile.name : null,
        profile.appLabel
      ].filter(Boolean).join(' · ');
      els.taskPackageTargetProfile.append(option);
    }
  }
  const hasTargets = inspected.compatibleProfiles.length > 0;
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = !hasTargets;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = !hasTargets;
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = !hasTargets;
}

function appendTaskPackagePreviewSection(container, label, values = []) {
  const section = document.createElement('section');
  const heading = document.createElement('strong');
  heading.textContent = label;
  section.append(heading);
  const lines = (Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean);
  if (!lines.length) {
    const empty = document.createElement('span');
    empty.textContent = tr('taskPackage.import.preview.notProvided');
    section.append(empty);
  } else {
    const list = document.createElement('ul');
    for (const value of lines) {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    }
    section.append(list);
  }
  container.append(section);
}

async function commitTaskPackageImport() {
  const draft = state.taskPackages.importDraft;
  const inspected = state.taskPackages.importPreview;
  const targetProfileId = els.taskPackageTargetProfile?.value || '';
  if (!draft || !inspected || !targetProfileId || state.taskPackages.importBusy) return;
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.importing'), 'busy');
  let result;
  try {
    result = await window.manager.commitTaskPackageImport({
      token: draft.token,
      targetProfileId,
      openAfterImport: els.taskPackageOpenAfter?.checked !== false
    });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-commit-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
  }
  if (result?.cancelled) {
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = false;
    setTaskPackageStatus('import', tr('taskPackage.import.status.destinationCancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = false;
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.history = result.history || state.taskPackages.history;
  state.taskPackages.importDraft = null;
  state.taskPackages.importTransferId = null;
  if (els.commitTaskPackageBtn) {
    els.commitTaskPackageBtn.disabled = true;
    els.commitTaskPackageBtn.textContent = tr('taskPackage.import.done');
  }
  const targetName = result.imported.targetAgentName || result.imported.targetProfileName;
  const completedText = tr(
    result.imported.sessionMode === 'native'
      ? 'taskPackage.import.status.nativeDone'
      : 'taskPackage.import.status.materialsDone',
    { name: targetName }
  );
  setTaskPackageStatus('import', result.imported.openFailed
    ? `${completedText} ${tr('taskPackage.import.status.openFailed')}`
    : completedText, result.imported.openFailed ? 'error' : 'idle');
  setStatus(tr('taskPackage.status.received', { name: targetName }));
  renderTaskPackageHistory();
  renderIncomingTaskPackages();
  if (result.imported.sessionMode === 'native') await loadProfiles();
}

async function cancelTaskPackageImportDraft() {
  const token = state.taskPackages.importDraft?.token;
  state.taskPackages.importDraft = null;
  state.taskPackages.importPreview = null;
  if (token && window.manager.cancelTaskPackageImport) {
    try { await window.manager.cancelTaskPackageImport(token); } catch (_error) { /* Main also expires drafts. */ }
  }
}

function clearTaskPackageImportInspection() {
  state.taskPackages.importPreview = null;
  if (els.taskPackageImportPreview) {
    els.taskPackageImportPreview.hidden = true;
    els.taskPackageImportPreview.replaceChildren();
  }
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = true;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = true;
  if (els.taskPackageTargetProfile) els.taskPackageTargetProfile.replaceChildren();
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
}

function lockTaskPackageDialog(kind, locked) {
  const controls = kind === 'import'
    ? [els.taskPackageImportCloseBtn, els.taskPackageImportCancelBtn]
    : [els.taskPackageCloseBtn, els.taskPackageCancelBtn];
  for (const control of controls) {
    if (control) control.disabled = Boolean(locked);
  }
}

async function loadTaskPackageHistory() {
  if (!window.manager.listTaskPackages) return;
  const result = await window.manager.listTaskPackages();
  if (result?.ok) state.taskPackages.history = result.history || [];
  renderTaskPackageHistory();
  renderIncomingTaskPackages();
}

function handledIncomingTaskPackageTransferIds() {
  return new Set((state.taskPackages.history || [])
    .filter((item) => item.direction === 'imported' && item.transferId)
    .map((item) => item.transferId));
}

function incomingTaskPackageTransfers() {
  const handled = handledIncomingTaskPackageTransferIds();
  return (state.mesh.transfers || []).filter((transfer) => (
    transfer.type === 'task-package'
      && transfer.direction === 'incoming'
      && !handled.has(transfer.transferId)
  ));
}

function pendingIncomingTaskPackageCount() {
  return incomingTaskPackageTransfers().filter((transfer) => (
    transfer.acceptRequired
      || transfer.state === 'receiving'
      || (transfer.state === 'completed' && transfer.canImport)
  )).length;
}

function renderIncomingTaskPackages() {
  if (!els.incomingTaskPackages || !els.incomingTaskPackageList) return;
  const transfers = incomingTaskPackageTransfers();
  els.incomingTaskPackages.hidden = transfers.length === 0;
  els.incomingTaskPackageList.replaceChildren();
  if (els.incomingTaskPackageCount) els.incomingTaskPackageCount.textContent = String(transfers.length);
  for (const transfer of transfers) {
    els.incomingTaskPackageList.append(createIncomingTaskPackageCard(transfer));
  }
  if (els.attentionEmpty) {
    els.attentionEmpty.hidden = transfers.length > 0 || collectAttentionItems().length > 0;
  }
  updateActivityBadge();
}

function createIncomingTaskPackageCard(transfer) {
  const summary = transfer.taskPackage || {};
  const card = document.createElement('article');
  card.className = 'incoming-task-package-card';
  const head = document.createElement('div');
  head.className = 'incoming-task-package-card-head';
  const identity = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = summary.title || tr('taskPackage.history.untitled');
  const meta = document.createElement('small');
  meta.textContent = [
    transfer.receivedFromName,
    summary.sourceAgentName,
    summary.senderLabel,
    summary.appId ? appLabel(summary.appId) : null,
    formatBytes(transfer.bytesTotal || 0)
  ].filter(Boolean).join(' · ');
  identity.append(title, meta);
  const status = document.createElement('span');
  status.className = 'incoming-task-package-state';
  status.textContent = taskPackageTransferStateText(transfer);
  head.append(identity, status);
  card.append(head);
  if (summary.objective) {
    const objective = document.createElement('small');
    objective.textContent = summary.objective;
    card.append(objective);
  }
  if (summary.attachmentCount) {
    const attachments = document.createElement('small');
    attachments.textContent = tr('taskPackage.incoming.attachments', { n: summary.attachmentCount });
    card.append(attachments);
  }
  if (['receiving', 'sending'].includes(transfer.state)) {
    const progress = document.createElement('progress');
    progress.max = Math.max(1, transfer.bytesTotal || 0);
    progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
    progress.setAttribute('aria-label', tr('transfers.progress'));
    card.append(progress);
  }
  const actions = createTaskPackageTransferActions(transfer, { returnFocus: null });
  if (actions.childElementCount) card.append(actions);
  return card;
}

function taskPackageTransferStateText(transfer) {
  if (transfer.acceptRequired) return tr('taskPackage.incoming.state.awaiting');
  if (transfer.state === 'receiving') return tr('taskPackage.incoming.state.receiving');
  if (transfer.state === 'completed' && transfer.canImport) return tr('taskPackage.incoming.state.ready');
  if (transfer.requiresNewPackage || transfer.secretUnavailable) return tr('taskPackage.incoming.state.resend');
  return tr(`transfers.state.${transfer.state}`);
}

function createTaskPackageTransferActions(transfer, options = {}) {
  const actions = document.createElement('div');
  actions.className = 'incoming-task-package-actions transfer-card-actions';
  const busy = state.taskPackages.directBusyTransferId === transfer.transferId;
  const add = (label, primary, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    if (primary) button.className = 'primary';
    button.textContent = label;
    button.disabled = busy;
    button.addEventListener('click', () => handler(button));
    actions.append(button);
  };
  if (transfer.direction === 'incoming' && transfer.acceptRequired) {
    add(tr('taskPackage.incoming.accept'), true, (button) => acceptIncomingTaskPackage(transfer, button));
    add(tr('taskPackage.incoming.reject'), false, (button) => rejectIncomingTaskPackage(transfer, button));
  } else if (transfer.direction === 'incoming' && transfer.state === 'completed' && transfer.canImport) {
    add(tr('taskPackage.incoming.inspect'), true, (button) => prepareIncomingTaskPackage(transfer, button));
  }
  if (transfer.direction === 'outgoing' && transfer.state === 'failed' && transfer.canSavePortable) {
    add(tr('taskPackage.direct.savePortable'), false, (button) => saveTaskPackageTransferFallback(transfer, button, options.returnFocus));
  }
  return actions;
}

async function acceptIncomingTaskPackage(transfer) {
  if (state.taskPackages.directBusyTransferId || !window.manager.acceptIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.acceptIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-accept-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.ok) {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    setStatus(tr('taskPackage.incoming.accepted'));
  } else {
    setStatus(taskPackageErrorText(result?.reasonCode));
  }
  renderIncomingTaskPackages();
  renderTransferList();
}

async function rejectIncomingTaskPackage(transfer) {
  if (state.taskPackages.directBusyTransferId || !window.manager.rejectIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.rejectIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-reject-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.ok) {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    setStatus(tr('taskPackage.incoming.rejected'));
  } else {
    setStatus(taskPackageErrorText(result?.reasonCode));
  }
  renderIncomingTaskPackages();
  renderTransferList();
}

async function prepareIncomingTaskPackage(transfer, returnFocus = document.activeElement) {
  if (state.taskPackages.directBusyTransferId || !window.manager.prepareIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.prepareIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-prepare-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (!result?.ok) {
    setStatus(taskPackageErrorText(result?.reasonCode));
    if (result?.transfers) state.mesh.transfers = result.transfers;
    renderIncomingTaskPackages();
    renderTransferList();
    return;
  }
  state.mesh.transfers = result.transfers || state.mesh.transfers;
  openTaskPackageImportDialog(returnFocus, {
    mode: 'direct',
    transfer,
    prepared: { draft: result.draft, inspected: result.inspected }
  });
  renderIncomingTaskPackages();
  renderTransferList();
}

async function saveTaskPackageTransferFallback(transfer, returnFocus = document.activeElement) {
  if (state.taskPackages.directBusyTransferId || !window.manager.saveTaskPackageFallback) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderTransferList();
  let result;
  try {
    result = await window.manager.saveTaskPackageFallback(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-portable-fallback-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.cancelled) {
    setStatus(tr('taskPackage.status.cancelled'));
  } else if (!result?.ok) {
    setStatus(taskPackageErrorText(result?.reasonCode));
  } else {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    showTaskPackageFallbackResult(result.saved, returnFocus);
  }
  renderTransferList();
}

function showTaskPackageFallbackResult(saved, returnFocus = document.activeElement) {
  if (!saved?.unlockCode || !els.taskPackageDialog) return;
  resetTaskPackageExportState();
  els.taskPackageDialog.dataset.flow = 'fallback';
  state.taskPackages.exportCode = saved.unlockCode;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = saved.unlockCode;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.hidden = true;
  setTaskPackageStatus('export', tr('taskPackage.direct.status.fallbackSaved'), 'idle');
  openChildDialog(els.taskPackageDialog, returnFocus);
}

function renderTaskPackageHistory() {
  if (!els.taskPackageHistoryList) return;
  const history = state.taskPackages.history || [];
  els.taskPackageHistoryList.replaceChildren();
  if (els.taskPackageHistoryCount) els.taskPackageHistoryCount.textContent = String(history.length);
  if (els.taskPackageHistoryEmpty) els.taskPackageHistoryEmpty.hidden = history.length > 0;
  for (const item of history.slice(0, 12)) {
    const card = document.createElement('article');
    card.className = 'task-package-history-card';
    const title = document.createElement('strong');
    title.textContent = item.title || tr('taskPackage.history.untitled');
    const meta = document.createElement('small');
    const direction = tr(item.direction === 'imported'
      ? 'taskPackage.history.imported'
      : 'taskPackage.history.exported');
    const mode = tr(item.sessionMode === 'native' ? 'taskPackage.mode.native' : 'taskPackage.mode.transcript');
    meta.textContent = [direction, mode, item.sourceAgentName, item.targetAgentName, compactDate(item.recordedAt || item.createdAt)].filter(Boolean).join(' · ');
    card.append(title, meta);
    if (item.canReveal) {
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.textContent = tr('taskPackage.history.reveal');
      reveal.addEventListener('click', async () => {
        const result = await window.manager.revealTaskPackage({
          packageId: item.packageId,
          direction: item.direction
        });
        if (!result?.ok) setStatus(taskPackageErrorText(result?.reasonCode));
      });
      card.append(reveal);
    }
    els.taskPackageHistoryList.append(card);
  }
}

function setTaskPackageStatus(kind, message, tone = 'idle') {
  const element = kind === 'import' ? els.taskPackageImportStatus : els.taskPackageStatus;
  if (!element) return;
  element.textContent = message || '';
  element.dataset.state = tone;
}

function taskPackageErrorText(code) {
  const value = String(code || 'task-package-failed');
  if (/task-package-rejected/.test(value)) return tr('taskPackage.error.rejected');
  if (/direct-connection|required.*connection|peer-not-connected|device-offline/.test(value)) return tr('taskPackage.error.directOffline');
  if (/feature-unavailable|protocol-feature-unavailable|unsupported.*task/.test(value)) return tr('taskPackage.error.directFeature');
  if (/capability|permission/.test(value)) return tr('taskPackage.error.directPermission');
  if (/secret-unavailable|requires-new-package/.test(value)) return tr('taskPackage.error.resend');
  if (/portable-fallback/.test(value)) return tr('taskPackage.error.fallback');
  if (/unlock|decrypt/.test(value)) return tr('taskPackage.error.unlock');
  if (/session-conflict|file-conflict/.test(value)) return tr('taskPackage.error.conflict');
  if (/target-(incompatible|not-codex)|native-adapter-unsupported/.test(value)) return tr('taskPackage.error.target');
  if (/source-unsupported/.test(value)) return tr('taskPackage.error.source');
  if (/git-patch-too-large/.test(value)) return tr('taskPackage.error.patchLarge');
  if (/git-snapshot-failed/.test(value)) return tr('taskPackage.error.gitSnapshot');
  if (/attachment-count/.test(value)) return tr('taskPackage.error.attachmentCount');
  if (/attachment-(changing|short-read|invalid|write)/.test(value)) return tr('taskPackage.error.attachmentChanged');
  if (/record-limit/.test(value)) return tr('taskPackage.error.recordLimit');
  if (/format|schema|manifest|hash|truncated|trailing|entry|jsonl|session-meta/.test(value)) return tr('taskPackage.error.invalid');
  if (/changing/.test(value)) return tr('taskPackage.error.changing');
  return tr('taskPackage.error.generic', { code: value });
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { directTaskPackageTargets, renderTaskPackageDeliveryOptions, openTaskPackageExportDialog, resetTaskPackageExportState, renderTaskPackageExportPreview, exportCurrentTaskPackage, saveOrSwitchTaskPackageToPortable, openTaskPackageImportDialog, resetTaskPackageImportState, chooseTaskPackageImportFile, inspectTaskPackageImport, renderTaskPackageImportPreview, appendTaskPackagePreviewSection, commitTaskPackageImport, cancelTaskPackageImportDraft, clearTaskPackageImportInspection, lockTaskPackageDialog, loadTaskPackageHistory, handledIncomingTaskPackageTransferIds, incomingTaskPackageTransfers, pendingIncomingTaskPackageCount, renderIncomingTaskPackages, createIncomingTaskPackageCard, taskPackageTransferStateText, createTaskPackageTransferActions, acceptIncomingTaskPackage, rejectIncomingTaskPackage, prepareIncomingTaskPackage, saveTaskPackageTransferFallback, showTaskPackageFallbackResult, renderTaskPackageHistory, setTaskPackageStatus, taskPackageErrorText };
Object.assign(window, { directTaskPackageTargets, renderTaskPackageDeliveryOptions, openTaskPackageExportDialog, resetTaskPackageExportState, renderTaskPackageExportPreview, exportCurrentTaskPackage, saveOrSwitchTaskPackageToPortable, openTaskPackageImportDialog, resetTaskPackageImportState, chooseTaskPackageImportFile, inspectTaskPackageImport, renderTaskPackageImportPreview, appendTaskPackagePreviewSection, commitTaskPackageImport, cancelTaskPackageImportDraft, clearTaskPackageImportInspection, lockTaskPackageDialog, loadTaskPackageHistory, handledIncomingTaskPackageTransferIds, incomingTaskPackageTransfers, pendingIncomingTaskPackageCount, renderIncomingTaskPackages, createIncomingTaskPackageCard, taskPackageTransferStateText, createTaskPackageTransferActions, acceptIncomingTaskPackage, rejectIncomingTaskPackage, prepareIncomingTaskPackage, saveTaskPackageTransferFallback, showTaskPackageFallbackResult, renderTaskPackageHistory, setTaskPackageStatus, taskPackageErrorText });
