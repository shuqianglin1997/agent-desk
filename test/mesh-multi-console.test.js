const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  REMOTE_STREAM_LIMIT,
  planStreamBudget,
  deriveMediaSample
} = require('../src/mesh/domain/remote-stream-budget');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('多设备预算始终只有活动目标使用偏好画质，其他目标降为低频', () => {
  const sessions = [
    { sessionId: 'a', state: 'viewing', preferredQuality: 'high' },
    { sessionId: 'b', state: 'viewing', preferredQuality: 'balanced' },
    { sessionId: 'c', state: 'paused', preferredQuality: 'high' },
    { sessionId: 'd', state: 'connecting-media', preferredQuality: 'high' },
    { sessionId: 'over-budget', state: 'viewing', preferredQuality: 'high' }
  ];
  const plan = planStreamBudget(sessions, 'b');
  assert.equal(plan.length, REMOTE_STREAM_LIMIT);
  assert.deepEqual(plan.map((item) => [item.sessionId, item.tier, item.desiredQuality]), [
    ['a', 'background', 'thumbnail'],
    ['b', 'active', 'balanced'],
    ['c', 'background', 'thumbnail'],
    ['d', 'background', 'thumbnail']
  ]);
  assert.equal(plan.filter((item) => item.active).length, 1);
  assert.ok(plan.every((item) => item.canApply));
});

test('WebRTC 统计只生成聚合码率、延迟、帧率、丢包和路径，不包含地址', () => {
  const direct = deriveMediaSample([
    {
      id: 'video-in', type: 'inbound-rtp', kind: 'video', bytesReceived: 126_000,
      packetsReceived: 990, packetsLost: 10, framesPerSecond: 29.8
    },
    {
      id: 'pair', type: 'candidate-pair', state: 'succeeded', selected: true,
      localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.018
    },
    { id: 'local', type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: '192.0.2.1' },
    { id: 'remote', type: 'remote-candidate', candidateType: 'srflx', protocol: 'udp', address: '198.51.100.7' }
  ], { bytesReceived: 1_000, sampledAt: 1_000 }, 2_000);
  assert.equal(direct.bitrateKbps, 1_000);
  assert.equal(direct.latencyMs, 18);
  assert.equal(direct.fps, 29.8);
  assert.equal(direct.lossPercent, 1);
  assert.equal(direct.path, 'direct');
  assert.deepEqual(direct.candidateTypes, ['host', 'srflx']);
  assert.doesNotMatch(JSON.stringify(direct), /192\.0\.2\.1|198\.51\.100\.7|address/);

  const relay = deriveMediaSample([
    { id: 'video-in', type: 'inbound-rtp', kind: 'video', bytesReceived: 5 },
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'relay' },
    { id: 'relay', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp', address: '203.0.113.9' }
  ], {}, 3_000);
  assert.equal(relay.path, 'relay');
  assert.deepEqual(relay.protocols, ['tcp']);
  assert.equal(relay.bitrateKbps, null);
});

test('远控工作区提供单屏/网格、每设备指标与明确活动输入目标', () => {
  const html = read('src/remote/console.html');
  const css = read('src/remote/console.css');
  const renderer = read('src/remote/console.js');
  assert.match(html, /id="layoutBtn"/);
  assert.match(html, /id="streamCount"[\s\S]*?id="streamBudget"/);
  assert.match(html, /id="networkMetrics"/);
  assert.match(html, /remote-stream-budget\.js/);
  assert.match(css, /\.video-stack\[data-layout="grid"\]/);
  assert.match(css, /\.video-panel\[data-active="true"\]/);
  assert.match(renderer, /planStreamBudget/);
  assert.match(renderer, /peer\.getStats\(\)/);
  assert.match(renderer, /previous\.controlState === 'waiting-consent'/);
  assert.doesNotMatch(`${html}\n${renderer}`, /candidate\.address|localCandidate\.address|remoteCandidate\.address/);
});
