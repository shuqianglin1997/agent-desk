/*
 * AgentDesk Agent workspace projection.
 *
 * The Mesh catalog is global while slots and deployments belong to devices.
 * This pure module projects those two axes for the Renderer without letting a
 * missing Slot erase a durable Agent from a device lens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AgentWorkspace = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ACTIVE_PREPARATION_STATES = new Set([
    'planning',
    'preparing',
    'waiting-install',
    'waiting-login',
    'verifying'
  ]);

  const UNAVAILABLE_DEVICE_STATES = new Set([
    'offline',
    'sleeping',
    'revoked'
  ]);

  function slotKey(slot) {
    if (!slot) return '';
    return `${String(slot.deviceId || '')}:${String(slot.profileId || '')}`;
  }

  function projectMeshAgentGroups(input = {}) {
    const overview = input.overview;
    if (!overview?.initialized) return [];
    const lensId = String(input.lensId || 'all');
    const profiles = Array.isArray(input.profiles) ? input.profiles : [];
    const devices = new Map((overview.devices || []).map((device) => [device.deviceId, device]));
    const bindings = new Map((overview.accountBindings || []).map((binding) => [binding.accountBindingId, binding]));
    const blueprints = new Map((overview.blueprints || []).map((blueprint) => [blueprint.agentId, blueprint]));
    const localProfiles = new Map(profiles.map((profile) => [String(profile.id), profile]));

    return (overview.agents || []).map((agent) => {
      const allSlots = (overview.slots || []).filter((slot) => (
        slot.agentId === agent.agentId
        && slot.accountBindingId
        && slot.assignmentState === 'linked'
      ));
      const allMembers = allSlots.map((slot) => memberFromSlot({
        slot,
        agent,
        overview,
        devices,
        bindings,
        localProfiles
      })).sort(compareMembers);
      const members = lensId === 'all'
        ? allMembers
        : allMembers.filter((member) => member._meshDeviceId === lensId);
      const slots = lensId === 'all'
        ? allSlots
        : allSlots.filter((slot) => slot.deviceId === lensId);
      const deployments = (overview.deployments || []).filter((deployment) => deployment.agentId === agent.agentId);
      const deployment = lensId === 'all'
        ? null
        : deployments.find((item) => item.deviceId === lensId) || null;
      const blueprint = blueprints.get(agent.agentId) || null;
      const readiness = resolveReadiness({
        overview,
        agentId: agent.agentId,
        lensId,
        deployments,
        allMembers,
        members
      });
      const source = members[0] || allMembers[0] || {};
      const appId = deployment?.adapterId
        || blueprint?.preferredAppId
        || source.appId
        || 'unknown';
      const primary = {
        ...source,
        id: `agent:${agent.agentId}`,
        name: agent.displayName || source.name || 'Agent',
        appId,
        cat: agent.catAppearance || source.cat || null,
        group: agent.group || source.group || '',
        note: agent.note || source.note || '',
        _meshAgentId: agent.agentId,
        _meshDeviceId: lensId === 'all' ? null : lensId,
        _meshDeviceName: lensId === 'all' ? null : devices.get(lensId)?.name || lensId,
        _presentationOnly: true,
        _deploymentState: readiness.state
      };

      return {
        key: agent.agentId,
        primary,
        members,
        allMembers,
        agent,
        slots,
        allSlots,
        blueprint,
        deployments,
        deployment,
        readiness
      };
    });
  }

  function resolveUnambiguousLocalSelection(input = {}) {
    const overview = input.overview;
    const profiles = Array.isArray(input.profiles) ? input.profiles : [];
    if (!overview?.initialized || !overview.localDeviceId || !profiles.length) return null;

    const localProfileIds = new Set(profiles.map((profile) => String(profile?.id || '')).filter(Boolean));
    const liveAgentIds = new Set((overview.agents || []).map((agent) => String(agent?.agentId || '')).filter(Boolean));
    const slotsByAgent = new Map();
    for (const slot of overview.slots || []) {
      const agentId = String(slot?.agentId || '');
      if (
        slot?.deviceId !== overview.localDeviceId
        || slot?.assignmentState !== 'linked'
        || !slot?.accountBindingId
        || !liveAgentIds.has(agentId)
        || !localProfileIds.has(String(slot?.profileId || ''))
      ) continue;
      const slots = slotsByAgent.get(agentId) || [];
      slots.push(slot);
      slotsByAgent.set(agentId, slots);
    }

    if (slotsByAgent.size !== 1) return null;
    const [[agentId, slots]] = slotsByAgent.entries();
    slots.sort((left, right) => slotKey(left).localeCompare(slotKey(right)));
    return {
      agentId,
      // Selecting the sole linked local Agent is unambiguous. If it has more
      // than one local runtime, leave the action Slot unresolved so the user
      // still chooses the exact side-effect target.
      slotKey: slots.length === 1 ? slotKey(slots[0]) : null
    };
  }

  function memberFromSlot(input) {
    const { slot, agent, overview, devices, bindings, localProfiles } = input;
    const device = devices.get(slot.deviceId) || {};
    const binding = bindings.get(slot.accountBindingId) || {};
    const local = slot.deviceId === overview.localDeviceId
      ? localProfiles.get(String(slot.profileId))
      : null;
    return {
      ...(local || {}),
      id: local ? String(local.id) : `mesh:${slot.deviceId}:${slot.profileId}`,
      name: agent.displayName || local?.name || slot.localLabel || 'Agent',
      appId: slot.appId || local?.appId || 'unknown',
      cat: agent.catAppearance || local?.cat || null,
      group: agent.group || local?.group || '',
      note: agent.note || local?.note || '',
      _meshAgentId: agent.agentId,
      _accountBindingId: slot.accountBindingId,
      _accountBindingAlias: binding.displayAlias || slot.localLabel || null,
      _providerNamespace: binding.providerNamespace || slot.appId || null,
      _meshDeviceId: slot.deviceId,
      _meshProfileId: slot.profileId,
      _meshSlotKey: slotKey(slot),
      _meshDeviceName: device.name || slot.deviceId,
      _remote: slot.deviceId !== overview.localDeviceId,
      _deviceStatus: device.status || 'offline',
      _assignmentState: slot.assignmentState,
      _launchable: slot.launchable === true
    };
  }

  function compareMembers(left, right) {
    if (left._remote !== right._remote) return left._remote ? 1 : -1;
    if (left._deviceStatus !== right._deviceStatus) return left._deviceStatus === 'online' ? -1 : 1;
    return left._meshSlotKey.localeCompare(right._meshSlotKey);
  }

  function resolveReadiness(input = {}) {
    const overview = input.overview || {};
    const lensId = String(input.lensId || 'all');
    const deployments = Array.isArray(input.deployments)
      ? input.deployments
      : (overview.deployments || []).filter((item) => item.agentId === input.agentId);
    const allMembers = Array.isArray(input.allMembers) ? input.allMembers : [];
    const members = Array.isArray(input.members) ? input.members : allMembers;
    const deviceMap = new Map((overview.devices || []).map((device) => [device.deviceId, device]));

    if (lensId !== 'all') {
      const device = deviceMap.get(lensId) || null;
      const deployment = deployments.find((item) => item.deviceId === lensId) || null;
      if (lensId !== overview.localDeviceId && isDeviceUnavailable(device)) {
        return { state: 'offline', deployment, device };
      }
      return {
        state: deployment?.state || inferStateFromMembers(members),
        deployment,
        device
      };
    }

    const onlineReady = deployments.find((deployment) => (
      deployment.state === 'ready'
      && (deployment.deviceId === overview.localDeviceId || !isDeviceUnavailable(deviceMap.get(deployment.deviceId)))
    ));
    if (onlineReady || allMembers.some((member) => member._launchable && !member._remote)) {
      return { state: 'ready', deployment: onlineReady || null, device: onlineReady ? deviceMap.get(onlineReady.deviceId) : null };
    }
    const active = firstByState(deployments, [
      'waiting-login',
      'waiting-install',
      'verifying',
      'preparing',
      'planning'
    ]);
    if (active) return { state: active.state, deployment: active, device: deviceMap.get(active.deviceId) || null };
    const anyReady = deployments.find((deployment) => deployment.state === 'ready')
      || allMembers.find((member) => member._launchable);
    if (anyReady) {
      const deviceId = anyReady.deviceId || anyReady._meshDeviceId;
      return { state: 'offline', deployment: anyReady.deploymentId ? anyReady : null, device: deviceMap.get(deviceId) || null };
    }
    const failed = firstByState(deployments, ['error', 'unsupported']);
    if (failed) return { state: failed.state, deployment: failed, device: deviceMap.get(failed.deviceId) || null };
    return { state: inferStateFromMembers(allMembers), deployment: null, device: null };
  }

  function firstByState(items, states) {
    for (const state of states) {
      const match = items.find((item) => item.state === state);
      if (match) return match;
    }
    return null;
  }

  function inferStateFromMembers(members) {
    if (members.some((member) => member._launchable)) return 'ready';
    if (members.length) return 'waiting-install';
    return 'absent';
  }

  function isDeviceUnavailable(device) {
    return !device || UNAVAILABLE_DEVICE_STATES.has(device.status);
  }

  function isPreparationActive(state) {
    return ACTIVE_PREPARATION_STATES.has(String(state || ''));
  }

  return {
    ACTIVE_PREPARATION_STATES,
    projectMeshAgentGroups,
    resolveUnambiguousLocalSelection,
    resolveReadiness,
    isPreparationActive,
    slotKey
  };
});
