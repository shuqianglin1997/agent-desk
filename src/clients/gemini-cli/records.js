'use strict';

// Gemini CLI session records. A session is a .json document with `messages`,
// or a .jsonl file whose first line is the session header and whose later
// lines are messages or metadata updates (`$set`, which carry no type).
// Messages of type `user` are the person's, `gemini` the model's.

const { partsText } = require('./parts');

// The messages of a parsed .json document, or of the parsed lines of a .jsonl file.
function messagesOf(document) {
  if (Array.isArray(document)) return document.slice(1).filter((record) => record && record.type);
  return Array.isArray(document?.messages) ? document.messages : [];
}

// [{ kind: 'user' | 'assistant', text }] with trimmed, non-empty text.
function conversationTurns(messages) {
  const turns = [];
  for (const message of messages) {
    const text = partsText(message?.content).trim();
    if (!text) continue;
    if (message.type === 'user') turns.push({ kind: 'user', text });
    else if (message.type === 'gemini') turns.push({ kind: 'assistant', text });
  }
  return turns;
}

// The model's last non-empty reply, as written; null when there is none.
function lastAnswerText(messages) {
  let answer = null;
  for (const message of messages) {
    if (message?.type !== 'gemini') continue;
    const text = partsText(message.content);
    if (text.trim()) answer = text;
  }
  return answer;
}

module.exports = { messagesOf, conversationTurns, lastAnswerText };
