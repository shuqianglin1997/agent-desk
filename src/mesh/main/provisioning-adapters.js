const DESCRIPTORS = Object.freeze({
  claude: Object.freeze({
    adapterId: 'desktop:claude',
    adapterVersion: '1',
    appId: 'claude',
    clientForm: 'desktop',
    toolId: 'desktop:claude',
    supportedPlatforms: Object.freeze(['darwin', 'win32']),
    supportsStrongIdentity: true,
    portableSettingKeys: Object.freeze([])
  }),
  codex: Object.freeze({
    adapterId: 'desktop:codex',
    adapterVersion: '1',
    appId: 'codex',
    clientForm: 'desktop',
    toolId: 'desktop:codex',
    supportedPlatforms: Object.freeze(['darwin', 'win32']),
    supportsStrongIdentity: true,
    portableSettingKeys: Object.freeze([])
  })
});

function provisioningAdapterDescriptor(appId, clientForm = 'desktop') {
  const descriptor = DESCRIPTORS[String(appId || '').trim().toLowerCase()] || null;
  if (!descriptor || descriptor.clientForm !== String(clientForm || '').trim().toLowerCase()) return null;
  return descriptor;
}

function validateProvisioningBlueprint(descriptor, blueprint = {}, options = {}) {
  if (!descriptor) return unsupported('adapter-unsupported');
  const platform = String(options.platform || process.platform);
  if (!descriptor.supportedPlatforms.includes(platform)) return unsupported('platform-unsupported');
  if (blueprint.preferredAppId && blueprint.preferredAppId !== descriptor.appId) {
    return unsupported('blueprint-app-mismatch');
  }
  if (blueprint.preferredClientForm && blueprint.preferredClientForm !== descriptor.clientForm) {
    return unsupported('blueprint-client-form-mismatch');
  }

  const portableSettings = blueprint.portableSettings && typeof blueprint.portableSettings === 'object'
    && !Array.isArray(blueprint.portableSettings)
    ? blueprint.portableSettings
    : {};
  const unknownSetting = Object.keys(portableSettings)
    .find((key) => !descriptor.portableSettingKeys.includes(key));
  if (unknownSetting) return unsupported('portable-setting-unsupported');
  if (nonEmptyList(blueprint.skillRequirements)) return unsupported('skill-requirements-unsupported');
  if (nonEmptyList(blueprint.toolRequirements)) return unsupported('tool-requirements-unsupported');
  if (nonEmptyList(blueprint.projectRequirements)) return unsupported('project-requirements-unsupported');

  return { ok: true, descriptor };
}

function unsupported(reasonCode) {
  return { ok: false, reasonCode };
}

function nonEmptyList(value) {
  return Array.isArray(value) && value.length > 0;
}

module.exports = {
  DESCRIPTORS,
  provisioningAdapterDescriptor,
  validateProvisioningBlueprint
};
