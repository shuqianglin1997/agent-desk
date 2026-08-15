const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  projectMeshAgentGroups,
  resolveUnambiguousLocalSelection,
  resolveReadiness,
  isPreparationActive
} = require('../src/agent-workspace');

function overviewFixture() {
  return {
    initialized: true,
    localDeviceId: 'local',
    devices: [
      { deviceId: 'local', name: 'MacBook', status: 'online' },
      { deviceId: 'remote', name: 'Studio', status: 'offline' }
    ],
    agents: [
      { agentId: 'agent-a', displayName: 'peter', group: 'work', note: '', catAppearance: { breed: 'gray' } },
      { agentId: 'agent-b', displayName: 'mary', group: 'research', note: '', catAppearance: { breed: 'orange' } }
    ],
    accountBindings: [
      { accountBindingId: 'binding-a', agentId: 'agent-a', displayAlias: 'peter-codex', providerNamespace: 'codex' }
    ],
    blueprints: [
      { agentId: 'agent-a', preferredAppId: 'codex', preferredClientForm: 'desktop' },
      { agentId: 'agent-b', preferredAppId: null, preferredClientForm: null }
    ],
    deployments: [
      { deploymentId: 'dep-local-a', agentId: 'agent-a', deviceId: 'local', state: 'ready', adapterId: 'codex' },
      { deploymentId: 'dep-remote-a', agentId: 'agent-a', deviceId: 'remote', state: 'ready', adapterId: 'codex' },
      { deploymentId: 'dep-local-b', agentId: 'agent-b', deviceId: 'local', state: 'absent', adapterId: null }
    ],
    slots: [
      {
        agentId: 'agent-a', accountBindingId: 'binding-a', deviceId: 'local', profileId: 'profile-a',
        appId: 'codex', clientForm: 'desktop', assignmentState: 'linked', launchable: true, localLabel: 'peter'
      }
    ]
  };
}

test('每个工作环境都投影完整员工库，没有 Slot 的 Agent 不消失', () => {
  const overview = overviewFixture();
  const profiles = [{
    id: 'profile-a', name: 'old local label', appId: 'codex', group: '', note: '',
    profilePath: '/managed/peter', sessionRoot: '/managed/peter/codex-home'
  }];
  const all = projectMeshAgentGroups({ overview, profiles, lensId: 'all' });
  const local = projectMeshAgentGroups({ overview, profiles, lensId: 'local' });
  const remote = projectMeshAgentGroups({ overview, profiles, lensId: 'remote' });

  assert.deepEqual(all.map((group) => group.key), ['agent-a', 'agent-b']);
  assert.deepEqual(local.map((group) => group.key), ['agent-a', 'agent-b']);
  assert.deepEqual(remote.map((group) => group.key), ['agent-a', 'agent-b']);
  assert.equal(local.find((group) => group.key === 'agent-b').members.length, 0);
  assert.equal(local.find((group) => group.key === 'agent-b').readiness.state, 'absent');
  assert.equal(remote.find((group) => group.key === 'agent-a').members.length, 0);
  assert.equal(remote.find((group) => group.key === 'agent-a').readiness.state, 'offline');
});

test('Presenter 使用稳定 Agent 身份，Slot 只作为动作位置', () => {
  const overview = overviewFixture();
  const profiles = [{ id: 'profile-a', name: 'peter', appId: 'codex' }];
  const all = projectMeshAgentGroups({ overview, profiles, lensId: 'all' });
  const local = projectMeshAgentGroups({ overview, profiles, lensId: 'local' });
  const allPeter = all.find((group) => group.key === 'agent-a');
  const localPeter = local.find((group) => group.key === 'agent-a');

  assert.equal(allPeter.primary.id, 'agent:agent-a');
  assert.equal(localPeter.primary.id, 'agent:agent-a');
  assert.equal(localPeter.primary.name, 'peter');
  assert.equal(localPeter.members[0]._meshSlotKey, 'local:profile-a');
  assert.equal(localPeter.primary._presentationOnly, true);

  assert.deepEqual(resolveUnambiguousLocalSelection({ overview, profiles }), {
    agentId: 'agent-a',
    slotKey: 'local:profile-a'
  });

  const twoSlotsOneAgent = structuredClone(overview);
  twoSlotsOneAgent.slots.push({
    ...twoSlotsOneAgent.slots[0],
    accountBindingId: 'binding-a-2',
    profileId: 'profile-a-2'
  });
  assert.deepEqual(resolveUnambiguousLocalSelection({
    overview: twoSlotsOneAgent,
    profiles: [...profiles, { id: 'profile-a-2', name: 'peter 2', appId: 'codex' }]
  }), { agentId: 'agent-a', slotKey: null });

  const ambiguous = structuredClone(overview);
  ambiguous.accountBindings.push({
    accountBindingId: 'binding-b', agentId: 'agent-b', displayAlias: 'mary-codex', providerNamespace: 'codex'
  });
  ambiguous.slots.push({
    ...ambiguous.slots[0],
    agentId: 'agent-b',
    accountBindingId: 'binding-b',
    profileId: 'profile-b'
  });
  assert.equal(resolveUnambiguousLocalSelection({
    overview: ambiguous,
    profiles: [...profiles, { id: 'profile-b', name: 'mary', appId: 'codex' }]
  }), null);
});

test('准备中状态优先于空缺，已就绪但所有来源离线时诚实显示离线', () => {
  const overview = overviewFixture();
  const preparing = resolveReadiness({
    overview,
    agentId: 'agent-b',
    lensId: 'all',
    deployments: [{ agentId: 'agent-b', deviceId: 'local', state: 'waiting-login' }],
    allMembers: []
  });
  const offline = resolveReadiness({
    overview,
    agentId: 'agent-a',
    lensId: 'all',
    deployments: [{ agentId: 'agent-a', deviceId: 'remote', state: 'ready' }],
    allMembers: [{ _meshDeviceId: 'remote', _remote: true, _launchable: true }]
  });

  assert.equal(preparing.state, 'waiting-login');
  assert.equal(offline.state, 'offline');
  assert.equal(isPreparationActive('waiting-login'), true);
  assert.equal(isPreparationActive('error'), false);
});
