const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('设备入口位于工具之前，设备中心只切换第六行且不改动七行骨架', () => {
  const html = read('src/index.html');
  const styles = read('src/styles.css');
  const renderer = read('src/renderer.js');
  const navStart = html.indexOf('<nav class="topbar-actions"');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);
  assert.ok(nav.indexOf('id="deviceCenterBtn"') > 0);
  assert.ok(nav.indexOf('id="deviceCenterBtn"') < nav.indexOf('id="toolCenterBtn"'));
  assert.match(html, /id="deviceCenterDialog"[\s\S]*?id="meshEmptyState"[\s\S]*?id="meshReadyState"/);
  assert.match(html, /id="mainGrid" class="main-grid" data-workspace="sessions"/);
  assert.match(renderer, /mainGrid\.append\(els\.deviceCenterDialog\)/);
  assert.match(renderer, /deviceCenterDialog\.show\(\)/);
  assert.doesNotMatch(renderer, /deviceCenterDialog\.showModal\(\)/);
  assert.match(styles, /\.main-grid > \.device-center-dialog\[open\][\s\S]*?grid-column:\s*1 \/ -1/);
  assert.match(styles, /\.app-shell \{[\s\S]*?grid-template-rows:\s*48px auto auto auto auto minmax\(0, 1fr\) 28px/);
  assert.match(styles, /\.mesh-ready-state\[hidden\],[\s\S]*?\.mesh-empty-state\[hidden\][\s\S]*?display:\s*none/);
});

test('设备 IPC 只暴露固定语义，不提供通用 channel、命令、路径或凭据接口', () => {
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  for (const channel of [
    'devices:list',
    'devices:initialize',
    'devices:rename',
    'devices:resetMesh',
    'devices:createInvite',
    'devices:cancelInvite',
    'devices:join',
    'devices:getDiagnostics',
    'devices:getNetworkConfig',
    'devices:updateNetworkConfig',
    'devices:updatePermissions',
    'devices:revoke'
  ]) {
    assert.ok(main.includes(`ipcMain.handle('${channel}'`), `${channel} missing in main`);
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), `${channel} missing in preload`);
  }
  assert.doesNotMatch(preload, /^\s*(invoke|on):\s*\(|remoteCommand|generic\.exec|shell\.run/m);
  assert.doesNotMatch(preload, /turnSecret|turnCredential|privateKey|devicePrivateKey/);
  assert.doesNotMatch(main, /ipcMain\.handle\('devices:[^']+',[^\n]*argv|remoteCommand|generic\.exec/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /path\.join\(userData, 'mesh\.db'\)/);
  assert.match(main, /path\.join\(userData, 'mesh-keys\.json'\)/);
});

test('公网会合设置与诊断使用固定 IPC，界面不接收 TURN 长期凭据或连接原文', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  assert.match(html, /id="networkSettingsBtn"[\s\S]*?id="meshNetworkDialog"/);
  assert.match(html, /id="meshSignalingUrls"[\s\S]*?id="meshStunUrls"/);
  assert.doesNotMatch(html, /id="[^"\n]*(turn|credential)|<(input|textarea)[^>]*(turn|credential)/i);
  assert.match(preload, /getDeviceDiagnostics: \(deviceId\) => ipcRenderer\.invoke\('devices:getDiagnostics'/);
  assert.match(preload, /updateDeviceNetworkConfig: \(input\) => ipcRenderer\.invoke\('devices:updateNetworkConfig'/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\([^'"\n]|ipcRenderer\.on\([^'"\n]/);
  assert.match(main, /ipcMain\.handle\('devices:updateNetworkConfig'[\s\S]*?normalizeServiceUrls\(input\.signalingUrls\)[\s\S]*?normalizeStunUrls\(input\.stunUrls\)/);
  assert.match(main, /deviceDiagnostics\([\s\S]*?candidateTypes[\s\S]*?protocols[\s\S]*?selectedPairState/);
  assert.doesNotMatch(renderer, /candidate\.address|localDescription|remoteDescription|turnSecret|turnUsername|turnCredential\b|devicePrivateKey/);
});

test('局域网配对端口只在用户创建邀请后临时开启，取消邀请会立即关闭', () => {
  const main = read('src/main.js');
  const html = read('src/index.html');
  assert.match(main, /ipcMain\.handle\('devices:createInvite',[\s\S]*?await openPairingEndpoint\(\)[\s\S]*?createInvite\(\)/);
  assert.match(main, /ipcMain\.handle\('devices:cancelInvite',[\s\S]*?await closePairingEndpoint\(\)/);
  assert.doesNotMatch(main, /app\.whenReady\(\)[\s\S]{0,600}await openPairingEndpoint\(\)/);
  assert.match(html, /id="createDeviceInviteBtn"[\s\S]*?id="meshInvitePanel"|id="meshInvitePanel"[\s\S]*?id="createDeviceInviteBtn"/);
  assert.match(html, /id="devicePermissionsDialog"[\s\S]*?data-capability="screen\.view"[\s\S]*?data-capability="input\.control"/);
});

test('设备中心明确保留账号删到零与不补默认账号的空状态', () => {
  const zh = read('src/i18n/zh.js');
  const renderer = read('src/renderer.js');
  assert.match(zh, /当前没有 Agent。账号槽位可以删到零，不会自动补回默认平台账号/);
  assert.match(renderer, /if \(!overview\.agents\.length\)[\s\S]*?devices\.agents\.empty/);
  assert.match(renderer, /overview\.slots\.filter\(\(slot\) => slot\.agentId === agent\.agentId\)/);
});

test('会话发送是复制主按钮旁的次级动作，只提交稳定 ID，项目根由 Main 选择', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  assert.match(html, /id="copySessionInfoBtn"[\s\S]{0,300}id="sendSessionInfoBtn" class="session-send-info"/);
  assert.match(renderer, /conversationId:\s*session\.conversationId,[\s\S]{0,100}replicaId:\s*session\._replicaId/);
  assert.doesNotMatch(renderer, /createSessionPointerTransfer\(\{[^}]*projectPath|chooseProjectBinding\(\{[^}]*localRoot/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:createSessionPointer'/);
  assert.match(main, /ipcMain\.handle\('transfers:createSessionPointer'/);
  assert.match(main, /ipcMain\.handle\('projects:chooseBinding'[\s\S]*?dialog\.showOpenDialog/);
  assert.match(html, /不生成交接模板/);
});

test('文件传输路径只来自 Main 系统选择器，Renderer 只提交设备和传输 ID', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  assert.match(html, /id="chooseFilesBtn"[\s\S]{0,180}id="confirmSessionSendBtn"/);
  assert.match(renderer, /chooseFileTransfer\(\{ targetDeviceId \}\)/);
  assert.match(renderer, /acceptFileTransfer\(transfer\.transferId\)/);
  assert.doesNotMatch(renderer, /chooseFileTransfer\(\{[^}]*filePaths|acceptFileTransfer\([^)]*,/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:chooseFiles'/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:acceptFile'/);
  assert.match(main, /ipcMain\.handle\('transfers:chooseFiles'[\s\S]*?properties: \['openFile', 'multiSelections'\]/);
  assert.match(main, /ipcMain\.handle\('transfers:acceptFile'[\s\S]*?properties: \['openDirectory', 'createDirectory'\]/);
  assert.match(main, /createFileTransfer\(\{[\s\S]*?filePaths: result\.filePaths/);
});
