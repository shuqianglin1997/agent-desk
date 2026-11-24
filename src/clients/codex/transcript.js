'use strict';

// Codex rollouts as Markdown, read through ./rollout.js.

const fs = require('node:fs');
const codexRollout = require('./rollout');
const { renderTurns } = require('../transcript');

function codexTranscriptMarkdown(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('codex-transcript-unavailable');
  return renderTurns(codexRollout.conversationTurns(fs.readFileSync(filePath, 'utf8')), 'Codex').join('\n\n');
}

module.exports = { codexTranscriptMarkdown };
