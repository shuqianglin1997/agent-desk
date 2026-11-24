'use strict';

// Claude Code sessions: <home>/projects/<project slug>/<uuid>.jsonl.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const records = require('./records');
const { sortByRecency, emptyReplyState, readTailEvents, readChunkLines, safeStat, parseDate, cleanTitle, text } = require('../scan');

// Claude Code CLI（用户自己终端里跑的 claude）：<root>/projects/<路径slug>/<uuid>.jsonl，
// 与桌面 App 的 claude-code-sessions 是两套。事件逐行追加，头部有 cwd/timestamp，
// 标题事件（ai-title / custom-title）在生成时追加于文件中后部。
// 会话量可达数千，故每文件只定点读头尾各 64KB，且只遍历两层目录（不进 memory/ 等子目录）。
function scanClaudeCli(profile) {
  const root = profile.sessionRoot || path.join(os.homedir(), '.claude');
  const projectsDir = path.join(root, 'projects');
  const records = [];
  let projectEntries = [];
  try {
    projectEntries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (_error) {
    return records;
  }

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const dir = path.join(projectsDir, projectEntry.name);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const record = claudeCliRecord(path.join(dir, entry.name));
      if (record) records.push(record);
    }
  }

  return sortByRecency(records);
}

function claudeCliRecord(filePath) {
  // 头部窗口给大一些（256KB）：首条消息可能内嵌大 payload（粘贴的图片/长文），
  // 64KB 会把后面几行的 cwd / 首条真实输入截掉。尾部 64KB 足够（标题事件会周期性重发）。
  const headLines = readChunkLines(filePath, false, 256 * 1024);
  if (!headLines) return null;
  const stat = safeStat(filePath);

  let cwd = null;
  let firstTimestamp = null;
  let firstUserText = null;
  let summaryTitle = null;
  let parsedAny = false;

  for (const line of headLines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    parsedAny = true;
    // 子 agent 会话是独立文件但事件带 isSidechain 标记，不进列表
    if (records.isSidechain(event)) return null;
    if (event.type === 'summary' && !summaryTitle) summaryTitle = cleanTitle(event.summary);
    if (!firstTimestamp && event.timestamp) firstTimestamp = parseDate(event.timestamp);
    if (!cwd && event.cwd) cwd = text(event.cwd);
    if (!firstUserText) {
      const typed = records.typedPromptText(event);
      if (typed) firstUserText = typed.slice(0, 80);
    }
    // 头部信息集齐即可停（标题事件在尾部另读）
    if (cwd && firstTimestamp && (firstUserText || summaryTitle)) break;
  }
  // 头部一条事件都解析不出来的不是会话文件（残片/异物），不进列表
  if (!parsedAny) return null;

  let aiTitle = null;
  let customTitle = null;
  let lastTimestamp = null;
  const reply = emptyReplyState();
  const tailLines = readChunkLines(filePath, true);
  for (const line of tailLines || []) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue; // 首行可能是被截断的半行
    }
    if (event.type === 'ai-title') aiTitle = cleanTitle(event.aiTitle);
    else if (event.type === 'custom-title') customTitle = cleanTitle(event.customTitle);
    claudeCliReplyStep(reply, event);
    if (event.timestamp) {
      const ts = parseDate(event.timestamp);
      if (ts) lastTimestamp = ts;
    }
  }

  const id = path.basename(filePath, '.jsonl');
  const createdAt = firstTimestamp || stat?.birthtime?.toISOString() || null;
  const updatedAt = lastTimestamp || stat?.mtime?.toISOString() || createdAt;

  return {
    id,
    appId: 'claude-cli',
    title: customTitle || aiTitle || summaryTitle || firstUserText || `Claude 会话 ${id.slice(0, 8)}`,
    createdAt,
    updatedAt,
    projectPath: cwd,
    source: 'Claude CLI',
    status: '可用',
    model: null,
    filePath,
    address: id,
    ...reply
  };
}

// Claude 命令行：assistant 事件的 stop_reason 是 end_turn 就是回完了；tool_use 是还在干；
// 只装着 tool_result 的 user 事件是工具的输出，不是人说的话。
function claudeCliReplyStep(state, event) {
  if (!event || typeof event !== 'object' || records.isSidechain(event)) return;
  if (event.type === 'assistant') {
    state.lastRole = 'assistant';
    const at = parseDate(event.timestamp);
    if (at) state.lastReplyAt = at;
    const stop = event.message && event.message.stop_reason;
    if (stop === 'tool_use' || stop === 'pause_turn') state.replyDone = false;
    else if (typeof stop === 'string' && stop) state.replyDone = true;
    else state.replyDone = null;
    return;
  }
  if (event.type !== 'user' || event.isMeta === true) return;
  const content = event.message && event.message.content;
  if (Array.isArray(content) && content.length && content.every((part) => part && part.type === 'tool_result')) {
    if (state.lastRole === null) state.lastRole = 'assistant';
    state.replyDone = false;
    return;
  }
  state.lastRole = 'user';
  state.replyDone = false;
}

function claudeCliTailState(filePath) {
  const reply = emptyReplyState();
  for (const event of (filePath ? readTailEvents(filePath) : null) || []) claudeCliReplyStep(reply, event);
  return reply;
}

// 子 agent 的会话文件每条事件都带 isSidechain；看开头一小段就够，结果不会变，按路径缓存。
const sidechainCache = new Map();
function claudeCliIsSidechain(filePath) {
  if (sidechainCache.has(filePath)) return sidechainCache.get(filePath);
  const head = readChunkLines(filePath, false, 8 * 1024);
  const value = Boolean(head && /"isSidechain"\s*:\s*true/.test(head.join('\n')));
  if (sidechainCache.size >= 12000) sidechainCache.clear();
  sidechainCache.set(filePath, value);
  return value;
}


module.exports = { scanClaudeCli, claudeCliRecord, claudeCliReplyStep, claudeCliTailState, claudeCliIsSidechain };
