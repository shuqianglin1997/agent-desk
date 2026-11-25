// AgentDesk — orderly client updates in the window (docs/ORDERLY_UPDATE_PLAN.md):
// the small mark on an account card, the detail in System › Tools, the one
// confirmation before AgentDesk closes and reopens a client's accounts, the
// reopen offer in the inbox, and the warning before a command-line tool is
// updated while it has conversations running. Main decides what is waiting
// and what may run (client:updateStatus); the window only shows it and asks.
// No sound, no popup of its own: the card mark, the tools page and the inbox.

import { setStatus } from './common.js';
import { identityGroups } from './context.js';
import { appLabel, loadActivity } from './data.js';
import { openChildDialog } from './dialogs.js';
import { renderAttentionInbox } from './inbox.js';
import { renderAccountRoster } from './roster.js';
import { tr } from './settings.js';
import { HUB_ACTIVE, els, renderToolCenter, state } from './shared.js';

const BUSY_POLL_MS = 2_000;
let inflight = null;
let signature = '';
// The dialog's subject while it is open: { appId, mode: 'restart' | 'reopen' }.
let pending = null;

function clients() {
  return state.clientUpdates.supported ? state.clientUpdates.clients : [];
}

function clientOf(appId) {
  return clients().find((client) => client.appId === appId) || null;
}

function waitingFor(client) {
  return client?.waiting?.value === true && client.open.length > 0;
}

// What changed for the person; the fact's time does not count.
function signatureOf(status) {
  return JSON.stringify([status.busy, status.clients.map((client) => [
    client.appId, client.diskVersion, client.waiting?.value, client.waiting?.certainty, client.open, client.reopen
  ])]);
}

// One read at a time; a call while one is on its way shares it.
function loadClientUpdates() {
  if (!window.manager.getClientUpdateStatus) return Promise.resolve();
  if (!inflight) inflight = readClientUpdates().finally(() => { inflight = null; });
  return inflight;
}

// A read that starts after everything before it: after a sequence ends.
async function refreshClientUpdates() {
  await inflight;
  await loadClientUpdates();
}

async function readClientUpdates() {
  try {
    const status = await window.manager.getClientUpdateStatus();
    if (!status || !Array.isArray(status.clients)) return;
    state.clientUpdates = { supported: status.supported === true, busy: status.busy || null, clients: status.clients };
    const next = signatureOf(state.clientUpdates);
    if (next === signature) return;
    signature = next;
    renderAccountRoster();
    renderAttentionInbox();
    // The tools page draws its rows when it opens; while open, it follows.
    if (els.systemDialog?.open) renderToolCenter();
  } catch (_error) {
    // A failed read keeps what was known; nothing is shown as waiting by guess.
  }
}

// How a location is listed: the card's (account's) name, and the location's
// own name too when it differs, so two locations of one account stay apart.
function accountName(profileId) {
  const group = identityGroups().find((item) => (item.members || []).some((member) => String(member._meshProfileId || member.id) === profileId));
  const own = state.profiles.find((profile) => profile.id === profileId)?.name || '';
  const name = group?.primary?.name || own || profileId;
  return own && own !== name ? `${name} · ${own}` : name;
}

// The card mark: one of this card's local locations is open in a client that
// has an update waiting. Null when nothing is known to be waiting.
function cardUpdateMark(group) {
  const ids = new Set((group?.members || []).filter((member) => !member._remote).map((member) => String(member._meshProfileId || member.id)));
  let found = null;
  for (const client of clients()) {
    if (!waitingFor(client) || !client.open.some((member) => ids.has(member.profileId))) continue;
    if (!found || client.waiting.certainty === 'exact') found = client;
  }
  if (!found) return null;
  const key = found.waiting.certainty === 'exact' ? 'clientUpdate.card.exact' : 'clientUpdate.card.inferred';
  return { icon: 'refresh', title: tr(key, { app: appLabel(found.appId) }) };
}

// The detail on a desktop tool's row: what is waiting, or what can be reopened,
// with the one action that goes with it. Null when there is nothing to say.
function toolUpdateDetail(item) {
  if (item.kind !== 'desktop' || !state.clientUpdates.supported) return null;
  const own = (item.clientIds || []).map(clientOf).filter(Boolean);
  const busy = own.find((client) => state.clientUpdates.busy?.appId === client.appId);
  const waiting = own.find(waitingFor);
  const reopen = own.find((client) => client.reopen);
  const client = busy || waiting || reopen;
  if (!client) return null;
  const phase = busy ? tr(`clientUpdate.tool.phase.${state.clientUpdates.busy.phase}`) : null;
  if (waitingFor(client)) {
    // The row shows the version already; the line says only what is waiting.
    const line = tr(client.waiting.certainty === 'exact' ? 'clientUpdate.tool.exact' : 'clientUpdate.tool.inferred', { n: client.open.length });
    return {
      label: tr('clientUpdate.tool.waiting'),
      line,
      action: { label: phase || tr('clientUpdate.tool.restart'), disabled: Boolean(state.clientUpdates.busy), run: (button) => openClientUpdateDialog(client.appId, 'restart', button) }
    };
  }
  if (client.reopen) {
    return {
      label: tr('clientUpdate.tool.reopenable'),
      line: tr('clientUpdate.tool.reopen', { n: client.reopen.profileIds.length }),
      action: { label: phase || tr('clientUpdate.tool.reopenAction'), disabled: Boolean(state.clientUpdates.busy), run: (button) => openClientUpdateDialog(client.appId, 'reopen', button) }
    };
  }
  // Between closing and opening again: only the phase.
  return { label: tr('clientUpdate.tool.waiting'), line: '', action: { label: phase || tr('clientUpdate.tool.restart'), disabled: true, run: () => {} } };
}

// The inbox's reopen offers: the person updated from inside the client.
function reopenAttentionItems() {
  return clients().filter((client) => client.reopen).map((client) => ({
    kind: 'info',
    title: tr('attention.reopen.title', { app: appLabel(client.appId), version: client.reopen.toVersion }),
    detail: tr('attention.reopen.detail', { n: client.reopen.profileIds.length }),
    action: 'reopen-client',
    appId: client.appId
  }));
}

function impactLine(text) {
  const line = document.createElement('div');
  line.textContent = text;
  return line;
}

// One account in the reopen list: the shared checkbox row, ticked when it left
// within ten minutes of the last one; an earlier one says so and is not ticked.
function reopenChoice(member) {
  const row = document.createElement('label');
  row.className = 'catalog-local-registration';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = member.recent === true;
  box.dataset.profileId = member.profileId;
  box.addEventListener('change', syncReopenConfirm);
  const name = document.createElement('span');
  const label = accountName(member.profileId);
  name.textContent = member.recent ? label : tr('clientUpdate.dialog.earlier', { name: label });
  row.append(box, name);
  return row;
}

function reopenTicked() {
  return [...els.clientUpdateImpact.querySelectorAll('input[type="checkbox"][data-profile-id]')]
    .filter((box) => box.checked)
    .map((box) => box.dataset.profileId);
}

// Nothing ticked, nothing to open.
function syncReopenConfirm() {
  els.confirmClientUpdateBtn.disabled = reopenTicked().length === 0;
}

// From the latest poll; Main checks again before it does anything.
async function openClientUpdateDialog(appId, mode, trigger = document.activeElement) {
  const client = clientOf(appId);
  if (!client || (mode === 'restart' ? !waitingFor(client) : !client.reopen) || state.clientUpdates.busy) {
    setStatus(tr('clientUpdate.status.failed', { code: mode === 'restart' ? 'no-update-waiting' : 'nothing-to-reopen' }));
    return;
  }
  pending = { appId, mode };
  const app = appLabel(appId);
  const lines = [];
  let backgroundRuns = 0;
  if (mode === 'restart') {
    els.clientUpdateTitle.textContent = tr('clientUpdate.dialog.restartTitle', { app });
    els.clientUpdateLead.textContent = tr('clientUpdate.dialog.restartLead', { app });
    for (const member of client.open) {
      const name = accountName(member.profileId);
      const writing = state.activity[member.profileId]?.writingNow;
      backgroundRuns += member.backgroundRuns;
      if (member.backgroundRuns > 0) lines.push(tr('clientUpdate.dialog.background', { name, n: member.backgroundRuns }));
      else if (Number.isFinite(writing) && writing > 0) lines.push(tr('clientUpdate.dialog.running', { name, n: writing }));
      else lines.push(name);
    }
    els.confirmClientUpdateBtn.textContent = tr('clientUpdate.dialog.restartConfirm');
  } else {
    els.clientUpdateTitle.textContent = tr('clientUpdate.dialog.reopenTitle', { app });
    els.clientUpdateLead.textContent = tr('clientUpdate.dialog.reopenLead', { app, version: client.reopen.toVersion });
    els.confirmClientUpdateBtn.textContent = tr('clientUpdate.dialog.reopenConfirm');
  }
  els.clientUpdateImpact.replaceChildren(...(mode === 'restart' ? lines.map(impactLine) : client.reopen.members.map(reopenChoice)));
  // Background runs stop only by an explicit choice; unticked, it cannot go on.
  els.clientUpdateStopRunsField.hidden = backgroundRuns === 0;
  els.clientUpdateStopRuns.checked = false;
  els.clientUpdateStopRunsLabel.textContent = tr('clientUpdate.dialog.stopRuns', { n: backgroundRuns });
  if (mode === 'restart') els.confirmClientUpdateBtn.disabled = backgroundRuns > 0;
  else syncReopenConfirm();
  openChildDialog(els.clientUpdateDialog, trigger);
}

function resultMessage(appId, mode, result) {
  const app = appLabel(appId);
  if (result?.ok) {
    return tr('clientUpdate.status.done', { app, version: result.version || '-', n: (result.opened || []).length });
  }
  if (result?.reasonCode === 'update-not-installed') return tr('clientUpdate.status.notInstalled', { app });
  if (result?.reasonCode === 'client-reopen-failed') {
    return tr('clientUpdate.status.reopenFailed', { n: (result.failed || []).length, code: result.failed?.[0]?.reasonCode || result.reasonCode });
  }
  return tr('clientUpdate.status.failed', { code: result?.reasonCode || (mode === 'restart' ? 'client-restart-failed' : 'client-reopen-failed') });
}

async function confirmClientUpdate() {
  const subject = pending;
  if (!subject) return;
  const stopBackgroundRuns = !els.clientUpdateStopRunsField.hidden && els.clientUpdateStopRuns.checked;
  const ticked = subject.mode === 'reopen' ? reopenTicked() : [];
  if (subject.mode === 'reopen' && !ticked.length) return;
  pending = null;
  els.clientUpdateDialog.close();
  if (subject.mode === 'restart') setStatus(tr('clientUpdate.status.restarting', { app: appLabel(subject.appId) }));
  // While Main works through the order, the tools row follows its phase.
  const ticker = setInterval(() => void loadClientUpdates(), BUSY_POLL_MS);
  let result = null;
  try {
    result = subject.mode === 'restart'
      ? await window.manager.restartClientForUpdate(subject.appId, { stopBackgroundRuns })
      : await window.manager.reopenClientSet(subject.appId, ticked);
  } catch (_error) {
    result = null;
  } finally {
    clearInterval(ticker);
  }
  setStatus(resultMessage(subject.appId, subject.mode, result));
  await refreshClientUpdates();
  await loadActivity();
}

// How many conversations a command-line tool's accounts have running: the
// activity probe (one count per data root) and the hub's runs on them; they
// may be the same conversation, so the larger is taken, not the sum.
function toolRunningCount(item) {
  const ids = new Set(state.profiles.filter((profile) => (item.clientIds || []).includes(profile.appId)).map((profile) => profile.id));
  const roots = new Set();
  let files = 0;
  for (const profile of state.profiles) {
    const writing = ids.has(profile.id) ? state.activity[profile.id]?.writingNow : null;
    if (!Number.isFinite(writing) || roots.has(profile.sessionRoot || profile.id)) continue;
    roots.add(profile.sessionRoot || profile.id);
    files += writing;
  }
  let hub = 0;
  for (const run of state.hub.runs.values()) if (HUB_ACTIVE.has(run.state) && ids.has(String(run.target?.id))) hub += 1;
  return Math.max(files, hub);
}

// Before a command-line tool is updated: with conversations running, ask once.
function confirmToolUpdate(item) {
  if (item.kind !== 'cli' || !item.canAutoUpdate) return true;
  const running = toolRunningCount(item);
  return running === 0 || window.confirm(tr('tools.update.runningConfirm', { label: item.label, n: running }));
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js).
function bindClientUpdateEvents() {
  els.confirmClientUpdateBtn?.addEventListener('click', () => void confirmClientUpdate());
  els.clientUpdateStopRuns?.addEventListener('change', () => {
    els.confirmClientUpdateBtn.disabled = !els.clientUpdateStopRuns.checked;
  });
  els.clientUpdateDialog?.addEventListener('close', () => { pending = null; });
}

export { loadClientUpdates, cardUpdateMark, toolUpdateDetail, reopenAttentionItems, openClientUpdateDialog, confirmToolUpdate, toolRunningCount, bindClientUpdateEvents };
