// Characterisation (golden) test for the source CLI's JSON output: every
// read-only command, plus the documented failure codes, against a fixed temp
// data directory and an empty temp HOME, run in a child process exactly as an
// agent would. Machine-dependent parts (which launchers are installed) are
// reduced to their shape. Deliberate changes regenerate the golden:
//   AGENTDESK_UPDATE_GOLDEN=1 node --test test/characterisation-cli.test.js
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempDir } = require('./helpers/temp');

const GOLDEN = path.join(__dirname, 'fixtures', 'characterisation', 'cli.golden.json');
const UPDATE = process.env.AGENTDESK_UPDATE_GOLDEN === '1';
const CLI = path.join(__dirname, '..', 'src', 'automation', 'cli.js');
const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const at = (minutesBefore) => new Date(NOW - minutesBefore * 60000).toISOString();
const lines = (...records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';
const posixOnly = { skip: process.platform === 'win32' ? 'golden paths are POSIX' : false };

function write(file, body, minutesBefore = 10) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const seconds = (NOW - minutesBefore * 60000) / 1000;
  fs.utimesSync(file, seconds, seconds);
}

function build(root) {
  const home = path.join(root, 'home');
  const userData = path.join(root, 'AgentDesk');
  const codex = path.join(root, 'codex-home');
  const cli = path.join(root, 'claude-home');
  for (const dir of [home, userData, codex, cli]) fs.mkdirSync(dir, { recursive: true });
  const day = path.join(codex, 'sessions', '2026', '11', '24');
  write(path.join(day, 'rollout-2026-11-24T10-00-00-11111111-1111-4111-8111-111111111111.jsonl'), lines(
    { timestamp: at(120), type: 'session_meta', payload: { id: '11111111-1111-4111-8111-111111111111', session_id: '11111111-1111-4111-8111-111111111111', cwd: '/work/codex' } },
    { timestamp: at(119), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the module' }] } },
    { timestamp: at(2), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed in three files.' }] } },
    { timestamp: at(2), type: 'event_msg', payload: { type: 'task_complete' } }
  ), 2);
  write(path.join(day, 'rollout-2026-11-24T08-00-00-22222222-2222-4222-8222-222222222222.jsonl'), lines(
    { timestamp: at(300), type: 'session_meta', payload: { id: '22222222-2222-4222-8222-222222222222', cwd: '/work/other' } }
  ), 250);
  write(path.join(codex, 'session_index.jsonl'), lines({ id: '11111111-1111-4111-8111-111111111111', thread_name: 'Rename module', updated_at: at(90) }), 90);
  write(path.join(cli, 'projects', '-work-cli', 'a1.jsonl'), lines(
    { type: 'user', timestamp: at(60), cwd: '/work/cli', message: { role: 'user', content: 'Fix the parser' } },
    { type: 'ai-title', aiTitle: 'Parser fix' },
    { type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' } }
  ), 1);
  const profiles = [
    { id: 'codex-work', appId: 'codex', name: 'Work Codex', profilePath: codex, sessionRoot: codex, profilePathMode: 'custom', sessionRootMode: 'custom' },
    { id: 'claude-cli-home', appId: 'claude-cli', name: 'Home Claude CLI', profilePath: cli, sessionRoot: cli, profilePathMode: 'custom', sessionRootMode: 'custom' }
  ];
  write(path.join(userData, 'profiles.json'), JSON.stringify({ version: 2, profiles }));
  return { home, userData, codex };
}

function normalise(value, root) {
  let text = JSON.stringify(value);
  const real = fs.realpathSync(root);
  for (const prefix of [real, root].sort((a, b) => b.length - a.length)) text = text.split(JSON.stringify(prefix).slice(1, -1)).join('<root>');
  // scannedAt is the wall clock of the run.
  return JSON.parse(text, (key, item) => {
    if (key !== 'scannedAt') return item;
    assert.ok(Number.isFinite(Date.parse(item)));
    return '<scan time>';
  });
}

let root;
let paths;
let golden = {};
const produced = {};

test.before(() => {
  root = makeTempDir('agentdesk-characterisation-cli-');
  paths = build(root);
  if (fs.existsSync(GOLDEN)) golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
});

test.after(() => {
  if (UPDATE) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify({ ...golden, ...produced }, null, 2) + '\n');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: { PATH: process.env.PATH, HOME: paths.home, USERPROFILE: paths.home, TZ: 'UTC', LANG: 'C' }
  });
  return { exitCode: result.status, output: JSON.parse(result.stdout || 'null'), stderr: result.stderr };
}

const CASES = {
  capabilities: () => ['capabilities'],
  paths: () => ['paths'],
  apps: () => ['apps'],
  'profiles list': () => ['profiles', 'list', '--user-data', paths.userData],
  'profiles inspect': () => ['profiles', 'inspect', '--user-data', paths.userData, '--profile', 'codex-work'],
  'sessions list codex': () => ['sessions', 'list', '--user-data', paths.userData, '--profile', 'codex-work'],
  'sessions list claude-cli': () => ['sessions', 'list', '--user-data', paths.userData, '--profile', 'claude-cli-home'],
  'sessions list query and page': () => ['sessions', 'list', '--user-data', paths.userData, '--profile', 'codex-work', '--query', 'work', '--limit', '1', '--offset', '1'],
  'sessions locate': () => ['sessions', 'locate', '--user-data', paths.userData, '--profile', 'codex-work', '--session', '11111111-1111-4111-8111-111111111111'],
  'sessions read': () => ['sessions', 'read', '--user-data', paths.userData, '--profile', 'codex-work', '--session', '11111111-1111-4111-8111-111111111111', '--max-chars', '2000'],
  'integration plan': () => ['integration', 'plan', '--user-data', paths.userData, '--app', 'codex', '--profile-path', paths.codex, '--session-root', paths.codex],
  'error unknown command': () => ['launch'],
  'error unknown option': () => ['profiles', 'list', '--user-data', paths.userData, '--token', 'x'],
  'error missing option': () => ['sessions', 'list', '--user-data', paths.userData],
  'error unknown profile': () => ['profiles', 'inspect', '--user-data', paths.userData, '--profile', 'nobody'],
  'error unknown session': () => ['sessions', 'locate', '--user-data', paths.userData, '--profile', 'codex-work', '--session', 'missing']
};

for (const [name, args] of Object.entries(CASES)) {
  test(`CLI ${name} output is unchanged`, posixOnly, () => {
    const result = cli(args());
    assert.equal(result.stderr, '');
    const value = normalise({ exitCode: result.exitCode, output: result.output }, root);
    produced[name] = value;
    if (!UPDATE) {
      assert.ok(golden[name], `no golden for ${name}; run with AGENTDESK_UPDATE_GOLDEN=1 and review`);
      assert.deepEqual(value, golden[name]);
    }
  });
}

// Which launchers exist depends on the machine; the entry shape and tool list do not.
test('CLI tools lists every fixed launcher with the same entry shape', posixOnly, () => {
  const result = cli(['tools']);
  assert.equal(result.exitCode, 0);
  const shape = {
    ids: result.output.data.tools.map((tool) => tool.id),
    entryKeys: [...new Set(result.output.data.tools.map((tool) => Object.keys(tool).join(',')))]
  };
  produced.tools = shape;
  if (!UPDATE) assert.deepEqual(shape, golden.tools);
});
