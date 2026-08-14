const { test } = require('node:test');
const assert = require('node:assert/strict');

const Onboarding = require('../src/onboarding-state');

const CLIENTS = [
  { appId: 'codex', clientForm: 'desktop', label: 'Codex' },
  { appId: 'claude', clientForm: 'desktop', label: 'Claude' }
];

test('首次使用按版本决定是否展示，旧 welcomed 布尔值不能跳过新版本', () => {
  assert.equal(Onboarding.needsPresentation({ completedVersion: 0 }), true);
  assert.equal(Onboarding.needsPresentation({ completedVersion: 1 }), false);
  assert.equal(Onboarding.needsPresentation({ completedVersion: 99 }), false);
  assert.deepEqual(Onboarding.normalizeProgress({ welcomed: true }), {
    completedVersion: 0,
    completedAt: null
  });

  const complete = Onboarding.create({
    progress: { completedVersion: Onboarding.CURRENT_VERSION }
  });
  assert.equal(complete.phase, 'done');
});

test('已有 Profile 先进入无损迁移预览且只保留安全展示字段', () => {
  const model = Onboarding.create({
    clients: CLIENTS,
    profiles: [
      {
        id: 'profile-a',
        name: '工作号',
        appId: 'codex',
        group: '工作',
        profilePath: '/Users/example/.codex-secret',
        identityFingerprint: 'do-not-render'
      },
      { id: 'profile-b', name: '个人号', appId: 'claude' }
    ],
    overview: { initialized: false }
  });

  assert.equal(model.phase, 'migration');
  assert.deepEqual(model.selectedProfileIds, ['profile-a', 'profile-b']);
  assert.deepEqual(model.profiles[0], {
    profileId: 'profile-a',
    name: '工作号',
    appId: 'codex',
    group: '工作'
  });
  assert.equal(Object.hasOwn(model.profiles[0], 'profilePath'), false);
  assert.equal(Object.hasOwn(model.profiles[0], 'identityFingerprint'), false);

  const unchecked = Onboarding.transition(model, {
    type: 'toggle-profile',
    profileId: 'profile-b',
    selected: false
  });
  assert.deepEqual(unchecked.selectedProfileIds, ['profile-a']);
  assert.equal(Onboarding.transition(unchecked, { type: 'continue' }).phase, 'agent');
});

test('创建第一个 Agent 必须同时具备名称和受支持客户端', () => {
  let model = Onboarding.create({ clients: CLIENTS, overview: { initialized: false } });
  assert.equal(model.phase, 'agent');
  assert.equal(Onboarding.canSubmit(model), false);

  model = Onboarding.transition(model, { type: 'draft', displayName: '研究助理' });
  assert.equal(Onboarding.canSubmit(model), true);

  const unsupported = Onboarding.transition(model, {
    type: 'draft',
    requestedAppId: 'unknown',
    requestedClientForm: 'desktop'
  });
  assert.equal(unsupported.draft.requestedAppId, 'codex');

  const submitting = Onboarding.transition(model, { type: 'submit' });
  assert.equal(submitting.phase, 'submitting');
  const preparing = Onboarding.transition(submitting, {
    type: 'initialized',
    agentId: 'agent-a',
    deviceId: 'device-local'
  });
  assert.equal(preparing.phase, 'preparing');
  assert.equal(preparing.agentId, 'agent-a');
  assert.equal(preparing.deviceId, 'device-local');
});

test('不完整初始化结果和后端失败不会伪造成功', () => {
  let model = Onboarding.create({ clients: CLIENTS });
  model = Onboarding.transition(model, { type: 'draft', displayName: '研究助理' });
  model = Onboarding.transition(model, { type: 'submit' });
  model = Onboarding.transition(model, {
    type: 'initialized',
    agentId: 'agent-a'
  });
  assert.equal(model.phase, 'agent');
  assert.equal(model.errorCode, 'first-agent-result-incomplete');

  const failed = Onboarding.transition(model, {
    type: 'failed',
    returnPhase: 'agent',
    reasonCode: 'first-agent-api-unavailable'
  });
  assert.equal(failed.phase, 'agent');
  assert.equal(failed.errorCode, 'first-agent-api-unavailable');
  assert.equal(Onboarding.completionPatch(failed), null);
});

test('准备中的安装、登录和验证状态可恢复，ready 才自动进入完成页', () => {
  const model = Onboarding.create({
    clients: CLIENTS,
    overview: {
      initialized: true,
      localDeviceId: 'device-local',
      agents: [{ agentId: 'agent-a', displayName: '研究助理' }],
      provisioningJobs: [{
        jobId: 'job-a',
        agentId: 'agent-a',
        deviceId: 'device-local',
        requestedAppId: 'codex',
        requestedClientForm: 'desktop',
        state: 'waiting-login',
        waitingReason: 'official-login-required'
      }]
    }
  });

  assert.equal(model.phase, 'preparing');
  assert.equal(model.agentId, 'agent-a');
  assert.equal(model.preparation.state, 'waiting-login');
  assert.equal(model.draft.requestedAppId, 'codex');

  const ready = Onboarding.transition(model, {
    type: 'preparation-result',
    result: { ok: true, state: 'ready', job: { jobId: 'job-a' } }
  });
  assert.equal(ready.phase, 'complete');
  assert.equal(ready.completeShown, false);
});

test('完成版本只能在完成页实际渲染后写入', () => {
  let model = Onboarding.create({
    clients: CLIENTS,
    overview: {
      initialized: true,
      localDeviceId: 'device-local',
      agents: [{ agentId: 'agent-a', displayName: '研究助理' }]
    }
  });
  assert.equal(model.phase, 'existing');
  assert.equal(Onboarding.completionPatch(model), null);

  model = Onboarding.transition(model, { type: 'review-complete' });
  assert.equal(model.phase, 'complete');
  assert.equal(Onboarding.completionPatch(model), null);

  model = Onboarding.transition(model, { type: 'rendered', phase: 'complete' });
  assert.deepEqual(Onboarding.completionPatch(model, '2026-08-14T00:00:00.000Z'), {
    welcomed: true,
    onboarding: {
      completedVersion: Onboarding.CURRENT_VERSION,
      completedAt: '2026-08-14T00:00:00.000Z'
    }
  });
});

test('已有 Agent 的升级用户进入回顾，不会再创建重复 Agent', () => {
  const model = Onboarding.create({
    clients: CLIENTS,
    overview: {
      initialized: true,
      localDeviceId: 'device-local',
      agents: [
        { agentId: 'agent-a', displayName: '研究助理' },
        { agentId: 'agent-b', displayName: '开发助理' }
      ],
      provisioningJobs: []
    }
  });
  assert.equal(model.phase, 'existing');
  assert.equal(model.agents.length, 2);
});
