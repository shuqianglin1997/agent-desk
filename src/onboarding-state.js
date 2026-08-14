/*
 * AgentDesk first-use state model.
 *
 * This module deliberately has no DOM, storage, IPC or network access. The
 * Renderer owns presentation, while Main remains the only place allowed to
 * create the local catalog/device identity and start a provisioning job.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OnboardingState = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const CURRENT_VERSION = 1;
  const PHASES = new Set([
    'done',
    'migration',
    'agent',
    'existing',
    'submitting',
    'preparing',
    'complete'
  ]);
  const PREPARATION_STATES = new Set([
    'planning',
    'preparing',
    'waiting-install',
    'waiting-login',
    'verifying',
    'ready',
    'error',
    'unsupported'
  ]);

  function boundedText(value, max = 160) {
    return String(value || '').trim().slice(0, max);
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function normalizeProgress(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      completedVersion: nonNegativeInteger(input.completedVersion),
      completedAt: typeof input.completedAt === 'string'
        ? (boundedText(input.completedAt, 64) || null)
        : null
    };
  }

  function needsPresentation(progress, version = CURRENT_VERSION) {
    return normalizeProgress(progress).completedVersion < nonNegativeInteger(version);
  }

  function safeProfiles(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const profiles = [];
    for (const item of value) {
      const profileId = boundedText(item?.id, 128);
      if (!profileId || seen.has(profileId)) continue;
      seen.add(profileId);
      profiles.push({
        profileId,
        name: boundedText(item?.name, 80) || 'Agent',
        appId: boundedText(item?.appId, 80) || null,
        group: boundedText(item?.group, 80) || null
      });
    }
    return profiles;
  }

  function safeClients(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const clients = [];
    for (const item of value) {
      const appId = boundedText(item?.appId, 80);
      const clientForm = boundedText(item?.clientForm, 80) || 'desktop';
      const key = `${appId}:${clientForm}`;
      if (!appId || seen.has(key)) continue;
      seen.add(key);
      clients.push({
        appId,
        clientForm,
        label: boundedText(item?.label, 80) || appId
      });
    }
    return clients;
  }

  function safeAgents(overview) {
    return Array.isArray(overview?.agents)
      ? overview.agents.map((item) => ({
          agentId: boundedText(item?.agentId, 128),
          displayName: boundedText(item?.displayName, 80) || 'Agent'
        })).filter((item) => item.agentId)
      : [];
  }

  function recoverPreparation(overview, clients) {
    if (!overview?.initialized || !Array.isArray(overview.provisioningJobs)) return null;
    const candidates = overview.provisioningJobs.filter((item) => (
      boundedText(item?.agentId, 128)
      && PREPARATION_STATES.has(String(item?.state || ''))
      && item.state !== 'ready'
    ));
    const job = candidates[candidates.length - 1];
    if (!job) return null;
    const requestedAppId = boundedText(job.requestedAppId, 80);
    const requestedClientForm = boundedText(job.requestedClientForm, 80) || 'desktop';
    const requested = clients.find((item) => (
      item.appId === requestedAppId && item.clientForm === requestedClientForm
    ));
    return {
      agentId: boundedText(job.agentId, 128),
      deviceId: boundedText(job.deviceId, 128) || boundedText(overview.localDeviceId, 128),
      preparation: {
        ok: false,
        state: String(job.state),
        reasonCode: boundedText(job.lastErrorCode || job.waitingReason, 160) || null,
        jobId: boundedText(job.jobId, 128) || null
      },
      draft: {
        requestedAppId: requested?.appId || requestedAppId,
        requestedClientForm: requested?.clientForm || requestedClientForm
      }
    };
  }

  function initialPhase(input, profiles, agents, recovered) {
    if (!needsPresentation(input.progress, input.version)) return 'done';
    if (recovered) return 'preparing';
    if (input.overview?.initialized && agents.length) return 'existing';
    if (!input.overview?.initialized && profiles.length) return 'migration';
    return 'agent';
  }

  function create(input = {}) {
    const version = nonNegativeInteger(input.version) || CURRENT_VERSION;
    const profiles = safeProfiles(input.profiles);
    const clients = safeClients(input.clients);
    const agents = safeAgents(input.overview);
    const recovered = recoverPreparation(input.overview, clients);
    const preferred = clients[0] || null;
    const phase = initialPhase({ ...input, version }, profiles, agents, recovered);
    return {
      version,
      phase,
      originPhase: phase,
      initialized: input.overview?.initialized === true,
      profiles,
      selectedProfileIds: profiles.map((item) => item.profileId),
      clients,
      agents,
      draft: {
        displayName: '',
        requestedAppId: recovered?.draft.requestedAppId || preferred?.appId || '',
        requestedClientForm: recovered?.draft.requestedClientForm || preferred?.clientForm || 'desktop'
      },
      agentId: recovered?.agentId || null,
      deviceId: recovered?.deviceId || boundedText(input.overview?.localDeviceId, 128) || null,
      preparation: recovered?.preparation || null,
      errorCode: null,
      completeShown: false
    };
  }

  function clone(model) {
    return {
      ...model,
      profiles: (model.profiles || []).map((item) => ({ ...item })),
      selectedProfileIds: [...(model.selectedProfileIds || [])],
      clients: (model.clients || []).map((item) => ({ ...item })),
      agents: (model.agents || []).map((item) => ({ ...item })),
      draft: { ...(model.draft || {}) },
      preparation: model.preparation ? { ...model.preparation } : null
    };
  }

  function transition(model, event = {}) {
    const next = clone(model || create());
    const type = String(event.type || '');

    if (type === 'toggle-profile' && next.phase === 'migration') {
      const profileId = boundedText(event.profileId, 128);
      if (!next.profiles.some((item) => item.profileId === profileId)) return next;
      const selected = new Set(next.selectedProfileIds);
      if (event.selected === false) selected.delete(profileId);
      else selected.add(profileId);
      next.selectedProfileIds = next.profiles
        .map((item) => item.profileId)
        .filter((id) => selected.has(id));
      return next;
    }

    if (type === 'continue' && next.phase === 'migration') {
      next.phase = 'agent';
      next.errorCode = null;
      return next;
    }

    if (type === 'back' && next.phase === 'agent' && next.originPhase === 'migration') {
      next.phase = 'migration';
      next.errorCode = null;
      return next;
    }

    if (type === 'draft') {
      if (Object.prototype.hasOwnProperty.call(event, 'displayName')) {
        next.draft.displayName = boundedText(event.displayName, 80);
      }
      const appId = Object.prototype.hasOwnProperty.call(event, 'requestedAppId')
        ? boundedText(event.requestedAppId, 80)
        : next.draft.requestedAppId;
      const clientForm = Object.prototype.hasOwnProperty.call(event, 'requestedClientForm')
        ? boundedText(event.requestedClientForm, 80) || 'desktop'
        : next.draft.requestedClientForm;
      const supported = next.clients.some((item) => (
        item.appId === appId && item.clientForm === clientForm
      ));
      if (supported) {
        next.draft.requestedAppId = appId;
        next.draft.requestedClientForm = clientForm;
      }
      next.errorCode = null;
      return next;
    }

    if (type === 'submit' && next.phase === 'agent') {
      if (!canSubmit(next)) {
        next.errorCode = !next.draft.displayName
          ? 'agent-name-required'
          : 'supported-client-required';
        return next;
      }
      next.phase = 'submitting';
      next.errorCode = null;
      return next;
    }

    if (type === 'initialized' && next.phase === 'submitting') {
      next.initialized = true;
      next.agentId = boundedText(event.agentId, 128) || null;
      next.deviceId = boundedText(event.deviceId, 128) || null;
      if (!next.agentId || !next.deviceId) {
        next.phase = 'agent';
        next.errorCode = 'first-agent-result-incomplete';
        return next;
      }
      next.phase = 'preparing';
      next.preparation = { ok: false, state: 'planning', reasonCode: null };
      next.errorCode = null;
      return next;
    }

    if (type === 'preparation-result' && next.phase === 'preparing') {
      const state = PREPARATION_STATES.has(String(event.result?.state || ''))
        ? String(event.result.state)
        : 'error';
      next.preparation = {
        ok: event.result?.ok === true,
        state,
        reasonCode: boundedText(event.result?.reasonCode || event.result?.reason, 160) || null,
        jobId: boundedText(event.result?.job?.jobId || event.result?.jobId, 128) || null
      };
      next.errorCode = state === 'error' || state === 'unsupported'
        ? (next.preparation.reasonCode || 'provisioning-failed')
        : null;
      if (state === 'ready') {
        next.phase = 'complete';
        next.completeShown = false;
      }
      return next;
    }

    if (type === 'retry' && next.phase === 'preparing') {
      next.preparation = { ...(next.preparation || {}), state: 'planning' };
      next.errorCode = null;
      return next;
    }

    if (type === 'finish-later' && next.phase === 'preparing') {
      next.phase = 'complete';
      next.completeShown = false;
      next.errorCode = null;
      return next;
    }

    if (type === 'review-complete' && next.phase === 'existing') {
      next.phase = 'complete';
      next.completeShown = false;
      return next;
    }

    if (type === 'rendered' && next.phase === 'complete' && event.phase === 'complete') {
      next.completeShown = true;
      return next;
    }

    if (type === 'failed') {
      next.phase = event.returnPhase && PHASES.has(event.returnPhase)
        ? event.returnPhase
        : (next.agentId ? 'preparing' : 'agent');
      next.errorCode = boundedText(event.reasonCode, 160) || 'onboarding-failed';
      return next;
    }

    return next;
  }

  function selectedClient(model) {
    return (model.clients || []).find((item) => (
      item.appId === model.draft?.requestedAppId
      && item.clientForm === model.draft?.requestedClientForm
    )) || null;
  }

  function canSubmit(model) {
    return Boolean(boundedText(model?.draft?.displayName, 80) && selectedClient(model));
  }

  function completionPatch(model, now = new Date().toISOString()) {
    if (model?.phase !== 'complete' || model.completeShown !== true) return null;
    return {
      welcomed: true,
      onboarding: {
        completedVersion: nonNegativeInteger(model.version) || CURRENT_VERSION,
        completedAt: boundedText(now, 64) || null
      }
    };
  }

  return {
    CURRENT_VERSION,
    normalizeProgress,
    needsPresentation,
    create,
    transition,
    selectedClient,
    canSubmit,
    completionPatch
  };
});
