const { test } = require('node:test');
const assert = require('node:assert/strict');
const UiContext = require('../src/ui-context');

test('设备 Lens 只恢复该 Lens 的 Agent 记忆，不改 scope，也不自动选第一项', () => {
  let context = UiContext.create({
    agentScope: 'current',
    selectedDeviceLensId: 'all',
    selectedAgentIdByDeviceLens: { all: 'agent-global', 'device-b': 'agent-b' }
  });

  context = UiContext.setDeviceLens(context, 'device-b', { validAgentIds: ['agent-b', 'agent-c'] });
  assert.equal(context.selectedDeviceLensId, 'device-b');
  assert.equal(context.agentScope, 'current');
  assert.equal(UiContext.selectedAgentId(context), 'agent-b');

  context = UiContext.setDeviceLens(context, 'device-c', { validAgentIds: ['agent-c'] });
  assert.equal(UiContext.selectedAgentId(context), null);
  assert.equal(context.agentScope, 'current');
});

test('从设备详情进入全部会话是原子导航，并保留与导航无关的上下文', () => {
  const original = UiContext.create({
    workspaceMode: 'devices',
    selectedDeviceLensId: 'all',
    agentScope: 'current',
    focusedConversationId: 'conversation-old',
    checkedConversationIds: ['conversation-old'],
    selectedDeviceDetailId: 'device-b',
    transferDraft: { kind: 'files', targetDeviceId: 'device-c' }
  });
  const next = UiContext.viewDeviceSessions(original, 'device-b');

  assert.equal(next.workspaceMode, 'sessions');
  assert.equal(next.selectedDeviceLensId, 'device-b');
  assert.equal(next.agentScope, 'all');
  assert.equal(next.focusedConversationId, null);
  assert.deepEqual([...next.checkedConversationIds], []);
  assert.equal(next.selectedDeviceDetailId, 'device-b');
  assert.equal(next.transferDraft.kind, 'files');
});

test('从设备 Agent 进入会话时 Lens、Agent、scope 与 Slot 一次到位', () => {
  const next = UiContext.viewDeviceAgentSessions(UiContext.create({ workspaceMode: 'devices' }), {
    deviceId: 'device-b',
    agentId: 'agent-2',
    slotKey: 'device-b:profile-7'
  });

  assert.equal(next.workspaceMode, 'sessions');
  assert.equal(next.selectedDeviceLensId, 'device-b');
  assert.equal(next.agentScope, 'current');
  assert.equal(UiContext.selectedAgentId(next), 'agent-2');
  assert.equal(UiContext.selectedSlotKey(next), 'device-b:profile-7');
});

test('行聚焦与显式批量勾选互不覆盖，批量集合优先于聚焦项', () => {
  let context = UiContext.focusConversation(UiContext.create(), 'conversation-a');
  assert.deepEqual(UiContext.actionConversationIds(context), ['conversation-a']);

  context = UiContext.checkConversation(context, 'conversation-b', true);
  context = UiContext.checkConversation(context, 'conversation-c', true);
  assert.equal(context.focusedConversationId, 'conversation-a');
  assert.deepEqual(UiContext.actionConversationIds(context), ['conversation-b', 'conversation-c']);

  context = UiContext.checkConversation(context, 'conversation-b', false);
  context = UiContext.checkConversation(context, 'conversation-c', false);
  assert.deepEqual(UiContext.actionConversationIds(context), ['conversation-a']);
});

test('搜索隐藏已选会话时保留动作集合，并准确报告隐藏数量', () => {
  let context = UiContext.focusConversation(UiContext.create(), 'conversation-focus');
  context = UiContext.checkConversation(context, 'conversation-a', true);
  context = UiContext.checkConversation(context, 'conversation-b', true);
  const visibility = UiContext.actionVisibility(context, ['conversation-b', 'conversation-c']);
  assert.deepEqual(visibility, {
    total: 2,
    visible: 1,
    hidden: 1,
    hiddenIds: ['conversation-a']
  });
  assert.equal(context.focusedConversationId, 'conversation-focus');
  assert.deepEqual([...context.checkedConversationIds], ['conversation-a', 'conversation-b']);
});

test('刷新只清理已失效对象，不为用户补选任何会话、Agent 或 Slot', () => {
  const context = UiContext.create({
    selectedDeviceLensId: 'device-b',
    selectedAgentIdByDeviceLens: { 'device-b': 'agent-gone', all: 'agent-a' },
    selectedSlotKeyByAgentAndLens: {
      'device-b::agent-gone': 'slot-gone',
      'all::agent-a': 'slot-a'
    },
    focusedConversationId: 'conversation-gone',
    checkedConversationIds: ['conversation-gone', 'conversation-live']
  });
  const next = UiContext.clearInvalid(context, {
    validLensIds: ['all', 'device-b'],
    validAgentIdsByLens: { 'device-b': ['agent-b'], all: ['agent-a'] },
    validSlotKeysByAgentAndLens: {
      'all::agent-a': ['slot-a']
    },
    validConversationIds: ['conversation-live']
  });

  assert.equal(UiContext.selectedAgentId(next, 'device-b'), null);
  assert.equal(UiContext.selectedSlotKey(next, 'device-b', 'agent-gone'), null);
  assert.equal(next.focusedConversationId, null);
  assert.deepEqual([...next.checkedConversationIds], ['conversation-live']);
  assert.equal(UiContext.selectedAgentId(next, 'all'), 'agent-a');
});

test('多副本会话在全部设备视角必须显式选择，具体 Lens 的唯一副本可直接解析', () => {
  const conversation = {
    conversationId: 'conversation-1',
    replicas: [
      { replicaId: 'replica-a', deviceId: 'device-a' },
      { replicaId: 'replica-b', deviceId: 'device-b' }
    ]
  };

  let context = UiContext.create({ selectedDeviceLensId: 'all' });
  let resolution = UiContext.resolveReplica(context, conversation, conversation.conversationId);
  assert.equal(resolution.resolved, false);
  assert.equal(resolution.requiresSelection, true);

  context = UiContext.selectReplica(context, conversation.conversationId, 'replica-b');
  resolution = UiContext.resolveReplica(context, conversation, conversation.conversationId);
  assert.equal(resolution.replicaId, 'replica-b');

  context = UiContext.setDeviceLens(context, 'device-a');
  resolution = UiContext.resolveReplica(context, conversation, conversation.conversationId);
  assert.equal(resolution.replicaId, 'replica-a');
});

test('SessionPointer 与文件传输使用互不污染的草稿', () => {
  let context = UiContext.createSessionPointerDraft(UiContext.create(), {
    targetDeviceId: 'device-b',
    selections: [{ conversationId: 'conversation-a', replicaId: 'replica-a' }]
  });
  assert.equal(context.transferDraft.kind, 'session-pointer');
  assert.equal(context.transferDraft.selections.length, 1);

  context = UiContext.createFileDraft(context, { targetDeviceId: 'device-c' });
  assert.equal(context.transferDraft.kind, 'files');
  assert.equal(context.transferDraft.targetDeviceId, 'device-c');
  assert.deepEqual(context.transferDraft.selections, []);
});

test('远控返回保留查看会话，断开才清除活动提示', () => {
  let context = UiContext.openRemote(UiContext.create(), 'remote-1');
  context = UiContext.returnFromRemote(context, 'remote-1');
  assert.equal(context.workspaceMode, 'sessions');
  assert.equal(context.activeRemoteSessionId, 'remote-1');

  context = UiContext.disconnectRemote(context, 'remote-1', []);
  assert.equal(context.activeRemoteSessionId, null);
});

test('切换 Agent 和 Slot 只改变动作落点，保留焦点、勾选、副本与传输草稿', () => {
  const original = UiContext.createSessionPointerDraft(UiContext.create({
    selectedDeviceLensId: 'device-a',
    selectedAgentIdByDeviceLens: { 'device-a': 'agent-a' },
    selectedSlotKeyByAgentAndLens: { 'device-a::agent-a': 'slot-a' },
    focusedConversationId: 'conversation-a',
    checkedConversationIds: ['conversation-b'],
    selectedReplicaKeyByConversation: { 'conversation-a': 'replica-a' }
  }), {
    targetDeviceId: 'device-b',
    selections: [{ conversationId: 'conversation-a', replicaId: 'replica-a' }]
  });

  let next = UiContext.setAgent(original, 'agent-b');
  next = UiContext.setSlot(next, 'slot-b');

  assert.equal(UiContext.selectedAgentId(next), 'agent-b');
  assert.equal(UiContext.selectedSlotKey(next), 'slot-b');
  assert.equal(next.focusedConversationId, 'conversation-a');
  assert.deepEqual([...next.checkedConversationIds], ['conversation-b']);
  assert.equal(next.selectedReplicaKeyByConversation['conversation-a'], 'replica-a');
  assert.equal(next.transferDraft.kind, 'session-pointer');
});

test('设备详情选择与顶栏 Device Lens 独立，任一方向切换都不覆盖另一方', () => {
  let context = UiContext.create({
    selectedDeviceLensId: 'device-a',
    selectedDeviceDetailId: 'device-b'
  });
  context = UiContext.selectDeviceDetail(context, 'device-c');
  assert.equal(context.selectedDeviceLensId, 'device-a');
  assert.equal(context.selectedDeviceDetailId, 'device-c');

  context = UiContext.setDeviceLens(context, 'device-d');
  assert.equal(context.selectedDeviceLensId, 'device-d');
  assert.equal(context.selectedDeviceDetailId, 'device-c');
});

test('传输草稿的 kind 不可被补丁改写，文件草稿永远不继承会话选择', () => {
  let context = UiContext.createSessionPointerDraft(UiContext.create(), {
    targetDeviceId: 'device-a',
    selections: [{ conversationId: 'conversation-a', replicaId: 'replica-a' }]
  });
  context = UiContext.updateTransferDraft(context, {
    kind: 'files',
    targetDeviceId: 'device-b'
  });
  assert.equal(context.transferDraft.kind, 'session-pointer');
  assert.equal(context.transferDraft.targetDeviceId, 'device-b');
  assert.equal(context.transferDraft.selections.length, 1);

  context = UiContext.createFileDraft(context, { targetDeviceId: 'device-c' });
  context = UiContext.updateTransferDraft(context, {
    kind: 'session-pointer',
    selections: [{ conversationId: 'conversation-b', replicaId: 'replica-b' }]
  });
  assert.equal(context.transferDraft.kind, 'files');
  assert.deepEqual(context.transferDraft.selections, []);
});

test('断开当前远控时显式切到剩余 viewing，会话全部结束才清除提示', () => {
  let context = UiContext.openRemote(UiContext.create(), 'remote-a');
  context = UiContext.returnFromRemote(context, 'remote-a');
  context = UiContext.disconnectRemote(context, 'remote-a', ['remote-b']);
  assert.equal(context.workspaceMode, 'sessions');
  assert.equal(context.activeRemoteSessionId, 'remote-b');

  context = UiContext.disconnectRemote(context, 'remote-b', []);
  assert.equal(context.activeRemoteSessionId, null);
});
