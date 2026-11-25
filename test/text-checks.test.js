// AgentDesk — the test files that still check source as text, each with the
// reason it cannot (yet) check behaviour. A new file that reads src/ as text
// without running any of it fails here until it is listed with a reason; a
// listed file that starts running code drops off and must be removed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { testMetrics } = require('../scripts/arch-metrics');

const ROOT = path.join(__dirname, '..');

const TEXT_ONLY = {
  // Security and release invariants: what the packaged app may load and run.
  'test/release-security.test.js': 'release invariants: CSP, no nodeIntegration, fuses and ASAR, workflow and verifier scripts; they live in config and scripts that only run at release',
  'test/packaged-first-use-smoke.test.js': 'release invariant: the smoke runner launches a packaged build, which tests cannot do; only its wiring in main.js is held',
  // Structure of the style sheets, parsed (not matched as raw text).
  'test/style-structure.test.js': 'parses the three sheets into rules and layers; a style structure invariant, not a behaviour',
  // Renderer wiring: these run in the window, and Node tests have no DOM.
  // Each check is held to one named renderer function, not the whole source.
  'test/renderer-overlays.test.js': 'how dialogs and popovers open and close (top layer, Esc, focus) is renderer code; the page structure part is parsed',
  'test/device-journey-ui.test.js': 'the device journey\'s renderer steps (invitation inspect, approve, connect, refresh); page structure parsed, Main side by behaviour elsewhere',
  'test/onboarding-ui.test.js': 'the first-use start-up order and setup call in the renderer; page structure and preload checked by behaviour',
  'test/quota-ui.test.js': 'the quota popover and polling wiring in the renderer; quota reasons and IPC checked by behaviour elsewhere',
  'test/recruit-ui.test.js': 'the recruit dialog\'s renderer steps and its drop handling; page and styles parsed',
  // These run extracted renderer functions in a vm: behaviour on extracts.
  'test/sessions-refresh-on-activity.test.js': 'runs the activity-driven refresh extracted from the renderer in a vm',
  'test/simplification.test.js': 'runs renderer functions extracted in a vm and checks retired features stay gone'
};

test('只比对源码文字的测试文件都列在这里，并写明为什么不能改成验证行为', () => {
  const metrics = testMetrics(ROOT);
  assert.deepEqual([...metrics.textOnlyList].sort(), Object.keys(TEXT_ONLY).sort());
  for (const [file, reason] of Object.entries(TEXT_ONLY)) assert.ok(reason.length > 20, `${file} has a reason`);
});
