// The session export writes the file the person chose in one piece: a
// complete file next to it, renamed into place, readable only by them, with
// nothing left behind when the folder cannot take it. The handler is taken
// from src/main.js and run with the save dialog and the scan stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { writeFileAtomicAsync } = require('../src/core/json-file');

const { mainHandlerSource } = require('./helpers/main-handler-source');

const main = mainHandlerSource();
const source = main.match(/^async function exportSessionTranscript\(input\) \{\n.*?^\}/ms)[0];

function handler(target) {
  const sandbox = {
    path, fs, crypto: require('node:crypto'),
    writeFileAtomicAsync,
    mainWindow: null,
    app: { getPath: () => '/desktop' },
    apps: { getApp: () => null },
    loadProfiles: () => [],
    resolveLocalSessions: () => [{ client: { exportTranscript() {} } }],
    actionRowsOf: () => [],
    refreshForAction: async () => {},
    selectionProfileIds: () => [],
    prepareSessionExport: async () => ({ data: Buffer.from('# Session\n'), format: 'md', suggestedName: 's.md', attachmentCount: 0 }),
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: target }) },
    t: (key) => key
  };
  // Code moved out of main.js reads Main's services as main.<name>.
  sandbox.main = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return context.exportSessionTranscript;
}

test('an export is written whole, private, with no temporary file left', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-export-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 's.md');
  fs.writeFileSync(target, 'older export');
  const result = await handler(target)({});
  assert.equal(result.ok, true);
  assert.equal(result.savedPath, target);
  assert.equal(fs.readFileSync(target, 'utf8'), '# Session\n');
  assert.deepEqual(fs.readdirSync(dir), ['s.md']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});

test('an export into a folder that cannot take it fails cleanly', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-export-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = await handler(path.join(dir, 'gone', 's.md'))({});
  assert.deepEqual({ ...missing }, { ok: false, reason: 'main.sessionActions.writeUnavailable' });
  const blocked = path.join(dir, 'blocked.md');
  fs.mkdirSync(path.join(blocked, 'inside'), { recursive: true });
  const result = await handler(blocked)({});
  assert.deepEqual({ ...result }, { ok: false, reason: 'main.sessionActions.writeUnavailable' });
  assert.deepEqual(fs.readdirSync(dir), ['blocked.md']);
});
