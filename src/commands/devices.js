'use strict';

// AgentDesk — this device and the personal device mesh: overview, first agent,
// setting up and resetting the mesh, invitations and pairing, reachability,
// connections, diagnostics, network settings, permissions and revoking. Inputs
// are stable ids and bounded values; the Mesh runtime state these change goes
// through named Main functions. Bodies moved from main.js registerIpc
// unchanged otherwise.

const os = require('node:os');
const path = require('node:path');

const COMMANDS = [
  {
    id: 'devices.list',
    channel: 'devices:list',
    preload: ['listDevices'],
    async exec(deps, input = {}) {
      const { deferSecureMeshStartup, ensureSignalingOnline, getMeshService, getProvisioningService, loadProfiles, markSecureMeshAccessUnlocked, meshCall, meshNetworkEnrollmentEnabled, secureMeshAccessUnlocked, sessionIndex } = deps;
      // Session counts come from the index; refresh it once (shared with the list).
      await sessionIndex.refresh(loadProfiles()).catch(() => null);
      const requestSecureAccess = input?.requestSecureAccess === true;
      const deferKeyAccess = deferSecureMeshStartup
        && !secureMeshAccessUnlocked
        && !requestSecureAccess;
      const result = meshCall(() => getMeshService().getOverview({ deferKeyAccess }));
      if (result.ok && result.overview?.keyState === 'available') {
        const newlyUnlocked = markSecureMeshAccessUnlocked();
        if (newlyUnlocked && deferSecureMeshStartup) getProvisioningService().resumeActiveJobs();
      }
      if (
        result.ok
        && result.overview?.keyState === 'available'
        && result.overview?.initialized
        && meshNetworkEnrollmentEnabled(result.overview)
      ) void ensureSignalingOnline().catch(() => {});
      return result;
    }
  },
  {
    id: 'onboarding.initializeFirstAgent',
    channel: 'onboarding:initializeFirstAgent',
    preload: ['initializeFirstAgent'],
    exec(deps, input = {}) {
      const { apps, boundedText, getMeshService, initializeFirstAgent, loadProfiles, setMeshNetworkEnrollmentEnabled, withMeshRuntime } = deps;
      try {
        const result = initializeFirstAgent(input, {
          isKnownApp: (appId) => apps.isKnownApp(appId),
          listProfiles: () => loadProfiles(),
          meshService: getMeshService(),
          deviceName: os.hostname(),
          setNetworkEnrollmentEnabled: setMeshNetworkEnrollmentEnabled
        });
        return {
          ok: true,
          ...result,
          overview: withMeshRuntime(result.overview)
        };
      } catch (error) {
        return {
          ok: false,
          reasonCode: boundedText(error?.message || 'first-agent-initialization-failed', 160)
        };
      }
    }
  },
  {
    id: 'devices.initialize',
    channel: 'devices:initialize',
    preload: ['initializeMesh'],
    exec(deps, input = {}) {
      const { boundedText, getMeshService, meshCall, setMeshNetworkEnrollmentEnabled } = deps;
      const before = getMeshService().getOverview();
      if (!before.initialized) setMeshNetworkEnrollmentEnabled(false);
      const result = meshCall(() => getMeshService().initialize({
        deviceName: boundedText(input.deviceName, 80),
        displayName: boundedText(input.displayName, 80)
      }));
      return result;
    }
  },
  {
    id: 'devices.rename',
    channel: 'devices:rename',
    preload: ['renameDevice'],
    exec(deps, input = {}) {
      const { boundedText, getMeshService, meshCall } = deps;
      return meshCall(() => getMeshService().rename({
        deviceId: boundedText(input.deviceId, 128),
        name: boundedText(input.name, 80)
      }));
    }
  },
  {
    id: 'devices.resetMesh',
    channel: 'devices:resetMesh',
    preload: ['resetMesh'],
    async exec(deps) {
      const { closePairingEndpoint, getMeshService, invitationInspectionRegistry, meshCall, pairingApprovalRegistry, peerManager, remoteControlService, setMeshNetworkEnrollmentEnabled, setMeshReachability, stopMeshJobServices, stopSignalingClient } = deps;
      invitationInspectionRegistry.clear();
      pairingApprovalRegistry.stop('mesh-reset');
      stopMeshJobServices('mesh-reset');
      await remoteControlService?.stopAll('mesh-reset');
      peerManager?.disconnectAll('mesh-reset');
      await stopSignalingClient('mesh-reset');
      setMeshReachability(false);
      setMeshNetworkEnrollmentEnabled(false);
      await closePairingEndpoint();
      const result = meshCall(() => getMeshService().reset());
      return result;
    }
  },
  {
    id: 'devices.probeTransport',
    channel: 'devices:probeTransport',
    preload: ['probeMeshTransport'],
    async exec(deps) {
      const { BrowserWindow, boundedText, electronIpcMain, runWebRtcProbe } = deps;
      try {
        const result = await runWebRtcProbe({
          BrowserWindow,
          ipcMain: electronIpcMain,
          probeDirectory: path.join(__dirname, 'mesh', 'probe')
        });
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          reasonCode: boundedText(error?.message || 'webrtc-probe-failed', 160)
        };
      }
    }
  },
  {
    id: 'devices.createInvite',
    channel: 'devices:createInvite',
    preload: ['createDeviceInvite'],
    async exec(deps) {
      const { boundedText, closePairingEndpoint, ensureSignalingOnline, getMeshService, openPairingEndpoint, pairingApprovalRegistry, setMeshNetworkEnrollmentEnabled } = deps;
      try {
        pairingApprovalRegistry.stop('pairing-invite-replaced');
        setMeshNetworkEnrollmentEnabled(true);
        try { await ensureSignalingOnline(); } catch (_error) { /* LAN invitation remains available. */ }
        await openPairingEndpoint();
        return { ok: true, invitation: getMeshService().createInvite() };
      } catch (error) {
        await closePairingEndpoint();
        return { ok: false, reasonCode: boundedText(error?.message || 'pairing-invite-failed', 160) };
      }
    }
  },
  {
    id: 'devices.cancelInvite',
    channel: 'devices:cancelInvite',
    preload: ['cancelDeviceInvite'],
    async exec(deps, input = {}) {
      const { boundedText, closePairingEndpoint, getMeshService, meshReachabilityEnabled, pairingApprovalRegistry } = deps;
      const inviteId = boundedText(input.inviteId, 128);
      getMeshService().cancelInvite({ inviteId });
      if (inviteId) pairingApprovalRegistry.cancelInvite(inviteId);
      else pairingApprovalRegistry.stop('pairing-invite-cancelled');
      if (!meshReachabilityEnabled) await closePairingEndpoint();
      return { ok: true };
    }
  },
  {
    id: 'devices.inspectInvite',
    channel: 'devices:inspectInvite',
    preload: ['inspectDeviceInvitation'],
    exec(deps, input = {}) {
      const { boundedText, getMeshService, invitationInspectionRegistry, normalizeInvitationInspectionInput } = deps;
      try {
        const normalized = normalizeInvitationInspectionInput(input);
        const preview = getMeshService().inspectInvite(normalized);
        return {
          ok: true,
          preview: invitationInspectionRegistry.issue(normalized.code, preview)
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'pairing-invite-preview-failed', 160) };
      }
    }
  },
  {
    id: 'devices.listPairingClaims',
    channel: 'devices:listPairingClaims',
    preload: ['listPairingClaims'],
    exec(deps) {
      const { pairingApprovalRegistry } = deps;
      return ({
      ok: true,
      claims: pairingApprovalRegistry.list()
    });
    }
  },
  {
    id: 'devices.decidePairingClaim',
    channel: 'devices:decidePairingClaim',
    preload: ['decidePairingClaim'],
    exec(deps, input = {}) {
      const { boundedText, normalizePairingDecisionInput, pairingApprovalRegistry } = deps;
      try {
        pairingApprovalRegistry.decide(normalizePairingDecisionInput(input));
        return { ok: true };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'pairing-approval-failed', 160) };
      }
    }
  },
  {
    id: 'devices.join',
    channel: 'devices:join',
    preload: ['joinDeviceMesh'],
    async exec(deps, input = {}) {
      const { boundedText, closePairingEndpoint, ensureSignalingOnline, forgetSignalingClient, getMeshService, getPeerManager, invitationInspectionRegistry, meshReachabilityEnabled, normalizeConfirmedJoinInput, openPairingEndpoint, pairingEndpoint, setMeshNetworkEnrollmentEnabled, withMeshRuntime } = deps;
      try {
        const normalized = normalizeConfirmedJoinInput(input);
        invitationInspectionRegistry.consume(normalized);
        setMeshNetworkEnrollmentEnabled(true);
        await openPairingEndpoint({ ttlMs: 2 * 60_000 });
        const joined = await getMeshService().join({
          code: normalized.code
        });
        forgetSignalingClient();
        try { await ensureSignalingOnline(); } catch (_error) { /* Pairing succeeded; diagnostics shows signaling state. */ }
        getMeshService().updateLocalEndpoints(pairingEndpoint?.endpoints() || []);
        const remote = joined.devices.find((device) => !device.isLocal);
        let connection = null;
        let connectionError = null;
        if (remote) {
          try {
            connection = await getPeerManager().connect(remote.deviceId);
            if (!meshReachabilityEnabled) await closePairingEndpoint();
          } catch (error) {
            connectionError = boundedText(error?.message || 'peer-connect-failed', 160);
          }
        }
        return {
          ok: true,
          overview: withMeshRuntime(getMeshService().getOverview()),
          connection,
          connectionError
        };
      } catch (error) {
        if (!meshReachabilityEnabled) await closePairingEndpoint();
        return { ok: false, reasonCode: boundedText(error?.message || 'mesh-operation-failed', 160) };
      }
    }
  },
  {
    id: 'devices.setReachable',
    channel: 'devices:setReachable',
    preload: ['setDeviceReachable'],
    async exec(deps, input = {}) {
      const { boundedText, closePairingEndpoint, getMeshService, openPairingEndpoint, setMeshNetworkEnrollmentEnabled, setMeshReachability, withMeshRuntime } = deps;
      try {
        if (input.enabled === true) {
          if (!getMeshService().getOverview().initialized) throw new Error('mesh-not-initialized');
          setMeshNetworkEnrollmentEnabled(true);
          setMeshReachability(true);
          await openPairingEndpoint({ ttlMs: 30 * 60_000 });
        } else {
          setMeshReachability(false);
          await closePairingEndpoint();
        }
        return { ok: true, overview: withMeshRuntime(getMeshService().getOverview()) };
      } catch (error) {
        setMeshReachability(false);
        return { ok: false, reasonCode: boundedText(error?.message || 'mesh-reachability-failed', 160) };
      }
    }
  },
  {
    id: 'devices.connect',
    channel: 'devices:connect',
    preload: ['connectDevice'],
    async exec(deps, input = {}) {
      const { boundedText, ensureSignalingOnline, getMeshService, getPeerManager, setMeshNetworkEnrollmentEnabled, withMeshRuntime } = deps;
      try {
        setMeshNetworkEnrollmentEnabled(true);
        try { await ensureSignalingOnline(); } catch (_error) { /* LAN is still attempted first. */ }
        const connection = await getPeerManager().connect(boundedText(input.deviceId, 128));
        return { ok: true, connection, overview: withMeshRuntime(getMeshService().getOverview()) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'peer-connect-failed', 160) };
      }
    }
  },
  {
    id: 'devices.disconnect',
    channel: 'devices:disconnect',
    preload: ['disconnectDevice'],
    async exec(deps, input = {}) {
      const { boundedText, getMeshService, getPeerManager, remoteControlService, withMeshRuntime } = deps;
      try {
        await remoteControlService?.stopDevice(boundedText(input.deviceId, 128), 'device-disconnect');
        await getPeerManager().disconnect(boundedText(input.deviceId, 128));
        return { ok: true, overview: withMeshRuntime(getMeshService().getOverview()) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'peer-disconnect-failed', 160) };
      }
    }
  },
  {
    id: 'devices.getDiagnostics',
    channel: 'devices:getDiagnostics',
    preload: ['getDeviceDiagnostics'],
    exec(deps, input = {}) {
      const { boundedText, deviceDiagnostics } = deps;
      try {
        return {
          ok: true,
          diagnostics: deviceDiagnostics(boundedText(input.deviceId, 128))
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'device-diagnostics-failed', 160) };
      }
    }
  },
  {
    id: 'devices.getNetworkConfig',
    channel: 'devices:getNetworkConfig',
    preload: ['getDeviceNetworkConfig'],
    exec(deps) {
      const { loadSettings } = deps;
      const current = loadSettings();
      return {
        ok: true,
        config: {
          signalingUrls: current.meshSignalingUrls || [],
          stunUrls: current.meshStunUrls || []
        }
      };
    }
  },
  {
    id: 'devices.updateNetworkConfig',
    channel: 'devices:updateNetworkConfig',
    preload: ['updateDeviceNetworkConfig'],
    async exec(deps, input = {}) {
      const { boundedText, configuredSignalingUrls, ensureSignalingOnline, getMeshService, normalizeServiceUrls, normalizeStunUrls, publicNetworkRuntime, stopSignalingClient, updateSettings } = deps;
      try {
        const signalingUrls = normalizeServiceUrls(input.signalingUrls);
        const stunUrls = normalizeStunUrls(input.stunUrls);
        updateSettings({
          meshSignalingUrls: signalingUrls,
          meshStunUrls: stunUrls,
          meshNetworkEnrollmentEnabled: true
        });
        await stopSignalingClient('network-config-changed');
        try { getMeshService().updateLocalSignalUrls(configuredSignalingUrls()); } catch (_error) { /* Mesh can be local-only. */ }
        void ensureSignalingOnline().catch(() => {});
        return {
          ok: true,
          config: { signalingUrls, stunUrls },
          network: publicNetworkRuntime()
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'network-config-invalid', 160) };
      }
    }
  },
  {
    id: 'devices.updatePermissions',
    channel: 'devices:updatePermissions',
    preload: ['updateDevicePermissions'],
    exec(deps, input = {}) {
      const { agentActionService, boundedText, getMeshService, meshCall, peerManager, remoteControlService } = deps;
      const patch = input.permissions && typeof input.permissions === 'object' && !Array.isArray(input.permissions)
        ? Object.fromEntries(Object.entries(input.permissions).map(([key, value]) => [boundedText(key, 80), value === true]))
        : {};
      const result = meshCall(() => getMeshService().updatePermissions({
        deviceId: boundedText(input.deviceId, 128),
        permissions: patch
      }));
      const device = result.overview?.devices?.find((item) => item.deviceId === boundedText(input.deviceId, 128));
      if (device) {
        peerManager?.handlePermissionsChanged(device.deviceId, device.permissions);
        agentActionService?.handlePermissionsChanged(device.deviceId, device.permissions);
        remoteControlService?.handlePermissionsChanged(device.deviceId, device.permissions);
      }
      return result;
    }
  },
  {
    id: 'devices.revoke',
    channel: 'devices:revoke',
    preload: ['revokeDevice'],
    exec(deps, input = {}) {
      const { boundedText, getMeshService, meshCall } = deps;
      return meshCall(() => getMeshService().revoke({
        deviceId: boundedText(input.deviceId, 128),
        reason: boundedText(input.reason, 160),
        remove: input.remove !== false
      }));
    }
  }
];

module.exports = { COMMANDS };
