'use strict';

// Markdown for an exported conversation, shared by every client's transcript:
// turns into blocks, dates, the suggested file name, bounded reads. Nothing
// here names a client; each client's src/clients/<id>/transcript.js decides
// which turns a person would read (their own words, the replies, tool calls).

const fs = require('node:fs');
const { readJson } = require('../core/json-file');

function readJsonSafe(filePath) {
  return readJson(filePath);
}

function formatWhen(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

// 连续的 assistant/tool 片段合并成一个「助手」块，用户消息单独成块。
function renderTurns(turns, assistantLabel) {
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

// JSON lines read with a cap; half-written lines are skipped.
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

module.exports = { readJsonSafe, formatWhen, renderTurns, readJsonLines, parseJsonText, suggestedTranscriptName };
