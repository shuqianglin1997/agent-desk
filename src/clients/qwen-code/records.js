'use strict';

// Qwen Code session records (JSON lines). Its message text uses the Gemini
// parts format (src/clients/gemini-cli/parts.js). A person's prompt is a
// `user` record without a subtype; the model's reply an `assistant` record;
// sidechain records belong to subagents and are not the conversation.

const { partsText } = require('../gemini-cli/parts');

const isPrompt = (record) => Boolean(record) && !record.isSidechain && record.type === 'user' && record.subtype === undefined;
const isReply = (record) => Boolean(record) && !record.isSidechain && record.type === 'assistant';

// What the person typed: the text Qwen displayed for it when there is one.
function promptText(record, separator = '\n') {
  const display = record?.systemPayload?.displayText;
  if (typeof display === 'string') return display;
  return partsText(record?.message?.parts || record?.message?.content, separator);
}

function replyText(record) {
  return partsText(record?.message?.parts || record?.message?.content);
}

// [{ kind: 'user' | 'assistant', text }] with trimmed, non-empty text.
function conversationTurns(records) {
  const turns = [];
  for (const record of records) {
    if (isPrompt(record)) {
      const text = promptText(record).trim();
      if (text) turns.push({ kind: 'user', text });
    } else if (isReply(record)) {
      const text = replyText(record).trim();
      if (text) turns.push({ kind: 'assistant', text });
    }
  }
  return turns;
}

// The model's last non-empty reply, as written; null when there is none.
function lastAnswerText(records) {
  let answer = null;
  for (const record of records) {
    if (!isReply(record)) continue;
    const text = replyText(record);
    if (text.trim()) answer = text;
  }
  return answer;
}

module.exports = { isPrompt, isReply, promptText, replyText, conversationTurns, lastAnswerText };
