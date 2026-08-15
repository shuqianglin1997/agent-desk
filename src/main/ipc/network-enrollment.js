function derivedNetworkEnrollment(input = {}) {
  if (typeof input.storedValue === 'boolean') return input.storedValue;
  const overview = input.overview && typeof input.overview === 'object' ? input.overview : {};
  const localDeviceId = String(overview.localDeviceId || '');
  const devices = Array.isArray(overview.devices) ? overview.devices : [];
  if (devices.some((device) => device && !device.isLocal && device.deviceId !== localDeviceId)) return true;
  if (devices.some((device) => Array.isArray(device?.signalUrls) && device.signalUrls.length > 0)) return true;
  if (devices.some((device) => Number(device?.signalServiceCount) > 0)) return true;
  return Array.isArray(input.configuredSignalingUrls) && input.configuredSignalingUrls.length > 0;
}

function shouldDeferSecureMeshStartup(input = {}) {
  if (input.platform !== 'darwin' || input.isPackaged !== true) return false;
  const signature = String(input.signatureText || '');
  const isAdHoc = /^\s*Signature=adhoc\s*$/mi.test(signature);
  const hasNoTeam = /^\s*TeamIdentifier=not set\s*$/mi.test(signature);
  const hasAuthority = /^\s*Authority=/mi.test(signature);
  return isAdHoc && hasNoTeam && !hasAuthority;
}

module.exports = { derivedNetworkEnrollment, shouldDeferSecureMeshStartup };
