/* AgentDesk — ACP stdio client bridge (pure Node, Electron-independent). */

const { Readable, Writable } = require('node:stream');

const ACP_CONNECT_TIMEOUT = 20_000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function textContent(content) {
  return content?.type === 'text' && typeof content.text === 'string'
    ? content.text
    : '';
}

function acpUpdateToEvents(update) {
  if (!update || typeof update !== 'object') return [];
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textContent(update.content);
      return text ? [{ stream: 'agent', text }] : [];
    }
    case 'agent_thought_chunk': {
      const text = textContent(update.content);
      return text ? [{ stream: 'thought', text }] : [];
    }
    case 'tool_call':
      return update.title
        ? [{ stream: 'tool', text: `\n◆ ${update.title}${update.status ? ` · ${update.status}` : ''}\n` }]
        : [];
    case 'tool_call_update':
      return update.status
        ? [{ stream: 'tool', text: `  ${update.title || update.toolCallId || '工具'} · ${update.status}\n` }]
        : [];
    case 'plan': {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      const lines = entries
        .map((item) => item?.content || item?.title || item?.description)
        .filter(Boolean)
        .map((item, index) => `${index + 1}. ${item}`);
      return lines.length ? [{ stream: 'tool', text: `\n计划\n${lines.join('\n')}\n` }] : [];
    }
    case 'session_info_update':
      return update.title ? [{ type: 'title', title: String(update.title) }] : [];
    case 'usage_update':
      return [{ type: 'usage', usage: update }];
    default:
      return [];
  }
}

async function connectAcpChild(child, options = {}) {
  if (!child?.stdin || !child?.stdout) throw new Error('ACP Agent 没有可用的 stdio 管道');
  const loadSdk = options.loadSdk || (() => import('@agentclientprotocol/sdk'));
  const acp = await loadSdk();
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout)
  );
  const client = acp.client({ name: 'AgentDesk' });
  client.onRequest(acp.methods.client.session.requestPermission, async (context) => {
    if (!options.requestPermission) return { outcome: { outcome: 'cancelled' } };
    return options.requestPermission(context.params);
  });
  const connection = client.connect(stream);
  try {
    const initializeResult = await withTimeout(
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: {
          name: 'AgentDesk',
          version: options.clientVersion || '0.0.0'
        }
      }),
      options.connectTimeout || ACP_CONNECT_TIMEOUT,
      'ACP Agent 连接超时'
    );
    const session = await withTimeout(
      connection.agent.buildSession(options.cwd).start(),
      options.connectTimeout || ACP_CONNECT_TIMEOUT,
      'ACP Agent 创建会话超时'
    );

    return {
      connection,
      session,
      initializeResult,
      async prompt(text, onUpdate = () => {}) {
        // ActiveSession puts both streamed updates and the final prompt result
        // into one queue. Attach a rejection handler to the request promise so
        // an agent-side error is observed through nextUpdate without becoming
        // an unhandled rejection.
        session.prompt(text).catch(() => {});
        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === 'stop') return message.response;
          for (const event of acpUpdateToEvents(message.update)) onUpdate(event);
        }
      },
      cancel() {
        return connection.agent.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId
        });
      },
      close() {
        session.dispose();
        connection.close();
      }
    };
  } catch (error) {
    connection.close(error);
    throw error;
  }
}

module.exports = {
  ACP_CONNECT_TIMEOUT,
  acpUpdateToEvents,
  connectAcpChild,
  textContent,
  withTimeout
};
