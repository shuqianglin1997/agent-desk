'use strict';

// Reading a background run's output and record for the hub (调度中枢): bounded
// answers, JSON-lines and whole-document parsers for a child's stdout, and
// bounded record reads. Nothing here names a client or starts a process; each
// client's ./<id>/hub.js fixes its own arguments and where its answer comes from.

const fs = require('node:fs');

// The fixed -p query for clients that read the actual prompt from standard input
// (Claude Code, Gemini CLI, Qwen Code); the prompt never goes into argv.
const CLAUDE_FIXED_QUERY = 'Carry out the request given on standard input.';

const MAX_ANSWER_CHARS = 200_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

function bounded(text) {
  const value = typeof text === 'string' ? text : '';
  return value.length > MAX_ANSWER_CHARS
    ? { text: value.slice(0, MAX_ANSWER_CHARS), truncated: true }
    : { text: value, truncated: false };
}

// A JSONL reader over a child's stdout. Lines longer than the cap are dropped
// rather than buffered without bound; nothing is logged.
function lineParser(onObject) {
  let pending = '';
  let skipping = false;
  function line(text) {
    if (!text.trim()) return;
    let value;
    try { value = JSON.parse(text); } catch (_error) { return; }
    if (value && typeof value === 'object') onObject(value);
  }
  return {
    push(chunk) {
      let text = chunk.toString('utf8');
      while (text.length) {
        const index = text.indexOf('\n');
        if (index < 0) {
          if (!skipping) pending += text;
          if (Buffer.byteLength(pending) > MAX_LINE_BYTES) { pending = ''; skipping = true; }
          return;
        }
        const head = text.slice(0, index);
        text = text.slice(index + 1);
        if (!skipping) line(pending + head);
        pending = '';
        skipping = false;
      }
    },
    end() {
      if (!skipping) line(pending);
      pending = '';
    }
  };
}

// One JSON document on stdout (an object or an array), read whole at the end.
function documentParser(onDocument) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  return {
    push(chunk) {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_LINE_BYTES) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(Buffer.from(chunk));
    },
    end() {
      if (tooLarge || !chunks.length) return onDocument(null);
      let value = null;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { value = null; }
      return onDocument(value);
    }
  };
}

// The parsed lines of a record, skipping the ones that are not JSON.
function parsedLines(lines) {
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch (_error) { /* half-written or damaged */ }
  }
  return records;
}

function readRecordLines(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('session-record-unavailable');
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

module.exports = { CLAUDE_FIXED_QUERY, MAX_ANSWER_CHARS, MAX_LINE_BYTES, MAX_RECORD_BYTES, bounded, lineParser, documentParser, parsedLines, readRecordLines };
