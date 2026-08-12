const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('批准后的全局层级：顶栏只常驻设备语境，低频入口归入更多，视图切换归 Presenter', () => {
  const html = read('src/index.html');
  const settings = read('src/settings.js');
  const topbar = html.slice(
    html.indexOf('<header class="app-topbar">'),
    html.indexOf('</header>', html.indexOf('<header class="app-topbar">'))
  );
  const more = topbar.slice(topbar.indexOf('id="globalMoreMenu"'));

  assert.match(topbar, /id="deviceLensSelect"[\s\S]*?id="deviceCenterBtn"[\s\S]*?id="globalMoreMenu"/);
  for (const id of ['leaderboardBtn', 'updateBtn', 'toolCenterBtn', 'helpBtn', 'langToggle', 'themeToggle']) {
    assert.ok(more.includes(`id="${id}"`), `${id} must stay inside the global More menu`);
  }
  assert.doesNotMatch(topbar, /id="viewToggle"/);
  assert.match(html, /class="presenter-head"[\s\S]*?id="presenterCount"[\s\S]*?id="viewToggle"/);
  assert.match(read('src/styles.css'), /\.presenter > \.yard-stage,[\s\S]*?\.presenter > \.account-roster\s*\{[\s\S]*?grid-row:\s*2/);
  assert.match(settings, /view:\s*'classic'/);
});

test('批准后的 Agent 与会话操作层级：日常动作常驻，管理和显示折叠，选择后才出现复制与发送', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');

  assert.match(html, /id="launchBtn"[\s\S]*?id="addProfileBtn"[\s\S]*?<details id="accountManage"/);
  assert.match(html, /id="accountManage"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="editProfileBtn"[\s\S]*?id="removeProfileBtn"[\s\S]*?id="profileFolderBtn"/);
  assert.match(html, /<details id="sessionDisplayMenu"[\s\S]*?id="sessionCompactBtn"[\s\S]*?id="sessionDetailBtn"/);
  assert.match(html, /id="sessionSelectionBar"[^>]*hidden[\s\S]*?id="clearSessionSelectionBtn"[\s\S]*?id="copySessionInfoBtn"[\s\S]*?id="sendSessionInfoBtn"/);
  assert.match(renderer, /sessionSelectionBar\.hidden = count === 0/);
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
  assert.match(actions, /id="openSessionFileBtn"[\s\S]*?<details id="inspectorMoreMenu"[\s\S]*?id="exportSessionBtn"/);
});

test('设备中心在第六行采用设备列表加所选详情，只列所选设备上的全局 Agent', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const styles = read('src/styles.css');

  assert.match(renderer, /mainGrid\.append\(els\.deviceCenterDialog\)/);
  assert.match(renderer, /next === 'devices'[\s\S]*?deviceCenterDialog\.show\(\)/);
  assert.match(html, /class="device-center-layout"[\s\S]*?id="deviceList"[\s\S]*?id="deviceDetail"[\s\S]*?id="meshAgentList"/);
  assert.match(renderer, /ui:\s*window\.UiContext\.create\(\)/);
  assert.match(renderer, /state\.ui\.selectedDeviceDetailId/);
  assert.match(renderer, /UiContext\.selectDeviceDetail\(state\.ui/);
  assert.match(renderer, /deviceCenterDialog\?\.addEventListener\('close'[\s\S]*?if \(els\.deviceCenterDialog\.open\) return/);
  assert.match(renderer, /overview\.agents\.filter\(\(agent\) => overview\.slots\.some[\s\S]*?slot\.deviceId === selectedDevice\.deviceId/);
  assert.match(renderer, /const deviceBindingIds = new Set\(deviceSlots\.map[\s\S]*?deviceBindingIds\.has\(binding\.accountBindingId\)/);
  assert.match(renderer, /function viewDeviceSessions[\s\S]*?UiContext\.viewDeviceSessions\(state\.ui, device\.deviceId\)[\s\S]*?setWorkspaceMode\('sessions'\)/);
  assert.match(renderer, /function viewDeviceAgentSessions[\s\S]*?UiContext\.viewDeviceAgentSessions\(state\.ui,[\s\S]*?agentId: agent\.agentId[\s\S]*?setWorkspaceMode\('sessions'\)/);
  assert.match(styles, /\.device-center-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px, 0\.78fr\) minmax\(0, 1\.72fr\)/);
  assert.match(styles, /\.account-actions button\.primary:disabled\s*\{[\s\S]*?background:\s*var\(--surface-sunken\)/);
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
