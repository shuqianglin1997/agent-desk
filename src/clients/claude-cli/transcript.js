'use strict';

// Claude Code sessions as Markdown, read through ./records.js.

const fs = require('node:fs');
const path = require('node:path');
const records = require('./records');
const { formatWhen, renderTurns } = require('../transcript');

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
    if (records.isSidechain(event)) continue;
    if (event.timestamp) {
      if (!firstTs) firstTs = event.timestamp;
      lastTs = event.timestamp;
    }
    if (!cwd && event.cwd) cwd = String(event.cwd);

    if (records.isPrompt(event)) {
      const textContent = records.typedPromptText(event);
      if (textContent) turns.push({ kind: 'user', text: textContent });
    } else if (event.type === 'assistant') {
      for (const part of records.replyParts(event)) {
        turns.push(part.kind === 'text' ? { kind: 'assistant', text: part.text } : { kind: 'tool', text: part.name });
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

module.exports = { claudeCliTranscriptMarkdown };
