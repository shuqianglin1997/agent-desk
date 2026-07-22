const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('更新按钮位于两种视图都可见的全局命令栏', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const toolbarStart = html.indexOf('<nav class="topbar-actions"');
  const toolbarEnd = html.indexOf('</nav>', toolbarStart);
  const updateButton = html.indexOf('id="updateBtn"');

  assert.notEqual(toolbarStart, -1);
  assert.notEqual(toolbarEnd, -1);
  assert.ok(updateButton > toolbarStart && updateButton < toolbarEnd);
  assert.match(html.slice(toolbarStart, toolbarEnd), /id="updateBtn"[^>]*>↻ <span>更新<\/span><\/button>/);
});

test('统一骨架：单列 顶栏/呈现层/账号控制条/工作区/状态栏，两视图共用（侧栏与 workspace 包裹层已移除）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 旧侧栏 + workspace / workspace-panel 包裹层移除
  assert.doesNotMatch(html, /class="sidebar"/);
  assert.doesNotMatch(html, /class="workspace-panel"/);
  // 账号呈现层：庭院场景 + 经典账号名册同处一个 presenter 槽
  assert.match(html, /<section class="presenter">[\s\S]*?id="yardStage"[\s\S]*?id="accountRoster"[\s\S]*?<\/section>/);
  // app-shell 单列 7 行骨架（顶栏/呈现层/控制条/需要留意/全院额度/工作区/状态栏）
  assert.match(styles, /\.app-shell \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-rows:\s*48px auto auto auto auto minmax\(0, 1fr\) 28px/);
  // 经典视图显示账号名册（庭院视图隐藏、由场景呈现）
  assert.match(styles, /body\[data-view="classic"\] \.account-roster \{[\s\S]*?display:\s*grid/);
  // main-grid 回到基础层 [会话表 | 会话详情]，不再 display:contents 解包
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] \.main-grid \{\s*display: contents/);
});

test('庭院会话表恢复真表格（5 列含来源），删掉卡片式覆盖，表格为唯一滚动区', () => {
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  // 不再藏表头、不再把 tbody/行改成卡片网格、不再逐列 nth-child 隐藏
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] thead \{\s*display:\s*none/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] tbody \{\s*display:\s*grid/);
  assert.doesNotMatch(yardStyles, /body\[data-view="yard"\] tbody td:nth-child/);
  // 表格是唯一滚动区（去掉 380px 硬顶，改由弹性行约束）
  assert.match(yardStyles, /body\[data-view="yard"\] \.table-wrap \{[^}]*max-height:\s*none/);
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
  // 与 .runtime-dock 同因：作者的 display:grid 会盖过 UA 的 [hidden]。缺这条兜底时，
  // 切到经典视图后 .yard-stage 仍占第一行，把整个工作台挤出屏幕（实测 computed
  // display 从 none 退回 grid）。选择器特指度 (0,2,0) 高于 .yard-stage (0,1,0)。
  assert.match(yardCss, /\.yard-stage\[hidden\]\s*\{\s*display:\s*none/);
});

test('经典工作台信息轨四个子块：会话主区固定占弹性行，不与全院额度叠格', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  // 账号条 / 需要留意 / 全院额度 / 会话主区 = 四个子块。只给三行时 main-grid 掉进
  // 隐式 auto 行，1fr 行被算成 0px，全院额度直接压在会话表头上（实测两者 top 同为 305）。
  assert.match(styles, /\.workspace-panel\s*\{[\s\S]*?grid-template-rows:\s*repeat\(3, auto\) minmax\(0, 1fr\)/);
  // main-grid pin 到第 4 行：attention/quota 任一收起（display:none）时会话主区仍拿弹性行。
  assert.match(styles, /\.workspace-panel > \.main-grid\s*\{\s*grid-row:\s*4/);
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

test('多 Agent Fleet 占用庭院下方工作区，身份和工作区解耦且由主进程约束', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  const yardStart = html.indexOf('id="yardStage"');
  const yardEnd = html.indexOf('</section>', html.indexOf('id="runtimeDock"'));

  assert.ok(html.indexOf('id="runtimeDock"') > yardStart);
  assert.ok(html.indexOf('id="runtimeDock"') < yardEnd);
  assert.match(html, /id="runtimeList"[\s\S]*?id="runtimeOutput"/);
  assert.match(html, /id="runtimeAdapter"[\s\S]*?id="runtimeIdentity"/);
  assert.match(html, /id="runtimeRegistryBtn"[\s\S]*?id="agentRegistryDialog"[\s\S]*?id="discoveredAgentList"/);
  // 场景是满铺裁剪横带（display:block）；多 Agent 终端展开时浮层覆盖内容区
  assert.match(yardStyles, /\.yard-stage\s*\{[\s\S]*?display:\s*block/);
  assert.match(yardStyles, /\.runtime-dock:not\(\[hidden\]\)\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(preload, /listTerminalAdapters:[\s\S]*?runtime:adapters/);
  assert.match(preload, /listTerminalRuntimes:[\s\S]*?runtime:list/);
  assert.match(preload, /pickTerminalWorkspace:[\s\S]*?runtime:pickWorkspace/);
  assert.match(preload, /addCustomAgent:[\s\S]*?runtime:addCustomAdapter/);
  assert.match(preload, /onTerminalEvent:[\s\S]*?runtime:event/);
  assert.match(main, /confirmRuntimeAccess\(\)/);
  assert.match(main, /workspaceGrant\.ownerId !== event\.sender\.id/);
  assert.match(main, /source: 'explicit-grant'/);
  assert.match(main, /resolveRuntimeCwd\([\s\S]{0,180}input\.sessionId/);
  assert.match(main, /runtimeService\.start\(identityProfile/);
  assert.doesNotMatch(main, /runtimeService\.start\([\s\S]{0,220}cwd:\s*input\.cwd/);
});

test('账号管理折叠为单一入口（管理菜单含编辑/移除），账号操作紧凑一行', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  assert.match(html, /<details id="accountManage"[\s\S]*?<div id="yardManageActions"/);
  // 账号操作是 flex 紧凑一行（控制条右侧）
  assert.match(yardStyles, /body\[data-view="yard"\] \.account-actions \{[\s\S]*?display:\s*flex/);
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

test('账号 CRUD 按钮固定在控制条：新增紧跟打开账号、编辑/移除在管理菜单（两视图共用不搬家）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  // 新增紧跟打开账号；编辑/移除静态放在「管理」菜单里
  assert.match(html, /id="launchBtn"[\s\S]*?id="addProfileBtn"/);
  assert.match(html, /id="yardManageActions"[\s\S]*?id="editProfileBtn"[\s\S]*?id="removeProfileBtn"[\s\S]*?<\/div>/);
  // 统一后不再按视图搬家：applyView 不再 insertBefore / sidebarActions.append 这几个按钮
  assert.doesNotMatch(renderer, /accountActions\.insertBefore\(els\.addProfileBtn/);
  assert.doesNotMatch(renderer, /sidebarActions\.append/);
  // 详情空字段折叠：dd 与其前面的 dt 一起隐藏（keep 的字段始终保留）
  assert.match(renderer, /function setDetail\(dd, value/);
  assert.match(renderer, /dd\.hidden = empty;[\s\S]*?if \(dt && dt\.tagName === 'DT'\) dt\.hidden = empty/);
});

test('内嵌控制台默认收起，账本行提供显隐开关', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(html, /id="consoleToggle"[^>]*aria-pressed="false"/);
  assert.match(renderer, /state\.agentConsoleOn = value\.agentConsoleOn === true/);
  assert.match(renderer, /els\.runtimeDock\.hidden = !state\.agentConsoleOn/);
  // hidden 属性要真的隐藏 dock，必须有一条压过 .runtime-dock{display:grid} 的覆盖规则，
  // 否则 JS 设了 hidden 也不生效（浏览器 UA 的 [hidden] 优先级最低）。
  const yardCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  assert.match(yardCss, /\.runtime-dock\[hidden\]\s*\{\s*display:\s*none/);
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
  assert.match(renderer, /selectedId: selectedGroup \? selectedGroup\.primary\.id : state\.selectedProfileId/);
  // 会话合流：组内所有槽位一起列，每条带归属槽位 id，操作按归属槽位走
  assert.match(renderer, /record\) => \(\{ \.\.\.record, _profileId: member\.id \}\)/);
  assert.match(renderer, /sessionOwnerProfile\(session\)\.id/);
  // 排行榜与账号条也按组聚合
  assert.match(renderer, /const rows = identityGroups\(\)\.map/);
  assert.match(renderer, /for \(const group of identityGroups\(\)\) \{/);
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
