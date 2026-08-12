const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('更新按钮归入独立设置弹窗，Header 只保留四个直接入口', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const toolbarStart = html.indexOf('<nav class="topbar-actions"');
  const toolbarEnd = html.indexOf('</nav>', toolbarStart);
  const settingsStart = html.indexOf('id="settingsDialog"');
  const settingsEnd = html.indexOf('</dialog>', settingsStart);
  const updateButton = html.indexOf('id="updateBtn"');

  assert.notEqual(toolbarStart, -1);
  assert.notEqual(toolbarEnd, -1);
  assert.match(html.slice(toolbarStart, toolbarEnd), /id="deviceCenterBtn"[\s\S]*?id="toolCenterBtn"[\s\S]*?id="activityCenterBtn"[\s\S]*?id="settingsBtn"/);
  assert.doesNotMatch(html.slice(toolbarStart, toolbarEnd), /id="updateBtn"|globalMoreMenu/);
  assert.ok(updateButton > settingsStart && updateButton < settingsEnd);
});

test('1.13 固定骨架：一个 Header、一个 Footer 与顶部 Agent/左下会话/右下详情三个面板', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 旧侧栏和七行信息轨移除；主区只保留三个固定面板。
  assert.doesNotMatch(html, /class="sidebar"/);
  assert.match(html, /<header class="app-topbar">[\s\S]*?<main id="mainGrid" class="workspace-board"[\s\S]*?id="agentPanel" class="workspace-panel agent-panel"[\s\S]*?id="sessionPane" class="workspace-panel session-pane"[\s\S]*?id="detailPanel" class="workspace-panel detail-panel"[\s\S]*?<footer id="statusBar"/);
  const board = html.slice(html.indexOf('<main id="mainGrid"'), html.indexOf('</main>'));
  assert.equal((board.match(/class="workspace-panel /g) || []).length, 3);
  assert.match(html, /id="agentPanel"[\s\S]*?<section class="presenter">[\s\S]*?id="yardStage"[\s\S]*?id="accountRoster"[\s\S]*?class="account-bar"/);
  assert.match(styles, /--header-h:\s*58px;[\s\S]*?--footer-h:\s*38px;[\s\S]*?--agent-h:\s*244px;[\s\S]*?--detail-w:\s*316px/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*?grid-template:\s*var\(--header-h\) minmax\(0, 1fr\) var\(--footer-h\) \/ minmax\(0, 1fr\)/);
  assert.match(styles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-w\);[\s\S]*?grid-template-rows:\s*var\(--agent-h\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.workspace-board \.table-wrap\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(styles, /\.session-table\[data-mode="compact"\]\s*\{\s*min-width:\s*0/);
  // 经典视图显示账号名册（庭院视图隐藏、由场景呈现）
  assert.match(styles, /body\[data-view="classic"\] \.agent-panel \.account-roster \{[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] \.workspace-board \{\s*display: contents/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] \.status-bar \{[^}]*grid-row:\s*3/);
});

test('庭院会话表保持真表格（选择列 + 标题/活跃/项目/来源，「新建」进详情），表格为唯一滚动区', () => {
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 不再藏表头、不再把 tbody/行改成卡片网格、不再逐列 nth-child 隐藏
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] thead \{\s*display:\s*none/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] tbody \{\s*display:\s*grid/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] tbody td:nth-child/);
  // 表格是唯一滚动区（去掉 380px 硬顶，改由弹性行约束）
  assert.match(yardStyles, /body\[data-view="yard"\] \.table-wrap \{[^}]*max-height:\s*none/);
});

test('会话浏览支持只用于明确定位动作的轻量选择，复制主操作突出且不恢复交接编排', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(html, /id="sessionScopeCurrentBtn"[\s\S]*?id="sessionScopeAllBtn"/);
  // 全 Agent 扫描仍给每条会话保留真实槽位和账号组，供浏览与定位操作使用。
  assert.match(renderer, /state\.ui\.agentScope === 'all'[\s\S]*?identityGroups\(\)/);
  assert.match(renderer, /_profileId:\s*member\.id/);
  assert.match(renderer, /_accountKey:\s*accountKey/);
  assert.match(html, /id="copySessionInfoBtn" class="session-copy-info primary"[^>]*data-i18n="session\.copyInfo">复制会话信息<\/button>/);
  assert.match(styles, /\.session-copy-info \{[\s\S]*?min-width:\s*148px;[\s\S]*?height:\s*36px;[\s\S]*?background:\s*var\(--accent\)/);
  assert.match(styles, /\.session-copy-info::before \{[\s\S]*?content:\s*"⧉"/);
  assert.doesNotMatch(html, /copySessionLocationBtn|session-copy-location/);
  assert.ok(html.indexOf('./session-location.js') < html.indexOf('./renderer.js'));
  assert.match(renderer, /ui:\s*window\.UiContext\.create\(\)/);
  assert.match(renderer, /state\.ui\.checkedConversationIds/);
  assert.match(renderer, /state\.ui\.focusedConversationId/);
  assert.match(renderer, /function setSessionChecked\(session, checked\)[\s\S]*?UiContext\.checkConversation/);
  assert.match(renderer, /function focusSession\(session\)[\s\S]*?UiContext\.focusConversation/);
  assert.match(renderer, /UiContext\.actionConversationIds\(state\.ui\)/);
  assert.match(renderer, /selectAll\.id = 'sessionSelectAll'/);
  assert.match(renderer, /window\.SessionLocation\.format\(sessions/);
  assert.doesNotMatch(html, /handoffBulkBar|copySelectedHandoffBtn|handoffPlan/);
  assert.doesNotMatch(renderer, /handoffSelection|moveHandoffSelection|makeHandoffPlanText/);
  assert.doesNotMatch(styles, /handoff-plan|handoff-selected/);
});

test('会话复制收敛成路径加坐标，详情不再放重复复制按钮或重复 ID 字段', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(html, /id="detailProject"[\s\S]*?id="detailCoordinate"[\s\S]*?id="openSessionFileBtn"[\s\S]*?id="exportSessionBtn"/);
  assert.doesNotMatch(html, /copyAddressBtn|copyProjectBtn|detailAddress|detailFile|detailId/);
  assert.match(renderer, /SessionLocation\.pathOf\(session\)/);
  assert.match(renderer, /SessionLocation\.coordinateOf\(session\)/);
  assert.doesNotMatch(html, /artifactIndex|artifactSummary|refreshArtifactsBtn|artifactList|copyHandoffBtn/);
  assert.doesNotMatch(renderer, /listSessionArtifacts|renderArtifactIndex|makeHandoffArtifactText|prepareHandoffArtifacts/);
  assert.doesNotMatch(styles, /artifact-index/);
  assert.match(styles, /\.inspector \{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.inspector-body \{[\s\S]*?grid-row:\s*2/);
  assert.match(styles, /\.inspector-actions \{[\s\S]*?grid-row:\s*3/);
});

test('会话详细列表提供完整属性列，精简/详细切换且每个表头可点击排序', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');

  assert.match(html, /id="sessionCompactBtn"[\s\S]*?id="sessionDetailBtn"/);
  for (const key of ['title', 'account', 'app', 'createdAt', 'updatedAt', 'project', 'source', 'status', 'model', 'id']) {
    assert.ok(renderer.includes(`key: '${key}'`), `detail column ${key} missing`);
  }
  assert.match(renderer, /className = 'sort-button'/);
  assert.match(renderer, /state\.sessionSort = \{ key: column\.key, direction \}/);
  assert.match(renderer, /window\.SessionTable\.sort\(filtered, state\.sessionSort/);
  assert.match(settings, /SESSION_SCOPES = new Set\(\['current', 'all'\]\)/);
  assert.match(settings, /SESSION_VIEWS = new Set\(\['compact', 'detail'\]\)/);
});

test('猫猫庭院场景：满铺横带 + 裁掉底部空草坪（定高木框 overflow:hidden + 裁剪台）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  // 木框是定高横带、溢出裁剪（裁掉底部空草坪，满铺无左右空白）
  assert.match(yardStyles, /\.yard-frame \{[\s\S]*?height:\s*300px;[\s\S]*?overflow:\s*hidden/);
  // 裁剪台 .yard-scene：画布按自然宽高比铺满整宽（比横带高），底部被裁
  assert.match(yardStyles, /\.yard-scene \{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*100%/);
  assert.match(yardStyles, /\.yard-frame canvas \{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto/);
  // index.html：画布放进裁剪台
  assert.match(html, /<div class="yard-scene">\s*<canvas id="yardCanvas"/);
  // 场景回固定尺寸：renderer 不再有响应式 ResizeObserver（回退改动①）
  assert.doesNotMatch(renderer, /new ResizeObserver\(fitYardWidth\)/);
});

test('经典视图切换后庭院画布必须隐藏：[hidden] 要压过 display:grid', () => {
  const yardCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 作者的 display:grid 会盖过 UA 的 [hidden]。缺这条兜底时，
  // 切到经典视图后 .yard-stage 仍占第一行，把整个工作台挤出屏幕（实测 computed
  // display 从 none 退回 grid）。选择器特指度 (0,2,0) 高于 .yard-stage (0,1,0)。
  assert.match(yardCss, /\.yard-stage\[hidden\]\s*\{\s*display:\s*none/);
});

test('右下只留会话、额度与远控；活动独立弹窗，Footer 只保留全局陪伴状态', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const detail = html.slice(html.indexOf('id="detailPanel"'), html.indexOf('</main>'));
  const footer = html.slice(html.indexOf('<footer id="statusBar"'), html.indexOf('</footer>'));
  assert.doesNotMatch(detail, /detailSurfaceDevices|detailSurfaceTools|detailSurfaceActivity|detailSurfaceSettings|attentionInbox/);
  assert.match(detail, /id="detailSurfaceQuota"[\s\S]*?id="quotaSummary"[\s\S]*?id="quotaOverview"/);
  assert.match(html, /id="activityCenterDialog"[\s\S]*?id="attentionInbox"[\s\S]*?id="attentionItems"/);
  assert.match(detail, /id="sessionActionDock"[\s\S]*?id="sessionSelectionBar"[\s\S]*?id="copySessionInfoBtn"[\s\S]*?id="sendSessionInfoBtn"[\s\S]*?id="sessionFocusedActions"[\s\S]*?id="openSessionFileBtn"[\s\S]*?id="exportSessionBtn"/);
  assert.match(footer, /id="statusText"[\s\S]*?id="ledgerDone"[\s\S]*?id="ledgerMin"[\s\S]*?id="reminderToggle"/);
  assert.doesNotMatch(footer, /sessionSelectionBar|copySessionInfoBtn|sendSessionInfoBtn/);
  assert.doesNotMatch(html, /id="yardLedger"/);
  assert.match(styles, /\.detail-surface\[hidden\]\s*\{\s*display:\s*none !important/);
});

test('自动氛围和语义拖放模块都在 scene 前加载', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const atmosphere = html.indexOf('./yard/atmosphere.js');
  const interactions = html.indexOf('./yard/interactions.js');
  const scene = html.indexOf('./yard/scene.js');
  assert.ok(atmosphere > 0 && atmosphere < scene);
  assert.ok(interactions > 0 && interactions < scene);
});

test('工作亭的猫、电脑和拖拽回位共用同一个座位锚点', () => {
  const scene = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'scene.js'), 'utf8');
  assert.match(scene, /seatAnchor: seat \? \{ x: targetX, y: targetY \} : null/);
  assert.match(scene, /drawDesk\(entry\.seatAnchor\.x, true\)/);
  assert.match(scene, /const returnPoint = candidate\.entry\.seatAnchor \|\| candidate\.entry\.home/);
  assert.doesNotMatch(scene, /drawDesk\(entry\.home\.x/);
});

test('会话编排边界已从 UI、preload、主进程和依赖中完整移除', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  const retiredFiles = ['runtime.js', 'acp-client.js', 'agent-registry.js', 'session-artifacts.js'];

  assert.doesNotMatch(html, /runtimeDock|consoleToggle|custom-agent|handoff|artifactIndex/);
  assert.doesNotMatch(preload, /runtime:|TerminalRuntime|CustomAgent|listSessionArtifacts/);
  assert.doesNotMatch(main, /ipcMain\.handle\('runtime:|RuntimeService|customAgents|listSessionArtifacts/);
  assert.doesNotMatch(packageJson, /agentclientprotocol/);
  assert.match(main, /discoverCliInventory\(/);
  for (const file of retiredFiles) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', file)), false, `${file} should stay retired`);
  }
});

test('Agent 管理是单一对象入口，全局 Agent 与当前运行位置在 Dialog 中分区', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');
  assert.match(html, /id="accountManage"[^>]*aria-controls="agentManageDialog"/);
  assert.match(html, /id="agentManageDialog"[\s\S]*?id="agentGlobalActions"[\s\S]*?id="yardManageActions"/);
  assert.doesNotMatch(html, /<details id="accountManage"/);
  assert.match(styles, /\.agent-panel \.account-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(94px, 1\.2fr\) minmax\(82px, 1fr\) minmax\(78px, 0\.9fr\)/);
});

test('名牌三档高低交错 + 宽度封顶，缓解横带缩小后名牌互相盖住', () => {
  const scene = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'scene.js'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 三席与相邻猫名牌都错成三档（旧的两档 % 2 在缩小的横带里不够分开）
  assert.match(scene, /tier = seatIndex % 3/);
  assert.match(scene, /const lift = \[3, 15, 27\]\[entry\.tier\]/);
  // 名牌宽度封顶 + tier2 吊线
  assert.match(yardStyles, /#yardOverlay \.yard-nameplate \{[\s\S]*?max-width:\s*74px/);
  assert.match(yardStyles, /#yardOverlay \.yard-nameplate\.tier2::after/);
});

test('Agent CRUD 与运行位置操作按对象分区，两视图共用且不搬家', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  // 新增紧跟打开账号；全局 Agent 与当前运行位置动作分别静态放在对象 Dialog 的两个分区。
  assert.match(html, /id="launchBtn"[\s\S]*?id="addProfileBtn"/);
  assert.match(html, /id="agentGlobalActions"[\s\S]*?id="editProfileBtn"[\s\S]*?id="manageAgentRelationsBtn"[\s\S]*?id="removeProfileBtn"[\s\S]*?<\/div>/);
  assert.match(html, /id="yardManageActions"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="profileFolderBtn"[\s\S]*?<\/div>/);
  // 统一后不再按视图搬家：applyView 不再 insertBefore / sidebarActions.append 这几个按钮
  assert.doesNotMatch(renderer, /accountActions\.insertBefore\(els\.addProfileBtn/);
  assert.doesNotMatch(renderer, /sidebarActions\.append/);
  // 详情空字段折叠：dd 与其前面的 dt 一起隐藏（keep 的字段始终保留）
  assert.match(renderer, /function setDetail\(dd, value/);
  assert.match(renderer, /dd\.hidden = empty;[\s\S]*?if \(dt && dt\.tagName === 'DT'\) dt\.hidden = empty/);
});

test('已退休的控制台设置和 renderer 事件状态不再保留', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
  assert.doesNotMatch(html, /id="runtimeDock"/);
  assert.doesNotMatch(html, /id="consoleToggle"/);
  assert.doesNotMatch(html, /id="runtimeCloseBtn"/);
  assert.doesNotMatch(renderer, /agentConsoleOn|handleRuntimeEvent|renderRuntimeDock/);
  assert.doesNotMatch(settings, /agentConsoleOn/);
});

test('不可 launch 的 CLI 槽位禁用打开按钮，账号卡片展示并行会话与同账号徽章', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(renderer, /canLaunch: a\.canLaunch !== false/);
  assert.match(renderer, /els\.launchBtn\.disabled = disabled \|\| !canLaunch/);
  assert.match(renderer, /activeNow/);
  // 账号卡片：并行会话徽章 + 同账号(多形态)⛓ 徽章
  assert.match(renderer, /account-card-busy/);
  assert.match(renderer, /account-card-link/);
  assert.match(html, /id="editIdentity"[^>]*list="identityOptions"/);
  assert.match(html, /<datalist id="identityOptions">/);
});

test('同账号识别双通道：手动 identityKey 与自动登录指纹都构成分组', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const groups = fs.readFileSync(path.join(__dirname, '..', 'src', 'identity-groups.js'), 'utf8');
  // 双通道归组逻辑收敛在 identity-groups.js（并查集），renderer 只消费组
  assert.match(groups, /profile\.identityKey/);
  assert.match(groups, /profile\.identityFingerprint/);
  assert.match(renderer, /groupOfProfile\(profile\.id\)/);
  // 指纹在 main 侧运行时附加,不落盘
  assert.match(main, /identityFingerprint: identityFingerprint\(profile\)/);
  assert.doesNotMatch(main, /next\.identityFingerprint/);
});

test('账号为轴：庭院一只猫=一个账号组，会话合流并记录归属槽位', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  // 分组模块在 renderer 前加载
  const groupsIndex = html.indexOf('./identity-groups.js');
  const rendererIndex = html.indexOf('./renderer.js');
  assert.ok(groupsIndex > 0 && groupsIndex < rendererIndex);
  // 庭院吃组代表而不是全部槽位；选中任一成员都高亮同一只猫
  assert.match(renderer, /profiles: groups\.map\(\(group\) => group\.primary\)/);
  assert.match(renderer, /selectedId: selectedGroup \? selectedGroup\.primary\.id : currentProfileId\(\)/);
  // 会话合流：组内所有槽位一起列，每条带归属槽位 id，操作按归属槽位走
  assert.match(renderer, /record\) => \(\{ \.\.\.record, _profileId: member\.id \}\)/);
  assert.match(renderer, /sessionOwnerProfile\(session\)\.id/);
  // 排行榜与账号条也按组聚合
  assert.match(renderer, /const rows = identityGroups\(\)\.map/);
  assert.match(renderer, /for \(const group of identityGroups\(\)\) \{/);
});

test('运行位置可单独管理：控制条切换 AgentSlot 且不重载会话或清空用户上下文', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  // 形态切换器落在账号控制条：名牌之后、账号操作之前（控制条两视图共用，非主形态从这里可选中）
  assert.match(html, /id="accountId"[\s\S]*?id="formSwitcher"[\s\S]*?id="formSelect"[\s\S]*?id="accountActions"/);
  // 记取旧坑：inline-flex 会盖过 UA 的 [hidden]，必须显式补 [hidden]{display:none}
  assert.match(styles, /\.form-switcher\[hidden\]\s*\{\s*display:\s*none/);
  // Agent 可以存在但当前 Slot 为空，此时必须给出明确占位，不自动选第一项。
  assert.match(renderer, /function renderFormSwitcher\(profile, group\)[\s\S]*?const grp = group \|\| \(profile \? groupOfProfile\(profile\.id\) : null\)[\s\S]*?if \(!profile\)[\s\S]*?devices\.slot\.choose/);
  // change 事件只写 UiContext 的 Slot 记忆，不重新加载会话，也不清空搜索或动作选择。
  assert.match(renderer, /els\.formSelect\?\.addEventListener\('change'[\s\S]{0,180}?selectSlot\(id\)/);
  const selectSlot = renderer.slice(renderer.indexOf('function selectSlot('), renderer.indexOf('function populateGroupDatalist('));
  assert.match(selectSlot, /UiContext\.setSlot\(state\.ui/);
  assert.doesNotMatch(selectSlot, /loadSessions|state\.query\s*=|clearConversationActions/);
  assert.match(renderer, /renderFormSwitcher\(profile, identityGroup\)/);
  assert.match(renderer, /renderFormSwitcher\(null, selectedGroup\)/);
});

test('庭院画布纵向扩展：前景草坪带同步到画布/交互/HTML 三处', () => {
  const scene = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'scene.js'), 'utf8');
  const interactions = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'interactions.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(scene, /const H = 236/);
  assert.match(interactions, /const HEIGHT = 236/);
  assert.match(html, /id="yardCanvas" width="480" height="236"/);
  // 前景带画在地面之后、栅栏之前（被猫和亭子盖住的层序）
  assert.match(scene, /drawGround\(P\);\s*drawForeground\(P\);/);
});

test('工具入口打开独立模态弹窗 + 新增账号落盘链完整', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(html, /class="topbar-actions"[\s\S]*?id="toolCenterBtn"[\s\S]*?id="activityCenterBtn"[\s\S]*?id="settingsBtn"/);
  assert.match(html, /id="toolCenterBtn"[^>]*aria-controls="toolCenterDialog"/);
  assert.doesNotMatch(html, /id="detailSurfaceTools"/);
  assert.match(renderer, /toolCenterBtn\?\.addEventListener\('click'[\s\S]{0,220}?openUtilityDialog\('tools'\)/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?dialog\.showModal\(\)/);
  assert.doesNotMatch(renderer, /detailSurfaceTools|toolCenterDialog\.show\(\)/);
  // 新增账号：表单 → addProfile → profiles:add → saveProfiles 落盘
  assert.match(renderer, /window\.manager\.addProfile\(\{[\s\S]{0,120}?name,/);
  assert.match(main, /ipcMain\.handle\('profiles:add'[\s\S]*?profiles\.push\(profile\);\s*\n\s*saveProfiles\(profiles\);/);
});

test('工具维护台覆盖桌面 App 与 CLI 工具：检查、打开、单项/批量更新且 renderer 不提交命令', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  const maintenance = read('src/tool-maintenance.js');
  const styles = read('src/styles.css');
  const yardStyles = read('src/yard/yard.css');

  assert.match(html, /id="toolCenterBtn"[\s\S]*?data-i18n="topbar\.tools"/);
  assert.match(html, /id="toolCenterDialog"[^>]*tool-center-dialog/);
  assert.match(html, /id="checkToolsBtn"[\s\S]*?id="updateAllToolsBtn"/);
  assert.match(html, /id="desktopToolList"[\s\S]*?id="cliToolList"/);
  assert.doesNotMatch(html, /custom-agent|addCustomAgent|customAgent/);

  assert.match(preload, /scanTools:[\s\S]*?tools:scan/);
  assert.match(preload, /openTool:[\s\S]*?tools:open/);
  assert.match(preload, /updateTool:[\s\S]*?tools:update/);
  assert.match(preload, /updateAllTools:[\s\S]*?tools:updateAll/);
  assert.match(main, /ipcMain\.handle\('tools:scan'/);
  assert.match(main, /ipcMain\.handle\('tools:open'/);
  assert.match(main, /ipcMain\.handle\('tools:update'/);
  assert.match(main, /ipcMain\.handle\('tools:updateAll'/);

  // renderer 只交 toolId / profileId；命令、参数、路径和官方 URL 都由主进程目录生成。
  assert.match(renderer, /window\.manager\.openTool\(\{\s*toolId: item\.id,\s*profileId:/);
  assert.match(renderer, /window\.manager\.updateTool\(item\.id\)/);
  assert.doesNotMatch(renderer, /openTool\(\{[\s\S]{0,180}(?:command|args|url|executablePath):/);
  assert.match(main, /toolMaintenance\.catalogTool\(toolId\)/);
  assert.match(main, /toolMaintenance\.updateArgumentsFor\(plan\)/);
  assert.match(maintenance, /function isTrustedLatestRequest\(/);
  assert.match(maintenance, /if \(url\.protocol !== 'https:'\) return false/);

  assert.match(styles, /\.tool-center-dialog[\s\S]*?\.tool-card-actions/);
  assert.match(yardStyles, /工具维护台：庭院里是一块有状态灯的木工台/);
});

test('庭院猫位置越界兜底：旧拖拽位置落在被裁的前景草坪带(y≥124)时作废、回默认布局（Kimi 消失回归）', () => {
  const scene = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'scene.js'), 'utf8');
  // 统一重设计裁掉 y≥132 的前景草坪带后，旧的 saved 位置若落在那里会把猫画到可见区外
  assert.match(scene, /if \(saved && saved\.y >= 124\) saved = null/);
});

test('i18n 独立模块：三语加载顺序 + 顶栏接线 + 语言持久化 + 词表核心 key 对齐', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html'); const renderer = read('src/renderer.js'); const settings = read('src/settings.js');
  // 独立模块，renderer 前按核心模块→zh→en→ja 顺序加载（加语言=加一行）
  assert.match(html, /i18n\/i18n\.js"[\s\S]*?i18n\/zh\.js"[\s\S]*?i18n\/en\.js"[\s\S]*?i18n\/ja\.js"[\s\S]*?renderer\.js"/);
  // 顶栏语言切换按钮 + 静态文案挂 data-i18n
  assert.match(html, /id="langToggle"/);
  assert.match(html, /id="leaderboardBtn"[^>]*>[\s\S]*?data-i18n="topbar\.leaderboard"/);
  // 界面接线：跟随/存过的语言初始化 + 循环切换持久化
  assert.match(renderer, /window\.I18N\.init\(value\.lang\)/);
  assert.match(renderer, /window\.I18N\.setLang\(window\.I18N\.next\(\)/);
  assert.match(settings, /LANGS = new Set\(\['zh', 'en', 'ja'\]\)/);
  assert.match(settings, /lang: LANGS\.has\(input\.lang\)/);
  // 三语词表都注册 meta.label，且核心 key 三语对齐
  for (const loc of [read('src/i18n/zh.js'), read('src/i18n/en.js'), read('src/i18n/ja.js')]) {
    assert.match(loc, /meta: \{ label:/);
    for (const key of ['topbar.leaderboard', 'topbar.tools', 'account.open', 'session.title', 'status.ready', 'tools.check', 'tools.updateAll', 'tools.manager.unknown', 'tools.source.catalog']) {
      assert.ok(loc.includes("'" + key + "'"), key + ' missing in a locale');
    }
  }
});

test('三语词表完整 key 集合一致', () => {
  const locale = (lang) => require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang];
  const expected = Object.keys(locale('zh')).sort();
  assert.deepEqual(Object.keys(locale('en')).sort(), expected);
  assert.deepEqual(Object.keys(locale('ja')).sort(), expected);
});
