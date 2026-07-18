// AgentDesk — 额度 UI、慢轮询和猫咪疲劳叠加契约。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '..', 'src', 'yard', 'scene.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('账号栏常驻额度 Beta、手动刷新和可访问进度条渲染', () => {
  assert.match(html, /id="quotaSummary"[^>]*aria-live="polite"/);
  assert.match(html, /id="quotaRefreshBtn"[^>]*>↻ 刷新额度<\/button>/);
  assert.match(renderer, /setAttribute\('role', 'progressbar'\)/);
  assert.match(renderer, /listQuotas\(\{ force: force === true \}\)/);
});

test('能量模块在 scene 前加载，活动状态和疲劳状态分别传入庭院', () => {
  const energyIndex = html.indexOf('./yard/energy.js');
  const sceneIndex = html.indexOf('./yard/scene.js');
  assert.ok(energyIndex > 0 && energyIndex < sceneIndex);
  assert.match(renderer, /statesById,/);
  assert.match(renderer, /energyById,/);
  assert.match(scene, /data = \{ profiles: \[\], statesById: \{\}, energyById: \{\}/);
  assert.match(scene, /drawEnergyCue\(entry,/);
});

test('额度慢轮询不混进 8 秒 activity IPC', () => {
  assert.match(renderer, /const QUOTA_REFRESH_INTERVAL = 5 \* 60_000/);
  const activity = between(renderer, 'async function loadActivity()', '// ── 陪伴账本');
  assert.doesNotMatch(activity, /listQuotas|loadQuotas/);
  const quota = between(renderer, 'async function loadQuotas', 'function selectedQuota');
  assert.doesNotMatch(quota, /listActivity/);
});

test('stale 缓存可以展示但不会驱动疲劳，猫动作状态保持正交', () => {
  assert.match(renderer, /if \(snapshot\.status === 'stale'\) renderQuotaMeters\(snapshot\)/);
  assert.match(renderer, /deriveEnergy\(state\.quotaError \? null : state\.quotas\[profile\.id\], now\)/);
  assert.match(scene, /额度疲劳只调节动作节奏，不改变 working\/onduty/);
});

test('经典视图在 1080 最小窗口下允许主列和详情列收缩', () => {
  assert.match(styles, /\.main-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 328px\)/);
});
