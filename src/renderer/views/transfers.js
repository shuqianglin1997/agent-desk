// AgentDesk — sending session information and files to a device, and the
// transfer records (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 10.6). Moved
// from src/renderer.js unchanged.

async function openSessionSendDialog(preselectedDeviceId = null, returnFocus = document.activeElement) {
  if (!els.sessionSendDialog) return;
  if (crossDeviceActionsPaused()) {
    setStatus(tr('status.crossDevicePaused'));
    return;
  }
  const sessions = resolvedActionSessions();
  const selections = sessions.map((session) => ({
    conversationId: session.conversationId,
    replicaId: session._replicaId
  })).filter((item) => item.conversationId && item.replicaId);
  if (!selections.length) return;
  const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
  const targetDeviceId = populateTransferTargets(els.sessionSendTarget, remotes, preselectedDeviceId);
  state.ui = window.UiContext.createSessionPointerDraft(state.ui, {
    targetDeviceId,
    selections,
    message: remotes.length ? tr('transfers.ready', { n: selections.length }) : tr('transfers.noDevice')
  });
  renderSessionSendStatus();
  openChildDialog(els.sessionSendDialog, returnFocus);
}

async function openFileSendDialog(preselectedDeviceId = null, returnFocus = document.activeElement) {
  if (!els.fileSendDialog) return;
  if (crossDeviceActionsPaused()) {
    setStatus(tr('status.crossDevicePaused'));
    return;
  }
  const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
  const targetDeviceId = populateTransferTargets(els.fileSendTarget, remotes, preselectedDeviceId);
  state.ui = window.UiContext.createFileDraft(state.ui, {
    targetDeviceId,
    message: remotes.length ? tr('transfers.filesReady') : tr('transfers.noDevice')
  });
  renderFileSendStatus();
  openChildDialog(els.fileSendDialog, returnFocus);
}

function populateTransferTargets(select, devices, preselectedDeviceId) {
  if (!select) return null;
  select.replaceChildren();
  const preferred = devices.some((device) => device.deviceId === preselectedDeviceId)
    ? preselectedDeviceId
    : devices[0]?.deviceId;
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = `${device.name} · ${tr(`devices.status.${device.status || 'offline'}`)}`;
    option.selected = device.deviceId === preferred;
    select.append(option);
  }
  return preferred || null;
}

// 传输记录在收件箱的“记录”一段：打开收件箱、读一次最新记录，再把那一段滚到眼前。
async function openTransferCenter() {
  openUtilityDialog('activity');
  renderAttentionInbox();
  await Promise.all([loadTransfers(), loadTaskPackageHistory()]);
  els.inboxRecords?.scrollIntoView({ block: 'start' });
  els.inboxRecords?.querySelector('button')?.focus({ preventScroll: true });
}

async function chooseFilesForTransfer() {
  if (state.mesh.transferLoading || !window.manager.chooseFileTransfer) return;
  const draft = state.ui.transferDraft;
  if (draft?.kind !== 'files') return;
  const targetDeviceId = String(draft.targetDeviceId || '');
  if (!targetDeviceId) return;
  state.mesh.transferLoading = true;
  state.ui = window.UiContext.updateTransferDraft(state.ui, {
    message: tr('transfers.filesPreparing'),
    tone: 'busy'
  });
  renderFileSendStatus();
  const result = await window.manager.chooseFileTransfer({ targetDeviceId });
  state.mesh.transferLoading = false;
  if (!result?.ok) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: meshErrorText(result?.reasonCode || 'file-transfer-create-failed'),
      tone: 'error'
    });
  } else if (result.cancelled) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr('transfers.filePickerCancelled'),
      tone: 'idle'
    });
  } else {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr(
        result.transfer?.state === 'completed' ? 'transfers.filesSent' : 'transfers.filesOffered',
        { n: result.transfer?.itemCount || 0 }
      ),
      tone: 'idle'
    });
  }
  renderFileSendStatus();
  renderTransferList();
}

async function sendSelectedSessionsToDevice() {
  if (state.mesh.transferLoading || !window.manager.createSessionPointerTransfer) return;
  const draft = state.ui.transferDraft;
  if (draft?.kind !== 'session-pointer') return;
  const targetDeviceId = String(draft.targetDeviceId || '');
  const selections = draft.selections || [];
  if (!targetDeviceId || !selections.length) return;
  state.mesh.transferLoading = true;
  state.ui = window.UiContext.updateTransferDraft(state.ui, {
    message: tr('transfers.sending'),
    tone: 'busy'
  });
  renderSessionSendStatus();
  const result = await window.manager.createSessionPointerTransfer({ targetDeviceId, selections });
  state.mesh.transferLoading = false;
  if (!result?.ok) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: meshErrorText(result?.reasonCode || 'transfer-create-failed'),
      tone: 'error'
    });
  } else {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr(
        result.transfer?.state === 'completed' ? 'transfers.sent' : 'transfers.queued',
        { n: result.transfer?.itemCount || selections.length }
      ),
      tone: 'idle'
    });
  }
  renderSessionSendStatus();
  if (result?.ok && result.transfer?.transferId) {
    // 信封等送出的弹窗合上以后，从这几行飞到顶栏的设备那里（见 deskSendFlights）
    state.hub.sent.push({
      transferId: result.transfer.transferId,
      keys: actionSessions().map((session) => sessionKey(session)),
      state: result.transfer.state,
      flown: false,
      delivered: false
    });
    state.hub.sent = state.hub.sent.slice(-8);
  }
  await loadTransfers();
}

async function loadTransfers() {
  if (!window.manager.listTransfers) return;
  const result = await window.manager.listTransfers();
  if (result?.ok) state.mesh.transfers = result.transfers || [];
  else state.mesh.transferMessage = meshErrorText(result?.reasonCode || 'transfer-list-failed');
  renderSessionSendStatus();
  renderFileSendStatus();
  renderTransferList();
  renderIncomingTaskPackages();
}

function renderSessionSendStatus() {
  const draft = state.ui.transferDraft;
  if (!els.sessionSendStatus || draft?.kind !== 'session-pointer') return;
  els.sessionSendStatus.textContent = draft.message || tr('transfers.ready', { n: draft.selections.length });
  els.sessionSendStatus.dataset.state = draft.tone || 'idle';
  if (els.confirmSessionSendBtn) {
    els.confirmSessionSendBtn.disabled = state.mesh.transferLoading
      || !draft.targetDeviceId
      || draft.selections.length === 0;
  }
}

function renderFileSendStatus() {
  const draft = state.ui.transferDraft;
  if (!els.fileSendStatus || draft?.kind !== 'files') return;
  els.fileSendStatus.textContent = draft.message || tr('transfers.filesReady');
  els.fileSendStatus.dataset.state = draft.tone || 'idle';
  const target = (state.mesh.overview?.devices || []).find((device) => device.deviceId === draft.targetDeviceId);
  const canReceiveFiles = Array.isArray(target?.permissions) && target.permissions.includes('file.receive');
  if (els.chooseFilesBtn) {
    els.chooseFilesBtn.disabled = state.mesh.transferLoading || !target || !canReceiveFiles;
    els.chooseFilesBtn.title = canReceiveFiles ? '' : tr('transfers.filePermissionRequired');
  }
}

function renderTransferList() {
  if (!els.transferList) return;
  els.transferList.replaceChildren();
  if (!state.mesh.transfers.length) {
    const empty = document.createElement('p');
    empty.className = 'transfer-empty';
    empty.textContent = tr('transfers.empty');
    els.transferList.append(empty);
    return;
  }
  for (const transfer of state.mesh.transfers) {
    const card = document.createElement('article');
    card.className = 'transfer-card';
    const head = document.createElement('div');
    head.className = 'transfer-card-head';
    const title = document.createElement('strong');
    title.textContent = transfer.type === 'task-package'
      ? tr(transfer.direction === 'incoming'
        ? 'taskPackage.transfer.incoming'
        : 'taskPackage.transfer.outgoing', {
          title: transfer.taskPackage?.title || tr('taskPackage.history.untitled'),
          name: transfer.receivedFromName || transfer.targetName || '-'
        })
      : tr(transfer.direction === 'incoming' ? 'transfers.incoming' : 'transfers.outgoing', {
          n: transfer.itemCount,
          name: transfer.receivedFromName || transfer.targetName || '-'
        });
    const stateLabel = document.createElement('span');
    stateLabel.dataset.state = transfer.state;
    stateLabel.textContent = tr(`transfers.state.${transfer.state}`);
    head.append(title, stateLabel);
    const meta = document.createElement('small');
    const typeLabel = transfer.type === 'task-package'
      ? tr('transfers.type.taskPackage')
      : tr(transfer.type === 'file' ? 'transfers.type.file' : 'transfers.type.pointer');
    meta.textContent = `${compactDate(transfer.updatedAt)} · ${typeLabel}`;
    card.append(head, meta);

    if (transfer.direction === 'incoming' && Array.isArray(transfer.items)) {
      const itemList = document.createElement('div');
      itemList.className = 'transfer-item-list';
      transfer.items.forEach((item, index) => {
        const row = document.createElement('div');
        const coordinate = document.createElement('code');
        coordinate.textContent = `${index + 1}. ${item.path || '-'}\n${item.coordinate || '-'}`;
        row.append(coordinate);
        if (item.projectId && !item.mapping?.mapped) {
          const map = document.createElement('button');
          map.type = 'button';
          map.textContent = tr('transfers.mapProject');
          map.addEventListener('click', async () => {
            const result = await window.manager.chooseProjectBinding({
              projectId: item.projectId,
              sourceDeviceId: transfer.sourceDeviceId
            });
            if (result?.ok && !result.cancelled) {
              state.mesh.transfers = result.transfers || state.mesh.transfers;
              state.mesh.transferMessage = tr('transfers.projectMapped');
              setStatus(state.mesh.transferMessage);
              renderTransferList();
            }
          });
          row.append(map);
        } else if (item.mapping?.mapped) {
          const mapped = document.createElement('small');
          mapped.textContent = tr('transfers.mappedPath', { path: item.mapping.targetPath });
          row.append(mapped);
        }
        itemList.append(row);
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'primary';
      copy.textContent = tr('transfers.copyReceived');
      copy.addEventListener('click', async () => {
        const value = window.SessionLocation.formatLocations(transfer.items, {
          path: tr('session.location.path'),
          coordinate: tr('session.location.coordinate'),
          empty: tr('common.unrecorded')
        });
        await window.manager.writeClipboard(value);
        setStatus(tr('status.sessionInfosCopied', { n: transfer.items.length }));
      });
      card.append(itemList, copy);
    }

    if (transfer.type === 'file' && Array.isArray(transfer.files)) {
      const files = document.createElement('ul');
      files.className = 'transfer-file-list';
      for (const file of transfer.files) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = file.name;
        name.title = file.name;
        const size = document.createElement('span');
        size.textContent = formatBytes(file.size);
        item.append(name, size);
        files.append(item);
      }
      const progress = document.createElement('progress');
      progress.className = 'transfer-progress';
      progress.max = Math.max(1, transfer.bytesTotal || 0);
      progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
      progress.setAttribute('aria-label', tr('transfers.progress'));
      card.append(files, progress);
    }
    if (transfer.type === 'task-package') {
      const progress = document.createElement('progress');
      progress.className = 'transfer-progress';
      progress.max = Math.max(1, transfer.bytesTotal || 0);
      progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
      progress.setAttribute('aria-label', tr('transfers.progress'));
      card.append(progress);
    }

    const canRetry = transfer.state === 'failed'
      && (transfer.direction === 'outgoing' || transfer.type === 'file');
    const canCancel = ['file', 'task-package'].includes(transfer.type)
      ? !['completed', 'cancelled', 'expired'].includes(transfer.state)
      : transfer.direction === 'outgoing' && ['queued', 'failed', 'awaiting-ack'].includes(transfer.state);
    const canAccept = transfer.type === 'file' && transfer.direction === 'incoming' && transfer.acceptRequired;
    const canOpen = transfer.type === 'file' && transfer.direction === 'incoming' && transfer.canOpen;
    const taskActions = transfer.type === 'task-package'
      ? createTaskPackageTransferActions(transfer, { returnFocus: els.activityCenterDialog })
      : null;
    if (canRetry || canCancel || canAccept || canOpen || taskActions?.childElementCount) {
      const actions = document.createElement('div');
      actions.className = 'transfer-card-actions';
      if (taskActions?.childElementCount) actions.append(...taskActions.children);
      if (canAccept) {
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'primary';
        accept.textContent = tr('transfers.acceptFiles');
        accept.addEventListener('click', async () => {
          state.mesh.transferMessage = tr('transfers.choosingDestination');
          setStatus(state.mesh.transferMessage);
          const result = await window.manager.acceptFileTransfer(transfer.transferId);
          if (!result?.ok) state.mesh.transferMessage = meshErrorText(result?.reasonCode || 'file-transfer-accept-failed');
          else if (!result.cancelled) state.mesh.transfers = result.transfers || state.mesh.transfers;
          setStatus(state.mesh.transferMessage);
          renderTransferList();
        });
        actions.append(accept);
      }
      if (canOpen) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'primary';
        open.textContent = tr('transfers.openFiles');
        open.addEventListener('click', async () => {
          const result = await window.manager.openReceivedFile(transfer.transferId);
          if (!result?.ok) setStatus(meshErrorText(result?.reasonCode || 'file-received-location-failed'));
        });
        actions.append(open);
      }
      if (canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = tr('transfers.retry');
        retry.addEventListener('click', async () => {
          await window.manager.retryTransfer(transfer.transferId);
          await loadTransfers();
        });
        actions.append(retry);
      }
      if (canCancel && !(transfer.type === 'task-package' && transfer.direction === 'incoming' && transfer.acceptRequired)) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = tr('transfers.cancel');
        cancel.addEventListener('click', async () => {
          await window.manager.cancelTransfer(transfer.transferId);
          await loadTransfers();
        });
        actions.append(cancel);
      }
      card.append(actions);
    }
    els.transferList.append(card);
  }
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { openSessionSendDialog, openFileSendDialog, populateTransferTargets, openTransferCenter, chooseFilesForTransfer, sendSelectedSessionsToDevice, loadTransfers, renderSessionSendStatus, renderFileSendStatus, renderTransferList };
Object.assign(window, { openSessionSendDialog, openFileSendDialog, populateTransferTargets, openTransferCenter, chooseFilesForTransfer, sendSelectedSessionsToDevice, loadTransfers, renderSessionSendStatus, renderFileSendStatus, renderTransferList });
