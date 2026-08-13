const { test } = require('node:test');
const assert = require('node:assert');

const {
  reconcileAgentRuntimeModel,
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
