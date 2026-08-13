const { test } = require('node:test');
const assert = require('node:assert');

const {
  AgentActionService,
  normalizeLaunchRequest,
  normalizePreparationRequest,
  normalizePreparationStatus
} = require('../src/mesh/main/agent-action-service');

const NOW = '2026-08-13T12:00:00.000Z';

test('远端动作 schema 只接受稳定 ID 和固定枚举，拒绝路径、命令与 URL', () => {
  assert.throws(() => normalizeLaunchRequest({
    phase: 'request',
    requestId: 'request-1',
    agentId: 'agent-1',
    profileId: 'profile-1',
    absoluteTargetPath: '/tmp/unsafe'
  }), /profile-launch-request-unknown-field/);
  assert.throws(() => normalizePreparationRequest({
    phase: 'request',
    requestId: 'request-2',
    agentId: 'agent-1',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    command: 'open arbitrary'
  }), /agent-prepare-request-unknown-field/);
  assert.throws(() => normalizePreparationStatus({
    phase: 'status',
    requestId: 'request-2',
    agentId: 'agent-1',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    state: 'ready',
    ok: true,
    launched: true,
    settled: true,
    reasonCode: null,
    job: null,
    slot: {
      profileId: 'profile-1',
      appId: 'codex',
      clientForm: 'desktop',
      argv: ['--dangerous']
    }
  }), /agent-prepare-slot-unknown-field/);
});

test('已就绪远端只用 agentId + profileId 重查目标机 Slot 并打开', async () => {
  const harness = actionHarness({ readySlot: true });
  const result = await harness.left.launchRemote({
    agentId: 'agent-1',
    deviceId: 'device-b',
    profileId: 'profile-b'
  });

  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(harness.openedSlots.length, 1);
  assert.deepEqual(harness.openedSlots[0], {
    deviceId: 'device-b',
    profileId: 'profile-b',
    agentId: 'agent-1',
    accountBindingId: 'binding-1',
    appId: 'codex',
    clientForm: 'desktop',
    assignmentState: 'linked',
    launchable: true
  });
  const request = harness.sent.find((item) => item.from === 'device-a' && item.messageType === 'profile.launch');
  assert.deepEqual(Object.keys(request.payload).sort(), ['agentId', 'phase', 'profileId', 'requestId']);
  assert.equal(JSON.stringify(request.payload).includes('/'), false);
});

test('远端首次准备先等目标机确认，再交给目标机本地可恢复任务', async () => {
  const harness = actionHarness({ readySlot: false, confirmation: true });
  const result = await harness.left.prepareRemote({
    agentId: 'agent-1',
    deviceId: 'device-b',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop'
  });

  assert.equal(result.state, 'waiting-login');
  assert.equal(result.ok, true);
  assert.equal(harness.confirmations.length, 1);
  assert.deepEqual(harness.preparationInputs, [{
    agentId: 'agent-1',
    deviceId: 'device-b',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    interactive: true,
    manualConfirmation: false
  }]);
  assert.deepEqual(harness.changes.map((item) => item.state), ['waiting-consent', 'waiting-login']);

  harness.right.handleProvisioningChanged({
    ok: true,
    state: 'ready',
    launched: true,
    job: {
      jobId: 'job-1',
      agentId: 'agent-1',
      deviceId: 'device-b',
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      blueprintRevision: 2,
      state: 'ready',
      currentStep: 'ready',
      completedSteps: ['ready'],
      waitingReason: null,
      lastErrorCode: null,
      retryCount: 0,
      stagingProfileId: 'staging-profile-b',
      resultSlotKey: 'device-b:profile-b',
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
      cancelledAt: null
    },
    slot: {
      deviceId: 'device-b',
      profileId: 'profile-b',
      agentId: 'agent-1',
      accountBindingId: 'binding-1',
      appId: 'codex',
      clientForm: 'desktop',
      assignmentState: 'linked',
      launchable: true
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.changes.at(-1).state, 'ready');
  assert.equal(harness.managers.right.inventoryBroadcasts > 0, true);
});

test('目标机拒绝首次准备时不创建 Job，并返回结构化结果', async () => {
  const harness = actionHarness({ readySlot: false, confirmation: false });
  const result = await harness.left.prepareRemote({
    agentId: 'agent-1',
    deviceId: 'device-b',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop'
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.reasonCode, 'target-declined');
  assert.equal(harness.preparationInputs.length, 0);
});

test('已超时或被后续请求替代的迟到结果被忽略，不会断开认证连接', () => {
  const harness = actionHarness({ readySlot: false });
  const context = { peer: { remote: deviceRecord('device-b') } };
  assert.equal(harness.left.receiveLaunchResult(context, {
    phase: 'result',
    requestId: 'expired-launch',
    agentId: 'agent-1',
    profileId: 'profile-b',
    ok: true,
    launched: true,
    state: 'ready',
    reasonCode: null
  }), true);
  assert.equal(harness.left.receivePreparationStatus(context, {
    phase: 'status',
    requestId: 'superseded-prepare',
    agentId: 'agent-1',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    state: 'ready',
    ok: true,
    launched: true,
    settled: true,
    reasonCode: null,
    job: null,
    slot: null
  }), true);
});

function actionHarness(options = {}) {
  const sent = [];
  const changes = [];
  const openedSlots = [];
  const confirmations = [];
  const preparationInputs = [];
  const overviewA = overviewFor('device-a', 'device-b', options.readySlot === true);
  const overviewB = overviewFor('device-b', 'device-a', options.readySlot === true);
  const meshA = { getOverview: () => structuredClone(overviewA) };
  const meshB = { getOverview: () => structuredClone(overviewB) };
  const managerA = fakeManager('device-a', 'device-b', sent);
  const managerB = fakeManager('device-b', 'device-a', sent);
  const provisioningA = {
    openReadySlot: async () => { throw new Error('wrong-target'); },
    ensureReady: async () => { throw new Error('wrong-target'); }
  };
  const provisioningB = {
    async openReadySlot(slot) {
      openedSlots.push({ ...slot });
      return { ok: true, state: 'ready', launched: true, slot };
    },
    async ensureReady(input) {
      preparationInputs.push({ ...input });
      return {
        ok: true,
        state: 'waiting-login',
        launched: true,
        job: {
          jobId: 'job-1',
          agentId: input.agentId,
          deviceId: input.deviceId,
          requestedAppId: input.requestedAppId,
          requestedClientForm: input.requestedClientForm,
          state: 'waiting-login',
          currentStep: 'authenticate',
          completedSteps: ['login-started'],
          waitingReason: 'official-login-required',
          lastErrorCode: null,
          retryCount: 0,
          updatedAt: NOW
        }
      };
    }
  };
  let sequence = 0;
  const left = new AgentActionService({
    meshService: meshA,
    peerManagerProvider: () => managerA,
    provisioningServiceProvider: () => provisioningA,
    randomUUID: () => `request-${++sequence}`,
    onChange: (value) => changes.push(value)
  });
  const right = new AgentActionService({
    meshService: meshB,
    peerManagerProvider: () => managerB,
    provisioningServiceProvider: () => provisioningB,
    confirmPreparation: async (value) => {
      confirmations.push(value);
      return options.confirmation !== false;
    },
    randomUUID: () => `target-${++sequence}`
  });
  managerA.remoteService = right;
  managerB.remoteService = left;
  return {
    left,
    right,
    sent,
    changes,
    openedSlots,
    confirmations,
    preparationInputs,
    managers: { left: managerA, right: managerB }
  };
}

function fakeManager(localDeviceId, remoteDeviceId, sent) {
  return {
    remoteService: null,
    inventoryBroadcasts: 0,
    async connect(deviceId) {
      assert.equal(deviceId, remoteDeviceId);
      return { authenticated: true, deviceId };
    },
    async sendSemantic(deviceId, messageType, capability, payload) {
      assert.equal(deviceId, remoteDeviceId);
      sent.push({ from: localDeviceId, messageType, capability, payload: structuredClone(payload) });
      return this.remoteService.handleEnvelope({
        context: {
          peer: {
            local: { deviceId: remoteDeviceId },
            remote: deviceRecord(localDeviceId)
          }
        },
        envelope: { messageType, capability, payload: structuredClone(payload) }
      });
    },
    async broadcastCatalog() { return 1; },
    async broadcastInventory() {
      this.inventoryBroadcasts += 1;
      return 1;
    }
  };
}

function overviewFor(localDeviceId, remoteDeviceId, readySlot) {
  const slot = {
    deviceId: 'device-b',
    profileId: 'profile-b',
    agentId: 'agent-1',
    accountBindingId: 'binding-1',
    appId: 'codex',
    clientForm: 'desktop',
    assignmentState: 'linked',
    launchable: true
  };
  return {
    initialized: true,
    localDeviceId,
    agents: [{ agentId: 'agent-1', displayName: 'Research Agent' }],
    devices: [
      { ...deviceRecord(localDeviceId), isLocal: true, permissions: ['inventory.read', 'catalog.manage', 'profile.launch', 'agent.prepare'] },
      deviceRecord(remoteDeviceId)
    ],
    slots: readySlot ? [slot] : [],
    deployments: readySlot ? [{
      agentId: 'agent-1',
      deviceId: 'device-b',
      state: 'ready',
      slotKeys: ['device-b:profile-b']
    }] : []
  };
}

function deviceRecord(deviceId) {
  return {
    deviceId,
    name: deviceId,
    status: 'online',
    isLocal: false,
    capabilities: ['inventory.read', 'catalog.manage', 'profile.launch', 'agent.prepare'],
    permissions: ['inventory.read', 'catalog.manage', 'profile.launch', 'agent.prepare']
  };
}
