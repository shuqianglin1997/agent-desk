const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeProbeResult } = require('../src/mesh/main/webrtc-probe');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('WebRTC 自检公开结果只保留路径类型、协议和耗时，不回传 IP/SDP/ICE 原文', () => {
  const result = normalizeProbeResult({
    ok: true,
    elapsedMs: 42.4,
    channel: 'control.reliable',
    ordered: true,
    candidateTypes: ['host', 'relay', 'evil'],
    protocols: ['udp', 'quic'],
    address: '192.168.1.8',
    sdp: 'sensitive',
    selectedPairState: 'succeeded'
  });
  assert.deepEqual(result, {
    ok: true,
    elapsedMs: 42,
    channel: 'control.reliable',
    ordered: true,
    candidateTypes: ['host', 'relay'],
    protocols: ['udp'],
    selectedPairState: 'succeeded'
  });
  assert.throws(() => normalizeProbeResult({ ok: true, elapsedMs: 120_000 }), /duration-invalid/);
});

test('WebRTC 自检使用隐藏沙箱 Renderer，preload 只有一次性固定结果通道', () => {
  const mainProbe = read('src/mesh/main/webrtc-probe.js');
  const preload = read('src/mesh/probe/preload.js');
  const html = read('src/mesh/probe/index.html');
  const renderer = read('src/mesh/probe/probe.js');

  assert.match(mainProbe, /show:\s*false/);
  assert.match(mainProbe, /contextIsolation:\s*true/);
  assert.match(mainProbe, /nodeIntegration:\s*false/);
  assert.match(mainProbe, /sandbox:\s*true/);
  assert.match(mainProbe, /event\.sender\.id !== probeWindow\.webContents\.id/);
  assert.match(preload, /ipcRenderer\.send\('mesh-probe:result'/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke|ipcRenderer\.on|require\('node:/);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'; script-src 'self'; connect-src 'none'/);
  assert.match(renderer, /new RTCPeerConnection\(\{ iceServers: \[\] \}\)/);
  assert.match(renderer, /createDataChannel\(CHANNEL, \{ ordered: true \}\)/);
  assert.doesNotMatch(renderer, /fetch\(|WebSocket\(|localStorage|indexedDB/);
});

test('设备中心通过固定 IPC 运行自检，并明确不把本机通过写成两设备已连接', () => {
  const main = read('src/main.js');
  const preload = read('src/preload.js');
  const zh = read('src/i18n/zh.js');
  assert.match(main, /ipcMain\.handle\('devices:probeTransport'/);
  assert.match(preload, /probeMeshTransport: \(\) => ipcRenderer\.invoke\('devices:probeTransport'\)/);
  assert.match(zh, /这只验证本机承载与打包，不代表两台设备已连通/);
});
