'use strict';

// Qwen Code sessions: <home>/projects/<cwd>/chats/<uuid>.jsonl (and
// chats/archive/); the title is the last system/custom_title or the first
// prompt. Sidechain and child sessions are internal.

const path = require('node:path');
const qwenRecords = require('./records');
const memo = require('../file-memo');
const { MAX_FILES, iso, cleanTitle, safeStat, listDirectory, readText, jsonLines, sortByRecency } = require('../cli-scan');

// One session file, remembered while it is unchanged (src/clients/file-memo.js).
// null: not a user session; a file that cannot be read is skipped this time.
function scanQwenFile(filePath) {
  try {
    return memo.remember('qwen-code/file', filePath, readQwenFile);
  } catch (_error) {
    return null;
  }
}

function readQwenFile(filePath) {
  const textContent = readText(filePath);
  if (textContent === null) throw memo.unreadable(filePath);
  const lines = jsonLines(textContent);
  let id = path.basename(filePath, '.jsonl');
  let customTitle = '';
  let firstPrompt = '';
  let cwd = null;
  let firstAt = null;
  let lastAt = null;
  let child = false;
  for (const record of lines) {
    if (!record || typeof record !== 'object') continue;
    if (typeof record.sessionId === 'string' && record.sessionId) id = record.sessionId;
    if (record.timestamp) {
      firstAt ||= record.timestamp;
      lastAt = record.timestamp;
    }
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (record.type === 'system' && record.subtype === 'custom_title') {
      customTitle = cleanTitle(record.systemPayload?.customTitle) || customTitle;
    } else if (record.type === 'system' && record.subtype === 'parent_session') {
      child = true;
    } else if (qwenRecords.isPrompt(record) && !firstPrompt) {
      firstPrompt = cleanTitle(qwenRecords.promptText(record, ' ').trim());
    }
  }
  if (child || !lines.length) return null;
  return { id, title: customTitle || firstPrompt, cwd, createdAt: iso(firstAt), updatedAt: iso(lastAt) };
}

function scanQwen(profile) {
  const root = profile.sessionRoot;
  const records = new Map();
  let files = 0;
  for (const projectEntry of listDirectory(path.join(root, 'projects'))) {
    if (!projectEntry.isDirectory()) continue;
    const chats = path.join(root, 'projects', projectEntry.name, 'chats');
    for (const [directory, archived] of [[chats, false], [path.join(chats, 'archive'), true]]) {
      for (const entry of listDirectory(directory)) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl') || ++files > MAX_FILES) continue;
        const filePath = path.join(directory, entry.name);
        const parsed = scanQwenFile(filePath);
        if (!parsed || (records.has(parsed.id) && archived)) continue;
        const stat = safeStat(filePath);
        records.set(parsed.id, {
          id: parsed.id,
          appId: 'qwen-code',
          title: parsed.title || `Qwen ${parsed.id.slice(0, 8)}`,
          createdAt: parsed.createdAt || stat?.birthtime?.toISOString() || null,
          updatedAt: parsed.updatedAt || stat?.mtime?.toISOString() || parsed.createdAt,
          projectPath: parsed.cwd,
          source: 'Qwen Code',
          status: archived ? '已归档' : '可用',
          model: null,
          filePath,
          address: parsed.id
        });
      }
    }
  }
  return sortByRecency([...records.values()]);
}

module.exports = { scanQwen };
