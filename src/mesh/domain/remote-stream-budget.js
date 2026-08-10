(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RemoteStreamBudget = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const REMOTE_STREAM_LIMIT = 4;
  const ACTIVE_QUALITIES = new Set(['high', 'balanced', 'thumbnail']);
  const ACTIVE_STATES = new Set(['connecting-media', 'viewing', 'paused']);

  function planStreamBudget(sessions, activeSessionId) {
    return (Array.isArray(sessions) ? sessions : []).slice(0, REMOTE_STREAM_LIMIT).map((session) => {
      const sessionId = String(session?.sessionId || '');
      const active = sessionId !== '' && sessionId === String(activeSessionId || '');
      const preferred = ACTIVE_QUALITIES.has(session?.preferredQuality) ? session.preferredQuality : 'high';
      return {
        sessionId,
        active,
        tier: active ? 'active' : 'background',
        desiredQuality: active ? preferred : 'thumbnail',
        canApply: ACTIVE_STATES.has(String(session?.state || ''))
      };
    });
  }

  function deriveMediaSample(values, previous = {}, sampledAt = Date.now()) {
    const stats = Array.isArray(values) ? values : [];
    const inbound = stats.find((item) => item?.type === 'inbound-rtp'
      && (item.kind === 'video' || item.mediaType === 'video')
      && item.isRemote !== true) || null;
    const pairs = stats.filter((item) => item?.type === 'candidate-pair' && item.state === 'succeeded');
    const pair = pairs.find((item) => item.selected === true)
      || pairs.find((item) => item.nominated === true)
      || pairs[0]
      || null;
    const byId = new Map(stats.map((item) => [String(item?.id || ''), item]));
    const localCandidate = pair ? byId.get(String(pair.localCandidateId || '')) : null;
    const remoteCandidate = pair ? byId.get(String(pair.remoteCandidateId || '')) : null;
    const candidateTypes = unique([localCandidate?.candidateType, remoteCandidate?.candidateType], [
      'host', 'srflx', 'prflx', 'relay'
    ]);
    const protocols = unique([localCandidate?.protocol, remoteCandidate?.protocol], ['udp', 'tcp']);
    const bytesReceived = finiteInteger(inbound?.bytesReceived, 0, Number.MAX_SAFE_INTEGER);
    const previousBytes = finiteInteger(previous?.bytesReceived, 0, Number.MAX_SAFE_INTEGER);
    const previousAt = finiteNumber(previous?.sampledAt, 0, Number.MAX_SAFE_INTEGER);
    const elapsedMs = Number(sampledAt) - previousAt;
    const deltaBytes = bytesReceived - previousBytes;
    const bitrateKbps = previousAt > 0 && elapsedMs >= 250 && deltaBytes >= 0
      ? bounded(Math.round((deltaBytes * 8) / elapsedMs), 0, 1_000_000)
      : null;
    const packetsReceived = finiteInteger(inbound?.packetsReceived, 0, Number.MAX_SAFE_INTEGER);
    const packetsLost = finiteInteger(inbound?.packetsLost, 0, Number.MAX_SAFE_INTEGER);
    const packetTotal = packetsReceived + packetsLost;
    const lossPercent = packetTotal > 0
      ? Math.round(bounded((packetsLost / packetTotal) * 100, 0, 100) * 10) / 10
      : null;
    const roundTripSeconds = finiteNumber(pair?.currentRoundTripTime, 0, 60);
    return {
      bitrateKbps,
      latencyMs: roundTripSeconds == null ? null : Math.round(roundTripSeconds * 1_000),
      fps: finiteNumber(inbound?.framesPerSecond, 0, 240),
      lossPercent,
      path: candidateTypes.includes('relay') ? 'relay' : (candidateTypes.length ? 'direct' : 'authenticated'),
      candidateTypes,
      protocols,
      cursor: {
        bytesReceived: bytesReceived == null ? 0 : bytesReceived,
        sampledAt: Number.isFinite(Number(sampledAt)) ? Number(sampledAt) : Date.now()
      }
    };
  }

  function finiteNumber(value, minimum, maximum) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
    return number;
  }

  function finiteInteger(value, minimum, maximum) {
    const number = finiteNumber(value, minimum, maximum);
    return number == null ? null : Math.round(number);
  }

  function bounded(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value)));
  }

  function unique(values, allowlist) {
    const allowed = new Set(allowlist);
    return [...new Set(values.map((value) => String(value || '').toLowerCase()).filter((value) => allowed.has(value)))];
  }

  return {
    REMOTE_STREAM_LIMIT,
    ACTIVE_QUALITIES,
    ACTIVE_STATES,
    planStreamBudget,
    deriveMediaSample
  };
});
