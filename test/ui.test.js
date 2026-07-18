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
