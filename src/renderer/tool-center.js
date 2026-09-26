/* Local tool dialog controller: owns inventory, progress and rendering.
 * Only fixed manager methods are injected; no workspace state mutations. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createToolCenter = factory;
})(typeof self !== 'undefined' ? self : this, function ({ document, manager, els, tr, compactDate, currentProfileId, setStatus }) {
  const state = {
    items: [],
    summary: null,
    checkedAt: null,
    loading: false,
    busyId: null,
    message: '',
    statusTone: 'idle'
  };
async function refreshToolInventory(force = false) {
  if (!manager.scanTools || state.loading) return;
  state.loading = true;
  state.statusTone = 'idle';
  state.message = tr('tools.status.checking');
  renderToolCenter();
  try {
    const result = await manager.scanTools({ force });
    if (!result?.ok || !Array.isArray(result.items)) {
      throw new Error(result?.reason || tr('tools.status.checkFailed'));
    }
    state.items = result.items;
    state.summary = result.summary || null;
    state.checkedAt = result.checkedAt || null;
    const updates = Number(result.summary?.updates || 0);
    state.message = updates
      ? tr('tools.status.updatesFound', { n: updates })
      : tr('tools.status.checked');
  } catch (error) {
    state.statusTone = 'error';
    state.message = tr('tools.status.checkError', { msg: error.message || error });
  } finally {
    state.loading = false;
    renderToolCenter();
  }
}

function renderToolCenter() {
  if (!els.desktopToolList || !els.cliToolList) return;
  const installed = state.items.filter((item) => item.installed);
  const desktop = installed.filter((item) => item.kind === 'desktop');
  const terminal = installed.filter((item) => item.kind !== 'desktop');
  renderToolList(els.supportedToolList, state.items.filter((item) => !item.installed));
  renderToolList(els.desktopToolList, desktop);
  renderToolList(els.cliToolList, terminal);

  const summary = state.summary;
  if (els.toolSummary) {
    els.toolSummary.textContent = summary
      ? tr('tools.summary', {
          installed: summary.installed || 0,
          total: summary.total || 0,
          updates: summary.updates || 0
        })
      : tr('tools.summary.waiting');
  }
  if (els.toolCheckedAt) {
    els.toolCheckedAt.textContent = state.checkedAt
      ? tr('tools.checkedAt', { time: compactDate(state.checkedAt) })
      : tr('tools.notChecked');
  }
  if (els.toolCenterStatus) {
    els.toolCenterStatus.textContent = state.message || tr('tools.status.ready');
    els.toolCenterStatus.dataset.state = state.loading || state.busyId
      ? 'busy'
      : state.statusTone;
  }
  if (els.checkToolsBtn) {
    els.checkToolsBtn.disabled = state.loading || Boolean(state.busyId);
    els.checkToolsBtn.textContent = state.loading
      ? tr('tools.checking')
      : tr('tools.check');
  }
}

function renderToolList(container, items) {
  container.replaceChildren();
  if (state.loading && !items.length) {
    for (let index = 0; index < (container === els.desktopToolList ? 4 : 6); index += 1) {
      const skeleton = document.createElement('div');
      skeleton.className = 'tool-card tool-card-skeleton';
      skeleton.setAttribute('aria-hidden', 'true');
      container.append(skeleton);
    }
    return;
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'tool-list-empty';
    empty.textContent = tr('tools.empty');
    container.append(empty);
    return;
  }

  for (const item of items) {
    const status = toolStatus(item);
    const card = document.createElement('article');
    card.className = 'tool-card';
    card.dataset.toolId = item.id;
    card.dataset.state = status.state;
    card.dataset.installed = String(Boolean(item.installed));

    const rail = document.createElement('span');
    rail.className = 'tool-card-rail';
    rail.setAttribute('aria-hidden', 'true');

    const identity = document.createElement('div');
    identity.className = 'tool-card-identity';
    const name = document.createElement('strong');
    name.textContent = item.label;
    const kind = document.createElement('small');
    kind.textContent = tr(`tools.kind.${item.kind}`);
    identity.append(name, kind);

    const badge = document.createElement('b');
    badge.className = 'tool-status-badge';
    badge.textContent = status.label;

    const version = document.createElement('div');
    version.className = 'tool-version-track';
    const local = document.createElement('span');
    local.textContent = item.installedVersion
      ? `v${item.installedVersion}`
      : item.installed
        ? tr('tools.version.detected')
        : tr('tools.version.none');
    const arrow = document.createElement('i');
    arrow.textContent = '→';
    const latest = document.createElement('span');
    latest.textContent = item.latestVersion
      ? `v${item.latestVersion}`
      : item.kind === 'desktop'
        ? tr('tools.version.appManaged')
        : '—';
    version.append(local, arrow, latest);

    const source = document.createElement('small');
    source.className = 'tool-source';
    const manager = !item.installed && item.kind === 'cli'
      ? ''
      : tr(`tools.manager.${item.manager}`);
    const sourceLabel = item.sourceKey
      ? tr(`tools.source.${item.sourceKey}`)
      : item.source;
    source.textContent = [manager, sourceLabel].filter(Boolean).join(' · ');
    source.title = source.textContent;

    const actions = document.createElement('div');
    actions.className = 'tool-card-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = item.installed ? tr('tools.open') : tr('tools.get');
    open.disabled = state.loading || Boolean(state.busyId);
    open.addEventListener('click', () => openManagedTool(item));
    actions.append(open);

    if (item.kind !== 'terminal' && item.installed && item.canUpdate) {
      const update = document.createElement('button');
      update.type = 'button';
      update.className = item.updateAvailable === true ? 'primary' : '';
      update.textContent = toolUpdateActionLabel(item);
      update.disabled = state.loading ||
        Boolean(state.busyId) ||
        item.updateAvailable === false;
      update.addEventListener('click', () => updateManagedTool(item));
      actions.append(update);
    }

    card.append(rail, identity, badge, version, source, actions);
    container.append(card);
  }
}

function toolStatus(item) {
  if (state.busyId === item.id) {
    return { state: 'busy', label: tr('tools.state.updating') };
  }
  if (!item.installed) return { state: 'missing', label: tr('tools.state.missing') };
  if (item.kind === 'terminal') return { state: 'system', label: tr('tools.state.system') };
  if (item.updateAvailable === true) return { state: 'update', label: tr('tools.state.update') };
  if (item.updateAvailable === false) return { state: 'current', label: tr('tools.state.current') };
  if (item.checkError) return { state: 'error', label: tr('tools.state.checkError') };
  if (item.kind === 'desktop') return { state: 'managed', label: tr('tools.state.appManaged') };
  if (item.canAutoUpdate) return { state: 'unknown', label: tr('tools.state.canCheck') };
  return { state: 'manual', label: tr('tools.state.manual') };
}

function toolUpdateActionLabel(item) {
  if (item.updateAvailable === false) return tr('tools.current');
  if (item.canAutoUpdate) {
    return item.updateAvailable === true ? tr('tools.updateNow') : tr('tools.checkAndUpdate');
  }
  return item.kind === 'desktop' ? tr('tools.openUpdater') : tr('tools.updateGuide');
}

async function openManagedTool(item) {
  if (!manager.openTool) return;
  state.statusTone = 'idle';
  state.message = tr('tools.status.opening', { label: item.label });
  renderToolCenter();
  try {
    const result = await manager.openTool({
      toolId: item.id,
      profileId: currentProfileId()
    });
    state.statusTone = result?.ok ? 'idle' : 'error';
    state.message = result?.ok
      ? (result.message || tr('tools.status.opened', { label: item.label }))
      : (result?.reason || tr('tools.status.openFailed', { label: item.label }));
  } catch (error) {
    state.statusTone = 'error';
    state.message = tr('tools.status.openFailed', { label: item.label });
  }
  setStatus(state.message);
  renderToolCenter();
}

async function updateManagedTool(item) {
  if (!manager.updateTool || state.busyId) return;
  state.busyId = item.id;
  state.statusTone = 'idle';
  state.message = tr('tools.status.updating', { label: item.label });
  renderToolCenter();
  try {
    const result = await manager.updateTool(item.id);
    state.statusTone = result?.ok ? 'idle' : 'error';
    state.message = result?.ok
      ? (result.message || tr('tools.status.updated', { label: item.label }))
      : (result?.reason || tr('tools.status.updateFailed', { label: item.label }));
    setStatus(state.message);
    if (result?.item || result?.current) await refreshToolInventory(true);
  } catch (_error) {
    state.statusTone = 'error';
    state.message = tr('tools.status.updateFailed', { label: item.label });
    setStatus(state.message);
  } finally {
    state.busyId = null;
    renderToolCenter();
  }
}

function handleToolProgress(progress) {
  if (!progress?.toolId) return;
  if (!state.busyId) state.busyId = progress.toolId;
  state.statusTone = progress.phase === 'error' ? 'error' : 'idle';
  if (progress.message) state.message = progress.message;
  renderToolCenter();
}


  return { state, refreshToolInventory, renderToolCenter, handleToolProgress };
});
