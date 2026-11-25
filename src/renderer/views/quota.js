// AgentDesk — quota: loading, the card's energy pips, and the quota popover
// with its overview (docs/ARCHITECTURE_PLAN.md phase 6). Moved from
// src/renderer.js unchanged.

import { setStatus } from './common.js';
import { actionAgentId, groupOfProfile, identityGroups, selectedProfile, setActionAgent } from './context.js';
import { setWorkspaceMode } from './detail.js';
import { renderAttentionInbox } from './inbox.js';
import { accountCardControl, renderAccountHeader, trustedLocalAccountCardQuota } from './roster.js';
import { dateLocale, tr } from './settings.js';
import { els, state } from './shared.js';

let quotaHasLoaded = false;
let quotaRequestedAt = 0;

let quotaRequest = null;

let quotaForcedAfter = null;

// ── 账号额度（Beta）────────────────────────────────────
async function loadQuotas(force = false) {
  if (!window.manager.listQuotas) return null;
  if (quotaRequest) {
    if (force !== true) return quotaRequest;
    // "Refresh now" while a request is running: ask again with force once it ends.
    quotaForcedAfter ||= quotaRequest.then(() => {
      quotaForcedAfter = null;
      return loadQuotas(true);
    });
    return quotaForcedAfter;
  }

  quotaRequestedAt = Date.now();
  state.quotaError = null;
  renderQuotaSummary();
  quotaRequest = (async () => {
    try {
      const list = await window.manager.listQuotas({ force: force === true });
      if (!Array.isArray(list)) throw new Error(tr('quota.err.badFormat'));
      state.quotas = Object.fromEntries(
        list.filter((item) => item?.profileId).map((item) => [item.profileId, item])
      );
      return list;
    } catch (error) {
      state.quotaError = error?.message || tr('quota.err.queryFail');
      return null;
    } finally {
      quotaHasLoaded = true;
      quotaRequest = null;
      renderAccountHeader();
      renderAttentionInbox();
    }
  })();
  // Render once more after quotaRequest becomes truthy so the loading marker
  // appears even when a previous snapshot is still on screen.
  renderQuotaSummary();
  return quotaRequest;
}

function selectedQuota() {
  const profile = selectedProfile();
  const group = profile ? groupOfProfile(profile.id) : null;
  const evidence = trustedLocalAccountCardQuota(group, Date.now());
  if (evidence.status === 'ok') return { ...evidence.snapshot, windows: evidence.windows };
  if (evidence.status === 'not_applicable') return evidence.snapshot;
  if (evidence.status === 'conflict') return { status: 'error', windows: [], reason: tr('card.quotaConflict') };
  const snapshot = profile ? state.quotas[profile.id] : null;
  if (!snapshot || snapshot.status !== 'ok') return snapshot || null;
  return { ...snapshot, status: 'stale', windows: [], reason: tr('energy.unknown') };
}

function quotaPlanLabel(value) {
  const labels = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    pro: 'Pro',
    prolite: 'Pro Lite',
    team: 'Team',
    self_serve_business_usage_based: 'Business',
    business: 'Business',
    enterprise_cbp_usage_based: 'Enterprise',
    enterprise: 'Enterprise',
    edu: 'Edu',
    unknown: 'Unknown'
  };
  return value ? (labels[value] || String(value)) : '';
}

function formatQuotaReset(value, now = Date.now()) {
  const resetAt = Date.parse(value);
  if (!Number.isFinite(resetAt)) return tr('quota.reset.unknown');
  const remaining = resetAt - now;
  if (remaining <= 0) return tr('quota.reset.due');
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return tr('quota.reset.min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tr('quota.reset.hm', { h: hours, m: minutes % 60 });
  const days = Math.floor(hours / 24);
  if (days < 7) return tr('quota.reset.dh', { d: days, h: hours % 24 });
  const time = new Date(resetAt).toLocaleString(dateLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return tr('quota.reset.at', { time });
}

// A quota reason in the interface language: the main process sends the
// language-table keys of its reasons; a snapshot without them (an older
// device) shows the text it sent.
export function quotaReasonText(snapshot) {
  const keys = Array.isArray(snapshot?.reasonKeys) ? snapshot.reasonKeys.filter((key) => typeof key === 'string' && key) : [];
  if (keys.length) return keys.map((key) => tr(key)).join(tr('quota.reason.separator'));
  return snapshot?.reason ? String(snapshot.reason) : '';
}

function quotaHeadline(snapshot) {
  if (!snapshot || !window.YardEnergy) return tr('quota.unknown');
  const window_ = window.YardEnergy.constrainingWindow(snapshot, Date.now());
  if (!window_) return quotaReasonText(snapshot) || tr('quota.unknown');
  return tr('quota.headline', { label: window_.label, pct: Math.round(window_.remainingPercent) });
}

function renderQuotaMeters(snapshot) {
  els.quotaMeters.replaceChildren();
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  if (!windows.length) return;
  const labelCounts = windows.reduce((map, item) => {
    map.set(item.label, (map.get(item.label) || 0) + 1);
    return map;
  }, new Map());

  for (const window_ of windows) {
    const remaining = Number(window_.remainingPercent);
    if (!Number.isFinite(remaining)) continue;
    const level = window.YardEnergy?.energyForRemaining(remaining) || 'unknown';
    const meter = document.createElement('div');
    meter.className = 'quota-meter';
    meter.dataset.level = level;

    const head = document.createElement('div');
    head.className = 'quota-meter-head';
    const label = document.createElement('span');
    label.className = 'quota-meter-label';
    const scope = String(window_.scope || '').trim();
    // The default scope is named after the provider itself; say it only when two windows share a label.
    const showScope = scope && (scope.toLowerCase() !== String(snapshot?.provider || '').toLowerCase() || labelCounts.get(window_.label) > 1);
    label.textContent = `${showScope ? `${scope} · ` : ''}${window_.label || tr('quota.window.fallback')}`;
    const value = document.createElement('span');
    value.className = 'quota-meter-value';
    value.textContent = tr('quota.remainingShort', { pct: Math.round(remaining) });
    head.append(label, value);

    const track = document.createElement('div');
    track.className = 'quota-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label.textContent);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(remaining)));
    const fill = document.createElement('div');
    fill.className = 'quota-fill';
    fill.style.width = `${Math.max(0, Math.min(100, remaining))}%`;
    track.append(fill);

    const foot = document.createElement('div');
    foot.className = 'quota-meter-foot';
    foot.textContent = formatQuotaReset(window_.resetsAt);
    meter.title = tr('quota.meter.title', { label: label.textContent, used: Math.round(window_.usedPercent), reset: foot.textContent });
    meter.append(head, track, foot);
    els.quotaMeters.append(meter);
  }
}

function toggleQuotaPopover(anchor) {
  if (state.quotaAnchor === anchor) {
    els.quotaPopover.hidePopover();
  } else {
    openQuotaPopover(anchor);
  }
}

function openQuotaPopover(anchor) {
  if (!anchor || anchor.disabled || anchor.hidden) return;
  els.quotaPopover.hidePopover();
  if (state.ui.workspaceMode === 'remote') setWorkspaceMode('sessions');
  state.quotaAnchor = anchor;
  renderQuotaSummary();
  if (anchor.hidden || (anchor !== els.quotaChipAll && els.quotaSummary.hidden)) {
    state.quotaAnchor = null;
    return;
  }
  anchor.focus({ preventScroll: true });
  els.quotaPopover.showPopover({ source: anchor });
  anchor.setAttribute('aria-expanded', 'true');
  positionQuotaPopover();
}

function positionQuotaPopover() {
  const { quotaAnchor: anchor } = state;
  const popup = els.quotaPopover;
  if (!anchor || !popup.matches(':popover-open')) return;
  const gap = 6;
  const inset = 12;
  const rect = anchor.getBoundingClientRect();
  const roster = els.accountRoster.getBoundingClientRect();
  if (!rect.width || (anchor !== els.quotaChipAll && (rect.right <= roster.left || rect.left >= roster.right))) {
    popup.hidePopover();
    return;
  }

  const below = window.innerHeight - rect.bottom - gap - inset;
  const above = rect.top - gap - inset;
  const openBelow = below >= above;
  popup.style.maxHeight = `${Math.max(below, above)}px`;
  const width = popup.offsetWidth;
  const left = anchor === els.quotaChipAll ? rect.right - width : Math.max(rect.left, roster.left);
  popup.style.left = `${Math.max(inset, Math.min(left, window.innerWidth - width - inset))}px`;
  popup.style.top = `${openBelow ? rect.bottom + gap : rect.top - gap - popup.offsetHeight}px`;
}

function renderQuotaSummary() {
  renderQuotaOverview();
  const profile = selectedProfile();
  const { quotaAnchor: anchor } = state;
  els.quotaSummary.hidden = !profile || !anchor || anchor !== accountCardControl(actionAgentId(), '.account-card-quota-summary') || anchor.disabled;
  if (els.quotaSummary.hidden) {
    if (anchor && anchor !== els.quotaChipAll) els.quotaPopover.hidePopover();
    return;
  }
  const name = groupOfProfile(profile.id)?.primary.name || profile.name;
  els.quotaPopoverTitle.textContent = tr('quota.accountTitle', { name });
  renderAccountQuota();
  positionQuotaPopover();
}

function renderAccountQuota() {
  const snapshot = selectedQuota();
  const loading = Boolean(quotaRequest);
  els.quotaRefreshBtn.disabled = loading;
  els.quotaSummary.classList.toggle('is-loading', loading);
  const refreshFailed = Boolean(state.quotaError) && snapshot?.status === 'ok';
  els.quotaSummary.dataset.status = refreshFailed ? 'stale' : (snapshot?.status || (loading ? 'loading' : 'unknown'));
  els.quotaSummary.dataset.energy = 'unknown';
  els.quotaPlan.textContent = quotaPlanLabel(snapshot?.planType);
  els.quotaMeters.replaceChildren();

  if (!snapshot) {
    els.quotaStateBadge.textContent = loading ? tr('quota.badge.querying') : (state.quotaError ? tr('quota.badge.readFail') : tr('quota.waiting'));
    els.quotaMessage.textContent = loading
      ? tr('quota.msg.loading')
      : (state.quotaError || tr('quota.msg.idle'));
    els.quotaSummary.title = els.quotaMessage.textContent;
    return;
  }

  const statusLabels = {
    unsupported: tr(snapshot.reasonCode === 'api-key-auth' ? 'quota.status.notApplicable' : 'quota.status.unsupported'),
    signed_out: tr('quota.status.signed_out'),
    stale: tr('quota.status.stale'),
    error: tr('quota.status.error')
  };
  if (refreshFailed) {
    els.quotaStateBadge.textContent = tr('quota.badge.lastData');
    renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = tr('quota.msg.refreshFailKeep', { err: state.quotaError });
  } else if (snapshot.status === 'ok') {
    const energy = window.YardEnergy ? window.YardEnergy.deriveEnergy(snapshot, Date.now()) : 'unknown';
    const meta = window.YardEnergy?.ENERGY_META?.[energy];
    els.quotaSummary.dataset.energy = energy;
    const energyLabel = meta ? tr('energy.' + energy) : tr('quota.available');
    els.quotaStateBadge.textContent = loading ? `${energyLabel} · ${tr('quota.suffix.refreshing')}` : energyLabel;
    renderQuotaMeters(snapshot);
    const extras = [];
    if (snapshot.credits?.unlimited) extras.push(tr('quota.credits.unlimited'));
    else if (snapshot.credits?.hasCredits && snapshot.credits?.balance !== null && snapshot.credits?.balance !== undefined) {
      extras.push(tr('quota.credits.balance', { n: snapshot.credits.balance }));
    }
    extras.push(tr('quota.credits.live'));
    els.quotaMessage.textContent = extras.join(' · ');
  } else {
    const statusLabel = statusLabels[snapshot.status] || tr('quota.unknown');
    els.quotaStateBadge.textContent = loading
      ? `${statusLabel} · ${tr('quota.suffix.refreshing')}`
      : statusLabel;
    if (snapshot.status === 'stale') renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = quotaReasonText(snapshot) || tr('quota.msg.noData');
  }
  els.quotaSummary.title = quotaReasonText(snapshot) || `${quotaPlanLabel(snapshot.planType)} ${quotaHeadline(snapshot)}`.trim();
}

function renderQuotaOverview() {
  // 总览按「账号」而不是槽位：同一登录身份的多个槽位只出一行，
  // 行代表取组内有真实额度快照的那个（额度只在部分客户端有官方 API）。
  const groups = identityGroups();
  const rows = window.QuotaOverview?.buildTrustedQuotaOverview(groups, state.quotas, Date.now(), {
    quotaError: state.quotaError,
    reasonFor: (evidence) => tr(evidence.status === 'conflict' ? 'card.quotaConflict'
      : (evidence.status === 'not_applicable' ? 'quota.status.notApplicable' : 'energy.unknown'))
  }) || [];

  renderQuotaOverviewButton(groups, rows);
  els.quotaOverview.hidden = state.quotaAnchor !== els.quotaChipAll || groups.length < 2;
  if (els.quotaOverview.hidden) return;
  els.quotaPopoverTitle.textContent = tr('quotaMap.title');
  const withQuota = rows.filter((row) => row.hasQuota).length;
  if (els.quotaOverviewMeta) {
    els.quotaOverviewMeta.textContent = withQuota
      ? tr('quota.overview.withQuota', { a: withQuota, b: rows.length })
      : tr('quota.overview.count', { n: rows.length });
  }

  els.quotaOverviewList.replaceChildren();
  const unsupported = [];
  for (const row of rows) {
    if (row.status === 'unsupported') {
      unsupported.push(row);
      continue; // 折叠到尾部一行，不再一账号一行灰字刷屏
    }
    const item = document.createElement('li');
    item.className = 'quota-overview-item';
    item.dataset.status = row.status;

    const name = document.createElement('span');
    name.className = 'quota-overview-name';
    name.textContent = row.name;

    const value = document.createElement('span');
    value.className = 'quota-overview-value';
    if (row.hasQuota) {
      const level = window.YardEnergy?.energyForRemaining(row.tightest.remainingPercent) || 'unknown';
      item.dataset.level = level;
      value.textContent = tr('quota.overview.value', { label: row.tightest.label, pct: Math.round(row.tightest.remainingPercent) });
      item.title = `${row.name} · ${formatQuotaReset(row.tightest.resetsAt)}`;
    } else {
      value.textContent = row.status === 'loading' ? tr('quota.overview.querying') : (quotaReasonText(row) || tr('quota.overview.noData'));
      item.title = quotaReasonText(row) || value.textContent;
    }

    item.append(name, value);
    els.quotaOverviewList.append(item);
  }

  if (unsupported.length) {
    const rest = document.createElement('li');
    rest.className = 'quota-overview-rest';
    rest.textContent = tr('quota.overview.rest', { n: unsupported.length });
    rest.title = unsupported.map((row) => row.name).join('、');
    els.quotaOverviewList.append(rest);
  }
  positionQuotaPopover();
}

function renderQuotaOverviewButton(groups, rows) {
  const known = rows.filter((row) => row.hasQuota);
  const allRow = known.length
    ? known.reduce((a, b) => (a.tightest.remainingPercent <= b.tightest.remainingPercent ? a : b))
    : null;
  const chip = els.quotaChipAll;
  const value = chip.querySelector('b');
  const hint = tr('quota.chip.allHint');
  if (allRow) {
    const pct = Math.max(0, Math.min(100, Math.round(allRow.tightest.remainingPercent)));
    value.textContent = tr('quotaMap.minimum', { pct });
    chip.title = tr('quota.chip.title', {
      prefix: tr('quota.chip.allPrefix', { name: allRow.name }),
      label: allRow.tightest.label, pct, hint
    });
  } else {
    value.textContent = quotaRequest ? '…' : '—';
    chip.title = tr('quota.chip.hintOnly', { reason: tr(quotaRequest ? 'quota.chip.querying' : 'quota.chip.noData'), hint });
  }
  chip.hidden = groups.length < 2;
  if (chip.hidden && state.quotaAnchor === chip) els.quotaPopover.hidePopover();
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindQuotaEvents() {
  els.quotaChipAll.addEventListener('click', (event) => {
    event.preventDefault();
    toggleQuotaPopover(event.currentTarget);
  });
  els.quotaPopoverClose.addEventListener('click', () => els.quotaPopover.hidePopover());
  els.quotaPopover.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'closed') return;
    state.quotaAnchor?.setAttribute('aria-expanded', 'false');
    state.quotaAnchor = null;
    // 额度浮层收起后，被操作的猫回到正在看的那只；档案开着时由档案负责。
    if (!els.agentManageDialog?.open) setActionAgent(null);
  });
  els.accountRoster.addEventListener('scroll', positionQuotaPopover, { passive: true });
  window.addEventListener('resize', positionQuotaPopover);
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindQuotaRefreshEvents() {
  els.quotaRefreshBtn.addEventListener('click', async () => {
    if (!selectedProfile()) return;
    setStatus(tr('status.quotaRefreshing'));
    await loadQuotas(true);
    const quota = selectedQuota();
    if (state.quotaError) {
      setStatus(tr('status.quotaRefreshFail', { err: state.quotaError }));
    } else if (quota?.status === 'ok') {
      setStatus(tr('status.quotaRefreshed', { headline: quotaHeadline(quota) }));
    } else {
      setStatus(quotaReasonText(quota) || state.quotaError || tr('status.quotaUnavailable'));
    }
  });
}

export { loadQuotas, selectedQuota, quotaPlanLabel, formatQuotaReset, quotaHeadline, renderQuotaMeters, toggleQuotaPopover, openQuotaPopover, positionQuotaPopover, renderQuotaSummary, renderAccountQuota, renderQuotaOverview, renderQuotaOverviewButton, bindQuotaEvents, bindQuotaRefreshEvents, quotaRequestedAt, quotaHasLoaded };
