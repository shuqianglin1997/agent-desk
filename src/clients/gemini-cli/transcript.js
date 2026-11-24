'use strict';

// Gemini CLI sessions as Markdown, read through ./records.js.

const geminiRecords = require('./records');
const { readJsonSafe, readJsonLines, renderTurns } = require('../transcript');

// Gemini CLI: JSONL (first line metadata) or an older whole-file JSON.
function geminiTranscriptMarkdown(filePath) {
  let document;
  if (filePath.endsWith('.json')) {
    document = readJsonSafe(filePath);
    if (!document) throw new Error('transcript-unavailable');
  } else {
    document = readJsonLines(filePath);
  }
  return renderTurns(geminiRecords.conversationTurns(geminiRecords.messagesOf(document)), 'Gemini').join('\n\n');
}

module.exports = { geminiTranscriptMarkdown };
