'use strict';

// Claude Code (`claude -p`) as the hub's background run (see src/hub/adapters.js).

const claudeRecords = require('./records');
const { CLAUDE_FIXED_QUERY, bounded, lineParser, parsedLines, readRecordLines } = require('../hub-io');

// The documented piped form is `cat file | claude -p "query"`. The fixed query
// below carries no content of its own; the person's prompt is the piped text.

const claudeCli = Object.freeze({
  appId: 'claude-cli',
  toolId: 'claude',
  label: 'Claude Code',
  form: 'cli',
  sources: Object.freeze([
    'https://code.claude.com/docs/en/headless',
    'https://code.claude.com/docs/en/cli-reference',
    'https://code.claude.com/docs/en/permission-modes',
    'https://code.claude.com/docs/en/sessions',
    'https://code.claude.com/docs/en/agent-sdk/typescript'
  ]),
  facts: Object.freeze({
    prompt: 'Piped stdin with a fixed query (cli-reference: cat file | claude -p "query" processes piped content).',
    readOnly: '--permission-mode dontAsk (auto-denies anything that would prompt) and --disallowedTools Edit,Write,NotebookEdit',
    write: '--permission-mode acceptEdits (file edits in the working directory; other approvals are denied in -p)',
    end: 'Process exit: 0 on success, non-zero on failure (143 on SIGTERM); the last stream-json line is the result message.',
    answer: 'result field of the final type "result" message (--output-format stream-json --verbose).',
    sessionRecord: 'session_id from the stream; the transcript is <CLAUDE_CONFIG_DIR>/projects/<cwd with non-alphanumerics as ->/<session-id>.jsonl, found with the Claude CLI scanner.'
  }),
  args(access) {
    return [
      '-p', CLAUDE_FIXED_QUERY,
      '--output-format', 'stream-json', '--verbose',
      ...(access === 'write'
        ? ['--permission-mode', 'acceptEdits']
        : ['--permission-mode', 'dontAsk', '--disallowedTools', 'Edit,Write,NotebookEdit'])
    ];
  },
  createParser(events = {}) {
    const result = { sessionId: null, answer: null, truncated: false, failed: false };
    const parser = lineParser((event) => {
      if (typeof event.session_id === 'string' && event.session_id && !result.sessionId) {
        result.sessionId = event.session_id.slice(0, 200);
        events.onSession?.(result.sessionId);
      }
      if (event.type === 'result') {
        if (typeof event.result === 'string') {
          const answer = bounded(event.result);
          result.answer = answer.text;
          result.truncated = answer.truncated;
        }
        if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success')) result.failed = true;
      }
    });
    return { push: parser.push, end() { parser.end(); return result; } };
  },
  lastAnswerFromRecord(filePath) {
    const answer = claudeRecords.lastAnswerText(parsedLines(readRecordLines(filePath)));
    return answer === null ? null : bounded(answer);
  }
});

module.exports = claudeCli;
