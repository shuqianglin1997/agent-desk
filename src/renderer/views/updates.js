// AgentDesk — the update button in the system page (docs/ARCHITECTURE_PLAN.md
// phase 6). Moved from src/renderer.js unchanged.

let updateBusy = false;

let updateButtonTimer = null;

async function handleUpdateClick() {
  if (updateBusy) return;
  updateBusy = true;
  clearTimeout(updateButtonTimer);
  els.updateBtn.disabled = true;
  els.updateBtn.classList.remove('update-available', 'update-error');
  els.updateBtn.textContent = tr('update.btn.checking');
  els.updateBtn.title = tr('update.title.querying');
  setStatus(tr('status.checkingUpdate'));

  const result = await window.manager.checkForUpdates();
  if (!result.ok) {
    setStatus(result.reason || tr('status.checkFail'));
    finishUpdateButton(tr('update.btn.retry'), tr('update.title.checkFailRetry'), 'update-error');
    return;
  }

  state.updateInfo = result;
  renderAttentionInbox();
  if (!result.updateAvailable) {
    setStatus(tr('status.latest', { version: result.currentVersion }));
    finishUpdateButton(tr('update.btn.latest'), tr('update.title.currentVersion', { version: result.currentVersion }), '');
    return;
  }

  els.updateBtn.classList.add('update-available');
  els.updateBtn.textContent = tr('update.btn.update');
  els.updateBtn.title = tr('update.title.foundClick', { version: result.latestVersion });
  const size = result.assetSize ? tr('update.sizeSuffix', { size: formatBytes(result.assetSize) }) : '';
  const action = result.installSupported
    ? tr('update.action.auto', { asset: result.assetName || tr('update.assetFallback'), size })
    : tr('update.action.manual', { reason: result.manualReason || tr('update.manualReasonFallback') });
  const confirmed = window.confirm(
    tr('update.confirm', { latest: result.latestVersion, current: result.currentVersion, action })
  );
  if (!confirmed) {
    updateBusy = false;
    els.updateBtn.disabled = false;
    setStatus(tr('status.newVersion', { version: result.latestVersion }));
    return;
  }

  els.updateBtn.disabled = true;
  els.updateBtn.textContent = result.installSupported ? '0%' : tr('update.btn.open');
  const installed = await window.manager.installUpdate();
  if (!installed.ok) {
    setStatus(installed.reason || tr('status.updateFail'));
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
  }
}

function handleUpdateProgress(progress = {}) {
  if (progress.message) setStatus(progress.message);
  if (progress.stage === 'downloading' && Number.isFinite(progress.percent)) {
    els.updateBtn.textContent = `${progress.percent}%`;
    els.updateBtn.title = tr('update.title.downloading', { percent: progress.percent });
  } else if (progress.stage === 'installing') {
    els.updateBtn.textContent = tr('update.btn.install');
    els.updateBtn.title = tr('update.title.verifyReady');
  } else if (progress.stage === 'error') {
    els.updateBtn.textContent = tr('update.btn.retry');
    els.updateBtn.classList.add('update-error');
    els.updateBtn.title = progress.message || tr('update.title.updateFail');
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
      els.updateBtn.textContent = tr('update.btn.update');
      els.updateBtn.title = tr('update.title.foundClick', { version: state.updateInfo.latestVersion });
      els.updateBtn.classList.add('update-available');
    } else {
      els.updateBtn.textContent = tr('update.btn.recheck');
      els.updateBtn.title = tr('topbar.update.title');
      els.updateBtn.classList.remove('update-available', 'update-error');
    }
  }, 2200);
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { handleUpdateClick, handleUpdateProgress, finishUpdateButton };
Object.assign(window, { handleUpdateClick, handleUpdateProgress, finishUpdateButton });
