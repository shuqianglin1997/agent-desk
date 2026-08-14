/*
 * AgentDesk add-device journey state.
 *
 * Trust, connection, catalog and inventory are intentionally independent
 * facts. The Renderer may remember observations for the lifetime of the
 * window, but this module never turns a pairing result into "usable" unless
 * every required fact is present.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeviceJourney = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ROLES = new Set(['host', 'join']);
  const PHASES = new Set(['identity', 'trust', 'connect', 'catalog', 'inventory', 'complete']);
  const CATALOG_FEATURES = new Set(['catalog.events.v1', 'catalog.snapshot.v1']);

  function text(value, max = 160) {
    return String(value || '').trim().slice(0, max);
  }

  function safeIds(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map((item) => text(item, 128))
      .filter(Boolean))];
  }

  function safeInvitation(value) {
    if (!value || typeof value !== 'object') return null;
    const inviteId = text(value.inviteId, 128);
    const code = text(value.code, 64 * 1024);
    if (!inviteId || !code) return null;
    return {
      inviteId,
      code,
      shortCode: text(value.shortCode, 24),
      expiresAt: text(value.expiresAt, 64) || null,
      sourceDeviceName: text(value.sourceDeviceName, 80) || null
    };
  }

  function safePreview(value) {
    if (!value || typeof value !== 'object') return null;
    const inviteId = text(value.inviteId, 128);
    const confirmationToken = text(value.confirmationToken, 512);
    if (!inviteId || !confirmationToken) return null;
    return {
      inviteId,
      confirmationToken,
      sourceDeviceId: text(value.sourceDeviceId, 128) || null,
      sourceDeviceName: text(value.sourceDeviceName, 80) || null,
      sourceFingerprint: text(value.sourceFingerprint, 128) || null,
      platform: text(value.platform, 40) || null,
      appVersion: text(value.appVersion, 40) || null,
      expiresAt: text(value.expiresAt, 64) || null
    };
  }

  function safeClaim(value) {
    if (!value || typeof value !== 'object') return null;
    const approvalId = text(value.approvalId, 256);
    const inviteId = text(value.inviteId, 128);
    const deviceId = text(value.deviceId, 128);
    if (!approvalId || !inviteId || !deviceId) return null;
    return {
      approvalId,
      inviteId,
      deviceId,
      name: text(value.name, 80) || 'Device',
      fingerprint: text(value.fingerprint, 128) || null,
      platform: text(value.platform, 40) || null,
      arch: text(value.arch, 40) || null,
      osVersion: text(value.osVersion, 120) || null,
      appVersion: text(value.appVersion, 40) || null,
      expiresAt: text(value.expiresAt, 64) || null
    };
  }

  function safeTarget(device) {
    if (!device || typeof device !== 'object') return null;
    const deviceId = text(device.deviceId, 128);
    if (!deviceId) return null;
    return {
      deviceId,
      name: text(device.name, 80) || 'Device',
      platform: text(device.platform, 40) || null,
      arch: text(device.arch, 40) || null,
      appVersion: text(device.appVersion, 40) || null,
      fingerprint: text(device.fingerprint, 128) || null,
      pairedAt: text(device.pairedAt, 64) || null,
      status: text(device.status, 40) || 'offline',
      permissions: safeIds(device.permissions),
      inventoryRevision: Number.isSafeInteger(Number(device.inventoryRevision))
        ? Math.max(0, Number(device.inventoryRevision))
        : 0,
      inventoryGeneratedAt: text(device.inventoryGeneratedAt, 64) || null,
      isLocal: device.isLocal === true
    };
  }

  function targetFromOverview(overview, model) {
    const devices = Array.isArray(overview?.devices) ? overview.devices : [];
    const explicit = text(model.targetDeviceId, 128);
    const baseline = new Set(model.baselineDeviceIds || []);
    const target = devices.find((device) => !device?.isLocal && device.deviceId === explicit)
      || devices.find((device) => !device?.isLocal && !baseline.has(String(device.deviceId || '')))
      || (model.role === 'join' ? devices.find((device) => !device?.isLocal) : null);
    return safeTarget(target);
  }

  function connectionFromOverview(overview, targetDeviceId) {
    return (Array.isArray(overview?.connections) ? overview.connections : []).find((item) => (
      text(item?.deviceId, 128) === targetDeviceId
    )) || null;
  }

  function supportsCatalog(connection, target) {
    const features = new Set(safeIds(connection?.protocolFeatures));
    return target?.permissions?.includes('catalog.manage') === true
      && [...CATALOG_FEATURES].some((feature) => features.has(feature));
  }

  function facts(model, overview) {
    const target = targetFromOverview(overview, model);
    const connection = target ? connectionFromOverview(overview, target.deviceId) : null;
    const trusted = Boolean(target?.pairedAt);
    const connected = connection?.authenticated === true;
    const inventoryReady = Boolean(
      target
      && target.inventoryRevision > 0
      && target.inventoryGeneratedAt
    ) || model.inventoryObserved === true;
    const catalogSupported = Boolean(target && connection && supportsCatalog(connection, target));
    // A successful devices:connect/join call returns only after PeerManager's
    // first-catalog and first-inventory barriers. Runtime events may establish
    // the same fact earlier. Unsupported/denied catalog remains separate.
    const catalogReady = model.catalogObserved === true
      || (model.connectionCompleted === true && connected && catalogSupported);
    const catalogUnavailable = model.catalogUnavailable === true
      || (connected && inventoryReady && !catalogSupported);
    const usable = model.identityConfirmed === true
      && trusted
      && connected
      && catalogReady
      && inventoryReady;
    return {
      target,
      trusted,
      connected,
      catalogSupported,
      catalogReady,
      catalogUnavailable,
      inventoryReady,
      usable
    };
  }

  function nextPhase(model, overview) {
    const value = facts(model, overview);
    if (!model.identityConfirmed) return 'identity';
    if (!value.trusted) return 'trust';
    if (!value.connected) return 'connect';
    if (!value.catalogReady) return 'catalog';
    if (!value.inventoryReady) return 'inventory';
    return 'complete';
  }

  function create(input = {}) {
    const role = ROLES.has(input.role) ? input.role : 'host';
    const baselineDeviceIds = safeIds(input.baselineDeviceIds);
    const model = {
      role,
      phase: 'identity',
      baselineDeviceIds,
      targetDeviceId: text(input.targetDeviceId, 128) || null,
      invitation: safeInvitation(input.invitation),
      inviteCode: '',
      preview: safePreview(input.preview),
      claim: safeClaim(input.claim),
      approvalSubmitted: input.approvalSubmitted === true,
      identityConfirmed: input.identityConfirmed === true,
      connectionCompleted: input.connectionCompleted === true,
      catalogObserved: input.catalogObserved === true,
      catalogUnavailable: input.catalogUnavailable === true,
      inventoryObserved: input.inventoryObserved === true,
      busy: false,
      errorCode: null
    };
    const target = targetFromOverview(input.overview, model);
    if (target) model.targetDeviceId = target.deviceId;
    model.phase = nextPhase(model, input.overview);
    return model;
  }

  function clone(model) {
    return {
      ...model,
      baselineDeviceIds: [...(model.baselineDeviceIds || [])],
      invitation: model.invitation ? { ...model.invitation } : null,
      preview: model.preview ? { ...model.preview } : null,
      claim: model.claim ? { ...model.claim } : null
    };
  }

  function transition(model, event = {}, overview = null) {
    const next = clone(model || create());
    const type = String(event.type || '');
    if (type === 'code') {
      next.inviteCode = text(event.code, 64 * 1024);
      next.preview = null;
      next.identityConfirmed = false;
      next.errorCode = null;
    } else if (type === 'invitation') {
      next.invitation = safeInvitation(event.invitation);
      next.errorCode = next.invitation ? null : 'device-invitation-incomplete';
    } else if (type === 'reset-invitation') {
      next.invitation = null;
      next.errorCode = null;
    } else if (type === 'preview') {
      next.preview = safePreview(event.preview);
      next.identityConfirmed = false;
      next.errorCode = next.preview ? null : 'device-invite-preview-incomplete';
    } else if (type === 'claim') {
      const claim = safeClaim(event.claim);
      if (claim && (!next.invitation || next.invitation.inviteId === claim.inviteId)) {
        next.claim = claim;
        next.approvalSubmitted = false;
        next.targetDeviceId = claim.deviceId;
        next.identityConfirmed = false;
        next.errorCode = null;
      }
    } else if (type === 'claim-cleared') {
      next.claim = null;
      next.approvalSubmitted = false;
      if (!targetFromOverview(overview, next)) next.identityConfirmed = false;
    } else if (type === 'claim-decision') {
      next.approvalSubmitted = event.confirmed === true;
      if (event.confirmed !== true) {
        next.claim = null;
        next.identityConfirmed = false;
      }
    } else if (type === 'confirm-identity') {
      const canConfirm = next.role === 'join'
        ? Boolean(next.preview)
        : Boolean(next.claim || targetFromOverview(overview, next));
      next.identityConfirmed = canConfirm && event.confirmed === true;
      next.errorCode = next.identityConfirmed ? null : 'device-identity-confirmation-required';
    } else if (type === 'target') {
      next.targetDeviceId = text(event.deviceId, 128) || next.targetDeviceId;
    } else if (type === 'connection-result') {
      next.connectionCompleted = event.ok === true;
      next.errorCode = event.ok === true ? null : text(event.reasonCode, 160) || 'peer-connect-failed';
    } else if (type === 'connection-state') {
      const targetId = text(event.deviceId, 128);
      if (!next.targetDeviceId && targetId) next.targetDeviceId = targetId;
      if (!next.targetDeviceId || next.targetDeviceId === targetId) {
        if (event.state === 'catalog-synced') {
          next.catalogObserved = true;
          next.catalogUnavailable = false;
        }
        if (event.state === 'catalog-unavailable') next.catalogUnavailable = true;
        if (event.state === 'inventory-synced') next.inventoryObserved = true;
        if (event.state === 'error' || event.state === 'disconnected') {
          next.connectionCompleted = false;
          next.errorCode = text(event.reason, 160) || `peer-${event.state}`;
        }
      }
    } else if (type === 'busy') {
      next.busy = event.busy === true;
      if (next.busy) next.errorCode = null;
    } else if (type === 'failed') {
      next.busy = false;
      next.errorCode = text(event.reasonCode, 160) || 'device-journey-failed';
    } else if (type === 'clear-error') {
      next.errorCode = null;
    }
    const target = targetFromOverview(overview, next);
    if (target) next.targetDeviceId = target.deviceId;
    next.phase = PHASES.has(event.forcePhase)
      ? event.forcePhase
      : nextPhase(next, overview);
    return next;
  }

  function stepStates(model, overview) {
    const value = facts(model, overview);
    const states = {
      identity: model.identityConfirmed ? 'complete' : 'current',
      trust: value.trusted ? 'complete' : (model.identityConfirmed ? 'current' : 'pending'),
      connect: value.connected ? 'complete' : (value.trusted ? 'current' : 'pending'),
      catalog: value.catalogReady
        ? 'complete'
        : (value.catalogUnavailable ? 'error' : (value.connected ? 'current' : 'pending')),
      inventory: value.inventoryReady ? 'complete' : (value.connected ? 'current' : 'pending')
    };
    if (value.usable) Object.keys(states).forEach((key) => { states[key] = 'complete'; });
    return states;
  }

  return {
    create,
    transition,
    facts,
    stepStates,
    safeInvitation,
    safePreview,
    safeClaim
  };
});
