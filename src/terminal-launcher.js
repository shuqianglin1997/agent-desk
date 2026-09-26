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
    // Batch files expand percent variables, and CALL expands them a second time.
    // Keep delayed expansion off and never use CALL. CLI inputs are paths and
    // fixed arguments; reject quotes/control characters instead of interpreting them.
    const literal = (value) => {
      const text = String(value ?? '');
      if (/["\r\n\0]/.test(text)) throw new Error('invalid-terminal-launch-value');
      return text.replace(/%/g, '%%');
    };
    return [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      '(',
      'set "AGENTDESK_LAUNCHER=%~f0"',
      'del "%~f0" >nul 2>nul',
      `cd /d "${literal(options.home)}"`,
      ...clearEnvKeys.map((key) => `set "${key}="`),
      ...setEnv.map(([key, value]) => `set "${key}=${literal(value)}"`),
      `"${literal(options.command)}" ${args.map((value) => `"${literal(value)}"`).join(' ')}`,
      ')'
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
