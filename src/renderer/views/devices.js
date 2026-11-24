// AgentDesk — the device center and the device lens: the overview, the
// device list and detail, connection and remote actions, network settings,
// diagnostics and permissions (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan
// 11.7). Moved from src/renderer.js unchanged.

// Remote inventory reads are deliberately on demand: selecting one remote
// device may open one authenticated peer, while startup and the "all devices"
// lens must not fan out into an N² connection mesh. Coalesce concurrent user
// intents for the same device so Lens navigation, device-center navigation and
// the explicit rescan action cannot launch duplicate full snapshots.
const remoteInventoryRefreshes = new Map();

let pendingDeviceOverviewReload = false;

let deviceOverviewReloadPromise = null;

function requestDeviceOverviewReload() {
  pendingDeviceOverviewReload = true;
  flushPendingDeviceOverviewReload();
}

function flushPendingDeviceOverviewReload() {
  if (
    !pendingDeviceOverviewReload
    || state.mesh.loading
    || deviceOverviewReloadPromise
    || !window.manager.listDevices
  ) return;
  pendingDeviceOverviewReload = false;
  const operation = loadDeviceOverview({ silent: true });
  deviceOverviewReloadPromise = operation;
  const finish = () => {
    if (deviceOverviewReloadPromise === operation) deviceOverviewReloadPromise = null;
    flushPendingDeviceOverviewReload();
  };
  operation.then(finish, finish);
}

async function loadDeviceOverview(options = {}) {
  if (!window.manager.listDevices || state.mesh.loading) return;
  const silent = options.silent === true;
  if (!silent) {
    state.mesh.loading = true;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.status.loading');
    renderDeviceCenter();
  }
  try {
    const result = await window.manager.listDevices({
      requestSecureAccess: options.requestSecureAccess === true
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'mesh-operation-failed');
    state.mesh.overview = result.overview;
    validateUiContext();
    state.mesh.errorCode = null;
    if (!silent) state.mesh.message = '';
  } catch (error) {
    state.mesh.errorCode = error?.message || 'mesh-operation-failed';
  } finally {
    if (!silent) state.mesh.loading = false;
    renderDeviceCenter();
    renderTopbarContext();
    if (state.mesh.overview?.initialized && options.skipWorkspaceRefresh !== true) {
      renderAccounts();
      renderAccountHeader();
      await loadSessions();
    }
  }
}

function renderDeviceCenter() {
  if (!els.deviceCenterBtn) return;
  // Mesh mutations render once after releasing state.mesh.loading. That common
  // point also drains an inventory-synced event that arrived while the mutation
  // was busy, instead of losing the reload until the next four-minute snapshot.
  flushPendingDeviceOverviewReload();
  const overview = state.mesh.overview;
  const initialized = overview?.initialized === true;
  const storageIncomplete = overview?.storageIncomplete === true;
  const keyError = initialized && overview?.keyState && overview.keyState !== 'available'
    ? overview.keyState
    : null;

  if (els.deviceCountBadge) {
    const onlineCount = (overview?.devices || []).filter((device) => device.status === 'online').length;
    els.deviceCountBadge.textContent = String(onlineCount);
    els.deviceCountBadge.hidden = !initialized || onlineCount === 0;
  }
  renderDeviceLens(overview);
  if (els.meshEmptyState) els.meshEmptyState.hidden = initialized;
  if (els.meshReadyState) els.meshReadyState.hidden = !initialized;
  if (els.initializeMeshBtn) {
    els.initializeMeshBtn.disabled = state.mesh.loading || storageIncomplete || overview?.keyState === 'os-key-protection-unavailable';
  }
  if (els.showJoinMeshBtn) els.showJoinMeshBtn.disabled = state.mesh.loading || storageIncomplete;
  if (els.confirmJoinMeshBtn) els.confirmJoinMeshBtn.disabled = state.mesh.loading;
  if (els.createDeviceInviteBtn) els.createDeviceInviteBtn.disabled = state.mesh.loading;
  if (els.networkSettingsBtn) els.networkSettingsBtn.disabled = state.mesh.loading || state.mesh.networkLoading;
  if (els.receiveConnectionsBtn) {
    const active = overview?.reachability?.userEnabled === true;
    els.receiveConnectionsBtn.disabled = state.mesh.loading;
    els.receiveConnectionsBtn.classList.toggle('primary', active);
    els.receiveConnectionsBtn.textContent = tr(active
      ? 'devices.reachability.disable'
      : 'devices.reachability.enable');
  }
  if (els.resetMeshBtn) {
    els.resetMeshBtn.hidden = !initialized && !storageIncomplete;
    els.resetMeshBtn.disabled = state.mesh.loading;
  }

  if (els.meshStateBadge) {
    els.meshStateBadge.dataset.state = state.mesh.errorCode || keyError || storageIncomplete
      ? 'error'
      : (initialized ? 'ready' : 'local');
    els.meshStateBadge.textContent = tr(
      state.mesh.errorCode || keyError || storageIncomplete
        ? 'devices.state.attention'
        : (initialized ? 'devices.state.ready' : 'devices.state.local')
    );
  }

  if (els.deviceCenterStatus) {
    let message = state.mesh.message;
    let tone = state.mesh.loading ? 'busy' : 'idle';
    if (state.mesh.errorCode || keyError || storageIncomplete) {
      tone = 'error';
      message = meshErrorText(state.mesh.errorCode || keyError || 'mesh-storage-incomplete');
    } else if (!message) {
      message = tr(initialized ? 'devices.status.readyMesh' : 'devices.status.ready');
    }
    els.deviceCenterStatus.dataset.state = tone;
    els.deviceCenterStatus.textContent = message;
  }

  renderMeshPreview(overview?.localPreview);
  if (!initialized) return;
  if (els.meshJoinPanel) els.meshJoinPanel.hidden = true;
  if (els.meshInvitePanel) els.meshInvitePanel.hidden = !state.mesh.invitation;
  if (els.meshInviteShortCode) els.meshInviteShortCode.textContent = state.mesh.invitation?.shortCode || '';
  if (els.meshInviteCode) els.meshInviteCode.value = state.mesh.invitation?.code || '';
  renderMeshSummary(overview);
  renderDeviceList(overview);
  renderSelectedDeviceDetail(overview);
  renderMeshAgentList(overview);
}

function renderMeshPreview(preview) {
  if (!els.meshPreviewStats) return;
  const value = preview || {
    name: tr('devices.preview.thisDevice'),
    agentCount: identityGroups().length,
    slotCount: state.profiles.length,
    sessionCount: state.sessions.length
  };
  fillMeshStats(els.meshPreviewStats, [
    [tr('devices.stat.device'), value.name || tr('devices.preview.thisDevice')],
    [tr('devices.stat.agents'), value.agentCount || 0],
    [tr('devices.stat.slots'), value.slotCount || 0]
  ]);
}

function renderDeviceLensMenu(overview) {
  if (!window.PixelUi) return;
  const initialized = overview?.initialized === true;
  const devices = initialized ? (overview.devices || []) : [];
  const online = devices.filter((device) => device.isLocal || device.status === 'online').length;
  const onlineLabel = initialized ? tr('devices.lens.online', { online, total: devices.length }) : '';
  window.PixelUi.renderLens({
    initialized,
    current: currentDeviceLensId(),
    allLabel: tr('devices.lens.all'),
    localLabel: tr('devices.device.local'),
    onlineLabel,
    devices: devices.map((device) => ({
      id: device.deviceId,
      name: device.isLocal ? tr('devices.lens.localNamed', { name: device.name }) : device.name,
      online: device.isLocal || device.status === 'online',
      meta: tr(`devices.status.${device.isLocal ? 'online' : (device.status || 'offline')}`)
    }))
  });
  window.PixelUi.setGlobal(initialized ? tr('footer.devices', { online, total: devices.length }) : tr('footer.localOnly'));
}

function renderDeviceLens(overview) {
  if (!els.deviceLensSelect) return;
  const initialized = overview?.initialized === true;
  els.deviceLensSelect.hidden = !initialized;
  renderDeviceLensMenu(overview);
  if (!initialized) return;
  const current = currentDeviceLensId();
  els.deviceLensSelect.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = tr('devices.lens.all');
  els.deviceLensSelect.append(all);
  for (const device of overview.devices || []) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.isLocal
      ? tr('devices.lens.localNamed', { name: device.name })
      : device.name;
    els.deviceLensSelect.append(option);
  }
  const valid = [...els.deviceLensSelect.options].some((option) => option.value === current);
  els.deviceLensSelect.value = valid ? current : 'all';
}

function renderMeshSummary(overview) {
  if (!els.meshSummary) return;
  const online = (overview.devices || []).filter((device) => device.status === 'online').length;
  fillMeshStats(els.meshSummary, [
    [tr('devices.stat.mesh'), overview.mesh?.displayName || 'Personal Agent Mesh'],
    [tr('devices.stat.online'), tr('devices.value.online', { online, total: overview.devices.length })],
    [tr('devices.stat.catalogRevision'), `r${overview.mesh?.catalogRevision || 0}`]
  ]);
  if (els.deviceShelfMeta) {
    const signaling = overview.reachability?.signaling;
    els.deviceShelfMeta.textContent = `${tr('devices.meta.deviceCount', { n: overview.devices.length })} · ${tr('devices.meta.signaling', {
      state: diagnosticCode(signaling?.state || 'disabled')
    })}`;
  }
}

function fillMeshStats(container, rows) {
  container.replaceChildren();
  for (const [label, value] of rows) {
    const item = document.createElement('div');
    item.className = 'mesh-stat';
    const small = document.createElement('small');
    small.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    strong.title = String(value);
    item.append(small, strong);
    container.append(item);
  }
}

function renderDeviceList(overview) {
  if (!els.deviceList) return;
  els.deviceList.replaceChildren();
  const selected = selectedDeviceDetail(overview);
  for (const device of overview.devices || []) {
    const connection = (overview.connections || []).find((item) => item.deviceId === device.deviceId);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'device-list-item';
    card.setAttribute('aria-current', String(selected?.deviceId === device.deviceId));
    const dot = document.createElement('i');
    dot.className = 'device-online-dot';
    if (device.status !== 'online') dot.style.background = 'var(--ink-tertiary)';
    const copy = document.createElement('span');
    copy.className = 'device-list-copy';
    const name = document.createElement('strong');
    name.textContent = device.name;
    const meta = document.createElement('small');
    meta.textContent = [
      tr(`devices.status.${device.status || 'offline'}`),
      platformLabel(device.platform),
      connection?.authenticated ? connectionPathText(connection) : null
    ].filter(Boolean).join(' · ');
    copy.append(name, meta);
    const count = document.createElement('span');
    count.className = 'device-list-count';
    count.textContent = tr('devices.list.agentCount', { n: device.agentCount || 0 });
    card.append(dot, copy, count);
    card.addEventListener('click', () => {
      state.ui = window.UiContext.selectDeviceDetail(state.ui, device.deviceId);
      renderDeviceCenter();
    });
    els.deviceList.append(card);
  }
}

function selectedDeviceDetail(overview) {
  return (overview?.devices || []).find((device) => device.deviceId === state.ui.selectedDeviceDetailId) || null;
}

function ensureDeviceDetailForEntry() {
  const overview = state.mesh.overview;
  if (!overview?.initialized || selectedDeviceDetail(overview)) return;
  const lensDevice = currentDeviceLensId() !== 'all'
    ? overview.devices.find((device) => device.deviceId === currentDeviceLensId())
    : null;
  const target = lensDevice || overview.devices.find((device) => device.isLocal) || overview.devices[0];
  if (target) state.ui = window.UiContext.selectDeviceDetail(state.ui, target.deviceId);
}

function renderSelectedDeviceDetail(overview) {
  const device = selectedDeviceDetail(overview);
  if (!els.deviceDetail) return;
  if (!device) {
    if (els.deviceDetailKind) els.deviceDetailKind.textContent = '';
    if (els.deviceDetailName) els.deviceDetailName.textContent = tr('devices.detail.unselected');
    if (els.deviceDetailMeta) els.deviceDetailMeta.textContent = tr('devices.detail.unselectedHint');
    if (els.deviceDetailStatus) {
      els.deviceDetailStatus.textContent = '';
      els.deviceDetailStatus.removeAttribute('data-state');
    }
    if (els.deviceDetailStats) els.deviceDetailStats.replaceChildren();
    if (els.deviceDetailActions) els.deviceDetailActions.replaceChildren();
    return;
  }
  const connection = (overview.connections || []).find((item) => item.deviceId === device.deviceId);
  if (els.deviceDetailKind) {
    els.deviceDetailKind.textContent = device.isLocal
      ? tr('devices.device.local')
      : tr('devices.device.remote');
  }
  if (els.deviceDetailName) els.deviceDetailName.textContent = device.name;
  if (els.deviceDetailMeta) {
    els.deviceDetailMeta.textContent = [
      platformLabel(device.platform),
      device.arch,
      `AgentDesk ${device.appVersion}`,
      connection?.authenticated ? connectionPathText(connection) : null,
      tr('devices.device.fingerprint', { value: device.fingerprint || '-' })
    ].filter(Boolean).join(' · ');
  }
  if (els.deviceDetailStatus) {
    els.deviceDetailStatus.dataset.state = device.status === 'online' ? 'ready' : 'local';
    els.deviceDetailStatus.textContent = [
      tr(`devices.status.${device.status || 'offline'}`),
      !device.isLocal && device.inventoryGeneratedAt
        ? tr('devices.device.lastSync', { time: compactDate(device.inventoryGeneratedAt) })
        : null
    ].filter(Boolean).join(' · ');
  }
  if (els.deviceDetailStats) {
    els.deviceDetailStats.replaceChildren();
    for (const [value, label] of [
      [device.agentCount, tr('devices.stat.agents')],
      [device.slotCount, tr('devices.stat.slots')],
      [device.sessionCount, tr('devices.stat.sessions')]
    ]) {
      const item = document.createElement('div');
      item.className = 'device-detail-stat';
      const count = document.createElement('b');
      count.textContent = String(value || 0);
      const caption = document.createElement('small');
      caption.textContent = label;
      item.append(count, caption);
      els.deviceDetailStats.append(item);
    }
  }
  renderSelectedDeviceActions(device, connection, overview);
}

function deviceActionButton(label, listener, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = options.disabled === true;
  if (options.className) button.className = options.className;
  if (options.title) button.title = options.title;
  button.addEventListener('click', listener);
  return button;
}

function deviceMoreMenu(buttons) {
  const menu = document.createElement('details');
  menu.className = 'device-action-more context-menu';
  const summary = document.createElement('summary');
  summary.textContent = tr('common.more');
  const panel = document.createElement('div');
  panel.className = 'context-menu-panel';
  for (const button of buttons) panel.append(button);
  menu.append(summary, panel);
  return menu;
}

function refreshRemoteInventoryForDevice(deviceOrId) {
  const deviceId = typeof deviceOrId === 'string' ? deviceOrId : deviceOrId?.deviceId;
  const device = state.mesh.overview?.devices?.find((item) => item.deviceId === deviceId)
    || (deviceOrId && typeof deviceOrId === 'object' ? deviceOrId : null);
  if (!device || device.isLocal || !window.manager.refreshMeshInventory) return Promise.resolve(null);

  const existing = remoteInventoryRefreshes.get(deviceId);
  if (existing) return existing;

  const deviceName = device.name || deviceId || '-';
  const operation = (async () => {
    setStatus(tr('status.refreshRemoteWorking', { name: deviceName }));
    let result = null;
    try {
      result = await window.manager.refreshMeshInventory(deviceId);
    } catch (_error) {
      result = null;
    }
    if (!result?.ok) {
      // Cached sessions were rendered before this request and remain intact.
      // A failed on-demand connection must never turn an offline snapshot into
      // an empty table or pretend that the cached data is current.
      setStatus(remoteInventoryRefreshFailureText(result?.reasonCode, deviceName));
      return null;
    }

    if (result.overview) {
      state.mesh.overview = result.overview;
      validateUiContext();
    }
    state.mesh.errorCode = null;
    renderDeviceLens(state.mesh.overview);
    renderAccounts();
    renderAccountHeader();
    renderDeviceCenter();
    renderTopbarContext();
    if (Array.isArray(result.sessions)) await loadMeshSessions(result.sessions);
    else await loadSessions();
    setStatus(tr('status.refreshRemoteDone', { name: deviceName }));
    return result;
  })();

  remoteInventoryRefreshes.set(deviceId, operation);
  const clear = () => {
    if (remoteInventoryRefreshes.get(deviceId) === operation) {
      remoteInventoryRefreshes.delete(deviceId);
    }
  };
  operation.then(clear, clear);
  return operation;
}

async function viewDeviceSessions(device, overview) {
  closeUtilityDialog(els.deviceCenterDialog);
  updateUi(window.UiContext.viewDeviceSessions(state.ui, device.deviceId));
  persistUiSelectionMemory({ sessionScope: 'all' });
  setWorkspaceMode('sessions');
  renderDeviceLens(overview);
  if (els.searchInput) els.searchInput.value = state.query;
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(device);
}

async function viewDeviceAgentSessions(device, agent, overview) {
  const groups = identityGroupsForLens(device.deviceId);
  const group = groups.find((item) => item.key === agent.agentId);
  const slot = preferredSlot(group?.members || []);
  updateUi(window.UiContext.viewDeviceAgentSessions(state.ui, {
    deviceId: device.deviceId,
    agentId: agent.agentId,
    slotKey: slot?._meshSlotKey || slot?.id
  }));
  persistUiSelectionMemory({ sessionScope: 'current' });
  closeUtilityDialog(els.deviceCenterDialog);
  setWorkspaceMode('sessions');
  renderDeviceLens(overview);
  if (els.searchInput) els.searchInput.value = state.query;
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(device);
}

function renderSelectedDeviceActions(device, connection, overview) {
  if (!els.deviceDetailActions) return;
  els.deviceDetailActions.replaceChildren();
  const viewSessions = deviceActionButton(
    tr('devices.viewAllSessions'),
    () => void viewDeviceSessions(device, overview),
    { disabled: state.mesh.loading }
  );

  if (device.isLocal) {
    const rename = deviceActionButton(tr('devices.rename'), () => renameLocalDevice(device), {
      disabled: state.mesh.loading
    });
    const probe = deviceActionButton(
      state.mesh.loading ? tr('devices.probe.running') : tr('devices.probe.action'),
      () => runMeshTransportProbe(),
      { disabled: state.mesh.loading }
    );
    const diagnostics = deviceDiagnosticsButton(device);
    const history = deviceActionButton(tr('transfers.center.action'), () => openTransferCenter(history));
    els.deviceDetailActions.append(viewSessions, rename, deviceMoreMenu([probe, diagnostics, history]));
    return;
  }

  const remoteSession = state.mesh.remoteSessions.find((item) => (
    item.deviceId === device.deviceId
    && !['error', 'rejected', 'disconnected'].includes(item.state)
  ));
  const canView = (device.permissions || []).includes('screen.view');
  const canReachRemote = Boolean(remoteSession)
    || connection?.authenticated === true
    || device.status === 'online';
  const remote = deviceActionButton(
    tr(remoteSession ? 'remote.action.focus' : 'remote.action.view'),
    () => openRemoteDevice(device),
    {
      disabled: state.mesh.loading || !canView || !canReachRemote,
      title: !canView
        ? tr('remote.action.permissionRequired')
        : (canReachRemote ? tr('remote.action.hint') : remoteErrorText('offline', device.name))
    }
  );
  remote.className = 'remote-control-action';
  const connect = deviceActionButton(
    tr(connection?.authenticated
      ? 'devices.connection.disconnect'
      : (device.status === 'connecting' ? 'devices.connection.connecting' : 'devices.connection.connect')),
    () => connection?.authenticated ? disconnectMeshDevice(device) : connectMeshDevice(device),
    { disabled: state.mesh.loading || device.status === 'connecting' }
  );
  const transfer = deviceActionButton(
    tr('devices.transfer.files'),
    () => void openFileSendDialog(device.deviceId, transfer),
    {
      disabled: state.mesh.loading || crossDeviceActionsPaused(),
      title: crossDeviceActionsPaused() ? tr('status.crossDevicePaused') : ''
    }
  );
  const permissions = deviceActionButton(
    tr('devices.permissions.action'),
    () => openDevicePermissions(device, permissions),
    { disabled: state.mesh.loading }
  );
  const diagnostics = deviceDiagnosticsButton(device);
  const revoke = deviceActionButton(
    tr('devices.revoke.short'),
    () => openDevicePermissions(device, revoke),
    { className: 'danger-text', disabled: state.mesh.loading }
  );
  const connectionState = document.createElement('span');
  connectionState.className = 'device-connection-state';
  connectionState.textContent = connection?.authenticated
    ? tr('devices.connection.ready')
    : tr('devices.connection.onDemand');
  const history = deviceActionButton(tr('transfers.center.action'), () => openTransferCenter(history));
  els.deviceDetailActions.append(remote, viewSessions, transfer, connectionState, deviceMoreMenu([
    connect,
    diagnostics,
    permissions,
    history,
    revoke
  ]));
}

function renderMeshAgentList(overview) {
  if (!els.meshAgentList) return;
  els.meshAgentList.replaceChildren();
  if (els.agentCatalogMeta) els.agentCatalogMeta.textContent = '';
  const selectedDevice = selectedDeviceDetail(overview);
  if (!selectedDevice) return;
  const deviceAgents = overview.agents.filter((agent) => overview.slots.some((slot) => (
    slot.agentId === agent.agentId
    && slot.accountBindingId
    && slot.assignmentState === 'linked'
    && slot.deviceId === selectedDevice.deviceId
  )));
  const unassignedSlots = overview.slots.filter((slot) => (
    slot.deviceId === selectedDevice.deviceId
    && (slot.assignmentState !== 'linked' || !slot.agentId || !slot.accountBindingId)
  ));
  if (els.agentCatalogMeta) {
    const slotCount = overview.slots.filter((slot) => slot.deviceId === selectedDevice?.deviceId).length;
    els.agentCatalogMeta.textContent = tr('devices.meta.deviceAgentSlotCount', {
      agents: deviceAgents.length,
      slots: slotCount
    });
  }
  if (!deviceAgents.length && !unassignedSlots.length) {
    const empty = document.createElement('p');
    empty.className = 'mesh-catalog-empty';
    empty.textContent = overview.agents.length
      ? tr('devices.agents.emptyOnDevice')
      : tr('devices.agents.empty');
    els.meshAgentList.append(empty);
    return;
  }
  for (const agent of deviceAgents) {
    const slots = overview.slots.filter((slot) => (
      slot.agentId === agent.agentId
      && slot.accountBindingId
      && slot.assignmentState === 'linked'
    ));
    const deviceSlots = slots.filter((slot) => slot.deviceId === selectedDevice.deviceId);
    const deviceBindingIds = new Set(deviceSlots.map((slot) => slot.accountBindingId));
    const bindings = overview.accountBindings.filter((binding) => (
      binding.agentId === agent.agentId && deviceBindingIds.has(binding.accountBindingId)
    ));
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mesh-agent-card';
    const name = document.createElement('strong');
    name.textContent = agent.displayName;
    const count = document.createElement('span');
    count.textContent = tr('devices.agents.devicePositions', { slots: deviceSlots.length });
    const providers = document.createElement('small');
    providers.textContent = bindings.length
      ? bindings.map((binding) => binding.providerNamespace).join(' · ')
      : tr('devices.agents.noBinding');
    card.append(name, count, providers);
    card.addEventListener('click', () => void viewDeviceAgentSessions(selectedDevice, agent, overview));
    els.meshAgentList.append(card);
  }
  if (unassignedSlots.length) {
    const heading = document.createElement('div');
    heading.className = 'mesh-unassigned-heading';
    const title = document.createElement('span');
    title.textContent = tr('catalog.unassigned.title');
    const count = document.createElement('span');
    count.textContent = tr('catalog.unassigned.count', { n: unassignedSlots.length });
    heading.append(title, count);
    els.meshAgentList.append(heading);
    for (const slot of unassignedSlots) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mesh-agent-card is-unassigned';
      const name = document.createElement('strong');
      name.textContent = slot.localLabel || slot.profileId;
      const action = document.createElement('span');
      action.textContent = tr('catalog.unassigned.action');
      const meta = document.createElement('small');
      meta.textContent = `${appLabel(slot.appId)} · ${slot.assignmentState || 'pending'}`;
      card.append(name, action, meta);
      card.addEventListener('click', () => openSlotAssignmentDialog(slot));
      els.meshAgentList.append(card);
    }
  }
}

async function toggleMeshReachability() {
  if (state.mesh.loading || !window.manager.setDeviceReachable) return;
  const enabled = state.mesh.overview?.reachability?.userEnabled !== true;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr(enabled ? 'devices.reachability.enabling' : 'devices.reachability.disabling');
  renderDeviceCenter();
  const result = await window.manager.setDeviceReachable(enabled);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'mesh-reachability-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr(enabled ? 'devices.reachability.enabled' : 'devices.reachability.disabled');
  }
  renderDeviceCenter();
}

async function connectMeshDevice(device) {
  if (state.mesh.loading || !window.manager.connectDevice) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.connection.connectingNamed', { name: device.name });
  renderDeviceCenter();
  const result = await window.manager.connectDevice(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'peer-connect-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr('devices.connection.connected', { name: device.name });
  }
  renderDeviceCenter();
  if (result?.ok) await loadSessions();
}

async function openRemoteDevice(device) {
  if (state.mesh.loading || !window.manager.openRemoteControl) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('remote.action.opening', { name: device.name });
  renderDeviceCenter();
  const result = await window.manager.openRemoteControl(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'remote-open-failed';
    state.mesh.message = '';
    setStatus(remoteErrorText(state.mesh.errorCode, device.name));
  } else {
    state.mesh.remoteSessions = Array.isArray(result.sessions) ? result.sessions : state.mesh.remoteSessions;
    state.mesh.message = tr('remote.action.waitingConsent', { name: device.name });
    state.ui = window.UiContext.openRemote(state.ui, result.session?.sessionId);
    closeUtilityDialog(els.deviceCenterDialog);
    setWorkspaceMode('remote');
  }
  renderDeviceCenter();
}

async function disconnectMeshDevice(device) {
  if (state.mesh.loading || !window.manager.disconnectDevice) return;
  state.mesh.loading = true;
  const result = await window.manager.disconnectDevice(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'peer-disconnect-failed';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.connection.disconnected', { name: device.name });
  }
  renderDeviceCenter();
}

function deviceDiagnosticsButton(device) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = tr('devices.diagnostics.action');
  button.disabled = state.mesh.loading;
  button.addEventListener('click', () => openDeviceDiagnostics(device, button));
  return button;
}

async function openMeshNetworkSettings(returnFocus = document.activeElement) {
  if (!els.meshNetworkDialog || state.mesh.networkLoading || !window.manager.getDeviceNetworkConfig) return;
  const focusContext = captureChildDialogReturnFocus(returnFocus);
  state.mesh.networkLoading = true;
  els.networkSettingsBtn.disabled = true;
  const result = await window.manager.getDeviceNetworkConfig();
  state.mesh.networkLoading = false;
  els.networkSettingsBtn.disabled = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'network-config-read-failed';
    renderDeviceCenter();
    return;
  }
  els.meshSignalingUrls.value = (result.config?.signalingUrls || []).join('\n');
  els.meshStunUrls.value = (result.config?.stunUrls || []).join('\n');
  els.meshNetworkStatus.dataset.state = 'idle';
  els.meshNetworkStatus.textContent = tr('devices.network.ready');
  openChildDialog(els.meshNetworkDialog, focusContext);
}

async function saveMeshNetworkSettings() {
  if (state.mesh.networkLoading || !window.manager.updateDeviceNetworkConfig) return;
  state.mesh.networkLoading = true;
  els.saveMeshNetworkBtn.disabled = true;
  els.meshNetworkStatus.dataset.state = 'busy';
  els.meshNetworkStatus.textContent = tr('devices.network.saving');
  const result = await window.manager.updateDeviceNetworkConfig({
    signalingUrls: splitNetworkLines(els.meshSignalingUrls.value),
    stunUrls: splitNetworkLines(els.meshStunUrls.value)
  });
  state.mesh.networkLoading = false;
  els.saveMeshNetworkBtn.disabled = false;
  if (!result?.ok) {
    els.meshNetworkStatus.dataset.state = 'error';
    els.meshNetworkStatus.textContent = tr('devices.network.failed', { code: result?.reasonCode || 'network-config-invalid' });
    return;
  }
  els.meshSignalingUrls.value = (result.config?.signalingUrls || []).join('\n');
  els.meshStunUrls.value = (result.config?.stunUrls || []).join('\n');
  if (state.mesh.overview?.reachability && result.network) {
    state.mesh.overview.reachability = {
      ...state.mesh.overview.reachability,
      signaling: result.network.signaling,
      ice: result.network.ice
    };
  }
  state.mesh.message = tr('devices.network.saved');
  els.meshNetworkDialog.close();
  renderDeviceCenter();
  await loadDeviceOverview({ silent: true });
}

function splitNetworkLines(value) {
  return [...new Set(String(value || '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 8);
}

function connectionPathText(connection) {
  const path = ['lan', 'direct', 'relay'].includes(connection?.networkPath)
    ? connection.networkPath
    : 'unknown';
  return tr(`devices.path.${path}`);
}

async function openDeviceDiagnostics(device, returnFocus = document.activeElement) {
  if (!els.meshDiagnosticsDialog || !device?.deviceId) return;
  state.mesh.diagnosticDeviceId = device.deviceId;
  state.mesh.diagnostics = null;
  state.mesh.diagnosticsError = null;
  if (els.meshDiagnosticsTitle) {
    els.meshDiagnosticsTitle.textContent = tr('devices.diagnostics.named', { name: device.name });
  }
  openChildDialog(els.meshDiagnosticsDialog, returnFocus);
  renderDeviceDiagnostics();
  await refreshDeviceDiagnostics();
}

async function refreshDeviceDiagnostics(options = {}) {
  const deviceId = state.mesh.diagnosticDeviceId;
  if (!deviceId || state.mesh.diagnosticsLoading || !window.manager.getDeviceDiagnostics) return;
  state.mesh.diagnosticsLoading = true;
  state.mesh.diagnosticsError = null;
  if (!options.quiet) renderDeviceDiagnostics();
  const result = await window.manager.getDeviceDiagnostics(deviceId);
  state.mesh.diagnosticsLoading = false;
  if (!result?.ok) {
    state.mesh.diagnosticsError = result?.reasonCode || 'device-diagnostics-failed';
  } else {
    state.mesh.diagnostics = result.diagnostics;
  }
  renderDeviceDiagnostics();
}

function renderDeviceDiagnostics() {
  if (!els.meshDiagnosticsBody || !els.meshDiagnosticsStatus) return;
  els.refreshMeshDiagnosticsBtn.disabled = state.mesh.diagnosticsLoading;
  if (state.mesh.diagnosticsLoading) {
    els.meshDiagnosticsStatus.dataset.state = 'busy';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.checking');
  } else if (state.mesh.diagnosticsError) {
    els.meshDiagnosticsStatus.dataset.state = 'error';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.failed', { code: state.mesh.diagnosticsError });
  } else if (state.mesh.diagnostics) {
    els.meshDiagnosticsStatus.dataset.state = 'ready';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.checked', {
      time: diagnosticTime(state.mesh.diagnostics.checkedAt)
    });
  } else {
    els.meshDiagnosticsStatus.dataset.state = 'idle';
    els.meshDiagnosticsStatus.textContent = '';
  }

  els.meshDiagnosticsBody.replaceChildren();
  const value = state.mesh.diagnostics;
  if (!value) return;
  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.identity'), [
    [tr('devices.diagnostics.deviceStatus'), diagnosticCode(value.device.status)],
    [tr('devices.diagnostics.appProtocol'), `${value.device.platform} ${value.device.arch} · AgentDesk ${value.device.appVersion} · ${value.device.protocolVersion}`],
    [tr('devices.diagnostics.fingerprint'), value.device.fingerprint || '-'],
    [tr('devices.diagnostics.inventory'), `r${value.device.inventoryRevision || 0}`]
  ]);

  const signaling = value.signaling || {};
  const services = (signaling.services || []).map((item) => (
    `${item.service} · ${diagnosticCode(item.state)}`
  )).join('\n') || tr('devices.value.none');
  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.reachability'), [
    [tr('devices.diagnostics.signaling'), diagnosticCode(signaling.state)],
    [tr('devices.diagnostics.signalingServices'), services],
    [tr('devices.diagnostics.stun'), configuredText(value.ice?.stunConfigured, value.ice?.stunUrlCount)],
    [tr('devices.diagnostics.turn'), configuredText(value.ice?.turnConfigured, value.ice?.turnUrlCount)],
    [tr('devices.diagnostics.turnExpiry'), value.ice?.turnCredentialExpiresAt ? diagnosticTime(value.ice.turnCredentialExpiresAt) : tr('devices.value.none')],
    [tr('devices.diagnostics.lanEndpoint'), value.localEndpoint?.active
      ? tr('devices.value.activeCount', { n: value.localEndpoint.endpointCount || 0 })
      : tr('devices.value.inactive')]
  ]);

  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.connection'), [
    [tr('devices.diagnostics.authenticated'), diagnosticCode(value.connection?.authenticated ? 'authenticated' : 'not-authenticated')],
    [tr('devices.diagnostics.signalPath'), diagnosticCode(value.connection?.signalingPath)],
    [tr('devices.diagnostics.mediaPath'), diagnosticCode(value.connection?.networkPath)],
    [tr('devices.diagnostics.candidates'), (value.connection?.candidateTypes || []).join(' + ') || tr('devices.value.none')],
    [tr('devices.diagnostics.transport'), (value.connection?.protocols || []).join(' + ') || tr('devices.value.none')],
    [tr('devices.diagnostics.pairState'), diagnosticCode(value.connection?.selectedPairState)]
  ]);

  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.permissions'), [
    [tr('devices.diagnostics.screen'), diagnosticCode(value.permissions?.screen)],
    [tr('devices.diagnostics.input'), diagnosticCode(value.permissions?.input)],
    [tr('devices.diagnostics.file'), diagnosticCode(value.permissions?.file)],
    [tr('devices.diagnostics.pointer'), diagnosticCode(value.permissions?.sessionPointer)]
  ]);
}

function appendDiagnosticSection(container, title, rows) {
  const section = document.createElement('section');
  section.className = 'device-diagnostics-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = String(value ?? '-');
    list.append(term, detail);
  }
  section.append(heading, list);
  container.append(section);
}

function configuredText(configured, count) {
  return configured
    ? tr('devices.value.configuredCount', { n: Number(count) || 0 })
    : tr('devices.value.notConfigured');
}

function diagnosticCode(code) {
  const key = String(code || 'none').toLowerCase();
  if (['online', 'offline', 'connecting', 'sleeping', 'revoked'].includes(key)) {
    return tr(`devices.status.${key}`);
  }
  const known = new Set([
    'degraded', 'disabled', 'stopped',
    'lan', 'signaling', 'direct', 'relay', 'unknown', 'none',
    'authenticated', 'not-authenticated', 'succeeded',
    'allowed', 'not-allowed', 'available', 'unavailable', 'unsupported',
    'granted', 'denied', 'restricted', 'not-determined'
  ]);
  return known.has(key) ? tr(`devices.value.${key}`) : key;
}

function diagnosticTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '-';
}

function openDevicePermissions(device, returnFocus = document.activeElement) {
  if (!els.devicePermissionsDialog || device.isLocal) return;
  state.mesh.permissionDeviceId = device.deviceId;
  if (els.devicePermissionsTitle) {
    els.devicePermissionsTitle.textContent = tr('devices.permissions.named', { name: device.name });
  }
  const supported = new Set(device.capabilities || []);
  const enabled = new Set(device.permissions || []);
  for (const checkbox of els.devicePermissionList?.querySelectorAll('input[data-capability]') || []) {
    const capability = checkbox.dataset.capability;
    checkbox.checked = enabled.has(capability);
    checkbox.disabled = !supported.has(capability);
  }
  openChildDialog(els.devicePermissionsDialog, returnFocus);
}

async function saveRemoteDevicePermissions() {
  const deviceId = state.mesh.permissionDeviceId;
  if (!deviceId || state.mesh.loading || !window.manager.updateDevicePermissions) return;
  const permissions = {};
  for (const checkbox of els.devicePermissionList?.querySelectorAll('input[data-capability]') || []) {
    if (!checkbox.disabled) permissions[checkbox.dataset.capability] = checkbox.checked;
  }
  state.mesh.loading = true;
  const result = await window.manager.updateDevicePermissions({ deviceId, permissions });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'device-permissions-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.permissions.saved');
    els.devicePermissionsDialog.close();
  }
  renderDeviceCenter();
}

async function revokeRemoteDevice() {
  const deviceId = state.mesh.permissionDeviceId;
  const device = state.mesh.overview?.devices?.find((item) => item.deviceId === deviceId);
  if (!device || device.isLocal || state.mesh.loading || !window.manager.revokeDevice) return;
  if (!window.confirm(tr('devices.revoke.confirm', { name: device.name }))) return;
  state.mesh.loading = true;
  const result = await window.manager.revokeDevice({ deviceId, remove: true });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'device-revoke-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.revoke.done', { name: device.name });
    state.mesh.permissionDeviceId = null;
    els.devicePermissionsDialog.close();
  }
  renderDeviceCenter();
  renderTopbarContext();
}

async function renameLocalDevice(device) {
  const name = window.prompt(tr('devices.rename.prompt'), device.name);
  if (name === null || !name.trim() || name.trim() === device.name) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.status.renaming');
  renderDeviceCenter();
  const result = await window.manager.renameDevice({ deviceId: device.deviceId, name: name.trim() });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'mesh-operation-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr('devices.status.renamed');
  }
  renderDeviceCenter();
}

async function runMeshTransportProbe() {
  if (state.mesh.loading || !window.manager.probeMeshTransport) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.probe.starting');
  renderDeviceCenter();
  const result = await window.manager.probeMeshTransport();
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'webrtc-probe-failed';
    state.mesh.message = '';
  } else {
    const probe = result.result;
    const path = [
      ...(probe.candidateTypes || []),
      ...(probe.protocols || [])
    ].join(' / ') || tr('devices.probe.localPath');
    state.mesh.message = tr('devices.probe.success', {
      ms: probe.elapsedMs,
      path
    });
  }
  renderDeviceCenter();
}

function meshErrorText(code) {
  const known = {
    'os-key-protection-unavailable': 'devices.error.keyProtection',
    'mesh-storage-incomplete': 'devices.error.storageIncomplete',
    'mesh-key-store-without-database': 'devices.error.keyWithoutStore',
    'mesh-key-store-unreadable': 'devices.error.keyUnreadable',
    'mesh-database-newer-than-app': 'devices.error.databaseNewer',
    'device-not-found': 'devices.error.deviceNotFound',
    'remote-device-rename-not-available': 'devices.error.remoteRename',
    'capability-denied:file.receive': 'transfers.error.permission',
    'file-disk-space': 'transfers.error.disk',
    'file-checksum-failed': 'transfers.error.checksum',
    'file-selection-too-large': 'transfers.error.size',
    'file-selection-total-too-large': 'transfers.error.size',
    'file-destination-required': 'transfers.error.destination',
    'file-destination-invalid': 'transfers.error.destination',
    'file-destination-not-directory': 'transfers.error.destination'
  };
  if (String(code || '').startsWith('pairing-')) return tr('devices.error.pairing', { code });
  if (String(code || '').startsWith('device-') || String(code || '').startsWith('capability-')) {
    return tr('devices.error.deviceAction', { code });
  }
  if (known[code]) return tr(known[code]);
  if (String(code || '').startsWith('file-')) return tr('transfers.error.generic', { code });
  if (String(code || '').startsWith('remote-')) return tr('remote.error.generic', { code });
  if (String(code || '').startsWith('webrtc-') || String(code || '').startsWith('datachannel-') || String(code || '').startsWith('ice-')) {
    return tr('devices.probe.failed', { code });
  }
  return tr('devices.error.generic', { code: code || '-' });
}

function remoteInventoryRefreshFailureText(code, deviceName = '-') {
  const value = String(code || 'inventory-refresh-failed');
  if (/capability-denied:inventory\.read|device-revoked/.test(value)) {
    return tr('status.refreshRemoteDenied', { name: deviceName });
  }
  if (/protocol|version|peer-message-type-unknown/.test(value)) {
    return tr('status.refreshRemoteVersion', { name: deviceName });
  }
  if (/route|endpoint|fetch|signal.*unavailable|device-unavailable/.test(value)) {
    return tr('status.refreshRemoteNoRoute', { name: deviceName });
  }
  if (/timeout|peer-disconnected|peer-not-connected|peer-not-authenticated/.test(value)) {
    return tr('status.refreshRemoteTimeout', { name: deviceName });
  }
  return tr('status.refreshRemoteFailedReason', { name: deviceName, code: value });
}

function remoteErrorText(code, deviceName = '-') {
  const value = String(code || 'remote-failed');
  const rules = [
    [/revoked|device-not-found/, 'remote.error.revoked'],
    [/protocol|version|incompatible/, 'remote.error.version'],
    [/capability-denied:screen\.view|screen.*(permission|denied|restricted)|permission.*screen|display-unavailable|desktop-capturer-unavailable|media-not-allowed/, 'remote.error.screenPermission'],
    [/capability-denied:input\.control|input.*(permission|denied|restricted)|permission.*input/, 'remote.error.inputPermission'],
    [/rejected|user-denied|consent-denied/, 'remote.error.rejected'],
    [/input-owner|input-busy|input-target-conflict|exclusive|already-control/, 'remote.error.exclusive'],
    [/relay-unavailable|turn-unavailable/, 'remote.error.relayUnavailable'],
    [/direct-failed.*relay|relay-available/, 'remote.error.directFailedRelay'],
    [/offline|peer-not-connected|device-unavailable|peer-route-unavailable|signal.*unavailable/, 'remote.error.offline'],
    [/timeout|ice-failed|connect-failed|peer-disconnected|peer-not-authenticated|media-failed/, 'remote.error.unreachable']
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  return matched
    ? tr(matched[1], { name: deviceName, code: value })
    : tr('remote.error.generic', { code: value });
}

function platformLabel(platform) {
  const key = `devices.platform.${platform}`;
  const label = tr(key);
  return label === key ? platform : label;
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { requestDeviceOverviewReload, flushPendingDeviceOverviewReload, loadDeviceOverview, renderDeviceCenter, renderMeshPreview, renderDeviceLensMenu, renderDeviceLens, renderMeshSummary, fillMeshStats, renderDeviceList, selectedDeviceDetail, ensureDeviceDetailForEntry, renderSelectedDeviceDetail, deviceActionButton, deviceMoreMenu, refreshRemoteInventoryForDevice, viewDeviceSessions, viewDeviceAgentSessions, renderSelectedDeviceActions, renderMeshAgentList, toggleMeshReachability, connectMeshDevice, openRemoteDevice, disconnectMeshDevice, deviceDiagnosticsButton, openMeshNetworkSettings, saveMeshNetworkSettings, splitNetworkLines, connectionPathText, openDeviceDiagnostics, refreshDeviceDiagnostics, renderDeviceDiagnostics, appendDiagnosticSection, configuredText, diagnosticCode, diagnosticTime, openDevicePermissions, saveRemoteDevicePermissions, revokeRemoteDevice, renameLocalDevice, runMeshTransportProbe, meshErrorText, remoteInventoryRefreshFailureText, remoteErrorText, platformLabel };
Object.assign(window, { requestDeviceOverviewReload, flushPendingDeviceOverviewReload, loadDeviceOverview, renderDeviceCenter, renderMeshPreview, renderDeviceLensMenu, renderDeviceLens, renderMeshSummary, fillMeshStats, renderDeviceList, selectedDeviceDetail, ensureDeviceDetailForEntry, renderSelectedDeviceDetail, deviceActionButton, deviceMoreMenu, refreshRemoteInventoryForDevice, viewDeviceSessions, viewDeviceAgentSessions, renderSelectedDeviceActions, renderMeshAgentList, toggleMeshReachability, connectMeshDevice, openRemoteDevice, disconnectMeshDevice, deviceDiagnosticsButton, openMeshNetworkSettings, saveMeshNetworkSettings, splitNetworkLines, connectionPathText, openDeviceDiagnostics, refreshDeviceDiagnostics, renderDeviceDiagnostics, appendDiagnosticSection, configuredText, diagnosticCode, diagnosticTime, openDevicePermissions, saveRemoteDevicePermissions, revokeRemoteDevice, renameLocalDevice, runMeshTransportProbe, meshErrorText, remoteInventoryRefreshFailureText, remoteErrorText, platformLabel });
