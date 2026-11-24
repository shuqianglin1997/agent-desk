// AgentDesk — the inbox: what needs attention and the header badge
// (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js unchanged.

// ── 本机工具维护 ────────────────────────────────────
// ── 统一提醒入口 ─────────────────────────────────────
function collectAttentionItems() {
  const items = [];
  const now = Date.now();
  if (window.YardCats) {
    for (const profile of state.profiles) {
      const activityState = window.YardCats.deriveState(now, profile, state.activity[profile.id]);
      if (activityState === 'confused') {
        items.push({
          kind: 'error',
          title: tr('attention.confused.title', { name: profile.name }),
          detail: tr('attention.confused.detail'),
          profileId: profile.id,
          action: 'diagnostics'
        });
      }
      const energy = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotas[profile.id], now)
        : 'unknown';
      if (energy === 'exhausted') {
        items.push({
          kind: 'warning',
          title: tr('attention.lowquota.title', { name: profile.name }),
          detail: tr('attention.lowquota.detail'),
          profileId: profile.id,
          action: 'quota'
        });
      }
    }
  }
  if (state.updateInfo?.updateAvailable) {
    items.push({
      kind: 'info',
      title: tr('attention.update.title', { version: state.updateInfo.latestVersion }),
      detail: tr('attention.update.detail'),
      action: 'update'
    });
  }
  if (state.mesh.overview?.initialized) {
    for (const slot of state.mesh.overview.slots || []) {
      if (slot.assignmentState === 'linked' && slot.agentId && slot.accountBindingId) continue;
      const device = state.mesh.overview.devices.find((item) => item.deviceId === slot.deviceId);
      items.push({
        kind: slot.assignmentState === 'identity-changed' ? 'error' : 'warning',
        title: tr('attention.catalog.title', { name: slot.localLabel || appLabel(slot.appId) }),
        detail: tr('attention.catalog.detail', {
          device: device?.name || slot.deviceId,
          state: slot.assignmentState || 'pending'
        }),
        slotKey: catalogSlotKey(slot),
        action: 'assign-slot'
      });
    }
  }
  return items.slice(0, 8);
}

function renderAttentionInbox() {
  if (!els.attentionInbox) return;
  const items = collectAttentionItems();
  els.attentionInbox.hidden = items.length === 0;
  if (els.attentionEmpty) els.attentionEmpty.hidden = items.length > 0 || incomingTaskPackageTransfers().length > 0;
  updateActivityBadge(items.length);
  els.attentionCount.textContent = String(items.length);
  els.attentionItems.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attention-item';
    button.dataset.kind = item.kind || 'info';
    const title = document.createElement('b');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = item.detail || tr('attention.detail.fallback');
    button.append(title, detail);
    button.addEventListener('click', async () => {
      if (item.profileId && item.profileId !== currentProfileId()) await selectProfile(item.profileId);
      if (item.action === 'diagnostics') await showDiagnostics();
      else if (item.action === 'quota') {
        const anchor = selectedCardControl('.account-card-quota-summary');
        closeUtilityDialog(els.activityCenterDialog, { restoreFocus: !anchor || anchor.disabled });
        openQuotaPopover(anchor);
      }
      else if (item.action === 'update') await handleUpdateClick();
      else if (item.action === 'assign-slot') openSlotAssignmentDialog(catalogSlotByKey(item.slotKey));
    });
    els.attentionItems.append(button);
  }
}

function updateActivityBadge(attentionCount = collectAttentionItems().length) {
  if (!els.activityCountBadge) return;
  const total = Number(attentionCount || 0) + pendingIncomingTaskPackageCount();
  els.activityCountBadge.hidden = total === 0;
  els.activityCountBadge.textContent = String(total);
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { collectAttentionItems, renderAttentionInbox, updateActivityBadge };
Object.assign(window, { collectAttentionItems, renderAttentionInbox, updateActivityBadge });
