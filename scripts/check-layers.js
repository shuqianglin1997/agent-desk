'use strict';

// Layer check for docs/ARCHITECTURE_PLAN.md §5.1. Every source file is mapped
// to one of six layers; a relative require may only point to the same layer
// or a lower one. Composition roots (entry) may require anything. Separate
// sandboxed renderer processes are `ui`. The table below describes today's
// files; later phases move files and tighten it.
//
// Mode: core-enforced (phase 2). Enforced, so the test and the CLI fail on
// them: a `core` file requiring a higher layer, a `core` file requiring
// electron, and a source file with no layer. Every other violation is only
// reported; later phases add their layer to ENFORCED_LAYERS. `--strict` exits 1
// on every violation.

const fs = require('node:fs');
const path = require('node:path');
const { maskSource } = require('./arch-metrics');

const ROOT = path.resolve(__dirname, '..');
const LAYERS = ['core', 'clients', 'services', 'commands', 'bridge', 'ui'];
const RANK = Object.fromEntries(LAYERS.map((name, index) => [name, index]));
const ENFORCED_LAYERS = ['core'];

// First match wins. Patterns are path prefixes or exact files under src/.
const TABLE = [
  ['entry', ['src/main.js', 'src/automation/cli.js']],
  ['bridge', ['src/preload.js', 'src/main/ipc/', 'src/main/window-lamp.js', 'src/main/window-chrome.js', 'src/remote/console-preload.js', 'src/remote/host-preload.js', 'src/mesh/peer/preload.js', 'src/mesh/probe/preload.js']],
  ['ui', ['src/renderer.js', 'src/renderer/', 'src/pixel/', 'src/i18n/i18n.js', 'src/i18n/zh.js', 'src/i18n/en.js', 'src/i18n/ja.js',
    'src/roster-interactions.js', 'src/ui-context.js', 'src/quota-overview.js', 'src/device-journey.js', 'src/agent-workspace.js',
    'src/yard/sprites.js', 'src/remote/console.js', 'src/remote/host.js', 'src/mesh/peer/peer.js',
    'src/mesh/peer/e2e-runner.js', 'src/mesh/probe/probe.js', 'src/mesh/probe/runner.js']],
  ['commands', ['src/automation/service.js', 'src/automation/packaged-cli.js', 'src/automation/local-locations.js',
    'src/main/session-actions.js', 'src/main/recruit-items.js', 'src/main/profile-registration.js']],
  ['clients', ['src/apps.js', 'src/clients/',
    'src/session-export.js', 'src/codex-quota.js', 'src/identity.js', 'src/account-discovery.js',
    'src/account-credentials.js', 'src/credential-import.js', 'src/codex-account-import.js', 'src/codex-runtime-home.js',
    'src/cli-discovery.js', 'src/tool-maintenance.js', 'src/hub/adapters.js', 'src/task-package/codex-adapter.js',
    'src/profile-home.js', 'src/mesh/main/provisioning-adapters.js', 'src/codex-history-retention.js', 'src/mac-application-activator.js']],
  ['services', ['src/activity.js', 'src/quota-service.js', 'src/profile-runtime.js', 'src/session-marks.js', 'src/updater.js',
    'src/hub/', 'src/main/agent-hub.js', 'src/task-package/service.js', 'src/mesh/main/', 'src/mesh/storage/', 'src/mesh/network/',
    'src/mesh/platform/', 'src/terminal-launcher.js']],
  ['core', ['src/core/', 'src/json-store.js', 'src/path-utils.js', 'src/windows.js', 'src/settings.js', 'src/quota.js', 'src/session-table.js',
    'src/session-location.js', 'src/identity-groups.js', 'src/onboarding-state.js', 'src/yard/', 'src/mesh/domain/',
    'src/mesh/protocol/', 'src/main/profile-store-policy.js', 'src/i18n/main-i18n.js', 'src/process.js', 'src/mac-launch.js',
    'src/task-package/format.js']]
];

function layerOf(file) {
  for (const [layer, patterns] of TABLE) {
    if (patterns.some((pattern) => (pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern))) return layer;
  }
  return null;
}

function sourceFiles(root) {
  const output = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && name.endsWith('.js')) output.push(name);
    }
  };
  if (fs.existsSync(path.join(root, 'src'))) walk('src');
  return output.sort();
}

function resolveRequire(root, from, request) {
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(from), request));
  if (target.endsWith('.js') || target.endsWith('.json')) return target;
  if (fs.existsSync(path.join(root, `${target}.js`))) return `${target}.js`;
  return path.posix.join(target, 'index.js');
}

function check(root = ROOT) {
  const files = sourceFiles(root);
  const layers = {};
  const unmapped = [];
  const upward = [];
  const electronBelowServices = [];
  let edges = 0;
  for (const file of files) {
    const layer = layerOf(file);
    layers[file] = layer;
    if (!layer) unmapped.push(file);
  }
  for (const file of files) {
    const layer = layers[file];
    const code = maskSource(fs.readFileSync(path.join(root, file), 'utf8'), { keepStrings: true });
    for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const request = m[1];
      if (request === 'electron' || request.startsWith('electron/')) {
        if (layer && RANK[layer] !== undefined && RANK[layer] < RANK.services) electronBelowServices.push({ file, layer });
        continue;
      }
      if (!request.startsWith('.')) continue;
      const target = resolveRequire(root, file, request);
      if (!target.endsWith('.js')) continue;
      edges++;
      const targetLayer = layerOf(target);
      if (!layer || layer === 'entry' || !targetLayer || targetLayer === 'entry') continue;
      if (RANK[targetLayer] > RANK[layer]) upward.push({ from: file, fromLayer: layer, to: target, toLayer: targetLayer });
    }
  }
  const counts = Object.fromEntries(['entry', ...LAYERS].map((name) => [name, Object.values(layers).filter((value) => value === name).length]));
  const enforced = [
    ...upward.filter((edge) => ENFORCED_LAYERS.includes(edge.fromLayer)).map((edge) => ({ rule: 'upward', ...edge })),
    ...electronBelowServices.filter((item) => ENFORCED_LAYERS.includes(item.layer)).map((item) => ({ rule: 'electron', ...item })),
    ...unmapped.map((file) => ({ rule: 'unmapped', file }))
  ];
  return {
    schemaVersion: 1,
    mode: 'core-enforced',
    enforcedLayers: [...ENFORCED_LAYERS],
    files: files.length,
    counts,
    relativeRequires: edges,
    unmapped,
    upward,
    electronBelowServices,
    violations: upward.length + electronBelowServices.length + unmapped.length,
    enforced
  };
}

module.exports = { LAYERS, TABLE, ENFORCED_LAYERS, layerOf, check };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : ROOT;
  const report = check(root);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.enforced.length || (args.includes('--strict') && report.violations)) process.exitCode = 1;
}
