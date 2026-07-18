const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough, Readable, Writable } = require('node:stream');

const {
  acpUpdateToEvents,
  connectAcpChild,
  textContent,
  withTimeout
} = require('../src/acp-client');

test('ACP 流更新区分回答、思考、工具和标题', () => {
  assert.deepEqual(acpUpdateToEvents({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: '完成' }
  }), [{ stream: 'agent', text: '完成' }]);
  assert.deepEqual(acpUpdateToEvents({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: '检查文件' }
  }), [{ stream: 'thought', text: '检查文件' }]);
  assert.deepEqual(acpUpdateToEvents({
    sessionUpdate: 'session_info_update',
    title: '修复登录问题'
  }), [{ type: 'title', title: '修复登录问题' }]);
  assert.match(acpUpdateToEvents({
    sessionUpdate: 'tool_call',
    title: '读取 package.json',
    status: 'in_progress'
  })[0].text, /读取 package\.json/);
  assert.equal(textContent({ type: 'image', data: 'x' }), '');
});

test('ACP 握手超时会明确失败而不是永久挂起', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, '连接超时'),
    /连接超时/
  );
});

test('ACP bridge 与官方 SDK 完成真实握手、权限请求和流式 prompt', async () => {
  const acp = await import('@agentclientprotocol/sdk');
  const clientToAgent = new PassThrough();
  const agentToClient = new PassThrough();
  const agentConnection = acp.agent({ name: 'fixture-agent' })
    .onRequest(acp.methods.agent.initialize, (context) => ({
      protocolVersion: context.params.protocolVersion,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: { name: 'Fixture Agent', version: '1.0.0' }
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'fixture-session' }))
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      const permission = await context.client.request(acp.methods.client.session.requestPermission, {
        sessionId: context.params.sessionId,
        toolCall: {
          title: '读取项目',
          kind: 'read',
          status: 'pending',
          toolCallId: 'fixture-tool',
          content: []
        },
        options: [{ kind: 'allow_once', name: '允许', optionId: 'allow-fixture' }]
      });
      assert.equal(permission.outcome.optionId, 'allow-fixture');
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '真实 ACP 输出' }
        }
      });
      return { stopReason: 'end_turn' };
    })
    .connect(acp.ndJsonStream(
      Writable.toWeb(agentToClient),
      Readable.toWeb(clientToAgent)
    ));

  const permissionTitles = [];
  const bridge = await connectAcpChild({
    stdin: clientToAgent,
    stdout: agentToClient
  }, {
    cwd: '/fixture-workspace',
    connectTimeout: 1_000,
    requestPermission: async (params) => {
      permissionTitles.push(params.toolCall.title);
      return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } };
    }
  });
  const updates = [];
  const response = await bridge.prompt('开始', (event) => updates.push(event));

  assert.equal(bridge.session.sessionId, 'fixture-session');
  assert.equal(bridge.initializeResult.agentInfo.name, 'Fixture Agent');
  assert.deepEqual(permissionTitles, ['读取项目']);
  assert.deepEqual(updates, [{ stream: 'agent', text: '真实 ACP 输出' }]);
  assert.equal(response.stopReason, 'end_turn');

  bridge.close();
  agentConnection.close();
  clientToAgent.destroy();
  agentToClient.destroy();
});
