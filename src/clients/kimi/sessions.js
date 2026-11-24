'use strict';

// Kimi Code sessions: <home>/sessions/<workspace>/session_<uuid>/state.json,
// with the conversation in agents/<agent>/wire.jsonl next to it. Kimi Work
// keeps the same files.

const os = require('node:os');
const path = require('node:path');
const { sortByRecency, lastEventTimestamp, walkFiles, readJson, safeStat, parseDate, cleanTitle, text } = require('../scan');

// Kimi Code（CLI / VS Code 插件）：<root>/sessions/<workspaceId>/session_<uuid>/state.json，
// 对话记录在同级 agents/<agentId>/wire.jsonl。state.json 直接给出标题与起止时间。
function scanKimi(profile, report = null) {
  const root = profile.sessionRoot || path.join(os.homedir(), '.kimi-code');
  const records = [];

  for (const filePath of walkFiles(
    path.join(root, 'sessions'),
    (entry, itemPath) => entry.isFile() && entry.name === 'state.json' && /session_[^/\\]+[/\\]state\.json$/.test(itemPath),
    report
  )) {
    const json = readJson(filePath);
    if (!json) continue;
    const stat = safeStat(filePath);
    const id = path.basename(path.dirname(filePath));
    const shortId = id.replace(/^session_/, '').slice(0, 8);
    const title = cleanTitle(json.title) || `Kimi 会话 ${shortId}`;
    const createdAt = parseDate(json.createdAt) || stat?.birthtime?.toISOString() || null;
    const updatedAt = parseDate(json.updatedAt) || stat?.mtime?.toISOString() || createdAt;

    records.push({
      id,
      appId: 'kimi',
      title,
      createdAt,
      updatedAt,
      projectPath: text(json.workDir) || null,
      source: 'Kimi Code',
      status: '可用',
      model: null,
      filePath,
      address: id
    });
  }

  return sortByRecency(records);
}

// Kimi：probe 盯 state.json（每轮写 updatedAt）和 wire.jsonl（逐事件追加，字段是毫秒 time）。
// 传入哪个最新文件就读哪个，保证「正在干活」判定的实时性。
function kimiActivityFromFile(filePath) {
  if (!filePath) return null;
  if (filePath.endsWith('.jsonl')) return lastEventTimestamp(filePath);
  const json = readJson(filePath);
  if (!json) return null;
  const iso = parseDate(json.updatedAt);
  return iso ? new Date(iso).getTime() : null;
}

module.exports = { scanKimi, kimiActivityFromFile };
