const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = process.cwd();
const baseline = '3a4919a14c05e4db1c828cccad3ec9e024023efe';
const filename = path.join(root, 'src/activity.js');
const oldSource = execFileSync('git', ['show', `${baseline}:src/activity.js`], { encoding: 'utf8' });
const context = vm.createContext({ require: createRequire(filename), module: { exports: {} }, Buffer });
vm.runInContext(oldSource, context);
const oldProbe = context.module.exports.probeActivity;
const { probeActivities } = require(path.join(root, 'src/activity'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-activity-bench-'));
try {
  const sessions = path.join(fixture, 'sessions'); fs.mkdirSync(sessions);
  for (let i = 0; i < 500; i++) {
    const payloads = [{ id: `root-${i}` }, { id: `child-${i}-1`, parent_thread_id: `root-${i}` }, { id: `child-${i}-2`, thread_source: 'subagent', session_id: `root-${i}` }];
    for (const payload of payloads) fs.writeFileSync(path.join(sessions, `${payload.id}.jsonl`), JSON.stringify({ type: 'session_meta', timestamp: new Date().toISOString(), payload }) + '\n');
  }
  const profiles = Array.from({ length: 4 }, (_, i) => ({ id: String(i), appId: 'codex', sessionRoot: fixture }));
  function measure(operation) {
    const methods = ['statSync', 'readdirSync', 'openSync'];
    const counts = Object.fromEntries(methods.map(name => [name, 0]));
    const originals = Object.fromEntries(methods.map(name => [name, fs[name]]));
    for (const name of methods) fs[name] = (...args) => { counts[name]++; return originals[name](...args); };
    const start = performance.now();
    try { const rows = operation(); return { durationMs: +(performance.now() - start).toFixed(2), counts, activeNowPerSlot: rows.map(row => row.activeNow) }; }
    finally { for (const name of methods) fs[name] = originals[name]; }
  }
  const result = {
    recordedAt: new Date().toISOString(), baseline,
    sourceSha256: require(path.join(root, 'scripts/validation-source')).sourceDigest(root),
    environment: { platform: process.platform, arch: process.arch, node: process.version, osRelease: os.release() },
    scope: 'Synthetic 500 roots + 1000 internal children, 4 slots sharing one root. Baseline activity loop loaded with current adapter registry; its Codex activityRecord hook is not consumed by the old loop. Timings are one local sample, not a product performance claim.',
    baselineLoop: measure(() => profiles.map(profile => oldProbe(profile))),
    currentCold: measure(() => probeActivities(profiles)),
    currentWarm: measure(() => probeActivities(profiles))
  };
  fs.mkdirSync(path.join(root, 'docs/validation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/validation/activity-benchmark.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
