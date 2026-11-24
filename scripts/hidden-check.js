#!/usr/bin/env node
'use strict';

// Hidden-window check of the real app, used at the end of every architecture
// phase. Seeds a disposable userData with the light synthetic data (10
// accounts), starts Electron through scripts/hidden-electron-entry.js with a
// temp HOME (no window shown, no client started, no network), then
//   - compares the shapes of the main read IPC payloads with
//     test/fixtures/characterisation/ipc-shapes.json (`--update` rewrites it),
//   - reports how many full session scans start-up performed.
//
//   node scripts/hidden-check.js [--update] [--keep] [--eval '<renderer expression>']
// --eval adds the JSON value of one renderer expression to the report, for a
// phase check of something the shapes do not show (for example cat states).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { generate } = require('./arch-fixtures');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'characterisation', 'ipc-shapes.json');

function seed(base) {
  const userData = path.join(base, 'user-data');
  const home = path.join(base, 'home');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const fixture = generate(path.join(base, 'data'), { sessionsPerAccount: 20, scale: 0.05, now: Date.now() });
  const profiles = fixture.profiles.map((profile, index) => ({
    ...profile,
    group: index < 5 ? 'Work' : '',
    isProtected: false,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString()
  }));
  fs.writeFileSync(path.join(userData, 'profiles.json'), JSON.stringify({ version: 3, profiles }, null, 2));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    version: 2,
    settings: { theme: 'light', lang: 'zh', sessionScope: 'all', sessionView: 'compact', welcomed: true,
      onboarding: { completedVersion: 1, completedAt: '2026-11-01T00:00:00.000Z' }, meshSignalingUrls: [], meshStunUrls: [] }
  }, null, 2));
  return { userData, home, profiles };
}

function launch(base, userData, home, outputFile, evalExpression) {
  const electronPath = require('electron');
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTDESK_HIDDEN_TASK: 'probe', AGENTDESK_HIDDEN_OUTPUT: outputFile };
  if (evalExpression) env.AGENTDESK_HIDDEN_EVAL = evalExpression;
  else delete env.AGENTDESK_HIDDEN_EVAL;
  delete env.ELECTRON_RUN_AS_NODE;
  const log = [];
  return new Promise((resolve) => {
    const child = spawn(electronPath, [`--user-data-dir=${userData}`, path.join(__dirname, 'hidden-electron-entry.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => log.push(String(chunk)));
    child.stderr.on('data', (chunk) => log.push(String(chunk)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, log: log.join('') }); });
  });
}

function fullScans(scans, profileIds) {
  const counts = Object.fromEntries(profileIds.map((id) => [id, 0]));
  for (const scan of scans) if (scan.profileId in counts) counts[scan.profileId] += 1;
  const values = Object.values(counts);
  return { perProfile: counts, fullScans: Math.min(...values), mostScansOfOneProfile: Math.max(...values) };
}

async function main() {
  const args = process.argv.slice(2);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-hidden-check-'));
  try {
    const { userData, home, profiles } = seed(base);
    const outputFile = path.join(base, 'result.json');
    const evalIndex = args.indexOf('--eval');
    const { code, log } = await launch(base, userData, home, outputFile, evalIndex >= 0 ? args[evalIndex + 1] : '');
    assert.ok(fs.existsSync(outputFile), `hidden run produced no result (exit ${code})\n${log.slice(-3000)}`);
    const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    if (result.error) throw new Error(`hidden run failed: ${result.error}\n${log.slice(-3000)}`);
    assert.equal(result.ready, true, 'start-up never reached the settled state');
    assert.equal(result.profileCount, profiles.length);
    const serious = log.split(/\r?\n/).filter((line) => /\[renderer-gone\]|Uncaught (?:TypeError|ReferenceError|Error)|FATAL:/i.test(line));
    const ready = result.startupReadyAt;
    const bootScans = result.scans.filter((scan) => scan.at <= ready);
    const report = {
      startupReadyMs: ready,
      startup: fullScans(bootScans, profiles.map((profile) => profile.id)),
      untilProbe: fullScans(result.scans, profiles.map((profile) => profile.id)),
      // Where scans ran: on the worker thread, or in the main process.
      scanPlaces: result.scans.reduce((places, scan) => ({ ...places, [scan.where || 'here']: (places[scan.where || 'here'] || 0) + 1 }), {}),
      stubbed: [...new Set(result.stubbed.map((item) => item.channel || item.api))],
      clipboardWrites: result.clipboard.length,
      seriousLogLines: serious
    };
    let shapesMatch = null;
    if (args.includes('--update')) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(result.shapes, null, 2) + '\n');
    } else {
      const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
      const differing = Object.keys({ ...golden, ...result.shapes }).filter((channel) => JSON.stringify(golden[channel]) !== JSON.stringify(result.shapes[channel]));
      shapesMatch = differing.length === 0;
      report.shapeDifferences = differing.map((channel) => ({ channel, expected: golden[channel], actual: result.shapes[channel] }));
    }
    report.shapesMatch = shapesMatch;
    if (result.extra !== undefined) report.extra = result.extra;
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (shapesMatch === false || serious.length) process.exitCode = 1;
  } finally {
    if (args.includes('--keep')) process.stdout.write(`kept ${base}\n`);
    else fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`hidden check failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
