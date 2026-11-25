'use strict';

// AgentDesk — the window's IPC as a thin shell over the command table
// (src/commands/registry.js). Every implemented command is registered through
// the trusted main-window registrar Main passes in (sender and frame checked
// there); this module never imports Electron. `deps` are Main's services the
// commands use; each command takes only what it needs.

// `log` (src/main/app-log.js), when given, records a failed command by its id
// and fixed reason code only, never its input or result.
const { commandTable, runCommand, REASON } = require('../../commands/registry');

function registerCommandIpc({ ipcMain, deps, commands = commandTable().commands, log = null }) {
  const registered = [];
  for (const command of commands) {
    ipcMain.handle(command.channel, async (event, raw) => {
      let result;
      try {
        result = await runCommand(command, deps, raw, { event });
      } catch (error) {
        log?.error('command.threw', error, { id: command.id });
        throw error;
      }
      if (log && result && typeof result === 'object' && result.ok === false) {
        const reason = typeof result.reasonCode === 'string' && REASON.test(result.reasonCode) ? result.reasonCode : undefined;
        log.write('command.failed', { id: command.id, reason });
      }
      return result;
    });
    registered.push(command.channel);
  }
  return registered;
}

module.exports = { registerCommandIpc };
