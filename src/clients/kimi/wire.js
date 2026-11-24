'use strict';

// Kimi wire records (agents/<agent>/wire.jsonl next to a session's state.json;
// protocol 1.4, Kimi-internal, read best-effort: unknown events are skipped).
// Kimi Code and Kimi Work write the same records. Only what a person would
// read is taken: their own messages (origin.kind === 'user'), the reply text
// parts and tool-call summaries; system prompts, injections, thinking and raw
// tool output are left out.

const fs = require('node:fs');
const path = require('node:path');

// The wire file of a session, from its state.json path.
function wirePathOf(stateJsonPath) {
  return path.join(path.dirname(stateJsonPath), 'agents', 'main', 'wire.jsonl');
}

function messageText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
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

// The raw message of a context.append_message event ({ role, content: [parts] }),
// for readers that need its non-text parts (attachments).
function messageOf(entry) {
  return entry?.type === 'context.append_message' ? entry.message : null;
}

module.exports = { wirePathOf, messageText, collectKimiTurns, messageOf };
