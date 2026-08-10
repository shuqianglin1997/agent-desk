const crypto = require('node:crypto');

function canonicalEncode(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEncode).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalEncode(value[key])}`).join(',')}}`;
}

function meshScopedAccountKey(linkKey, providerNamespace, canonicalAccountId) {
  const key = normalizeLinkKey(linkKey);
  const provider = String(providerNamespace || '').trim().toLowerCase();
  const accountId = String(canonicalAccountId || '').trim();
  if (!provider || !accountId) return null;
  const payload = canonicalEncode({
    canonicalAccountId: accountId,
    providerNamespace: provider
  });
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function normalizeLinkKey(value) {
  if (Buffer.isBuffer(value) && value.length >= 32) return value;
  if (typeof value === 'string' && value) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length >= 32) return decoded;
  }
  throw new TypeError('mesh identity link key must contain at least 32 bytes');
}

module.exports = {
  canonicalEncode,
  meshScopedAccountKey
};
