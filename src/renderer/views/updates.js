// Catshelf — checking for and installing app updates from the system page
// (docs/RELEASING.md, "In-app updates"). The button checks; the line under it
// says which version and commit this copy is and what Latest is. When Latest
// is newer the button becomes "update and restart"; when it cannot be judged
// the release page is offered. Main decides and installs (src/main/updates.js).

import { formatBytes, setStatus } from './common.js';
import { renderAttentionInbox } from './inbox.js';
import { offersMainEvent, onMainEvent } from './main-events.js';
import { tr } from './settings.js';
import { els, state } from './shared.js';

let updateBusy = false;

let updateButtonTimer = null;

const shortCommit = (commit) => (typeof commit === 'string' && commit ? commit.slice(0, 7) : '');

// A fixed reason code with its sentence.
function withCode(reason, code) {
  const text = reason || tr('update.reasonFallback');
  return code ? `${text} [${code}]` : text;
}

function currentText(current) {
  if (!current) return '';
  const commit = shortCommit(current.commit);
  return tr('update.info.current', {
    version: current.version || '?',
    commit: commit ? `${commit}${current.dirty ? '+' : ''}` : tr('update.info.noCommit')
  });
}

function dateText(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '';
}

// Latest's tag (or v<version>), date and short commit.
function latestText(info) {
  const latest = info?.latest || {};
  return [info?.latestLabel, dateText(latest.publishedAt), shortCommit(latest.commit)].filter(Boolean).join(' · ');
}

function renderUpdateInfo(info) {
  const line = els.updateInfoLine;
  if (!line) return;
  const pieces = [];
  if (info?.lastAttempt) {
    pieces.push(tr('update.info.lastFailed', { reason: withCode(info.lastAttempt.reason, info.lastAttempt.reasonCode) }));
  }
  pieces.push(currentText(info?.current));
  if (info?.ok) {
    if (info.state === 'newer') pieces.push(tr('update.info.newer', { latest: latestText(info) }));
    else if (info.state === 'current') pieces.push(tr('update.info.isLatest'));
    else if (info.state === 'older') pieces.push(tr('update.info.older', { latest: latestText(info) }));
    else if (info.state === 'diverged') pieces.push(tr('update.info.diverged', { latest: latestText(info) }));
    else pieces.push(tr('update.info.unknown', { reason: withCode(info.reason, info.reasonCode) }));
    if (info.testBuild) pieces.push(tr('update.info.testBuild'));
    if (info.updateAvailable && !info.installSupported) {
      pieces.push(tr('update.info.manual', { reason: withCode(info.manualReason, info.manualReasonCode) }));
    }
  } else if (info) {
    pieces.push(withCode(info.reason, info.reasonCode));
  }
  line.textContent = pieces.filter(Boolean).join('\n');
  line.hidden = !line.textContent;
}

function showAvailable(info) {
  els.updateBtn.classList.remove('update-error');
  els.updateBtn.classList.add('update-available');
  els.updateBtn.textContent = info.installSupported ? tr('update.btn.updateRestart') : tr('update.btn.update');
  els.updateBtn.title = tr('update.title.foundClick', { label: info.latestLabel });
}

async function handleUpdateClick() {
  if (updateBusy) return;
  const known = state.updateInfo;
  if (known?.ok && known.updateAvailable) {
    await installFromInfo(known);
    return;
  }
  await checkNow();
}

async function checkNow() {
  updateBusy = true;
  clearTimeout(updateButtonTimer);
  els.updateBtn.disabled = true;
  els.updateBtn.classList.remove('update-available', 'update-error');
  els.updateBtn.textContent = tr('update.btn.checking');
  els.updateBtn.title = tr('update.title.querying');
  setStatus(tr('status.checkingUpdate'));

  const result = await window.manager.checkForUpdates();
  renderUpdateInfo(result);
  if (!result.ok) {
    setStatus(withCode(result.reason || tr('status.checkFail'), result.reasonCode));
    finishUpdateButton(tr('update.btn.retry'), tr('update.title.checkFailRetry'), 'update-error');
    return;
  }

  state.updateInfo = result;
  renderAttentionInbox();
  if (result.updateAvailable) {
    setStatus(tr('status.newVersion', { label: result.latestLabel }));
    showAvailable(result);
    updateBusy = false;
    els.updateBtn.disabled = false;
    return;
  }
  if (result.state === 'unknown') {
    setStatus(tr('update.info.unknown', { reason: withCode(result.reason, result.reasonCode) }));
    const open = window.confirm([
      tr('update.info.unknown', { reason: withCode(result.reason, result.reasonCode) }),
      currentText(result.current),
      tr('update.confirm.openRelease')
    ].join('\n\n'));
    if (open) {
      const opened = await window.manager.installUpdate({});
      setStatus(opened.ok ? (opened.message || tr('status.openedRelease')) : withCode(opened.reason, opened.reasonCode));
      finishUpdateButton(opened.ok ? tr('update.btn.opened') : tr('update.btn.retry'), tr('update.title.openedRelease'), opened.ok ? '' : 'update-error');
      return;
    }
    finishUpdateButton(tr('update.btn.recheck'), tr('topbar.update.title'), '');
    return;
  }
  setStatus(result.state === 'current'
    ? tr('status.latest', { version: result.currentVersion })
    : tr(result.state === 'older' ? 'update.info.older' : 'update.info.diverged', { latest: latestText(result) }));
  finishUpdateButton(tr('update.btn.latest'), currentText(result.current), '');
}

async function installFromInfo(info) {
  updateBusy = true;
  clearTimeout(updateButtonTimer);
  const size = info.assetSize ? tr('update.sizeSuffix', { size: formatBytes(info.assetSize) }) : '';
  const lines = [tr('update.confirm.latest', { latest: latestText(info) }), currentText(info.current)];
  if (info.testBuild) lines.push(tr('update.confirm.testBuild'));
  lines.push(info.installSupported
    ? tr('update.action.auto', { asset: info.assetName || tr('update.assetFallback'), size })
    : tr('update.action.manual', { reason: withCode(info.manualReason, info.manualReasonCode) }));
  if (info.installSupported && info.activeHubRuns > 0) lines.push(tr('update.confirm.hubRuns', { n: info.activeHubRuns }));
  if (info.installSupported && info.installMode === 'macos-app') lines.push(tr('update.confirm.keychain'));
  lines.push(tr('update.confirm.question'));
  if (!window.confirm(lines.join('\n\n'))) {
    updateBusy = false;
    els.updateBtn.disabled = false;
    setStatus(tr('status.newVersion', { label: info.latestLabel }));
    return;
  }

  els.updateBtn.disabled = true;
  els.updateBtn.textContent = info.installSupported ? '0%' : tr('update.btn.open');
  let installed = await window.manager.installUpdate({ stopRuns: info.activeHubRuns > 0 });
  // Background runs started after the check: ask about them now.
  if (!installed.ok && installed.reasonCode === 'hub-runs-active') {
    if (!window.confirm(tr('update.confirm.hubRunsNow', { n: installed.activeHubRuns || 1 }))) {
      updateBusy = false;
      els.updateBtn.disabled = false;
      showAvailable(info);
      setStatus(tr('status.newVersion', { label: info.latestLabel }));
      return;
    }
    installed = await window.manager.installUpdate({ stopRuns: true });
  }
  if (!installed.ok) {
    setStatus(withCode(installed.reason || tr('status.updateFail'), installed.reasonCode));
    finishUpdateButton(tr('update.btn.retry'), tr('update.title.updateFailRetry'), 'update-error');
    return;
  }
  if (installed.manual) {
    setStatus(installed.message || tr('status.openedRelease'));
    finishUpdateButton(tr('update.btn.opened'), tr('update.title.openedRelease'), '');
    return;
  }
  if (installed.upToDate) {
    setStatus(installed.message || tr('status.alreadyLatestShort'));
    finishUpdateButton(tr('update.btn.latest'), tr('update.title.alreadyLatest'), '');
    return;
  }
  if (installed.restarting) {
    els.updateBtn.textContent = tr('update.btn.restart');
    els.updateBtn.title = tr('update.title.restarting');
    setStatus(installed.message || tr('status.updateDoneRestart'));
    if (els.updateInfoLine) {
      els.updateInfoLine.textContent = installed.message || tr('status.updateDoneRestart');
      els.updateInfoLine.hidden = false;
    }
  }
}

function handleUpdateProgress(progress = {}) {
  if (progress.message) setStatus(progress.message);
  if (progress.stage === 'downloading' && Number.isFinite(progress.percent)) {
    els.updateBtn.textContent = `${progress.percent}%`;
    els.updateBtn.title = tr('update.title.downloading', { percent: progress.percent });
  } else if (['mounting', 'checking', 'staging'].includes(progress.stage)) {
    els.updateBtn.textContent = tr('update.btn.verifying');
    els.updateBtn.title = progress.message || tr('update.btn.verifying');
  } else if (progress.stage === 'installing') {
    els.updateBtn.textContent = tr('update.btn.install');
    els.updateBtn.title = tr('update.title.verifyReady');
  } else if (progress.stage === 'error') {
    els.updateBtn.textContent = tr('update.btn.retry');
    els.updateBtn.classList.add('update-error');
    els.updateBtn.title = withCode(progress.message || tr('update.title.updateFail'), progress.reasonCode);
  }
}

function finishUpdateButton(label, title, className) {
  updateBusy = false;
  els.updateBtn.disabled = false;
  els.updateBtn.textContent = label;
  els.updateBtn.title = title;
  els.updateBtn.classList.remove('update-available', 'update-error');
  if (className) els.updateBtn.classList.add(className);
  updateButtonTimer = setTimeout(() => {
    if (state.updateInfo?.updateAvailable) {
      showAvailable(state.updateInfo);
    } else {
      els.updateBtn.textContent = tr('update.btn.recheck');
      els.updateBtn.title = tr('topbar.update.title');
      els.updateBtn.classList.remove('update-available', 'update-error');
    }
  }, 2200);
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindUpdateEvents() {
  els.updateBtn.addEventListener('click', async () => {
    await handleUpdateClick();
  });

  onMainEvent('onUpdateProgress', (progress) => {
    handleUpdateProgress(progress);
  });

  if (offersMainEvent('onProfileRuntimeIncident')) onMainEvent('onProfileRuntimeIncident', (incident) => {
    if (incident?.reason === 'crashpad-burst-contained') {
      setStatus(tr('status.crashpadContained'));
    } else if (incident?.reason === 'crashpad-repeated-signature') {
      setStatus(tr('status.crashpadFused'));
    } else if (incident?.reason === 'crashpad-limit-pruned') {
      setStatus(tr('status.crashpadPruned', { n: incident.removedFiles || 0 }));
    }
  });

  if (offersMainEvent('onProfileQuitBlocked')) onMainEvent('onProfileQuitBlocked', () => {
    setStatus(tr('status.profileQuitBlocked'));
  });
}

export { handleUpdateClick, handleUpdateProgress, finishUpdateButton, bindUpdateEvents, renderUpdateInfo };
