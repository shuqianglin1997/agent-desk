const { test } = require('node:test');
const assert = require('node:assert');

const {
  reconcileAgentRuntimeModel,
  createProvisioningJob,
  transitionProvisioningJob,
  normalizeProvisioningJob,
  activeJobKey
} = require('../src/mesh/domain/agent-deployment');

const NOW = '2026-08-13T08:00:00.000Z';

function agent(agentId = 'agent-a') {
  return {
    agentId,
    displayName: '研究员',
    lifecycleState: 'active',
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z'
  };
}

function binding(accountBindingId = 'binding-a', agentId = 'agent-a') {
  return {
    accountBindingId,
    agentId,
    providerNamespace: 'codex'
  };
}

function slot(extra = {}) {
  return {
    deviceId: 'device-a',
    profileId: 'profile-a',
    agentId: 'agent-a',
    accountBindingId: 'binding-a',
    appId: 'codex',
    clientForm: 'desktop',
    assignmentState: 'linked',
    launchable: true,
    ...extra
  };
}

test('员工配置和本机部署可从旧目录推导，重复协调不改 revision 或时间', () => {
  const first = reconcileAgentRuntimeModel({
    mesh: { localDeviceId: 'device-a' },
    agents: [agent()],
    accountBindings: [binding()],
    slots: [slot()]
  }, { localDeviceId: 'device-a', now: NOW });

  assert.equal(first.blueprints.length, 1);
  assert.deepEqual(first.blueprints[0].desiredBindingIds, ['binding-a']);
  assert.equal(first.blueprints[0].preferredAppId, 'codex');
  assert.equal(first.deployments[0].state, 'ready');
  assert.equal(first.deployments[0].revision, 1);

  const repeated = reconcileAgentRuntimeModel({
    mesh: { localDeviceId: 'device-a' },
    agents: [agent()],
    accountBindings: [binding()],
    slots: [slot()],
    blueprints: first.blueprints,
    deployments: first.deployments
  }, { localDeviceId: 'device-a', now: '2026-08-13T09:00:00.000Z' });
  assert.deepEqual(repeated, first);
});

test('账号绑定变化只更新配置要求，保留首选客户端与非敏感配置', () => {
  const initial = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding()],
    slots: [slot()]
  }, { localDeviceId: 'device-a', now: NOW });
  const customized = {
    ...initial.blueprints[0],
    portableSettings: { model: 'approved-model' },
    skillRequirements: [{ skillId: 'research' }]
  };
  const changed = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding('binding-b')],
    slots: [],
    blueprints: [customized],
    deployments: initial.deployments
  }, { localDeviceId: 'device-a', now: '2026-08-13T10:00:00.000Z' });

  assert.deepEqual(changed.blueprints[0].desiredBindingIds, ['binding-b']);
  assert.equal(changed.blueprints[0].revision, 2);
  assert.equal(changed.blueprints[0].preferredAppId, 'codex');
  assert.deepEqual(changed.blueprints[0].portableSettings, { model: 'approved-model' });
  assert.deepEqual(changed.blueprints[0].skillRequirements, [{ skillId: 'research' }]);
  assert.equal(changed.deployments[0].state, 'absent');
});

test('本机 Slot 的不可启动、换号和活动准备任务映射为不同部署状态', () => {
  const unavailable = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding()],
    slots: [slot({ launchable: false })]
  }, { localDeviceId: 'device-a', now: NOW });
  assert.equal(unavailable.deployments[0].state, 'waiting-install');
  assert.equal(unavailable.deployments[0].lastErrorCode, 'client-unavailable');

  const changedIdentity = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding()],
    slots: [slot({ assignmentState: 'identity-changed' })]
  }, { localDeviceId: 'device-a', now: NOW });
  assert.equal(changedIdentity.deployments[0].state, 'error');
  assert.equal(changedIdentity.deployments[0].lastErrorCode, 'identity-changed');

  const waiting = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding()],
    slots: [],
    provisioningJobs: [{
      jobId: 'job-a',
      agentId: 'agent-a',
      deviceId: 'device-a',
      requestedClientForm: 'desktop',
      state: 'waiting-login',
      currentStep: 'authenticate',
      createdAt: NOW,
      updatedAt: NOW
    }]
  }, { localDeviceId: 'device-a', now: NOW });
  assert.equal(waiting.deployments[0].state, 'waiting-login');
  assert.equal(waiting.deployments[0].resumeJobId, 'job-a');
});

test('准备任务活动键固定到员工、设备和受限客户端，完成后释放唯一键', () => {
  const job = normalizeProvisioningJob({
    jobId: 'job-a',
    agentId: 'agent-a',
    deviceId: 'device-a',
    requestedAppId: 'codex',
    state: 'preparing',
    currentStep: 'create-staging',
    createdAt: NOW,
    updatedAt: NOW
  });
  assert.equal(activeJobKey(job), 'agent-a:device-a:codex');
  assert.equal(activeJobKey({ ...job, state: 'ready' }), null);
});

test('准备任务拥有稳定 staging Profile，并拒绝跳步和终态复活', () => {
  const ids = ['job-a', 'profile-staging-a'];
  const created = createProvisioningJob({
    agentId: 'agent-a',
    deviceId: 'device-a',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    blueprintRevision: 2
  }, { now: NOW, randomUUID: () => ids.shift() });

  assert.equal(created.jobId, 'job-a');
  assert.equal(created.stagingProfileId, 'profile-staging-a');
  assert.equal(created.state, 'planning');
  assert.throws(() => transitionProvisioningJob(created, { state: 'ready' }, { now: NOW }), /transition-invalid/);

  const preparing = transitionProvisioningJob(created, {
    state: 'preparing',
    completedStep: 'plan'
  }, { now: NOW });
  const waiting = transitionProvisioningJob(preparing, {
    state: 'waiting-login',
    completedSteps: ['staging-prepared', 'plan']
  }, { now: NOW });
  assert.deepEqual(waiting.completedSteps, ['plan', 'staging-prepared']);
  assert.equal(waiting.stagingProfileId, 'profile-staging-a');

  const verifying = transitionProvisioningJob(waiting, { state: 'verifying' }, { now: NOW });
  const ready = transitionProvisioningJob(verifying, { state: 'ready' }, { now: NOW });
  assert.equal(ready.completedAt, NOW);
  assert.throws(() => transitionProvisioningJob(ready, { state: 'planning' }, { now: NOW }), /transition-invalid/);
});

test('错误和不支持状态保留在设备部署中，显式重试复用同一任务', () => {
  const baseJob = normalizeProvisioningJob({
    jobId: 'job-a',
    agentId: 'agent-a',
    deviceId: 'device-a',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    state: 'error',
    currentStep: 'error',
    lastErrorCode: 'identity-mismatch',
    createdAt: NOW,
    updatedAt: NOW
  });
  const failed = reconcileAgentRuntimeModel({
    agents: [agent()],
    accountBindings: [binding()],
    slots: [],
    provisioningJobs: [baseJob]
  }, { localDeviceId: 'device-a', now: NOW });
  assert.equal(failed.deployments[0].state, 'error');
  assert.equal(failed.deployments[0].resumeJobId, 'job-a');

  const retried = transitionProvisioningJob(baseJob, { state: 'planning' }, {
    now: '2026-08-13T09:00:00.000Z'
  });
  assert.equal(retried.jobId, 'job-a');
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.lastErrorCode, null);
});
