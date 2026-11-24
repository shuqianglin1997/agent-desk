'use strict';

// Timing harness for docs/ARCHITECTURE_PLAN.md (the measuring stick for
// phases 4–6). Generates synthetic data in a temp directory, points HOME at
// an empty temp home before any scanner loads, then times the Main-process
// work that the renderer's refresh paths trigger. Every call measured here is
// synchronous, so its duration is the time the Electron main thread would be
// blocked. Warm timings are the median of five repeats on this machine; the OS page cache is
// warm because the files were just written.
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

function run(options = {}) {
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
      note: 'Warm values are the median of the repeats (min/max alongside); page cache warm; every measured call is synchronous on the Electron main thread. Timings vary with machine load.',
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
        activityTickMs: activityWarm.ms + ps.ms
      }
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
  const result = run({ light: args.includes('--light') });
  if (args.includes('--write')) {
    fs.writeFileSync(path.join(ROOT, 'docs/validation/architecture-baseline.json'), JSON.stringify(result, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
