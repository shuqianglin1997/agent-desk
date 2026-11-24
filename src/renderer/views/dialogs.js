// AgentDesk — dialogs, menus and popovers, one way each (docs/ARCHITECTURE_PLAN.md
// phase 6, Mesh plan 11.12-11.13):
//   dialogs   openDialog is the only place that shows a modal dialog; a child
//             dialog (openChildDialog) gives focus back to the control that
//             opened it; the header pages are the utility dialogs.
//   menus     the <details class="context-menu"> menus close by one rule set:
//             a press outside, choosing an item, Escape (closeContextMenu).
//   popovers  quota, tag picker and hub tips are browser popovers (Top Layer);
//             each places itself next to its anchor.

const childDialogReturnFocus = new WeakMap();
const childDialogFocusBound = new WeakSet();

// The only place a modal dialog is shown. Callers keep their own check for a
// dialog that is already open.
function openDialog(dialog) {
  dialog.showModal();
}

function captureChildDialogReturnFocus(trigger = document.activeElement) {
  if (!(trigger instanceof HTMLElement)) return null;
  // 触发控件在菜单或折叠区里时，返回时把它重新展开，焦点才能回到触发控件本身。
  const disclosure = trigger.closest('details');
  return {
    element: trigger,
    disclosure,
    disclosureWasOpen: disclosure?.open === true
  };
}

function openChildDialog(dialog, trigger = document.activeElement) {
  if (!dialog || dialog.open) return;
  const focusContext = trigger?.element instanceof HTMLElement
    ? trigger
    : captureChildDialogReturnFocus(trigger);
  if (focusContext) childDialogReturnFocus.set(dialog, focusContext);
  if (!childDialogFocusBound.has(dialog)) {
    childDialogFocusBound.add(dialog);
    dialog.addEventListener('close', () => {
      const focusContext = childDialogReturnFocus.get(dialog);
      childDialogReturnFocus.delete(dialog);
      requestAnimationFrame(() => {
        const returnFocus = focusContext?.element;
        if (!(returnFocus instanceof HTMLElement) || !returnFocus.isConnected || returnFocus.matches(':disabled')) return;
        const ownerDialog = returnFocus.closest('dialog');
        if (ownerDialog && !ownerDialog.open) return;
        const topDialog = document.querySelector('dialog:modal');
        if (topDialog && !topDialog.contains(returnFocus)) return;
        if (focusContext.disclosureWasOpen && focusContext.disclosure && !focusContext.disclosure.open) {
          focusContext.disclosure.open = true;
        }
        utilityDialogFocusTarget(returnFocus).focus({ preventScroll: true });
      });
    });
  }
  openDialog(dialog);
}

function utilityDialogEntries() {
  return [
    ['devices', els.deviceCenterBtn, els.deviceCenterDialog],
    ['system', els.systemBtn, els.systemDialog],
    ['activity', els.activityCenterBtn, els.activityCenterDialog]
  ];
}

function closeUtilityDialogs(exceptDialog = null) {
  for (const [kind, button, dialog] of utilityDialogEntries()) {
    if (!dialog || dialog === exceptDialog) continue;
    if (dialog.open) dialog.close();
    button?.setAttribute('aria-expanded', 'false');
    if (state.utilityDialog === kind) state.utilityDialog = null;
  }
}

function closeUtilityDialog(dialog, { restoreFocus = true } = {}) {
  if (!dialog) return;
  const entry = utilityDialogEntries().find(([, , candidate]) => candidate === dialog);
  let returnFocus = null;
  if (entry) {
    const [kind, button] = entry;
    returnFocus = button;
    button?.setAttribute('aria-expanded', 'false');
    if (state.utilityDialog === kind) state.utilityDialog = null;
  }
  if (dialog.open) dialog.close();
  if (returnFocus && restoreFocus) {
    requestAnimationFrame(() => {
      if (!document.querySelector('dialog:modal')) utilityDialogFocusTarget(returnFocus)?.focus({ preventScroll: true });
    });
  }
}

// 入口收在菜单里时（系统、设备视角），菜单关着就把焦点还给菜单的开关。
function utilityDialogFocusTarget(button) {
  const menu = button?.closest('details.context-menu');
  return menu && !menu.open ? menu.querySelector('summary') : button;
}

function openUtilityDialog(kind) {
  const entry = utilityDialogEntries().find(([name]) => name === kind);
  if (!entry) return;
  const [, button, dialog] = entry;
  if (!dialog) return;
  closeUtilityDialogs(dialog);
  state.utilityDialog = kind;
  button?.setAttribute('aria-expanded', 'true');
  if (!dialog.open) openDialog(dialog);
}

// Closes one menu; returnFocus gives focus back to its toggle when it was
// inside the menu (as Escape does).
function closeContextMenu(menu, { returnFocus = false } = {}) {
  if (!menu) return;
  if (returnFocus && menu.contains(document.activeElement)) menu.querySelector('summary')?.focus({ preventScroll: true });
  menu.open = false;
}

// 所有轻量菜单遵循同一规则：点菜单外、选择菜单项或按 Esc 后关闭。
function bindContextMenuRules() {
  document.addEventListener('pointerdown', (event) => {
    for (const menu of document.querySelectorAll('details.context-menu[open]')) {
      if (!menu.contains(event.target)) closeContextMenu(menu);
    }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.context-menu-panel button');
    closeContextMenu(button?.closest('details.context-menu'));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of document.querySelectorAll('details.context-menu[open]')) closeContextMenu(menu, { returnFocus: true });
  });
}

// Part of the window's start-up bindings (bindEvents in src/renderer.js calls
// these in their original order).
function bindUtilityDialogEvents() {
  els.activityCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('activity');
    renderAttentionInbox();
    await Promise.all([loadTransfers(), loadTaskPackageHistory()]);
  });

  els.deviceCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('devices');
    await loadDeviceOverview({ requestSecureAccess: true });
    ensureDeviceDetailForEntry();
    renderDeviceCenter();
  });

  for (const [kind, button, dialog] of utilityDialogEntries()) {
    // One close path updates UI context and the native dialog synchronously.
    // It also avoids form validation or a delayed native close event retaining stale utility state.
    const close = dialog?.querySelector('.utility-dialog-close');
    if (close) {
      close.type = 'button';
      close.addEventListener('click', () => closeUtilityDialog(dialog));
    }
    dialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeUtilityDialog(dialog);
    });
    dialog?.addEventListener('close', () => {
      const wasCurrent = state.utilityDialog === kind;
      button?.setAttribute('aria-expanded', 'false');
      if (!dialog.open && state.utilityDialog === kind) state.utilityDialog = null;
      if (wasCurrent) {
        requestAnimationFrame(() => {
          if (!document.querySelector('dialog:modal')) utilityDialogFocusTarget(button)?.focus({ preventScroll: true });
        });
      }
    });
  }
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { bindContextMenuRules, closeContextMenu, openDialog, captureChildDialogReturnFocus, openChildDialog, utilityDialogEntries, closeUtilityDialogs, closeUtilityDialog, utilityDialogFocusTarget, openUtilityDialog, bindUtilityDialogEvents };
Object.assign(window, { bindContextMenuRules, closeContextMenu, openDialog, captureChildDialogReturnFocus, openChildDialog, utilityDialogEntries, closeUtilityDialogs, closeUtilityDialog, utilityDialogFocusTarget, openUtilityDialog, bindUtilityDialogEvents });
