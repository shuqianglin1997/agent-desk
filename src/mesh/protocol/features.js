const PROTOCOL_FEATURES = Object.freeze({
  CATALOG_SNAPSHOT_V1: 'catalog.snapshot.v1',
  INVENTORY_DEVICE_FACTS_V1: 'inventory.device-facts.v1'
});

const KNOWN_PROTOCOL_FEATURES = Object.freeze(Object.values(PROTOCOL_FEATURES));
const MAX_PROTOCOL_FEATURES = 32;
const MAX_PROTOCOL_FEATURE_LENGTH = 80;

function normalizeProtocolFeatures(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(KNOWN_PROTOCOL_FEATURES);
  const normalized = [];
  for (const candidate of value.slice(0, MAX_PROTOCOL_FEATURES)) {
    if (typeof candidate !== 'string') continue;
    const feature = candidate.trim();
    if (!feature || feature.length > MAX_PROTOCOL_FEATURE_LENGTH || !known.has(feature)) continue;
    if (!normalized.includes(feature)) normalized.push(feature);
  }
  return normalized.sort();
}

function negotiateProtocolFeatures(localValue, remoteValue) {
  const remote = new Set(normalizeProtocolFeatures(remoteValue));
  return normalizeProtocolFeatures(localValue).filter((feature) => remote.has(feature));
}

module.exports = {
  PROTOCOL_FEATURES,
  KNOWN_PROTOCOL_FEATURES,
  MAX_PROTOCOL_FEATURES,
  normalizeProtocolFeatures,
  negotiateProtocolFeatures
};
