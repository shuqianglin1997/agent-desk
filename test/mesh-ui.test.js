const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');
const { page, styleRules, loadPreload, commandFor, runCommand } = require('./helpers/behaviour');
const { LOCALES, mt } = require('../src/i18n/main-i18n');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const doc = page();
const inOrder = (...ids) => { const at = ids.map((id) => doc.index(doc.byId(id))); return at.every((i) => i >= 0) && at.every((v, k) => k === 0 || at[k - 1] < v); };
const inside = (id, containerId) => Boolean(doc.byId(id) && doc.byId(containerId) && doc.within(doc.byId(id), doc.byId(containerId)));
const bounded = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const plain = (value) => JSON.parse(JSON.stringify(value));

// Each channel is a command in the table, and the preload method the command
// names reaches exactly that channel.
function assertFixedChannels(channels) {
  const { api, calls } = loadPreload();
  for (const channel of channels) {
    const command = commandFor(channel);
    assert.ok(command.preload?.length, `${channel} has a preload method`);
    for (const name of command.preload) {
      calls.length = 0;
      api[name]({});
      assert.equal(calls[0]?.[1], channel, `${name} reaches ${channel}`);
    }
  }
}

test('设备入口并入设备视角下拉，设备中心使用独立模态弹窗且不改变三面板骨架', () => {
  const renderer = rendererSource();
  const nav = doc.all((el) => el.tag === 'nav' && doc.hasClass(el, 'topbar-actions'))[0];
  assert.ok(inside('deviceCenterBtn', 'deviceLensMenu') && !doc.within(doc.byId('deviceCenterBtn'), nav), 'device management is the lens menu\'s last item');
  assert.ok(inOrder('deviceLensOptions', 'deviceCenterBtn'));
  const deviceButton = doc.byId('deviceCenterBtn').attrs;
  assert.deepEqual([deviceButton['aria-haspopup'], deviceButton['aria-controls']], ['dialog', 'deviceCenterDialog']);
  assert.ok(inside('meshEmptyState', 'deviceCenterDialog') && inside('meshReadyState', 'deviceCenterDialog') && inOrder('meshEmptyState', 'meshReadyState'));
  const grid = doc.byId('mainGrid').attrs;
  assert.deepEqual([grid.class, grid['data-workspace'], grid['data-detail']], ['workspace-board', 'sessions', 'session']);
  assert.ok(!doc.byId('detailSurfaceDevices'));
  assert.doesNotMatch(renderer, /detailSurfaceDevices|deviceCenterDialog\.show\(\)/);
  assert.match(renderer, /\['devices', els\.deviceCenterBtn, els\.deviceCenterDialog\]/);
  assert.match(renderer, /function openUtilityDialog\(kind\)[\s\S]*?openDialog\(dialog\)/);
  assert.deepEqual(styleRules(null).filter((rule) => '--dialog-preferred-height' in rule.decls), []);
  // Height comes from the pixel skin's rule for the shell (unlayered, so it always
  // wins); the clipping is the shell's structure rule in the same sheet.
  const shell = styleRules('dialog .dialog-body.utility-dialog-shell', ['src/pixel.css']).filter((rule) => !rule.conditional);
  assert.ok(shell.some((rule) => rule.layer === null && rule.decls.height === 'auto' && rule.decls['min-height'] === '0' && /^calc\(100dvh/.test(rule.decls['max-height'] || '')));
  assert.ok(shell.some((rule) => rule.decls.overflow === 'hidden'));
  const tokens = Object.assign({}, ...styleRules(':root', ['src/pixel.css']).filter((rule) => rule.layer === 'tokens' && !rule.conditional).map((rule) => rule.decls));
  assert.deepEqual([tokens['--header-h'], tokens['--footer-h'], tokens['--agent-h'], tokens['--detail-w']], ['58px', '38px', '222px', '316px']);
  assert.ok(styleRules('.workspace-board', ['src/workspace.css']).some((rule) => !rule.conditional && rule.decls['grid-template-columns'] === 'minmax(0, 1fr) var(--detail-w)' && rule.decls['grid-template-rows'] === 'var(--agent-h) minmax(0, 1fr)'));
  assert.ok(styleRules('.mesh-ready-state[hidden]').some((rule) => rule.selectors.includes('.mesh-empty-state[hidden]') && /^none/.test(rule.decls.display)));
});

test('设备 IPC 只暴露固定语义，不提供通用 channel、命令、路径或凭据接口', () => {
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  assertFixedChannels([
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
  ]);
  // What stays a text search: the preload whitelist must not grow a generic
  // invoke/on or carry key material, and Main's key and store wiring runs in
  // Electron's app object, which Node tests don't have.
  assert.doesNotMatch(preload, /^\s*(invoke|on):\s*\(|remoteCommand|generic\.exec|shell\.run/m);
  assert.doesNotMatch(preload, /turnSecret|turnCredential|privateKey|devicePrivateKey/);
  assert.doesNotMatch(main, /ipcMain\.handle\('devices:[^']+',[^\n]*argv|remoteCommand|generic\.exec/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /path\.join\(userData, 'mesh\.db'\)/);
  assert.match(main, /path\.join\(userData, 'mesh-keys\.json'\)/);
});

test('Agent 目录与 Slot 管理只通过固定语义 IPC 暴露', async (t) => {
  const preload = read('src/preload.js');
  assertFixedChannels([
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
  ]);
  assert.doesNotMatch(preload, /agentCatalog:[^'"\n]*(command|path|exec)|agentSlots:[^'"\n]*(command|path|exec)/i);

  // Creating an Agent passes on only its name, group, note and base revision:
  // no location is made and no path is read.
  const seen = [];
  const agents = [];
  const mesh = {
    getOverview: () => ({ initialized: true, localDeviceId: 'dev-1', agents: [...agents] }),
    createAgent: (input) => { seen.push(['createAgent', input]); agents.push({ agentId: 'a-new' }); return { agents: [...agents] }; },
    assignSlot: (input) => { seen.push(['assignSlot', input.profileId, input.mode]); return { agents }; },
    removeCatalogObject: (input) => { seen.push(['remove', input]); return { agents }; }
  };
  const deps = {
    boundedText: bounded,
    finiteRevision: (value) => (Number.isFinite(value) ? value : null),
    getMeshService: () => mesh,
    peerManager: null,
    withMeshRuntime: (overview) => overview,
    createStoredProfile: (input) => { seen.push(['createStoredProfile', input.appId]); return { id: 'p-new' }; },
    removeStoredProfileRegistration: () => {},
    catalogMeshCall: (callback) => callback()
  };
  const created = await runCommand('agentCatalog:create', deps, { displayName: 'A', group: 'g', note: 'n', baseRevision: 3, profilePath: '/x', sessionRoot: '/y' });
  assert.equal(created.ok, true);
  assert.deepEqual(seen, [['createAgent', { displayName: 'A', group: 'g', note: 'n', baseRevision: 3 }]]);
  // A new local location stores the profile first, then assigns its slot.
  seen.length = 0;
  await runCommand('agentSlots:addLocal', deps, { appId: 'codex', name: 'w', mode: 'new-agent' });
  assert.deepEqual(seen, [['createStoredProfile', 'codex'], ['assignSlot', 'p-new', 'new-agent']]);
  // Removing a local location removes the slot, only.
  seen.length = 0;
  await runCommand('agentSlots:removeLocal', deps, { deviceId: 'dev-1', profileId: 'p1', baseRevision: 4, scope: 'agent' });
  assert.deepEqual(seen, [['remove', { scope: 'slot', deviceId: 'dev-1', profileId: 'p1', baseRevision: 4 }]]);

  // Removing a registration rewrites profiles.json and leaves the folder alone.
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'agentdesk-registration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'kept.txt'), 'x');
  let saved = null;
  const accounts = require('../src/main/accounts');
  accounts.bind({ loadProfiles: () => [{ id: 'p1', profilePath: dir }, { id: 'p2' }], saveProfiles: (next) => { saved = next; }, quotaService: { invalidate() {} } });
  assert.equal(accounts.removeStoredProfileRegistration('p1'), true);
  assert.deepEqual(saved.map((profile) => profile.id), ['p2']);
  assert.equal(fs.readFileSync(path.join(dir, 'kept.txt'), 'utf8'), 'x');
  assert.equal(accounts.removeStoredProfileRegistration('missing'), false);
});

test('首次准备只暴露员工、设备、客户端枚举和确认状态，不接受路径或命令', async () => {
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  assertFixedChannels(['agentDeployments:ensureReady', 'agentDeployments:retryPreparation', 'agentDeployments:cancelPreparation']);
  let request = null;
  await runCommand('agentDeployments:ensureReady', {
    boundedText: bounded,
    getProvisioningService: () => ({ ensureReady: async (input) => { request = input; return { ok: true }; } }),
    publicProvisioningResult: (result) => result
  }, { agentId: 'a1', deviceId: 'd1', requestedAppId: 'codex', path: '/x', profilePath: '/x', sessionRoot: '/y', command: 'sh', argv: ['-c'], url: 'https://x', environment: { A: 1 }, token: 't', cookie: 'c' });
  assert.deepEqual(request, { agentId: 'a1', deviceId: 'd1', requestedAppId: 'codex', requestedClientForm: 'desktop', interactive: true, manualConfirmation: false });
  assert.doesNotMatch(preload, /agentDeployments:[^'"\n]*(command|path|exec|token|cookie)/i);
  assert.match(main, /getProvisioningService\(\)\.resumeActiveJobs\(\)/);
  assert.match(main, /provisioningService\?\.stop\(\)/);
});

test('工作环境始终投影完整员工库，并用同一主按钮确保就绪后打开', () => {
  const renderer = rendererSource();
  const scripts = doc.all((el) => el.tag === 'script' && el.attrs.src);
  const at = (src) => scripts.findIndex((el) => el.attrs.src === src);
  assert.ok(at('./agent-workspace.js') >= 0 && at('./agent-workspace.js') < at('./renderer.js'));
  assert.equal(scripts[at('./renderer.js')].attrs.type, 'module');
  assert.match(renderer, /function identityGroupsForLens[\s\S]*?AgentWorkspace\.projectMeshAgentGroups/);
  assert.doesNotMatch(renderer, /if \(!slots\.length\) continue/);
  // Every Agent in the catalog is projected, also one with no location anywhere.
  const groups = require('../src/agent-workspace').projectMeshAgentGroups({ overview: { initialized: true, agents: [{ agentId: 'a1', displayName: 'A' }, { agentId: 'a2', displayName: 'B' }], slots: [] }, lensId: 'all', profiles: [] });
  assert.equal(groups.length, 2);
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

test('远端已就绪与首次准备共用主按钮，只走窄语义 IPC', async () => {
  const preload = read('src/preload.js');
  const renderer = rendererSource();
  const capabilities = require('../src/mesh/domain/capabilities');
  const prepare = capabilities.CAPABILITIES?.['agent.prepare'] || capabilities.CAPABILITY_DEFINITIONS?.['agent.prepare'];
  assert.deepEqual(prepare && { defaultPaired: prepare.defaultPaired, dangerous: prepare.dangerous }, { defaultPaired: false, dangerous: true });
  assert.ok(doc.all((el) => el.attrs['data-capability'] === 'agent.prepare').length > 0);
  const { api, calls } = loadPreload();
  api.launchRemoteAgent({ agentId: 'a' }); api.prepareRemoteAgent({ agentId: 'a' });
  assert.deepEqual(plain(calls), [['invoke', 'agentActions:launchRemote', { agentId: 'a' }], ['invoke', 'agentActions:prepareRemote', { agentId: 'a' }]]);
  assert.match(renderer, /profile[\s\S]*?launchRemoteAgent\(\{[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?profileId:/);
  assert.match(renderer, /prepareRemoteAgent\(\{[\s\S]*?agentId:[\s\S]*?deviceId:[\s\S]*?requestedAppId:[\s\S]*?requestedClientForm:/);
  const sent = [];
  const actionDeps = {
    boundedText: bounded,
    getAgentActionService: () => ({ launchRemote: async (input) => { sent.push(input); return { ok: true }; }, prepareRemote: async (input) => { sent.push(input); return { ok: true }; } }),
    getMeshService: () => ({ getOverview: () => ({}) }),
    withMeshRuntime: (overview) => overview
  };
  const extra = { command: 'sh', path: '/x', argv: ['-c'], url: 'https://x' };
  await runCommand('agentActions:launchRemote', actionDeps, { agentId: 'a', deviceId: 'd', profileId: 'p', ...extra });
  await runCommand('agentActions:prepareRemote', actionDeps, { agentId: 'a', deviceId: 'd', requestedAppId: 'codex', ...extra });
  assert.deepEqual(sent, [{ agentId: 'a', deviceId: 'd', profileId: 'p' }, { agentId: 'a', deviceId: 'd', requestedAppId: 'codex', requestedClientForm: 'desktop' }]);
  assert.doesNotMatch(preload, /agentActions:(command|exec|invoke)|remoteCommand|generic\.exec/i);
});

test('公网会合设置与诊断使用固定 IPC，界面不接收 TURN 长期凭据或连接原文', async () => {
  const renderer = rendererSource();
  const preload = read('src/preload.js');
  const main = mainHandlerSource();
  assert.ok(inOrder('networkSettingsBtn', 'meshNetworkDialog'));
  assert.ok(inside('meshSignalingUrls', 'meshNetworkDialog') && inOrder('meshSignalingUrls', 'meshStunUrls'));
  assert.deepEqual(doc.all((el) => /turn|credential/i.test(el.attrs.id || '') || (['input', 'textarea'].includes(el.tag) && /turn|credential/i.test(JSON.stringify(el.attrs)))).map((el) => el.attrs.id), [], 'no field for TURN secrets');
  const { api, calls } = loadPreload();
  api.getDeviceDiagnostics('d1'); api.updateDeviceNetworkConfig({ signalingUrls: [] });
  assert.deepEqual(plain(calls).map((call) => call[1]), ['devices:getDiagnostics', 'devices:updateNetworkConfig']);
  // Every preload method names a fixed channel (a security invariant of the whitelist).
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\([^'"\n]|ipcRenderer\.on\([^'"\n]/);
  // The network settings take only the two URL lists, each through its normaliser.
  const normalised = [];
  const config = await runCommand('devices:updateNetworkConfig', {
    boundedText: bounded,
    configuredSignalingUrls: () => [],
    ensureSignalingOnline: async () => {},
    getMeshService: () => ({ updateLocalSignalUrls() {} }),
    normalizeServiceUrls: (urls) => { normalised.push(['signaling', urls]); return ['https://s.example']; },
    normalizeStunUrls: (urls) => { normalised.push(['stun', urls]); return ['stun:s.example']; },
    publicNetworkRuntime: () => ({}),
    stopSignalingClient: async () => {},
    updateSettings: (patch) => normalised.push(['settings', patch])
  }, { signalingUrls: ['a'], stunUrls: ['b'], turnSecret: 'x', turnUrls: ['turn:x'] });
  assert.deepEqual(config.config, { signalingUrls: ['https://s.example'], stunUrls: ['stun:s.example'] });
  assert.deepEqual(normalised, [['signaling', ['a']], ['stun', ['b']], ['settings', { meshSignalingUrls: ['https://s.example'], meshStunUrls: ['stun:s.example'], meshNetworkEnrollmentEnabled: true }]]);
  assert.match(main, /deviceDiagnostics\([\s\S]*?candidateTypes[\s\S]*?protocols[\s\S]*?selectedPairState/);
  assert.doesNotMatch(renderer, /candidate\.address|localDescription|remoteDescription|turnSecret|turnUsername|turnCredential\b|devicePrivateKey/);
});

test('局域网配对端口只在用户创建邀请后临时开启，取消邀请会立即关闭', async () => {
  const main = mainHandlerSource();
  const steps = [];
  const pairingDeps = {
    boundedText: bounded,
    pairingApprovalRegistry: { stop: (why) => steps.push(['stop', why]), cancelInvite: (id) => steps.push(['cancel', id]) },
    setMeshNetworkEnrollmentEnabled: () => {},
    ensureSignalingOnline: async () => {},
    openPairingEndpoint: async () => steps.push('open'),
    closePairingEndpoint: async () => steps.push('close'),
    getMeshService: () => ({ createInvite: () => { steps.push('invite'); return { code: 'AD1-x' }; }, cancelInvite: () => steps.push('cancelInvite') }),
    meshReachabilityEnabled: false
  };
  assert.equal((await runCommand('devices:createInvite', pairingDeps)).ok, true);
  assert.deepEqual(steps, [['stop', 'pairing-invite-replaced'], 'open', 'invite'], 'the port opens only for an invitation');
  steps.length = 0;
  await runCommand('devices:cancelInvite', pairingDeps, { inviteId: 'i1' });
  assert.deepEqual(steps, ['cancelInvite', ['cancel', 'i1'], 'close'], 'cancelling closes it again');
  // Start-up is Electron's app object, which Node tests don't have: held to a text search.
  assert.doesNotMatch(main, /app\.whenReady\(\)[\s\S]{0,600}await openPairingEndpoint\(\)/);
  assert.ok(doc.byId('createDeviceInviteBtn') && doc.byId('meshInvitePanel'));
  const permission = (name) => doc.all((el) => el.attrs['data-capability'] === name && doc.within(el, doc.byId('devicePermissionsDialog')))[0];
  assert.ok(permission('screen.view') && permission('input.control') && doc.index(permission('screen.view')) < doc.index(permission('input.control')));
});

test('设备中心明确保留账号删到零与不补默认账号的空状态', () => {
  const renderer = rendererSource();
  assert.equal(mt('zh', 'devices.agents.empty'), '当前没有账号。位置可以删到零，不会自动补回各平台的默认账号。');
  assert.match(renderer, /if \(!deviceAgents\.length && !unassignedSlots\.length\)[\s\S]*?devices\.agents\.empty/);
  assert.match(renderer, /unassignedSlots[\s\S]*?catalog\.unassigned\.title[\s\S]*?openSlotAssignmentDialog\(slot\)/);
  assert.match(renderer, /overview\.slots\.filter\(\(slot\) => slot\.agentId === agent\.agentId\)/);
});

test('Agent 管理明确区分新 Agent、新账号绑定、新运行位置和三种移除范围', () => {
  const renderer = rendererSource();
  for (const mode of ['new-agent', 'existing-agent', 'existing-binding']) {
    assert.ok(doc.all((el) => el.attrs.value === mode).length > 0, `mode ${mode} is offered`);
  }
  assert.deepEqual(doc.all((el) => el.attrs.name === 'catalogRemoveScope').map((el) => el.attrs.value), ['slot', 'account-binding', 'agent']);
  assert.ok(['mergeAgentTarget', 'splitAccountBinding'].every((id) => inside(id, 'agentRelationsDialog')) && inOrder('mergeAgentTarget', 'splitAccountBinding'));
  assert.ok(['newAgentName', 'confirmAddAgentBtn'].every((id) => inside(id, 'agentCreateDialog')) && inOrder('newAgentName', 'confirmAddAgentBtn'));
  assert.ok(['agentManageLocations', 'yardManageActions', 'addRuntimeLocationBtn'].every((id) => inside(id, 'agentManageDialog')) && inOrder('agentManageLocations', 'yardManageActions', 'addRuntimeLocationBtn'));
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
  assert.equal(doc.byId('editIdentityField').tag, 'label');
  assert.ok(inside('editIdentity', 'editIdentityField') && !inside('editName', 'editIdentityField'));
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
  const renderer = rendererSource();
  const main = mainHandlerSource();
  const service = read('src/mesh/main/remote-control-service.js');
  assert.equal(doc.byId('remoteActivityBtn').attrs['aria-live'], 'polite');
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

test('会话发送从会话工具栏的“送出”发起，只提交稳定 ID，项目根由 Main 选择', async () => {
  const renderer = rendererSource();
  assert.ok(inside('sessionSendMenu', 'sessionPane') && inside('sendSessionInfoBtn', 'sessionSendMenu'));
  assert.ok(!inside('sendSessionInfoBtn', 'activityCenterDialog'));
  assert.match(renderer, /conversationId:\s*session\.conversationId,[\s\S]{0,100}replicaId:\s*session\._replicaId/);
  assert.doesNotMatch(renderer, /createSessionPointerTransfer\(\{[^}]*projectPath|chooseProjectBinding\(\{[^}]*localRoot/);
  assertFixedChannels(['transfers:createSessionPointer', 'projects:chooseBinding']);
  // The project root comes from Main's folder picker, never from the request.
  const pickerCalls = [];
  const bound = await runCommand('projects:chooseBinding', {
    boundedText: bounded,
    dialog: { showOpenDialog: async (_window, options) => { pickerCalls.push(options.properties); return { canceled: false, filePaths: ['/picked/root'] }; } },
    getTransferService: () => ({ saveProjectBinding: (input) => input, list: () => [] }),
    mainWindow: null,
    t: (key) => key
  }, { projectId: 'proj', sourceDeviceId: 'd1', localRoot: '/from/request', projectPath: '/from/request' });
  assert.deepEqual(pickerCalls, [['openDirectory', 'createDirectory']]);
  assert.deepEqual(bound.binding, { projectId: 'proj', sourceDeviceId: 'd1', localRoot: '/picked/root' });
  const pointerNote = doc.all((el) => el.attrs['data-i18n'] === 'transfers.pointerBody')[0];
  assert.ok(pointerNote && doc.text(pointerNote).includes('不生成交接模板'));
  assert.match(renderer, /const keyState = state\.mesh\.overview\?\.keyState \|\| 'available';[\s\S]*?keyState === 'available'[\s\S]*?await loadMeshSessions\(null, \{ generation \}\)[\s\S]*?loadLocalSessions\(\{ source: 'local-fallback', generation \}\)/);
  assert.match(renderer, /loadDeviceOverview\(\{ requestSecureAccess: true \}\)/);
  assert.match(renderer, /function loadMeshSessions[\s\S]*?return \{ ok: false, reasonCode:[\s\S]*?state\.mesh\.sessionSource = 'mesh'/);
  assert.match(renderer, /const localProfileIds = new Set\(state\.profiles[\s\S]*?if \(!localProfileIds\.has\(String\(member\.id\)\)\) continue/);
  assert.match(renderer, /function crossDeviceActionsPaused[\s\S]*?sessionSource === 'local-fallback'[\s\S]*?sessionErrorCode/);
  assert.match(renderer, /function directTaskPackageTargets\(\) \{[\s\S]*?if \(crossDeviceActionsPaused\(\)\) return \[\]/);
  for (const locale of ['zh', 'en', 'ja']) {
    for (const key of ['status.sessionsLocalFallback', 'status.sessionsRemoteUnavailable', 'status.crossDevicePaused']) {
      assert.equal(typeof LOCALES[locale][key], 'string', `${locale} ${key}`);
    }
  }
});

test('文件传输路径只来自 Main 系统选择器，Renderer 只提交设备和传输 ID', async () => {
  const renderer = rendererSource();
  assert.ok(inside('sessionSendTarget', 'sessionSendDialog') && inside('confirmSessionSendBtn', 'sessionSendDialog') && inOrder('sessionSendTarget', 'confirmSessionSendBtn'));
  assert.ok(!inside('fileSendTarget', 'sessionSendDialog') && !inside('chooseFilesBtn', 'sessionSendDialog'));
  assert.ok(inside('fileSendTarget', 'fileSendDialog') && inside('chooseFilesBtn', 'fileSendDialog') && inOrder('fileSendTarget', 'chooseFilesBtn'));
  assert.ok(!inside('sessionSendTarget', 'fileSendDialog') && !inside('confirmSessionSendBtn', 'fileSendDialog'));
  assert.match(renderer, /function openFileSendDialog[\s\S]*?UiContext\.createFileDraft\(/);
  assert.match(renderer, /chooseFileTransfer\(\{ targetDeviceId \}\)/);
  assert.match(renderer, /acceptFileTransfer\(transfer\.transferId\)/);
  assert.doesNotMatch(renderer, /chooseFileTransfer\(\{[^}]*filePaths|acceptFileTransfer\([^)]*,/);
  assertFixedChannels(['transfers:chooseFiles', 'transfers:acceptFile']);
  // Files and the destination come from Main's pickers; the request only names ids.
  const picked = [];
  const transferDeps = {
    boundedText: bounded,
    dialog: { showOpenDialog: async (_window, options) => { picked.push(options.properties); return { canceled: false, filePaths: options.properties.includes('openFile') ? ['/picked/a.txt'] : ['/picked/dir'] }; } },
    getTransferService: () => ({
      createFileTransfer: async (input) => { picked.push(['create', input]); return {}; },
      acceptFileTransfer: async (id, folder) => { picked.push(['accept', id, folder]); return {}; },
      list: () => []
    }),
    mainWindow: null,
    t: (key) => key
  };
  await runCommand('transfers:chooseFiles', transferDeps, { targetDeviceId: 'd2', filePaths: ['/etc/passwd'] });
  await runCommand('transfers:acceptFile', transferDeps, { transferId: 'tr1', folder: '/tmp/evil' });
  assert.deepEqual(picked, [
    ['openFile', 'multiSelections'], ['create', { targetDeviceId: 'd2', filePaths: ['/picked/a.txt'] }],
    ['openDirectory', 'createDirectory'], ['accept', 'tr1', '/picked/dir']
  ]);
});
