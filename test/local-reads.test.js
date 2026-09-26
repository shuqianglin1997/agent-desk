const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerLocalReadIpc } = require('../src/main/ipc/local-reads');

test('local read handlers resolve a current registered profile and keep quota separate from activity', async () => {
  const handlers = new Map();
  let profiles = [{ id: 'a', sessionRoot: '/registered', appId: 'codex' }];
  let scans = 0, quotaCalls = 0, processCalls = 0;
  registerLocalReadIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    loadProfiles: () => profiles,
    boundedText: value => String(value || '').slice(0, 128),
    apps: { getApp: () => ({ scan: profile => { scans++; return [profile.sessionRoot]; } }) },
    probeActivities: input => input.map(p => ({ profileId: p.id, activeNow: 1 })),
    snapshotProcesses: () => { processCalls++; return 'snapshot'; },
    profileIsRunning: (_ps, profile) => profile.id === 'a',
    quotaService: { getAll: (input, options) => { quotaCalls++; return { input, options }; } },
    getVersion: () => 'test', revealSessionFile() {}, exportSessionTranscript() {}
  });
  assert.deepEqual(handlers.get('sessions:list')(null, { profileId: 'unknown', filePath: '/injected' }), []);
  assert.equal(scans, 0);
  assert.deepEqual(handlers.get('sessions:list')(null, { profileId: 'a', sessionRoot: '/injected' }), ['/registered']);
  profiles = [{ ...profiles[0], sessionRoot: '/current' }];
  assert.deepEqual(handlers.get('sessions:list')(null, { profileId: 'a' }), ['/current']);
  assert.deepEqual(handlers.get('activity:all')(), [{ profileId: 'a', activeNow: 1, running: true }]);
  assert.equal(processCalls, 1); assert.equal(quotaCalls, 0);
  assert.deepEqual((await handlers.get('quota:all')(null, { force: true })).options, { force: true, clientVersion: 'test' });
});
