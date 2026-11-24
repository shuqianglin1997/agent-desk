'use strict';

// Kimi Code and Kimi Work sessions as Markdown: state.json gives the title and
// times, the wire records (./wire.js) the conversation.

const path = require('node:path');
const wire = require('./wire');
const { readJsonSafe, formatWhen, renderTurns } = require('../transcript');

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

  const turns = wire.collectKimiTurns(wire.wirePathOf(stateJsonPath));
  if (turns === null) {
    return `${headLines.join('\n')}\n（没有找到对话记录 wire.jsonl，仅导出会话元数据。）\n`;
  }

  const blocks = renderTurns(turns, 'Kimi');
  const body = blocks.length ? blocks.join('\n\n') : '（对话记录为空。）';
  return `${headLines.join('\n')}\n${body}\n`;
}

module.exports = { kimiTranscriptMarkdown };
