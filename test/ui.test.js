const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');

test('更新按钮归入系统页的设置一栏，Header 只保留收件箱和系统两个入口', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const toolbarStart = html.indexOf('<nav class="topbar-actions"');
  const toolbarEnd = html.indexOf('</nav>', toolbarStart);
  const settingsStart = html.indexOf('id="systemDialog"');
  const settingsEnd = html.indexOf('</dialog>', settingsStart);
  const updateButton = html.indexOf('id="updateBtn"');

  assert.notEqual(toolbarStart, -1);
  assert.notEqual(toolbarEnd, -1);
  assert.match(html.slice(toolbarStart, toolbarEnd), /id="activityCenterBtn"[\s\S]*?id="systemBtn"/);
  assert.doesNotMatch(html.slice(toolbarStart, toolbarEnd), /id="deviceCenterBtn"|id="addProfileBtn"|id="toolCenterBtn"|id="settingsBtn"/);
  assert.doesNotMatch(html.slice(toolbarStart, toolbarEnd), /id="updateBtn"|globalMoreMenu/);
  assert.ok(updateButton > settingsStart && updateButton < settingsEnd);
});

test('1.13 固定骨架：一个 Header、一个 Footer 与顶部 Agent/左下会话/右下详情三个面板', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');
  // 旧侧栏和七行信息轨移除；主区只保留三个固定面板。
  assert.doesNotMatch(html, /class="sidebar"/);
  assert.match(html, /<header class="app-topbar">[\s\S]*?<main id="mainGrid" class="workspace-board"[\s\S]*?id="agentPanel" class="workspace-panel agent-panel"[\s\S]*?id="sessionPane" class="workspace-panel session-pane"[\s\S]*?id="detailPanel" class="workspace-panel detail-panel"[\s\S]*?<footer id="statusBar"/);
  const board = html.slice(html.indexOf('<main id="mainGrid"'), html.indexOf('</main>'));
  assert.equal((board.match(/class="workspace-panel /g) || []).length, 3);
  assert.match(html, /id="agentPanel"[\s\S]*?<section class="presenter">[\s\S]*?id="accountRoster"[\s\S]*?id="accountCardTemplate"/);
  assert.match(styles, /--header-h:\s*58px;[\s\S]*?--footer-h:\s*38px;[\s\S]*?--agent-h:\s*222px;[\s\S]*?--detail-w:\s*316px/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*?grid-template:\s*var\(--header-h\) minmax\(0, 1fr\) var\(--footer-h\) \/ minmax\(0, 1fr\)/);
  assert.match(styles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-w\);[\s\S]*?grid-template-rows:\s*var\(--agent-h\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.workspace-board \.table-wrap\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(styles, /\.session-table\[data-mode="compact"\]\s*\{\s*min-width:\s*0/);
  // 账号名册是唯一的 Agent 呈现面。
  assert.match(styles, /\.agent-panel \.account-roster \{[\s\S]*?display:\s*grid/);
  // 庭院场景已经退出窗口，它的场景代码、调色板、氛围和皮肤不再随应用提供；猫的素材、状态和额度判断保留。
  // 第 2 阶段：旧位置设置退休（settings 版本 5 收进 retired），interactions.js 一并删除。
  for (const gone of ['scene.js', 'palettes.js', 'atmosphere.js', 'yard.css', 'interactions.js']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'yard', gone)), false, `${gone} 应已删除`);
  }
  for (const kept of ['sprites.js', 'cats.js', 'energy.js']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'yard', kept)), true, `${kept} 仍在使用`);
  }
});

test('会话浏览支持只用于明确定位动作的轻量选择，复制主操作突出且不恢复交接编排', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  // 选谁看谁：范围开关并进名册，“全部”卡片和点猫共同驱动同一个 agentScope。
  assert.doesNotMatch(html, /id="sessionScopeCurrentBtn"|id="sessionScopeAllBtn"/);
  assert.match(html, /id="rosterAllCard"[\s\S]*?id="accountRoster"/);
  assert.match(renderer, /async function pickRosterAgent\(agentId\)[\s\S]*?UiContext\.setAgentScope\(state\.ui, 'current'\)[\s\S]*?selectAgent\(agentId\)/);
  assert.match(renderer, /async function pickRosterAll\(\)[\s\S]*?setSessionScope\('all'\)/);
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

test('会话复制保留唯一入口和路径加坐标契约', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(html, /id="sessionActionDock"[\s\S]*?id="copySessionInfoBtn"[\s\S]*?id="openSessionFileBtn"[\s\S]*?id="exportSessionBtn"/);
  assert.equal(html.match(/id="copySessionInfoBtn"/g).length, 1);
  assert.doesNotMatch(html, /copyAddressBtn|copyProjectBtn|detailAddress|detailFile|detailId/);
  assert.match(renderer, /SessionLocation\.format\(sessions/);
  assert.doesNotMatch(html, /artifactIndex|artifactSummary|refreshArtifactsBtn|artifactList|copyHandoffBtn/);
  assert.doesNotMatch(renderer, /listSessionArtifacts|renderArtifactIndex|makeHandoffArtifactText|prepareHandoffArtifacts/);
  assert.doesNotMatch(styles, /artifact-index/);
});

test('会话详细列表提供完整属性列，精简/详细切换且每个表头可点击排序', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
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

test('右下区域承载隔离远控，额度用浮层，会话操作归列表顶栏', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const detail = html.slice(html.indexOf('id="detailPanel"'), html.indexOf('</main>'));
  const footer = html.slice(html.indexOf('<footer id="statusBar"'), html.indexOf('</footer>'));
  assert.doesNotMatch(detail, /detailSurfaceDevices|detailSurfaceTools|detailSurfaceActivity|detailSurfaceSettings|attentionInbox/);
  assert.doesNotMatch(detail, /id="quota(?:Popover|Summary|Overview)"/);
  assert.match(html, /id="quotaPopover"[\s\S]*?id="quotaSummary"[\s\S]*?id="quotaOverview"/);
  assert.match(html, /id="activityCenterDialog"[\s\S]*?id="attentionInbox"[\s\S]*?id="attentionItems"/);
  assert.match(detail, /^id="detailPanel"[^>]*hidden[\s\S]*?id="remoteWorkspaceHost"/);
  assert.doesNotMatch(detail, /sessionActionDock|sessionInspector/);
  assert.match(footer, /id="statusText"/);
  assert.doesNotMatch(footer, /ledgerDone|ledgerMin|reminderToggle/);
  assert.doesNotMatch(footer, /sessionSelectionBar|copySessionInfoBtn|sendSessionInfoBtn/);
  assert.doesNotMatch(html, /id="yardLedger"/);
  assert.match(styles, /\.detail-surface\[hidden\]\s*\{\s*display:\s*none !important/);
});

test('会话编排边界已从 UI、preload、主进程和依赖中完整移除', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = mainHandlerSource();
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
  assert.match(html, /class="account-card-manage"[^>]*aria-controls="agentManageDialog"/);
  assert.match(html, /id="agentManageDialog"[\s\S]*?id="agentGlobalActions"[\s\S]*?id="agentManageLocations"[\s\S]*?id="yardManageActions"/);
  assert.doesNotMatch(html, /class="account-bar"/);
  assert.match(styles, /\.agent-panel \.account-card-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) max-content/);
});

test('Agent CRUD 与运行位置操作按对象分区', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  // 新增归 Agent 标题行的“招募”，Agent 与运行位置管理归各自对象。
  assert.match(html, /class="presenter-head"[\s\S]*?id="addProfileBtn"[\s\S]*?id="accountRoster"/);
  assert.match(html, /id="agentGlobalActions"[\s\S]*?id="editProfileBtn"[\s\S]*?<\/div>/);
  assert.match(html, /id="yardManageActions"[\s\S]*?id="pathConfigBtn"[\s\S]*?id="diagnosticsBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="profileFolderBtn"[\s\S]*?<\/div>[\s\S]*?id="addRuntimeLocationBtn"[\s\S]*?id="manageAgentRelationsBtn"[\s\S]*?id="removeProfileBtn"/);
  assert.match(html, /id="agentCreateDialog"[\s\S]*?id="newAgentName"[\s\S]*?id="newAgentGroup"[\s\S]*?id="newAgentNote"[\s\S]*?id="confirmAddAgentBtn"/);
  assert.match(renderer, /addProfileBtn\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('new'\)/);
  // 统一后不再按视图搬家：applyView 不再 insertBefore / sidebarActions.append 这几个按钮
  assert.doesNotMatch(renderer, /accountActions\.insertBefore\(els\.addProfileBtn/);
  assert.doesNotMatch(renderer, /sidebarActions\.append/);
  assert.match(renderer, /function setDetailMode\(mode\)[\s\S]*?detailPanel\.hidden = next === 'session'/);
});

test('已退休的控制台设置和 renderer 事件状态不再保留', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
  assert.doesNotMatch(html, /id="runtimeDock"/);
  assert.doesNotMatch(html, /id="consoleToggle"/);
  assert.doesNotMatch(html, /id="runtimeCloseBtn"/);
  assert.doesNotMatch(renderer, /agentConsoleOn|handleRuntimeEvent|renderRuntimeDock/);
  assert.doesNotMatch(settings, /agentConsoleOn/);
});

test('不可 launch 的 CLI 槽位禁用打开按钮，账号卡片展示并行会话数，位置数进提示', () => {
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(renderer, /canLaunch: a\.canLaunch !== false/);
  assert.match(renderer, /const profileCanLaunch = profile \? state\.appMeta\[profile\.appId\]\?\.canLaunch !== false : false/);
  assert.match(renderer, /const canOpen = meshMode[\s\S]*?profile && profileCanLaunch[\s\S]*?button\.disabled = !canOpen/);
  assert.match(renderer, /activeNow/);
  // 并行会话数改为“N 条在跑”（docs/SESSION_MARKS_PLAN.md 第 3 节），写在名牌的状态那一行。
  assert.match(renderer, /tr\('card\.running', \{ n: running \}\)/);
  assert.match(renderer, /presenter\.positions/);
  assert.match(html, /id="editIdentity"[^>]*list="identityOptions"/);
  assert.match(html, /<datalist id="identityOptions">/);
});

test('同账号识别双通道：手动 identityKey 与自动登录指纹都构成分组', () => {
  const renderer = rendererSource();
  const main = mainHandlerSource();
  const groups = fs.readFileSync(path.join(__dirname, '..', 'src', 'identity-groups.js'), 'utf8');
  // 双通道归组逻辑收敛在 identity-groups.js（并查集），renderer 只消费组
  assert.match(groups, /profile\.identityKey/);
  assert.match(groups, /profile\.identityFingerprint/);
  assert.match(renderer, /groupOfProfile\(profile\.id\)/);
  // 指纹在 main 侧运行时附加,不落盘
  assert.match(main, /identityFingerprint: identityFingerprint\(profile\)/);
  assert.doesNotMatch(main, /next\.identityFingerprint/);
});

test('账号为轴：每个 Agent 一张卡片，会话合流并记录归属槽位', () => {
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  // 分组模块在 renderer 前加载
  const groupsIndex = html.indexOf('./identity-groups.js');
  const rendererIndex = html.indexOf('./renderer.js');
  assert.ok(groupsIndex > 0 && groupsIndex < rendererIndex);
  assert.match(renderer, /const orderedCards = groups\.map\(\(group\) =>/);
  assert.match(renderer, /card\.classList\.toggle\('selected', selected\)/);
  // 会话合流：组内所有槽位一起列，每条带归属槽位 id，操作按归属槽位走
  assert.match(renderer, /record\) => \(\{ \.\.\.record, _profileId: member\.id \}\)/);
  assert.match(renderer, /function sessionFileActionRefs[\s\S]*?profileId: String\(session\._profileId\)/);
  // 排行榜与账号条也按组聚合
  assert.match(renderer, /for \(const group of identityGroups\(\)\) \{/);
});

test('每张卡的运行位置独立，同一 Agent 内切换保留会话上下文', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  assert.match(html, /id="accountCardTemplate"[\s\S]*?class="account-card-runtime"[\s\S]*?<select><\/select>[\s\S]*?class="account-card-actions"/);
  assert.match(renderer, /function renderAccountCardRuntime\(label, action\)[\s\S]*?if \(group\.members\.length\)[\s\S]*?devices\.slot\.choose[\s\S]*?deployment\.client\.unprepared/);
  assert.match(renderer, /function preferredGroupSlot\(group\)[\s\S]*?selectedSlotKey\(state\.ui, currentDeviceLensId\(\), group\.key\)/);
  // 在卡片上换运行位置只记在这只猫身上，不选中它，所以正在看的列表不变。
  const changeRuntime = rendererFunction('changeAccountCardRuntime');
  assert.match(changeRuntime, /group\.members\.find[\s\S]*?UiContext\.setAgentSlot\(state\.ui, group\.key, member\._meshSlotKey \|\| member\.id\)/);
  assert.doesNotMatch(changeRuntime, /selectProfile|selectAgent|loadSessions/);
  const selectSlot = renderer.slice(renderer.indexOf('function selectSlot('), renderer.indexOf('function populateGroupDatalist('));
  assert.match(selectSlot, /UiContext\.setAgentSlot\(state\.ui/);
  assert.doesNotMatch(selectSlot, /loadSessions|state\.query\s*=|clearConversationActions/);
});

test('工具入口打开独立模态弹窗 + 新增账号落盘链完整', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  const main = mainHandlerSource();
  assert.match(html, /class="topbar-actions"[\s\S]*?id="activityCenterBtn"[\s\S]*?id="systemBtn"/);
  assert.match(html, /id="systemBtn"[^>]*aria-controls="systemDialog"/);
  assert.doesNotMatch(html, /id="detailSurfaceTools"/);
  assert.match(renderer, /systemBtn\?\.addEventListener\('click'[\s\S]{0,220}?openUtilityDialog\('system'\)[\s\S]{0,120}?refreshToolInventory\(false\)/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?openDialog\(dialog\)/);
  assert.doesNotMatch(renderer, /detailSurfaceTools|toolCenterDialog|settingsDialog/);
  // 新增账号：表单 → addProfile → profiles:add → saveProfiles 落盘
  assert.match(renderer, /window\.manager\.addProfile\(\{[\s\S]{0,120}?name,/);
  assert.match(main, /ipcMain\.handle\('profiles:add'[\s\S]*?profiles\.push\(profile\);\s*\n\s*(?:main\.)?saveProfiles\(profiles\);/);
});

test('工具维护台覆盖桌面 App 与 CLI 工具：检查、打开、单项更新且 renderer 不提交命令', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html');
  const renderer = rendererSource() + '\n' + read('src/renderer/tool-center.js');
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  const maintenance = read('src/tool-maintenance.js');
  const styles = read('src/styles.css');

  assert.match(html, /id="systemDialog"[\s\S]*?id="systemTools"[\s\S]*?data-i18n="system\.tools"/);
  assert.match(html, /id="checkToolsBtn"/);
  assert.match(html, /id="desktopToolList"[\s\S]*?id="cliToolList"/);
  assert.doesNotMatch(html, /custom-agent|addCustomAgent|customAgent/);

  assert.match(preload, /scanTools:[\s\S]*?tools:scan/);
  assert.match(preload, /openTool:[\s\S]*?tools:open/);
  assert.match(preload, /updateTool:[\s\S]*?tools:update/);
  assert.doesNotMatch(preload, /updateAllTools:[\s\S]*?tools:updateAll/);
  assert.match(main, /ipcMain\.handle\('tools:scan'/);
  assert.match(main, /ipcMain\.handle\('tools:open'/);
  assert.match(main, /ipcMain\.handle\('tools:update'/);
  assert.doesNotMatch(main, /ipcMain\.handle\('tools:updateAll'/);

  // renderer 只交 toolId / profileId；命令、参数、路径和官方 URL 都由主进程目录生成。
  assert.match(renderer, /manager\.openTool\(\{\s*toolId: item\.id,\s*profileId:/);
  assert.match(renderer, /manager\.updateTool\(item\.id\)/);
  assert.doesNotMatch(renderer, /openTool\(\{[\s\S]{0,180}(?:command|args|url|executablePath):/);
  assert.match(main, /toolMaintenance\.catalogTool\(toolId\)/);
  assert.match(main, /toolMaintenance\.updateArgumentsFor\(plan\)/);
  assert.match(maintenance, /function isTrustedLatestRequest\(/);
  assert.match(maintenance, /if \(url\.protocol !== 'https:'\) return false/);

  // 工具一行一个的样式在像素皮肤里；旧的工具弹窗规则已随弹窗一起删掉。
  assert.doesNotMatch(styles, /\.tool-center-dialog/);
  assert.match(read('src/pixel.css'), /\.system-tools \.tool-card \{[\s\S]*?\.system-tools \.tool-card-actions \{/);
});

test('i18n 独立模块：三语加载顺序 + 顶栏接线 + 语言持久化 + 词表核心 key 对齐', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html'); const renderer = rendererSource(); const settings = read('src/settings.js');
  // 独立模块，renderer 前按核心模块→zh→en→ja 顺序加载（加语言=加一行）
  assert.match(html, /i18n\/i18n\.js"[\s\S]*?i18n\/zh\.js"[\s\S]*?i18n\/en\.js"[\s\S]*?i18n\/ja\.js"[\s\S]*?renderer\.js"/);
  // 顶栏语言切换按钮 + 静态文案挂 data-i18n
  assert.match(html, /id="langToggle"/);
  assert.doesNotMatch(html, /id="leaderboardBtn"/);
  // 界面接线：跟随/存过的语言初始化 + 循环切换持久化
  assert.match(renderer, /window\.I18N\.init\(value\.lang\)/);
  assert.match(renderer, /window\.I18N\.setLang\(window\.I18N\.next\(\)/);
  assert.match(settings, /LANGS = new Set\(\['zh', 'en', 'ja'\]\)/);
  assert.match(settings, /lang: LANGS\.has\(input\.lang\)/);
  // 三语词表都注册 meta.label，且核心 key 三语对齐
  for (const loc of [read('src/i18n/zh.js'), read('src/i18n/en.js'), read('src/i18n/ja.js')]) {
    assert.match(loc, /meta: \{ label:/);
    for (const key of ['system.tools', 'account.open', 'session.title', 'status.ready', 'tools.check', 'tools.manager.unknown', 'tools.source.catalog']) {
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
test('移除待归属本机位置只出现在归属弹窗中，不进入新增 Agent', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const dialog = html.match(/<dialog id="slotAssignmentDialog"[\s\S]*?<\/dialog>/)[0];
  assert.equal((html.match(/id="removeUnassignedSlotBtn"/g) || []).length, 1);
  assert.match(dialog, /id="removeUnassignedSlotBtn"[^>]*type="button"/);
});
