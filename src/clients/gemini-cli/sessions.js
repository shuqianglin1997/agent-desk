'use strict';

// Gemini CLI sessions: <home>/.gemini/tmp/<slug>/chats/session-*.jsonl (the
// first line is metadata, `$set` lines update it, kind "subagent" is internal),
// or older whole-file session-*.json. The project path comes from projects.json
// or .project_root.

const path = require('node:path');
const { partsText } = require('./parts');
const memo = require('../file-memo');
const { MAX_FILES, iso, cleanTitle, listDirectory, readText, readJson, jsonLines, sortByRecency } = require('../cli-scan');

// Titles join Gemini parts with a space.
const titleText = (value) => partsText(value, ' ');


function geminiProjectRoots(root) {
  const roots = new Map();
  const registry = readJson(path.join(root, 'projects.json'), 1024 * 1024);
  for (const [projectPath, slug] of Object.entries(registry?.projects || {})) {
    if (typeof slug === 'string') roots.set(slug, projectPath);
  }
  return roots;
}

function geminiTitle(messages, summary) {
  if (cleanTitle(summary)) return cleanTitle(summary);
  for (const message of messages) {
    if (message?.type !== 'user') continue;
    const text = cleanTitle(titleText(message.content));
    if (text && !text.startsWith('/')) return text;
  }
  return '';
}

// One session file, remembered while it is unchanged (src/clients/file-memo.js).
// null: not a user session; a file that cannot be read is skipped this time.
function scanGeminiFile(filePath) {
  try {
    return memo.remember('gemini-cli/file', filePath, readGeminiFile);
  } catch (_error) {
    return null;
  }
}

function readGeminiFile(filePath, stat) {
  if (filePath.endsWith('.json')) {
    const json = readJson(filePath);
    if (!json) throw memo.unreadable(filePath);
    if (typeof json.sessionId !== 'string' || json.kind === 'subagent') return null;
    return {
      id: json.sessionId,
      title: geminiTitle(json.messages || [], json.summary),
      createdAt: iso(json.startTime),
      updatedAt: iso(json.lastUpdated) || stat?.mtime?.toISOString() || null
    };
  }
  const textContent = readText(filePath);
  if (textContent === null) throw memo.unreadable(filePath);
  const lines = jsonLines(textContent);
  const meta = lines[0];
  if (!meta || typeof meta.sessionId !== 'string' || meta.kind === 'subagent') return null;
  let summary = meta.summary;
  let lastUpdated = meta.lastUpdated;
  const messages = [];
  for (const record of lines.slice(1)) {
    if (record?.$set && typeof record.$set === 'object') {
      if (typeof record.$set.summary === 'string') summary = record.$set.summary;
      if (record.$set.lastUpdated) lastUpdated = record.$set.lastUpdated;
    } else if (record?.type) {
      messages.push(record);
      if (record.timestamp) lastUpdated = record.timestamp;
    }
  }
  return {
    id: meta.sessionId,
    title: geminiTitle(messages, summary),
    createdAt: iso(meta.startTime),
    updatedAt: iso(lastUpdated) || stat?.mtime?.toISOString() || null
  };
}

function scanGemini(profile) {
  const root = profile.sessionRoot;
  const roots = geminiProjectRoots(root);
  const records = new Map();
  let files = 0;
  for (const slugEntry of listDirectory(path.join(root, 'tmp'))) {
    if (!slugEntry.isDirectory()) continue;
    const slugDir = path.join(root, 'tmp', slugEntry.name);
    const projectPath = roots.get(slugEntry.name) || (readText(path.join(slugDir, '.project_root'), 4096) || '').trim() || null;
    // Only files directly in chats/: subagents live in chats/<parentId>/.
    for (const entry of listDirectory(path.join(slugDir, 'chats'))) {
      if (!entry.isFile() || !/^session-.*\.jsonl?$/.test(entry.name) || ++files > MAX_FILES) continue;
      const filePath = path.join(slugDir, 'chats', entry.name);
      const parsed = scanGeminiFile(filePath);
      if (!parsed || records.has(parsed.id)) continue;
      records.set(parsed.id, {
        id: parsed.id,
        appId: 'gemini-cli',
        title: parsed.title || `Gemini ${parsed.id.slice(0, 8)}`,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt || parsed.createdAt,
        projectPath,
        source: 'Gemini CLI',
        status: '可用',
        model: null,
        filePath,
        address: parsed.id
      });
    }
  }
  return sortByRecency([...records.values()]);
}

module.exports = { scanGemini };
