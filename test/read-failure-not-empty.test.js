// A read that fails is not the same as "nothing there". Each place below used
// to turn a failure into an empty result; each now keeps the last good data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
const fn = (name) => renderer.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n.*?^\\}`, 'ms'))[0];

test('a failed activity poll keeps the cats as they were instead of making every cat idle', async () => {
  let fail = false;
  const context = vm.createContext({
    state: { activity: {} }, renderAccountHeader() {}, renderAccountRoster() {}, renderTopbarContext() {}, renderAttentionInbox() {},
    sessionMarks: { updateFromActivity: () => 0 }, hubWritingKeys: () => [], applySessionFilter() {}, document: { dispatchEvent() {} },
    refreshSessionsOnActivity() {},
    window: { manager: { listActivity: async () => { if (fail) throw new Error('probe failed'); return [{ profileId: 'a', activeNow: 2, writingNow: 1 }]; } } }
  });
  vm.runInContext("let activityLoading = false; let busySignature = ''; let replySignature = '';\n" + fn('loadActivity'), context);
  await context.loadActivity();
  fail = true;
  await context.loadActivity();
  assert.equal(context.state.activity.a?.writingNow, 1);
});

test('one account whose session scan fails keeps its last rows; the others refresh', async () => {
  const groups = [
    { key: 'A', primary: { name: 'Cat A' }, members: [{ id: 'a1', name: 'Cat A', appId: 'codex' }] },
    { key: 'B', primary: { name: 'Cat B' }, members: [{ id: 'b1', name: 'Cat B', appId: 'codex' }] }
  ];
  const context = vm.createContext({
    state: {
      ui: { agentScope: 'all' }, profiles: [{ id: 'a1' }, { id: 'b1' }], mesh: { overview: null },
      sessions: [{ id: 'a-old', _profileId: 'a1', updatedAt: '2026-11-24T09:00:00Z' }, { id: 'b-old', _profileId: 'b1', updatedAt: '2026-11-24T08:00:00Z' }]
    },
    currentAgentId: () => null, identityGroups: () => groups, appLabel: (id) => id, tr: (key) => key,
    validateSessionContext() {}, applySessionFilter() {}, renderSessionControls() {}, renderAccounts() {}, setStatus() {},
    window: { manager: { listSessions: async (member) => {
      if (member.id === 'a1') throw new Error('EACCES');
      return [{ id: 'b-new', updatedAt: '2026-11-24T10:00:00Z' }];
    } } }
  });
  const declarations = (renderer.match(/^let sessionsLoad\w* = [^\n]*$/gm) || []).join('\n');
  vm.runInContext(`${declarations}\n${fn('loadLocalSessions')}`, context);
  await context.loadLocalSessions({ source: 'local' });
  assert.deepEqual(Array.from(context.state.sessions, (row) => row.id), ['b-new', 'a-old']);
});

test('an unreadable Codex title index still lists the sessions, with fallback titles', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-codex-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = '11111111-1111-4111-8111-111111111111';
  fs.mkdirSync(path.join(root, 'sessions'));
  fs.writeFileSync(path.join(root, 'sessions', `rollout-2026-11-24T10-00-00-${id}.jsonl`),
    JSON.stringify({ timestamp: '2026-11-24T10:00:00Z', type: 'session_meta', payload: { id, cwd: '/work' } }) + '\n');
  // A directory where the index file should be: reading it fails (EISDIR).
  fs.mkdirSync(path.join(root, 'session_index.jsonl'));
  const { scanCodex } = require('../src/sessions');
  const rows = scanCodex({ sessionRoot: root });
  assert.deepEqual(rows.map((row) => row.id), [id]);
  assert.equal(rows[0].projectPath, '/work');
});

test('a failed scan is not published to paired devices as an empty inventory', (t) => {
  const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
  const { MeshService } = require('../src/mesh/main/mesh-service');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-inventory-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const NOW = '2026-11-24T12:00:00.000Z';
  let failing = false;
  const session = { id: 'thread', address: 'thread', adapterConversationKey: 'thread', appId: 'codex', title: 'Kept', createdAt: NOW, updatedAt: NOW, projectPath: '/p', filePath: '/p/thread.jsonl', source: 'Codex', status: '可用' };
  const service = new MeshService({
    databasePath: path.join(directory, 'mesh.db'),
    keyVault: new EncryptedKeyVault(path.join(directory, 'keys.json'), {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
      decryptString: (buffer) => Buffer.from(buffer.toString().replace(/^protected:/, ''), 'base64').toString()
    }),
    profilesProvider: () => [{ id: 'slot', appId: 'codex', name: 'Work', identityFingerprint: 'acct', profilePathMode: 'managed', sessionRootMode: 'managed' }],
    sessionsProvider: () => { if (failing) throw new Error('EACCES'); return [session]; },
    appVersion: 'test', platform: 'darwin', arch: 'arm64', osVersion: 'test', hostname: 'Host', now: () => NOW
  });
  service.initialize();
  assert.equal(service.createInventorySnapshot().sessions.length, 1);
  failing = true;
  assert.equal(service.createInventorySnapshot().sessions.length, 1, 'the last good sessions are published, not an empty list');
  assert.equal(service.getUnifiedSessions().length, 1);
});
