'use strict';

// OpenCode sessions as Markdown. SQLite is opened read-only.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonSafe, parseJsonText, renderTurns } = require('../transcript');

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

module.exports = { openCodeTranscriptMarkdown };
