'use strict';

// AgentDesk — Main's side of the personal device mesh: creating the Mesh,
// provisioning, peer, transfer, task-package, remote-control and input services
// on first use, signaling and the temporary pairing endpoint, network settings,
// diagnostics and permissions, and the events sent to the window. The services'
// state stays in src/main.js; this code reads and sets it through `main`
// (mainContext). Moved out of src/main.js unchanged.

const apps = require('../apps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const toolMaintenance = require('../tool-maintenance');
const { AgentActionService } = require('../mesh/main/agent-action-service');
const { EncryptedKeyVault } = require('../mesh/storage/secure-keys');
const { LanEndpoint, claimPairing, sendPeerSignal } = require('../mesh/network/lan-endpoint');
const { MeshService } = require('../mesh/main/mesh-service');
const { PeerManager } = require('../mesh/main/peer-manager');
const { ProvisioningService } = require('../mesh/main/provisioning-service');
const { RemoteControlService } = require('../mesh/main/remote-control-service');
const { RemoteInputAdapter, defaultInputHelperPath } = require('../mesh/platform/input-adapter');
const { SignalingClient, claimPairingViaSignaling, publicServiceName } = require('../mesh/network/signaling-client');
const { TaskPackageService } = require('../task-package/service');
const { TransferService } = require('../mesh/main/transfer-service');
const { defaultSessionRoot, loadProfiles, loadSettings, makeIsolatedProfilePath, normalizeProfile, saveProfiles, updateSettings, updateStoredProfile } = require('./stores');
const { derivedNetworkEnrollment, shouldDeferSecureMeshStartup } = require('./network-enrollment');
const { findExecutable, launchProfile, usesWindowsOfficialDefault } = require('./profile-launch');
const { identityFingerprint } = require('../identity');
const { mergeIceServers, publicIceDiagnostics, signalingUrlsFromEnv, staticIceServers } = require('../mesh/network/ice-config');
const { normalizeServiceUrls } = require('../mesh/protocol/signaling-auth');
const { openMaintenanceOfficialPage } = require('./tools');
const { prepareManagedProfileHome } = require('../profile-home');
const { spawnSync } = require('node:child_process');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

function detectSecureMeshStartupDeferral() {
  if (process.platform !== 'darwin' || !main.app.isPackaged) return false;
  const result = spawnSync('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    process.execPath
  ], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 256 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) return false;
  return shouldDeferSecureMeshStartup({
    platform: process.platform,
    isPackaged: main.app.isPackaged,
    signatureText: `${result.stdout || ''}\n${result.stderr || ''}`
  });
}

// The Mesh runtime state the device commands change (src/commands/devices.js),
// each change named here so the commands never assign Main's variables.
function markSecureMeshAccessUnlocked() {
  const newlyUnlocked = !main.secureMeshAccessUnlocked;
  main.secureMeshAccessUnlocked = true;
  return newlyUnlocked;
}

function setMeshReachability(enabled) {
  main.meshReachabilityEnabled = enabled === true;
}

function forgetSignalingClient() {
  main.signalingClient = null;
}

async function stopSignalingClient(reason) {
  await main.signalingClient?.stop(reason);
  main.signalingClient = null;
}

function stopMeshJobServices(reason) {
  main.provisioningService?.stop();
  main.provisioningService = null;
  main.agentActionService?.stop(reason);
  main.agentActionService = null;
  main.transferService?.stop();
  main.transferService = null;
}

function getMeshService() {
  if (main.meshService) return main.meshService;
  const userData = main.app.getPath('userData');
  const keyVault = new EncryptedKeyVault(
    path.join(userData, 'mesh-keys.json'),
    {
      isAvailable: () => main.safeStorage.isEncryptionAvailable(),
      encryptString: (value) => main.safeStorage.encryptString(value),
      decryptString: (value) => main.safeStorage.decryptString(value)
    }
  );
  main.meshService = new MeshService({
    databasePath: path.join(userData, 'mesh.db'),
    keyVault,
    profilesProvider: () => loadProfiles().map((profile) => {
      const launchPlan = apps.profileLaunchPlan(profile, {
        useOfficialDefault: usesWindowsOfficialDefault(profile)
      });
      return {
        ...profile,
        identityFingerprint: identityFingerprint(profile),
        launchable: launchPlan.ok
      };
    }),
    // The index's rows; a profile it has never scanned is scanned once here.
    sessionCountProvider: (profile) => main.sessionIndex.rowsSync(profile).length,
    sessionsProvider: (profile) => main.sessionIndex.rowsSync(profile),
    appVersion: main.app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    hostname: os.hostname(),
    endpointProvider: () => main.pairingEndpoint?.endpoints() || [],
    signalingProvider: () => configuredSignalingUrls(),
    pairingTransport: async (invite, request, identity) => {
      const failures = [];
      if (Array.isArray(invite?.endpoints) && invite.endpoints.length) {
        try {
          return await claimPairing(invite, request, { timeoutMs: 3 * 60_000 });
        } catch (error) {
          failures.push(main.boundedText(error?.message || error, 160));
        }
      }
      if (Array.isArray(invite?.signalUrls) && invite.signalUrls.length) {
        try {
          return await claimPairingViaSignaling(invite, request, identity, {
            allowInsecure: process.env.AGENTDESK_ALLOW_INSECURE_SIGNALING === '1',
            timeoutMs: 3 * 60_000
          });
        } catch (error) {
          failures.push(main.boundedText(error?.message || error, 160));
        }
      }
      throw new Error(failures[0] || 'pairing-route-unavailable');
    },
    onDeviceRevoked: (deviceId) => {
      main.transferService?.handleDeviceRevoked(deviceId);
      main.agentActionService?.handlePeerState({
        deviceId,
        state: 'disconnected',
        reason: 'device-revoked'
      });
      void main.remoteControlService?.stopDevice(deviceId, 'device-revoked');
      void main.peerManager?.disconnect(deviceId, 'device-revoked');
    }
  });
  return main.meshService;
}

function getProvisioningService() {
  if (main.provisioningService) return main.provisioningService;
  main.provisioningService = new ProvisioningService({
    meshService: getMeshService(),
    platform: process.platform,
    adapterProvider: (appId, descriptor) => ({
      async inspect(profile) {
        if (apps.getApp(appId).noLaunch === true) {
          return { supported: false, installed: false, reasonCode: 'client-form-unsupported' };
        }
        const launchPlan = apps.profileLaunchPlan(profile);
        if (!launchPlan.ok) {
          return {
            supported: false,
            installed: false,
            reasonCode: launchPlan.reasonCode
          };
        }
        const executable = findExecutable(profile);
        return { supported: true, installed: executable.found === true };
      },
      async prepare(profile) {
        prepareManagedProfileHome(profile);
        return { ok: true };
      },
      async observeIdentity(profile) {
        return identityFingerprint(profile);
      },
      async launch(profile) {
        return launchProfile(profile);
      },
      async openInstall() {
        const tool = toolMaintenance.catalogTool(descriptor.toolId);
        if (!tool?.officialUrl) throw new Error('official-install-page-unavailable');
        return openMaintenanceOfficialPage(tool);
      }
    }),
    profileRepository: {
      build({ job, agent, descriptor }) {
        const id = job.stagingProfileId;
        const profilePath = makeIsolatedProfilePath(descriptor.appId, 'employee', id);
        return normalizeProfile({
          id,
          appId: descriptor.appId,
          name: agent.displayName,
          profilePath,
          sessionRoot: defaultSessionRoot(descriptor.appId, profilePath, false),
          profilePathMode: 'managed',
          sessionRootMode: 'managed',
          isProtected: false,
          createdAt: job.createdAt,
          lastLaunchedAt: null,
          group: agent.group,
          note: agent.note,
          cat: agent.catAppearance && typeof agent.catAppearance === 'object'
            ? { ...agent.catAppearance }
            : main.defaultCatForClient(descriptor.appId, id),
          provisioningJobId: job.jobId
        });
      },
      get(profileId) {
        return loadProfiles().find((profile) => profile.id === profileId) || null;
      },
      commit(profile) {
        const profiles = loadProfiles();
        const existing = profiles.find((item) => item.id === profile.id);
        if (existing) {
          if (
            existing.appId !== profile.appId
            || !main.pathsEqual(existing.profilePath, profile.profilePath)
            || !main.pathsEqual(existing.sessionRoot, profile.sessionRoot)
          ) {
            throw new Error('provisioning-profile-conflict');
          }
          return existing;
        }
        prepareManagedProfileHome(profile);
        profiles.push(normalizeProfile(profile));
        saveProfiles(profiles);
        return profiles.at(-1);
      },
      markOpened(profileId) {
        return updateStoredProfile(profileId, (profile) => ({
          ...profile,
          lastLaunchedAt: new Date().toISOString()
        }));
      }
    },
    onChanged(value) {
      const state = value?.state || value?.job?.state || null;
      let overview = null;
      try { overview = withMeshRuntime(getMeshService().getOverview()); } catch (_error) { /* best effort */ }
      if (main.mainWindow && !main.mainWindow.isDestroyed()) {
        main.mainWindow.webContents.send('agentDeployments:changed', {
          jobId: value?.job?.jobId || null,
          state,
          overview
        });
      }
      const remoteActionTracked = main.agentActionService?.handleProvisioningChanged(value) === true;
      if (state === 'ready' && !remoteActionTracked) {
        void main.peerManager?.broadcastCatalog();
        void main.peerManager?.broadcastInventory();
      }
    }
  });
  return main.provisioningService;
}

function publicProvisioningResult(result = {}) {
  return {
    ...result,
    ...(result.overview ? { overview: withMeshRuntime(result.overview) } : {})
  };
}

function getPeerManager() {
  if (main.peerManager) return main.peerManager;
  main.peerManager = new PeerManager({
    BrowserWindow: main.BrowserWindow,
    ipcMain: main.electronIpcMain,
    peerDirectory: path.join(__dirname, 'mesh', 'peer'),
    // The inventory sent to a peer reads the index; refresh it first.
    beforeInventorySnapshot: () => main.sessionIndex.refresh(loadProfiles()).catch(() => null),
    meshService: getMeshService(),
    sendSignal: (remote, envelope) => sendPeerSignalWithFallback(remote, envelope),
    iceServersProvider: () => publicIceServers(),
    onState: (value) => {
      emitPeerState(value);
      main.agentActionService?.handlePeerState(value);
      main.remoteControlService?.handlePeerState(value);
      if (value?.state === 'authenticated') {
        void getTransferService().flushDevice(value.deviceId);
      }
    },
    onEnvelope: async (value) => {
      if (['profile.launch', 'agent.prepare', 'agent.prepare.status'].includes(
        String(value?.envelope?.messageType || '')
      )) {
        return getAgentActionService().handleEnvelope(value);
      }
      if (String(value?.envelope?.messageType || '').startsWith('remote.')) {
        return getRemoteControlService().handleEnvelope(value);
      }
      return getTransferService().handleEnvelope(value);
    }
  });
  return main.peerManager;
}

function getAgentActionService() {
  if (main.agentActionService) return main.agentActionService;
  main.agentActionService = new AgentActionService({
    meshService: getMeshService(),
    peerManagerProvider: () => getPeerManager(),
    provisioningServiceProvider: () => getProvisioningService(),
    confirmPreparation: confirmRemoteAgentPreparation,
    onChange: emitAgentActionChange
  });
  return main.agentActionService;
}

async function confirmRemoteAgentPreparation({ sourceDevice, agent, request }) {
  main.showMainWindow();
  const appName = apps.getApp(request.requestedAppId)?.label || request.requestedAppId;
  const result = await main.dialog.showMessageBox(main.mainWindow, {
    type: 'question',
    title: main.t('main.agentPrepare.title'),
    message: main.t('main.agentPrepare.message', {
      device: sourceDevice.name,
      agent: agent.displayName
    }),
    detail: main.t('main.agentPrepare.detail', { app: appName }),
    buttons: [main.t('main.agentPrepare.allow'), main.t('main.agentPrepare.decline')],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  return result.response === 0;
}

async function requestPairingClaimApproval(body) {
  const preview = getMeshService().previewClaimInvite(body);
  const approved = await main.pairingApprovalRegistry.request(preview);
  const fresh = getMeshService().previewClaimInvite(body);
  if (fresh.requestDigest !== approved.requestDigest) throw new Error('pairing-approval-mismatch');
  return getMeshService().claimInvite(body);
}

function getSignalingClient() {
  let overview = null;
  try { overview = getMeshService().getOverview(); } catch (_error) { /* uninitialized */ }
  if (!meshNetworkEnrollmentEnabled(overview)) return null;
  if (main.signalingClient) return main.signalingClient;
  let serviceUrls = configuredSignalingUrls();
  if (!serviceUrls.length) {
    try {
      serviceUrls = getMeshService().getSignalingContext().local.signalUrls || [];
    } catch (_error) {
      serviceUrls = [];
    }
  }
  if (!serviceUrls.length) return null;
  main.signalingClient = new SignalingClient({
    serviceUrls,
    allowInsecure: process.env.AGENTDESK_ALLOW_INSECURE_SIGNALING === '1' || serviceUrls.every(isLoopbackService),
    identityProvider: () => getMeshService().getSignalingContext(),
    onPeerSignal: (envelope) => getPeerManager().receiveSignal(envelope),
    onPairClaim: (body) => requestPairingClaimApproval(body),
    onState: () => {
      if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
      main.mainWindow.webContents.send('devices:networkState', publicNetworkRuntime());
    }
  });
  return main.signalingClient;
}

async function ensureSignalingOnline() {
  let overview = null;
  try { overview = getMeshService().getOverview(); } catch (_error) { /* uninitialized */ }
  if (!meshNetworkEnrollmentEnabled(overview)) return false;
  const client = getSignalingClient();
  if (!client) return false;
  getMeshService().updateLocalSignalUrls(client.serviceUrls);
  return client.start();
}

async function sendPeerSignalWithFallback(remote, envelope) {
  const failures = [];
  if (Array.isArray(remote?.endpoints) && remote.endpoints.length) {
    try {
      const responseEnvelope = await sendPeerSignal(remote.endpoints, envelope, { timeoutMs: 4_000 });
      return { responseEnvelope, path: 'lan', service: null };
    } catch (error) {
      failures.push(main.boundedText(error?.message || error, 160));
    }
  }
  try {
    const client = getSignalingClient();
    if (!client) throw new Error('peer-signaling-service-unavailable');
    await client.start();
    return await client.requestPeerSignal(remote, envelope);
  } catch (error) {
    failures.push(main.boundedText(error?.message || error, 160));
  }
  throw new Error(failures[0] || 'peer-route-unavailable');
}

function getTransferService() {
  if (main.transferService) return main.transferService;
  main.transferService = new TransferService({
    databasePath: path.join(main.app.getPath('userData'), 'mesh.db'),
    spoolRoot: path.join(main.app.getPath('userData'), 'mesh-transfer-spool'),
    meshService: getMeshService(),
    peerManagerProvider: () => getPeerManager(),
    taskPackageServiceProvider: () => getTaskPackageService(),
    onChange: emitTransferChange
  });
  return main.transferService;
}

function getTaskPackageService() {
  if (main.taskPackageService) return main.taskPackageService;
  const userData = main.app.getPath('userData');
  main.taskPackageService = new TaskPackageService({
    profileProvider: () => loadProfiles(),
    sessionRows: main.actionRowsOf,
    meshOverviewProvider: () => {
      if (main.meshService) return main.meshService.getOverview();
      if (!fs.existsSync(path.join(userData, 'mesh.db'))) return null;
      try { return getMeshService().getOverview(); } catch (_error) { return null; }
    },
    historyFile: path.join(userData, 'task-package-history.json'),
    stagingRoot: path.join(main.app.getPath('temp'), 'agentdesk-task-packages'),
    launchProfile: (profile) => launchProfile(profile),
    onChange: emitTaskPackageChange
  });
  return main.taskPackageService;
}

function getRemoteControlService() {
  if (main.remoteControlService) return main.remoteControlService;
  main.remoteControlService = new RemoteControlService({
    BrowserWindow: main.BrowserWindow,
    WebContentsView: main.WebContentsView,
    ipcMain: main.electronIpcMain,
    desktopCapturer: main.desktopCapturer,
    screen: main.screen,
    systemPreferences: main.systemPreferences,
    remoteDirectory: path.join(__dirname, 'remote'),
    mainWindowProvider: () => main.mainWindow,
    meshService: getMeshService(),
    peerManagerProvider: () => getPeerManager(),
    iceServersProvider: () => publicIceServers(),
    languageProvider: () => main.currentLang(),
    inputAdapter: getRemoteInputAdapter(),
    onChange: emitRemoteControlChange,
    onReturnToWorkspace: emitRemoteControlReturn
  });
  return main.remoteControlService;
}

function getRemoteInputAdapter() {
  if (main.remoteInputAdapter) return main.remoteInputAdapter;
  main.remoteInputAdapter = new RemoteInputAdapter({
    platform: process.platform,
    screen: main.screen,
    systemPreferences: main.systemPreferences,
    helperPath: defaultInputHelperPath({
      platform: process.platform,
      isPackaged: main.app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: main.app.getAppPath()
    })
  });
  return main.remoteInputAdapter;
}

function emitTransferChange(transfers) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('transfers:changed', Array.isArray(transfers) ? transfers : []);
}

function emitTaskPackageChange(history) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('taskPackages:changed', Array.isArray(history) ? history : []);
}

function emitAgentActionChange(value = {}) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('agentActions:changed', {
    requestId: main.boundedText(value.requestId, 128),
    deviceId: main.boundedText(value.deviceId, 128),
    agentId: main.boundedText(value.agentId, 128),
    requestedAppId: main.boundedText(value.requestedAppId, 80),
    requestedClientForm: main.boundedText(value.requestedClientForm, 80),
    state: main.boundedText(value.state, 80),
    ok: value.ok === true,
    launched: value.launched === true,
    settled: value.settled === true,
    reasonCode: main.boundedText(value.reasonCode, 160),
    job: value.job || null,
    slot: value.slot || null,
    overview: withMeshRuntime(getMeshService().getOverview())
  });
}

function emitRemoteControlChange(sessions) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('remoteControl:changed', Array.isArray(sessions) ? sessions : []);
}

function emitRemoteControlReturn(value = {}) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('remoteControl:returnToWorkspace', {
    activeSessionId: main.boundedText(value.activeSessionId, 128),
    sessions: Array.isArray(value.sessions) ? value.sessions : []
  });
}

function registerRemoteEmergencyStop() {
  try {
    main.globalShortcut.register('CommandOrControl+Shift+Escape', () => {
      void main.remoteControlService?.stopAll('emergency-stop');
    });
  } catch (_error) {
    // Shortcut availability is surfaced by the remote console; startup must continue.
  }
}

function emitPeerState(value) {
  if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
  main.mainWindow.webContents.send('devices:connectionState', {
    connectionId: main.boundedText(value?.connectionId, 128),
    deviceId: main.boundedText(value?.deviceId, 128),
    deviceName: main.boundedText(value?.deviceName, 80),
    state: main.boundedText(value?.state, 80),
    authenticated: value?.authenticated === true,
    reason: main.boundedText(value?.reason, 160),
    transport: value?.transport || null
  });
}

function publicIceServers() {
  const current = loadSettings();
  const settingsIce = (current.meshStunUrls || []).length
    ? [{ urls: current.meshStunUrls }]
    : [];
  return mergeIceServers(staticIceServers(process.env), settingsIce, main.signalingClient?.iceServers() || []);
}

function publicNetworkRuntime() {
  const configuredServices = configuredSignalingUrls();
  const signaling = main.signalingClient?.publicStatus() || {
    configured: configuredServices.length > 0,
    state: configuredServices.length ? 'offline' : 'disabled',
    serviceCount: configuredServices.length,
    onlineServiceCount: 0,
    services: configuredServices.map((value) => ({
      service: publicServiceName(value),
      state: 'offline',
      leaseExpiresAt: null,
      lastConnectedAt: null,
      lastError: null
    })),
    lastError: null,
    turnCredentials: 'unavailable',
    turnCredentialSource: null,
    turnCredentialExpiresAt: null
  };
  const dynamic = main.signalingClient?.publicStatus() || {};
  return {
    signaling,
    ice: publicIceDiagnostics(publicIceServers(), {
      source: dynamic.turnCredentialSource,
      expiresAt: dynamic.turnCredentialExpiresAt
    })
  };
}

function configuredSignalingUrls() {
  const stored = loadSettings().meshSignalingUrls || [];
  return normalizeServiceUrls([...signalingUrlsFromEnv(), ...stored], {
    allowInsecure: process.env.AGENTDESK_ALLOW_INSECURE_SIGNALING === '1'
  });
}

function meshNetworkEnrollmentEnabled(overview = null) {
  const current = loadSettings();
  return derivedNetworkEnrollment({
    storedValue: current.meshNetworkEnrollmentEnabled,
    overview,
    configuredSignalingUrls: configuredSignalingUrls()
  });
}

function setMeshNetworkEnrollmentEnabled(enabled) {
  updateSettings({ meshNetworkEnrollmentEnabled: enabled === true });
}

function withMeshRuntime(overview) {
  if (!overview || typeof overview !== 'object') return overview;
  return {
    ...overview,
    reachability: {
      active: Boolean(main.pairingEndpoint),
      userEnabled: main.meshReachabilityEnabled,
      networkEnrollmentEnabled: meshNetworkEnrollmentEnabled(overview),
      endpointCount: main.pairingEndpoint?.endpoints().length || 0,
      expiresAt: main.pairingEndpointExpiresAt,
      ...publicNetworkRuntime()
    },
    connections: main.peerManager?.listConnections() || []
  };
}

function deviceDiagnostics(deviceId) {
  const overview = withMeshRuntime(getMeshService().getOverview());
  if (!overview?.initialized) throw new Error('mesh-not-initialized');
  const device = overview.devices.find((item) => item.deviceId === deviceId);
  if (!device) throw new Error('device-not-found');
  const connection = (overview.connections || []).find((item) => item.deviceId === device.deviceId) || null;
  const transport = connection?.transport || null;
  const input = device.isLocal ? getRemoteInputAdapter().status() : null;
  return {
    checkedAt: new Date().toISOString(),
    device: {
      deviceId: device.deviceId.slice(0, 12),
      name: device.name,
      platform: device.platform,
      arch: device.arch,
      appVersion: device.appVersion,
      protocolVersion: device.protocolVersion,
      status: device.status,
      fingerprint: device.fingerprint,
      inventoryRevision: device.inventoryRevision
    },
    signaling: overview.reachability.signaling,
    ice: overview.reachability.ice,
    connection: {
      authenticated: connection?.authenticated === true,
      signalingPath: connection?.signalingPath || 'none',
      signalingService: connection?.signalingService || null,
      networkPath: connection?.networkPath || 'none',
      candidateTypes: Array.isArray(transport?.candidateTypes) ? transport.candidateTypes : [],
      protocols: Array.isArray(transport?.protocols) ? transport.protocols : [],
      selectedPairState: transport?.selectedPairState || 'none'
    },
    permissions: {
      screen: device.isLocal ? localScreenPermission() : permissionState(device.permissions, 'screen.view'),
      input: device.isLocal ? (input?.permission || 'unknown') : permissionState(device.permissions, 'input.control'),
      file: permissionState(device.permissions, 'file.receive'),
      sessionPointer: permissionState(device.permissions, 'session.pointer.receive'),
      taskPackage: permissionState(device.permissions, 'task.package.receive')
    },
    localEndpoint: {
      active: Boolean(main.pairingEndpoint),
      endpointCount: main.pairingEndpoint?.endpoints().length || 0,
      expiresAt: main.pairingEndpointExpiresAt
    }
  };
}

function permissionState(permissions, capability) {
  return Array.isArray(permissions) && permissions.includes(capability) ? 'allowed' : 'not-allowed';
}

function localScreenPermission() {
  if (process.platform !== 'darwin') return process.platform === 'win32' ? 'available' : 'unsupported';
  try {
    return main.systemPreferences.getMediaAccessStatus('screen') || 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

function isLoopbackService(value) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
  } catch (_error) {
    return false;
  }
}

function meshCall(callback, resultKey = 'overview') {
  try {
    const value = callback();
    return { ok: true, [resultKey]: resultKey === 'overview' ? withMeshRuntime(value) : value };
  } catch (error) {
    return {
      ok: false,
      reasonCode: main.boundedText(error?.message || 'mesh-operation-failed', 160)
    };
  }
}

function catalogMeshCall(callback) {
  const result = meshCall(callback);
  if (result.ok) {
    void main.peerManager?.broadcastCatalog();
    void main.peerManager?.broadcastInventory();
  }
  return result;
}

async function openPairingEndpoint(options = {}) {
  const ttlMs = Math.max(30_000, Math.min(Number(options.ttlMs) || 10 * 60_000, 30 * 60_000));
  if (main.pairingEndpoint) {
    schedulePairingEndpointClose(main.meshReachabilityEnabled ? 30 * 60_000 : ttlMs);
    return main.pairingEndpoint.endpoints();
  }
  const createEndpoint = (port) => new LanEndpoint({
    port,
    onPairClaim: async (body) => {
      const result = await requestPairingClaimApproval(body);
      if (!main.meshReachabilityEnabled) schedulePairingEndpointClose(2 * 60_000);
      return result;
    },
    onSignal: (body) => getPeerManager().receiveSignal(body)
  });
  main.pairingEndpoint = createEndpoint(45831);
  try {
    await main.pairingEndpoint.start();
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    try { await main.pairingEndpoint.stop(); } catch (_stopError) { /* replace below */ }
    main.pairingEndpoint = createEndpoint(0);
    await main.pairingEndpoint.start();
  }
  getMeshService().updateLocalEndpoints(main.pairingEndpoint.endpoints());
  schedulePairingEndpointClose(main.meshReachabilityEnabled ? 30 * 60_000 : ttlMs);
  return main.pairingEndpoint.endpoints();
}

function schedulePairingEndpointClose(ttlMs) {
  clearTimeout(main.pairingEndpointTimer);
  main.pairingEndpointExpiresAt = new Date(Date.now() + ttlMs).toISOString();
  main.pairingEndpointTimer = setTimeout(() => {
    main.meshReachabilityEnabled = false;
    void closePairingEndpoint();
  }, ttlMs);
}

async function closePairingEndpoint() {
  clearTimeout(main.pairingEndpointTimer);
  main.pairingEndpointTimer = null;
  main.pairingEndpointExpiresAt = null;
  const endpoint = main.pairingEndpoint;
  main.pairingEndpoint = null;
  await endpoint?.stop();
  try { getMeshService().updateLocalEndpoints([]); } catch (_error) { /* Mesh may be uninitialized. */ }
}

function boundedTaskCheckpoint(value = {}) {
  const lines = (input) => {
    const source = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
    return source.map((item) => main.boundedText(item, 1000)).filter(Boolean).slice(0, 32);
  };
  return {
    objective: String(value.objective || '').replace(/\0/g, '').trim().slice(0, 4000),
    completed: lines(value.completed),
    next: lines(value.next),
    blockers: lines(value.blockers),
    acceptance: lines(value.acceptance)
  };
}

function taskPackageSuggestedName(title) {
  const stem = String(title || 'AgentDesk-task')
    .normalize('NFC')
    .replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100) || 'AgentDesk-task';
  return `${stem}.agentdesk-task`;
}

module.exports = { bind, detectSecureMeshStartupDeferral, markSecureMeshAccessUnlocked, setMeshReachability, forgetSignalingClient, stopSignalingClient, stopMeshJobServices, getMeshService, getProvisioningService, publicProvisioningResult, getPeerManager, getAgentActionService, confirmRemoteAgentPreparation, requestPairingClaimApproval, getSignalingClient, ensureSignalingOnline, sendPeerSignalWithFallback, getTransferService, getTaskPackageService, getRemoteControlService, getRemoteInputAdapter, emitTransferChange, emitTaskPackageChange, emitAgentActionChange, emitRemoteControlChange, emitRemoteControlReturn, registerRemoteEmergencyStop, emitPeerState, publicIceServers, publicNetworkRuntime, configuredSignalingUrls, meshNetworkEnrollmentEnabled, setMeshNetworkEnrollmentEnabled, withMeshRuntime, deviceDiagnostics, permissionState, localScreenPermission, isLoopbackService, meshCall, catalogMeshCall, openPairingEndpoint, schedulePairingEndpointClose, closePairingEndpoint, boundedTaskCheckpoint, taskPackageSuggestedName };
