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
const { readJson } = require('./core/json-file');

function readJsonSafe(filePath) {
  return readJson(filePath);
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
function renderTurns(turns, assistantLabel = 'Kimi') {
  const blocks = [];
  let assistantBuffer = [];

  const flushAssistant = () => {
    if (!assistantBuffer.length) return;
    blocks.push(`## 🤖 ${assistantLabel}\n\n${assistantBuffer.join('\n\n')}`);
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

function codexTranscriptMarkdown(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('codex-transcript-unavailable');
  const uiEvents = [];
  const responseItems = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (_error) { continue; }
    const payload = entry?.payload;
    if (entry?.type === 'event_msg' && typeof payload?.message === 'string') {
      if (payload.type === 'user_message') uiEvents.push({ kind: 'user', text: payload.message });
      if (payload.type === 'agent_message') uiEvents.push({ kind: 'assistant', text: payload.message });
    } else if (entry?.type === 'response_item' && payload?.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      const parts = Array.isArray(payload.content) ? payload.content : [];
      const kind = payload.role === 'user' ? 'input_text' : 'output_text';
      const text = parts.filter((item) => item?.type === kind && typeof item.text === 'string')
        .map((item) => item.text).join('\n');
      if (text.trim()) responseItems.push({ kind: payload.role, text });
    }
  }
  return renderTurns(uiEvents.length ? uiEvents : responseItems, 'Codex').join('\n\n');
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

// Claude Code CLI 会话（~/.claude/projects/<slug>/<uuid>.jsonl）→ Markdown。
// 同样只导出人看的对话：真实用户输入、助手正文与工具调用摘要；
// 思考、命令注入（<command-*/<system-reminder…）、tool_result、子 agent 事件不落盘。
function claudeCliTranscriptMarkdown(jsonlPath, opts = {}) {
  if (!jsonlPath || typeof jsonlPath !== 'string') {
    throw new Error('没有可导出的会话文件路径。');
  }
  let raw;
  try {
    raw = fs.readFileSync(jsonlPath, 'utf8');
  } catch (_error) {
    throw new Error(`读不到会话文件：${jsonlPath}`);
  }

  const turns = [];
  let cwd = null;
  let firstTs = null;
  let lastTs = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (event.isSidechain === true) continue;
    if (event.timestamp) {
      if (!firstTs) firstTs = event.timestamp;
      lastTs = event.timestamp;
    }
    if (!cwd && event.cwd) cwd = String(event.cwd);

    if (event.type === 'user' && !event.isMeta) {
      const content = event.message?.content;
      const textContent = (typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
          : ''
      ).trim();
      if (textContent && !textContent.startsWith('<')) turns.push({ kind: 'user', text: textContent });
    } else if (event.type === 'assistant') {
      const parts = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const part of parts) {
        if (part?.type === 'text' && String(part.text || '').trim()) {
          turns.push({ kind: 'assistant', text: String(part.text).trim() });
        } else if (part?.type === 'tool_use' && part.name) {
          turns.push({ kind: 'tool', text: String(part.name) });
        }
      }
    }
  }

  const sessionId = path.basename(jsonlPath, '.jsonl');
  const title = String(opts.title || '').trim()
    || (turns.find((turn) => turn.kind === 'user')?.text || '').slice(0, 60)
    || `Claude 会话 ${sessionId.slice(0, 8)}`;

  const headLines = [`# ${title}`, ''];
  if (cwd) headLines.push(`- 项目：\`${cwd}\``);
  const created = formatWhen(firstTs);
  const updated = formatWhen(lastTs);
  if (created) headLines.push(`- 创建：${created}`);
  if (updated) headLines.push(`- 最后活跃：${updated}`);
  headLines.push(`- 会话标识：\`${sessionId}\``, '', '---', '');

  const blocks = renderTurns(turns, 'Claude');
  const body = blocks.length ? blocks.join('\n\n') : '（对话记录为空。）';
  return `${headLines.join('\n')}\n${body}\n`;
}

// ---------- OpenCode、Gemini CLI、Qwen Code ----------
// Shared helpers: a string, a part or a list of parts; JSONL read with a cap.
function partsText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(partsText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    if (value.thought === true) return '';
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return partsText(value.parts);
  }
  return '';
}

function readJsonLines(filePath, limit = 64 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > limit) throw new Error('transcript-unavailable');
  const records = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (_error) { /* half-written line */ }
  }
  return records;
}

function parseJsonText(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_error) { return null; }
}

// OpenCode 2.x: session_message rows (user text) and session_part rows
// (assistant text and tool calls). 1.x: message/part tables. Older still:
// storage/message/<session>/*.json with storage/part/<message>/*.json.
function openCodeTurnsFromDatabase(file, sessionId) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const turns = [];
    if (tables.has('session_message')) {
      const parts = new Map();
      if (tables.has('session_part')) {
        for (const row of db.prepare('SELECT message_id, type, data FROM session_part WHERE session_id = ? ORDER BY message_id, ordinal').all(sessionId)) {
          if (!parts.has(row.message_id)) parts.set(row.message_id, []);
          parts.get(row.message_id).push({ type: row.type, data: parseJsonText(row.data) || {} });
        }
      }
      for (const row of db.prepare('SELECT id, type, data FROM session_message WHERE session_id = ? ORDER BY seq').all(sessionId)) {
        const data = parseJsonText(row.data) || {};
        if (row.type === 'user' && typeof data.text === 'string' && data.text.trim()) {
          turns.push({ kind: 'user', text: data.text.trim() });
        } else if (row.type === 'assistant') {
          const content = parts.get(row.id) || (Array.isArray(data.content) ? data.content.map((item) => ({ type: item.type, data: item })) : []);
          for (const part of content) {
            if (part.type === 'text' && typeof part.data.text === 'string' && part.data.text.trim()) turns.push({ kind: 'assistant', text: part.data.text.trim() });
            else if (part.type === 'tool') turns.push({ kind: 'tool', text: String(part.data.name || part.data.tool || 'tool') });
          }
        }
      }
      return turns;
    }
    if (tables.has('message') && tables.has('part')) {
      const messages = db.prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY id').all(sessionId);
      for (const message of messages) {
        const info = parseJsonText(message.data) || {};
        const role = info.role === 'user' ? 'user' : 'assistant';
        for (const row of db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id').all(message.id)) {
          const part = parseJsonText(row.data) || {};
          if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() && !part.synthetic) turns.push({ kind: role, text: part.text.trim() });
          else if (part.type === 'tool' && role === 'assistant') turns.push({ kind: 'tool', text: String(part.tool || 'tool') });
        }
      }
    }
    return turns;
  } finally {
    db.close();
  }
}

function openCodeTurnsFromStorage(sessionFile, sessionId) {
  const storage = path.dirname(path.dirname(path.dirname(sessionFile)));
  const messageDir = path.join(storage, 'message', sessionId);
  const messages = (() => { try { return fs.readdirSync(messageDir).filter((name) => name.endsWith('.json')); } catch (_error) { return []; } })()
    .map((name) => readJsonSafe(path.join(messageDir, name)))
    .filter((info) => info && typeof info.id === 'string')
    .sort((left, right) => Number(left.time?.created || 0) - Number(right.time?.created || 0));
  const turns = [];
  for (const info of messages) {
    const partDir = path.join(storage, 'part', info.id);
    const parts = (() => { try { return fs.readdirSync(partDir).filter((name) => name.endsWith('.json')).sort(); } catch (_error) { return []; } })()
      .map((name) => readJsonSafe(path.join(partDir, name))).filter(Boolean);
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() && !part.synthetic) turns.push({ kind: info.role === 'user' ? 'user' : 'assistant', text: part.text.trim() });
      else if (part.type === 'tool' && info.role !== 'user') turns.push({ kind: 'tool', text: String(part.tool || 'tool') });
    }
  }
  return turns;
}

function openCodeTranscriptMarkdown(session) {
  const filePath = String(session?.filePath || '');
  const sessionId = String(session?.address || session?.id || '');
  if (!filePath || !sessionId) throw new Error('transcript-unavailable');
  const turns = filePath.endsWith('.json') ? openCodeTurnsFromStorage(filePath, sessionId) : openCodeTurnsFromDatabase(filePath, sessionId);
  return renderTurns(turns, 'OpenCode').join('\n\n');
}

// Gemini CLI: JSONL (first line metadata) or an older whole-file JSON.
function geminiTranscriptMarkdown(filePath) {
  let messages;
  if (filePath.endsWith('.json')) {
    const json = readJsonSafe(filePath);
    if (!json) throw new Error('transcript-unavailable');
    messages = Array.isArray(json.messages) ? json.messages : [];
  } else {
    messages = readJsonLines(filePath).slice(1).filter((record) => record && record.type);
  }
  const turns = [];
  for (const message of messages) {
    const text = partsText(message.content).trim();
    if (!text) continue;
    if (message.type === 'user') turns.push({ kind: 'user', text });
    else if (message.type === 'gemini') turns.push({ kind: 'assistant', text });
  }
  return renderTurns(turns, 'Gemini').join('\n\n');
}

// Qwen Code: user prompts (not sidechain, no subtype) and assistant text parts.
function qwenTranscriptMarkdown(filePath) {
  const turns = [];
  for (const record of readJsonLines(filePath)) {
    if (!record || record.isSidechain) continue;
    if (record.type === 'user' && record.subtype === undefined) {
      const text = (typeof record.systemPayload?.displayText === 'string' ? record.systemPayload.displayText : partsText(record.message?.parts || record.message?.content)).trim();
      if (text) turns.push({ kind: 'user', text });
    } else if (record.type === 'assistant') {
      const text = partsText(record.message?.parts || record.message?.content).trim();
      if (text) turns.push({ kind: 'assistant', text });
    }
  }
  return renderTurns(turns, 'Qwen').join('\n\n');
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

module.exports = {
  codexTranscriptMarkdown, kimiTranscriptMarkdown, claudeCliTranscriptMarkdown,
  openCodeTranscriptMarkdown, geminiTranscriptMarkdown, qwenTranscriptMarkdown, suggestedTranscriptName
};
