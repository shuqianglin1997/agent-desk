const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('1.13 全局层级：Header 四个入口各开独立弹窗，视图与排行归顶部 Agent 面板', () => {
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
  assert.doesNotMatch(topbar, /id="viewToggle"/);
  assert.match(html, /id="agentPanel"[\s\S]*?class="presenter-head"[\s\S]*?id="presenterCount"[\s\S]*?id="leaderboardBtn"[\s\S]*?class="agent-view-segment"[\s\S]*?id="viewToggle"[\s\S]*?id="classicViewBtn"/);
  assert.match(workspaceStyles, /\.agent-panel-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 314px/);
  assert.match(settings, /view:\s*'classic'/);
});

test('1.13 CSS 层级与庭院呈现：旧皮肤降层，名牌不膨胀，持久告警只进活动弹窗', () => {
  const legacyStyles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');
  const renderer = read('src/renderer.js');

  assert.match(legacyStyles, /^@layer legacy, reset, tokens, shell, components, features, themes;/);
  assert.match(workspaceStyles, /@layer features\s*\{[\s\S]*?#yardOverlay \.yard-nameplate\s*\{[\s\S]*?max-width:\s*94px;[\s\S]*?height:\s*18px;/);
  assert.match(workspaceStyles, /#yardOverlay \.yard-speech\s*\{[\s\S]*?max-width:\s*116px;[\s\S]*?min-height:\s*18px;/);
  assert.match(workspaceStyles, /@layer themes\s*\{\s*\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(renderer, /attentionById:\s*\{\},[\s\S]*?selectedId:/);
  assert.doesNotMatch(renderer, /attentionById\[[^\]]+\]\s*=/);
  assert.doesNotMatch(workspaceStyles, /\.session-table tbody tr(?::|\.)[^\{]*::(?:before|after)/);
});

test('卡片名册使用固定宽度与可信摘要，并用真实窗口验收覆盖少量卡和 7+ Agent', () => {
  const workspaceStyles = read('src/workspace.css');
  const renderer = read('src/renderer.js');
  const quotaOverview = read('src/quota-overview.js');
  const identityGroups = read('src/identity-groups.js');
  const acceptance = read('scripts/ui-acceptance.js');

  assert.match(workspaceStyles, /body\[data-view="classic"\] \.agent-panel \.account-roster \{[\s\S]*?grid-auto-columns:\s*164px;[\s\S]*?justify-content:\s*start;[\s\S]*?overflow-x:\s*auto;[\s\S]*?scroll-padding-inline:\s*10px;[\s\S]*?scrollbar-gutter:\s*stable;/);
  assert.match(workspaceStyles, /body\[data-view="classic"\] \.agent-panel \.account-card \{[\s\S]*?display:\s*grid;[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*normal;/);
  assert.match(workspaceStyles, /\.account-card-details \{[\s\S]*?align-self:\s*end;[\s\S]*?border-top:/);
  assert.match(renderer, /function revealSelectedAccountCard\(\)[\s\S]*?scrollPaddingInlineStart[\s\S]*?scrollLeft = Math\.min/);
  assert.match(quotaOverview, /function activeCardWindows\(snapshot, now\)[\s\S]*?resetsAt > now/);
  assert.match(quotaOverview, /function quotaWindowsConflict\(left, right\)[\s\S]*?leftWindows\.length !== rightWindows\.length/);
  assert.match(quotaOverview, /function selectTrustedAccountQuota\(group, quotasById[\s\S]*?options\.quotaError[\s\S]*?_remote !== true[\s\S]*?TRUSTED_SOURCES[\s\S]*?quotaWindowsConflict[\s\S]*?status: 'conflict'/);
  assert.match(identityGroups, /function cardActivityEvidence[\s\S]*?remoteUnknown[\s\S]*?function resolveCardActivityState/);
  assert.match(renderer, /const activityEvidence = window\.IdentityGroups[\s\S]*?resolveCardActivityState[\s\S]*?tr\('card\.activityUnknown'\)/);
  assert.match(renderer, /setInterval\(\(\) => \{\s*if \(!document\.hidden\) loadActivity\(\);/);
  assert.match(renderer, /visibilitychange[\s\S]*?if \(document\.hidden\) return;\s*loadActivity\(\);/);
  assert.match(renderer, /function syncYard\(\)[\s\S]*?\}\s*renderAccountRoster\(\);\s*renderTopbarContext\(\);/);
  assert.match(renderer, /const positions = \(group\.allMembers \|\| group\.members\)\.length;[\s\S]*?_deviceStatus === 'online'/);
  assert.match(renderer, /account-card-last-active[\s\S]*?account-card-quota-summary[\s\S]*?details\.append\(lastActive, quotaSummary, quotaTrack\)/);
  assert.match(acceptance, /Array\.from\(\{ length: 5 \}/);
  assert.match(acceptance, /Agent card \$\{index \+ 1\} must remain 164px wide/);
  assert.match(acceptance, /smallRoster\.cards\.length, 2[\s\S]*?leave visible unused space instead of stretching/);
  assert.match(acceptance, /detailsChildrenInside[\s\S]*?detailsOrder/);
});

test('批准后的 Agent 与会话操作层级：主动作常驻，对象管理进 Dialog，选择后才出现复制与发送', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');

  assert.match(html, /id="launchBtn"[\s\S]*?id="addProfileBtn"[\s\S]*?id="accountManage"[^>]*aria-haspopup="dialog"[^>]*aria-controls="agentManageDialog"/);
  assert.match(html, /id="agentManageDialog"[\s\S]*?id="agentGlobalActions"[\s\S]*?id="editProfileBtn"[\s\S]*?id="manageAgentRelationsBtn"[\s\S]*?id="removeProfileBtn"[\s\S]*?id="yardManageActions"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="profileFolderBtn"/);
  assert.doesNotMatch(html, /<details id="accountManage"/);
  assert.match(renderer, /function openAgentManageDialog\(\)[\s\S]*?renderAgentManageContext\(\)[\s\S]*?agentManageDialog\.showModal\(\)/);
  assert.match(html, /id="atmosSceneBtn"[^>]*popovertarget="atmosPopover"[\s\S]*?id="atmosPopover"[^>]*popover="auto"/);
  assert.match(html, /<details id="sessionDisplayMenu"[\s\S]*?id="sessionCompactBtn"[\s\S]*?id="sessionDetailBtn"/);
  assert.match(html, /id="sessionInspector"[\s\S]*?id="sessionActionDock"[^>]*hidden[\s\S]*?id="sessionSelectionBar"[^>]*hidden[\s\S]*?id="clearSessionSelectionBtn"[\s\S]*?id="copySessionInfoBtn"[\s\S]*?id="sendSessionInfoBtn"[\s\S]*?id="sessionFocusedActions"[^>]*hidden[\s\S]*?id="openSessionFileBtn"[\s\S]*?id="exportSessionBtn"/);
  const sessionPane = html.slice(html.indexOf('id="sessionPane"'), html.indexOf('id="detailPanel"'));
  assert.doesNotMatch(sessionPane, /id="sessionSelectionBar"/);
  const footer = html.slice(html.indexOf('<footer id="statusBar"'), html.indexOf('</footer>'));
  assert.match(footer, /id="ledgerDone"[\s\S]*?id="ledgerMin"[\s\S]*?id="reminderToggle"/);
  assert.doesNotMatch(footer, /sessionSelectionBar|copySessionInfoBtn|sendSessionInfoBtn/);
  assert.doesNotMatch(html, /id="yardLedger"/);
  assert.match(renderer, /sessionActionDock\.hidden = count === 0/);
  assert.match(renderer, /sessionSelectionBar\.hidden = count === 0/);
  assert.match(renderer, /sessionFocusedActions\.hidden = count === 0 \|\| hasExplicitChecks \|\| !selectedSession\(\)/);
  assert.match(renderer, /clearSessionSelectionBtn\?\.addEventListener\('click'[\s\S]*?clearSessionActionSelection\(\)/);
  assert.match(renderer, /function clearSessionActionSelection\(\)[\s\S]*?UiContext\.clearConversationActions\(state\.ui\)/);
  assert.match(renderer, /function focusSession\(session\)[\s\S]*?UiContext\.focusConversation/);
  assert.match(renderer, /function setSessionChecked\(session, checked\)[\s\S]*?UiContext\.checkConversation/);
  assert.match(renderer, /querySelectorAll\('details\.context-menu\[open\]'\)/);
});

test('会话详情先给 Agent、位置、项目与活跃时间，来源与稳定坐标留在折叠技术信息', () => {
  const html = read('src/index.html');
  const primaryStart = html.indexOf('class="inspector-primary-fields"');
  const technicalStart = html.indexOf('id="sessionTechnicalDetails"');
  const actionsStart = html.indexOf('class="inspector-actions"');
  const primary = html.slice(primaryStart, technicalStart);
  const technical = html.slice(technicalStart, actionsStart);
  const actions = html.slice(actionsStart, html.indexOf('</aside>', actionsStart));

  assert.match(primary, /id="detailAccount"[\s\S]*?id="detailLocation"[\s\S]*?id="detailProject"[\s\S]*?id="detailUpdated"/);
  assert.doesNotMatch(primary, /id="detailSource"|id="detailCoordinate"|id="detailCreated"/);
  assert.match(technical, /id="detailCreated"[\s\S]*?id="detailSource"[\s\S]*?id="detailCoordinate"/);
  assert.match(actions, /id="openSessionFileBtn"[\s\S]*?id="exportSessionBtn"/);
  assert.doesNotMatch(actions, /inspectorMoreMenu|common\.more/);
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
