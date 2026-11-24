'use strict';

// AgentDesk — the window's IPC as a thin shell over the command table
// (src/commands/registry.js). Every implemented command is registered through
// the trusted main-window registrar Main passes in (sender and frame checked
// there); this module never imports Electron. `deps` are Main's services the
// commands use; each command takes only what it needs.

const { commandTable, runCommand } = require('../../commands/registry');

function registerCommandIpc({ ipcMain, deps, commands = commandTable().commands }) {
  const registered = [];
  for (const command of commands) {
    ipcMain.handle(command.channel, (event, raw) => runCommand(command, deps, raw, { event }));
    registered.push(command.channel);
  }
  return registered;
}

module.exports = { registerCommandIpc };
