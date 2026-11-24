const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generate } = require('../scripts/arch-fixtures');
const apps = require('../src/apps');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-arch-fixture-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function listing(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.push([path.relative(root, file), fs.statSync(file).size]);
    }
  };
  walk(root);
  return out.sort();
}

test('synthetic data refuses to write outside the system temp folder', () => {
  assert.throws(() => generate(path.join(__dirname, 'not-a-temp-dir')), /arch-fixtures-root-outside-temp/);
  assert.equal(fs.existsSync(path.join(__dirname, 'not-a-temp-dir')), true);
  fs.rmSync(path.join(__dirname, 'not-a-temp-dir'), { recursive: true, force: true });
});

test('synthetic data gives every scanner exactly its sessions; internal Codex children never become rows', (t) => {
  const root = tempRoot(t);
  const fixture = generate(root, { sessionsPerAccount: 12, scale: 0.02, now: Date.parse('2026-11-24T12:00:00Z') });
  assert.equal(fixture.profiles.length, 10);
  for (const profile of fixture.profiles) {
    const rows = apps.getApp(profile.appId).scan(profile);
    assert.equal(rows.length, 12, profile.appId);
    // Titles come from the content (index, ai-title, summary, first prompt), never the "<Client> 会话 <id>" fallback.
    assert.ok(rows.every((row) => row.title.startsWith('Synthetic ')), profile.appId);
  }
  assert.ok(fixture.internalChildren > 0);
});

test('synthetic data is deterministic for a fixed clock', (t) => {
  const a = tempRoot(t);
  const b = tempRoot(t);
  const now = Date.parse('2026-11-24T12:00:00Z');
  generate(a, { sessionsPerAccount: 6, scale: 0.02, now });
  generate(b, { sessionsPerAccount: 6, scale: 0.02, now });
  // Same names and sizes (both temp roots have the same path length, so embedded cwd values match in size).
  assert.deepEqual(listing(a), listing(b));
  assert.ok(listing(a).length > 60);
});

test('timing harness runs on light data in its own process with a temp home and cleans up', () => {
  const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('agentdesk-arch-bench-')).length;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/arch-bench.js'), '--light'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fixture.mode, 'light');
  assert.equal(report.sessionsAllRefresh.rows, 200);
  assert.equal(report.sessionsListPerProfile.length, 10);
  assert.ok(report.mainThreadBlock.meshModeAllSessionsMs >= 0);
  assert.ok(report.activityProbe.warm.stats > 0);
  // Phase 4: the refreshes the way Main makes them, through the index and the worker.
  assert.equal(report.mainThreadNow.usesWorker, true);
  assert.equal(report.mainThreadNow.scanPlaces.here, 0, 'index refreshes scan on the worker');
  assert.ok(report.mainThreadNow.indexRefreshAllCold.longestBlockMs >= 0);
  assert.equal(report.mainThreadNow.remainingSyncScan.perProfile.length, 10);
  assert.ok(report.mainThreadBlock.longestBlockViaWorkerMs >= 0);
  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('agentdesk-arch-bench-')).length;
  assert.ok(after <= before, 'the temp data is removed');
});
