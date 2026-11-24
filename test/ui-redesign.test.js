const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('窗口顶栏保留设备视角位置并使用纯文字标题', () => {
  const html = read('src/index.html');
  const settings = read('src/settings.js');
  const workspaceStyles = read('src/workspace.css');
  const topbar = html.slice(
    html.indexOf('<header class="app-topbar">'),
    html.indexOf('</header>', html.indexOf('<header class="app-topbar">'))
  );
  assert.match(topbar, /id="deviceLensSelect"[\s\S]*?id="deviceCenterBtn"[\s\S]*?id="toolCenterBtn"[\s\S]*?id="activityCenterBtn"[\s\S]*?id="settingsBtn"/);
  assert.doesNotMatch(topbar, /globalMoreMenu|topbar\.more/);
  for (const id of ['updateBtn', 'helpBtn', 'langToggle', 'themeToggle']) {
    assert.doesNotMatch(topbar, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`id="settingsDialog"[\\s\\S]*?id="${id}"`));
  }
  for (const [button, dialog] of [
    ['deviceCenterBtn', 'deviceCenterDialog'],
    ['toolCenterBtn', 'toolCenterDialog'],
    ['activityCenterBtn', 'activityCenterDialog'],
    ['settingsBtn', 'settingsDialog']
  ]) {
    assert.match(topbar, new RegExp(`id="${button}"[^>]*aria-haspopup="dialog"[^>]*aria-controls="${dialog}"[^>]*aria-expanded="false"`));
  }
  assert.match(topbar, /<span class="topbar-brand">AgentDesk<\/span>/);
  assert.doesNotMatch(topbar, /brand-mark|agent-view-segment|viewToggle|classicViewBtn/);
  assert.match(workspaceStyles, /--lens-width: 216px;[\s\S]*?50vw - 25px/);
  assert.match(topbar, /id="windowAddMenu"[\s\S]*?id="addProfileBtn"[\s\S]*?id="codexImportBtn"/);
  const presenter = html.slice(html.indexOf('class="presenter-head"'), html.indexOf('class="agent-panel-body"'));
  assert.match(presenter, /id="presenterCount"/);
  assert.doesNotMatch(presenter, /id="viewToggle"|id="codexImportBtn"/);
  assert.match(workspaceStyles, /\.app-topbar\s*\{\s*-webkit-app-region: drag/);
  assert.match(workspaceStyles, /\.app-topbar :is\(button, select, summary, a, \.context-menu-panel\)\s*\{\s*-webkit-app-region: no-drag/);
  assert.match(workspaceStyles, /env\(titlebar-area-width, 100%\)/);
  assert.match(presenter, /id="quotaChipAll"[^>]*aria-controls="quotaPopover"/);
  assert.match(settings, /view:\s*'classic'/);
});

test('卡片工作台不加载旧庭院并保留共用像素头像', () => {
  const legacyStyles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');
  const renderer = read('src/renderer.js');

  assert.match(legacyStyles, /^@layer legacy, reset, tokens, shell, components, features, themes;/);
  const html = read('src/index.html');
  assert.doesNotMatch(html, /yardStage|yardCanvas|yard\/(?:scene\.js|yard\.css)/);
  assert.doesNotMatch(renderer, /YardScene|applyView|state\.view =/);
  assert.match(html, /yard\/sprites\.js/);
  assert.match(renderer, /drawAccountAvatar\(avatar, primary\)/);
  assert.match(workspaceStyles, /@layer themes\s*\{\s*\[hidden\]\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(workspaceStyles, /\.session-table tbody tr(?::|\.)[^\{]*::(?:before|after)/);
});

test('卡片名册使用固定宽度与可信摘要，并用真实窗口验收覆盖少量卡和 7+ Agent', () => {
  const workspaceStyles = read('src/workspace.css');
  const renderer = read('src/renderer.js');
  const quotaOverview = read('src/quota-overview.js');
  const identityGroups = read('src/identity-groups.js');
  const acceptance = read('scripts/ui-acceptance.js');

  assert.match(workspaceStyles, /\.agent-panel \.account-roster \{[\s\S]*?grid-auto-columns:\s*180px;[\s\S]*?justify-content:\s*start;[\s\S]*?overflow-x:\s*auto;[\s\S]*?scroll-padding-inline:\s*1px;[\s\S]*?scrollbar-gutter:\s*stable;/);
  assert.match(workspaceStyles, /\.agent-panel \.account-card \{\s*display:\s*grid;[\s\S]*?grid-template-rows:/);
  assert.match(workspaceStyles, /\.account-card-details \{[\s\S]*?align-self:\s*end;/);
  assert.match(renderer, /function revealSelectedAccountCard\(\)[\s\S]*?scrollPaddingInlineStart[\s\S]*?scrollLeft = Math\.min/);
  assert.match(quotaOverview, /function activeCardWindows\(snapshot, now\)[\s\S]*?resetsAt > now/);
  assert.match(quotaOverview, /function quotaWindowsConflict\(left, right\)[\s\S]*?leftWindows\.length !== rightWindows\.length/);
  assert.match(quotaOverview, /function selectTrustedAccountQuota\(group, quotasById[\s\S]*?options\.quotaError[\s\S]*?_remote !== true[\s\S]*?TRUSTED_SOURCES[\s\S]*?quotaWindowsConflict[\s\S]*?status: 'conflict'/);
  assert.match(identityGroups, /function cardActivityEvidence[\s\S]*?remoteUnknown[\s\S]*?function resolveCardActivityState/);
  assert.match(renderer, /const activityEvidence = window\.IdentityGroups[\s\S]*?resolveCardActivityState[\s\S]*?tr\('card\.activityUnknown'\)/);
  assert.match(renderer, /setInterval\(\(\) => \{\s*if \(!document\.hidden\) loadActivity\(\);/);
  assert.match(renderer, /visibilitychange[\s\S]*?if \(document\.hidden\) return;\s*refreshSessionsOnForeground\(\);\s*loadActivity\(\);/);
  assert.match(renderer, /window\.addEventListener\('focus', refreshSessionsOnForeground\)/);
  assert.match(renderer, /function renderAccounts\(\)[\s\S]*?renderAccountRoster\(\);\s*renderTopbarContext\(\);/);
  assert.match(renderer, /const positions = \(group\.allMembers \|\| group\.members\)\.length;[\s\S]*?_deviceStatus === 'online'/);
  assert.match(renderer, /account-card-last-active[\s\S]*?account-card-quota-summary[\s\S]*?quotaSummary\.replaceChildren\(quotaFact, quotaTrack\)/);
  assert.match(acceptance, /Array\.from\(\{ length: 5 \}/);
  assert.match(acceptance, /Agent card \$\{index \+ 1\} must remain 180px wide/);
  assert.match(acceptance, /smallRoster\.cards\.length, 2[\s\S]*?leave visible unused space instead of stretching/);
  assert.match(acceptance, /detailsChildrenInside[\s\S]*?detailsOrder/);
});

test('对象管理进 Dialog，会话列表顶栏右侧常驻复制、打开目录和导出', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');

  assert.match(html, /class="account-card-launch"[\s\S]*?class="account-card-manage"[^>]*aria-haspopup="dialog"[^>]*aria-controls="agentManageDialog"/);
  assert.match(html, /id="agentManageDialog"[\s\S]*?id="agentGlobalActions"[\s\S]*?id="editProfileBtn"[\s\S]*?id="manageAgentRelationsBtn"[\s\S]*?id="removeProfileBtn"[\s\S]*?id="yardManageActions"[\s\S]*?id="addRuntimeLocationBtn"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="profileFolderBtn"/);
  assert.doesNotMatch(html, /class="account-bar"/);
  assert.match(renderer, /function openAgentManageDialog\(\)[\s\S]*?renderAgentManageContext\(\)[\s\S]*?agentManageDialog\.showModal\(\)/);
  assert.match(html, /<details id="sessionDisplayMenu"[\s\S]*?id="sessionCompactBtn"[\s\S]*?id="sessionDetailBtn"/);
  const sessionPane = html.slice(html.indexOf('id="sessionPane"'), html.indexOf('id="detailPanel"'));
  assert.match(sessionPane, /session-toolbar-controls[\s\S]*?id="sessionActionDock"[\s\S]*?id="sessionSelectionBar"[^>]*hidden[\s\S]*?id="copySessionInfoBtn"[^>]*disabled[\s\S]*?id="openSessionFileBtn"[^>]*disabled[\s\S]*?id="exportSessionBtn"[^>]*disabled/);
  assert.doesNotMatch(sessionPane, /sendSessionInfoBtn|taskPackageActionBtn/);
  const footer = html.slice(html.indexOf('<footer id="statusBar"'), html.indexOf('</footer>'));
  assert.match(footer, /id="statusText"/);
  assert.doesNotMatch(footer, /ledgerDone|ledgerMin|reminderToggle/);
  assert.doesNotMatch(footer, /sessionSelectionBar|copySessionInfoBtn|sendSessionInfoBtn/);
  assert.doesNotMatch(html, /id="yardLedger"/);
  assert.match(renderer, /sessionSelectionBar\.hidden = count === 0/);
  assert.match(renderer, /openSessionFileBtn\.disabled = !count \|\| count !== folders/);
  assert.match(renderer, /exportSessionBtn\.disabled = !count \|\| count !== exportable/);
  assert.match(renderer, /clearSessionSelectionBtn\?\.addEventListener\('click'[\s\S]*?clearSessionActionSelection\(\)/);
  assert.match(renderer, /function clearSessionActionSelection\(\)[\s\S]*?UiContext\.clearConversationActions\(state\.ui\)/);
  assert.match(renderer, /function focusSession\(session\)[\s\S]*?UiContext\.focusConversation/);
  assert.match(renderer, /function setSessionChecked\(session, checked\)[\s\S]*?UiContext\.checkConversation/);
  assert.match(renderer, /querySelectorAll\('details\.context-menu\[open\]'\)/);
});

test('普通会话占满下半区，来源与多目录按需打开选择弹窗', () => {
  const html = read('src/index.html');
  const styles = read('src/workspace.css');
  assert.doesNotMatch(html, /id="sessionInspector"|id="sessionTechnicalDetails"/);
  assert.match(html, /<dialog id="sessionReplicaPicker"[\s\S]*?id="sessionReplicaOptions"/);
  assert.match(html, /<dialog id="sessionDirectoryDialog"[\s\S]*?id="sessionDirectoryOptions"/);
  assert.match(styles, /\[data-detail="session"\] > \.session-pane\s*\{ grid-column: 1 \/ -1/);
});

test('设备中心是独立模态弹窗，采用设备列表加所选详情且不改写底层工作台', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const styles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');

  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?state\.utilityDialog = kind[\s\S]*?dialog\.showModal\(\)/);
  assert.match(renderer, /\['devices', els\.deviceCenterBtn, els\.deviceCenterDialog\]/);
  assert.doesNotMatch(html, /id="detailSurfaceDevices"|data-detail-surface="devices"/);
  assert.doesNotMatch(renderer, /detailSurfaceDevices|deviceCenterDialog\.show\(\)/);
  assert.match(html, /class="device-center-layout"[\s\S]*?id="deviceList"[\s\S]*?id="deviceDetail"[\s\S]*?id="meshAgentList"/);
  assert.match(renderer, /ui:\s*window\.UiContext\.create\(\)/);
  assert.match(renderer, /state\.ui\.selectedDeviceDetailId/);
  assert.match(renderer, /UiContext\.selectDeviceDetail\(state\.ui/);
  assert.match(renderer, /for \(const \[kind, button, dialog\] of utilityDialogEntries\(\)\)[\s\S]*?addEventListener\('close'/);
  assert.match(renderer, /overview\.agents\.filter\(\(agent\) => overview\.slots\.some[\s\S]*?slot\.deviceId === selectedDevice\.deviceId/);
  assert.match(renderer, /const deviceBindingIds = new Set\(deviceSlots\.map[\s\S]*?deviceBindingIds\.has\(binding\.accountBindingId\)/);
  assert.match(renderer, /function viewDeviceSessions[\s\S]*?closeUtilityDialog\(els\.deviceCenterDialog\)[\s\S]*?UiContext\.viewDeviceSessions\(state\.ui, device\.deviceId\)[\s\S]*?setWorkspaceMode\('sessions'\)/);
  assert.match(renderer, /function viewDeviceAgentSessions[\s\S]*?UiContext\.viewDeviceAgentSessions\(state\.ui,[\s\S]*?agentId: agent\.agentId[\s\S]*?closeUtilityDialog\(els\.deviceCenterDialog\)[\s\S]*?setWorkspaceMode\('sessions'\)/);
  assert.match(workspaceStyles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(workspaceStyles, /\.device-center-content\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.device-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.account-actions button\.primary:disabled\s*\{[\s\S]*?background:\s*var\(--surface-sunken\)/);
});

test('1.14 全局弹窗统一固定 Shell，关闭不伪装主操作，次级流程保留父层', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const styles = read('src/workspace.css');
  const dialogSlice = (id) => {
    const start = html.indexOf(`id="${id}"`);
    return html.slice(start, html.indexOf('</dialog>', start));
  };

  for (const id of ['deviceCenterDialog', 'toolCenterDialog', 'activityCenterDialog', 'settingsDialog']) {
    const dialog = dialogSlice(id);
    assert.match(dialog, /aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    assert.match(dialog, /class="dialog-body utility-dialog-shell"/);
    assert.match(dialog, /utility-dialog-header[\s\S]*?utility-dialog-close[\s\S]*?utility-dialog-content/);
    assert.doesNotMatch(dialog, /data-i18n="dialog\.done"/);
  }

  assert.match(dialogSlice('deviceCenterDialog'), /utility-dialog-commandbar device-center-commandbar/);
  assert.match(dialogSlice('toolCenterDialog'), /utility-dialog-commandbar tool-center-commandbar[\s\S]*?utility-dialog-content tool-center-content[\s\S]*?utility-dialog-footer tool-center-footer/);
  assert.match(dialogSlice('activityCenterDialog'), /utility-dialog-commandbar activity-center-commandbar/);
  assert.doesNotMatch(dialogSlice('settingsDialog'), /utility-dialog-footer/);

  assert.match(styles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?height:\s*min\([\s\S]*?100dvh[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.utility-dialog-content\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.utility-dialog-header,[\s\S]*?\.utility-dialog-commandbar,[\s\S]*?\.utility-dialog-footer\s*\{[\s\S]*?flex:\s*none/);
  assert.doesNotMatch(styles, /\.device-center-dialog \.dialog-body(?:\.utility-dialog-shell)?\s*\{[^}]*min-height:\s*610px/);

  const helpHandler = renderer.slice(renderer.indexOf("els.helpBtn.addEventListener"), renderer.indexOf("els.activityCenterBtn", renderer.indexOf("els.helpBtn.addEventListener")));
  assert.match(helpHandler, /openChildDialog\(els\.welcomeDialog, els\.helpBtn\)/);
  assert.doesNotMatch(helpHandler, /closeUtilityDialog/);
  const transferHandler = renderer.slice(renderer.indexOf('async function openTransferCenter'), renderer.indexOf('async function chooseFilesForTransfer'));
  assert.match(transferHandler, /captureChildDialogReturnFocus\(returnFocus\)[\s\S]*?loadTransfers\(\)[\s\S]*?openChildDialog\(els\.transferCenterDialog, focusContext\)/);
  assert.doesNotMatch(transferHandler, /closeUtilityDialogs/);
  assert.match(renderer, /function openChildDialog\(dialog, trigger = document\.activeElement\)[\s\S]*?childDialogReturnFocus[\s\S]*?returnFocus\.focus/);
  assert.match(renderer, /disclosureWasOpen[\s\S]*?focusContext\.disclosure\.open = true/);
});

test('内嵌远控只保留紧凑设备工具条、画面和控制区，不重复产品品牌层', () => {
  const html = read('src/remote/console.html');
  const styles = read('src/remote/console.css');

  assert.doesNotMatch(html, /class="brand-lockup"|class="target-bar"/);
  assert.match(html, /class="console-head"[\s\S]*?id="backBtn"[\s\S]*?id="targetTabs"[\s\S]*?id="networkMetrics"[\s\S]*?id="streamBudget"[\s\S]*?id="layoutBtn"/);
  assert.match(html, /<main class="remote-stage">[\s\S]*?<footer id="controlDeck"/);
  assert.ok(
    styles.lastIndexOf('grid-template-rows: 48px minmax(0, 1fr) 62px') > styles.lastIndexOf('grid-template-rows: 62px 54px minmax(0, 1fr) 82px'),
    'the final remote layout must override the retired four-row shell'
  );
});
