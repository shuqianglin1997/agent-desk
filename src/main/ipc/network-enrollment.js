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

module.exports = { derivedNetworkEnrollment };
