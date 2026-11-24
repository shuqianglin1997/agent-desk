'use strict';

// The Codex rollout format, read in one place. A rollout is JSON lines whose
// first line is `session_meta`. Every AgentDesk reader of rollouts (the
// scanner, transcript export and attachments, the hub's final answer, the
// cached quota, the task package) asks this module what a line means; each
// keeps its own policy for how much of the file it reads.

const fs = require('node:fs');

function stableText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function hasSubagentSource(source) {
  return Boolean(
    source
    && typeof source === 'object'
    && Object.prototype.hasOwnProperty.call(source, 'subagent')
  );
}

/**
 * Classify one Codex session_meta payload without reading or mutating its file.
 *
 * A physical rollout id is not necessarily the user-visible conversation id:
 * guardian/subagent rollouts point back to their user root and remain hidden
 * from the default conversation list.
 */
function classifyCodexSessionMeta(payload = {}, fallbackPhysicalRecordId = null) {
  const physicalRecordId = stableText(payload.id) || stableText(fallbackPhysicalRecordId);
  const providerSessionKey = stableText(payload.session_id);
  const explicitParentKey = stableText(payload.parent_thread_id);
  const threadSource = stableText(payload.thread_source);
  const internal = Boolean(
    explicitParentKey
    || threadSource === 'subagent'
    || hasSubagentSource(payload.source)
  );
  const parentConversationKey = internal
    ? (explicitParentKey || providerSessionKey)
    : null;
  const adapterConversationKey = internal
    ? parentConversationKey
    : (providerSessionKey || physicalRecordId);

  return {
    recordKind: internal ? 'internal-child' : 'conversation-root',
    physicalRecordId,
    adapterConversationKey,
    parentConversationKey
  };
}

// One line's JSON value, or null for a blank, damaged or half-written line.
function parseLine(text) {
  try { return JSON.parse(text); } catch (_error) { return null; }
}

// The parsed lines of a rollout's text (or of its lines), skipping the ones
// that are not JSON.
function* entries(source) {
  const lines = Array.isArray(source) ? source : String(source || '').split('\n');
  for (const text of lines) {
    const entry = parseLine(text);
    if (entry !== null && entry !== undefined) yield entry;
  }
}

// The first line can be far longer than one read when session_meta embeds
// instructions. Read on in 64 KB steps until the line ends, up to a fixed
// bound, and always close the file. Null when it is missing or not JSON.
const FIRST_LINE_STEP = 64 * 1024;
const FIRST_LINE_LIMIT = 8 * 1024 * 1024;
function readFirstLine(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks = [];
    let total = 0;
    while (total < FIRST_LINE_LIMIT) {
      const buffer = Buffer.alloc(FIRST_LINE_STEP);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, total);
      if (bytes <= 0) break;
      const chunk = buffer.subarray(0, bytes);
      const newline = chunk.indexOf(0x0a);
      chunks.push(newline < 0 ? chunk : chunk.subarray(0, newline));
      total += bytes;
      if (newline >= 0) break;
    }
    const first = Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
    return first ? JSON.parse(first) : null;
  } catch (_error) {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_error) { /* already closed */ }
    }
  }
}

// The session_meta payload when the entry is a well-formed session_meta line.
function sessionMetaOf(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.type !== 'session_meta') return null;
  const payload = entry.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

// The classified identity of a rollout file, or null when its first line is
// not a well-formed session_meta.
function readIdentity(filePath, fallbackPhysicalRecordId = null) {
  const meta = sessionMetaOf(readFirstLine(filePath));
  return meta ? classifyCodexSessionMeta(meta, fallbackPhysicalRecordId) : null;
}

// A user or assistant message: from the event stream (event_msg user_message /
// agent_message) or from a response item (only its input_text / output_text
// parts). { source: 'event' | 'item', role: 'user' | 'assistant', text } or null.
function messageOf(entry) {
  const payload = entry?.payload;
  if (entry?.type === 'event_msg' && typeof payload?.message === 'string') {
    if (payload.type === 'user_message') return { source: 'event', role: 'user', text: payload.message };
    if (payload.type === 'agent_message') return { source: 'event', role: 'assistant', text: payload.message };
    return null;
  }
  if (entry?.type === 'response_item' && payload?.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
    const kind = payload.role === 'user' ? 'input_text' : 'output_text';
    const parts = Array.isArray(payload.content) ? payload.content : [];
    const text = parts.filter((item) => item?.type === kind && typeof item.text === 'string').map((item) => item.text).join('\n');
    return { source: 'item', role: payload.role, text };
  }
  return null;
}

// The raw message of a response item ({ role, content: [parts] }), for readers
// that need its non-text parts (attachments).
function responseMessageOf(entry) {
  return entry?.type === 'response_item' && entry.payload?.type === 'message' ? entry.payload : null;
}

// The conversation as [{ kind: 'user' | 'assistant', text }]: the event stream
// when the rollout has one, otherwise the non-empty response items.
function conversationTurns(source) {
  const events = [];
  const items = [];
  for (const entry of entries(source)) {
    const message = messageOf(entry);
    if (!message) continue;
    if (message.source === 'event') events.push({ kind: message.role, text: message.text });
    else if (message.text.trim()) items.push({ kind: message.role, text: message.text });
  }
  return events.length ? events : items;
}

// The last assistant answer: the last agent_message event, otherwise the last
// non-empty assistant response item; null when there is none.
function lastAssistantText(source) {
  let fromEvents = null;
  let fromItems = null;
  for (const entry of entries(source)) {
    const message = messageOf(entry);
    if (message?.role !== 'assistant') continue;
    if (message.source === 'event') fromEvents = message.text;
    else if (message.text.trim()) fromItems = message.text;
  }
  return fromEvents ?? fromItems;
}

// Rate limits from a token_count event: { rateLimits, observedAt } or null.
function rateLimitsOf(entry) {
  const payload = entry && entry.payload;
  const rateLimits = payload && (payload.rate_limits || payload.rateLimits);
  if (payload?.type === 'token_count' && rateLimits && typeof rateLimits === 'object') {
    return { rateLimits, observedAt: entry.timestamp || entry.ts || null };
  }
  return null;
}

module.exports = {
  classifyCodexSessionMeta,
  hasSubagentSource,
  stableText,
  parseLine,
  entries,
  readFirstLine,
  sessionMetaOf,
  readIdentity,
  messageOf,
  responseMessageOf,
  conversationTurns,
  lastAssistantText,
  rateLimitsOf
};
