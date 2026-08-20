const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MeshService } = require('../src/mesh/main/mesh-service');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { ProvisioningService } = require('../src/mesh/main/provisioning-service');
const {
  provisioningAdapterDescriptor,
  validateProvisioningBlueprint
} = require('../src/mesh/main/provisioning-adapters');

const NOW = '2026-08-13T08:00:00.000Z';

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
  };
}

function initialProfile(id, fingerprint) {
  return {
    id,
    appId: 'codex',
    name: id,
    profilePath: `/managed/${id}`,
    sessionRoot: `/managed/${id}/codex-home`,
    profilePathMode: 'managed',
    sessionRootMode: 'managed',
    identityFingerprint: fingerprint,
    launchable: true,
    createdAt: NOW
  };
}

function createHarness(initialProfiles = [initialProfile('old-slot', 'account-a')]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-provisioning-'));
  const profiles = [...initialProfiles];
  const adapterState = {
    installed: true,
    identityFingerprint: null,
    inspectCount: 0,
    prepareCount: 0,
    launchCount: 0,
    installPageCount: 0,
    observeIdentityHook: null
  };
  const repositoryState = { commitCount: 0, openedIds: [] };
  const meshService = new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'mesh-keys.json'), fakeProtector()),
    profilesProvider: () => profiles,
    sessionCountProvider: () => 0,
    appVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os',
    hostname: 'Provisioning-Test.local',
    now: () => NOW
  });
  const profileRepository = {
    build({ job, agent, descriptor }) {
      return {
        id: job.stagingProfileId,
        appId: descriptor.appId,
        name: agent.displayName,
        profilePath: `/managed/${job.stagingProfileId}`,
        sessionRoot: `/managed/${job.stagingProfileId}/codex-home`,
        profilePathMode: 'managed',
        sessionRootMode: 'managed',
        identityFingerprint: adapterState.identityFingerprint,
        launchable: true,
        provisioningJobId: job.jobId,
        createdAt: job.createdAt
      };
    },
    get(profileId) {
      return profiles.find((profile) => profile.id === profileId) || null;
    },
    commit(profile) {
      const existing = profiles.find((item) => item.id === profile.id);
      if (existing) {
        assert.equal(existing.appId, profile.appId);
        return existing;
      }
      repositoryState.commitCount += 1;
      profiles.push({ ...profile, identityFingerprint: adapterState.identityFingerprint });
      return profiles.at(-1);
    },
    markOpened(profileId) {
      repositoryState.openedIds.push(profileId);
    }
  };
  const adapter = {
    async inspect() {
      adapterState.inspectCount += 1;
      return { supported: true, installed: adapterState.installed };
    },
    async prepare() {
      adapterState.prepareCount += 1;
    },
    async observeIdentity() {
      if (typeof adapterState.observeIdentityHook === 'function') {
        await adapterState.observeIdentityHook();
      }
      return adapterState.identityFingerprint;
    },
    async launch() {
      adapterState.launchCount += 1;
      return { ok: true };
    },
    async openInstall() {
      adapterState.installPageCount += 1;
      return { ok: true };
    }
  };
  const serviceOptions = {
    meshService,
    adapterProvider: () => adapter,
    profileRepository,
    platform: 'darwin',
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {}
  };
  return {
    directory,
    profiles,
    adapterState,
    repositoryState,
    meshService,
    makeProvisioningService: () => new ProvisioningService(serviceOptions),
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test('首开等待官方登录，识别原账号后只提交一个 Profile/Slot，后续直接打开', async () => {
  const harness = createHarness();
  try {
    const initialized = harness.meshService.initialize();
    const agentId = initialized.agents[0].agentId;
    const deviceId = initialized.localDeviceId;
    harness.profiles.splice(0);
    const durable = harness.meshService.getOverview();
    assert.equal(durable.agents.length, 1);
    assert.equal(durable.slots.length, 0);

    const service = harness.makeProvisioningService();
    const waiting = await service.ensureReady({
      agentId,
      deviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop'
    });
    assert.equal(waiting.state, 'waiting-login');
    assert.equal(waiting.launched, true);
    assert.equal(harness.repositoryState.commitCount, 0);
    assert.equal(harness.meshService.getOverview().provisioningJobs.length, 1);

    harness.adapterState.identityFingerprint = 'account-a';
    const ready = await service.advanceJob(waiting.job.jobId, { interactive: false });
    assert.equal(ready.state, 'ready');
    assert.equal(ready.launched, false);
    assert.equal(harness.repositoryState.commitCount, 1);
    let overview = harness.meshService.getOverview();
    assert.equal(overview.agents.length, 1);
    assert.equal(overview.accountBindings.length, 1);
    assert.equal(overview.slots.length, 1);
    assert.equal(overview.slots[0].agentId, agentId);
    assert.equal(overview.deployments[0].state, 'ready');

    const stillPassive = await service.ensureReady({
      agentId,
      deviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      interactive: false
    });
    assert.equal(stillPassive.state, 'ready');
    assert.equal(stillPassive.launched, false);
    assert.equal(harness.adapterState.launchCount, 1);
    assert.deepEqual(harness.repositoryState.openedIds, []);

    const openedAgain = await service.ensureReady({
      agentId,
      deviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop'
    });
    assert.equal(openedAgain.state, 'ready');
    overview = harness.meshService.getOverview();
    assert.equal(overview.provisioningJobs.length, 1);
    assert.equal(overview.slots.length, 1);
    assert.equal(harness.repositoryState.commitCount, 1);
    assert.equal(harness.adapterState.launchCount, 2);
  } finally {
    harness.cleanup();
  }
});

test('登录成错误账号时停止提交，不创建普通 Profile 或 Slot', async () => {
  const harness = createHarness();
  try {
    const initialized = harness.meshService.initialize();
    const agentId = initialized.agents[0].agentId;
    harness.profiles.splice(0);
    harness.meshService.getOverview();
    harness.adapterState.identityFingerprint = 'different-account';
    const service = harness.makeProvisioningService();
    const result = await service.ensureReady({
      agentId,
      deviceId: initialized.localDeviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop'
    });
    assert.equal(result.state, 'error');
    assert.equal(result.job.lastErrorCode, 'binding-identity-mismatch');
    assert.equal(harness.repositoryState.commitCount, 0);
    assert.equal(harness.profiles.length, 0);
    assert.equal(harness.meshService.getOverview().slots.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('重启后台只观察同一 Job，显式继续不会被并发检查吞掉', async () => {
  const harness = createHarness();
  try {
    const initialized = harness.meshService.initialize();
    const agentId = initialized.agents[0].agentId;
    harness.profiles.splice(0);
    harness.meshService.getOverview();
    const firstService = harness.makeProvisioningService();
    const first = await firstService.ensureReady({
      agentId,
      deviceId: initialized.localDeviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      interactive: false
    });
    assert.equal(first.state, 'waiting-login');
    assert.equal(first.launched, false);
    assert.equal(first.job.completedSteps.includes('login-started'), false);
    assert.equal(harness.adapterState.launchCount, 0);
    firstService.stop();

    const secondService = harness.makeProvisioningService();
    const second = await secondService.ensureReady({
      agentId,
      deviceId: initialized.localDeviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      interactive: false
    });
    assert.equal(second.job.jobId, first.job.jobId);
    assert.equal(harness.meshService.getOverview().provisioningJobs.length, 1);
    assert.equal(harness.repositoryState.commitCount, 0);
    assert.equal(harness.adapterState.launchCount, 0);
    assert.equal(second.job.completedSteps.includes('login-started'), false);

    let releaseObservation;
    let markObservationStarted;
    const observationStarted = new Promise((resolve) => { markObservationStarted = resolve; });
    const observationGate = new Promise((resolve) => { releaseObservation = resolve; });
    harness.adapterState.observeIdentityHook = async () => {
      markObservationStarted();
      await observationGate;
    };
    const backgroundPoll = secondService.advanceJob(second.job.jobId, { interactive: false });
    await observationStarted;
    const explicitPromise = secondService.advanceJob(second.job.jobId, { interactive: true });
    releaseObservation();
    const backgroundResult = await backgroundPoll;
    const explicit = await explicitPromise;
    assert.equal(backgroundResult.launched, false);
    assert.equal(explicit.job.jobId, first.job.jobId);
    assert.equal(explicit.state, 'waiting-login');
    assert.equal(explicit.launched, true);
    assert.equal(harness.adapterState.launchCount, 1);
    assert.equal(explicit.job.completedSteps.includes('login-started'), true);
  } finally {
    harness.cleanup();
  }
});

test('缺客户端只在用户明确点击时打开固定官方入口，不静默安装', async () => {
  const harness = createHarness();
  try {
    const initialized = harness.meshService.initialize();
    const agentId = initialized.agents[0].agentId;
    harness.profiles.splice(0);
    harness.meshService.getOverview();
    harness.adapterState.installed = false;
    const service = harness.makeProvisioningService();
    const passive = await service.ensureReady({
      agentId,
      deviceId: initialized.localDeviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      interactive: false
    });
    assert.equal(passive.state, 'waiting-install');
    assert.equal(harness.adapterState.installPageCount, 0);

    const explicit = await service.ensureReady({
      agentId,
      deviceId: initialized.localDeviceId,
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      interactive: true
    });
    assert.equal(explicit.job.jobId, passive.job.jobId);
    assert.equal(explicit.state, 'waiting-install');
    assert.equal(harness.adapterState.installPageCount, 1);
    assert.equal(harness.repositoryState.commitCount, 0);
  } finally {
    harness.cleanup();
  }
});

test('首批适配器只接受 Claude/Codex Desktop 与已实现的白名单要求', () => {
  const codex = provisioningAdapterDescriptor('codex', 'desktop');
  assert.equal(codex.adapterId, 'desktop:codex');
  assert.equal(provisioningAdapterDescriptor('codex', 'cli'), null);
  assert.equal(provisioningAdapterDescriptor('kimi', 'desktop'), null);
  assert.deepEqual(validateProvisioningBlueprint(codex, {
    preferredAppId: 'codex',
    preferredClientForm: 'desktop',
    portableSettings: {},
    skillRequirements: [],
    toolRequirements: [],
    projectRequirements: []
  }, { platform: 'darwin' }).ok, true);
  assert.equal(validateProvisioningBlueprint(codex, {
    preferredAppId: 'codex',
    skillRequirements: [{ skillId: 'not-yet-restorable' }]
  }, { platform: 'darwin' }).reasonCode, 'skill-requirements-unsupported');
});
