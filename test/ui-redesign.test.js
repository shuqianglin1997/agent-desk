const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { rendererSource } = require('./helpers/renderer-source');

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
  // 顶栏只回答“在哪看”和“有什么要处理”：设备管理并进设备视角下拉，工具与设置在“系统”这一页里。
  assert.match(topbar, /id="deviceLensSelect"[\s\S]*?id="deviceLensMenu"[\s\S]*?id="deviceCenterBtn"[\s\S]*?id="activityCenterBtn"[\s\S]*?id="systemBtn"[^>]*aria-controls="systemDialog"/);
  assert.doesNotMatch(topbar, /id="systemMenu"|id="toolCenterBtn"|id="settingsBtn"/);
  const nav = topbar.slice(topbar.indexOf('<nav class="topbar-actions"'));
  assert.doesNotMatch(nav, /id="deviceCenterBtn"|id="windowAddMenu"/);
  assert.doesNotMatch(topbar, /globalMoreMenu|topbar\.more/);
  for (const id of ['updateBtn', 'helpBtn', 'langToggle', 'themeToggle']) {
    assert.doesNotMatch(topbar, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`id="systemDialog"[\\s\\S]*?id="systemSettings"[\\s\\S]*?id="${id}"`));
  }
  for (const [button, dialog] of [
    ['deviceCenterBtn', 'deviceCenterDialog'],
    ['systemBtn', 'systemDialog'],
    ['activityCenterBtn', 'activityCenterDialog']
  ]) {
    assert.match(topbar, new RegExp(`id="${button}"[^>]*aria-haspopup="dialog"[^>]*aria-controls="${dialog}"[^>]*aria-expanded="false"`));
  }
  assert.match(topbar, /<span class="topbar-brand" aria-label="AgentDesk">Agent<i>Desk<\/i><\/span>/);
  assert.doesNotMatch(topbar, /brand-mark|agent-view-segment|viewToggle|classicViewBtn/);
  assert.match(workspaceStyles, /--lens-width: 216px;[\s\S]*?50vw - 25px/);
  const presenter = html.slice(html.indexOf('class="presenter-head"'), html.indexOf('<section class="presenter">'));
  assert.match(presenter, /id="presenterCount"/);
  // 添加账号只有一个入口：Agent 标题行的“招募”，直接打开招募弹窗，不在顶栏。
  assert.match(presenter, /id="addProfileBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="recruitDialog"/);
  assert.doesNotMatch(presenter, /id="windowAddMenu"|id="codexImportBtn"/);
  assert.doesNotMatch(presenter, /id="viewToggle"/);
  assert.doesNotMatch(html, /class="agent-panel-body"/);
  assert.match(workspaceStyles, /\.app-topbar\s*\{\s*-webkit-app-region: drag/);
  assert.match(workspaceStyles, /\.app-topbar :is\(button, select, summary, a, \.context-menu-panel\)\s*\{\s*-webkit-app-region: no-drag/);
  assert.match(workspaceStyles, /env\(titlebar-area-width, 100%\)/);
  assert.match(presenter, /id="quotaChipAll"[^>]*aria-controls="quotaPopover"/);
  // The yard/classic view choice is retired (settings version 5 keeps it under `retired`).
  assert.equal(Object.hasOwn(require('../src/settings').normalizeSettings({}), 'view'), false);
});

test('卡片工作台不加载旧庭院并保留共用像素头像', () => {
  const legacyStyles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');
  const renderer = rendererSource();

  assert.match(legacyStyles, /^@layer legacy, reset, tokens, shell, components, features, themes;/);
  const html = read('src/index.html');
  assert.doesNotMatch(html, /yardStage|yardCanvas|yard\/(?:scene\.js|yard\.css)/);
  assert.doesNotMatch(renderer, /YardScene|applyView|state\.view =/);
  assert.match(html, /yard\/sprites\.js/);
  assert.match(renderer, /PixelUi\?\.setCat\(card\.querySelector\('\.account-card-avatar'\)/);
  assert.match(read('src/pixel/ui.js'), /PixelCats[\s\S]*?Cats\.show\(canvas/);
  assert.doesNotMatch(renderer, /function drawAccountAvatar/);
  assert.match(workspaceStyles, /@layer themes\s*\{\s*\[hidden\]\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(workspaceStyles, /\.session-table tbody tr(?::|\.)[^\{]*::(?:before|after)/);
});

test('卡片名册使用固定宽度与可信摘要，并用真实窗口验收覆盖少量卡和 7+ Agent', () => {
  const workspaceStyles = read('src/workspace.css');
  const renderer = rendererSource();
  const quotaOverview = read('src/quota-overview.js');
  const identityGroups = read('src/identity-groups.js');
  const acceptance = read('scripts/ui-acceptance.js');

  assert.match(workspaceStyles, /\.agent-panel \.account-roster \{[\s\S]*?grid-auto-columns:\s*180px;[\s\S]*?justify-content:\s*start;/);
  // Overflow, scroll padding and gutter come from the pixel skin's rule for the
  // same selector (unlayered, so it always wins over workspace.css's layers).
  assert.match(read('src/pixel.css'), /\.agent-panel \.account-roster \{[\s\S]*?overflow-x:\s*auto;[\s\S]*?\}/);
  assert.match(workspaceStyles, /\.agent-panel \.account-card \{\s*display:\s*grid;[\s\S]*?grid-template-rows:/);
  // 卡片里已经没有的包裹层，样式也一并清掉了。
  assert.doesNotMatch(workspaceStyles, /\.account-card-details|\.account-card-top|\.account-card-meta|\.agent-panel-body/);
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
  assert.match(renderer, /const slots = group\.allMembers \|\| group\.members;[\s\S]*?_deviceStatus === 'online'/);
  // 状态只说一次：最近活跃和位置数进提示文字，卡片上只留五格额度。
  assert.match(renderer, /card\.lastActive[\s\S]*?presenter\.positions[\s\S]*?selectAgentButton\.title =/);
  assert.match(renderer, /account-card-quota-summary[\s\S]*?quotaSummary\.replaceChildren\(quotaTrack, quotaValue\)/);
  assert.doesNotMatch(read('src/index.html'), /account-card-last-active|class="account-card-details"/);
  const pixelStyles = read('src/pixel.css');
  assert.match(pixelStyles, /\.agent-panel \.account-card,\s*\.agent-panel \.account-card\.selected \{[\s\S]*?width:\s*180px;/);
  assert.match(pixelStyles, /\.agent-panel \.account-roster \{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(acceptance, /Array\.from\(\{ length: 5 \}/);
  assert.match(acceptance, /Agent card \$\{index \+ 1\} must remain 180px wide/);
  assert.match(acceptance, /smallRoster\.cards\.length, 2[\s\S]*?leave visible unused space instead of stretching/);
  // 真实窗口验收按新卡片结构检查：文字与控件留在卡内、自上而下不重叠、能量格在按钮内。
  assert.match(acceptance, /selectChildrenInside[\s\S]*?verticalOrder[\s\S]*?quotaInside/);
  assert.doesNotMatch(acceptance, /account-card-details|account-card-last-active|sessionScopeCurrentBtn/);
});

test('对象管理进 Dialog，会话列表顶栏右侧常驻复制、打开目录、导出和送出', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();

  assert.match(html, /class="account-card-launch"[\s\S]*?class="account-card-manage"[^>]*aria-haspopup="dialog"[^>]*aria-controls="agentManageDialog"/);
  // 猫的档案一页四段：资料、位置、账号、送走；位置下面是那个位置自己的动作。
  assert.match(html, /id="agentManageDialog"[\s\S]*?data-section="profile"[\s\S]*?id="editProfileBtn"[\s\S]*?data-section="locations"[\s\S]*?id="agentManageLocations"[\s\S]*?id="yardManageActions"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="profileFolderBtn"[\s\S]*?id="addRuntimeLocationBtn"[\s\S]*?data-section="accounts"[\s\S]*?id="manageAgentRelationsBtn"[\s\S]*?data-section="farewell"[\s\S]*?id="removeProfileBtn"/);
  assert.match(renderer, /function renderAgentManageLocations\(group, profile\)[\s\S]*?selectSlot\(member\.id\)[\s\S]*?row\.after\(actions\)/);
  assert.doesNotMatch(html, /class="account-bar"/);
  assert.match(renderer, /function openAgentManageDialog\(\)[\s\S]*?renderAgentManageContext\(\)[\s\S]*?openDialog\(els\.agentManageDialog\)/);
  assert.match(html, /<details id="sessionDisplayMenu"[\s\S]*?id="sessionCompactBtn"[\s\S]*?id="sessionDetailBtn"/);
  const sessionPane = html.slice(html.indexOf('id="sessionPane"'), html.indexOf('id="detailPanel"'));
  assert.match(sessionPane, /session-toolbar-controls[\s\S]*?id="sessionActionDock"[\s\S]*?id="sessionSelectionBar"[^>]*hidden[\s\S]*?id="copySessionInfoBtn"[^>]*disabled[\s\S]*?id="openSessionFileBtn"[^>]*disabled[\s\S]*?id="exportSessionBtn"[^>]*disabled/);
  // 对会话的操作都在会话这边：发送到设备与交接任务收在“送出”里。
  assert.match(sessionPane, /id="exportSessionBtn"[\s\S]*?id="sessionSendMenu"[\s\S]*?id="sendSessionInfoBtn"[^>]*disabled[\s\S]*?id="taskPackageActionBtn"[^>]*disabled/);
  assert.doesNotMatch(sessionPane, /sessionScopeCurrentBtn|sessionScopeAllBtn/);
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
  const renderer = rendererSource();
  const styles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');

  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?state\.utilityDialog = kind[\s\S]*?openDialog\(dialog\)/);
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
  assert.doesNotMatch(styles, /\.account-actions/);
});

test('1.14 全局弹窗统一固定 Shell，关闭不伪装主操作，次级流程保留父层', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  const styles = read('src/workspace.css');
  const dialogSlice = (id) => {
    const start = html.indexOf(`id="${id}"`);
    return html.slice(start, html.indexOf('</dialog>', start));
  };

  for (const id of ['deviceCenterDialog', 'systemDialog', 'activityCenterDialog', 'agentManageDialog']) {
    const dialog = dialogSlice(id);
    assert.match(dialog, /aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    assert.match(dialog, /class="dialog-body utility-dialog-shell"/);
    assert.match(dialog, /utility-dialog-header[\s\S]*?utility-dialog-close[\s\S]*?utility-dialog-content/);
    assert.doesNotMatch(dialog, /data-i18n="dialog\.done"/);
  }

  assert.match(dialogSlice('deviceCenterDialog'), /utility-dialog-commandbar device-center-commandbar/);
  // 系统页把工具和设置放在同一个内容区的两栏里；收件箱没有命令条，三段都在内容区。
  assert.match(dialogSlice('systemDialog'), /utility-dialog-content system-dialog-content[\s\S]*?id="systemTools"[\s\S]*?id="checkToolsBtn"[\s\S]*?id="systemSettings"[\s\S]*?id="themeToggle"[\s\S]*?id="langToggle"[\s\S]*?id="profileQuitBehavior"[\s\S]*?id="updateBtn"[\s\S]*?id="helpBtn"[\s\S]*?utility-dialog-footer tool-center-footer/);
  assert.doesNotMatch(dialogSlice('activityCenterDialog'), /utility-dialog-commandbar/);
  assert.doesNotMatch(html, /id="toolCenterDialog"|id="settingsDialog"/);

  // 弹窗跟着内容长高，只用窗口高度封顶；不再有逼出滚动条或留白的固定高度。
  assert.match(styles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*calc\(100dvh[\s\S]*?overflow:\s*hidden/);
  assert.doesNotMatch(styles, /--dialog-preferred-height/);
  assert.match(styles, /\.utility-dialog-content\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.utility-dialog-header,[\s\S]*?\.utility-dialog-commandbar,[\s\S]*?\.utility-dialog-footer\s*\{[\s\S]*?flex:\s*none/);
  assert.doesNotMatch(styles, /\.device-center-dialog \.dialog-body(?:\.utility-dialog-shell)?\s*\{[^}]*min-height:\s*610px/);

  const helpHandler = renderer.slice(renderer.indexOf("els.helpBtn.addEventListener"), renderer.indexOf("els.activityCenterBtn", renderer.indexOf("els.helpBtn.addEventListener")));
  assert.match(helpHandler, /openChildDialog\(els\.welcomeDialog, els\.helpBtn\)/);
  assert.doesNotMatch(helpHandler, /closeUtilityDialog/);
  const transferHandler = renderer.slice(renderer.indexOf('async function openTransferCenter'), renderer.indexOf('async function chooseFilesForTransfer'));
  // 传输记录是收件箱里的一段：打开收件箱、读最新记录、把那一段滚到眼前。
  assert.match(transferHandler, /openUtilityDialog\('activity'\)[\s\S]*?loadTransfers\(\)[\s\S]*?inboxRecords\?\.scrollIntoView/);
  assert.doesNotMatch(transferHandler, /openChildDialog/);
  assert.match(renderer, /function openChildDialog\(dialog, trigger = document\.activeElement\)[\s\S]*?childDialogReturnFocus[\s\S]*?utilityDialogFocusTarget\(returnFocus\)\.focus/);
  assert.match(renderer, /disclosureWasOpen[\s\S]*?focusContext\.disclosure\.open = true/);
  // 触发控件所在的菜单在返回时重新展开；它已经收起且没有记录时，焦点退回菜单开关。
  assert.match(renderer, /const disclosure = trigger\.closest\('details'\);/);
  assert.match(renderer, /function utilityDialogFocusTarget\(button\) \{[\s\S]*?closest\('details\.context-menu'\)[\s\S]*?menu\.querySelector\('summary'\)/);
  assert.match(renderer, /if \(!document\.querySelector\('dialog:modal'\)\) utilityDialogFocusTarget\(returnFocus\)\?\.focus/);
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
