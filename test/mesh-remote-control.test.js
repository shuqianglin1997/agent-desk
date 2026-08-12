const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  REMOTE_SDP_LIMIT,
  normalizeRemoteDescription,
  normalizeViewCommand,
  normalizePublicDisplays,
  normalizeSurfaceBounds,
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

test('远控使用主窗口内嵌沙箱 Surface、目标端确认与常驻停止条', () => {
  const service = read('src/mesh/main/remote-control-service.js');
  const consolePreload = read('src/remote/console-preload.js');
  const hostPreload = read('src/remote/host-preload.js');
  const consoleHtml = read('src/remote/console.html');
  const hostHtml = read('src/remote/host.html');
  const hostRenderer = read('src/remote/host.js');

  assert.match(service, /new this\.WebContentsView\([\s\S]*?contextIsolation: true[\s\S]*?nodeIntegration: false[\s\S]*?sandbox: true/);
  assert.match(service, /mainWindowProvider[\s\S]*?contentView\.addChildView\(view\)/);
  assert.match(service, /setConsoleSurface\([\s\S]*?view\.setBounds\(bounds\)[\s\S]*?view\.setVisible\(true\)/);
  assert.doesNotMatch(service, /title: 'AgentDesk Remote Console'/);
  assert.match(service, /alwaysOnTop: true[\s\S]*?title: 'AgentDesk Remote View'[\s\S]*?contextIsolation: true[\s\S]*?sandbox: true/);
  assert.match(service, /requireCapability\(peer\.remote, 'screen\.view'\)/);
  assert.match(service, /requireCapability\(context\.peer\.remote, 'screen\.view'\)/);
  assert.match(consoleHtml, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(hostHtml, /id="consentView"[\s\S]*?id="allowBtn"[\s\S]*?id="indicatorView"[\s\S]*?id="stopBtn"/);
  assert.match(hostRenderer, /chromeMediaSource: 'desktop'/);
  assert.match(hostRenderer, /videoSender\.replaceTrack/);
  assert.doesNotMatch(`${consolePreload}\n${hostPreload}`, /ipcRenderer\.invoke\([^'\"]|remoteCommand|shell\.run|generic\.exec/);
});

test('右下详情面板承载隔离远控 Surface，其他两个面板和普通 Renderer 安全边界不变', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const renderer = read('src/renderer.js');
  const styles = read('src/styles.css');
  assert.match(main, /ipcMain\.handle\('remoteControl:open'/);
  assert.match(main, /ipcMain\.handle\('remoteControl:setSurface'[\s\S]*?event\.sender\.id !== mainWindow\.webContents\.id/);
  assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+Escape'/);
  assert.match(preload, /openRemoteControl: \(deviceId\) => ipcRenderer\.invoke\('remoteControl:open'/);
  assert.match(preload, /setRemoteControlSurface: \(input = \{\}\) => ipcRenderer\.invoke\('remoteControl:setSurface'/);
  assert.match(renderer, /className = 'remote-control-action'/);
  assert.match(renderer, /openRemoteDevice\(device\)/);
  assert.match(renderer, /setWorkspaceMode\('remote'\)/);
  assert.match(renderer, /remoteWorkspaceHost\.getBoundingClientRect\(\)/);
  assert.match(read('src/index.html'), /id="detailPanel"[\s\S]*?id="remoteWorkspaceHost"[^>]*data-detail-surface="remote"/);
  assert.match(styles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 340px/);
  assert.match(styles, /\.detail-panel > \.remote-workspace-host\s*\{[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(read('src/index.html'), /<video|remote-stage|remote-console/);
});

test('嵌入式远控边界必须完全位于主窗口内容区内', () => {
  const parentWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 200, width: 1040, height: 812 })
  };
  assert.deepEqual(normalizeSurfaceBounds({ x: 0, y: 430, width: 1040, height: 382 }, parentWindow), {
    x: 0,
    y: 430,
    width: 1040,
    height: 382
  });
  assert.throws(() => normalizeSurfaceBounds({ x: 0, y: 700, width: 1040, height: 200 }, parentWindow), /outside-window/);
  assert.throws(() => normalizeSurfaceBounds({ x: 0, y: 430, width: 200, height: 100 }, parentWindow), /too-small/);
});

test('macOS 屏幕权限状态被规范化，其他平台由系统捕获 API 决定', () => {
  if (process.platform === 'darwin') {
    assert.equal(screenPermission({ getMediaAccessStatus: () => 'granted' }), 'granted');
    assert.equal(screenPermission({ getMediaAccessStatus: () => 'unexpected' }), 'unknown');
  } else {
    assert.equal(screenPermission(null), 'granted');
  }
});
