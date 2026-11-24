// AgentDesk — the lower-right detail panel: its mode (session or remote), the
// workspace mode, and the isolated Remote Surface's bounds and activity line
// (docs/ARCHITECTURE_PLAN.md phase 6, Mesh plan 11.8). Moved from
// src/renderer.js unchanged.

// ── Personal Agent Mesh / 设备中心 ──────────────────
let remoteSurfaceLayoutFrame = null;

let remoteSurfaceObserver = null;

const DETAIL_MODES = new Set(['session', 'remote']);

function mountWorkspaceSurfaces() {
  if (!els.mainGrid) return;
  if (els.remoteWorkspaceHost && typeof ResizeObserver === 'function') {
    remoteSurfaceObserver = new ResizeObserver(() => scheduleRemoteSurfaceLayout());
    remoteSurfaceObserver.observe(els.remoteWorkspaceHost);
  }
  window.addEventListener('resize', scheduleRemoteSurfaceLayout);
  setWorkspaceMode('sessions');
}

function setDetailMode(mode) {
  const next = DETAIL_MODES.has(mode) ? mode : 'session';
  state.detailMode = next;
  if (els.mainGrid) els.mainGrid.dataset.detail = next;
  if (els.detailPanel) {
    els.detailPanel.dataset.detail = next;
    els.detailPanel.hidden = next === 'session';
  }
  if (els.remoteWorkspaceHost) els.remoteWorkspaceHost.hidden = next !== 'remote';

  if (next === 'remote') {
    els.quotaPopover.hidePopover();
    scheduleRemoteSurfaceLayout();
  }
}

function setWorkspaceMode(mode, options = {}) {
  const requested = mode === 'sessions' ? 'session' : mode;
  const detail = DETAIL_MODES.has(requested) ? requested : 'session';
  const next = detail === 'remote' ? 'remote' : 'sessions';
  const wasRemote = state.ui.workspaceMode === 'remote';
  if (detail === 'remote' && !wasRemote) state.detailBeforeRemote = state.detailMode || 'session';
  if (detail === 'remote') closeUtilityDialogs();
  state.ui = window.UiContext.setWorkspace(state.ui, next);
  if (els.mainGrid) els.mainGrid.dataset.workspace = next;
  setDetailMode(detail);

  if (next === 'remote') scheduleRemoteSurfaceLayout();
  else if (wasRemote && options.remoteAlreadyReleased !== true) {
    // Main releases every pressed key and downgrades control before hiding the
    // isolated surface. Hiding the view directly is not a safe "back" action.
    if (window.manager.returnRemoteControl) {
      void window.manager.returnRemoteControl(state.ui.activeRemoteSessionId);
    }
  }
  renderRemoteActivity();
  renderTopbarContext();
}

function renderRemoteActivity() {
  if (!els.remoteActivityBtn) return;
  const sessions = activeOutgoingRemoteSessions();
  const background = state.ui.workspaceMode !== 'remote' && sessions.length > 0;
  els.remoteActivityBtn.hidden = !background;
  if (!background) {
    els.remoteActivityBtn.textContent = '';
    els.remoteActivityBtn.removeAttribute('title');
    els.remoteActivityBtn.removeAttribute('aria-label');
    return;
  }
  const active = sessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId) || sessions[0];
  els.remoteActivityBtn.textContent = tr('remote.background.button', { n: sessions.length });
  els.remoteActivityBtn.title = tr('remote.background.hint', {
    name: active?.deviceName || '-',
    n: sessions.length
  });
  els.remoteActivityBtn.setAttribute('aria-label', els.remoteActivityBtn.title);
  els.remoteActivityBtn.dataset.state = sessions.some((item) => item.state === 'error' || item.state === 'rejected')
    ? 'error'
    : 'viewing';
}

function scheduleRemoteSurfaceLayout() {
  if (remoteSurfaceLayoutFrame) cancelAnimationFrame(remoteSurfaceLayoutFrame);
  remoteSurfaceLayoutFrame = requestAnimationFrame(() => {
    remoteSurfaceLayoutFrame = null;
    void syncRemoteSurfaceLayout();
  });
}

async function syncRemoteSurfaceLayout() {
  if (!els.remoteWorkspaceHost || !window.manager.setRemoteControlSurface || state.ui.workspaceMode !== 'remote') return;
  const rect = els.remoteWorkspaceHost.getBoundingClientRect();
  if (rect.width < 320 || rect.height < 160) return;
  const x = Math.max(0, Math.floor(rect.left));
  const y = Math.max(0, Math.floor(rect.top));
  const result = await window.manager.setRemoteControlSurface({
    visible: true,
    bounds: {
      x,
      y,
      width: Math.max(0, Math.floor(rect.right) - x),
      height: Math.max(0, Math.floor(rect.bottom) - y)
    }
  });
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'remote-surface-failed';
    setStatus(meshErrorText(state.mesh.errorCode));
  }
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { mountWorkspaceSurfaces, setDetailMode, setWorkspaceMode, renderRemoteActivity, scheduleRemoteSurfaceLayout, syncRemoteSurfaceLayout };
Object.assign(window, { mountWorkspaceSurfaces, setDetailMode, setWorkspaceMode, renderRemoteActivity, scheduleRemoteSurfaceLayout, syncRemoteSurfaceLayout });
