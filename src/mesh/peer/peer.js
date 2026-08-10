(function () {
  const CHANNEL = 'control.reliable';
  const TIMEOUT_MS = 20_000;
  const MAX_MESSAGE_BYTES = 512 * 1024;
  const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
  const MAX_SDP_BYTES = 256 * 1024;

  window.addEventListener('DOMContentLoaded', () => {
    run().catch((error) => {
      void window.meshPeer.reportState({
        state: 'error',
        errorCode: safeError(error)
      });
    });
  });

  async function run() {
    if (typeof RTCPeerConnection !== 'function') throw new Error('webrtc-api-unavailable');
    const bootstrap = await window.meshPeer.bootstrap();
    if (!bootstrap?.ok) throw new Error(bootstrap?.reasonCode || 'peer-bootstrap-failed');
    const peer = new RTCPeerConnection({ iceServers: bootstrap.iceServers || [] });
    let channel = null;
    let closed = false;
    let openResolve;
    let openReject;
    const opened = new Promise((resolve, reject) => {
      openResolve = resolve;
      openReject = reject;
    });
    const timer = setTimeout(() => openReject(new Error('peer-open-timeout')), TIMEOUT_MS);

    const attach = (nextChannel) => {
      if (channel) return;
      channel = nextChannel;
      channel.binaryType = 'arraybuffer';
      channel.addEventListener('open', async () => {
        clearTimeout(timer);
        const transport = await transportSummary(peer);
        await window.meshPeer.reportState({
          state: 'connected',
          channel: CHANNEL,
          ordered: channel.ordered === true,
          candidateTypes: transport.candidateTypes,
          protocols: transport.protocols,
          selectedPairState: transport.state
        });
        openResolve();
      }, { once: true });
      channel.addEventListener('message', async (event) => {
        try {
          const text = typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data);
          if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) throw new Error('peer-message-too-large');
          const message = JSON.parse(text);
          await window.meshPeer.reportMessage(message);
        } catch (error) {
          await window.meshPeer.reportState({ state: 'error', errorCode: safeError(error) });
          peer.close();
        }
      });
      channel.addEventListener('close', () => {
        if (!closed) void window.meshPeer.reportState({ state: 'disconnected', errorCode: 'datachannel-closed' });
      });
      channel.addEventListener('error', () => {
        void window.meshPeer.reportState({ state: 'error', errorCode: 'datachannel-error' });
      });
    };

    const removeSend = window.meshPeer.onSend((message) => {
      try {
        if (!channel || channel.readyState !== 'open') throw new Error('datachannel-not-open');
        const text = JSON.stringify(message);
        if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) throw new Error('peer-message-too-large');
        if (channel.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('datachannel-backpressure');
        channel.send(text);
      } catch (error) {
        void window.meshPeer.reportState({ state: 'error', errorCode: safeError(error) });
      }
    });
    const removeClose = window.meshPeer.onClose(() => {
      closed = true;
      try { channel?.close(); } catch (_error) { /* already closed */ }
      peer.close();
    });
    window.addEventListener('beforeunload', () => {
      removeSend();
      removeClose();
      closed = true;
      peer.close();
    }, { once: true });

    if (bootstrap.role === 'offerer') {
      attach(peer.createDataChannel(CHANNEL, { ordered: true }));
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGathering(peer);
      const remoteDescription = waitForRemoteDescription();
      await window.meshPeer.reportSignal({
        type: 'offer',
        description: descriptionOf(peer.localDescription)
      });
      const answer = await remoteDescription;
      await peer.setRemoteDescription(answer);
    } else if (bootstrap.role === 'answerer') {
      peer.addEventListener('datachannel', (event) => attach(event.channel), { once: true });
      await peer.setRemoteDescription(bootstrap.remoteDescription);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIceGathering(peer);
      await window.meshPeer.reportSignal({
        type: 'answer',
        description: descriptionOf(peer.localDescription)
      });
    } else {
      throw new Error('peer-role-invalid');
    }
    await opened;
  }

  function waitForRemoteDescription() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('peer-answer-timeout')), TIMEOUT_MS);
      const remove = window.meshPeer.onRemoteDescription((description) => {
        clearTimeout(timer);
        remove();
        resolve(description);
      });
    });
  }

  function waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ice-gathering-timeout')), TIMEOUT_MS);
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
      if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') selected = report;
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

  function descriptionOf(value) {
    const sdp = String(value?.sdp || '');
    if (!sdp || new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
      throw new Error('peer-description-size');
    }
    return {
      type: value?.type === 'offer' ? 'offer' : 'answer',
      sdp
    };
  }

  function safeError(error) {
    return String(error?.message || error || 'peer-failed')
      .trim()
      .replace(/[^a-z0-9._-]/gi, '-')
      .slice(0, 100) || 'peer-failed';
  }
})();
