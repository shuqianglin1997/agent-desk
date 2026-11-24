'use strict';

// AgentDesk — the global agent catalog, local agent slots, preparing an agent
// on this device, and the fixed remote agent actions (open, prepare). Inputs
// are stable ids and bounded enums; Main re-reads the catalog and profiles.
// Bodies moved from main.js registerIpc unchanged.

const COMMANDS = [
  {
    id: 'agentCatalog.list',
    channel: 'agentCatalog:list',
    preload: ['listAgentCatalog'],
    exec(deps) {
      const { getMeshService, meshCall } = deps;
      return meshCall(() => getMeshService().getOverview());
    }
  },
  {
    id: 'agentCatalog.create',
    channel: 'agentCatalog:create',
    preload: ['createAgent'],
    exec(deps, input = {}) {
      const { boundedText, finiteRevision, getMeshService, peerManager, withMeshRuntime } = deps;
      try {
        const before = getMeshService().getOverview();
        const knownIds = new Set((before.agents || []).map((agent) => agent.agentId));
        const overview = getMeshService().createAgent({
          displayName: boundedText(input.displayName, 80),
          group: boundedText(input.group, 80),
          note: boundedText(input.note, 1000),
          baseRevision: finiteRevision(input.baseRevision)
        });
        const agent = overview.agents.find((item) => !knownIds.has(item.agentId));
        if (!agent) throw new Error('agent-create-result-missing');
        void peerManager?.broadcastCatalog();
        return { ok: true, agent, overview: withMeshRuntime(overview) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'agent-create-failed', 160) };
      }
    }
  },
  {
    id: 'agentCatalog.get',
    channel: 'agentCatalog:get',
    preload: ['getAgentCatalog'],
    exec(deps, input = {}) {
      const { boundedText, getMeshService, meshCall } = deps;
      return meshCall(() => {
        const overview = getMeshService().getOverview();
        const agentId = boundedText(input.agentId, 128);
        const agent = overview.agents.find((item) => item.agentId === agentId);
        if (!agent) throw new Error('agent-not-found');
        return {
          agent,
          accountBindings: overview.accountBindings.filter((item) => item.agentId === agentId),
          slots: overview.slots.filter((item) => item.agentId === agentId)
        };
      }, 'catalog');
    }
  },
  {
    id: 'agentCatalog.rename',
    channel: 'agentCatalog:rename',
    preload: ['renameAgent'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService, normalizeCat } = deps;
      return catalogMeshCall(() => getMeshService().updateAgent({
        agentId: boundedText(input.agentId, 128),
        displayName: boundedText(input.displayName, 80),
        group: boundedText(input.group, 80),
        note: boundedText(input.note, 1000),
        catAppearance: input.catAppearance && typeof input.catAppearance === 'object'
          ? normalizeCat(input.catAppearance, boundedText(input.agentId, 128))
          : undefined,
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentCatalog.merge',
    channel: 'agentCatalog:merge',
    preload: ['mergeAgents'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().mergeAgents({
        sourceAgentId: boundedText(input.sourceAgentId, 128),
        targetAgentId: boundedText(input.targetAgentId, 128),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentCatalog.split',
    channel: 'agentCatalog:split',
    preload: ['splitAccountBinding'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().splitAccountBinding({
        accountBindingId: boundedText(input.accountBindingId, 128),
        displayName: boundedText(input.displayName, 80),
        group: boundedText(input.group, 80),
        note: boundedText(input.note, 1000),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentCatalog.delete',
    channel: 'agentCatalog:delete',
    preload: ['deleteAgent'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().removeCatalogObject({
        scope: 'agent',
        agentId: boundedText(input.agentId, 128),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentCatalog.removeBinding',
    channel: 'agentCatalog:removeBinding',
    preload: ['removeAccountBinding'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().removeCatalogObject({
        scope: 'account-binding',
        accountBindingId: boundedText(input.accountBindingId, 128),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentSlots.list',
    channel: 'agentSlots:list',
    preload: ['listAgentSlots'],
    exec(deps) {
      const { getMeshService, meshCall } = deps;
      return meshCall(() => getMeshService().getOverview().slots, 'slots');
    }
  },
  {
    id: 'agentSlots.addLocal',
    channel: 'agentSlots:addLocal',
    preload: ['addLocalAgentSlot'],
    exec(deps, input = {}) {
      const { boundedText, createStoredProfile, getMeshService, peerManager, removeStoredProfileRegistration, withMeshRuntime } = deps;
      let profile = null;
      try {
        const before = getMeshService().getOverview();
        if (!before.initialized) throw new Error('mesh-not-initialized');
        profile = createStoredProfile({
          appId: boundedText(input.appId, 80),
          name: boundedText(input.name, 80),
          group: boundedText(input.group, 80),
          note: boundedText(input.note, 1000)
        });
        const overview = getMeshService().assignSlot({
          mode: boundedText(input.mode, 40),
          reuseProvisional: true,
          deviceId: before.localDeviceId,
          profileId: profile.id,
          agentId: boundedText(input.agentId, 128),
          accountBindingId: boundedText(input.accountBindingId, 128),
          displayName: boundedText(input.name, 80),
          displayAlias: boundedText(input.name, 80),
          group: boundedText(input.group, 80),
          note: boundedText(input.note, 1000)
        });
        void peerManager?.broadcastCatalog();
        void peerManager?.broadcastInventory();
        return { ok: true, profile, overview: withMeshRuntime(overview) };
      } catch (error) {
        if (profile) {
          removeStoredProfileRegistration(profile.id);
          try { getMeshService().getOverview(); } catch (_cleanupError) { /* original error wins */ }
        }
        return { ok: false, reasonCode: boundedText(error?.message || 'slot-add-failed', 160) };
      }
    }
  },
  {
    id: 'agentSlots.assign',
    channel: 'agentSlots:assign',
    preload: ['assignAgentSlot'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().assignSlot({
        mode: boundedText(input.mode, 40),
        deviceId: boundedText(input.deviceId, 128),
        profileId: boundedText(input.profileId, 128),
        agentId: boundedText(input.agentId, 128),
        accountBindingId: boundedText(input.accountBindingId, 128),
        displayName: boundedText(input.displayName, 80),
        displayAlias: boundedText(input.displayAlias, 80),
        group: boundedText(input.group, 80),
        note: boundedText(input.note, 1000),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentSlots.removeLocal',
    channel: 'agentSlots:removeLocal',
    preload: ['removeLocalAgentSlot'],
    exec(deps, input = {}) {
      const { boundedText, catalogMeshCall, finiteRevision, getMeshService } = deps;
      return catalogMeshCall(() => getMeshService().removeCatalogObject({
        scope: 'slot',
        deviceId: boundedText(input.deviceId, 128),
        profileId: boundedText(input.profileId, 128),
        baseRevision: finiteRevision(input.baseRevision)
      }));
    }
  },
  {
    id: 'agentDeployments.ensureReady',
    channel: 'agentDeployments:ensureReady',
    preload: ['ensureAgentReady'],
    async exec(deps, input = {}) {
      const { boundedText, getProvisioningService, publicProvisioningResult } = deps;
      try {
        const result = await getProvisioningService().ensureReady({
          agentId: boundedText(input.agentId, 128),
          deviceId: boundedText(input.deviceId, 128),
          requestedAppId: boundedText(input.requestedAppId, 80),
          requestedClientForm: boundedText(input.requestedClientForm, 80) || 'desktop',
          interactive: true,
          manualConfirmation: input.manualConfirmation === true
        });
        return publicProvisioningResult(result);
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'provisioning-failed', 160) };
      }
    }
  },
  {
    id: 'agentDeployments.retryPreparation',
    channel: 'agentDeployments:retryPreparation',
    preload: ['retryAgentPreparation'],
    async exec(deps, input = {}) {
      const { boundedText, getProvisioningService, publicProvisioningResult } = deps;
      try {
        const result = await getProvisioningService().retry(
          boundedText(input.jobId, 128),
          { manualConfirmation: input.manualConfirmation === true }
        );
        return publicProvisioningResult(result);
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'provisioning-retry-failed', 160) };
      }
    }
  },
  {
    id: 'agentDeployments.cancelPreparation',
    channel: 'agentDeployments:cancelPreparation',
    preload: ['cancelAgentPreparation'],
    exec(deps, input = {}) {
      const { boundedText, getProvisioningService, publicProvisioningResult } = deps;
      try {
        return publicProvisioningResult(
          getProvisioningService().cancel(boundedText(input.jobId, 128))
        );
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'provisioning-cancel-failed', 160) };
      }
    }
  },
  {
    id: 'agentActions.launchRemote',
    channel: 'agentActions:launchRemote',
    preload: ['launchRemoteAgent'],
    async exec(deps, input = {}) {
      const { boundedText, getAgentActionService, getMeshService, withMeshRuntime } = deps;
      try {
        const result = await getAgentActionService().launchRemote({
          agentId: boundedText(input.agentId, 128),
          deviceId: boundedText(input.deviceId, 128),
          profileId: boundedText(input.profileId, 128)
        });
        return {
          ...result,
          overview: withMeshRuntime(getMeshService().getOverview())
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-launch-failed', 160) };
      }
    }
  },
  {
    id: 'agentActions.prepareRemote',
    channel: 'agentActions:prepareRemote',
    preload: ['prepareRemoteAgent'],
    async exec(deps, input = {}) {
      const { boundedText, getAgentActionService, getMeshService, withMeshRuntime } = deps;
      try {
        const result = await getAgentActionService().prepareRemote({
          agentId: boundedText(input.agentId, 128),
          deviceId: boundedText(input.deviceId, 128),
          requestedAppId: boundedText(input.requestedAppId, 80),
          requestedClientForm: boundedText(input.requestedClientForm, 80) || 'desktop'
        });
        return {
          ...result,
          overview: withMeshRuntime(getMeshService().getOverview())
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'remote-preparation-failed', 160) };
      }
    }
  }
];

module.exports = { COMMANDS };
