'use strict';

// Qwen Code (`qwen -p`) as the hub's background run (see src/hub/adapters.js).

const qwenRecords = require('./records');
const { CLAUDE_FIXED_QUERY, bounded, documentParser, parsedLines, readRecordLines } = require('../hub-io');

const qwen = Object.freeze({
  appId: 'qwen-code',
  toolId: 'qwen-code',
  label: 'Qwen Code',
  form: 'cli',
  presetSessionId: true,
  sources: Object.freeze([
    'https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/headless.md',
    'https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/approval-mode.md',
    'https://raw.githubusercontent.com/QwenLM/qwen-code/main/packages/cli/src/config/top-level-options.ts',
    'https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/support/troubleshooting.md'
  ]),
  facts: Object.freeze({
    prompt: 'Headless with -p; the -p text is appended to the input on stdin (top-level-options.ts: "Appended to input on stdin").',
    readOnly: '--approval-mode plan ("Analyze only, do not modify files or execute commands")',
    write: '--approval-mode auto-edit (file edits approved; headless runs exclude shell by default)',
    end: 'Process exit; non-zero codes 1, 41, 42, 44, 52, 53, 55 on failures (troubleshooting.md, headless.md).',
    answer: 'result field of the last type "result" element of the --output-format json array.',
    sessionRecord: 'Session ID chosen by AgentDesk with --session-id; the record is under QWEN_HOME/projects/<cwd>/chats and found with the Qwen Code scanner.'
  }),
  args(access, context = {}) {
    return [
      '-p', CLAUDE_FIXED_QUERY,
      '--output-format', 'json',
      '--approval-mode', access === 'write' ? 'auto-edit' : 'plan',
      ...(context.sessionId ? ['--session-id', context.sessionId] : [])
    ];
  },
  createParser(_events = {}, context = {}) {
    const result = { sessionId: context.sessionId || null, answer: null, truncated: false, failed: false };
    const parser = documentParser((value) => {
      const items = Array.isArray(value) ? value : [];
      const last = [...items].reverse().find((item) => item?.type === 'result');
      if (last) {
        if (typeof last.result === 'string') {
          const answer = bounded(last.result);
          result.answer = answer.text;
          result.truncated = answer.truncated;
        }
        if (last.is_error === true || (typeof last.subtype === 'string' && last.subtype !== 'success')) result.failed = true;
      }
      const id = items.find((item) => typeof item?.session_id === 'string' && item.session_id)?.session_id;
      if (!result.sessionId && id) result.sessionId = id.slice(0, 200);
      return result;
    });
    return { push: parser.push, end: parser.end };
  },
  lastAnswerFromRecord(filePath) {
    const answer = qwenRecords.lastAnswerText(parsedLines(readRecordLines(filePath)));
    return answer === null ? null : bounded(answer);
  }
});

module.exports = qwen;
