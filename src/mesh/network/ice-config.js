const { normalizeServiceUrls } = require('../protocol/signaling-auth');

function signalingUrlsFromEnv(env = process.env) {
  return normalizeServiceUrls(env.AGENTDESK_SIGNALING_URLS || '', {
    allowInsecure: env.AGENTDESK_ALLOW_INSECURE_SIGNALING === '1'
  });
}

function staticIceServers(env = process.env) {
  const stunUrls = normalizeStunUrls(env.AGENTDESK_STUN_URLS);
  const turnUrls = splitUrls(env.AGENTDESK_TURN_URLS, /^(turn|turns):/i, 8);
  const username = cleanSecret(env.AGENTDESK_TURN_USERNAME, 256);
  const credential = cleanSecret(env.AGENTDESK_TURN_CREDENTIAL, 512);
  const result = [];
  if (stunUrls.length) result.push({ urls: stunUrls });
  if (turnUrls.length && username && credential) result.push({ urls: turnUrls, username, credential });
  return result;
}

function normalizeStunUrls(value) {
  return splitUrls(Array.isArray(value) ? value.join(',') : value, /^(stun|stuns):/i, 8);
}

function mergeIceServers(...groups) {
  const result = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const urls = (Array.isArray(item?.urls) ? item.urls : [item?.urls])
        .map((value) => String(value || '').trim())
        .filter((value) => /^(stun|stuns|turn|turns):/i.test(value))
        .slice(0, 8);
      if (!urls.length) continue;
      const username = cleanSecret(item.username, 256);
      const credential = cleanSecret(item.credential, 512);
      const hasTurn = urls.some((url) => /^turns?:/i.test(url));
      if (hasTurn && (!username || !credential)) continue;
      const key = JSON.stringify([urls, username || '', credential || '']);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        urls,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {})
      });
      if (result.length >= 8) return result;
    }
  }
  return result;
}

function publicIceDiagnostics(servers, dynamic = {}) {
  let stunUrlCount = 0;
  let turnUrlCount = 0;
  const transports = new Set();
  for (const item of Array.isArray(servers) ? servers : []) {
    for (const url of Array.isArray(item?.urls) ? item.urls : [item?.urls]) {
      if (/^stuns?:/i.test(String(url || ''))) stunUrlCount += 1;
      if (/^turns?:/i.test(String(url || ''))) {
        turnUrlCount += 1;
        try {
          const transport = new URL(String(url).replace(/^turns?:/i, 'https:')).searchParams.get('transport');
          if (transport === 'udp' || transport === 'tcp') transports.add(transport);
        } catch (_error) {
          // The URL still counts; malformed details are not exposed.
        }
      }
    }
  }
  return {
    stunConfigured: stunUrlCount > 0,
    stunUrlCount,
    turnConfigured: turnUrlCount > 0,
    turnUrlCount,
    turnCredentialSource: turnUrlCount > 0 ? (dynamic.source || 'static') : 'none',
    turnCredentialExpiresAt: turnUrlCount > 0 ? (dynamic.expiresAt || null) : null,
    turnTransports: [...transports]
  };
}

function splitUrls(value, pattern, limit) {
  return [...new Set(String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => pattern.test(item)))]
    .slice(0, limit);
}

function cleanSecret(value, limit) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : '';
}

module.exports = {
  signalingUrlsFromEnv,
  staticIceServers,
  normalizeStunUrls,
  mergeIceServers,
  publicIceDiagnostics
};
