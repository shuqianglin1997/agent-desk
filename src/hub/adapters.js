'use strict';

/*
 * AgentDesk 调度中枢 — per-client background-run adapters.
 *
 * Each adapter fixes the whole argument list of the client's official
 * non-interactive mode. A caller only chooses an account, a title, an allowed
 * folder, read or write, and the prompt; the prompt always goes to the child's
 * standard input, never into argv. Nothing here starts a process.
 *
 * Every adapter records where its facts come from (checked 2026-11-24):
 * how the prompt is read, how read-only and write are expressed, how the end is
 * judged, where the final answer comes from and where the session record lives.
 */

const fs = require('node:fs');
const codexRollout = require('../clients/codex/rollout');
const geminiRecords = require('../clients/gemini-cli/records');
const qwenRecords = require('../clients/qwen-code/records');
const claudeRecords = require('../clients/claude-cli/records');

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

// ---------- Codex CLI: `codex exec` ----------

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

// ---------- Claude CLI: `claude -p` ----------

// The documented piped form is `cat file | claude -p "query"`. The fixed query
// below carries no content of its own; the person's prompt is the piped text.
const CLAUDE_FIXED_QUERY = 'Carry out the request given on standard input.';

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

// ---------- Gemini CLI: `gemini -p` ----------

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
    sessionRecord: 'Session ID chosen by AgentDesk with --session-id; the record is found with the Gemini CLI scanner under GEMINI_CLI_HOME/.gemini/tmp.'
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

// ---------- Qwen Code: `qwen -p` ----------

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

const ADAPTERS = Object.freeze({ codex, 'claude-cli': claudeCli, 'gemini-cli': gemini, 'qwen-code': qwen });

// Clients that cannot be called, and why. Desktop-only clients can only open a
// window; to be called, the same account needs its command-line client.
// Checked against official docs 2026-11-24:
// - Kimi Code takes the -p prompt only as an argument (no documented stdin), and
//   -p always runs with automatic permission, so there is no read-only run.
// - OpenCode `run` cannot be made read-only through its arguments: the plan
//   agent still allows shell commands, and permissions come from config files.
// - DSH headless documents no read-only permission preset (default is
//   workspace-write) and no event schema for its --json output.
const UNSUPPORTED = Object.freeze({
  claude: 'desktop-only',
  cursor: 'desktop-only',
  'kimi-work': 'desktop-only',
  kimi: 'prompt-argument-only',
  'dsh-cli': 'no-read-only-mode',
  opencode: 'no-read-only-mode'
});

function adapterFor(appId) {
  return Object.hasOwn(ADAPTERS, appId) ? ADAPTERS[appId] : null;
}

function unsupportedReason(appId) {
  if (adapterFor(appId)) return null;
  return Object.hasOwn(UNSUPPORTED, appId) ? UNSUPPORTED[appId] : 'not-verified-yet';
}

module.exports = { ADAPTERS, UNSUPPORTED, MAX_ANSWER_CHARS, CLAUDE_FIXED_QUERY, adapterFor, unsupportedReason, lineParser };
