const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function dialogSlice(html, id) {
  const start = html.indexOf(`id="${id}"`);
  return html.slice(start, html.indexOf('</dialog>', start));
}

test('任务交接只作为单会话次级动作，并把导入与历史放入活动弹窗', () => {
  const html = read('src/index.html');
  const focusedActions = html.slice(
    html.indexOf('id="sessionFocusedActions"'),
    html.indexOf('</div>', html.indexOf('id="sessionFocusedActions"'))
  );
  assert.match(focusedActions, /id="openSessionFileBtn"[\s\S]*?id="taskPackageActionBtn"[\s\S]*?id="exportSessionBtn"/);
  assert.doesNotMatch(focusedActions, /class="[^"]*primary/);

  const activity = dialogSlice(html, 'activityCenterDialog');
  assert.match(activity, /id="importTaskPackageBtn"[\s\S]*?id="taskPackageHistory"/);
  assert.doesNotMatch(html, /handoffBulkBar|copySelectedHandoffBtn|handoffPlan/);
});

test('任务包导出与导入弹窗固定头尾，仅内容区滚动且关闭始终在顶部', () => {
  const html = read('src/index.html');
  const styles = read('src/workspace.css');
  for (const [id, closeId, cancelId] of [
    ['taskPackageDialog', 'taskPackageCloseBtn', 'taskPackageCancelBtn'],
    ['taskPackageImportDialog', 'taskPackageImportCloseBtn', 'taskPackageImportCancelBtn']
  ]) {
    const dialog = dialogSlice(html, id);
    assert.match(dialog, /class="dialog-body utility-dialog-shell child-dialog-shell"/);
    assert.match(dialog, new RegExp(`utility-dialog-header[\\s\\S]*?id="${closeId}"[\\s\\S]*?utility-dialog-content[\\s\\S]*?utility-dialog-footer[\\s\\S]*?id="${cancelId}"`));
  }
  assert.match(styles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.utility-dialog-content\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.utility-dialog-header,[\s\S]*?\.utility-dialog-footer\s*\{[\s\S]*?flex:\s*none/);
  assert.match(dialogSlice(html, 'taskPackageDialog'), /id="taskPackageObjective"[^>]*required/);
  assert.match(styles, /\.task-package-import-preview-details\s*\{[\s\S]*?grid-template-columns/);
});

test('接收方在选择目标 Agent 前能看到人工检查点、项目状态与附件数量', () => {
  const renderer = read('src/renderer.js');
  assert.match(renderer, /renderTaskPackageImportPreview[\s\S]*?taskPackage\.objective[\s\S]*?taskPackage\.completed[\s\S]*?taskPackage\.next/);
  assert.match(renderer, /taskPackage\.blockers[\s\S]*?taskPackage\.acceptance[\s\S]*?preview\.project/);
  assert.match(renderer, /entry\.kind === 'attachment'[\s\S]*?preview\.attachmentCount/);
});

test('任务包 IPC 保持窄桥接，Main 负责选择路径并重新解析 Profile 与 Session', () => {
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  const apps = read('src/apps.js');
  assert.match(preload, /previewTaskPackageExport:[\s\S]*?exportTaskPackage:[\s\S]*?chooseTaskPackageImport:[\s\S]*?commitTaskPackageImport:/);
  assert.doesNotMatch(preload, /taskPackages:invoke|taskPackages:openPath/);
  assert.match(main, /ipcMain\.handle\('taskPackages:export'[\s\S]*?showSaveDialog[\s\S]*?exportPackage/);
  assert.match(main, /ipcMain\.handle\('taskPackages:commitImport'[\s\S]*?showOpenDialog[\s\S]*?commitImport/);
  assert.match(apps, /taskPackageMode:\s*id === 'codex'[\s\S]*?'native'[\s\S]*?'transcript'[\s\S]*?'unsupported'/);
});
