'use strict';

// Claude Code session records (JSON lines under projects/). A person's prompt
// is a `user` event that is not meta; its text is a string or the text parts
// of its content, and text starting with '<' is an injected command or
// reminder, not typed. A reply is an `assistant` event with text and tool_use
// parts. Sidechain events belong to subagents, not the conversation.

const isSidechain = (event) => event?.isSidechain === true;
const isPrompt = (event) => event?.type === 'user' && !event.isMeta;

// A message content's text: the string, or its text parts joined by lines.
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
}

// What the person typed in this event, trimmed; '' when it is not a prompt or
// is an injected command.
function typedPromptText(event) {
  if (!isPrompt(event)) return '';
  const text = contentText(event.message?.content).trim();
  return text && !text.startsWith('<') ? text : '';
}

// A reply's parts as [{ kind: 'text', text } | { kind: 'tool', name }]: trimmed,
// non-empty text parts and named tool calls.
function replyParts(event) {
  const parts = Array.isArray(event?.message?.content) ? event.message.content : [];
  const output = [];
  for (const part of parts) {
    if (part?.type === 'text' && String(part.text || '').trim()) output.push({ kind: 'text', text: String(part.text).trim() });
    else if (part?.type === 'tool_use' && part.name) output.push({ kind: 'tool', name: String(part.name) });
  }
  return output;
}

// A reply's text parts as written, joined by lines.
function replyText(event) {
  return (Array.isArray(event?.message?.content) ? event.message.content : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n');
}

// The last non-empty reply of the conversation (not of a subagent); null when there is none.
function lastAnswerText(events) {
  let answer = null;
  for (const event of events) {
    if (isSidechain(event) || event?.type !== 'assistant') continue;
    const text = replyText(event);
    if (text.trim()) answer = text;
  }
  return answer;
}

// The raw message of a user or assistant event, for readers that need its
// non-text parts (attachments).
function messageOf(entry) {
  return ['user', 'assistant'].includes(entry?.type) ? entry.message : null;
}

module.exports = { isSidechain, isPrompt, contentText, typedPromptText, replyParts, replyText, lastAnswerText, messageOf };
