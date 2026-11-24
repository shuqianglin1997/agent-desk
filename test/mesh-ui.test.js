const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('设备入口并入设备视角下拉，设备中心使用独立模态弹窗且不改变三面板骨架', () => {
  const html = read('src/index.html');
  const styles = read('src/styles.css');
  const workspaceStyles = read('src/workspace.css');
  const renderer = rendererSource();
  const navStart = html.indexOf('<nav class="topbar-actions"');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);
  const lens = html.slice(html.indexOf('id="deviceLensMenu"'), navStart);
  assert.ok(lens.indexOf('id="deviceCenterBtn"') > 0);
  assert.equal(nav.indexOf('id="deviceCenterBtn"'), -1);
  assert.match(lens, /id="deviceLensOptions"[\s\S]*?id="deviceCenterBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="deviceCenterDialog"/);
  assert.match(html, /id="deviceCenterDialog"[\s\S]*?id="meshEmptyState"[\s\S]*?id="meshReadyState"/);
  assert.match(html, /id="mainGrid" class="workspace-board" data-workspace="sessions" data-detail="session"/);
  assert.doesNotMatch(html, /id="detailSurfaceDevices"/);
  assert.doesNotMatch(renderer, /detailSurfaceDevices|deviceCenterDialog\.show\(\)/);
  assert.match(renderer, /\['devices', els\.deviceCenterBtn, els\.deviceCenterDialog\]/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?dialog\.showModal\(\)/);
  assert.doesNotMatch(workspaceStyles, /--dialog-preferred-height/);
  assert.match(workspaceStyles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*calc\(100dvh/);
  assert.match(workspaceStyles, /dialog \.dialog-body\.utility-dialog-shell\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden/);
  assert.match(workspaceStyles, /--header-h:\s*58px;[\s\S]*?--footer-h:\s*38px;[\s\S]*?--agent-h:\s*222px;[\s\S]*?--detail-w:\s*316px/);
  assert.match(workspaceStyles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-w\);[\s\S]*?grid-template-rows:\s*var\(--agent-h\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.mesh-ready-state\[hidden\],[\s\S]*?\.mesh-empty-state\[hidden\][\s\S]*?display:\s*none/);
});

test('设备 IPC 只暴露固定语义，不提供通用 channel、命令、路径或凭据接口', () => {
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
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
  const main = mainHandlerSource();
  for (const channel of [
    'agentCatalog:list',
    'agentCatalog:get',
    'agentCatalog:create',
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
  const createAgentHandler = main.match(/ipcMain\.handle\('agentCatalog:create'[\s\S]*?\n\s*}\);/)?.[0] || '';
  assert.match(preload, /createAgent:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\('agentCatalog:create', input\)/);
  assert.match(createAgentHandler, /getMeshService\(\)\.createAgent\(\{[\s\S]*?displayName:[\s\S]*?group:[\s\S]*?note:/);
  assert.doesNotMatch(createAgentHandler, /createStoredProfile|assignSlot|profilePath|sessionRoot/);
  assert.match(main, /ipcMain\.handle\('agentSlots:addLocal'[\s\S]*?createStoredProfile\([\s\S]*?assignSlot\(/);
  assert.match(main, /ipcMain\.handle\('agentSlots:removeLocal'[\s\S]*?scope:\s*'slot'/);
  assert.match(main, /function removeStoredProfileRegistration[\s\S]*?saveProfiles\(next\)/);
  assert.doesNotMatch(main, /function removeStoredProfileRegistration[\s\S]{0,500}(rmSync|unlinkSync|rmdirSync)/);
});

test('首次准备只暴露员工、设备、客户端枚举和确认状态，不接受路径或命令', () => {
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
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

test('工作环境始终投影完整员工库，并用同一主按钮确保就绪后打开', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  const projection = read('src/agent-workspace.js');
  assert.match(html, /<script src="\.\/agent-workspace\.js"><\/script>[\s\S]*?<script src="\.\/renderer\.js"><\/script>/);
  assert.match(renderer, /function identityGroupsForLens[\s\S]*?AgentWorkspace\.projectMeshAgentGroups/);
  assert.doesNotMatch(renderer, /if \(!slots\.length\) continue/);
  assert.match(projection, /return \(overview\.agents \|\| \[\]\)\.map/);
  // 打开落在这只猫卡片上显示的运行位置，不选中它，所以正在看的列表不变。
  const launchHandler = renderer.slice(
    renderer.indexOf("card.querySelector('.account-card-launch').addEventListener('click'"),
    renderer.indexOf("card.querySelector('.account-card-manage').addEventListener('click'")
  );
  assert.match(launchHandler, /await openAgent\(agentId\)/);
  assert.doesNotMatch(launchHandler, /activateAccountCard|selectAgent|pickRosterAgent/);
  assert.match(renderer, /function cardActionProfile\(group\) \{[\s\S]*?group\.key === currentAgentId\(\) \? selectedGroupProfile\(group\) : preferredGroupSlot\(group\)/);
  assert.match(renderer, /const profile = cardActionProfile\(group\);\s*const action = currentAgentActionContext\(group, profile\);/);
  assert.match(renderer, /async function openAgent\(agentId\)[\s\S]*?const profile = cardActionProfile\(group\);[\s\S]*?const reselect = \(profileId\) => \(viewing \? profileId : null\);[\s\S]*?ensureAgentReady\(\{[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?requestedAppId:/);
  const openAgentBody = rendererFunction('openAgent');
  assert.doesNotMatch(openAgentBody, /loadProfiles\((?!reselect\()/);
  assert.match(renderer, /deployment\.action\.firstOpen/);
  assert.match(renderer, /if \(group\.members\.length\)[\s\S]*?else \{\s*const apps = supportedProvisioningApps\(\);[\s\S]*?deployment\.client\.unprepared/);
  assert.match(renderer, /resolveUnambiguousLocalSelection\(\{[\s\S]*?overview: state\.mesh\.overview,[\s\S]*?profiles: state\.profiles/);
  assert.match(renderer, /selectedDeviceLensId: currentDeviceLensId\(\)[\s\S]*?selectedAgentIdByDeviceLens:[\s\S]*?selectedSlotKeyByAgentAndLens:/);
  assert.match(renderer, /function selectDeviceLens[\s\S]*?persistUiSelectionMemory\(\)/);
  assert.match(renderer, /function selectAgent[\s\S]*?persistUiSelectionMemory\(\)/);
});

test('全局员工目录通过独立 catalog 通道同步，先于来源设备 inventory 完成', () => {
  const peer = read('src/mesh/main/peer-manager.js');
  const main = mainHandlerSource();
  const service = read('src/mesh/main/mesh-service.js');
  assert.match(peer, /await context\.firstCatalog\.promise;[\s\S]*?await context\.firstInventory\.promise/);
  assert.match(peer, /sendCatalogSnapshot\(context\)[\s\S]*?'catalog\.snapshot', 'catalog\.manage'/);
  assert.match(peer, /messageType === 'catalog\.snapshot'[\s\S]*?applyRemoteCatalog\(\{/);
  assert.match(service, /createCatalogSnapshot\(\)[\s\S]*?buildCatalogSnapshot\(snapshot/);
  assert.match(service, /applyRemoteCatalog\(input = \{\}\)[\s\S]*?mergeCatalogSnapshot\(snapshot, incoming\)/);
  assert.match(main, /function catalogMeshCall\(callback\)[\s\S]*?broadcastCatalog\(\)[\s\S]*?broadcastInventory\(\)/);
});

test('远端已就绪与首次准备共用主按钮，只走窄语义 IPC', () => {
  const html = read('src/index.html');
  const preload = read('src/preload.js');
  const renderer = rendererSource();
  const main = mainHandlerSource();
  const capabilities = read('src/mesh/domain/capabilities.js');
  assert.match(capabilities, /'agent\.prepare': \{ defaultPaired: false, dangerous: true \}/);
  assert.match(html, /data-capability="agent\.prepare"/);
  assert.match(preload, /launchRemoteAgent: \(input\) => ipcRenderer\.invoke\('agentActions:launchRemote', input\)/);
  assert.match(preload, /prepareRemoteAgent: \(input\) => ipcRenderer\.invoke\('agentActions:prepareRemote', input\)/);
  assert.match(renderer, /profile[\s\S]*?launchRemoteAgent\(\{[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?profileId:/);
  assert.match(renderer, /prepareRemoteAgent\(\{[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?requestedAppId:[\s\S]*?requestedClientForm:/);
  assert.match(main, /agentActions:launchRemote[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?profileId:/);
  assert.match(main, /agentActions:prepareRemote[\s\S]*?requestedAppId:[\s\S]*?requestedClientForm:/);
  assert.doesNotMatch(preload, /agentActions:(command|exec|invoke)|remoteCommand|generic\.exec/i);
});

test('公网会合设置与诊断使用固定 IPC，界面不接收 TURN 长期凭据或连接原文', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
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
  const main = mainHandlerSource();
  const html = read('src/index.html');
  assert.match(main, /ipcMain\.handle\('devices:createInvite',[\s\S]*?await openPairingEndpoint\(\)[\s\S]*?createInvite\(\)/);
  assert.match(main, /ipcMain\.handle\('devices:cancelInvite',[\s\S]*?await closePairingEndpoint\(\)/);
  assert.doesNotMatch(main, /app\.whenReady\(\)[\s\S]{0,600}await openPairingEndpoint\(\)/);
  assert.match(html, /id="createDeviceInviteBtn"[\s\S]*?id="meshInvitePanel"|id="meshInvitePanel"[\s\S]*?id="createDeviceInviteBtn"/);
  assert.match(html, /id="devicePermissionsDialog"[\s\S]*?data-capability="screen\.view"[\s\S]*?data-capability="input\.control"/);
});

test('设备中心明确保留账号删到零与不补默认账号的空状态', () => {
  const zh = read('src/i18n/zh.js');
  const renderer = rendererSource();
  assert.match(zh, /当前没有 Agent。账号槽位可以删到零，不会自动补回默认平台账号/);
  assert.match(renderer, /if \(!deviceAgents\.length && !unassignedSlots\.length\)[\s\S]*?devices\.agents\.empty/);
  assert.match(renderer, /unassignedSlots[\s\S]*?catalog\.unassigned\.title[\s\S]*?openSlotAssignmentDialog\(slot\)/);
  assert.match(renderer, /overview\.slots\.filter\(\(slot\) => slot\.agentId === agent\.agentId\)/);
});

test('Agent 管理明确区分新 Agent、新账号绑定、新运行位置和三种移除范围', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  for (const mode of ['new-agent', 'existing-agent', 'existing-binding']) {
    assert.match(html, new RegExp(`value="${mode}"`));
  }
  for (const scope of ['slot', 'account-binding', 'agent']) {
    assert.match(html, new RegExp(`name="catalogRemoveScope" value="${scope}"`));
  }
  assert.match(html, /id="agentRelationsDialog"[\s\S]*?id="mergeAgentTarget"[\s\S]*?id="splitAccountBinding"/);
  assert.match(html, /id="agentCreateDialog"[\s\S]*?id="newAgentName"[\s\S]*?id="confirmAddAgentBtn"/);
  assert.match(html, /id="agentManageDialog"[\s\S]*?id="agentManageLocations"[\s\S]*?id="yardManageActions"[\s\S]*?id="addRuntimeLocationBtn"/);
  // “招募”打开统一的招募弹窗；在官方窗口登录时，已建好设备网且客户端支持首次准备的，仍走新建 Agent 与首次准备。
  assert.match(renderer, /addProfileBtn\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('new'\)/);
  assert.match(renderer, /function confirmAgentCreation\(\)[\s\S]*?createAgentAndPrepare\(\{/);
  assert.match(renderer, /async function createAgentAndPrepare\([\s\S]*?manager\.createAgent\(\{[\s\S]*?displayName,[\s\S]*?baseRevision:\s*currentCatalogRevision\(\)[\s\S]*?ensureAgentReady\(/);
  assert.match(renderer, /createWithMesh: \(\{ displayName, appId \}\) => createAgentAndPrepare\(/);
  // 档案里的动作作用于被操作的那只猫，它可以不是正在看的那只。
  assert.match(renderer, /addRuntimeLocationBtn\?\.addEventListener\('click'[\s\S]*?openProfileCreationDialog\(\{ agentId:\s*actionAgentId\(\) }\)/);
  assert.match(renderer, /function actionAgentId\(\) \{[\s\S]*?state\.actionAgentId[\s\S]*?return currentAgentId\(\);/);
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
  const renderer = rendererSource();
  const main = mainHandlerSource();
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

test('会话发送从会话工具栏的“送出”发起，只提交稳定 ID，项目根由 Main 选择', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  const activity = html.slice(html.indexOf('id="activityCenterDialog"'));
  const sessionPane = html.slice(html.indexOf('id="sessionPane"'), html.indexOf('id="detailPanel"'));
  assert.match(sessionPane, /id="sessionSendMenu"[\s\S]*?id="sendSessionInfoBtn"/);
  assert.doesNotMatch(activity, /id="sendSessionInfoBtn"/);
  assert.match(renderer, /conversationId:\s*session\.conversationId,[\s\S]{0,100}replicaId:\s*session\._replicaId/);
  assert.doesNotMatch(renderer, /createSessionPointerTransfer\(\{[^}]*projectPath|chooseProjectBinding\(\{[^}]*localRoot/);
  assert.match(preload, /ipcRenderer\.invoke\('transfers:createSessionPointer'/);
  assert.match(main, /ipcMain\.handle\('transfers:createSessionPointer'/);
  assert.match(main, /ipcMain\.handle\('projects:chooseBinding'[\s\S]*?dialog\.showOpenDialog/);
  assert.match(html, /不生成交接模板/);
  assert.match(renderer, /const keyState = state\.mesh\.overview\?\.keyState \|\| 'available';[\s\S]*?keyState === 'available'[\s\S]*?await loadMeshSessions\(null, \{ generation \}\)[\s\S]*?loadLocalSessions\(\{ source: 'local-fallback', generation \}\)/);
  assert.match(renderer, /loadDeviceOverview\(\{ requestSecureAccess: true \}\)/);
  assert.match(renderer, /function loadMeshSessions[\s\S]*?return \{ ok: false, reasonCode:[\s\S]*?state\.mesh\.sessionSource = 'mesh'/);
  assert.match(renderer, /const localProfileIds = new Set\(state\.profiles[\s\S]*?if \(!localProfileIds\.has\(String\(member\.id\)\)\) continue/);
  assert.match(renderer, /function crossDeviceActionsPaused[\s\S]*?sessionSource === 'local-fallback'[\s\S]*?sessionErrorCode/);
  assert.match(renderer, /function directTaskPackageTargets\(\) \{[\s\S]*?if \(crossDeviceActionsPaused\(\)\) return \[\]/);
  for (const locale of ['zh', 'en', 'ja']) {
    const dictionary = read(`src/i18n/${locale}.js`);
    assert.match(dictionary, /'status\.sessionsLocalFallback':/);
    assert.match(dictionary, /'status\.sessionsRemoteUnavailable':/);
    assert.match(dictionary, /'status\.crossDevicePaused':/);
  }
});

test('文件传输路径只来自 Main 系统选择器，Renderer 只提交设备和传输 ID', () => {
  const html = read('src/index.html');
  const renderer = rendererSource();
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
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
