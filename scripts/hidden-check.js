#!/usr/bin/env node
'use strict';

// Hidden-window check of the real app, used at the end of every architecture
// phase. Seeds a disposable userData with the light synthetic data (10
// accounts), starts Electron through scripts/hidden-electron-entry.js with a
// temp HOME (no window shown, no client started, no network), then
//   - compares the shapes of the main read IPC payloads with
//     test/fixtures/characterisation/ipc-shapes.json (`--update` rewrites it),
//   - reports how many full session scans start-up performed, where scans
//     ran, and the synchronous file/process calls the main thread made while
//     serving the refresh path.
//
//   node scripts/hidden-check.js [--update] [--keep] [--eval '<renderer expression>'] [--sessions N] [--packaged [<binary>]]
//                                [--write <every ms>:<for ms>] [--lag]
// --write appends a line to one session file of the first account every few
// ms for a while, starting with --eval (a session that is writing); --lag adds
// the worker calls' round trips and the main thread's held event loop
// (gaps over 4 ms) to the report as measurements.
// --eval adds the JSON value of one renderer expression to the report, for a
// phase check of something the shapes do not show (for example cat states).
// --sessions N seeds N sessions per account (default 20, at most 500) for a
// timing check; payload shapes are compared only at the default.
// --packaged <binary> runs a packaged test build whose app.asar has the hidden
// entry as its main (made by scripts/hidden-package.js), to check the
// packaged runtime: Electron, app.asar, fuses and ASAR integrity as released.
// --packaged with no binary builds that test package first and removes it
// afterwards. Everything the check makes lives under the system temp folder
// and is removed at the end, unless --keep is given.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { generate } = require('./arch-fixtures');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'characterisation', 'ipc-shapes.json');

function seed(base, sessionsPerAccount = 20) {
  const userData = path.join(base, 'user-data');
  const home = path.join(base, 'home');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const fixture = generate(path.join(base, 'data'), { sessionsPerAccount, scale: 0.05, now: Date.now() });
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

// packagedBinary: a packaged AgentDesk whose app.asar has scripts/hidden-electron-entry.js
// as its main (a test-only build); otherwise the development Electron runs the entry.
function launch(base, userData, home, outputFile, evalExpression, packagedBinary = null, extraEnv = {}) {
  const electronPath = require('electron');
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTDESK_HIDDEN_TASK: 'probe', AGENTDESK_HIDDEN_OUTPUT: outputFile, ...extraEnv };
  if (evalExpression) env.AGENTDESK_HIDDEN_EVAL = evalExpression;
  else delete env.AGENTDESK_HIDDEN_EVAL;
  delete env.ELECTRON_RUN_AS_NODE;
  const log = [];
  return new Promise((resolve) => {
    const command = packagedBinary || electronPath;
    const argv = packagedBinary ? [`--user-data-dir=${userData}`] : [`--user-data-dir=${userData}`, path.join(__dirname, 'hidden-electron-entry.js')];
    const child = spawn(command, argv, { cwd: packagedBinary ? base : ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => log.push(String(chunk)));
    child.stderr.on('data', (chunk) => log.push(String(chunk)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      require('./ui-acceptance').removeChromiumSingletonDir(userData);
      resolve({ code, log: log.join('') });
    });
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
  let builtPackage = null;
  try {
    const sessionsIndex = args.indexOf('--sessions');
    const perAccount = sessionsIndex >= 0 ? Math.max(1, Math.min(500, Number(args[sessionsIndex + 1]) || 20)) : 20;
    const { userData, home, profiles } = seed(base, perAccount);
    const outputFile = path.join(base, 'result.json');
    const evalIndex = args.indexOf('--eval');
    const packagedIndex = args.indexOf('--packaged');
    const givenBinary = packagedIndex >= 0 && args[packagedIndex + 1] && !args[packagedIndex + 1].startsWith('--') ? args[packagedIndex + 1] : null;
    if (packagedIndex >= 0 && !givenBinary) builtPackage = require('./hidden-package').build();
    const packagedBinary = givenBinary ? path.resolve(givenBinary) : (builtPackage ? builtPackage.binary : null);
    const extraEnv = {};
    if (args.includes('--lag')) extraEnv.AGENTDESK_HIDDEN_LAG = '1';
    const writeIndex = args.indexOf('--write');
    if (writeIndex >= 0) {
      const [every, span] = String(args[writeIndex + 1]).split(':').map(Number);
      const files = [];
      const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const target = path.join(dir, entry.name); if (entry.isDirectory()) walk(target); else if (/\.jsonl$/.test(entry.name)) files.push(target); } };
      walk(profiles[0].sessionRoot || profiles[0].profilePath);
      files.sort();
      assert.ok(files.length, 'no session file to write to');
      extraEnv.AGENTDESK_HIDDEN_WRITE = `${files[0]}|${every || 2000}|${span || 30000}`;
      extraEnv.AGENTDESK_HIDDEN_TIMEOUT_MS = String(240_000 + (span || 30000));
    }
    const { code, log } = await launch(base, userData, home, outputFile, evalIndex >= 0 ? args[evalIndex + 1] : '', packagedBinary, extraEnv);
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
      packaged: result.packaged === true,
      scanHostsUseWorker: result.scanHostsUseWorker,
      scanPlaces: result.scans.reduce((places, scan) => ({ ...places, [scan.where || 'here']: (places[scan.where || 'here'] || 0) + 1 }), {}),
      stubbed: [...new Set(result.stubbed.map((item) => item.channel || item.api))],
      clipboardWrites: result.clipboard.length,
      // Synchronous file/process calls on the main thread while serving the refresh path (activity, session list).
      syncOnRefresh: result.syncOnRefresh,
      // The same, for one more refresh round after everything has loaded.
      syncOnRefreshSteady: result.syncOnRefreshSteady,
      seriousLogLines: serious
    };
    let shapesMatch = null;
    if (perAccount !== 20) {
      // A timing run: the golden shapes were recorded on the default data.
    } else if (args.includes('--update')) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(result.shapes, null, 2) + '\n');
    } else {
      const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
      const differing = Object.keys({ ...golden, ...result.shapes }).filter((channel) => JSON.stringify(golden[channel]) !== JSON.stringify(result.shapes[channel]));
      shapesMatch = differing.length === 0;
      report.shapeDifferences = differing.map((channel) => ({ channel, expected: golden[channel], actual: result.shapes[channel] }));
    }
    report.shapesMatch = shapesMatch;
    // A test package this check built itself: the build log's lines about downloading.
    if (builtPackage) report.packageBuild = { downloadLines: builtPackage.downloads || [] };
    if (result.extra !== undefined) report.extra = result.extra;
    if (args.includes('--lag')) report.measurements = { workerCalls: result.workerCalls, mainLag: result.mainLag, writer: result.writer || null };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (shapesMatch === false || serious.length) process.exitCode = 1;
  } finally {
    if (args.includes('--keep')) {
      process.stdout.write(`kept ${base}\n`);
      if (builtPackage) process.stdout.write(`kept ${builtPackage.output}\n`);
    } else {
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      if (builtPackage) require('./hidden-package').remove(builtPackage.output);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`hidden check failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
