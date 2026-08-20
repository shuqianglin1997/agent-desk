const { posix: macPath } = require('node:path');

function macApplicationBundlePath(executablePath) {
  const value = String(executablePath || '').trim();
  if (!value || !macPath.isAbsolute(value) || value.includes('\0')) return null;
  const marker = '/Contents/MacOS/';
  const markerIndex = value.indexOf(marker);
  if (markerIndex <= 0) return null;
  const bundlePath = value.slice(0, markerIndex);
  return bundlePath.toLowerCase().endsWith('.app') ? bundlePath : null;
}

function changedLaunchEnvironment(launchEnv = {}, baseEnv = {}) {
  const changes = [];
  for (const name of Object.keys(launchEnv).sort()) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('mac-launch-env-name-invalid');
    const value = launchEnv[name];
    if (value == null || String(value) === String(baseEnv[name] ?? '')) continue;
    const text = String(value);
    if (text.includes('\0')) throw new Error('mac-launch-env-value-invalid');
    changes.push(`${name}=${text}`);
  }
  return changes;
}

function macLaunchServicesArgs(application, appArgs = [], launchEnv = {}, baseEnv = {}) {
  const target = String(application || '').trim();
  if (!target || target.includes('\0')) throw new Error('mac-launch-application-invalid');
  const result = ['-n', '-a', target];
  for (const variable of changedLaunchEnvironment(launchEnv, baseEnv)) {
    result.push('--env', variable);
  }
  result.push('--args', ...appArgs.map((value) => String(value)));
  return result;
}

module.exports = {
  macApplicationBundlePath,
  changedLaunchEnvironment,
  macLaunchServicesArgs
};
