const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  REMOTE_SDP_LIMIT,
  normalizeRemoteDescription,
  normalizeViewCommand,
  normalizePublicDisplays,
  publicRemoteSession,
  screenPermission
} = require('../src/mesh/main/remote-control-service');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('远控 SDP、显示器与画质命令都使用固定 schema 和上限', () => {
  assert.deepEqual(normalizeRemoteDescription({ type: 'offer', sdp: 'v=0' }, 'offer'), {
    type: 'offer',
    sdp: 'v=0'
  });
  assert.throws(() => normalizeRemoteDescription({ type: 'answer', sdp: 'v=0' }, 'offer'), /type/);
  assert.throws(() => normalizeRemoteDescription({ type: 'offer', sdp: 'x'.repeat(REMOTE_SDP_LIMIT + 1) }, 'offer'), /size/);
  assert.deepEqual(normalizeViewCommand({ type: 'pause' }), { type: 'pause' });
  assert.deepEqual(normalizeViewCommand({ type: 'quality', value: 'thumbnail' }), {
    type: 'quality',
    value: 'thumbnail'
  });
  assert.deepEqual(normalizeViewCommand({ type: 'display', displayId: 'display-2' }), {
    type: 'display',
    displayId: 'display-2'
  });
  assert.throws(() => normalizeViewCommand({ type: 'shell', command: 'rm -rf' }), /command-type/);
  assert.throws(() => normalizeViewCommand({ type: 'quality', value: 'unlimited' }), /quality/);
  assert.deepEqual(normalizePublicDisplays([{
    displayId: '2',
    name: 'Studio Display',
    width: 5120,
    height: 2880,
    scaleFactor: 2,
    sourceId: 'must-not-pass'
  }]), [{
    displayId: '2',
    name: 'Studio Display',
    width: 5120,
    height: 2880,
    scaleFactor: 2
  }]);
});

test('公开远控状态不泄露采集 source、SDP、屏幕内容或 TURN 凭据', () => {
  const value = publicRemoteSession({
    sessionId: 'session-a',
    deviceId: 'device-b',
    deviceName: 'Studio',
    direction: 'outgoing',
    state: 'viewing',
    mode: 'view',
    quality: 'high',
    displayId: '1',
    displayName: 'Main',
    displays: [{ displayId: '1', name: 'Main', width: 1920, height: 1080, scaleFactor: 1 }],
    transport: { candidateTypes: ['host'], protocols: ['udp'] },
    remoteDescription: { type: 'offer', sdp: 'sensitive' },
    captureDisplays: [{ id: 'screen:0:0', displayId: '1', name: 'Main' }],
    iceServers: [{ urls: ['turn:relay'], credential: 'secret' }],
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:01.000Z'
  });
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /screen:0:0|sensitive|credential|secret|turn:relay/);
  assert.equal(value.mode, 'view');
  assert.equal(value.state, 'viewing');
});

test('远控使用独立沙箱窗口、目标端确认与常驻停止条', () => {
  const service = read('src/mesh/main/remote-control-service.js');
  const consolePreload = read('src/remote/console-preload.js');
  const hostPreload = read('src/remote/host-preload.js');
  const consoleHtml = read('src/remote/console.html');
  const hostHtml = read('src/remote/host.html');
  const hostRenderer = read('src/remote/host.js');

  assert.match(service, /title: 'AgentDesk Remote Console'[\s\S]*?contextIsolation: true[\s\S]*?nodeIntegration: false[\s\S]*?sandbox: true/);
  assert.match(service, /alwaysOnTop: true[\s\S]*?title: 'AgentDesk Remote View'[\s\S]*?contextIsolation: true[\s\S]*?sandbox: true/);
  assert.match(service, /requireCapability\(peer\.remote, 'screen\.view'\)/);
  assert.match(service, /requireCapability\(context\.peer\.remote, 'screen\.view'\)/);
  assert.match(consoleHtml, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(hostHtml, /id="consentView"[\s\S]*?id="allowBtn"[\s\S]*?id="indicatorView"[\s\S]*?id="stopBtn"/);
  assert.match(hostRenderer, /chromeMediaSource: 'desktop'/);
  assert.match(hostRenderer, /videoSender\.replaceTrack/);
  assert.doesNotMatch(`${consolePreload}\n${hostPreload}`, /ipcRenderer\.invoke\([^'\"]|remoteCommand|shell\.run|generic\.exec/);
});

test('主窗口只增加设备卡远控入口，控制台不侵入七行骨架', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const renderer = read('src/renderer.js');
  const styles = read('src/styles.css');
  assert.match(main, /ipcMain\.handle\('remoteControl:open'/);
  assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+Escape'/);
  assert.match(preload, /openRemoteControl: \(deviceId\) => ipcRenderer\.invoke\('remoteControl:open'/);
  assert.match(renderer, /className = 'remote-control-action'/);
  assert.match(renderer, /openRemoteDevice\(device\)/);
  assert.match(styles, /\.app-shell \{[\s\S]*?grid-template-rows:\s*48px auto auto auto auto minmax\(0, 1fr\) 28px/);
  assert.doesNotMatch(read('src/index.html'), /<video|remote-stage|remote-console/);
});

test('macOS 屏幕权限状态被规范化，其他平台由系统捕获 API 决定', () => {
  if (process.platform === 'darwin') {
    assert.equal(screenPermission({ getMediaAccessStatus: () => 'granted' }), 'granted');
    assert.equal(screenPermission({ getMediaAccessStatus: () => 'unexpected' }), 'unknown');
  } else {
    assert.equal(screenPermission(null), 'granted');
  }
});
