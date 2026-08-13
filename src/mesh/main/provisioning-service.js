const {
  ACTIVE_JOB_STATES
} = require('../domain/agent-deployment');
const {
  provisioningAdapterDescriptor,
  validateProvisioningBlueprint
} = require('./provisioning-adapters');

const DEFAULT_POLL_INTERVAL_MS = 4_000;

class ProvisioningService {
  constructor(options = {}) {
    if (!options.meshService) throw new TypeError('meshService is required');
    if (typeof options.adapterProvider !== 'function') throw new TypeError('adapterProvider is required');
    if (!options.profileRepository) throw new TypeError('profileRepository is required');
    this.meshService = options.meshService;
    this.adapterProvider = options.adapterProvider;
    this.profileRepository = options.profileRepository;
    this.onChanged = options.onChanged || (() => {});
    this.platform = options.platform || process.platform;
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.timers = new Map();
    this.inFlight = new Map();
    this.stopped = false;
  }

  async ensureReady(input = {}) {
    const agentId = requiredText(input.agentId, 'agentId');
    const deviceId = requiredText(input.deviceId, 'deviceId');
    const requestedAppId = requiredText(input.requestedAppId, 'requestedAppId');
    const requestedClientForm = optionalText(input.requestedClientForm, 80) || 'desktop';
    const overview = this.meshService.getOverview();
    if (!overview.initialized) throw new Error('mesh-not-initialized');
    if (deviceId !== overview.localDeviceId) throw new Error('provisioning-local-device-required');

    const deployment = overview.deployments.find((item) => (
      item.agentId === agentId && item.deviceId === deviceId
    ));
    const readySlot = deployment?.state === 'ready'
      ? resolveReadySlot(overview, deployment, { agentId, deviceId, requestedAppId, requestedClientForm })
      : null;
    if (readySlot) return this.openReadySlot(readySlot, overview);

    const context = this.meshService.ensureProvisioningJob({
      agentId,
      deviceId,
      requestedAppId,
      requestedClientForm
    });
    return this.advanceJob(context.job.jobId, {
      interactive: input.interactive !== false,
      manualConfirmation: input.manualConfirmation === true
    });
  }

  async retry(jobId, options = {}) {
    const context = this.meshService.getProvisioningContext({ jobId: requiredText(jobId, 'jobId') });
    return this.ensureReady({
      agentId: context.job.agentId,
      deviceId: context.job.deviceId,
      requestedAppId: context.job.requestedAppId,
      requestedClientForm: context.job.requestedClientForm,
      interactive: true,
      manualConfirmation: options.manualConfirmation === true
    });
  }

  async advanceJob(jobId, options = {}) {
    const key = requiredText(jobId, 'jobId');
    const current = this.inFlight.get(key);
    if (current) return current;
    const promise = this.advanceJobOnce(key, options).finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  async advanceJobOnce(jobId, options = {}) {
    this.cancelScheduled(jobId);
    let context = this.meshService.getProvisioningContext({ jobId });
    let profileCommitted = false;
    if (context.job.state === 'ready') return this.openCompletedJob(context);
    if (context.job.state === 'cancelled') return resultFromContext(context);
    if (['error', 'unsupported'].includes(context.job.state)) return resultFromContext(context);

    const descriptor = provisioningAdapterDescriptor(
      context.job.requestedAppId,
      context.job.requestedClientForm
    );
    const validation = validateProvisioningBlueprint(descriptor, context.blueprint, {
      platform: this.platform
    });
    if (!validation.ok) {
      context = this.failJob(context, 'unsupported', validation.reasonCode);
      return resultFromContext(context);
    }

    const adapter = this.adapterProvider(descriptor.appId, descriptor);
    if (!adapter) {
      context = this.failJob(context, 'unsupported', 'adapter-unavailable');
      return resultFromContext(context);
    }

    try {
      if (context.job.state === 'planning') {
        context = this.meshService.transitionProvisioningJob({
          jobId,
          state: 'preparing',
          currentStep: 'inspect-client',
          completedStep: 'plan',
          waitingReason: null,
          lastErrorCode: null
        });
      } else if (context.job.state === 'waiting-install') {
        context = this.meshService.transitionProvisioningJob({
          jobId,
          state: 'preparing',
          currentStep: 'inspect-client',
          waitingReason: null,
          lastErrorCode: null
        });
      }

      const profile = await this.profileRepository.build({
        job: context.job,
        agent: context.agent,
        blueprint: context.blueprint,
        descriptor
      });
      const inspection = await adapter.inspect(profile);
      if (inspection?.supported === false) {
        context = this.failJob(context, 'unsupported', inspection.reasonCode || 'client-unsupported');
        return resultFromContext(context);
      }
      if (inspection?.installed !== true) {
        context = this.meshService.transitionProvisioningJob({
          jobId,
          state: 'waiting-install',
          currentStep: 'install-client',
          waitingReason: 'client-not-installed',
          lastErrorCode: null
        });
        if (options.interactive === true) {
          await adapter.openInstall();
          context = this.meshService.transitionProvisioningJob({
            jobId,
            completedStep: 'install-page-opened'
          });
          this.changed(context);
        }
        this.schedule(jobId);
        return resultFromContext(context);
      }

      await adapter.prepare(profile, context.blueprint);
      context = this.meshService.transitionProvisioningJob({
        jobId,
        state: context.job.state,
        currentStep: 'verify-identity',
        completedSteps: ['client-present', 'staging-prepared'],
        waitingReason: null,
        lastErrorCode: null
      });

      const observedFingerprint = optionalText(await adapter.observeIdentity(profile), 160);
      if (observedFingerprint || options.manualConfirmation === true) {
        if (context.job.state !== 'verifying') {
          context = this.meshService.transitionProvisioningJob({
            jobId,
            state: 'verifying',
            currentStep: 'verify-identity',
            waitingReason: null,
            lastErrorCode: null
          });
        }
        const verdict = this.meshService.verifyProvisioningIdentity({
          jobId,
          observedFingerprint,
          manualConfirmation: options.manualConfirmation === true
        });
        if (!['matched', 'new-binding'].includes(verdict.status)) {
          context = this.failJob(context, 'error', verdict.reasonCode || 'identity-verification-failed');
          return resultFromContext(context);
        }

        const committed = await this.profileRepository.commit(profile);
        profileCommitted = true;
        const completed = this.meshService.finalizeProvisioning({
          jobId,
          profileId: committed.id,
          observedFingerprint,
          manualConfirmation: options.manualConfirmation === true
        });
        const launch = await adapter.launch(committed);
        if (launch?.ok !== true) {
          const result = {
            ok: false,
            state: 'ready',
            launched: false,
            reasonCode: optionalText(launch?.reason, 160) || 'client-launch-failed',
            overview: completed.overview,
            job: completed.job,
            deployment: completed.deployment,
            slot: completed.slot
          };
          this.changed(result);
          return result;
        }
        await this.profileRepository.markOpened(committed.id);
        const openedOverview = this.meshService.markDeploymentOpened({
          agentId: context.job.agentId,
          deviceId: context.job.deviceId,
          slotKey: `${context.job.deviceId}:${committed.id}`
        });
        const result = {
          ok: true,
          state: 'ready',
          launched: true,
          overview: openedOverview,
          job: completed.job,
          deployment: completed.deployment,
          slot: completed.slot
        };
        this.changed(result);
        return result;
      }

      if (context.job.state !== 'waiting-login') {
        context = this.meshService.transitionProvisioningJob({
          jobId,
          state: 'waiting-login',
          currentStep: 'authenticate',
          waitingReason: 'official-login-required',
          lastErrorCode: null
        });
      }
      if (options.interactive === true || !context.job.completedSteps.includes('login-started')) {
        const launch = await adapter.launch(profile);
        assertLaunchSucceeded(launch);
        context = this.meshService.transitionProvisioningJob({
          jobId,
          completedStep: 'login-started'
        });
      }
      this.changed(context);
      this.schedule(jobId);
      return resultFromContext(context, { launched: true });
    } catch (error) {
      if (profileCommitted) {
        // profiles.json and mesh.db are separate atomic stores. Once the
        // deterministic Profile is registered, keep the Job in verifying and
        // resume the idempotent catalog commit instead of exposing a terminal
        // half-failure or deleting user data.
        context = this.meshService.getProvisioningContext({ jobId });
        this.schedule(jobId);
        this.changed(context);
        return resultFromContext(context, {
          ok: false,
          reasonCode: optionalText(error?.message, 160) || 'provisioning-commit-pending'
        });
      }
      context = this.safeError(context, error);
      this.changed(context);
      return resultFromContext(context);
    }
  }

  async openReadySlot(slot, overview = this.meshService.getOverview()) {
    const profile = await this.profileRepository.get(slot.profileId);
    if (!profile) throw new Error('deployment-profile-not-found');
    const descriptor = provisioningAdapterDescriptor(slot.appId, slot.clientForm);
    const adapter = descriptor ? this.adapterProvider(descriptor.appId, descriptor) : null;
    if (!adapter) throw new Error('adapter-unavailable');
    const launch = await adapter.launch(profile);
    assertLaunchSucceeded(launch);
    await this.profileRepository.markOpened(profile.id);
    const openedOverview = this.meshService.markDeploymentOpened({
      agentId: slot.agentId,
      deviceId: slot.deviceId,
      slotKey: `${slot.deviceId}:${slot.profileId}`
    });
    const result = {
      ok: true,
      state: 'ready',
      launched: true,
      overview: openedOverview,
      deployment: openedOverview.deployments.find((item) => (
        item.agentId === slot.agentId && item.deviceId === slot.deviceId
      )),
      slot
    };
    this.changed(result);
    return result;
  }

  async openCompletedJob(context) {
    const slot = context.deployment
      ? resolveReadySlot(this.meshService.getOverview(), context.deployment, {
          agentId: context.job.agentId,
          deviceId: context.job.deviceId,
          requestedAppId: context.job.requestedAppId,
          requestedClientForm: context.job.requestedClientForm
        })
      : null;
    if (!slot) return resultFromContext(context);
    return this.openReadySlot(slot);
  }

  cancel(jobId) {
    const key = requiredText(jobId, 'jobId');
    this.cancelScheduled(key);
    const context = this.meshService.cancelProvisioningJob({ jobId: key });
    this.changed(context);
    return resultFromContext(context);
  }

  resumeActiveJobs() {
    this.stopped = false;
    const jobs = this.meshService.listActiveProvisioningJobs();
    for (const job of jobs) this.schedule(job.jobId, 0);
    return jobs.length;
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) this.clearTimeout(timer);
    this.timers.clear();
  }

  schedule(jobId, delay = this.pollIntervalMs) {
    if (this.stopped || this.timers.has(jobId)) return;
    const timer = this.setTimeout(() => {
      this.timers.delete(jobId);
      void this.advanceJob(jobId, { interactive: false }).catch(() => {});
    }, delay);
    if (typeof timer?.unref === 'function') timer.unref();
    this.timers.set(jobId, timer);
  }

  cancelScheduled(jobId) {
    const timer = this.timers.get(jobId);
    if (timer) this.clearTimeout(timer);
    this.timers.delete(jobId);
  }

  failJob(context, state, reasonCode) {
    if (!ACTIVE_JOB_STATES.has(context.job.state)) return context;
    const next = this.meshService.transitionProvisioningJob({
      jobId: context.job.jobId,
      state,
      currentStep: state,
      waitingReason: null,
      lastErrorCode: reasonCode
    });
    this.changed(next);
    return next;
  }

  safeError(context, error) {
    try {
      if (!ACTIVE_JOB_STATES.has(context.job.state)) return context;
      return this.meshService.transitionProvisioningJob({
        jobId: context.job.jobId,
        state: 'error',
        currentStep: 'error',
        waitingReason: null,
        lastErrorCode: optionalText(error?.message, 160) || 'provisioning-failed'
      });
    } catch (_transitionError) {
      return context;
    }
  }

  changed(value) {
    try { this.onChanged(value); } catch (_error) { /* UI notification is best effort. */ }
  }
}

function resolveReadySlot(overview, deployment, selector = {}) {
  const slots = (overview.slots || []).filter((slot) => (
    slot.agentId === selector.agentId
    && slot.deviceId === selector.deviceId
    && slot.assignmentState === 'linked'
    && slot.launchable !== false
  ));
  return slots.find((slot) => `${slot.deviceId}:${slot.profileId}` === deployment.preferredSlotKey)
    || slots.find((slot) => (
      slot.appId === selector.requestedAppId && slot.clientForm === selector.requestedClientForm
    ))
    || slots[0]
    || null;
}

function resultFromContext(context, extra = {}) {
  return {
    ok: !['error', 'unsupported'].includes(context.job.state),
    state: context.job.state,
    launched: false,
    job: publicJob(context.job),
    deployment: context.deployment || null,
    ...extra
  };
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    agentId: job.agentId,
    deviceId: job.deviceId,
    requestedAppId: job.requestedAppId,
    requestedClientForm: job.requestedClientForm,
    state: job.state,
    currentStep: job.currentStep,
    completedSteps: [...job.completedSteps],
    waitingReason: job.waitingReason,
    lastErrorCode: job.lastErrorCode,
    retryCount: job.retryCount,
    updatedAt: job.updatedAt
  };
}

function assertLaunchSucceeded(result) {
  if (result?.ok !== true) throw new Error(optionalText(result?.reason, 160) || 'client-launch-failed');
}

function requiredText(value, field) {
  const text = optionalText(value, 260);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function optionalText(value, limit) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  ProvisioningService,
  resolveReadySlot,
  publicJob
};
