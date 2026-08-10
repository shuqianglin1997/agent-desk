(function () {
  const CHANNEL = 'control.reliable';
  const PROBE_TIMEOUT_MS = 8_000;

  window.addEventListener('DOMContentLoaded', () => {
    run().then(
      (result) => window.meshProbe.report(result),
      (error) => window.meshProbe.report({
        ok: false,
        errorCode: normalizeError(error)
      })
    );
  });

  async function run() {
    if (typeof RTCPeerConnection !== 'function') throw new Error('webrtc-api-unavailable');
    const startedAt = performance.now();
    const left = new RTCPeerConnection({ iceServers: [] });
    const right = new RTCPeerConnection({ iceServers: [] });
    const nonce = randomNonce();
    let rightChannel = null;

    try {
      const leftChannel = left.createDataChannel(CHANNEL, { ordered: true });
      const echoed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('datachannel-echo-timeout')), PROBE_TIMEOUT_MS);
        leftChannel.addEventListener('open', () => {
          leftChannel.send(JSON.stringify({ type: 'probe', nonce }));
        }, { once: true });
        leftChannel.addEventListener('message', (event) => {
          try {
            const value = JSON.parse(String(event.data || ''));
            if (value.type !== 'probe.ack' || value.nonce !== nonce) throw new Error('datachannel-echo-mismatch');
            clearTimeout(timer);
            resolve();
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        }, { once: true });
        leftChannel.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('datachannel-left-error'));
        }, { once: true });
      });

      right.addEventListener('datachannel', (event) => {
        rightChannel = event.channel;
        rightChannel.addEventListener('message', (message) => {
          try {
            const value = JSON.parse(String(message.data || ''));
            if (value.type !== 'probe' || value.nonce !== nonce) throw new Error('datachannel-probe-invalid');
            rightChannel.send(JSON.stringify({ type: 'probe.ack', nonce }));
          } catch (_error) {
            rightChannel.close();
          }
        });
      }, { once: true });

      await left.setLocalDescription(await left.createOffer());
      await waitForIceGathering(left);
      await right.setRemoteDescription(left.localDescription);
      await right.setLocalDescription(await right.createAnswer());
      await waitForIceGathering(right);
      await left.setRemoteDescription(right.localDescription);
      await echoed;

      const transport = await transportSummary(left);
      return {
        ok: true,
        elapsedMs: performance.now() - startedAt,
        channel: CHANNEL,
        ordered: leftChannel.ordered === true,
        candidateTypes: transport.candidateTypes,
        protocols: transport.protocols,
        selectedPairState: transport.state
      };
    } finally {
      try { rightChannel?.close(); } catch (_error) { /* already closed */ }
      left.close();
      right.close();
    }
  }

  function waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ice-gathering-timeout')), PROBE_TIMEOUT_MS);
      const onState = () => {
        if (peer.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      peer.addEventListener('icegatheringstatechange', onState);
    });
  }

  async function transportSummary(peer) {
    const reports = await peer.getStats();
    let selected = null;
    for (const report of reports.values()) {
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        selected = reports.get(report.selectedCandidatePairId) || selected;
      }
      if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
        selected = report;
      }
    }
    const candidates = [];
    if (selected?.localCandidateId) candidates.push(reports.get(selected.localCandidateId));
    if (selected?.remoteCandidateId) candidates.push(reports.get(selected.remoteCandidateId));
    return {
      candidateTypes: [...new Set(candidates.map((item) => item?.candidateType).filter(Boolean))],
      protocols: [...new Set(candidates.map((item) => item?.protocol).filter(Boolean))],
      state: selected?.state || 'unknown'
    };
  }

  function randomNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function normalizeError(error) {
    return String(error?.message || error || 'webrtc-probe-failed')
      .trim()
      .replace(/[^a-z0-9._-]/gi, '-')
      .slice(0, 100) || 'webrtc-probe-failed';
  }
})();
