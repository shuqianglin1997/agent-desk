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
  assert.match(yardStyles, /grid-template-rows:\s*auto auto minmax\(170px, 1fr\)/);
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
