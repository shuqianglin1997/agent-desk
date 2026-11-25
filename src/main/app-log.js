'use strict';

// Main's side of Catshelf's own log (src/core/log.js): where it lives, the
// first line (build and system), and what the process reports by itself:
// uncaught exceptions (observed only, Electron's own handling is unchanged)
// and renderer or helper processes that went away. A `--cli` process writes
// nothing; `diagnostics` only reads. Electron's `app` is passed in.

const os = require('node:os');
const { createLog, logDirectory } = require('../core/log');
const { buildInfo } = require('../core/product');

const SILENT = Object.freeze({ write() { return false; }, error() { return false; } });

/**
 * @param {{
 *   app: any,
 *   cli: boolean,
 *   platform?: string,
 *   home?: string,
 *   processRef?: NodeJS.Process
 * }} options
 */
function startAppLog({ app, cli, platform = process.platform, home = os.homedir(), processRef = process }) {
  const directory = logDirectory({
    platform,
    home,
    userData: app.getPath('userData'),
    explicitUserData: app.commandLine.hasSwitch('user-data-dir')
  });
  if (cli) return { directory, ...SILENT };
  const log = createLog({ directory, home });
  // app.getPath('logs') then names the same folder.
  try { app.setAppLogsPath(directory); } catch (_error) { /* best effort */ }
  let build = null;
  try { build = buildInfo(); } catch (_error) { /* reported as unknown */ }
  log.write('start', {
    version: build?.version || null,
    commit: build?.commit || null,
    dirty: build?.dirty ?? null,
    packaged: build?.packaged ?? null,
    platform,
    arch: processRef.arch,
    os: os.release(),
    electron: processRef.versions?.electron || null,
    pid: processRef.pid
  });
  processRef.on('uncaughtExceptionMonitor', (error, origin) => log.error('uncaught', error, { origin }));
  // A process that ended normally (clean-exit, as helpers do at quit) is not news.
  app.on('render-process-gone', (_event, _contents, details) => {
    if (details?.reason !== 'clean-exit') log.write('renderer.gone', { reason: details?.reason, exitCode: details?.exitCode });
  });
  app.on('child-process-gone', (_event, details) => {
    if (details?.reason !== 'clean-exit') log.write('child.gone', { type: details?.type, reason: details?.reason, exitCode: details?.exitCode });
  });
  app.on('will-quit', () => log.write('quit', { ms: uptime(processRef) }));
  return { directory, write: log.write, error: log.error };
}

/** Milliseconds since the process started, for the start-up phases. */
function uptime(processRef = process) {
  return Math.round(processRef.uptime() * 1000);
}

module.exports = { startAppLog, uptime };
