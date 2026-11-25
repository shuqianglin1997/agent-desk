'use strict';

// 调度中枢: adapters, roster, store and the Main relay, exercised with stub
// executables in place of the official clients. No real client is started.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ADAPTERS, CLAUDE_FIXED_QUERY, adapterFor, unsupportedReason } = require('../src/hub/adapters');
const { buildRoster, resolveAgent, resolveAllowedCwd, parseDepth, normalizeAccess, HubError } = require('../src/hub/roster');
const { HubStore } = require('../src/hub/store');
const { HubRunner } = require('../src/hub/runner');
const { createAgentHub } = require('../src/main/agent-hub');
const apps = require('../src/apps');
const { makeTempDir } = require('./helpers/temp');

const PROMPT = 'PROMPT-SENTINEL-7d1f please review the change';
const ANSWER = 'ANSWER-SENTINEL-93ab looks fine';

const STUB = `
const fs = require('node:fs');
const crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const mode = process.env.STUB_MODE || 'ok';
  fs.writeFileSync(process.env.STUB_REPORT, JSON.stringify({
    argv: process.argv.slice(2), cwd: process.cwd(),
    stdinHash: crypto.createHash('sha256').update(input).digest('hex'),
    env: {
      CODEX_HOME: process.env.CODEX_HOME || null, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || null,
      CODEX_API_KEY: process.env.CODEX_API_KEY || null, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
      AGENTDESK_HUB_DEPTH: process.env.AGENTDESK_HUB_DEPTH || null, AGENTDESK_HUB_RUN: process.env.AGENTDESK_HUB_RUN || null
    }
  }));
  const claude = process.argv.includes('-p') && !process.argv.includes('--approval-mode');
  const flavor = process.argv.includes('--approval-mode') ? (process.env.QWEN_HOME ? 'qwen' : 'gemini') : null;
  if (flavor && mode === 'ok') {
    const sid = process.argv[process.argv.indexOf('--session-id') + 1];
    if (flavor === 'gemini') process.stdout.write(JSON.stringify({ response: process.env.STUB_ANSWER, stats: {} }));
    else process.stdout.write(JSON.stringify([{ type: 'system', subtype: 'session_start', session_id: sid }, { type: 'assistant', session_id: sid }, { type: 'result', subtype: 'success', result: process.env.STUB_ANSWER, session_id: sid }]));
    return;
  }
  if (mode === 'sleep') { process.stdout.write(JSON.stringify(claude ? { type: 'system', subtype: 'init', session_id: 'sess-sleep' } : { type: 'thread.started', thread_id: 'thread-sleep' }) + '\\n'); setInterval(() => {}, 1000); return; }
  if (mode === 'fail') { process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } }) + '\\n'); process.exit(1); }
  if (claude) {
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: process.env.STUB_ANSWER, session_id: 'sess-1' }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'draft' } }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: process.env.STUB_ANSWER } }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n');
  }
});
`;

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function poll() {
      let value;
      try { value = predicate(); } catch (_error) { value = null; }
      if (value) { resolve(value); return; }
      if (Date.now() > deadline) { reject(new Error('timeout')); return; }
      setTimeout(poll, 20);
    })();
  });
}

function setup(t, options = {}) {
  const root = makeTempDir('agentdesk-hub-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'userData');
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  const reports = path.join(root, 'reports');
  for (const dir of [userData, project, outside, reports]) fs.mkdirSync(dir, { recursive: true });
  const stub = path.join(root, 'stub.js');
  fs.writeFileSync(stub, STUB);
  const profiles = options.profiles || [
    { id: 'codex-work', appId: 'codex', name: 'Work', sessionRoot: path.join(root, 'codex-home'), hub: { callable: true } },
    { id: 'claude-me', appId: 'claude-cli', name: 'Me', sessionRoot: path.join(root, 'claude-home'), hub: { callable: true, writable: true } },
    { id: 'codex-off', appId: 'codex', name: 'Hidden', sessionRoot: path.join(root, 'codex-off') }
  ];
  for (const profile of profiles) fs.mkdirSync(profile.sessionRoot, { recursive: true });
  const env = { STUB_REPORT: path.join(reports, 'last.json'), STUB_ANSWER: ANSWER, STUB_MODE: options.mode || 'ok', CODEX_API_KEY: 'sk-inherited', ANTHROPIC_API_KEY: 'sk-ant-inherited', PATH: process.env.PATH };
  const store = new HubStore({ file: path.join(userData, 'agent-hub.json') });
  store.addFolder(project);
  const runner = new HubRunner({ store, killGraceMs: 300, locateSession: options.locateSession || (() => null) });
  const energy = options.energy || (() => 'unknown');
  const hub = createAgentHub({
    store,
    runner,
    loadProfiles: () => profiles,
    catNames: () => new Map(options.names || []),
    findLauncher: (toolId) => (options.noLauncher ? null : { command: process.execPath, prefixArgs: [stub], extraEnv: {}, toolId }),
    signInState: async () => options.signedIn ?? true,
    energyPeek: energy,
    energyCheck: async (profile) => energy(profile),
    baseEnv: () => env,
    launchEnv: (profile, base) => apps.getApp(profile.appId).launchEnv(profile, base)
  });
  return { root, userData, project, outside, reports, stub, store, runner, hub, env, profiles, report: () => JSON.parse(fs.readFileSync(env.STUB_REPORT, 'utf8')) };
}

function allFilesText(directory) {
  let text = '';
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    text += entry.isDirectory() ? allFilesText(full) : fs.readFileSync(full, 'utf8');
  }
  return text;
}

test('adapters fix their whole argument list and record their official sources', () => {
  for (const adapter of Object.values(ADAPTERS)) {
    assert.ok(adapter.sources.length >= 2 && adapter.sources.every((url) => url.startsWith('https://')));
    for (const key of ['prompt', 'readOnly', 'write', 'end', 'answer', 'sessionRecord']) assert.equal(typeof adapter.facts[key], 'string');
    for (const access of ['read', 'write']) {
      const args = adapter.args(access);
      assert.ok(args.every((arg) => typeof arg === 'string' && !arg.includes(PROMPT)));
    }
  }
  assert.deepEqual(ADAPTERS.codex.args('read'), ['exec', '--json', '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
  assert.ok(ADAPTERS.codex.args('write').includes('workspace-write'));
  const claudeRead = ADAPTERS['claude-cli'].args('read');
  assert.deepEqual(claudeRead.slice(0, 2), ['-p', CLAUDE_FIXED_QUERY]);
  assert.ok(claudeRead.includes('dontAsk') && claudeRead.includes('Edit,Write,NotebookEdit'));
  assert.ok(ADAPTERS['claude-cli'].args('write').includes('acceptEdits'));
  assert.equal(unsupportedReason('claude'), 'desktop-only');
  assert.equal(unsupportedReason('cursor'), 'desktop-only');
  assert.equal(unsupportedReason('kimi-work'), 'desktop-only');
  assert.equal(adapterFor('claude'), null);
});

test('stream parsers take the session ID early and the last reply at the end', () => {
  const seen = [];
  const codex = ADAPTERS.codex.createParser({ onSession: (id) => seen.push(id) });
  codex.push(Buffer.from('{"type":"thread.started","thread_id":"t-1"}\n{"type":"item.completed","item":{"type":"agent_message","text":"a"}}\n{"type":"item.comp'));
  codex.push(Buffer.from('leted","item":{"type":"agent_message","text":"final"}}\nnot json\n'));
  assert.deepEqual(codex.end(), { sessionId: 't-1', answer: 'final', truncated: false, failed: false });
  const failed = ADAPTERS.codex.createParser();
  failed.push(Buffer.from('{"type":"turn.failed","error":{"message":"x"}}\n'));
  assert.equal(failed.end().failed, true);
  const claude = ADAPTERS['claude-cli'].createParser({ onSession: (id) => seen.push(id) });
  claude.push(Buffer.from('{"type":"system","subtype":"init","session_id":"s-9"}\n{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"s-9"}'));
  assert.deepEqual(claude.end(), { sessionId: 's-9', answer: 'done', truncated: false, failed: false });
  const claudeError = ADAPTERS['claude-cli'].createParser();
  claudeError.push(Buffer.from('{"type":"result","subtype":"error_max_turns","is_error":true}\n'));
  assert.equal(claudeError.end().failed, true);
  assert.deepEqual(seen, ['t-1', 's-9']);
});

test('the final reply can be read back from each client\'s own session record', (t) => {
  const root = makeTempDir('agentdesk-hub-record-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexFile = path.join(root, 'rollout.jsonl');
  fs.writeFileSync(codexFile, [
    { type: 'session_meta', payload: { id: 'thread-1' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'question' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'first' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'last answer' } }
  ].map((line) => JSON.stringify(line)).join('\n'));
  assert.deepEqual(ADAPTERS.codex.lastAnswerFromRecord(codexFile), { text: 'last answer', truncated: false });
  const claudeFile = path.join(root, 'session.jsonl');
  fs.writeFileSync(claudeFile, [
    { type: 'user', message: { content: 'q' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'side' }] }, isSidechain: true },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'claude answer' }] } }
  ].map((line) => JSON.stringify(line)).join('\n'));
  assert.deepEqual(ADAPTERS['claude-cli'].lastAnswerFromRecord(claudeFile), { text: 'claude answer', truncated: false });
});

test('only switched-on accounts appear; names resolve to one exact account or return candidates', () => {
  const profiles = [
    { id: 'a', appId: 'codex', name: 'Slot A', hub: { callable: true } },
    { id: 'b', appId: 'claude-cli', name: 'Slot B', hub: { callable: true, writable: true } },
    { id: 'c', appId: 'claude-cli', name: 'Slot C', hub: { callable: true } },
    { id: 'd', appId: 'codex', name: 'Off' },
    { id: 'e', appId: 'codex', name: 'Off too', hub: { callable: false, writable: true } }
  ];
  assert.deepEqual(normalizeAccess({ writable: true }), { callable: false, writable: false });
  const roster = buildRoster(profiles, {
    names: new Map([['a', 'Mochi'], ['b', 'Tofu'], ['c', 'tofu ']]),
    launcherFound: () => true,
    energy: (profile) => (profile.id === 'a' ? 'exhausted' : 'fresh'),
    busy: (id) => id === 'c'
  });
  assert.deepEqual(roster.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(roster[0].blockers, ['quota-exhausted']);
  assert.equal(roster[1].access, 'read-write');
  assert.equal(roster[2].busy, true);
  assert.equal(resolveAgent(roster, 'mochi').id, 'a');
  assert.equal(resolveAgent(roster, 'c').id, 'c');
  assert.throws(() => resolveAgent(roster, 'Tofu'), (error) => error.code === 'agent-ambiguous'
    && error.details.length === 2 && error.details.every((item) => item.id && item.name && item.app));
  assert.throws(() => resolveAgent(roster, 'Off'), (error) => error.code === 'agent-not-found');
  assert.throws(() => resolveAgent(roster, 'd'), (error) => error.code === 'agent-not-found');
});

test('the working directory must sit inside an allowed folder, including through symbolic links', (t) => {
  const root = fs.realpathSync.native(makeTempDir('agentdesk-hub-cwd-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'allowed');
  const nested = path.join(allowed, 'src');
  const other = path.join(root, 'other');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(allowed, 'escape'));
  const folders = [{ id: 'f1', path: allowed }];
  assert.deepEqual(resolveAllowedCwd(nested, folders), { cwd: nested, folderId: 'f1' });
  assert.throws(() => resolveAllowedCwd(other, folders), (error) => error.code === 'cwd-not-allowed');
  assert.throws(() => resolveAllowedCwd(path.join(allowed, 'escape'), folders), (error) => error.code === 'cwd-not-allowed');
  assert.throws(() => resolveAllowedCwd(path.join(allowed, '..', 'other'), folders), (error) => error.code === 'cwd-not-allowed');
  assert.throws(() => resolveAllowedCwd('relative/dir', folders), (error) => error.code === 'cwd-invalid');
  assert.throws(() => resolveAllowedCwd(path.join(allowed, 'missing'), folders), (error) => error.code === 'cwd-missing');
  assert.equal(parseDepth(undefined), 0);
  assert.equal(parseDepth('1'), 1);
  assert.equal(parseDepth('nonsense'), 2);
});

test('a run is relayed with a fixed argument list, the prompt on stdin and the account\'s own environment', async (t) => {
  const h = setup(t);
  const started = await h.hub.startRun({ agent: 'codex-work', title: 'Review the change', cwd: h.project, from: 'Claude personal', prompt: PROMPT });
  assert.equal(started.target.id, 'codex-work');
  assert.match(started.id, /^run-/);
  const done = await waitFor(() => {
    const status = h.hub.status(started.id);
    return status.state === 'completed' ? status : null;
  });
  assert.equal(done.from, 'Claude personal');
  assert.equal(done.session.id, 'thread-1');
  const report = h.report();
  assert.deepEqual(report.argv, ADAPTERS.codex.args('read'));
  assert.equal(report.stdinHash, sha(PROMPT));
  assert.equal(fs.realpathSync.native(report.cwd), fs.realpathSync.native(h.project));
  assert.equal(report.env.CODEX_HOME, h.profiles[0].sessionRoot);
  assert.equal(report.env.CODEX_API_KEY, null);
  assert.equal(report.env.AGENTDESK_HUB_DEPTH, '1');
  assert.equal(report.env.AGENTDESK_HUB_RUN, started.id);
  const output = h.hub.output(started.id);
  assert.equal(output.answer, ANSWER);
  assert.equal(output.source, 'client-output');
  // Neither the prompt nor the answer is written anywhere in AgentDesk's data.
  const stored = allFilesText(h.userData);
  assert.equal(stored.includes('PROMPT-SENTINEL'), false);
  assert.equal(stored.includes('ANSWER-SENTINEL'), false);
  assert.match(stored, /Review the change/);
});

test('Claude CLI runs read-only by default and write only when both sides allow it', async (t) => {
  const h = setup(t);
  const readRun = await h.hub.startRun({ agent: 'Me', title: 'Read', cwd: h.project, prompt: PROMPT });
  await waitFor(() => h.hub.status(readRun.id).state === 'completed');
  let report = h.report();
  assert.deepEqual(report.argv, ADAPTERS['claude-cli'].args('read'));
  assert.equal(report.env.CLAUDE_CONFIG_DIR, h.profiles[1].sessionRoot);
  assert.equal(report.env.ANTHROPIC_API_KEY, null);
  assert.equal(h.hub.output(readRun.id).answer, ANSWER);
  const writeRun = await h.hub.startRun({ agent: 'claude-me', title: 'Write', cwd: h.project, prompt: PROMPT, access: 'write' });
  await waitFor(() => h.hub.status(writeRun.id).state === 'completed');
  report = h.report();
  assert.deepEqual(report.argv, ADAPTERS['claude-cli'].args('write'));
  await assert.rejects(h.hub.startRun({ agent: 'codex-work', title: 'W', cwd: h.project, prompt: PROMPT, access: 'write' }), (error) => error.code === 'write-not-allowed');
});

test('refusals are immediate: nothing is queued, retried or sent to another account', async (t) => {
  const h = setup(t, { mode: 'sleep' });
  const base = { title: 'T', cwd: h.project, prompt: PROMPT };
  await assert.rejects(h.hub.startRun({ ...base, agent: 'Hidden' }), (error) => error.code === 'agent-not-found');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-off' }), (error) => error.code === 'agent-not-found');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-work', cwd: h.outside }), (error) => error.code === 'cwd-not-allowed');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-work', depth: '2' }), (error) => error.code === 'depth-limit');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-work', prompt: '  ' }), (error) => error.code === 'prompt-required');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-work', title: '' }), (error) => error.code === 'title-required');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'codex-work', access: 'admin' }), (error) => error.code === 'access-invalid');
  assert.equal(h.store.runs().length, 0);

  const nested = await h.hub.startRun({ ...base, agent: 'codex-work', depth: '1' });
  await waitFor(() => h.hub.status(nested.id).state === 'running' && fs.existsSync(h.env.STUB_REPORT));
  assert.equal(h.report().env.AGENTDESK_HUB_DEPTH, '2');
  await assert.rejects(h.hub.startRun({ ...base, agent: 'Work' }), (error) => error.code === 'agent-busy');
  h.store.setMaxConcurrent(1);
  await assert.rejects(h.hub.startRun({ ...base, agent: 'Me' }), (error) => error.code === 'run-limit');
  assert.equal(h.store.runs().length, 1);
  const stopped = await h.hub.stop(nested.id);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.reasonCode, 'stopped-by-person');
  assert.equal(h.runner.activeCount(), 0);
});

test('an account that is out of quota, signed out or missing its client takes no run', async (t) => {
  const exhausted = setup(t, { energy: () => 'exhausted' });
  await assert.rejects(exhausted.hub.startRun({ agent: 'codex-work', title: 'T', cwd: exhausted.project, prompt: PROMPT }), (error) => error.code === 'quota-exhausted');
  const list = await exhausted.hub.agentsList();
  assert.deepEqual(list.agents.map((entry) => entry.id), ['codex-work', 'claude-me']);
  assert.equal(list.agents[0].energy, 'exhausted');
  assert.equal(list.agents[0].ready, false);
  assert.equal(JSON.stringify(list).includes('sk-'), false);
  const signedOut = setup(t, { signedIn: false });
  await assert.rejects(signedOut.hub.startRun({ agent: 'codex-work', title: 'T', cwd: signedOut.project, prompt: PROMPT }), (error) => error.code === 'not-signed-in');
  const missing = setup(t, { noLauncher: true });
  await assert.rejects(missing.hub.startRun({ agent: 'codex-work', title: 'T', cwd: missing.project, prompt: PROMPT }), (error) => error.code === 'client-missing');
});

test('failed runs and stop-all on quit are recorded; a restart marks leftovers interrupted', async (t) => {
  const h = setup(t, { mode: 'fail' });
  const failed = await h.hub.startRun({ agent: 'codex-work', title: 'Fails', cwd: h.project, prompt: PROMPT });
  const record = await waitFor(() => {
    const status = h.hub.status(failed.id);
    return status.state === 'failed' ? status : null;
  });
  assert.equal(record.reasonCode, 'client-reported-error');

  const sleeping = setup(t, { mode: 'sleep' });
  const first = await sleeping.hub.startRun({ agent: 'codex-work', title: 'One', cwd: sleeping.project, prompt: PROMPT });
  const second = await sleeping.hub.startRun({ agent: 'claude-me', title: 'Two', cwd: sleeping.project, prompt: PROMPT });
  await waitFor(() => sleeping.hub.status(second.id).state === 'running');
  const result = await sleeping.hub.stopAll('app-quit');
  assert.equal(result.ok, true);
  assert.equal(sleeping.hub.status(first.id).reasonCode, 'app-quit');
  assert.equal(sleeping.hub.status(second.id).state, 'stopped');

  // A record left active by a crash is closed when the store is next loaded.
  const stale = new HubStore({ file: path.join(sleeping.userData, 'stale.json') });
  stale.putRun({ id: stale.newRunId(), title: 'x', target: { profileId: 'p', app: 'codex', name: 'n' }, state: 'running', createdAt: new Date().toISOString() });
  const reloaded = new HubStore({ file: path.join(sleeping.userData, 'stale.json') });
  assert.equal(reloaded.runs()[0].state, 'failed');
  assert.equal(reloaded.runs()[0].reasonCode, 'interrupted');
});

test('after a restart the answer is read back from the client\'s own session record', async (t) => {
  const record = path.join(os.tmpdir(), `agentdesk-hub-rollout-${process.pid}.jsonl`);
  fs.writeFileSync(record, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'from the record' } }));
  t.after(() => fs.rmSync(record, { force: true }));
  const h = setup(t, { locateSession: (profile, sessionId) => (sessionId === 'thread-1' ? record : null) });
  const run = await h.hub.startRun({ agent: 'codex-work', title: 'T', cwd: h.project, prompt: PROMPT });
  await waitFor(() => h.hub.status(run.id).state === 'completed');
  assert.equal(h.hub.status(run.id).session.recordFound, true);
  const restarted = createAgentHub({
    store: new HubStore({ file: path.join(h.userData, 'agent-hub.json') }),
    runner: new HubRunner({ store: new HubStore({ file: null }) }),
    loadProfiles: () => h.profiles
  });
  const output = restarted.output(run.id);
  assert.equal(output.answer, 'from the record');
  assert.equal(output.source, 'session-record');
  assert.throws(() => restarted.output('run-00000000-0000-0000-0000-000000000000'), HubError);
});

test('removing an account stops its active run', async (t) => {
  const h = setup(t, { mode: 'sleep' });
  const run = await h.hub.startRun({ agent: 'codex-work', title: 'T', cwd: h.project, prompt: PROMPT });
  await waitFor(() => h.hub.status(run.id).state === 'running');
  await h.hub.profilesChanged(h.profiles.filter((profile) => profile.id !== 'codex-work'));
  assert.equal(h.hub.status(run.id).reasonCode, 'account-removed');
});

test('cat names come from the signed catalog read without keys or writes', (t) => {
  const { MeshService } = require('../src/mesh/main/mesh-service');
  const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
  const directory = makeTempDir('agentdesk-hub-names-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const protector = {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`p:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^p:/, ''), 'base64').toString()
  };
  const profiles = [{ id: 'slot-a', appId: 'claude-cli', name: 'slot-a', identityFingerprint: 'acct-a', profilePathMode: 'managed', sessionRootMode: 'managed' }];
  const service = new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'mesh-keys.json'), protector),
    profilesProvider: () => profiles,
    sessionCountProvider: () => 0,
    appVersion: 'test', platform: 'darwin', arch: 'arm64', osVersion: 'test', hostname: 'Hub-Test.local',
    now: () => '2026-11-24T08:00:00.000Z'
  });
  assert.equal(service.localAgentNames().size, 0);
  const overview = service.initialize();
  const agent = overview.agents[0];
  const before = fs.statSync(path.join(directory, 'mesh.db')).mtimeMs;
  const names = service.localAgentNames();
  assert.equal(names.get('slot-a'), agent.displayName);
  assert.equal(fs.statSync(path.join(directory, 'mesh.db')).mtimeMs, before);
});

test('the caller is placed on a cat only from facts AgentDesk observed', async (t) => {
  const { resolveCallerProfile } = require('../src/hub/roster');
  const root = fs.realpathSync(makeTempDir('agentdesk-hub-caller-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'codex-home');
  const claudeHome = path.join(root, 'claude-home');
  fs.mkdirSync(codexHome);
  fs.mkdirSync(claudeHome);
  fs.symlinkSync(codexHome, path.join(root, 'codex-link'));
  const profiles = [{ id: 'cx', appId: 'codex', sessionRoot: codexHome }, { id: 'cl', appId: 'claude-cli', sessionRoot: claudeHome }];
  const homeFor = (profile, key) => ({ codex: 'CODEX_HOME', 'claude-cli': 'CLAUDE_CONFIG_DIR' }[profile.appId] === key ? profile.sessionRoot : null);
  assert.equal(resolveCallerProfile({ CODEX_HOME: path.join(root, 'codex-link') }, profiles, { homeFor }), 'cx');
  assert.equal(resolveCallerProfile({ CLAUDE_CONFIG_DIR: claudeHome }, profiles, { homeFor }), 'cl');
  // Two different accounts claimed at once: not placed.
  assert.equal(resolveCallerProfile({ CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome }, profiles, { homeFor }), null);
  assert.equal(resolveCallerProfile({ CODEX_HOME: 'relative/home' }, profiles, { homeFor }), null);
  assert.equal(resolveCallerProfile({ PATH: codexHome }, profiles, { homeFor }), null);
  assert.equal(resolveCallerProfile({}, profiles, { homeFor }), null);

  const h = setup(t, { mode: 'sleep' });
  const viaHome = createAgentHub({
    store: h.store, runner: h.runner, loadProfiles: () => h.profiles,
    findLauncher: () => ({ command: process.execPath, prefixArgs: [h.stub], extraEnv: {} }),
    signInState: async () => true, baseEnv: () => h.env,
    launchEnv: (profile, base) => apps.getApp(profile.appId).launchEnv(profile, base),
    callerHomeFor: (profile, key) => (profile.appId === 'claude-cli' && key === 'CLAUDE_CONFIG_DIR' ? profile.sessionRoot : null)
  });
  const placed = await viaHome.startRun({ agent: 'codex-work', title: 'T', cwd: h.project, prompt: PROMPT, from: 'my label', callerHomes: { CLAUDE_CONFIG_DIR: h.profiles[1].sessionRoot } });
  assert.deepEqual(placed.caller, { id: 'claude-me', via: 'account-home' });
  assert.equal(placed.from, 'my label');
  const nested = await viaHome.startRun({ agent: 'claude-me', title: 'N', cwd: h.project, prompt: PROMPT, depth: '1', parentRunId: placed.id, callerHomes: { CLAUDE_CONFIG_DIR: h.profiles[1].sessionRoot } });
  assert.deepEqual(nested.caller, { id: 'codex-work', via: 'parent-run' });
  const unplaced = await viaHome.startRun({ agent: 'Hidden', title: 'X', cwd: h.project, prompt: PROMPT }).catch((error) => error);
  assert.equal(unplaced.code, 'agent-not-found');
  await h.hub.stopAll('test');
});

test('Gemini CLI and Qwen Code: fixed arguments, AgentDesk-chosen session ID and JSON results', async (t) => {
  const gemini = ADAPTERS['gemini-cli'];
  const qwen = ADAPTERS['qwen-code'];
  assert.deepEqual(gemini.args('read', { sessionId: 's-1' }), ['-p', CLAUDE_FIXED_QUERY, '--output-format', 'json', '--approval-mode', 'plan', '--session-id', 's-1']);
  assert.ok(gemini.args('write').includes('auto_edit') && !gemini.args('write').includes('--skip-trust'));
  assert.deepEqual(qwen.args('read', { sessionId: 's-2' }), ['-p', CLAUDE_FIXED_QUERY, '--output-format', 'json', '--approval-mode', 'plan', '--session-id', 's-2']);
  assert.ok(qwen.args('write').includes('auto-edit'));
  const g = gemini.createParser({}, { sessionId: 'g-1' });
  g.push(Buffer.from('{"response":"gem'));
  g.push(Buffer.from('ini says hi","stats":{}}'));
  assert.deepEqual(g.end(), { sessionId: 'g-1', answer: 'gemini says hi', truncated: false, failed: false });
  const gFail = gemini.createParser({}, { sessionId: 'g-2' });
  gFail.push(Buffer.from('{"error":{"type":"x","message":"y"}}'));
  assert.equal(gFail.end().failed, true);
  const q = qwen.createParser({}, {});
  q.push(Buffer.from(JSON.stringify([{ type: 'system', subtype: 'session_start', session_id: 'q-9' }, { type: 'result', subtype: 'success', result: 'qwen done', session_id: 'q-9' }])));
  assert.deepEqual(q.end(), { sessionId: 'q-9', answer: 'qwen done', truncated: false, failed: false });
  const qFail = qwen.createParser({}, { sessionId: 'q-1' });
  qFail.push(Buffer.from('[{"type":"result","subtype":"error_max_turns","is_error":true}]'));
  assert.equal(qFail.end().failed, true);
  assert.equal(qwen.createParser({}, {}).end().answer, null);

  const root = makeTempDir('agentdesk-hub-b4-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const geminiFile = path.join(root, 'session-x.jsonl');
  fs.writeFileSync(geminiFile, [{ sessionId: 's' }, { type: 'user', content: [{ text: 'q' }] }, { type: 'gemini', content: [{ text: 'thinking', thought: true }, { text: 'final gemini' }] }].map((l) => JSON.stringify(l)).join('\n'));
  assert.deepEqual(gemini.lastAnswerFromRecord(geminiFile), { text: 'final gemini', truncated: false });
  const qwenFile = path.join(root, 'q.jsonl');
  fs.writeFileSync(qwenFile, [{ type: 'user', message: { parts: [{ text: 'q' }] } }, { type: 'assistant', isSidechain: true, message: { parts: [{ text: 'side' }] } }, { type: 'assistant', message: { parts: [{ text: 'final qwen' }] } }].map((l) => JSON.stringify(l)).join('\n'));
  assert.deepEqual(qwen.lastAnswerFromRecord(qwenFile), { text: 'final qwen', truncated: false });
  assert.equal(unsupportedReason('kimi'), 'prompt-argument-only');
  assert.equal(unsupportedReason('opencode'), 'no-read-only-mode');
  assert.equal(unsupportedReason('dsh-cli'), 'no-read-only-mode');

  const h = setup(t, { profiles: [
    { id: 'gem', appId: 'gemini-cli', name: 'Gem', sessionRoot: path.join(root, 'gem-home', '.gemini'), hub: { callable: true } },
    { id: 'qw', appId: 'qwen-code', name: 'Qw', sessionRoot: path.join(root, 'qwen-home'), hub: { callable: true } }
  ] });
  for (const agent of ['Gem', 'Qw']) {
    const run = await h.hub.startRun({ agent, title: agent, cwd: h.project, prompt: PROMPT });
    assert.match(run.session.id, /^[0-9a-f-]{36}$/);
    await waitFor(() => h.hub.status(run.id).state === 'completed');
    const report = h.report();
    assert.equal(report.argv[report.argv.indexOf('--session-id') + 1], run.session.id);
    assert.equal(report.stdinHash, sha(PROMPT));
    assert.equal(h.hub.output(run.id).answer, ANSWER);
  }
  assert.equal(h.report().env.CODEX_HOME, null);
});

