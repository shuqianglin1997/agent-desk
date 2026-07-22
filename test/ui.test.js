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

test('庭院采用左侧主场景和右侧可滚动信息轨道，窄屏会纵向回流', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  assert.match(html, /<div class="workspace-panel">[\s\S]*?<section class="account-bar">/);
  assert.match(yardStyles, /grid-template-columns:\s*minmax\(0, 3fr\) minmax\(340px, 1fr\)/);
  assert.match(yardStyles, /\.workspace-panel\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(yardStyles, /@media \(max-width: 900px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
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
  // 控制台收起后 stage 三行全 auto（无空转 1fr）；展开时按固定高度出现
  assert.match(yardStyles, /\.yard-stage\s*\{[\s\S]*?grid-template-rows:\s*auto auto auto/);
  assert.match(yardStyles, /\.runtime-dock:not\(\[hidden\]\)\s*\{\s*height:/);
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

test('账号管理折叠为单一入口，最小高度下仍给会话列表留出可见空间', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const yardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'yard.css'), 'utf8');
  assert.match(html, /<details id="accountManage"[\s\S]*?<div id="yardManageActions"/);
  assert.match(yardStyles, /@media \(max-height: 700px\)[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
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

test('不可 launch 的 CLI 槽位禁用打开按钮，账号行展示并行会话与同账号徽章', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(renderer, /canLaunch: a\.canLaunch !== false/);
  assert.match(renderer, /els\.launchBtn\.disabled = disabled \|\| !canLaunch/);
  assert.match(renderer, /activeNow/);
  assert.match(renderer, /identityPeersOf/);
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
