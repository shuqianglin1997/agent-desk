'use strict';

// Qwen Code sessions as Markdown, read through ./records.js.

const qwenRecords = require('./records');
const { readJsonLines, renderTurns } = require('../transcript');

// Qwen Code: user prompts (not sidechain, no subtype) and assistant text parts.
function qwenTranscriptMarkdown(filePath) {
  return renderTurns(qwenRecords.conversationTurns(readJsonLines(filePath)), 'Qwen').join('\n\n');
}

module.exports = { qwenTranscriptMarkdown };
