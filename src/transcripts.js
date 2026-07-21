/*
 * AgentDesk — session transcript export (Markdown).
 *
 * Pure Node (fs / path only) so it can be unit-tested outside Electron.
 * 目前实现 Kimi Code：state.json 提供元数据，agents/main/wire.jsonl 提供对话流。
 * 只导出「人看的对话」：用户消息（origin.kind === 'user'）、助手正文（content.part
 * 的 text）与工具调用摘要；系统提示、注入消息、思考与工具原始输出一律不落盘。
 * wire 协议是 Kimi 内部格式（protocol 1.4），解析按 best-effort：无法识别的
 * 事件跳过，不阻断导出。
 */

const fs = require('node:fs');
const path = require('node:path');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function messageText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function formatWhen(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

// wire.jsonl → [{kind: 'user'|'assistant'|'tool', text}]，顺序保持事件流原序。
function collectKimiTurns(wirePath) {
  let lines;
  try {
    lines = fs.readFileSync(wirePath, 'utf8').split(/\r?\n/);
  } catch (_error) {
    return null;
  }

  const turns = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue; // 运行中写到一半的行
    }

    if (event.type === 'context.append_message') {
      const message = event.message || {};
      const origin = message.origin || event.origin || {};
      // 只保留人真正说的话；skill 注入、system-reminder 等 injection 不导出
      if (message.role !== 'user' || origin.kind !== 'user') continue;
      const textContent = messageText(message);
      if (textContent) turns.push({ kind: 'user', text: textContent });
      continue;
    }

    if (event.type === 'context.append_loop_event') {
      const inner = event.event || {};
      if (inner.type === 'content.part' && inner.part?.type === 'text') {
        const textContent = String(inner.part.text || '').trim();
        if (textContent) turns.push({ kind: 'assistant', text: textContent });
      } else if (inner.type === 'tool.call') {
        const name = String(inner.name || '工具').trim();
        const description = String(inner.description || '').trim();
        turns.push({ kind: 'tool', text: description ? `${name} — ${description}` : name });
      }
    }
  }
  return turns;
}

// 连续的 assistant/tool 片段合并成一个「助手」块，用户消息单独成块。
function renderTurns(turns) {
  const blocks = [];
  let assistantBuffer = [];

  const flushAssistant = () => {
    if (!assistantBuffer.length) return;
    blocks.push(`## 🤖 Kimi\n\n${assistantBuffer.join('\n\n')}`);
    assistantBuffer = [];
  };

  for (const turn of turns) {
    if (turn.kind === 'user') {
      flushAssistant();
      blocks.push(`## 🧑 用户\n\n${turn.text}`);
    } else if (turn.kind === 'assistant') {
      assistantBuffer.push(turn.text);
    } else if (turn.kind === 'tool') {
      assistantBuffer.push(`> 🔧 ${turn.text}`);
    }
  }
  flushAssistant();
  return blocks;
}

function kimiTranscriptMarkdown(stateJsonPath, opts = {}) {
  if (!stateJsonPath || typeof stateJsonPath !== 'string') {
    throw new Error('没有可导出的会话文件路径。');
  }
  const state = readJsonSafe(stateJsonPath);
  if (!state) {
    throw new Error(`读不到会话文件：${stateJsonPath}`);
  }

  const sessionDir = path.dirname(stateJsonPath);
  const sessionId = path.basename(sessionDir);
  // Kimi Work 的索引层有更干净的 generated 标题，允许覆盖 state.json 的首条消息标题
  const title = String(opts.title || state.title || '').trim()
    || `Kimi 会话 ${sessionId.replace(/^session_/, '').slice(0, 8)}`;

  const headLines = [`# ${title}`, ''];
  if (state.workDir) headLines.push(`- 项目：\`${state.workDir}\``);
  const created = formatWhen(state.createdAt);
  const updated = formatWhen(state.updatedAt);
  if (created) headLines.push(`- 创建：${created}`);
  if (updated) headLines.push(`- 最后活跃：${updated}`);
  headLines.push(`- 会话标识：\`${sessionId}\``, '', '---', '');

  const turns = collectKimiTurns(path.join(sessionDir, 'agents', 'main', 'wire.jsonl'));
  if (turns === null) {
    return `${headLines.join('\n')}\n（没有找到对话记录 wire.jsonl，仅导出会话元数据。）\n`;
  }

  const blocks = renderTurns(turns);
  const body = blocks.length ? blocks.join('\n\n') : '（对话记录为空。）';
  return `${headLines.join('\n')}\n${body}\n`;
}

// 文件名建议：去掉路径分隔与 Windows 非法字符，限长，避免空名。
function suggestedTranscriptName(title) {
  const cleaned = String(title || '')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return `${cleaned || 'kimi-session'}.md`;
}

module.exports = { kimiTranscriptMarkdown, suggestedTranscriptName };
