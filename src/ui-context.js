/*
 * AgentDesk UI context state machine.
 *
 * This module deliberately contains no DOM code. Renderer events use these
 * transitions so device, Agent, slot, conversation, replica, remote, and
 * transfer state cannot silently overwrite one another during render/filter.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UiContext = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const WORKSPACES = new Set(['sessions', 'devices', 'pairing', 'remote']);

  function cleanId(value) {
    const text = String(value || '').trim();
    return text || null;
  }

  function cloneMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value }
      : {};
  }

  function clone(context = {}) {
    return {
      workspaceMode: WORKSPACES.has(context.workspaceMode) ? context.workspaceMode : 'sessions',
      selectedDeviceLensId: cleanId(context.selectedDeviceLensId) || 'all',
      agentScope: context.agentScope === 'all' ? 'all' : 'current',
      selectedAgentIdByDeviceLens: cloneMap(context.selectedAgentIdByDeviceLens),
      selectedSlotKeyByAgentAndLens: cloneMap(context.selectedSlotKeyByAgentAndLens),
      focusedConversationId: cleanId(context.focusedConversationId),
      checkedConversationIds: new Set(context.checkedConversationIds || []),
      selectedReplicaKeyByConversation: cloneMap(context.selectedReplicaKeyByConversation),
      selectedDeviceDetailId: cleanId(context.selectedDeviceDetailId),
      activeRemoteSessionId: cleanId(context.activeRemoteSessionId),
      transferDraft: context.transferDraft ? {
        ...context.transferDraft,
        selections: Array.isArray(context.transferDraft.selections)
          ? context.transferDraft.selections.map((item) => ({ ...item }))
          : []
      } : null
    };
  }

  function create(overrides = {}) {
    return clone(overrides);
  }

  function slotMemoryKey(lensId, agentId) {
    const lens = cleanId(lensId) || 'all';
    const agent = cleanId(agentId);
    return agent ? `${lens}::${agent}` : '';
  }

  function selectedAgentId(context, lensId = context?.selectedDeviceLensId) {
    const lens = cleanId(lensId) || 'all';
    return cleanId(context?.selectedAgentIdByDeviceLens?.[lens]);
  }

  function selectedSlotKey(context, lensId = context?.selectedDeviceLensId, agentId = null) {
    const agent = cleanId(agentId) || selectedAgentId(context, lensId);
    const key = slotMemoryKey(lensId, agent);
    return key ? cleanId(context?.selectedSlotKeyByAgentAndLens?.[key]) : null;
  }

  function setWorkspace(context, workspaceMode) {
    const next = clone(context);
    next.workspaceMode = WORKSPACES.has(workspaceMode) ? workspaceMode : 'sessions';
    return next;
  }

  function setDeviceLens(context, lensId, options = {}) {
    const next = clone(context);
    const lens = cleanId(lensId) || 'all';
    next.selectedDeviceLensId = lens;
    if (options.validAgentIds) {
      const valid = new Set(options.validAgentIds);
      const remembered = selectedAgentId(next, lens);
      if (remembered && !valid.has(remembered)) delete next.selectedAgentIdByDeviceLens[lens];
    }
    return next;
  }

  function setAgent(context, agentId, options = {}) {
    const next = clone(context);
    const lens = next.selectedDeviceLensId || 'all';
    const agent = cleanId(agentId);
    if (!agent) {
      delete next.selectedAgentIdByDeviceLens[lens];
      return next;
    }
    next.selectedAgentIdByDeviceLens[lens] = agent;
    const slot = cleanId(options.slotKey);
    if (slot) next.selectedSlotKeyByAgentAndLens[slotMemoryKey(lens, agent)] = slot;
    return next;
  }

  function setSlot(context, slotKey) {
    const next = clone(context);
    const lens = next.selectedDeviceLensId || 'all';
    const agent = selectedAgentId(next, lens);
    const memoryKey = slotMemoryKey(lens, agent);
    if (!memoryKey) return next;
    const slot = cleanId(slotKey);
    if (slot) next.selectedSlotKeyByAgentAndLens[memoryKey] = slot;
    else delete next.selectedSlotKeyByAgentAndLens[memoryKey];
    return next;
  }

  function setAgentScope(context, scope) {
    const next = clone(context);
    next.agentScope = scope === 'all' ? 'all' : 'current';
    return next;
  }

  function focusConversation(context, conversationId) {
    const next = clone(context);
    next.focusedConversationId = cleanId(conversationId);
    return next;
  }

  function checkConversation(context, conversationId, checked) {
    const next = clone(context);
    const id = cleanId(conversationId);
    if (!id) return next;
    if (checked) next.checkedConversationIds.add(id);
    else next.checkedConversationIds.delete(id);
    return next;
  }

  function setCheckedConversations(context, conversationIds) {
    const next = clone(context);
    next.checkedConversationIds = new Set((conversationIds || []).map(cleanId).filter(Boolean));
    return next;
  }

  function clearConversationActions(context) {
    const next = clone(context);
    next.focusedConversationId = null;
    next.checkedConversationIds.clear();
    return next;
  }

  function actionConversationIds(context) {
    const checked = [...(context?.checkedConversationIds || [])].map(cleanId).filter(Boolean);
    if (checked.length) return checked;
    const focused = cleanId(context?.focusedConversationId);
    return focused ? [focused] : [];
  }

  function selectReplica(context, conversationId, replicaId) {
    const next = clone(context);
    const conversation = cleanId(conversationId);
    if (!conversation) return next;
    const replica = cleanId(replicaId);
    if (replica) next.selectedReplicaKeyByConversation[conversation] = replica;
    else delete next.selectedReplicaKeyByConversation[conversation];
    return next;
  }

  function resolveReplica(context, conversation, conversationId) {
    const replicas = Array.isArray(conversation?.replicas) ? conversation.replicas : [];
    if (!replicas.length) {
      return {
        resolved: true,
        requiresSelection: false,
        replica: null,
        replicaId: cleanId(conversation?._replicaId)
      };
    }
    const lens = cleanId(context?.selectedDeviceLensId) || 'all';
    const candidates = lens === 'all'
      ? replicas
      : replicas.filter((replica) => String(replica.deviceId || '') === lens);
    if (candidates.length === 1) {
      return {
        resolved: true,
        requiresSelection: false,
        replica: candidates[0],
        replicaId: cleanId(candidates[0].replicaId)
      };
    }
    const key = cleanId(conversationId);
    const explicit = key && cleanId(context?.selectedReplicaKeyByConversation?.[key]);
    const selected = explicit && candidates.find((replica) => String(replica.replicaId || '') === explicit);
    return {
      resolved: Boolean(selected),
      requiresSelection: candidates.length > 1,
      replica: selected || null,
      replicaId: selected ? cleanId(selected.replicaId) : null,
      candidates
    };
  }

  function viewDeviceSessions(context, deviceId) {
    let next = setDeviceLens(context, deviceId);
    next = setWorkspace(next, 'sessions');
    next = setAgentScope(next, 'all');
    return clearConversationActions(next);
  }

  function viewDeviceAgentSessions(context, input = {}) {
    let next = setDeviceLens(context, input.deviceId);
    next = setAgent(next, input.agentId, { slotKey: input.slotKey });
    next = setAgentScope(next, 'current');
    next = setWorkspace(next, 'sessions');
    return clearConversationActions(next);
  }

  function selectDeviceDetail(context, deviceId) {
    const next = clone(context);
    next.selectedDeviceDetailId = cleanId(deviceId);
    return next;
  }

  function createSessionPointerDraft(context, input = {}) {
    const next = clone(context);
    next.transferDraft = {
      kind: 'session-pointer',
      targetDeviceId: cleanId(input.targetDeviceId),
      selections: (input.selections || []).map((item) => ({
        conversationId: cleanId(item?.conversationId),
        replicaId: cleanId(item?.replicaId)
      })).filter((item) => item.conversationId && item.replicaId),
      message: cleanId(input.message),
      tone: input.tone === 'error' || input.tone === 'busy' ? input.tone : 'idle'
    };
    return next;
  }

  function createFileDraft(context, input = {}) {
    const next = clone(context);
    next.transferDraft = {
      kind: 'files',
      targetDeviceId: cleanId(input.targetDeviceId),
      selections: [],
      message: cleanId(input.message),
      tone: input.tone === 'error' || input.tone === 'busy' ? input.tone : 'idle'
    };
    return next;
  }

  function updateTransferDraft(context, patch = {}) {
    const next = clone(context);
    if (!next.transferDraft) return next;
    next.transferDraft = {
      ...next.transferDraft,
      ...patch,
      targetDeviceId: Object.prototype.hasOwnProperty.call(patch, 'targetDeviceId')
        ? cleanId(patch.targetDeviceId)
        : next.transferDraft.targetDeviceId,
      selections: Array.isArray(patch.selections)
        ? patch.selections.map((item) => ({ ...item }))
        : next.transferDraft.selections
    };
    return next;
  }

  function clearTransferDraft(context) {
    const next = clone(context);
    next.transferDraft = null;
    return next;
  }

  function openRemote(context, sessionId) {
    const next = setWorkspace(context, 'remote');
    next.activeRemoteSessionId = cleanId(sessionId);
    return next;
  }

  function returnFromRemote(context, sessionId) {
    const next = setWorkspace(context, 'sessions');
    next.activeRemoteSessionId = cleanId(sessionId) || next.activeRemoteSessionId;
    return next;
  }

  function disconnectRemote(context, sessionId, remainingSessionIds = []) {
    const next = clone(context);
    const disconnected = cleanId(sessionId);
    const remaining = new Set((remainingSessionIds || []).map(cleanId).filter(Boolean));
    if (!next.activeRemoteSessionId || next.activeRemoteSessionId === disconnected || !remaining.has(next.activeRemoteSessionId)) {
      next.activeRemoteSessionId = null;
    }
    if (!remaining.size && next.workspaceMode === 'remote') next.workspaceMode = 'sessions';
    return next;
  }

  function clearInvalid(context, validity = {}) {
    const next = clone(context);
    if (validity.validLensIds) {
      const valid = new Set(validity.validLensIds);
      if (!valid.has(next.selectedDeviceLensId)) next.selectedDeviceLensId = valid.has('all') ? 'all' : null;
    }

    if (validity.validAgentIdsByLens) {
      for (const [lens, agent] of Object.entries(next.selectedAgentIdByDeviceLens)) {
        const ids = validity.validAgentIdsByLens[lens];
        if (ids && !new Set(ids).has(agent)) delete next.selectedAgentIdByDeviceLens[lens];
      }
    }

    if (validity.validSlotKeysByAgentAndLens) {
      for (const [key, slot] of Object.entries(next.selectedSlotKeyByAgentAndLens)) {
        const ids = validity.validSlotKeysByAgentAndLens[key];
        if (ids && !new Set(ids).has(slot)) delete next.selectedSlotKeyByAgentAndLens[key];
      }
    }

    if (validity.validConversationIds) {
      const valid = new Set(validity.validConversationIds);
      if (next.focusedConversationId && !valid.has(next.focusedConversationId)) next.focusedConversationId = null;
      next.checkedConversationIds = new Set([...next.checkedConversationIds].filter((id) => valid.has(id)));
      for (const conversationId of Object.keys(next.selectedReplicaKeyByConversation)) {
        if (!valid.has(conversationId)) delete next.selectedReplicaKeyByConversation[conversationId];
      }
    }

    if (validity.validReplicaIdsByConversation) {
      for (const [conversationId, replicaId] of Object.entries(next.selectedReplicaKeyByConversation)) {
        const ids = validity.validReplicaIdsByConversation[conversationId];
        if (ids && !new Set(ids).has(replicaId)) delete next.selectedReplicaKeyByConversation[conversationId];
      }
    }

    if (validity.validDeviceDetailIds) {
      const valid = new Set(validity.validDeviceDetailIds);
      if (next.selectedDeviceDetailId && !valid.has(next.selectedDeviceDetailId)) next.selectedDeviceDetailId = null;
    }

    if (validity.validRemoteSessionIds) {
      const valid = new Set(validity.validRemoteSessionIds);
      if (next.activeRemoteSessionId && !valid.has(next.activeRemoteSessionId)) next.activeRemoteSessionId = null;
    }
    return next;
  }

  return {
    create,
    clone,
    slotMemoryKey,
    selectedAgentId,
    selectedSlotKey,
    setWorkspace,
    setDeviceLens,
    setAgent,
    setSlot,
    setAgentScope,
    focusConversation,
    checkConversation,
    setCheckedConversations,
    clearConversationActions,
    actionConversationIds,
    selectReplica,
    resolveReplica,
    viewDeviceSessions,
    viewDeviceAgentSessions,
    selectDeviceDetail,
    createSessionPointerDraft,
    createFileDraft,
    updateTransferDraft,
    clearTransferDraft,
    openRemote,
    returnFromRemote,
    disconnectRemote,
    clearInvalid
  };
});
