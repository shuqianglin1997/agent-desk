const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'src/renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/workspace.css'), 'utf8');

function bodyOf(name, nextName) {
  const start = renderer.indexOf(`function ${name}`);
  const end = nextName ? renderer.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  return renderer.slice(start, end === -1 ? renderer.length : end);
}

test('添加设备使用固定 Header、滚动 Content、固定 Footer 的子任务 Dialog', () => {
  assert.match(html, /id="deviceJourneyDialog"[\s\S]*?utility-dialog-header[\s\S]*?device-journey-content[\s\S]*?device-journey-footer/);
  assert.match(html, /id="deviceJourneyCloseBtn"[^>]*type="button"/);
  assert.match(css, /\.device-journey-dialog \.dialog-body\.utility-dialog-shell[\s\S]*?--dialog-preferred-height:\s*640px/);
  assert.match(css, /\.device-journey-content\s*\{[\s\S]*?display:\s*grid/);
});

test('身份、信任、连接、目录、库存按独立步骤呈现', () => {
  for (const step of ['identity', 'trust', 'connect', 'catalog', 'inventory']) {
    assert.match(html, new RegExp(`data-step="${step}"`));
  }
  const facts = bodyOf('renderDeviceJourneyFacts', 'renderDeviceJourneyActions');
  assert.match(facts, /\['trust',\s*value\.trusted/);
  assert.match(facts, /\['connect',\s*value\.connected/);
  assert.match(facts, /\['catalog',\s*value\.catalogReady/);
  assert.match(facts, /\['inventory',\s*value\.inventoryReady/);
  assert.doesNotMatch(facts, /paired[^\n]*usable|authenticated[^\n]*usable/);
});

test('普通添加与加入入口进入任务向导，30 分钟接收只留在高级更多菜单', () => {
  assert.match(html, /id="deviceCenterMoreMenu"[\s\S]*?id="receiveConnectionsBtn"/);
  const bind = bodyOf('bindEvents', 'updateUi');
  assert.match(bind, /showJoinMeshBtn[\s\S]*?openDeviceJourney\('join'/);
  assert.match(bind, /createDeviceInviteBtn[\s\S]*?openDeviceJourney\('host'/);
  const journey = html.slice(html.indexOf('id="deviceJourneyDialog"'), html.indexOf('id="devicePermissionsDialog"'));
  assert.doesNotMatch(journey, /receiveConnectionsBtn|接收连接 30 分钟/);
});

test('加入前必须经过 Main 验签预览和确认 token；契约缺失时失败关闭', () => {
  const inspect = bodyOf('inspectDeviceJourneyInvitation', 'joinFromDeviceJourney');
  const join = bodyOf('joinFromDeviceJourney', 'connectFromDeviceJourney');
  assert.match(inspect, /typeof window\.manager\.inspectDeviceInvitation !== 'function'/);
  assert.match(inspect, /device-invite-inspection-unavailable/);
  assert.match(inspect, /window\.manager\.inspectDeviceInvitation\(\{ code \}\)/);
  assert.match(join, /inviteId:\s*model\.preview\.inviteId/);
  assert.match(join, /confirmationToken:\s*model\.preview\.confirmationToken/);
  assert.doesNotMatch(inspect, /joinDeviceMesh/);
});

test('邀请方在成员证书签发前显示加入设备身份，并有独立批准与拒绝动作', () => {
  const identity = bodyOf('deviceJourneyIdentity', 'renderDeviceJourneyIdentity');
  const actions = bodyOf('renderDeviceJourneyActions', 'renderDeviceJourney');
  const decision = bodyOf('decideDeviceJourneyClaim', 'connectFromDeviceJourney');
  assert.match(identity, /model\.role === 'host' && model\.claim/);
  assert.match(identity, /model\.claim\.fingerprint/);
  assert.match(actions, /approve-claim/);
  assert.match(actions, /reject-claim/);
  assert.match(decision, /window\.manager\.decidePairingClaim/);
  assert.match(decision, /approvalId:\s*claim\.approvalId/);
});

test('设备任务只向 Main 提交配对码、确认 token 和稳定 deviceId，不提交路径或命令', () => {
  const inspect = bodyOf('inspectDeviceJourneyInvitation', 'joinFromDeviceJourney');
  const join = bodyOf('joinFromDeviceJourney', 'connectFromDeviceJourney');
  const connect = bodyOf('connectFromDeviceJourney', 'finishDeviceJourney');
  assert.match(connect, /connectDevice\(value\.target\.deviceId\)/);
  for (const body of [inspect, join, connect]) {
    assert.doesNotMatch(body, /profilePath|sessionRoot|executablePath|command|argv|shell/);
  }
});

test('关闭重开从 overview 稳定事实恢复，进度轮询不触发远端控制或 30 分钟监听', () => {
  const refresh = bodyOf('refreshDeviceJourneyFacts', 'renderDeviceJourneyProgress');
  assert.match(refresh, /window\.manager\.listDevices\(\)/);
  assert.match(refresh, /DeviceJourney\.transition[\s\S]*?result\.overview/);
  assert.doesNotMatch(refresh, /setDeviceReachable|openRemoteControl|createDeviceInvite|connectDevice/);
});
