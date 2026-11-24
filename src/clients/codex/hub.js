'use strict';

// Codex CLI (`codex exec`) as the hub's background run (see src/hub/adapters.js).

const codexRollout = require('./rollout');
const { bounded, lineParser, readRecordLines } = require('../hub-io');

const codex = Object.freeze({
  appId: 'codex',
  toolId: 'codex',
  label: 'Codex CLI',
  form: 'cli',
  sources: Object.freeze([
    'https://learn.chatgpt.com/docs/non-interactive-mode',
    'https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/cli.rs',
    'https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs',
    'https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/lib.rs'
  ]),
  facts: Object.freeze({
    prompt: 'PROMPT "-" reads the instructions from stdin (cli.rs).',
    readOnly: '--sandbox read-only',
    write: '--sandbox workspace-write (writes inside the working directory)',
    end: 'Process exit; exit code 1 when an error was seen, turn.failed / error events mark failure.',
    answer: 'Last item.completed whose item.type is agent_message (field text) in the --json event stream.',
    sessionRecord: 'Thread ID from thread.started; the rollout is found by that ID with the Codex session scanner under CODEX_HOME.'
  }),
  // --skip-git-repo-check: the folder was allowed by the person in AgentDesk;
  // Codex otherwise refuses folders outside a Git repository.
  args(access) {
    return [
      'exec', '--json', '--color', 'never',
      '--sandbox', access === 'write' ? 'workspace-write' : 'read-only',
      '--skip-git-repo-check',
      '-'
    ];
  },
  createParser(events = {}) {
    const result = { sessionId: null, answer: null, truncated: false, failed: false };
    const parser = lineParser((event) => {
      if (event.type === 'thread.started' && typeof event.thread_id === 'string' && event.thread_id) {
        if (!result.sessionId) {
          result.sessionId = event.thread_id.slice(0, 200);
          events.onSession?.(result.sessionId);
        }
      } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        const answer = bounded(event.item.text);
        result.answer = answer.text;
        result.truncated = answer.truncated;
      } else if (event.type === 'turn.failed' || event.type === 'error') {
        result.failed = true;
      }
    });
    return { push: parser.push, end() { parser.end(); return result; } };
  },
  // The final answer from the client's own record: the last agent message.
  lastAnswerFromRecord(filePath) {
    const answer = codexRollout.lastAssistantText(readRecordLines(filePath));
    return answer === null ? null : bounded(answer);
  }
});

module.exports = codex;
