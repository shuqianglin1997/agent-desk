// Scans and activity probes run on a worker thread and come back as the same
// data the main process would produce; when the worker cannot start or dies,
// the work runs here instead and still answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const apps = require('../src/apps');
const { registryScan } = require('../src/session-index');
const { probeRawActivities } = require('../src/activity');
const { createScanHost } = require('../src/scan-host');

const inProcess = { scan: registryScan(apps), activityRaw: probeRawActivities };

function claudeHome(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-scan-host-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'projects', '-w');
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: '2026-11-24T10:00:00.000Z', cwd: '/w', message: { role: 'user', content: `hello ${id.slice(0, 4)}` } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-24T10:01:00.000Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } })
    ].join('\n') + '\n');
  }
  return { id: 'p', appId: 'claude-cli', sessionRoot: root, profilePath: root };
}

test('a worker scan and a worker activity probe equal the same work done here', async (t) => {
  const profile = claudeHome(t);
  const host = createScanHost({ inProcess });
  t.after(() => host.close());
  const viaWorker = await host.scan(profile);
  assert.equal(host.usesWorker(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(viaWorker)), JSON.parse(JSON.stringify(inProcess.scan(profile))));
  assert.equal(viaWorker.value.length, 2);
  // With a baseline, the probe reads who spoke last: its hidden reply list must survive the thread.
  const now = Date.parse('2026-11-24T12:00:00Z');
  const [viaThread] = await host.activityRaw([profile], now, 1);
  const [here] = probeRawActivities([profile], now, 1);
  assert.deepEqual({ ...viaThread }, JSON.parse(JSON.stringify({ ...here })));
  assert.equal(here.replies.length, 2, 'the fixture has two finished replies');
  assert.deepEqual(viaThread.replies, here.replies);
  assert.deepEqual(viaThread.writingAddresses, here.writingAddresses);
  assert.equal(Object.keys(viaThread).includes('replies'), false, 'still hidden from the window');
});

test('when the worker cannot start, the work runs here', async (t) => {
  const profile = claudeHome(t);
  const host = createScanHost({ inProcess, createWorker: () => { throw new Error('no workers here'); } });
  assert.equal((await host.scan(profile)).value.length, 2);
  assert.equal(host.usesWorker(), false);
});

test('a request in flight when the worker dies is answered here', async (t) => {
  const profile = claudeHome(t);
  let fake;
  const host = createScanHost({
    inProcess,
    createWorker: () => {
      fake = new EventEmitter();
      fake.postMessage = () => setImmediate(() => fake.emit('exit', 1));
      fake.terminate = async () => {};
      return fake;
    }
  });
  assert.equal((await host.scan(profile)).value.length, 2);
});
