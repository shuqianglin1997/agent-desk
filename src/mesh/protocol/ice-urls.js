'use strict';

// Pure normalisation of ICE server URL lists. Settings (core) and the network
// layer (src/mesh/network/ice-config.js) share it; nothing here reads the
// environment, the disk or the network.

// Comma-separated (or joined) URLs matching `pattern`, trimmed, unique, at most
// `limit`.
function splitUrls(value, pattern, limit) {
  return [...new Set(String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => pattern.test(item)))]
    .slice(0, limit);
}

// stun:/stuns: URLs from a string or an array, at most eight.
function normalizeStunUrls(value) {
  return splitUrls(Array.isArray(value) ? value.join(',') : value, /^(stun|stuns):/i, 8);
}

module.exports = { splitUrls, normalizeStunUrls };
