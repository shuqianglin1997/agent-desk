'use strict';

// Gemini CLI (`gemini -p`) as the hub's background run (see src/hub/adapters.js).

const fs = require('node:fs');
const geminiRecords = require('./records');
const { CLAUDE_FIXED_QUERY, bounded, documentParser, parsedLines, readRecordLines } = require('../hub-io');

// AgentDesk chooses the session ID (--session-id), so the ledger can point at
// the record from the start. Folder trust stays Gemini's own decision: in a
// folder Gemini does not trust it falls back to its default mode, where
// headless approvals are denied, so a write run becomes read-only there.
const gemini = Object.freeze({
  appId: 'gemini-cli',
  toolId: 'gemini',
  label: 'Gemini CLI',
  form: 'cli',
  presetSessionId: true,
  sources: Object.freeze([
    'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/headless.md',
    'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/cli/src/config/config.ts',
    'https://geminicli.com/docs/cli/cli-reference/'
  ]),
  facts: Object.freeze({
    prompt: 'Headless with -p; the -p text is appended to the input on stdin (config.ts: "Appended to input on stdin").',
    readOnly: '--approval-mode plan (config.ts: "plan (read-only mode)")',
    write: '--approval-mode auto_edit (auto-approve edit tools); shell still needs approval and is denied headless',
    end: 'Process exit: 0 success, 1 error, 42 input error, 53 turn limit (headless.md).',
    answer: 'response field of the single --output-format json object; error object on failure.',
    sessionRecord: 'Session ID chosen by Catshelf with --session-id; the record is found with the Gemini CLI scanner under GEMINI_CLI_HOME/.gemini/tmp.'
  }),
  args(access, context = {}) {
    return [
      '-p', CLAUDE_FIXED_QUERY,
      '--output-format', 'json',
      '--approval-mode', access === 'write' ? 'auto_edit' : 'plan',
      ...(context.sessionId ? ['--session-id', context.sessionId] : [])
    ];
  },
  createParser(_events = {}, context = {}) {
    const result = { sessionId: context.sessionId || null, answer: null, truncated: false, failed: false };
    const parser = documentParser((value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof value.response === 'string') {
          const answer = bounded(value.response);
          result.answer = answer.text;
          result.truncated = answer.truncated;
        }
        if (value.error) result.failed = true;
      }
      return result;
    });
    return { push: parser.push, end: parser.end };
  },
  lastAnswerFromRecord(filePath) {
    let document = null;
    if (filePath.endsWith('.json')) {
      try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_error) { document = null; }
    } else {
      document = parsedLines(readRecordLines(filePath));
    }
    const answer = geminiRecords.lastAnswerText(geminiRecords.messagesOf(document));
    return answer === null ? null : bounded(answer);
  }
});

module.exports = gemini;
