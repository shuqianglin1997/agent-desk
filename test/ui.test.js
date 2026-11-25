const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');
const { page, declared, styleRules, loadPreload, commandFor, runCommand } = require('./helpers/behaviour');

// Document order and nesting on the parsed page.
const inOrder = (doc, ...ids) => { const at = ids.map((id) => doc.index(doc.byId(id))); return at.every((i) => i >= 0) && at.every((v, k) => k === 0 || at[k - 1] < v); };
const inside = (doc, id, containerId) => Boolean(doc.byId(id) && doc.byId(containerId) && doc.within(doc.byId(id), doc.byId(containerId)));
const scriptOrder = (doc, ...srcs) => { const list = doc.all((el) => el.tag === 'script' && el.attrs.src).map((el) => el.attrs.src); const at = srcs.map((src) => list.indexOf(src)); return at.every((i) => i >= 0) && at.every((v, k) => k === 0 || at[k - 1] < v); };

test('更新按钮归入系统页的设置一栏，Header 只保留收件箱和系统两个入口', () => {
  const doc = page();
  const toolbar = doc.all((el) => el.tag === 'nav' && doc.hasClass(el, 'topbar-actions'));
  assert.equal(toolbar.length, 1);
  assert.ok(doc.within(doc.byId('activityCenterBtn'), toolbar[0]) && doc.within(doc.byId('systemBtn'), toolbar[0]) && inOrder(doc, 'activityCenterBtn', 'systemBtn'));
  for (const id of ['deviceCenterBtn', 'addProfileBtn', 'toolCenterBtn', 'settingsBtn', 'updateBtn', 'globalMoreMenu']) {
    assert.ok(!doc.byId(id) || !doc.within(doc.byId(id), toolbar[0]), `${id} is not in the header bar`);
  }
  assert.ok(inside(doc, 'updateBtn', 'systemDialog'), 'update lives in the system page');
});

test('1.13 固定骨架：一个 Header、一个 Footer 与顶部 Agent/左下会话/右下详情三个面板', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');
  // 旧侧栏和七行信息轨移除；主区只保留三个固定面板。
  assert.doesNotMatch(html, /class="sidebar"/);
  const doc = page();
  const header = doc.all((el) => el.tag === 'header' && doc.hasClass(el, 'app-topbar'));
  const footer = doc.all((el) => el.tag === 'footer' && el.attrs.id === 'statusBar');
  const board = doc.byId('mainGrid');
  assert.deepEqual([header.length, footer.length, board.tag, doc.classes(board)], [1, 1, 'main', ['workspace-board']]);
  const panels = doc.children(board).filter((el) => doc.hasClass(el, 'workspace-panel'));
  assert.deepEqual(panels.map((el) => [el.attrs.id, doc.classes(el).join(' ')]), [
    ['agentPanel', 'workspace-panel agent-panel'], ['sessionPane', 'workspace-panel session-pane'], ['detailPanel', 'workspace-panel detail-panel']
  ]);
  assert.ok(doc.index(header[0]) < doc.index(board) && doc.index(board) < doc.index(footer[0]), 'header, board, footer in order');
  const presenter = doc.all((el) => el.tag === 'section' && doc.hasClass(el, 'presenter'))[0];
  assert.ok(doc.within(presenter, doc.byId('agentPanel')) && doc.within(doc.byId('accountRoster'), presenter));
  assert.ok(doc.index(doc.byId('accountRoster')) < doc.index(doc.byId('accountCardTemplate')));
  assert.deepEqual(['--header-h', '--footer-h', '--agent-h', '--detail-w'].map((name) => declared(':root', name)), ['58px', '38px', '222px', '316px']);
  assert.equal(declared('.app-shell', 'grid-template'), 'var(--header-h) minmax(0, 1fr) var(--footer-h) / minmax(0, 1fr)');
  assert.deepEqual([declared('.workspace-board', 'grid-template-columns'), declared('.workspace-board', 'grid-template-rows')], ['minmax(0, 1fr) var(--detail-w)', 'var(--agent-h) minmax(0, 1fr)']);
  assert.equal(declared('.workspace-board .table-wrap', 'overflow-x'), 'hidden');
  assert.equal(declared('.session-table[data-mode="compact"]', 'min-width'), '0');
  // 账号名册是唯一的 Agent 呈现面。
  // The roster's one rule (in the pixel skin) lays the cards out in a row; the
  // grid declaration this pinned never applied (the skin's display: flex won).
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'pixel.css'), 'utf8'), /\.agent-panel \.account-roster \{[^}]*?display:\s*flex;/);
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
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');

  // 选谁看谁：范围开关并进名册，“全部”卡片和点猫共同驱动同一个 agentScope。
  assert.doesNotMatch(html, /id="sessionScopeCurrentBtn"|id="sessionScopeAllBtn"/);
  const doc = page();
  assert.ok(doc.index(doc.byId('rosterAllCard')) < doc.index(doc.byId('accountRoster')));
  assert.match(renderer, /async function pickRosterAgent\(agentId\)[\s\S]*?UiContext\.setAgentScope\(state\.ui, 'current'\)[\s\S]*?selectAgent\(agentId\)/);
  assert.match(renderer, /async function pickRosterAll\(\)[\s\S]*?setSessionScope\('all'\)/);
  // 全 Agent 扫描仍给每条会话保留真实槽位和账号组，供浏览与定位操作使用。
  assert.match(renderer, /state\.ui\.agentScope === 'all'[\s\S]*?identityGroups\(\)/);
  assert.match(renderer, /_profileId:\s*member\.id/);
  assert.match(renderer, /_accountKey:\s*accountKey/);
  const copy = doc.byId('copySessionInfoBtn');
  assert.deepEqual([copy.tag, doc.classes(copy), copy.attrs['data-i18n'], doc.text(copy)], ['button', ['session-copy-info', 'primary'], 'session.copyInfo', '复制会话信息']);
  assert.ok(styleRules('.session-copy-info').some((rule) => rule.decls['min-width'] === '148px' && rule.decls.height === '36px' && rule.decls.background === 'var(--accent)'), 'the copy button keeps its size and accent');
  assert.equal(declared('.session-copy-info::before', 'content'), '"⧉"');
  assert.doesNotMatch(html, /copySessionLocationBtn|session-copy-location/);
  const scripts = doc.all((el) => el.tag === 'script' && el.attrs.src).map((el) => el.attrs.src);
  assert.ok(scripts.indexOf('./session-location.js') >= 0 && scripts.indexOf('./session-location.js') < scripts.indexOf('./renderer.js'));
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
  const doc = page();
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');

  const dock = doc.byId('sessionActionDock');
  const actions = ['copySessionInfoBtn', 'openSessionFileBtn', 'exportSessionBtn'].map((id) => doc.byId(id));
  assert.ok(actions.every((el) => doc.within(el, dock)) && doc.index(actions[0]) < doc.index(actions[1]) && doc.index(actions[1]) < doc.index(actions[2]));
  assert.equal(doc.all((el) => el.attrs.id === 'copySessionInfoBtn').length, 1);
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

  assert.ok(inOrder(page(), 'sessionCompactBtn', 'sessionDetailBtn'));
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
  const doc = page();
  const notIn = (ids, containerId) => ids.every((id) => !doc.byId(id) || !doc.within(doc.byId(id), doc.byId(containerId)));
  assert.ok(notIn(['detailSurfaceDevices', 'detailSurfaceTools', 'detailSurfaceActivity', 'detailSurfaceSettings', 'attentionInbox', 'quotaPopover', 'quotaSummary', 'quotaOverview'], 'detailPanel'), 'the detail area holds no page or quota');
  assert.ok(inside(doc, 'quotaSummary', 'quotaPopover') && inside(doc, 'quotaOverview', 'quotaPopover') && inOrder(doc, 'quotaSummary', 'quotaOverview'));
  assert.ok(inside(doc, 'attentionInbox', 'activityCenterDialog') && inside(doc, 'attentionItems', 'attentionInbox'));
  assert.ok('hidden' in doc.byId('detailPanel').attrs && inside(doc, 'remoteWorkspaceHost', 'detailPanel'), 'the detail area starts hidden and holds the remote surface');
  assert.ok(notIn(['sessionActionDock', 'sessionInspector'], 'detailPanel'));
  assert.ok(inside(doc, 'statusText', 'statusBar'));
  assert.ok(notIn(['ledgerDone', 'ledgerMin', 'reminderToggle'], 'statusBar'), 'the footer is global status only');
  assert.ok(notIn(['sessionSelectionBar', 'copySessionInfoBtn', 'sendSessionInfoBtn'], 'statusBar'), 'no session actions in the footer');
  assert.ok(!doc.byId('yardLedger'), 'no yard ledger');
  assert.ok(styleRules('.detail-surface[hidden]').some((rule) => !rule.conditional && rule.decls.display === 'none !important'), 'a hidden detail surface stays hidden');
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
  const doc = page();
  assert.equal(doc.all((el) => doc.hasClass(el, 'account-card-manage'))[0].attrs['aria-controls'], 'agentManageDialog');
  assert.ok(['agentGlobalActions', 'agentManageLocations', 'yardManageActions'].every((id) => inside(doc, id, 'agentManageDialog')) && inOrder(doc, 'agentGlobalActions', 'agentManageLocations', 'yardManageActions'));
  assert.doesNotMatch(html, /class="account-bar"/);
  assert.ok(styleRules('.agent-panel .account-card-actions').some((rule) => rule.decls['grid-template-columns'] === 'minmax(0, 1fr) max-content'));
});

test('Agent CRUD 与运行位置操作按对象分区', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = rendererSource();
  // 新增归 Agent 标题行的“招募”，Agent 与运行位置管理归各自对象。
  const doc = page();
  const head = doc.all((el) => doc.hasClass(el, 'presenter-head'))[0];
  assert.ok(doc.within(doc.byId('addProfileBtn'), head) && inOrder(doc, 'addProfileBtn', 'accountRoster'));
  assert.ok(inside(doc, 'editProfileBtn', 'agentGlobalActions'));
  const locationTools = ['pathConfigBtn', 'diagnosticsBtn', 'refreshBtn', 'profileFolderBtn'];
  assert.ok(locationTools.every((id) => inside(doc, id, 'yardManageActions')) && inOrder(doc, ...locationTools), 'location tools in order');
  assert.ok(inOrder(doc, 'yardManageActions', 'addRuntimeLocationBtn', 'manageAgentRelationsBtn', 'removeProfileBtn'), 'then the relation and removal actions');
  const createFields = ['newAgentName', 'newAgentGroup', 'newAgentNote', 'confirmAddAgentBtn'];
  assert.ok(createFields.every((id) => inside(doc, id, 'agentCreateDialog')) && inOrder(doc, ...createFields));
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
  const doc = page();
  assert.equal(doc.byId('editIdentity').attrs.list, 'identityOptions');
  assert.equal(doc.byId('identityOptions').tag, 'datalist');
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
  assert.ok(scriptOrder(page(), './identity-groups.js', './renderer.js'));
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
  const doc = page();
  const template = doc.byId('accountCardTemplate');
  const part = (name) => doc.all((el) => doc.hasClass(el, name) && doc.within(el, template))[0];
  const runtime = part('account-card-runtime');
  assert.ok(runtime && doc.children(runtime).some((el) => el.tag === 'select'), 'the card shows its location as a select');
  assert.ok(part('account-card-actions') && doc.index(runtime) < doc.index(part('account-card-actions')));
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
  const doc = page();
  const toolbar = doc.all((el) => doc.hasClass(el, 'topbar-actions'))[0];
  assert.ok(doc.within(doc.byId('activityCenterBtn'), toolbar) && inOrder(doc, 'activityCenterBtn', 'systemBtn'));
  assert.equal(doc.byId('systemBtn').attrs['aria-controls'], 'systemDialog');
  assert.doesNotMatch(html, /id="detailSurfaceTools"/);
  assert.match(renderer, /systemBtn\?\.addEventListener\('click'[\s\S]{0,220}?openUtilityDialog\('system'\)[\s\S]{0,120}?refreshToolInventory\(false\)/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?openDialog\(dialog\)/);
  assert.doesNotMatch(renderer, /detailSurfaceTools|toolCenterDialog|settingsDialog/);
  // 新增账号：表单 → addProfile → profiles:add → saveProfiles 落盘
  assert.match(renderer, /window\.manager\.addProfile\(\{[\s\S]{0,120}?name,/);
  assert.match(main, /ipcMain\.handle\('profiles:add'[\s\S]*?profiles\.push\(profile\);\s*\n\s*(?:main\.)?saveProfiles\(profiles\);/);
});

test('工具维护台覆盖桌面 App 与 CLI 工具：检查、打开、单项更新且 renderer 不提交命令', async () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html');
  const renderer = rendererSource() + '\n' + read('src/renderer/tool-center.js');
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  const maintenance = read('src/tool-maintenance.js');
  const styles = read('src/workspace.css');

  const doc = page();
  assert.ok(inside(doc, 'systemTools', 'systemDialog'));
  assert.ok(doc.all((el) => el.attrs['data-i18n'] === 'system.tools' && doc.within(el, doc.byId('systemTools'))).length === 1, 'the tools column has its heading');
  assert.ok(inside(doc, 'checkToolsBtn', 'systemTools'));
  assert.ok(inOrder(doc, 'desktopToolList', 'cliToolList'));
  assert.doesNotMatch(html, /custom-agent|addCustomAgent|customAgent/);

  const { api, calls } = loadPreload();
  api.scanTools({ force: true }); api.openTool({ toolId: 'codex', profileId: 'p1' }); api.updateTool('codex');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['invoke', 'tools:scan', { force: true }], ['invoke', 'tools:open', { toolId: 'codex', profileId: 'p1' }], ['invoke', 'tools:update', { toolId: 'codex' }]]);
  assert.equal(api.updateAllTools, undefined, 'no update-all');
  assert.throws(() => commandFor('tools:updateAll'));

  // renderer 只交 toolId / profileId；命令、参数、路径和官方 URL 都由主进程目录生成。
  assert.match(renderer, /manager\.openTool\(\{\s*toolId: item\.id,\s*profileId:/);
  assert.match(renderer, /manager\.updateTool\(item\.id\)/);
  assert.doesNotMatch(renderer, /openTool\(\{[\s\S]{0,180}(?:command|args|url|executablePath):/);
  // Main passes on only the two ids, and looks the tool up in its own catalog:
  // an unknown id is refused before anything runs. (The https/host guard for
  // latest-version requests is checked by behaviour in tool-maintenance.test.js.)
  const seen = [];
  const toolDeps = { openMaintenanceTool: async (...args) => { seen.push(['open', ...args]); return { ok: true }; }, updateMaintenanceTool: async (id) => { seen.push(['update', id]); return { ok: true }; } };
  await runCommand('tools:open', toolDeps, { toolId: 'codex', profileId: 'p1', command: 'rm', args: ['-rf'], url: 'https://x', executablePath: '/bin/sh' });
  await runCommand('tools:update', toolDeps, { toolId: 'codex', command: 'rm' }, { event: { sender: {} } });
  assert.deepEqual(seen, [['open', 'codex', 'p1'], ['update', 'codex']]);
  const mainTools = require('../src/main/tools');
  mainTools.bind({ t: (key) => key });
  assert.deepEqual(await mainTools.openMaintenanceTool('no-such-tool', ''), { ok: false, reason: 'main.tools.notFound' });
  assert.deepEqual(await mainTools.updateMaintenanceTool('no-such-tool', { send() {} }), { ok: false, reason: 'main.tools.notFound' });

  // 工具一行一个的样式在像素皮肤里；旧的工具弹窗规则已随弹窗一起删掉。
  assert.doesNotMatch(styles, /\.tool-center-dialog/);
  assert.ok(styleRules('.system-tools .tool-card', ['src/pixel.css']).length && styleRules('.system-tools .tool-card-actions', ['src/pixel.css']).length, 'one tool per row is styled in the skin');
});

test('i18n 独立模块：三语加载顺序 + 顶栏接线 + 语言持久化 + 词表核心 key 对齐', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('src/index.html'); const renderer = rendererSource(); const settings = read('src/settings.js');
  // 独立模块，renderer 前按核心模块→zh→en→ja 顺序加载（加语言=加一行）
  assert.ok(scriptOrder(page(), './i18n/i18n.js', './i18n/zh.js', './i18n/en.js', './i18n/ja.js', './renderer.js'));
  // 顶栏语言切换按钮 + 静态文案挂 data-i18n
  assert.ok(page().byId('langToggle'));
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
