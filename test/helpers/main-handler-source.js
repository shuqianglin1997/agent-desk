'use strict';

// For the tests that pin Main's IPC handler text: src/main.js, plus a
// registration-shaped copy of every command moved into src/commands/
// (`ipcMain.handle('<channel>', <its exec source>);`) ahead of it, so the same
// patterns keep checking the same handler bodies (and the Main helpers after
// them) after a move. Architecture phase 8
// replaces these text checks with behaviour tests.

const fs = require('node:fs');
const path = require('node:path');

function mainHandlerSource() {
  const { commandTable } = require('../../src/commands/registry');
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
  const moved = commandTable().commands
    .map((command) => `  ipcMain.handle('${command.channel}', ${command.exec.toString()});`);
  return `${moved.join('\n')}\n${main}`;
}

module.exports = { mainHandlerSource };
