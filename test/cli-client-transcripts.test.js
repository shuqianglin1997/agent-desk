const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const apps = require('../src/apps');
const { makeTempDir } = require('./helpers/temp');
const transcripts = {
  ...require('../src/clients/gemini-cli/transcript'),
  ...require('../src/clients/qwen-code/transcript')
};
const { scanDsh } = require('../src/clients/dsh-cli/sessions');
const { scanOpenCode } = require('../src/clients/opencode/sessions');
const credentials = require('../src/account-credentials');
const credentialImport = require('../src/credential-import');
const { createRecruitItems } = require('../src/main/recruit-items');

const SECRET = 'sk-SENTINELexport0123456789abcdef';
const posixOnly = { skip: process.platform === 'win32' ? 'shell stubs stand in for the official clients on POSIX' : false };

function tmp(t) {
  const root = fs.realpathSync.native(makeTempDir('agentdesk-cli-transcripts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const lines = (...records) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

test('OpenCode transcripts come from session_message and session_part rows', (t) => {
  const root = path.join(tmp(t), 'opencode');
  fs.mkdirSync(root, { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(root, 'opencode.db'));
  db.exec(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, data TEXT);
    CREATE TABLE session_part (message_id TEXT, session_id TEXT, ordinal INTEGER, type TEXT, data TEXT);
    INSERT INTO session_v2 VALUES ('ses_1', 'p', NULL, '/w', 'Fix it', 1, 2);
    INSERT INTO session_message VALUES ('msg_1', 'ses_1', 'user', 1, '{"text":"Why does the build fail?"}');
    INSERT INTO session_message VALUES ('msg_2', 'ses_1', 'assistant', 2, '{"agent":"build"}');
    INSERT INTO session_part VALUES ('msg_2', 'ses_1', 0, 'reasoning', '{"type":"reasoning","text":"hidden thinking"}');
    INSERT INTO session_part VALUES ('msg_2', 'ses_1', 1, 'tool', '{"type":"tool","name":"bash"}');
    INSERT INTO session_part VALUES ('msg_2', 'ses_1', 2, 'text', '{"type":"text","text":"A missing import."}');`);
  db.close();
  const [session] = scanOpenCode({ sessionRoot: root });
  const { markdown, suggestedName } = apps.getApp('opencode').exportTranscript(session);
  assert.equal(markdown, '## 🧑 用户\n\nWhy does the build fail?\n\n## 🤖 OpenCode\n\n> 🔧 bash\n\nA missing import.');
  assert.equal(suggestedName, 'Fix it.md');
  assert.doesNotMatch(markdown, /hidden thinking/);
});

test('Gemini CLI and Qwen Code transcripts keep the user and assistant text only', (t) => {
  const root = tmp(t);
  const gemini = path.join(root, 'session-1.jsonl');
  write(gemini, lines(
    { sessionId: 's1', startTime: '2026-11-24T10:00:00Z', kind: 'main' },
    { id: 'm1', type: 'user', content: [{ text: 'Rename the module' }] },
    { id: 'm2', type: 'gemini', content: 'Done: renamed in three files.' },
    { id: 'm3', type: 'info', content: 'Model switched' },
    { $set: { summary: 'Rename' } }
  ));
  assert.equal(transcripts.geminiTranscriptMarkdown(gemini), '## 🧑 用户\n\nRename the module\n\n## 🤖 Gemini\n\nDone: renamed in three files.');
  const qwen = path.join(root, 'u1.jsonl');
  write(qwen, lines(
    { sessionId: 'u1', type: 'user', message: { parts: [{ text: 'Add a test' }] } },
    { sessionId: 'u1', type: 'assistant', message: { parts: [{ text: 'thinking', thought: true }, { text: 'Added tests/a.test.ts.' }] } },
    { sessionId: 'u1', type: 'assistant', isSidechain: true, message: { parts: [{ text: 'subagent noise' }] } },
    { sessionId: 'u1', type: 'tool_result', message: { parts: [{ text: 'raw tool output' }] } }
  ));
  assert.equal(transcripts.qwenTranscriptMarkdown(qwen), '## 🧑 用户\n\nAdd a test\n\n## 🤖 Qwen\n\nAdded tests/a.test.ts.');
  for (const id of ['opencode', 'gemini-cli', 'qwen-code']) assert.equal(apps.listApps().find((item) => item.id === id).canExportTranscript, true);
});

test('DSH sessions: the highest generation, zstd frames, latest title; child sessions hidden', (t) => {
  const home = tmp(t);
  const sessions = path.join(home, 'sessions');
  const header = (id, extra = {}) => ({ type: 'session', version: 3, id, createdAt: 1700000000000, isSeeded: false, delegationDepth: 0, cwd: '/work/app', ...extra });
  // Independent zstd frames, as DSH writes them: one for the header, one per batch.
  const frames = Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(lines(header('session-a')))),
    zlib.zstdCompressSync(Buffer.from(lines({ type: 'session/title', data: { title: 'First title', source: 'fallback' } }))),
    zlib.zstdCompressSync(Buffer.from(lines({ type: 'message/human', data: { text: 'hi' } }, { type: 'session/title', data: { title: 'Better title', source: 'model' } })))
  ]);
  write(path.join(sessions, '--work-app--', 'session-a', 'session.v3.jsonl.zstd'), frames);
  // An older generation of the same session is ignored.
  write(path.join(sessions, '--work-app--', 'session-a', 'session.v1.jsonl'), lines(header('session-a', { version: 1 }), { type: 'session/title', data: { title: 'Stale' } }));
  write(path.join(sessions, '_no-cwd', 'session-b', 'session.v3.jsonl'), lines({ ...header('session-b'), cwd: undefined }));
  write(path.join(sessions, '--work-app--', 'session-child', 'session.v3.jsonl'), lines(header('session-child', { parentSession: 'session-a', delegationDepth: 1 })));
  write(path.join(sessions, '--work-app--', 'broken', 'session.v3.jsonl.zstd'), 'not zstd');
  const found = scanDsh({ sessionRoot: home });
  assert.deepEqual(found.map((session) => [session.id, session.title, session.projectPath]).sort(), [
    ['session-a', 'Better title', '/work/app'],
    ['session-b', 'DSH b', null]
  ]);
  assert.equal(apps.getApp('dsh-cli').scan({ sessionRoot: home }).length, 2);
  assert.equal(apps.listApps().find((item) => item.id === 'dsh-cli').canExportTranscript, false);
});

test('an OpenCode auth export is recognised by content and imported by OpenCode itself, or undone', async (t) => {
  const root = tmp(t);
  const exportFile = path.join(root, 'downloads', 'my-opencode-logins.json');
  write(exportFile, JSON.stringify([{ id: 'cred_1', integrationID: 'anthropic', label: 'Work', active: true, value: { type: 'key', key: SECRET } }]));
  assert.equal(credentialImport.clientForCredentialFile(exportFile), 'opencode');
  assert.equal(credentialImport.clientForCredentialFile(path.join(root, 'notes.json')), null);
  const store = [];
  const imports = [];
  const discarded = [];
  let fail = false;
  const items = createRecruitItems({
    loadProfiles: () => store.slice(),
    registerLocations: () => [],
    planExistingLocation: () => ({ existing: null }),
    createStoredProfile: (input, options) => {
      const profilePath = path.join(root, 'AgentDesk', `oc-${store.length + 1}`);
      const profile = { id: `p${store.length + 1}`, appId: input.appId, profilePath, sessionRoot: path.join(profilePath, 'opencode-data', 'opencode'), credentialImported: options.credentialImport };
      options.stage(profile);
      store.push(profile);
      return profile;
    },
    discoverCodexHomes: () => [],
    discoverLocations: async () => ({ locations: [] }),
    importOpenCodeExport: async (profile, filePath) => {
      imports.push([profile.id, filePath]);
      if (fail) throw Object.assign(new Error('official-command-failed'), { code: 'official-command-failed' });
    },
    discardProfile: (id) => discarded.push(id),
    env: {}
  });
  const planned = await items.planItem(exportFile);
  assert.deepEqual([planned.appId, planned.action], ['opencode', 'copy']);
  const done = await items.executeItem(exportFile, 'copy');
  assert.equal(done.copied, true);
  assert.deepEqual(imports, [['p1', exportFile]]);
  assert.ok(fs.existsSync(store[0].sessionRoot));
  fail = true;
  await assert.rejects(items.executeItem(exportFile, 'copy'), { code: 'official-command-failed' });
  assert.deepEqual(discarded, ['p2']);
});

test('`opencode auth import <file>` runs in the account’s own data folder', posixOnly, async (t) => {
  const root = tmp(t);
  const log = path.join(root, 'log');
  const bin = path.join(root, 'bin', 'opencode');
  write(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\necho "$XDG_DATA_HOME" >> "${log}"\n`);
  fs.chmodSync(bin, 0o755);
  const profilePath = path.join(root, 'AgentDesk', 'oc');
  const profile = { appId: 'opencode', profilePath, sessionRoot: path.join(profilePath, 'opencode-data', 'opencode'), profilePathMode: 'managed', sessionRootMode: 'managed' };
  const exportFile = path.join(root, 'export.json');
  await credentials.importOpenCodeExport(profile, exportFile, { env: { PATH: process.env.PATH }, findLauncher: () => ({ command: bin, prefixArgs: [], extraEnv: {} }) });
  assert.equal(fs.readFileSync(log, 'utf8'), `--standalone\nauth\nimport\n${exportFile}\n${path.join(profilePath, 'opencode-data')}\n`);
  await assert.rejects(credentials.importOpenCodeExport(profile, exportFile, { findLauncher: () => null }), { code: 'official-client-missing' });
});
