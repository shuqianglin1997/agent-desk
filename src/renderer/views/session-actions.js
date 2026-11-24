// AgentDesk — the session action dock: which sessions an action covers (focus
// or explicit checks), their replica sources, the dock's buttons, and the
// local folder and export actions (docs/ARCHITECTURE_PLAN.md phase 6). Moved
// from src/renderer.js unchanged.

// 标签打给谁：这一行已勾选时打给所有勾选的，否则只打这一行（与“复制会话信息”的范围一致）。
function markTargets(session) {
  const key = sessionKey(session);
  if (key && state.ui.checkedConversationIds.has(key)) {
    return withHubRuns(state.sessions)
      .filter((item) => state.ui.checkedConversationIds.has(sessionKey(item)))
      .map((item) => window.SessionTable.markKeyOf(item))
      .filter(Boolean);
  }
  const markKey = window.SessionTable.markKeyOf(session);
  return markKey ? [markKey] : [];
}

function checkedMarkKeys() {
  return withHubRuns(state.sessions)
    .filter((item) => state.ui.checkedConversationIds.has(sessionKey(item)))
    .map((item) => window.SessionTable.markKeyOf(item))
    .filter(Boolean);
}

function actionSessions() {
  const ids = new Set(window.UiContext.actionConversationIds(state.ui));
  return state.sessions.filter((session) => ids.has(sessionKey(session)));
}

function replicaResolution(session) {
  return window.UiContext.resolveReplica(state.ui, session, sessionKey(session));
}

function resolvedSessionRow(session) {
  if (!session) return null;
  const resolution = replicaResolution(session);
  if (!resolution.resolved) return null;
  if (!resolution.replica) return session;
  return enrichMeshSession({
    ...sessionAtReplica(session, resolution.replica, state.mesh.overview),
    replicas: session.replicas
  }, state.mesh.overview);
}

function unresolvedActionSessions() {
  return actionSessions().filter((session) => !replicaResolution(session).resolved);
}

function resolvedActionSessions() {
  if (unresolvedActionSessions().length) return [];
  return actionSessions().map(resolvedSessionRow).filter(Boolean);
}

let sessionFileActionBusy = false;

function isLocalActionSession(session) {
  return Boolean(session?._profileId && !session._remote && !session._stale
    && state.profiles.some((profile) => String(profile.id) === String(session._profileId)));
}

function sessionFileActionRefs(sessions) {
  return sessions.map((session) => ({
    profileId: String(session._profileId),
    sessionId: String(session.id)
  }));
}

function renderSessionActionToolbar() {
  const selected = actionSessions();
  const count = selected.length;
  const resolved = selected.map(resolvedSessionRow);
  const unresolved = resolved.filter((session) => !session).length;
  const folders = resolved.filter((session) => isLocalActionSession(session) && session.filePath).length;
  const exportable = resolved.filter((session) => (
    isLocalActionSession(session) && state.appMeta[session.appId]?.canExportTranscript
  )).length;
  const visibility = window.UiContext.actionVisibility(
    state.ui,
    state.filteredSessions.map(sessionKey)
  );
  els.sessionSelectionBar.hidden = count === 0;
  els.sessionSelectionCount.textContent = tr('session.selection.count', { n: count });
  const issues = [];
  if (visibility.hidden) issues.push(tr('session.selection.hiddenCount', { n: visibility.hidden }));
  if (unresolved) issues.push(tr('session.replica.requiredCount', { n: unresolved }));
  else if (folders < count) issues.push(tr('session.actions.localOnly'));
  else if (exportable < count) issues.push(tr('session.actions.unsupportedExport'));
  const hasReplicaChoice = selected.some((session) => replicaResolution(session).candidates?.length > 1);
  els.chooseSessionReplicaBtn.hidden = !hasReplicaChoice;
  els.sessionSelectionNotice.hidden = issues.length === 0 && !hasReplicaChoice;
  els.sessionSelectionIssue.textContent = issues.join(' · ');
  els.copySessionInfoBtn.disabled = count === 0 || unresolved > 0;
  els.copySessionInfoBtn.textContent = count > 1
    ? tr('session.copyInfoCount', { n: count })
    : tr('session.copyInfo');
  els.copySessionInfoBtn.title = unresolved
    ? tr('session.replica.requiredAction')
    : tr('session.copyInfoHint');
  els.openSessionFileBtn.disabled = !count || count !== folders || sessionFileActionBusy;
  els.openSessionFileBtn.title = tr('session.actions.openHint');
  els.exportSessionBtn.disabled = !count || count !== exportable || sessionFileActionBusy;
  els.exportSessionBtn.title = tr('session.actions.exportHint');
  const handoff = count === 1 && isLocalActionSession(resolved[0])
    && ['native', 'transcript'].includes(state.appMeta[resolved[0].appId]?.taskPackageMode);
  els.taskPackageActionBtn.disabled = !handoff;
  els.taskPackageActionBtn.title = tr(handoff ? 'taskPackage.action.hint' : 'taskPackage.action.unsupported');
  // 说明纸条在按钮不可用时最后写一行真正的原因（按钮的 title 有时只是通用说明）
  setHubReason(els.copySessionInfoBtn, count === 0 ? 'hub.tip.reason.select' : (unresolved ? 'session.replica.requiredAction' : null));
  setHubReason(els.taskPackageActionBtn, handoff ? null : (count === 0 ? 'hub.tip.reason.select'
    : (count > 1 ? 'hub.tip.reason.single'
      : (!isLocalActionSession(resolved[0]) ? 'hub.tip.reason.localOnly' : 'taskPackage.action.unsupported'))));
  if (els.sendSessionInfoBtn) {
    const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
    const paused = crossDeviceActionsPaused();
    els.sendSessionInfoBtn.disabled = count === 0 || unresolved > 0 || remotes.length === 0 || paused;
    (els.sendSessionInfoLabel || els.sendSessionInfoBtn).textContent = count > 1
      ? tr('session.sendInfoCount', { n: count })
      : tr('session.sendInfo');
    els.sendSessionInfoBtn.title = paused
      ? tr('status.crossDevicePaused')
      : (unresolved
          ? tr('session.replica.requiredAction')
          : tr('session.sendInfoHint'));
    setHubReason(els.sendSessionInfoBtn, paused ? 'status.crossDevicePaused'
      : (count === 0 ? 'hub.tip.reason.select'
        : (unresolved ? 'session.replica.requiredAction'
          : (remotes.length === 0 ? 'hub.tip.reason.noDevice' : null))));
  }
}

function setHubReason(button, key) {
  if (!button) return;
  if (key) button.dataset.hubReason = tr(key);
  else delete button.dataset.hubReason;
}

async function openSessionDirectoryOption(option) {
  let result;
  try { result = await window.manager.openSessionDirectory(option.ref, option.path); } catch (_error) { /* Show a fixed error below. */ }
  const message = result?.ok ? tr('status.sessionLocOk') : (result?.reason || tr('status.sessionLocFail'));
  setStatus(message);
  if (!els.sessionDirectoryDialog.open) return;
  if (result?.ok) els.sessionDirectoryDialog.close();
  else {
    els.sessionDirectoryStatus.hidden = false;
    els.sessionDirectoryStatus.textContent = message;
  }
}

async function openSelectedSessionDirectories() {
  if (els.openSessionFileBtn.disabled) return;
  const refs = sessionFileActionRefs(resolvedActionSessions());
  sessionFileActionBusy = true;
  renderSessionActionToolbar();
  try {
    const result = await window.manager.listSessionDirectories(refs);
    if (!result?.ok || !result.directories.length) {
      setStatus(result?.reason || tr('status.sessionLocFail'));
      return;
    }
    if (result.directories.length === 1) {
      await openSessionDirectoryOption(result.directories[0]);
      return;
    }
    els.sessionDirectoryOptions.replaceChildren();
    els.sessionDirectoryStatus.hidden = true;
    for (const option of result.directories) {
      const button = document.createElement('button');
      button.type = 'button';
      const location = document.createElement('code');
      location.textContent = shortPath(option.path);
      location.title = option.path;
      const count = document.createElement('span');
      count.textContent = tr('session.actions.directorySessions', { n: option.count });
      button.append(location, count);
      button.addEventListener('click', async () => {
        if (sessionFileActionBusy) return;
        sessionFileActionBusy = true;
        const choices = els.sessionDirectoryOptions.querySelectorAll('button');
        for (const choice of choices) choice.disabled = true;
        try {
          await openSessionDirectoryOption(option);
        } finally {
          sessionFileActionBusy = false;
          for (const choice of choices) choice.disabled = false;
        }
      });
      els.sessionDirectoryOptions.append(button);
    }
    openChildDialog(els.sessionDirectoryDialog, els.openSessionFileBtn);
  } catch (_error) {
    setStatus(tr('status.sessionLocFail'));
  } finally {
    sessionFileActionBusy = false;
    renderSessionActionToolbar();
  }
}

async function exportSelectedSessions() {
  if (els.exportSessionBtn.disabled) return;
  const refs = sessionFileActionRefs(resolvedActionSessions());
  sessionFileActionBusy = true;
  renderSessionActionToolbar();
  setStatus(tr('session.actions.preparingExport'));
  try {
    const result = await window.manager.exportSessions(refs);
    setStatus(result?.message || result?.reason || tr(result?.ok ? 'status.exportOk' : 'status.exportFail'));
    if (result?.ok && !result.cancelled) window.PixelUi?.mascot?.('cheer');
    else if (result && !result.ok) window.PixelUi?.mascot?.('no');
  } catch (_error) {
    setStatus(tr('status.exportFail'));
    window.PixelUi?.mascot?.('no');
  } finally {
    sessionFileActionBusy = false;
    renderSessionActionToolbar();
  }
}

function crossDeviceActionsPaused() {
  return state.mesh.sessionSource === 'local-fallback'
    || state.mesh.sessionSource === 'remote-unavailable'
    || Boolean(state.mesh.sessionErrorCode);
}

function renderReplicaPicker(sessions) {
  els.sessionReplicaOptions.replaceChildren();
  const overview = state.mesh.overview;
  for (const session of sessions) {
    const resolution = replicaResolution(session);
    if (!(resolution.candidates?.length > 1)) continue;
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = session.title || session.id;
    group.append(legend);
    for (const replica of resolution.candidates) {
      const device = overview?.devices?.find((item) => item.deviceId === replica.deviceId);
      const slot = overview?.slots?.find((item) => (
        item.deviceId === replica.deviceId && String(item.profileId) === String(replica.profileId)
      ));
      const label = document.createElement('label');
      label.className = 'session-replica-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `session-replica-${sessionKey(session)}`;
      radio.value = replica.replicaId;
      radio.checked = resolution.replicaId === replica.replicaId;
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = device?.name || replica.deviceName || replica.deviceId;
      const meta = document.createElement('small');
      meta.textContent = [
        slot?.localLabel,
        appLabel(replica.appId || slot?.appId),
        replica.stale ? tr('session.offlineSnapshot') : tr(`devices.status.${device?.status || 'offline'}`)
      ].filter(Boolean).join(' · ');
      copy.append(name, meta);
      radio.addEventListener('change', () => {
        state.ui = window.UiContext.selectReplica(state.ui, sessionKey(session), replica.replicaId);
        renderSessions();
      });
      label.append(radio, copy);
      group.append(label);
    }
    els.sessionReplicaOptions.append(group);
  }
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { markTargets, checkedMarkKeys, actionSessions, replicaResolution, resolvedSessionRow, unresolvedActionSessions, resolvedActionSessions, isLocalActionSession, sessionFileActionRefs, renderSessionActionToolbar, setHubReason, openSessionDirectoryOption, openSelectedSessionDirectories, exportSelectedSessions, crossDeviceActionsPaused, renderReplicaPicker };
Object.assign(window, { markTargets, checkedMarkKeys, actionSessions, replicaResolution, resolvedSessionRow, unresolvedActionSessions, resolvedActionSessions, isLocalActionSession, sessionFileActionRefs, renderSessionActionToolbar, setHubReason, openSessionDirectoryOption, openSelectedSessionDirectories, exportSelectedSessions, crossDeviceActionsPaused, renderReplicaPicker });
