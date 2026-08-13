const CAPABILITY_DEFINITIONS = Object.freeze({
  'inventory.read': { defaultPaired: true, dangerous: false },
  'catalog.manage': { defaultPaired: true, dangerous: false },
  'session.pointer.receive': { defaultPaired: true, dangerous: false },
  'file.receive': { defaultPaired: false, dangerous: true },
  'profile.launch': { defaultPaired: false, dangerous: true },
  'agent.prepare': { defaultPaired: false, dangerous: true },
  'screen.view': { defaultPaired: false, dangerous: true },
  'input.control': { defaultPaired: false, dangerous: true },
  'clipboard.receive': { defaultPaired: false, dangerous: true },
  unattended: { defaultPaired: false, dangerous: true },
  'device.admin': { defaultPaired: true, dangerous: true }
});

const KNOWN_CAPABILITIES = Object.freeze(Object.keys(CAPABILITY_DEFINITIONS));

function normalizeCapabilities(value) {
  const known = new Set(KNOWN_CAPABILITIES);
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => known.has(item)))].sort();
}

function defaultPairedPermissions(options = {}) {
  return KNOWN_CAPABILITIES.filter((name) => {
    if (name === 'device.admin' && options.deviceAdmin === false) return false;
    return CAPABILITY_DEFINITIONS[name].defaultPaired;
  });
}

function updatePermissions(current, patch, supported = KNOWN_CAPABILITIES) {
  const allowed = new Set(normalizeCapabilities(supported));
  const next = new Set(normalizeCapabilities(current).filter((name) => allowed.has(name)));
  const changes = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  for (const [name, enabled] of Object.entries(changes)) {
    if (!Object.prototype.hasOwnProperty.call(CAPABILITY_DEFINITIONS, name)) continue;
    if (!allowed.has(name)) continue;
    if (enabled === true) next.add(name);
    if (enabled === false) next.delete(name);
  }
  return [...next].sort();
}

function can(device, capability) {
  if (!device || device.status === 'revoked') return false;
  return normalizeCapabilities(device.permissions).includes(capability);
}

function requireCapability(device, capability) {
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_DEFINITIONS, capability)) {
    throw new Error('capability-unknown');
  }
  if (!can(device, capability)) throw new Error(`capability-denied:${capability}`);
  return true;
}

module.exports = {
  CAPABILITY_DEFINITIONS,
  KNOWN_CAPABILITIES,
  normalizeCapabilities,
  defaultPairedPermissions,
  updatePermissions,
  can,
  requireCapability
};
