'use strict';

// Timing harness for docs/ARCHITECTURE_PLAN.md (the measuring stick for
// phases 4–6). Generates synthetic data in a temp directory, points HOME at
// an empty temp home before any scanner loads, then times the work that the
// renderer's refresh paths trigger. Two kinds of numbers:
//  - the direct synchronous calls (scan, probe, ps): their duration is the
//    work itself, wherever it runs;
//  - `mainThreadNow` (phase 4 on): the same refreshes the way Main does them
//    now, through the session index and the scan worker, with the longest
//    stretch the main thread's event loop could not turn (`longestBlockMs`),
//    plus the synchronous scans Main still makes.
// Warm timings are the median of five repeats on this machine; the OS page
// cache is warm because the files were just written.
//
//   node scripts/arch-bench.js            full: 10 accounts × 500 sessions
//   node scripts/arch-bench.js --light    20 sessions per account, tiny files
//   --write                               save docs/validation/architecture-baseline.json

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const counters = { on: false, bytesRead: 0, opens: 0, stats: 0, readdirs: 0 };

function instrumentFs() {
  const wrap = (name, after) => {
    const original = fs[name];
    fs[name] = function wrapped(...args) {
      const result = original.apply(this, args);
      if (counters.on) after(result, args);
      return result;
    };
  };
  wrap('readSync', (result) => { counters.bytesRead += Number(result) || 0; });
  wrap('readFileSync', (result) => { counters.bytesRead += result ? (Buffer.isBuffer(result) ? result.length : Buffer.byteLength(result)) : 0; });
  wrap('openSync', () => { counters.opens++; });
  wrap('statSync', () => { counters.stats++; });
  wrap('lstatSync', () => { counters.stats++; });
  wrap('readdirSync', () => { counters.readdirs++; });
}

function measure(operation) {
  counters.on = true;
  counters.bytesRead = 0; counters.opens = 0; counters.stats = 0; counters.readdirs = 0;
  const start = process.hrtime.bigint();
  let value;
  try { value = operation(); } finally { counters.on = false; }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms: +ms.toFixed(2), bytesRead: counters.bytesRead, opens: counters.opens, stats: counters.stats, readdirs: counters.readdirs, value };
}

// Repeats a warm measurement and keeps the median sample; min/max show the spread.
function measureRepeated(operation, times) {
  const samples = Array.from({ length: times }, () => measure(operation));
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { ...median, minMs: sorted[0].ms, maxMs: sorted[sorted.length - 1].ms, samples: times };
}

// Runs an async operation while a setImmediate ticker watches the main
// thread: the longest gap between two turns is the longest block.
async function longestBlock(operation) {
  const { performance } = require('node:perf_hooks');
  let last = performance.now();
  let longest = 0;
  let running = true;
  const tick = () => {
    const at = performance.now();
    if (at - last > longest) longest = at - last;
    last = at;
    if (running) setImmediate(tick);
  };
  const start = performance.now();
  setImmediate(tick);
  let value;
  try { value = await operation(); } finally { running = false; }
  const end = performance.now();
  if (end - last > longest) longest = end - last;
  return { totalMs: +(end - start).toFixed(2), longestBlockMs: +longest.toFixed(2), value };
}

async function longestBlockRepeated(operation, times) {
  const samples = [];
  for (let index = 0; index < times; index += 1) samples.push(await longestBlock(operation));
  const sorted = [...samples].sort((a, b) => a.longestBlockMs - b.longestBlockMs);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { totalMs: median.totalMs, longestBlockMs: median.longestBlockMs, maxLongestBlockMs: sorted[sorted.length - 1].longestBlockMs, samples: times };
}

// The refresh paths as Main runs them now (src/main.js): the session index
// over the scan worker, the activity probe's file work on the worker, the
// shared asynchronous process list, and the one synchronous scan left.
async function mainThreadNow(fixture, repeats) {
  const apps = require(path.join(ROOT, 'src/apps'));
  const memo = require(path.join(ROOT, 'src/clients/file-memo'));
  const { createSessionIndex, registryScan } = require(path.join(ROOT, 'src/session-index'));
  const { probeRawActivities, finishActivities } = require(path.join(ROOT, 'src/activity'));
  const { createScanHost } = require(path.join(ROOT, 'src/scan-host'));
  const { collectProcessRecords, processText } = require(path.join(ROOT, 'src/process'));
  const places = { worker: 0, here: 0 };
  const host = createScanHost({
    inProcess: { scan: registryScan(apps), activityRaw: probeRawActivities },
    onScan: (_profile, where) => { places[where] += 1; }
  });
  try {
    const index = createSessionIndex({ scan: (profile) => host.scan(profile), scanSync: registryScan(apps) });
    const refresh = () => index.refresh(fixture.profiles, { maxAgeMs: 0 });
    const strip = ({ value, ...rest }) => rest;
    // The worker has its own memo: its first refresh reads every file.
    const refreshCold = strip(await longestBlock(refresh));
    const refreshWarm = await longestBlockRepeated(refresh, repeats);
    const activity = await longestBlockRepeated(async () => finishActivities(
      fixture.profiles, await host.activityRaw(fixture.profiles, Date.now(), 0), null
    ), repeats);
    const processList = await longestBlockRepeated(async () => processText(await collectProcessRecords()), repeats);
    // The synchronous fallback: rowsSync scans here only when the index has
    // no entry for the profile yet (one created moments ago). Since phase 5
    // the routine paths (user actions, the Mesh inventory, the hub's
    // end-of-run lookup) read an entry a worker scan left. Main's memo is
    // cold the first time for each profile.
    const syncScans = fixture.profiles.map((profile) => {
      memo.clear();
      const cold = measure(() => index.rowsSync(profile, { maxAgeMs: -1 }));
      const warm = measureRepeated(() => index.rowsSync(profile, { maxAgeMs: -1 }), repeats);
      return { id: profile.id, appId: profile.appId, coldMs: cold.ms, warmMs: warm.ms };
    });
    const worstSync = syncScans.reduce((a, b) => (b.coldMs > a.coldMs ? b : a));
    return {
      usesWorker: host.usesWorker(),
      scanPlaces: { ...places },
      indexRefreshAllCold: refreshCold,
      indexRefreshAllWarm: refreshWarm,
      activityProbeViaWorker: activity,
      processListAsync: processList,
      remainingSyncScan: {
        where: 'synchronous fallback (rowsSync) for a profile the index has no entry for yet; routine paths read entries from worker scans since phase 5',
        perProfile: syncScans,
        worstColdMs: worstSync.coldMs,
        worstColdProfile: worstSync.id,
        worstWarmMs: Math.max(...syncScans.map((item) => item.warmMs))
      },
      longestBlockMs: Math.max(refreshCold.longestBlockMs, refreshWarm.maxLongestBlockMs, activity.maxLongestBlockMs, processList.maxLongestBlockMs)
    };
  } finally {
    await host.close();
  }
}

async function run(options = {}) {
  const repeats = options.repeats || (options.light ? 1 : 5);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-arch-bench-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    instrumentFs();
    const { generate } = require('./arch-fixtures');
    const light = options.light === true;
    const now = Date.now();
    const generateStart = Date.now();
    const fixture = generate(path.join(base, 'data'), light ? { sessionsPerAccount: 20, scale: 0.05, now } : { now });
    const generateMs = Date.now() - generateStart;
    // Scanners load only after HOME points at the empty temp home.
    const apps = require(path.join(ROOT, 'src/apps'));
    const { probeActivities } = require(path.join(ROOT, 'src/activity'));
    const { identityFingerprint } = require(path.join(ROOT, 'src/identity'));
    const { snapshotProcesses } = require(path.join(ROOT, 'src/process'));
    const scan = (profile) => apps.getApp(profile.appId).scan(profile);

    const perProfile = fixture.profiles.map((profile) => {
      const cold = measure(() => scan(profile));
      const warm = measureRepeated(() => scan(profile), repeats);
      return {
        id: profile.id, appId: profile.appId, rows: cold.value.length,
        coldMs: cold.ms, warmMs: warm.ms, warmMinMs: warm.minMs, warmMaxMs: warm.maxMs,
        bytesRead: warm.bytesRead, opens: warm.opens, stats: warm.stats
      };
    });
    const allRefresh = measureRepeated(() => fixture.profiles.map(scan), repeats);
    const counts = measureRepeated(() => fixture.profiles.map((profile) => scan(profile).length), repeats);
    const activityCold = measure(() => probeActivities(fixture.profiles, Date.now(), null));
    const activityWarm = measureRepeated(() => probeActivities(fixture.profiles, Date.now(), null), repeats);
    const identity = measure(() => fixture.profiles.map(identityFingerprint));
    const ps = measureRepeated(() => snapshotProcesses(), repeats);
    const strip = ({ value, ...rest }) => rest;
    const largestProfile = perProfile.reduce((a, b) => (b.warmMs > a.warmMs ? b : a));
    const viaIndex = await mainThreadNow(fixture, repeats);
    return {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      sourceSha256: require('./validation-source').sourceDigest(ROOT),
      environment: { platform: process.platform, arch: process.arch, node: process.version, osRelease: os.release(), cpus: os.cpus().length },
      fixture: {
        mode: light ? 'light' : 'full', accounts: fixture.profiles.length, sessionsPerAccount: fixture.sessionsPerAccount,
        clients: fixture.profiles.map((profile) => profile.appId), bytesOnDisk: fixture.bytes, internalChildren: fixture.internalChildren, generateMs
      },
      repeats,
      note: 'Warm values are the median of the repeats (min/max alongside); page cache warm. The direct calls are synchronous wherever they run; mainThreadNow measures the refreshes the way Main makes them now (index + scan worker), longestBlockMs being the longest stretch the main event loop could not turn. Timings vary with machine load.',
      sessionsListPerProfile: perProfile,
      sessionsAllRefresh: { ...strip(allRefresh), rows: allRefresh.value.reduce((sum, rows) => sum + rows.length, 0) },
      overviewSessionCounts: strip(counts),
      activityProbe: { cold: strip(activityCold), warm: strip(activityWarm) },
      identityFingerprints: strip(identity),
      processSnapshot: { ...strip(ps), available: ps.value !== null },
      mainThreadBlock: {
        largestSingleProfileListMs: largestProfile.warmMs,
        largestSingleProfileList: largestProfile.id,
        meshModeAllSessionsMs: allRefresh.ms,
        activityTickMs: activityWarm.ms + ps.ms,
        longestBlockViaWorkerMs: viaIndex.longestBlockMs,
        remainingSyncScanColdMs: viaIndex.remainingSyncScan.worstColdMs
      },
      mainThreadNow: viaIndex
    };
  } finally {
    process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  run({ light: args.includes('--light') }).then((result) => {
    if (args.includes('--write')) {
      fs.writeFileSync(path.join(ROOT, 'docs/validation/architecture-baseline.json'), JSON.stringify(result, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }, (error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
