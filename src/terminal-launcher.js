/* Pure script generation for CLI launches; no account state or filesystem access. */
function posixShellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function terminalLauncherScript(options) {
  const baseEnv = options.baseEnv || {};
  // launchEnv is a complete environment. Merging baseEnv back into it would
  // restore credentials deliberately removed by the selected account adapter.
  const launchEnv = { ...(options.launchEnv ?? baseEnv), ...(options.extraEnv || {}) };
  const clearEnvKeys = [...new Set([
    ...(options.clearEnvKeys || []),
    ...Object.keys(baseEnv).filter((key) => !Object.hasOwn(launchEnv, key))
  ])].filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key))).map(String);
  const setEnv = Object.entries(launchEnv).filter(([key, value]) => (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value != null &&
    (String(value) !== String(baseEnv[key] ?? '') || clearEnvKeys.includes(key))
  ));
  const args = [...(options.prefixArgs || []), ...(options.args || [])].map(String);
  if (options.platform === 'win32') {
    return [
      '@echo off',
      'set "AGENTDESK_LAUNCHER=%~f0"',
      'del "%AGENTDESK_LAUNCHER%" >nul 2>nul',
      `cd /d "${options.home}"`,
      ...clearEnvKeys.map((key) => `set "${key}="`),
      ...setEnv.map(([key, value]) => `set "${key}=${String(value).replace(/"/g, '""')}"`),
      `call "${options.command}" ${args.map((value) => `"${value.replace(/"/g, '""')}"`).join(' ')}`
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    'AGENTDESK_LAUNCHER="$0"',
    '/bin/rm -f -- "$AGENTDESK_LAUNCHER"',
    `cd -- ${posixShellQuote(options.home)}`,
    ...clearEnvKeys.map((key) => `unset ${key}`),
    ...setEnv.map(([key, value]) => `export ${key}=${posixShellQuote(value)}`),
    `exec ${[options.command, ...args].map(posixShellQuote).join(' ')}`
  ].join('\n');
}

module.exports = { terminalLauncherScript };
