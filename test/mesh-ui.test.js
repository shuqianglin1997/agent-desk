const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('设备入口位于工具之前，设备中心使用独立模态弹窗且不改变三面板骨架', () => {
  const html = read('src/index.html');
  const styles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');
  const renderer = read('src/renderer.js');
  const navStart = html.indexOf('<nav class="topbar-actions"');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);
  assert.ok(nav.indexOf('id="deviceCenterBtn"') > 0);
  assert.ok(nav.indexOf('id="deviceCenterBtn"') < nav.indexOf('id="toolCenterBtn"'));
  assert.match(nav, /id="deviceCenterBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="deviceCenterDialog"/);
  assert.match(html, /id="deviceCenterDialog"[\s\S]*?id="meshEmptyState"[\s\S]*?id="meshReadyState"/);
  assert.match(html, /id="mainGrid" class="workspace-board" data-workspace="sessions" data-detail="session"/);
  assert.doesNotMatch(html, /id="detailSurfaceDevices"/);
  assert.doesNotMatch(renderer, /detailSurfaceDevices|deviceCenterDialog\.show\(\)/);
  assert.match(renderer, /\['devices', els\.deviceCenterBtn, els\.deviceCenterDialog\]/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?dialog\.showModal\(\)/);
  assert.match(workspaceStyles, /\.device-center-dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?--dialog-preferred-height:\s*680px/);
  assert.match(workspaceStyles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden/);
  assert.match(workspaceStyles, /--header-h:\s*58px;[\s\S]*?--footer-h:\s*38px;[\s\S]*?--agent-h:\s*244px;[\s\S]*?--detail-w:\s*316px/);
  assert.match(workspaceStyles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-w\);[\s\S]*?grid-template-rows:\s*var\(--agent-h\) minmax\(0, 1fr\)/);
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
    'devices:revoke',
    'remoteInventory:refresh'
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

test('Agent 目录与 Slot 管理只通过固定语义 IPC 暴露', () => {
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  for (const channel of [
    'agentCatalog:list',
    'agentCatalog:get',
    'agentCatalog:rename',
    'agentCatalog:merge',
    'agentCatalog:split',
    'agentCatalog:delete',
    'agentCatalog:removeBinding',
    'agentSlots:list',
    'agentSlots:addLocal',
    'agentSlots:assign',
    'agentSlots:removeLocal'
  ]) {
    assert.ok(main.includes(`ipcMain.handle('${channel}'`), `${channel} missing in main`);
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), `${channel} missing in preload`);
  }
  assert.doesNotMatch(preload, /agentCatalog:[^'"\n]*(command|path|exec)|agentSlots:[^'"\n]*(command|path|exec)/i);
  assert.match(main, /ipcMain\.handle\('agentSlots:addLocal'[\s\S]*?createStoredProfile\([\s\S]*?assignSlot\(/);
  assert.match(main, /ipcMain\.handle\('agentSlots:removeLocal'[\s\S]*?scope:\s*'slot'/);
  assert.match(main, /function removeStoredProfileRegistration[\s\S]*?saveProfiles\(next\)/);
  assert.doesNotMatch(main, /function removeStoredProfileRegistration[\s\S]{0,500}(rmSync|unlinkSync|rmdirSync)/);
});

test('首次准备只暴露员工、设备、客户端枚举和确认状态，不接受路径或命令', () => {
  const preload = read('src/preload.js');
  const main = read('src/main.js');
  for (const channel of [
    'agentDeployments:ensureReady',
    'agentDeployments:retryPreparation',
    'agentDeployments:cancelPreparation'
  ]) {
    assert.ok(main.includes(`ipcMain.handle('${channel}'`), `${channel} missing in main`);
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), `${channel} missing in preload`);
  }
  assert.match(main, /ipcMain\.handle\('agentDeployments:ensureReady'[\s\S]*?agentId:\s*boundedText\(input\.agentId[\s\S]*?deviceId:\s*boundedText\(input\.deviceId[\s\S]*?requestedAppId:\s*boundedText\(input\.requestedAppId[\s\S]*?requestedClientForm:\s*boundedText\(input\.requestedClientForm/);
  assert.doesNotMatch(
    main.match(/ipcMain\.handle\('agentDeployments:ensureReady'[\s\S]*?\n\s*}\);/)?.[0] || '',
    /input\.(path|profilePath|sessionRoot|command|argv|url|environment|token|cookie)/i
  );
  assert.doesNotMatch(preload, /agentDeployments:[^'"\n]*(command|path|exec|token|cookie)/i);
  assert.match(main, /getProvisioningService\(\)\.resumeActiveJobs\(\)/);
  assert.match(main, /provisioningService\?\.stop\(\)/);
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
  assert.match(renderer, /if \(!deviceAgents\.length && !unassignedSlots\.length\)[\s\S]*?devices\.agents\.empty/);
  assert.match(renderer, /unassignedSlots[\s\S]*?catalog\.unassigned\.title[\s\S]*?openSlotAssignmentDialog\(slot\)/);
  assert.match(renderer, /overview\.slots\.filter\(\(slot\) => slot\.agentId === agent\.agentId\)/);
});

test('Agent 管理明确区分新 Agent、新账号绑定、新运行位置和三种移除范围', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  for (const mode of ['new-agent', 'existing-agent', 'existing-binding']) {
    assert.match(html, new RegExp(`value="${mode}"`));
  }
  for (const scope of ['slot', 'account-binding', 'agent']) {
    assert.match(html, new RegExp(`name="catalogRemoveScope" value="${scope}"`));
  }
  assert.match(html, /id="agentRelationsDialog"[\s\S]*?id="mergeAgentTarget"[\s\S]*?id="splitAccountBinding"/);
  assert.match(renderer, /addLocalAgentSlot\(\{[\s\S]*?mode,[\s\S]*?accountBindingId/);
  assert.match(renderer, /removeLocalAgentSlot\(\{[\s\S]*?deviceId:[\s\S]*?profileId:/);
  assert.match(renderer, /removeAccountBinding\(\{[\s\S]*?accountBindingId:/);
  assert.match(renderer, /deleteAgent\(\{[\s\S]*?agentId:/);
  assert.match(renderer, /baseRevision:\s*currentCatalogRevision\(\)/);
  assert.match(html, /<label id="editIdentityField">[\s\S]*?id="editIdentity"/);
  assert.doesNotMatch(html, /<label id="editIdentityField">[\s\S]{0,160}id="editName"/);
  assert.match(renderer, /function fillAgentAssignmentSelect[\s\S]*?catalog\.assignment\.choose[\s\S]*?\? previous : ''/);
  assert.match(renderer, /newProfileAgent\?\.addEventListener\('change'[\s\S]*?syncProfileAssignmentControls/);
  assert.match(renderer, /slotAssignmentAgent\?\.addEventListener\('change'[\s\S]*?syncSlotAssignmentControls/);
  assert.match(renderer, /mergeAgentTarget\?\.addEventListener\('change'[\s\S]*?confirmMergeAgentBtn\.disabled/);
  assert.match(renderer, /function openAgentOrProfileEditor\(\)[\s\S]*?if \(meshMode\)[\s\S]*?const profile = selectedProfile\(\)/);
  assert.match(renderer, /function openAgentOrProfileRemoval\(\)[\s\S]*?if \(!agent\) return;[\s\S]*?const slot = catalogSlotByKey\(profile\?\._meshSlotKey/);
  assert.match(renderer, /removeProfileBtn\.disabled = meshMode \? !selectedAgent/);
  assert.match(renderer, /if \(scope !== 'agent' && !context\.slot\) return/);
  assert.doesNotMatch(renderer, /remove(Profile|LocalAgentSlot)\([^)]*(filePath|profilePath|sessionRoot)/);
});

test('远控返回保留后台查看提示，断开才移除；错误按真实原因分类', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const main = read('src/main.js');
  const service = read('src/mesh/main/remote-control-service.js');
  assert.match(html, /id="remoteActivityBtn"[^>]*aria-live="polite"/);
  assert.match(renderer, /function activeOutgoingRemoteSessions[\s\S]*?direction === 'outgoing'[\s\S]*?error', 'rejected', 'disconnected/);
  assert.match(renderer, /function renderRemoteActivity[\s\S]*?activeOutgoingRemoteSessions\(\)[\s\S]*?remote\.background\.button/);
  assert.match(renderer, /returnRemoteControl\(state\.ui\.activeRemoteSessionId\)/);
  assert.match(renderer, /onRemoteControlReturn[\s\S]*?returnFromRemote[\s\S]*?remoteAlreadyReleased:\s*true/);
  assert.match(main, /ipcMain\.handle\('remoteControl:return'[\s\S]*?returnToWorkspace/);
  assert.match(service, /async returnToWorkspace[\s\S]*?releaseControl[\s\S]*?visible:\s*false[\s\S]*?sessions:\s*this\.list\(\)/);
  for (const category of [
    'offline', 'revoked', 'version', 'screenPermission', 'inputPermission',
    'rejected', 'exclusive', 'directFailedRelay', 'relayUnavailable', 'unreachable'
  ]) {
    assert.ok(renderer.includes(`remote.error.${category}`), `remote error category ${category} missing`);
  }
  assert.match(renderer, /capability-denied:screen\\\.view/);
  assert.match(renderer, /input-busy\|input-target-conflict/);
  assert.match(renderer, /const canReachRemote = Boolean\(remoteSession\)[\s\S]*?device\.status === 'online'/);
  assert.match(renderer, /disabled: state\.mesh\.loading \|\| !canView \|\| !canReachRemote/);
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
  const sessionDialog = html.slice(
    html.indexOf('id="sessionSendDialog"'),
    html.indexOf('</dialog>', html.indexOf('id="sessionSendDialog"'))
  );
  const fileDialog = html.slice(
    html.indexOf('id="fileSendDialog"'),
    html.indexOf('</dialog>', html.indexOf('id="fileSendDialog"'))
  );
  assert.match(sessionDialog, /id="sessionSendTarget"[\s\S]*?id="confirmSessionSendBtn"/);
  assert.doesNotMatch(sessionDialog, /id="fileSendTarget"|id="chooseFilesBtn"/);
  assert.match(fileDialog, /id="fileSendTarget"[\s\S]*?id="chooseFilesBtn"/);
  assert.doesNotMatch(fileDialog, /id="sessionSendTarget"|id="confirmSessionSendBtn"/);
  assert.match(renderer, /function openFileSendDialog[\s\S]*?UiContext\.createFileDraft\(/);
  assert.match(renderer, /chooseFileTransfer\(\{ targetDeviceId \}\)/);
  assert.match(renderer, /acceptFileTransfer\(transfer\.transferId\)/);
  assert.doesNotMatch(renderer, /chooseFileTransfer\(\{[^}]*filePaths|acceptFileTransfer\([^)]*,/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:chooseFiles'/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:acceptFile'/);
  assert.match(main, /ipcMain\.handle\('transfers:chooseFiles'[\s\S]*?properties: \['openFile', 'multiSelections'\]/);
  assert.match(main, /ipcMain\.handle\('transfers:acceptFile'[\s\S]*?properties: \['openDirectory', 'createDirectory'\]/);
  assert.match(main, /createFileTransfer\(\{[\s\S]*?filePaths: result\.filePaths/);
});
